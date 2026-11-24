/**
 * ==============================================================================
 * TOYOTA INDUSTRIES ENGINE INDIA (TIEI)
 * TNGA Impact Wrench Monitoring & Telemetry Infrastructure
 * Module: Multi-Source Shop-Floor Ingestion Service (URYU & YOKOTA)
 * ==============================================================================
 * Mount Architecture on Server 10.82.126.73:
 *   - URYU Mount:   /mnt/torque_wrench <== //172.16.105.234/D
 *   - YOKOTA Mount: /mnt/yokota        <== //172.16.105.234/c
 * 
 * Windows Fallback UNC Shares:
 *   - URYU:   \\172.16.105.234\D (or Z:\)
 *   - YOKOTA: \\172.16.105.234\c (or Y:\)
 * 
 * Upstream Server APIs:
 *   - URYU API:   http://10.82.126.73:8121/api/torque-data
 *   - YOKOTA API: http://10.82.126.73:8127/api/yokota-data
 * 
 * Target Database:
 *   - PostgreSQL on 10.82.126.44 (DB: enginetracking, Table: wrench_tightening_cycles)
 * 
 * CRITICAL SAFETY REQUIREMENT:
 *   The shop-floor PC (172.16.105.234) is an industrial PC running line operations.
 *   Our service operates in "Stealth Mode":
 *     1. Reads Line 3 only (<300 bytes) and immediately destroys the stream.
 *     2. Paces execution with 30ms sleep per file and 150ms sleep per tool.
 *     3. Only targets today's date folder (YYYYMMDD).
 *     4. Zero CPU/disk impact on the production line PC.
 * ==============================================================================
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const { exec } = require('child_process');
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { query, localFallbackCycles, getPostgresStatus } = require('../config/postgresDB');
const { getToolThreshold } = require('./configService');
const { dispatchPulseEmailAlert } = require('./emailService');

// Mount Paths (Server 10.82.126.73 mounts or Windows network shares)
const URYU_MOUNT_PATH = process.env.URYU_MOUNT_PATH || '/mnt/torque_wrench';
const YOKOTA_MOUNT_PATH = process.env.YOKOTA_MOUNT_PATH || '/mnt/yokota';
const URYU_UNC_SHARE = process.env.URYU_UNC_SHARE || '\\\\172.16.105.234\\D';
const YOKOTA_UNC_SHARE = process.env.YOKOTA_UNC_SHARE || '\\\\172.16.105.234\\c';
const FALLBACK_MOUNT = process.env.DATA_MOUNT_PATH || 'Z:\\';

// Memory trackers to prevent redundant re-reading
const fileLineTracker = new Map();
const processedIndividualFiles = new Set();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Live sync metrics
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

/**
 * Returns formatted date strings for folder matching
 * e.g. "20261116" (UEC-4800 / Yokota standard) and "16-11-2026"
 */
function getDateKeys(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return {
    compact: `${yyyy}${mm}${dd}`,          // "20261116" (Standard plant folder)
    dashes: `${dd}-${mm}-${yyyy}`,          // "16-11-2026"
    iso: `${yyyy}-${mm}-${dd}`             // "2026-11-16"
  };
}

/**
 * Checks which path exists and is accessible
 */
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

/**
 * Resolves a Wrench Asset from folder number, controller IP, or filename
 */
function resolveWrench(folderToken, ipToken = null, fileName = '') {
  const normFolder = String(folderToken || '').replace(/^0+/, '') || '0';
  const pad3 = normFolder.padStart(3, '0');
  const pad4 = normFolder.padStart(4, '0');

  // 1. Direct folder match in Master Catalog
  const byFolder = ALL_WRENCH_ASSETS.find(w => {
    const wNorm = String(w.folder || '').replace(/^0+/, '');
    return wNorm === normFolder || w.folder === pad3 || w.folder === pad4;
  });
  if (byFolder) return byFolder;

  // 2. Controller Number / IP match (last octet e.g. "24" or "103")
  if (ipToken) {
    const normIpNum = String(ipToken).replace(/^.*[._]/, '').trim();
    const byContr = ALL_WRENCH_ASSETS.find(w => String(w.contr_no) === normIpNum);
    if (byContr) return byContr;

    const byFolderFromIp = ALL_WRENCH_ASSETS.find(w => String(w.folder || '').replace(/^0+/, '') === normIpNum);
    if (byFolderFromIp) return byFolderFromIp;
  }

  // 3. Filename token match
  const upperFile = fileName.toUpperCase();
  for (const tool of ALL_WRENCH_ASSETS) {
    if (upperFile.includes(tool.wrench_id.toUpperCase())) return tool;
    if (tool.folder && upperFile.includes(String(tool.folder))) return tool;
  }

  return null;
}

