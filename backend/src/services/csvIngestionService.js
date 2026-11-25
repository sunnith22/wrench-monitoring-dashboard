/**
 * ==============================================================================
 * TOYOTA INDUSTRIES ENGINE INDIA (TIEI)
 * TNGA Impact Wrench Monitoring & Telemetry Infrastructure
 * Module: Today-Only Backend Mount Ingestion Service (URYU & YOKOTA)
 * ==============================================================================
 * Mount Architecture on Server 10.82.126.73:
 *   - URYU Mount:   /mnt/torque_wrench <== //172.16.105.234/D
 *   - YOKOTA Mount: /mnt/yokota        <== //172.16.105.234/c
 *
 * Windows UNC Fallbacks:
 *   - URYU:   \\172.16.105.234\D (or Z:\)
 *   - YOKOTA: \\172.16.105.234\c
 *
 * Target Database:
 *   - PostgreSQL on 10.82.126.44 (DB: tnga_wrench_db, Table: wrench_tightening_cycles)
 *
 * ZERO-LAG / LINE-SAFE DESIGN:
 *   1. Strictly targets ONLY TODAY's date folders (YYYYMMDD) — never scans past years.
 *   2. Jumps straight to known catalog tool folders — never crawls Windows/AppData trees.
 *   3. Reads ONLY Line 3 (<1 KB micro-buffer) for cycle files and immediately closes stream.
 *   4. Skips unchanged/already-ingested files in memory before touching SMB.
 *   5. Uses batch multi-row SQL inserts into PostgreSQL for sub-second writes.
 * ==============================================================================
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { query, localFallbackCycles, getPostgresStatus } = require('../config/postgresDB');
const { getToolThreshold } = require('./configService');
const { dispatchPulseEmailAlert } = require('./emailService');
const { recordAlert } = require('./alertStore');
const { getLocalDateKeys, normalizeCsvTimestamp, extractDateIso } = require('../utils/dateUtils');

const URYU_MOUNT_PATH = process.env.URYU_MOUNT_PATH || '/mnt/torque_wrench';
const YOKOTA_MOUNT_PATH = process.env.YOKOTA_MOUNT_PATH || '/mnt/yokota';
const URYU_UNC_SHARE = process.env.URYU_UNC_SHARE || '\\\\172.16.105.234\\D';
const YOKOTA_UNC_SHARE = process.env.YOKOTA_UNC_SHARE || '\\\\172.16.105.234\\c';
const FALLBACK_MOUNT = process.env.DATA_MOUNT_PATH || 'Z:\\';

// Trackers to skip redundant disk/SMB I/O across sync windows
const summaryFileTracker = new Map(); // filePath -> { size, mtimeMs, lastLineRead }
const processedIndividualFiles = new Set();
const localFallbackKeySet = new Set();
const cachedMountSubRoots = new Map(); // mountRoot -> { expiresAt, dirs }

const IGNORED_SYSTEM_DIRS = new Set([
  'appdata', 'windows', 'program files', 'program files (x86)',
  'programdata', 'users', 'system volume information', '$recycle.bin',
  'recovery', 'perflogs', 'boot', 'msocache'
]);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let lastSyncStats = {
  lastRunTimestamp: null,
  activeUryuSource: null,
  activeYokotaSource: null,
  toolFoldersFound: 0,
  filesProcessed: 0,
  rowsIngested: 0,
  duplicatesSkipped: 0,
  alertsTriggered: 0,
  status: 'IDLE',
  error: null
};

async function resolveAccessiblePath(candidatePaths) {
  for (const p of candidatePaths) {
    if (!p) continue;
    try {
      await fsp.access(p, fs.constants.R_OK);
      return p;
    } catch (err) {}
  }
  return null;
}

function pathReadable(targetPath) {
  return fsp.access(targetPath, fs.constants.R_OK).then(() => true).catch(() => false);
}

/**
 * Resolves a Wrench Asset from folder number, controller IP, or filename.
 */
