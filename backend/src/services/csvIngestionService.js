/**
 * ==============================================================================
 * TOYOTA INDUSTRIES ENGINE INDIA (TIEI)
 * TNGA Impact Wrench Monitoring & Telemetry Infrastructure
 * Module: Multi-Vendor Local PC CSV Ingestion Service (URYU & YOKOTA)
 * ==============================================================================
 * Purpose:
 *   Periodically pulls tightening cycle data from the mounted shop-floor PC drive
 *   (e.g. Z:\ or \\172.16.105.234\DATA), automatically resolving the UEC-4800 (URYU)
 *   and YOKOTA directory layouts:
 *     - URYU:   <Mount>/<FolderNum>/UEC-4800/<YYYYMMDD>/*.csv
 *     - YOKOTA: <Mount>/<FolderNum>/120_0_100_<Num>/<YYYYMMDD>/*.csv
 *   
 *   Supports both:
 *     1. Summary CSV files (F-Data_*.csv) with "Number of pulses" column
 *     2. Individual cycle CSVs (<Timestamp>.csv) with Row 3 "Final: ... Puls <N> Trq <T>"
 *   
 *   Inserts parsed cycles into PostgreSQL on 10.82.126.44 (clubbing new with old)
 *   targeting strictly today's date folder to guarantee ZERO system hanging.
 * ==============================================================================
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { query, localFallbackCycles, getPostgresStatus } = require('../config/postgresDB');
const { getToolThreshold } = require('./configService');
const { dispatchPulseEmailAlert } = require('./emailService');

// Configured mounted drive root (e.g., Z:\ or \\172.16.105.234\DATA)
const DATA_MOUNT_PATH = process.env.DATA_MOUNT_PATH || 'Z:\\';

// Track processed files and line offsets to prevent redundant re-reading
const fileLineTracker = new Map();
const processedIndividualFiles = new Set();

// In-Memory live sync metrics
let lastSyncStats = {
  lastRunTimestamp: null,
  mountPath: DATA_MOUNT_PATH,
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
 * e.g. "20261116" (Standard UEC-4800/Yokota date folder) and "16-11-2026"
 */
function getDateKeys(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return {
    compact: `${yyyy}${mm}${dd}`,          // "20261116" (UEC-4800 / Yokota standard)
    dashes: `${dd}-${mm}-${yyyy}`,          // "16-11-2026"
    iso: `${yyyy}-${mm}-${dd}`             // "2026-11-16"
  };
}

/**
 * Resolves a Wrench Asset from folder number, controller IP, or filename
 * Handles the plant mapping:
 *   - Folder "029" (Station 46) -> URYU_ST46_F029 (Controller IP .24)
 *   - Folder "019" (Station 46) -> URYU_ST46_F019 (Controller IP .25)
 *   - Folder "0103" (Station 53) -> YOKOTA_ST53_F0103 (Controller IP .103)
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

  // 3. Filename token match (e.g. "F-Data_ST28_016.csv" or "0103_120_0_100_103_*.csv")
  const upperFile = fileName.toUpperCase();
  for (const tool of ALL_WRENCH_ASSETS) {
    if (upperFile.includes(tool.wrench_id.toUpperCase())) return tool;
    if (tool.folder && upperFile.includes(String(tool.folder))) return tool;
  }

  return null;
}

/**
 * Parses individual cycle curve CSV file (e.g., 20261114053505904.csv)
 * Structure seen in plant:
 *   Line 1: @Ang_V3@ data= 139 Interval= 10 ProgNo= 1a2
 *   Line 2: FreeRun: Time 0.77 Deg 3639 Trq 5.2
 *   Line 3: Final: Time 0.6 Deg 9 Puls 17 Trq 7
 *   Line 4+: Curve points (Trq, Deg)
 */