/**
 * ULTRA-SAFE MICRO-READER for individual cycle files (<timestamp>.csv)
 * Reads ONLY the first 3 lines (< 300 bytes) with highWaterMark: 1024.
 * Once Line 3 ("Final: ... Puls 17 Trq 7") is parsed, it INSTANTLY destroys
 * the stream and releases the file handle. Never parses curve points.
 */
function parseIndividualCycleFileSafely(filePath, fileName) {
  return new Promise((resolve) => {
    let resolved = false;
    let fileStream = null;

    try {
      fileStream = fs.createReadStream(filePath, {
        flags: 'r',
        encoding: 'utf8',
        highWaterMark: 1024 // 1 KB max buffer
      });
    } catch (openErr) {
      return resolve(null);
    }

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

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

      let tighteningTime = new Date().toISOString();
      const baseName = path.basename(fileName, path.extname(fileName));
      const timeMatch = baseName.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (timeMatch) {
        tighteningTime = `${timeMatch[1]}-${timeMatch[2]}-${timeMatch[3]} ${timeMatch[4]}:${timeMatch[5]}:${timeMatch[6]}`;
      }

      resolve({
        tighteningTime,
        receptionTime: tighteningTime,
        workNo: '1',
        pulseCount: finalRowData.pulse || 0,
        torque: finalRowData.torque || 0,
        angle: finalRowData.angle || 0,
        judgement: 'OK',
        cycleCounter: parseInt(baseName.slice(-6) || '1', 10) || 1
      });
    });

    fileStream.on('error', () => {
      cleanup();
      resolve(null);
    });
  });
}

/**
 * Parses summary CSV file (e.g. F-Data*.csv) incrementally
 */