function resolveWrench(folderToken, ipToken = null, fileName = '') {
  const normFolder = String(folderToken || '').replace(/^0+/, '') || '0';
  const pad3 = normFolder.padStart(3, '0');
  const pad4 = normFolder.padStart(4, '0');

  const byFolder = ALL_WRENCH_ASSETS.find(w => {
    const wNorm = String(w.folder || '').replace(/^0+/, '');
    return wNorm === normFolder || w.folder === pad3 || w.folder === pad4;
  });
  if (byFolder) return byFolder;

  if (ipToken) {
    const normIpNum = String(ipToken).replace(/^.*[._]/, '').trim();
    const byContr = ALL_WRENCH_ASSETS.find(w => String(w.contr_no) === normIpNum);
    if (byContr) return byContr;
  }

  const upperFile = fileName.toUpperCase();
  for (const tool of ALL_WRENCH_ASSETS) {
    if (upperFile.includes(tool.wrench_id.toUpperCase())) return tool;
    if (tool.folder && upperFile.includes(String(tool.folder))) return tool;
  }

  return null;
}

/**
 * Builds unique folder targets per brand from the 73-tool catalog.
 */
function getUniqueCatalogFoldersByBrand(brand) {
  const map = new Map();
  for (const tool of ALL_WRENCH_ASSETS) {
    if (tool.brand !== brand) continue;
    const key = String(tool.folder).trim();
    if (!map.has(key)) {
      map.set(key, tool);
    }
  }
  return Array.from(map.values());
}

/**
 * Discovers data root subdirectories once (e.g. DATA-28mar, DATA, YOKOTA) and caches
 * for 10 minutes. Strictly excludes Windows OS/AppData directories on C:\ shares.
 */
async function getSafeMountRoots(mountRoot) {
  const now = Date.now();
  const cached = cachedMountSubRoots.get(mountRoot);
  if (cached && cached.expiresAt > now) {
    return cached.dirs;
  }

  const dirs = [mountRoot];
  try {
    const entries = await fsp.readdir(mountRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.startsWith('.') || lower.startsWith('$') || IGNORED_SYSTEM_DIRS.has(lower)) {
        continue;
      }
      if (lower.startsWith('data') || lower.includes('yokota') || lower.includes('uryu') || lower.includes('torque')) {
        dirs.push(path.join(mountRoot, entry.name));
      }
    }
  } catch (err) {}

  const uniqueDirs = [...new Set(dirs)];
  cachedMountSubRoots.set(mountRoot, { expiresAt: now + 10 * 60 * 1000, dirs: uniqueDirs });
  return uniqueDirs;
}

/**
 * ULTRA-SAFE MICRO-READER for individual cycle files (<timestamp>.csv or Yokota waveform CSV).
 * Reads ONLY Line 3 ("Final: Time 0.6 Deg 9 Puls 17 Trq 7") with a 1 KB stream buffer
 * and immediately destroys the stream so the shop-floor PC is never locked or loaded.
 */