async function parseIndividualCycleFile(filePath, fileName) {
  try {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let lineIndex = 0;
    let finalRowData = null;

    for await (const line of rl) {
      lineIndex++;
      const trimmed = line.trim();

      // Look for the "Final:" summary row on Line 3 (or anywhere in first 5 lines)
      if (lineIndex <= 5 && (trimmed.startsWith('Final:') || trimmed.includes('Puls') || trimmed.includes('Pulse'))) {
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
          break;
        }
      }

      if (lineIndex > 5) break;
    }

    rl.close();

    if (!finalRowData) return null;

    // Parse timestamp from filename: YYYYMMDDhhmmssfff.csv -> "YYYY-MM-DD hh:mm:ss"
    let tighteningTime = new Date().toISOString();
    const baseName = path.basename(fileName, path.extname(fileName));
    const timeMatch = baseName.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (timeMatch) {
      tighteningTime = `${timeMatch[1]}-${timeMatch[2]}-${timeMatch[3]} ${timeMatch[4]}:${timeMatch[5]}:${timeMatch[6]}`;
    }

    return {
      tighteningTime,
      receptionTime: tighteningTime,
      workNo: '1',
      pulseCount: finalRowData.pulse || 0,
      torque: finalRowData.torque || 0,
      angle: finalRowData.angle || 0,
      judgement: 'OK',
      cycleCounter: parseInt(baseName.slice(-6) || '1', 10) || 1
    };
  } catch (err) {
    return null;
  }
}

/**
 * Parses summary CSV file (e.g., F-Data*.csv or multi-row tabular CSV)
 * Reads line 4 headers: "Tightening date/time", "BARCODE", "WorkNO.", "Count", "Torque", "Angle", "Number of pulses"
 */
async function parseSummaryCsvFile(filePath) {
  const lastLineRead = fileLineTracker.get(filePath) || 0;
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
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
 * Seamlessly clubs new rows with historical data with zero duplication.
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
      // 1. Insert into PostgreSQL
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

      // 2. Also keep resilient local fallback cache updated
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

      // 3. Threshold alert dispatch
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
 * Discovers root data directories under mount path
 * e.g. D:\DATA-28mar, Z:\DATA-28mar, Z:\AppData, or Z:\ directly
 */
async function discoverRootDirectories(baseMountPath) {
  const roots = [baseMountPath];

  try {
    const entries = await fsp.readdir(baseMountPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('$')) {
        const lower = entry.name.toLowerCase();
        if (lower.startsWith('data') || lower.startsWith('appdata') || lower.includes('wrench')) {
          roots.push(path.join(baseMountPath, entry.name));
        }
      }
    }
  } catch (err) {
    // Handled
  }

  return [...new Set(roots)];
}

/**
 * Main Pull Routine:
 * Scans today's date directory across all tool folders on the mounted local PC drive.
 * Reads both URYU and YOKOTA formats and clubs new data into PostgreSQL on 10.82.126.44.
 */