async function parseSummaryCsvFileSafely(filePath) {
  const lastLineRead = fileLineTracker.get(filePath) || 0;
  let fileStream = null;

  try {
    fileStream = fs.createReadStream(filePath, { flags: 'r', encoding: 'utf8', highWaterMark: 8192 });
  } catch (err) {
    return [];
  }

  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let currentLine = 0;
  let headerIndexMap = {};
  const newRows = [];

  for await (const line of rl) {
    currentLine++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (currentLine === 4) {
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

      const tighteningTime = getVal('tightening date/time', 'date/time', 'timestamp') || cols[0] || '';
      const workNo = getVal('workno.', 'work no', 'barcode') || String(currentLine - 4);
      const pulseRaw = getVal('number of pulses', 'no.of pulses', 'pulses', 'puls') || cols[3] || '0';
      const torqueRaw = getVal('torque', 'trq') || cols[4] || '0';
      const angleRaw = getVal('angle', 'deg') || cols[5] || '0';
      const judgement = (getVal('judgement', 'judgment', 'status') || 'OK').toUpperCase();
      const count = parseInt(getVal('count') || workNo || String(currentLine - 4), 10) || (currentLine - 4);

      if (tighteningTime) {
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
  }

  fileLineTracker.set(filePath, currentLine);
  return newRows;
}

/**
 * Inserts parsed cycles into PostgreSQL on 10.82.126.44
 * Uses ON CONFLICT (wrench_id, tightening_time, cycle_counter) DO NOTHING
 * Seamlessly clubs new data with old data without duplicate records.
 */
async function insertCyclesToPostgres(wrench, cycles) {
  let inserted = 0;
  let skipped = 0;

  for (const c of cycles) {
    const activeLimit = getToolThreshold(wrench.wrench_id) || wrench.default_pulse_threshold || 25;
    const pulseStatus = c.pulseCount > activeLimit
      ? 'CRITICAL'
      : (c.pulseCount >= activeLimit - 3 ? 'WARNING' : 'NORMAL');
    const torqueStatus = c.judgement === 'NG' ? 'NG' : 'OK';
    const engineNo = `ENG-${String(c.workNo || '1').padStart(4, '0')}`;

    try {
      // 1. Insert into PostgreSQL on 10.82.126.44
      const sqlRes = await query(
        `INSERT INTO wrench_tightening_cycles (
          wrench_id, tool_name, station, folder, line, engine_no,
          tightening_time, reception_time, torque_val, torque_status,
          angle_val, angle_status, pulse_count, pulse_status, cycle_counter
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        ON CONFLICT (wrench_id, tightening_time, cycle_counter) DO NOTHING
        RETURNING id;`,
        [
          wrench.wrench_id,
          wrench.tool_name,
          String(wrench.station),
          String(wrench.folder),
          wrench.line || 'MK1',
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
        ]
      );

      if (sqlRes && sqlRes.rowCount > 0) {
        inserted++;
      } else {
        skipped++;
      }

      // 2. Update local fallback cache
      const alreadyInFallback = localFallbackCycles.some(
        f => f.wrench_id === wrench.wrench_id && f.tightening_time === c.tighteningTime && f.cycle_counter === c.cycleCounter
      );
      if (!alreadyInFallback) {
        localFallbackCycles.push({
          id: localFallbackCycles.length + 1,
          wrench_id: wrench.wrench_id,
          tool_name: wrench.tool_name,
          station: String(wrench.station),
          folder: String(wrench.folder),
          line: wrench.line || 'MK1',
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

      // 3. Alert dispatch if threshold breached
      if (c.pulseCount > activeLimit) {
        try {
          await dispatchPulseEmailAlert({
            wrench_id: wrench.wrench_id,
            tool_name: wrench.tool_name,
            station: wrench.station,
            folder: wrench.folder,
            assembly_name: wrench.assembly_name,
            sub_assembly_name: wrench.sub_assembly_name,
            pulse_count: c.pulseCount,
            threshold: activeLimit,
            torque: c.torque,
            angle: c.angle,
            engine_number: engineNo,
            timestamp: c.tighteningTime
          });
          lastSyncStats.alertsTriggered++;
        } catch (alertErr) {
          console.warn(`[Alert Dispatch Warning]:`, alertErr.message);
        }
      }
    } catch (err) {
      console.warn(`[Cycle Ingestion Error for ${wrench.wrench_id}]:`, err.message);
    }
  }

  return { inserted, skipped };
}

/**
 * Discovers subdirectories under base path (e.g. DATA-28mar, AppData, etc.)
 */
async function discoverRootDirectories(basePath) {
  const roots = [basePath];
  try {
    const entries = await fsp.readdir(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('$')) {
        const lower = entry.name.toLowerCase();
        if (lower.startsWith('data') || lower.startsWith('appdata')) {
          roots.push(path.join(basePath, entry.name));
        }
      }
    }
  } catch (err) {}
  return [...new Set(roots)];
}

/**
 * Ingests files from a mount directory tree
 */
async function scanAndIngestMountRoot(mountRoot, dateKeys) {
  let rowsAdded = 0;
  let dupsSkipped = 0;
  let filesChecked = 0;
  let toolFoldersFound = 0;

  const searchRoots = await discoverRootDirectories(mountRoot);

  for (const rootDir of searchRoots) {
    let entries = [];
    try {
      entries = await fsp.readdir(rootDir, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    const folderCandidates = entries.filter(e => e.isDirectory() && /^\d+$/.test(e.name));

    for (const fEntry of folderCandidates) {
      const folderNumber = fEntry.name;
      const toolDir = path.join(rootDir, folderNumber);

      const dateSubfolders = [
        path.join(toolDir, 'UEC-4800', dateKeys.compact),
        path.join(toolDir, dateKeys.compact),
        path.join(toolDir, 'UEC-4800', dateKeys.dashes)
      ];

      // Check Yokota IP subfolder like 120_0_100_*
      try {
        const subEntries = await fsp.readdir(toolDir, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isDirectory() && (sub.name.startsWith('120_') || sub.name.toUpperCase() === 'YOKOTA')) {
            dateSubfolders.push(path.join(toolDir, sub.name, dateKeys.compact));
          }
        }
      } catch (subErr) {}

      for (const activeDateDir of dateSubfolders) {
        const dirExists = await fsp.access(activeDateDir).then(() => true).catch(() => false);
        if (!dirExists) continue;

        toolFoldersFound++;
        let files = [];
        try {
          files = await fsp.readdir(activeDateDir);
        } catch (readDirErr) {
          continue;
        }

        const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));

        for (const file of csvFiles) {
          const fullPath = path.join(activeDateDir, file);

          if (processedIndividualFiles.has(fullPath)) continue;

          filesChecked++;
          const wrench = resolveWrench(folderNumber, null, file);
          if (!wrench) continue;

          // Summary CSV
          if (file.startsWith('F-Data') || file.toLowerCase().includes('summary') || file.toLowerCase().includes('tightening')) {
            const summaryRows = await parseSummaryCsvFileSafely(fullPath);
            if (summaryRows.length > 0) {
              const { inserted, skipped } = await insertCyclesToPostgres(wrench, summaryRows);
              rowsAdded += inserted;
              dupsSkipped += skipped;
              if (inserted > 0) {
                console.log(`   -> [${wrench.wrench_id}] ${file}: +${inserted} new cycles saved.`);
              }
            }
          } else if (/^\d{8,}/.test(file)) {
            // Individual cycle CSV: read Line 3 micro-buffer
            const cycle = await parseIndividualCycleFileSafely(fullPath, file);
            processedIndividualFiles.add(fullPath);

            if (cycle) {
              const { inserted, skipped } = await insertCyclesToPostgres(wrench, [cycle]);
              rowsAdded += inserted;
              dupsSkipped += skipped;
              if (inserted > 0) {
                console.log(`   -> [${wrench.wrench_id}] ${file}: Ingested pulse=${cycle.pulseCount}, torque=${cycle.torque} N·m.`);
              }
            }

            await sleep(30);
          }
        }

        await sleep(150);
      }
    }
  }

  return { rowsAdded, dupsSkipped, filesChecked, toolFoldersFound };
}

/**
 * Main Pull Routine:
 * Reads /mnt/torque_wrench (URYU) and /mnt/yokota (YOKOTA) on server 10.82.126.73
 * Falls back to Windows UNC shares \\172.16.105.234\D & \\172.16.105.234\c if running on Windows.
 * Inserts parsed cycles directly into PostgreSQL on 10.82.126.44.
 */
async function runCsvPullJob() {
  const startTime = new Date();
  const dateKeys = getDateKeys(startTime);

  console.log(`\n================================================================`);
  console.log(`🛡️  [Stealth CSV Ingestion] Pulling shop-floor telemetry for: ${dateKeys.compact}`);
  console.log(`    Data Source: Mount Points /mnt/torque_wrench & /mnt/yokota`);
  console.log(`    Target Server: PostgreSQL on 10.82.126.44 (DB: enginetracking)`);
  console.log(`================================================================`);

  lastSyncStats.status = 'RUNNING';
  lastSyncStats.lastRunTimestamp = startTime.toISOString();
  lastSyncStats.error = null;

  // 1. Resolve active URYU mount path
  const activeUryu = await resolveAccessiblePath([URYU_MOUNT_PATH, URYU_UNC_SHARE, FALLBACK_MOUNT]);
  // 2. Resolve active YOKOTA mount path
  const activeYokota = await resolveAccessiblePath([YOKOTA_MOUNT_PATH, YOKOTA_UNC_SHARE]);

  lastSyncStats.activeUryuSource = activeUryu;
  lastSyncStats.activeYokotaSource = activeYokota;

  let totalRowsAdded = 0;
  let totalDuplicatesSkipped = 0;
  let totalFilesChecked = 0;
  let totalToolFolders = 0;

  // If filesystem mount is accessible directly
  if (activeUryu || activeYokota) {
    if (activeUryu) {
      console.log(`📂 [URYU Source Active]: ${activeUryu}`);
      const resU = await scanAndIngestMountRoot(activeUryu, dateKeys);
      totalRowsAdded += resU.rowsAdded;
      totalDuplicatesSkipped += resU.dupsSkipped;
      totalFilesChecked += resU.filesChecked;
      totalToolFolders += resU.toolFoldersFound;
    }

    if (activeYokota) {
      console.log(`📂 [YOKOTA Source Active]: ${activeYokota}`);
      const resY = await scanAndIngestMountRoot(activeYokota, dateKeys);
      totalRowsAdded += resY.rowsAdded;
      totalDuplicatesSkipped += resY.dupsSkipped;
      totalFilesChecked += resY.filesChecked;
      totalToolFolders += resY.toolFoldersFound;
    }
  } else {
    console.warn(`⚠️ [Mounts Inaccessible]: Neither ${URYU_MOUNT_PATH} nor ${YOKOTA_MOUNT_PATH} found.`);
    console.warn(`   Verify mount status using: ls -la /mnt/torque_wrench /mnt/yokota`);
  }

  const durationMs = Date.now() - startTime.getTime();
  lastSyncStats.toolFoldersFound = totalToolFolders;
  lastSyncStats.filesProcessed = totalFilesChecked;
  lastSyncStats.rowsIngested = totalRowsAdded;
  lastSyncStats.duplicatesSkipped = totalDuplicatesSkipped;
  lastSyncStats.status = 'COMPLETED';

  console.log(`✅ [Stealth CSV Ingestion Completed in ${durationMs}ms]`);
  console.log(`   Files Checked: ${totalFilesChecked} | New Saved to PostgreSQL: ${totalRowsAdded} | Clubbed: ${totalDuplicatesSkipped}`);
  console.log(`================================================================\n`);

  return {
    success: true,
    uryuSource: activeUryu || 'NOT_MOUNTED',
    yokotaSource: activeYokota || 'NOT_MOUNTED',
    filesProcessed: totalFilesChecked,
    rowsIngested: totalRowsAdded,
    duplicatesSkipped: totalDuplicatesSkipped,
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
    postgresConnected: pg.connected,
    postgresTableReady: pg.tablesReady,
    localCacheCyclesCount: localFallbackCycles.length
  };
}

// In-memory cache for fast API reads without repeating SMB disk reads
const folderApiCache = new Map();

/**
 * Directly resolves a folder path without scanning all 73 tools
 */
async function findDirectFolderDirectory(mountRoots, folderNumber, dateKeys) {
  const norm = String(folderNumber || '').replace(/^0+/, '');
  const variations = [
    folderNumber,
    norm.padStart(3, '0'),
    norm.padStart(4, '0'),
    norm
  ];

  for (const root of mountRoots) {
    if (!root) continue;
    const subRoots = [
      path.join(root, 'DATA-28mar'),
      path.join(root, 'DATA'),
      root
    ];

    for (const subRoot of subRoots) {
      for (const f of variations) {
        const toolDir = path.join(subRoot, f);
        const candidatePaths = [
          path.join(toolDir, 'UEC-4800', dateKeys.compact),
          path.join(toolDir, dateKeys.compact),
          path.join(toolDir, 'UEC-4800', dateKeys.dashes)
        ];

        for (const cPath of candidatePaths) {
          try {
            await fsp.access(cPath, fs.constants.R_OK);
            return { foundPath: cPath, folderNumber: f, rootDir: subRoot };
          } catch (e) {}
        }

        try {
          const subEntries = await fsp.readdir(toolDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isDirectory() && (sub.name.startsWith('120_') || sub.name.toUpperCase() === 'YOKOTA')) {
              const yPath = path.join(toolDir, sub.name, dateKeys.compact);
              try {
                await fsp.access(yPath, fs.constants.R_OK);
                return { foundPath: yPath, folderNumber: f, rootDir: subRoot };
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }
  }

  return null;
}

/**
 * API function: Reads and returns JSON telemetry for a single folder directly from the mount point.
 * Ultra-fast direct jump with in-memory caching.
 */
async function getFolderTelemetryDirect(folderNumber, targetDateInput = null, bypassCache = false) {
  const targetDate = targetDateInput instanceof Date
    ? targetDateInput
    : (targetDateInput ? new Date(targetDateInput) : new Date());
  const dateKeys = getDateKeys(targetDate);
  const cacheKey = `${folderNumber}_${dateKeys.compact}`;

  if (!bypassCache && folderApiCache.has(cacheKey)) {
    return {
      cached: true,
      folder: folderNumber,
      date: dateKeys.compact,
      ...folderApiCache.get(cacheKey)
    };
  }

  const activeUryu = await resolveAccessiblePath([URYU_MOUNT_PATH, URYU_UNC_SHARE, FALLBACK_MOUNT]);
  const activeYokota = await resolveAccessiblePath([YOKOTA_MOUNT_PATH, YOKOTA_UNC_SHARE]);
  const mountRoots = [activeUryu, activeYokota].filter(Boolean);

  if (mountRoots.length === 0) {
    return {
      success: false,
      error: 'No active mount points found. Check /mnt/torque_wrench and /mnt/yokota.',
      records: []
    };
  }

  const directMatch = await findDirectFolderDirectory(mountRoots, folderNumber, dateKeys);
  if (!directMatch) {
    return {
      success: false,
      message: `Folder '${folderNumber}' not found for date ${dateKeys.compact} in mount points.`,
      records: []
    };
  }

  const wrench = resolveWrench(directMatch.folderNumber);
  let files = [];
  try {
    files = await fsp.readdir(directMatch.foundPath);
  } catch (err) {
    return { success: false, error: err.message, records: [] };
  }

  const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));
  const records = [];

  for (const file of csvFiles) {
    const fullPath = path.join(directMatch.foundPath, file);
    if (file.startsWith('F-Data') || file.toLowerCase().includes('summary') || file.toLowerCase().includes('tightening')) {
      const summaryRows = await parseSummaryCsvFileSafely(fullPath);
      records.push(...summaryRows);
    } else if (/^\d{8,}/.test(file)) {
      const cycle = await parseIndividualCycleFileSafely(fullPath, file);
      if (cycle) records.push(cycle);
    }
  }

  const result = {
    success: true,
    folder: folderNumber,
    toolName: wrench?.tool_name || 'Unknown Tool',
    station: wrench?.station || 'N/A',
    date: dateKeys.compact,
    path: directMatch.foundPath,
    totalFiles: csvFiles.length,
    recordCount: records.length,
    records
  };

  folderApiCache.set(cacheKey, {
    toolName: result.toolName,
    station: result.station,
    path: result.path,
    totalFiles: result.totalFiles,
    recordCount: result.recordCount,
    records: result.records
  });

  return result;
}

/**
 * API function: Fast targeted single-folder sync directly into PostgreSQL.
 */
async function syncSingleFolder(folderNumber, targetDateInput = null) {
  const startTime = Date.now();
  const directData = await getFolderTelemetryDirect(folderNumber, targetDateInput, true);

  if (!directData.success || directData.records.length === 0) {
    return {
      success: false,
      message: directData.message || directData.error || 'No records found to sync',
      rowsAdded: 0,
      dupsSkipped: 0
    };
  }

  const wrench = resolveWrench(folderNumber);
  if (!wrench) {
    return {
      success: false,
      message: `Tool mapping not found in catalog for folder '${folderNumber}'`,
      rowsAdded: 0
    };
  }

  const { inserted, skipped } = await insertCyclesToPostgres(wrench, directData.records);
  const durationMs = Date.now() - startTime;

  return {
    success: true,
    wrench_id: wrench.wrench_id,
    tool_name: wrench.tool_name,
    station: wrench.station,
    folder: folderNumber,
    recordsChecked: directData.records.length,
    rowsAdded: inserted,
    dupsSkipped: skipped,
    durationMs
  };
}

module.exports = {
  runCsvPullJob,
  resolveWrench,
  getCsvIngestionStatus,
  getFolderTelemetryDirect,
  syncSingleFolder,
  findDirectFolderDirectory,
  URYU_MOUNT_PATH,
  YOKOTA_MOUNT_PATH
};