function parseIndividualCycleFileSafely(filePath, fileName, todayIso, fileMtime = null) {
  return new Promise((resolve) => {
    let resolved = false;
    let fileStream = null;

    try {
      fileStream = fs.createReadStream(filePath, {
        flags: 'r',
        encoding: 'utf8',
        highWaterMark: 1024
      });
    } catch (openErr) {
      return resolve(null);
    }

    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    let lineIndex = 0;
    let finalRowData = null;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        rl.close();
        if (fileStream) fileStream.destroy();
      }
    };

    rl.on('line', (line) => {
      lineIndex++;
      const trimmed = line.trim();

      if (lineIndex <= 4 && (trimmed.startsWith('Final:') || trimmed.includes('Puls') || trimmed.includes('Pulse'))) {
        const tokens = trimmed.replace(/\t/g, ',').split(',').map(t => t.trim()).filter(Boolean);
        const parsed = {};

        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i].toLowerCase();
          if (['puls', 'pulse', 'pulses', 'no.of pulses'].includes(tok) && i + 1 < tokens.length) {
            parsed.pulse = parseInt(tokens[i + 1], 10) || 0;
          }
          if (['trq', 'torque'].includes(tok) && i + 1 < tokens.length) {
            parsed.torque = parseFloat(tokens[i + 1]) || 0;
          }
          if (['deg', 'angle'].includes(tok) && i + 1 < tokens.length) {
            parsed.angle = parseFloat(tokens[i + 1]) || 0;
          }
          if (['time'].includes(tok) && i + 1 < tokens.length) {
            parsed.time = parseFloat(tokens[i + 1]) || 0;
          }
        }

        if (parsed.pulse !== undefined || parsed.torque !== undefined) {
          finalRowData = parsed;
          cleanup();
        }
      }

      if (lineIndex >= 5) {
        cleanup();
      }
    });

    rl.on('close', () => {
      if (!resolved) resolved = true;
      if (!finalRowData) return resolve(null);

      const baseName = path.basename(fileName, path.extname(fileName));
      let tighteningTime = '';

      // Pattern 1: YYYYMMDDHHmmss... (e.g. 20261114053505904)
      const fullMatch = baseName.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (fullMatch) {
        tighteningTime = `${fullMatch[1]}-${fullMatch[2]}-${fullMatch[3]} ${fullMatch[4]}:${fullMatch[5]}:${fullMatch[6]}`;
      } else {
        // Pattern 2: Yokota format e.g. 0103_120_0_100_103_20261106_053 + file mtime clock
        const dateOnlyMatch = baseName.match(/_(\d{4})(\d{2})(\d{2})(?:_|$)/);
        const datePart = dateOnlyMatch
          ? `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`
          : todayIso;
        const refTime = fileMtime instanceof Date ? fileMtime : new Date();
        const hh = String(refTime.getHours()).padStart(2, '0');
        const mm = String(refTime.getMinutes()).padStart(2, '0');
        const ss = String(refTime.getSeconds()).padStart(2, '0');
        tighteningTime = `${datePart} ${hh}:${mm}:${ss}`;
      }

      const seqMatch = baseName.match(/_(\d+)$/);
      const cycleCounter = seqMatch
        ? parseInt(seqMatch[1], 10) || 1
        : parseInt(baseName.slice(-6) || '1', 10) || 1;

      resolve({
        tighteningTime,
        receptionTime: tighteningTime,
        workNo: '1',
        pulseCount: finalRowData.pulse || 0,
        torque: finalRowData.torque || 0,
        angle: finalRowData.angle || 0,
        judgement: 'OK',
        cycleCounter
      });
    });

    fileStream.on('error', () => {
      cleanup();
      resolve(null);
    });
  });
}

/**
 * Parses summary CSV files (F-Data*.csv) incrementally, keeping ONLY rows for targetDateIso.
 */
async function parseSummaryCsvFileSafely(filePath, targetDateIso) {
  let stat = null;
  try {
    stat = await fsp.stat(filePath);
  } catch (err) {
    return [];
  }

  const prev = summaryFileTracker.get(filePath);
  if (prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) {
    return [];
  }

  const lastLineRead = prev ? prev.lastLineRead : 0;
  let fileStream = null;
  try {
    fileStream = fs.createReadStream(filePath, { flags: 'r', encoding: 'utf8', highWaterMark: 8192 });
  } catch (err) {
    return [];
  }

  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let currentLine = 0;
  let headerIndexMap = prev?.headerIndexMap || {};
  const newRows = [];

  for await (const line of rl) {
    currentLine++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (currentLine <= 4 && !trimmed.includes('Tightening date') && Object.keys(headerIndexMap).length === 0) {
      if (currentLine === 4) {
        const headers = trimmed.split(',').map(h => h.replace(/^"|"$/g, '').trim());
        headers.forEach((h, idx) => {
          headerIndexMap[h.toLowerCase()] = idx;
        });
      }
      continue;
    }

    if (trimmed.toLowerCase().includes('tightening date/time') || trimmed.toLowerCase().includes('number of pulses')) {
      const headers = trimmed.split(',').map(h => h.replace(/^"|"$/g, '').trim());
      headers.forEach((h, idx) => {
        headerIndexMap[h.toLowerCase()] = idx;
      });
      continue;
    }

    if (currentLine > 4 && currentLine > lastLineRead) {
      const cols = trimmed.split(',').map(c => c.replace(/^"|"$/g, '').trim());
      const getVal = (...keys) => {
        for (const k of keys) {
          const idx = headerIndexMap[k.toLowerCase()];
          if (idx !== undefined && cols[idx] !== undefined) return cols[idx];
        }
        return '';
      };

      const rawTime = getVal('tightening date/time', 'date/time', 'timestamp') || cols[0] || '';
      if (!rawTime) continue;

      const tighteningTime = normalizeCsvTimestamp(rawTime, targetDateIso);
      if (extractDateIso(tighteningTime) !== targetDateIso) {
        continue; // Strictly today's cycles only
      }

      const workNo = getVal('workno.', 'work no', 'barcode') || String(currentLine - 4);
      const pulseRaw = getVal('number of pulses', 'no.of pulses', 'no.of.pulse', 'pulses', 'puls') || cols[3] || '0';
      const torqueRaw = getVal('torque', 'trq') || cols[4] || '0';
      const angleRaw = getVal('angle', 'deg') || cols[5] || '0';
      const judgement = (getVal('judgement', 'judgment', 'status') || 'OK').toUpperCase();
      const count = parseInt(getVal('count') || workNo || String(currentLine - 4), 10) || (currentLine - 4);

      newRows.push({
        tighteningTime,
        receptionTime: tighteningTime,
        workNo,
        pulseCount: parseInt(pulseRaw, 10) || 0,
        torque: parseFloat(torqueRaw) || 0,
        angle: parseFloat(angleRaw) || 0,
        judgement,
        cycleCounter: count
      });
    }
  }

  summaryFileTracker.set(filePath, {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    lastLineRead: currentLine,
    headerIndexMap
  });

  return newRows;
}