async function runCsvPullJob(customMountPath = null) {
  const mountRoot = customMountPath || DATA_MOUNT_PATH;
  const startTime = new Date();
  const dateKeys = getDateKeys(startTime);

  console.log(`\n================================================================`);
  console.log(`📥 [CSV Ingestion Job] Pulling shop-floor cycles for date: ${dateKeys.compact} (${dateKeys.dashes})`);
  console.log(`   Mount Drive: '${mountRoot}' | PostgreSQL: 10.82.126.44:5432/enginetracking`);
  console.log(`================================================================`);

  lastSyncStats.status = 'RUNNING';
  lastSyncStats.lastRunTimestamp = startTime.toISOString();
  lastSyncStats.error = null;

  try {
    const mountExists = await fsp.access(mountRoot).then(() => true).catch(() => false);
    if (!mountExists) {
      const msg = `Mount drive '${mountRoot}' is currently not accessible. (Waiting for local PC network share)`;
      lastSyncStats.status = 'WAITING_MOUNT';
      lastSyncStats.error = msg;
      console.log(`ℹ️ [CSV Ingestion]: ${msg}`);
      return { success: false, reason: msg };
    }

    const searchRoots = await discoverRootDirectories(mountRoot);
    let totalRowsAdded = 0;
    let totalDuplicatesSkipped = 0;
    let totalFilesChecked = 0;
    let toolFoldersCount = 0;

    for (const rootDir of searchRoots) {
      let entries = [];
      try {
        entries = await fsp.readdir(rootDir, { withFileTypes: true });
      } catch (err) {
        continue;
      }

      // Find tool folders (e.g. "029", "019", "016", "0103", "0053", "0250", etc.)
      const folderCandidates = entries.filter(e => e.isDirectory() && /^\d+$/.test(e.name));

      for (const fEntry of folderCandidates) {
        const folderNumber = fEntry.name;
        const toolDir = path.join(rootDir, folderNumber);

        // Subfolder variations for URYU and YOKOTA:
        // 1. URYU: <folder>/UEC-4800/<YYYYMMDD>/
        // 2. YOKOTA: <folder>/120_0_100_<num>/<YYYYMMDD>/ or <folder>/<YYYYMMDD>/
        const dateSubfolders = [
          path.join(toolDir, 'UEC-4800', dateKeys.compact),
          path.join(toolDir, 'UEC-4800', dateKeys.dashes),
          path.join(toolDir, dateKeys.compact),
          path.join(toolDir, dateKeys.dashes)
        ];

        // Also check IP subdirectories like 120_0_100_*
        try {
          const subEntries = await fsp.readdir(toolDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isDirectory() && (sub.name.startsWith('120_') || sub.name.toUpperCase() === 'YOKOTA')) {
              dateSubfolders.push(path.join(toolDir, sub.name, dateKeys.compact));
              dateSubfolders.push(path.join(toolDir, sub.name, dateKeys.dashes));
            }
          }
        } catch (subErr) {}

        // Scan the active date directory
        for (const activeDateDir of dateSubfolders) {
          const dirExists = await fsp.access(activeDateDir).then(() => true).catch(() => false);
          if (!dirExists) continue;

          toolFoldersCount++;
          let files = [];
          try {
            files = await fsp.readdir(activeDateDir);
          } catch (readDirErr) {
            continue;
          }

          const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));

          for (const file of csvFiles) {
            const fullPath = path.join(activeDateDir, file);
            totalFilesChecked++;

            // Resolve tool asset
            const wrench = resolveWrench(folderNumber, null, file);
            if (!wrench) continue;

            // Check if summary CSV (F-Data*.csv) or individual cycle file (<timestamp>.csv)
            if (file.startsWith('F-Data') || file.toLowerCase().includes('summary') || file.toLowerCase().includes('tightening')) {
              const summaryRows = await parseSummaryCsvFile(fullPath);
              if (summaryRows.length > 0) {
                const { inserted, skipped } = await insertCyclesToPostgres(wrench, summaryRows);
                totalRowsAdded += inserted;
                totalDuplicatesSkipped += skipped;
                if (inserted > 0) {
                  console.log(`   -> [${wrench.wrench_id}] ${file}: +${inserted} new cycles (${skipped} clubbed).`);
                }
              }
            } else if (/^\d{8,}/.test(file)) {
              // Individual cycle CSV (e.g. 20261114053505904.csv)
              if (!processedIndividualFiles.has(fullPath)) {
                const cycle = await parseIndividualCycleFile(fullPath, file);
                processedIndividualFiles.add(fullPath);
                if (cycle) {
                  const { inserted, skipped } = await insertCyclesToPostgres(wrench, [cycle]);
                  totalRowsAdded += inserted;
                  totalDuplicatesSkipped += skipped;
                  if (inserted > 0) {
                    console.log(`   -> [${wrench.wrench_id}] ${file}: Ingested pulse=${cycle.pulseCount}, trq=${cycle.torque} N·m.`);
                  }
                }
              }
            }
          }
        }
      }
    }

    const durationMs = Date.now() - startTime.getTime();
    lastSyncStats.toolFoldersFound = toolFoldersCount;
    lastSyncStats.filesProcessed = totalFilesChecked;
    lastSyncStats.rowsIngested = totalRowsAdded;
    lastSyncStats.duplicatesSkipped = totalDuplicatesSkipped;
    lastSyncStats.status = 'COMPLETED';

    console.log(`✅ [CSV Ingestion Completed in ${durationMs}ms]`);
    console.log(`   Folders: ${toolFoldersCount} | Files: ${totalFilesChecked} | New Rows: ${totalRowsAdded} | Clubbed: ${totalDuplicatesSkipped}`);
    console.log(`================================================================\n`);

    return {
      success: true,
      toolFoldersCount,
      filesProcessed: totalFilesChecked,
      rowsIngested: totalRowsAdded,
      duplicatesSkipped: totalDuplicatesSkipped,
      durationMs
    };
  } catch (err) {
    lastSyncStats.status = 'ERROR';
    lastSyncStats.error = err.message;
    console.error(`❌ [CSV Ingestion Job Error]:`, err.message);
    return { success: false, error: err.message };
  }
}

function getCsvIngestionStatus() {
  const pg = getPostgresStatus();
  return {
    ...lastSyncStats,
    mountPath: DATA_MOUNT_PATH,
    postgresServer: `${pg.host}:${pg.port}`,
    postgresConnected: pg.connected,
    postgresTableReady: pg.tablesReady,
    localCacheCyclesCount: localFallbackCycles.length
  };
}

module.exports = {
  runCsvPullJob,
  resolveWrench,
  getCsvIngestionStatus,
  DATA_MOUNT_PATH
};