/**
 * Batch inserts parsed cycles into PostgreSQL on 10.82.126.44 (chunks of 100 rows).
 * Uses ON CONFLICT (wrench_id, tightening_time, cycle_counter) DO NOTHING.
 */
async function insertCyclesToPostgres(wrench, cycles) {
  if (!cycles || cycles.length === 0) return { inserted: 0, skipped: 0 };

  let inserted = 0;
  let skipped = 0;
  const activeLimit = getToolThreshold(wrench.wrench_id) || wrench.default_pulse_threshold || 25;
  let highestBreachCycle = null;
  const pgStatus = getPostgresStatus();
  const isPgLive = pgStatus.connected && pgStatus.tablesReady;

  const CHUNK_SIZE = 100;
  for (let i = 0; i < cycles.length; i += CHUNK_SIZE) {
    const chunk = cycles.slice(i, i + CHUNK_SIZE);
    const values = [];
    const placeholders = [];
    let fallbackAddedInChunk = 0;

    chunk.forEach((c, idx) => {
      const pulseStatus = c.pulseCount > activeLimit
        ? 'CRITICAL'
        : (c.pulseCount >= activeLimit - 3 ? 'WARNING' : 'NORMAL');
      const torqueStatus = c.judgement === 'NG' ? 'NG' : 'OK';
      const engineNo = `ENG-${String(c.workNo || '1').padStart(4, '0')}`;
      const offset = idx * 15;

      if (isPgLive) {
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15})`
        );
        values.push(
          wrench.wrench_id,
          wrench.tool_name,
          String(wrench.station),
          String(wrench.folder),
          wrench.line_code || wrench.line || 'MK1',
          engineNo,
          c.tighteningTime,
          c.receptionTime,
          c.torque,
          torqueStatus,
          c.angle,
          'OK',
          c.pulseCount,
          pulseStatus,
          c.cycleCounter
        );
      }

      // Update local fallback cache in O(1)
      const cacheKey = `${wrench.wrench_id}_${c.tighteningTime}_${c.cycleCounter}`;
      if (!localFallbackKeySet.has(cacheKey)) {
        localFallbackKeySet.add(cacheKey);
        fallbackAddedInChunk++;
        localFallbackCycles.push({
          id: localFallbackCycles.length + 1,
          wrench_id: wrench.wrench_id,
          tool_name: wrench.tool_name,
          station: String(wrench.station),
          folder: String(wrench.folder),
          line: wrench.line_code || wrench.line || 'MK1',
          engine_no: engineNo,
          tightening_time: c.tighteningTime,
          reception_time: c.receptionTime,
          torque_val: c.torque,
          torque_status: torqueStatus,
          angle_val: c.angle,
          angle_status: 'OK',
          pulse_count: c.pulseCount,
          pulse_status: pulseStatus,
          cycle_counter: c.cycleCounter,
          created_at: new Date().toISOString()
        });
      }

      if (c.pulseCount > activeLimit && (!highestBreachCycle || c.pulseCount > highestBreachCycle.pulseCount)) {
        highestBreachCycle = { ...c, engineNo };
      }
    });

    if (isPgLive) {
      try {
        const sqlRes = await query(
          `INSERT INTO wrench_tightening_cycles (
            wrench_id, tool_name, station, folder, line, engine_no,
            tightening_time, reception_time, torque_val, torque_status,
            angle_val, angle_status, pulse_count, pulse_status, cycle_counter
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (wrench_id, tightening_time, cycle_counter) DO NOTHING
          RETURNING id;`,
          values
        );

        const batchInserted = sqlRes ? (sqlRes.rowCount || 0) : 0;
        inserted += batchInserted;
        skipped += Math.max(0, chunk.length - batchInserted);
      } catch (err) {
        console.warn(`[Batch Insert Warning for ${wrench.wrench_id}]:`, err.message);
        skipped += chunk.length;
      }
    } else {
      inserted += fallbackAddedInChunk;
      skipped += Math.max(0, chunk.length - fallbackAddedInChunk);
    }
  }

  if (highestBreachCycle) {
    lastSyncStats.alertsTriggered++;
    recordAlert({
      wrench_id: wrench.wrench_id,
      tool_name: wrench.tool_name,
      assembly_name: wrench.assembly_name,
      sub_assembly_name: wrench.sub_assembly_name,
      station: wrench.station,
      severity: 'CRITICAL',
      rule_reason: 'PULSE_THRESHOLD_EXCEEDED',
      observed_value: highestBreachCycle.pulseCount,
      threshold_limit: activeLimit,
      engine_number: highestBreachCycle.engineNo,
      work_no: highestBreachCycle.workNo,
      event_time: new Date()
    });

    try {
      await dispatchPulseEmailAlert({
        wrenchId: wrench.wrench_id,
        toolName: wrench.tool_name,
        station: wrench.station,
        folder: wrench.folder,
        measuredPulse: highestBreachCycle.pulseCount,
        pulseLimit: activeLimit,
        engineNumber: highestBreachCycle.engineNo,
        torque: highestBreachCycle.torque,
        angle: highestBreachCycle.angle,
        timestamp: highestBreachCycle.tighteningTime
      });
    } catch (alertErr) {
      console.warn(`[Alert Dispatch Warning]:`, alertErr.message);
    }
  }

  return { inserted, skipped };
}

/**
 * Resolves candidate today-date folders for a single catalog tool without scanning
 * unrelated directories or historical date folders.
 */
async function resolveTodayDateDirsForTool(baseRoots, tool, dateKeys) {
  const foundDirs = [];
  const norm = String(tool.folder || '').replace(/^0+/, '');
  const folderNames = [...new Set([
    String(tool.folder),
    norm.padStart(3, '0'),
    norm.padStart(4, '0'),
    norm
  ])];

  for (const baseRoot of baseRoots) {
    for (const fName of folderNames) {
      const toolDir = path.join(baseRoot, fName);
      const candidates = tool.brand === 'URYU'
        ? [
            path.join(toolDir, 'UEC-4800', dateKeys.compact),
            path.join(toolDir, dateKeys.compact),
            path.join(toolDir, 'UEC-4800', dateKeys.dashes)
          ]
        : [
            path.join(toolDir, dateKeys.compact),
            path.join(toolDir, `120_0_100_${tool.contr_no}`, dateKeys.compact),
            path.join(toolDir, `120_0_100_${norm}`, dateKeys.compact),
            path.join(toolDir, 'YOKOTA', dateKeys.compact),
            path.join(toolDir, dateKeys.dashes)
          ];

      let matchedDirect = false;
      for (const cPath of candidates) {
        if (await pathReadable(cPath)) {
          foundDirs.push(cPath);
          matchedDirect = true;
        }
      }

      // Only inspect toolDir children for YOKOTA IP subfolders if direct path missed & toolDir exists
      if (!matchedDirect && tool.brand === 'YOKOTA' && await pathReadable(toolDir)) {
        try {
          const subEntries = await fsp.readdir(toolDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isDirectory() && (sub.name.startsWith('120_') || sub.name.toUpperCase() === 'YOKOTA')) {
              const yPath = path.join(toolDir, sub.name, dateKeys.compact);
              if (await pathReadable(yPath)) {
                foundDirs.push(yPath);
              }
            }
          }
        } catch (err) {}
      }

      if (foundDirs.length > 0) return [...new Set(foundDirs)];
    }
  }

  return foundDirs;
}

/**
 * Ingests TODAY'S files for a specific brand directly from its mounted root.
 */
async function ingestBrandTodayFromMount(mountRoot, brand, dateKeys) {
  let rowsAdded = 0;
  let dupsSkipped = 0;
  let filesChecked = 0;
  let toolFoldersFound = 0;

  const baseRoots = await getSafeMountRoots(mountRoot);
  const brandTools = getUniqueCatalogFoldersByBrand(brand);

  for (const wrench of brandTools) {
    const todayDirs = await resolveTodayDateDirsForTool(baseRoots, wrench, dateKeys);
    if (todayDirs.length === 0) continue;

    toolFoldersFound++;
    const toolNewCycles = [];
    let newFilesOpenedInTool = 0;

    for (const activeDateDir of todayDirs) {
      let files = [];
      try {
        files = await fsp.readdir(activeDateDir);
      } catch (err) {
        continue;
      }

      const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));

      for (const file of csvFiles) {
        const fullPath = path.join(activeDateDir, file);
        if (processedIndividualFiles.has(fullPath)) continue;

        filesChecked++;

        if (file.startsWith('F-Data') || file.toLowerCase().includes('summary') || file.toLowerCase().includes('tightening')) {
          const summaryRows = await parseSummaryCsvFileSafely(fullPath, dateKeys.iso);
          if (summaryRows.length > 0) {
            toolNewCycles.push(...summaryRows);
            newFilesOpenedInTool++;
          }
        } else {
          // Ensure filename matches today if it carries an 8-digit date token
          const dateInFile = file.match(/(20\d{6})/);
          if (dateInFile && dateInFile[1] !== dateKeys.compact) {
            processedIndividualFiles.add(fullPath);
            continue;
          }

          let mtime = null;
          try {
            const st = await fsp.stat(fullPath);
            mtime = st.mtime;
          } catch (e) {}

          const cycle = await parseIndividualCycleFileSafely(fullPath, file, dateKeys.iso, mtime);
          processedIndividualFiles.add(fullPath);
          newFilesOpenedInTool++;

          if (cycle) {
            toolNewCycles.push(cycle);
          }

          // Gentle yield every 10 newly read SMB files so shop-floor PC CPU stays < 1%
          if (newFilesOpenedInTool % 10 === 0) {
            await sleep(5);
          }
        }
      }
    }

    if (toolNewCycles.length > 0) {
      const { inserted, skipped } = await insertCyclesToPostgres(wrench, toolNewCycles);
      rowsAdded += inserted;
      dupsSkipped += skipped;
      if (inserted > 0) {
        console.log(`   -> [${wrench.wrench_id} | Folder ${wrench.folder}]: +${inserted} today cycles saved to PostgreSQL.`);
      }
    }

    if (newFilesOpenedInTool > 0) {
      await sleep(30);
    }
  }

  return { rowsAdded, dupsSkipped, filesChecked, toolFoldersFound };
}

/**
 * Main Backend Ingestion Job (TODAY ONLY):
 * Connects directly inside the Backend to /mnt/torque_wrench & /mnt/yokota
 * (or Windows UNC fallbacks), reads ONLY today's date folders, and writes
 * batch rows into PostgreSQL `tnga_wrench_db` on 10.82.126.44.
 */
async function runCsvPullJob() {
  const startTime = new Date();
  const dateKeys = getLocalDateKeys(startTime);
  const targetDbName = process.env.POSTGRES_DB || 'tnga_wrench_db';

  console.log(`\n================================================================`);
  console.log(`🛡️  [Backend Today-Only Sync] Pulling telemetry for: ${dateKeys.compact} (${dateKeys.iso})`);
  console.log(`    Mount Points: ${URYU_MOUNT_PATH} & ${YOKOTA_MOUNT_PATH}`);
  console.log(`    Target PostgreSQL: ${process.env.POSTGRES_HOST || '10.82.126.44'} (DB: ${targetDbName})`);
  console.log(`================================================================`);

  lastSyncStats.status = 'RUNNING';
  lastSyncStats.lastRunTimestamp = startTime.toISOString();
  lastSyncStats.alertsTriggered = 0;
  lastSyncStats.error = null;

  const activeUryu = await resolveAccessiblePath([URYU_MOUNT_PATH, URYU_UNC_SHARE, FALLBACK_MOUNT]);
  const activeYokota = await resolveAccessiblePath([YOKOTA_MOUNT_PATH, YOKOTA_UNC_SHARE]);

  lastSyncStats.activeUryuSource = activeUryu;
  lastSyncStats.activeYokotaSource = activeYokota;

  let totalRowsAdded = 0;
  let totalDuplicatesSkipped = 0;
  let totalFilesChecked = 0;
  let totalToolFolders = 0;

  if (activeUryu || activeYokota) {
    if (activeUryu) {
      console.log(`📂 [URYU Mount Active]: ${activeUryu}`);
      const resU = await ingestBrandTodayFromMount(activeUryu, 'URYU', dateKeys);
      totalRowsAdded += resU.rowsAdded;
      totalDuplicatesSkipped += resU.dupsSkipped;
      totalFilesChecked += resU.filesChecked;
      totalToolFolders += resU.toolFoldersFound;
    }

    if (activeYokota) {
      console.log(`📂 [YOKOTA Mount Active]: ${activeYokota}`);
      const resY = await ingestBrandTodayFromMount(activeYokota, 'YOKOTA', dateKeys);
      totalRowsAdded += resY.rowsAdded;
      totalDuplicatesSkipped += resY.dupsSkipped;
      totalFilesChecked += resY.filesChecked;
      totalToolFolders += resY.toolFoldersFound;
    }
  } else {
    console.warn(`⚠️ [Mounts Inaccessible]: Neither ${URYU_MOUNT_PATH} nor ${YOKOTA_MOUNT_PATH} found.`);
  }

  const durationMs = Date.now() - startTime.getTime();
  lastSyncStats.toolFoldersFound = totalToolFolders;
  lastSyncStats.filesProcessed = totalFilesChecked;
  lastSyncStats.rowsIngested = totalRowsAdded;
  lastSyncStats.duplicatesSkipped = totalDuplicatesSkipped;
  lastSyncStats.status = 'COMPLETED';

  console.log(`✅ [Backend Today-Only Sync Completed in ${durationMs}ms]`);
  console.log(`   Today Folders Found: ${totalToolFolders} | New Files Checked: ${totalFilesChecked} | Saved to PostgreSQL: ${totalRowsAdded}`);
  console.log(`================================================================\n`);

  return {
    success: true,
    date: dateKeys.compact,
    uryuSource: activeUryu || 'NOT_MOUNTED',
    yokotaSource: activeYokota || 'NOT_MOUNTED',
    filesProcessed: totalFilesChecked,
    rowsIngested: totalRowsAdded,
    duplicatesSkipped: totalDuplicatesSkipped,
    alertsTriggered: lastSyncStats.alertsTriggered,
    durationMs
  };
}

function getCsvIngestionStatus() {
  const pg = getPostgresStatus();
  return {
    ...lastSyncStats,
    uryuPath: URYU_MOUNT_PATH,
    yokotaPath: YOKOTA_MOUNT_PATH,
    uryuUnc: URYU_UNC_SHARE,
    yokotaUnc: YOKOTA_UNC_SHARE,
    postgresServer: `${pg.host}:${pg.port}`,
    postgresDatabase: pg.database,
    postgresConnected: pg.connected,
    postgresTableReady: pg.tablesReady,
    localCacheCyclesCount: localFallbackCycles.length
  };
}

module.exports = {
  runCsvPullJob,
  resolveWrench,
  getCsvIngestionStatus,
  URYU_MOUNT_PATH,
  YOKOTA_MOUNT_PATH
};
