/**
 * ==============================================================================
 * TOYOTA INDUSTRIES ENGINE INDIA (TIEI)
 * TNGA Impact Wrench Monitoring & Telemetry Infrastructure
 * Module: Local PC Mounted CSV Ingestion Service
 * ==============================================================================
 * Purpose:
 *   Periodically pulls tightening cycle data from CSV files stored in daily
 *   date folders (e.g. '14-11-2026') on a mounted local PC drive (e.g. Z:\ or \\PC-IP\Share).
 *   Inserts the parsed cycles into PostgreSQL on 10.82.126.44 (clubbing new with old)
 *   without re-scanning historical folders to guarantee ZERO system hanging or freezing.
 * ==============================================================================
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { query, localFallbackCycles, getPostgresStatus } = require('../config/postgresDB');
const { getToolThreshold, recordAudit } = require('./configService');
const { dispatchPulseEmailAlert } = require('./emailService');

// Configured mounted drive root (e.g., Z:\ or \\10.82.126.xx\share)
const DATA_MOUNT_PATH = process.env.DATA_MOUNT_PATH || 'Z:\\';

// In-Memory tracker for processed file line offsets to prevent redundant re-reading
// Key: filePath -> lastProcessedLineIndex
const fileLineTracker = new Map();

// Sync metrics
let lastSyncStats = {
  lastRunTimestamp: null,
  folderScanned: null,
  filesProcessed: 0,
  rowsIngested: 0,
  duplicatesSkipped: 0,
  alertsTriggered: 0,
  status: 'IDLE',
  error: null
};

/**
 * Returns formatted date string in DD-MM-YYYY (e.g. "14-11-2026")
 */
function getTodayDateString(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Finds today's active date folder on the mounted drive.
 * CRUCIAL FOR PERFORMANCE:
 * Only checks today's date folder (e.g. '14-11-2026').
 * Does NOT iterate through all past days, eliminating network SMB latency and freezing!
 */
async function locateTodayFolder(baseMountPath = DATA_MOUNT_PATH, customDateStr = null) {
  const targetDateStr = customDateStr || getTodayDateString();
  
  // Potential date folder naming variations
  const candidateNames = [
    targetDateStr,                                  // "14-11-2026" (User standard)
    targetDateStr.replace(/-/g, '_'),              // "14_11_2026"
    targetDateStr.replace(/-/g, '.'),              // "14.11.2026"
    new Date().toISOString().split('T')[0]         // "2026-11-14" (ISO)
  ];

  try {
    const exists = await fsp.access(baseMountPath).then(() => true).catch(() => false);
    if (!exists) {
      return {
        exists: false,
        error: `Mount drive '${baseMountPath}' is not accessible or not mounted yet.`
      };
    }

    for (const name of candidateNames) {
      const candidatePath = path.join(baseMountPath, name);
      const isDir = await fsp.stat(candidatePath).then(s => s.isDirectory()).catch(() => false);
      if (isDir) {
        return { exists: true, folderPath: candidatePath, folderName: name };
      }
    }

    return {
      exists: false,
      error: `Today's date folder ('${targetDateStr}') not found in '${baseMountPath}'.`
    };
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

/**
 * Resolves which Wrench Asset a CSV file belongs to based on its filename or internal folder code
 */
function matchWrenchAsset(fileName, folderNumber = null) {
  const cleanName = path.basename(fileName, path.extname(fileName)).toUpperCase();

  // 1. Direct wrench_id match
  const direct = ALL_WRENCH_ASSETS.find(w => cleanName.includes(w.wrench_id.toUpperCase()));
  if (direct) return direct;

  // 2. Folder match (e.g. folder "016", "0102", "0250")
  if (folderNumber) {
    const padFolder = String(folderNumber).padStart(3, '0');
    const byFolder = ALL_WRENCH_ASSETS.find(w => String(w.folder).padStart(3, '0') === padFolder);
    if (byFolder) return byFolder;
  }

  // 3. Station and Folder from filename regex (e.g., F-Data_ST28_016.csv or ST28_016.csv)
  const stMatch = cleanName.match(/ST(?:ATION)?[-_]?([0-9A-Z]+)[-_]([0-9]+)/i);
  if (stMatch) {
    const station = stMatch[1];
    const folder = stMatch[2];
    const match = ALL_WRENCH_ASSETS.find(w => 
      String(w.station).toUpperCase() === station.toUpperCase() && 
      (String(w.folder) === folder || String(w.folder).padStart(3, '0') === folder.padStart(3, '0'))
    );
    if (match) return match;
  }

  // 4. Fallback search by station or folder token
  for (const tool of ALL_WRENCH_ASSETS) {
    if (tool.folder && cleanName.includes(String(tool.folder))) {
      return tool;
    }
  }

  return null;
}

/**
 * Streams and parses a shop-floor CSV file line-by-line using native readline (fast, 0 overhead).
 * Shop-Floor UEC-4800 / URYU / YOKOTA Format:
 *   Line 1: Empty or Title
 *   Line 2: Machine model (e.g. "UEC-4800")
 *   Line 3: Save date/time
 *   Line 4: Column Headers ("Tightening date/time","WorkNO.","Number of pulses","Torque","Angle","Judgement",...)
 *   Line 5+: Tightening Cycle Rows
 */
async function parseCsvFileIncrementally(filePath) {
  const stats = await fsp.stat(filePath);
  const lastLineRead = fileLineTracker.get(filePath) || 0;

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let currentLine = 0;
  let headers = [];
  let headerIndexMap = {};
  const newRows = [];

  for await (const line of rl) {
    currentLine++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Header is on Line 4
    if (currentLine === 4) {
      headers = trimmed.split(',').map(h => h.replace(/^"|"$/g, '').trim());
      headers.forEach((h, idx) => {
        headerIndexMap[h] = idx;
      });
      continue;
    }

    // Process only lines after the previously processed line count
    if (currentLine > 4 && currentLine > lastLineRead) {
      const cols = trimmed.split(',').map(c => c.replace(/^"|"$/g, '').trim());
      
      const tighteningTime = cols[headerIndexMap['Tightening date/time']] || cols[0] || '';
      const receptionTime = cols[headerIndexMap['Reception date/time']] || tighteningTime;
      const workNo = cols[headerIndexMap['WorkNO.']] || cols[1] || String(currentLine - 4);
      const pulseCount = parseInt(cols[headerIndexMap['Number of pulses']] || cols[3] || '0', 10);
      const torque = parseFloat(cols[headerIndexMap['Torque']] || cols[4] || '0');
      const angle = parseFloat(cols[headerIndexMap['Angle']] || cols[5] || '0');
      const judgement = (cols[headerIndexMap['Judgement']] || cols[6] || 'OK').toUpperCase();
      const count = parseInt(cols[headerIndexMap['Count']] || workNo || String(currentLine - 4), 10);

      if (tighteningTime) {
        newRows.push({
          tighteningTime,
          receptionTime,
          workNo,
          pulseCount,
          torque,
          angle,
          judgement,
          cycleCounter: count
        });
      }
    }
  }

  // Update line tracker for this file
  fileLineTracker.set(filePath, currentLine);

  return { newRows, totalLines: currentLine };
}

/**
 * Inserts parsed tightening cycles into PostgreSQL on 10.82.126.44.
 * Uses ON CONFLICT (wrench_id, tightening_time, cycle_counter) DO NOTHING
 * to seamlessly club new data with old data without duplicate records.
 */
async function insertCyclesToPostgres(wrench, cycles) {
  let inserted = 0;
  let skipped = 0;

  for (const c of cycles) {
    const pulseStatus = c.pulseCount > (wrench.default_pulse_threshold || 25)
      ? 'CRITICAL'
      : (c.pulseCount >= (wrench.default_pulse_threshold || 25) - 3 ? 'WARNING' : 'NORMAL');
    const torqueStatus = c.judgement === 'NG' ? 'NG' : 'OK';
    const angleStatus = 'OK';
    const engineNo = `ENG-${c.workNo.padStart(4, '0')}`;

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
          angleStatus,
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

      // 2. Also keep resilient localFallbackCycles up to date
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
          angle_status: angleStatus,
          pulse_count: c.pulseCount,
          pulse_status: pulseStatus,
          cycle_counter: c.cycleCounter,
          created_at: new Date().toISOString()
        });
      }

      // 3. Trigger Email Alert if threshold is exceeded
      const activeThreshold = getToolThreshold(wrench.wrench_id) || wrench.default_pulse_threshold;
      if (c.pulseCount > activeThreshold) {
        try {
          await dispatchPulseEmailAlert({
            wrench_id: wrench.wrench_id,
            tool_name: wrench.tool_name,
            station: wrench.station,
            folder: wrench.folder,
            assembly_name: wrench.assembly_name,
            sub_assembly_name: wrench.sub_assembly_name,
            pulse_count: c.pulseCount,
            threshold: activeThreshold,
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
 * Main Pull Routine:
 * Periodically pulls data from the mounted local PC drive, targeting ONLY today's date folder.
 * Seamlessly clubs new rows into PostgreSQL on 10.82.126.44 without duplicates.
 */
async function runCsvPullJob(customMountPath = null, customDate = null) {
  const mountRoot = customMountPath || DATA_MOUNT_PATH;
  const startTime = new Date();
  
  console.log(`\n================================================================`);
  console.log(`📥 [CSV Ingestion Job] Checking mounted PC drive: '${mountRoot}'`);
  console.log(`   Target Server: PostgreSQL on 10.82.126.44 (DB: enginetracking)`);
  console.log(`================================================================`);

  lastSyncStats.status = 'RUNNING';
  lastSyncStats.lastRunTimestamp = startTime.toISOString();
  lastSyncStats.error = null;

  const folderLoc = await locateTodayFolder(mountRoot, customDate);
  if (!folderLoc.exists) {
    lastSyncStats.status = 'WAITING_MOUNT';
    lastSyncStats.error = folderLoc.error;
    console.log(`ℹ️ [CSV Ingestion Note]: ${folderLoc.error}`);
    console.log(`   (Waiting for local PC drive to be mounted or today's folder to appear)`);
    return { success: false, reason: folderLoc.error };
  }

  const folderPath = folderLoc.folderPath;
  lastSyncStats.folderScanned = folderPath;
  console.log(`📂 [CSV Ingestion] Active daily folder found: ${folderPath}`);

  try {
    const dirEntries = await fsp.readdir(folderPath, { withFileTypes: true });
    const csvFiles = dirEntries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.csv'));

    console.log(`📄 [CSV Ingestion] Found ${csvFiles.length} CSV files in today's folder.`);

    let totalRowsIngested = 0;
    let totalDuplicatesSkipped = 0;
    let filesProcessed = 0;

    for (const file of csvFiles) {
      const fullFilePath = path.join(folderPath, file.name);
      
      // Resolve wrench asset
      const wrench = matchWrenchAsset(file.name);
      if (!wrench) {
        // Skip unmapped files
        continue;
      }

      filesProcessed++;
      const { newRows } = await parseCsvFileIncrementally(fullFilePath);

      if (newRows.length > 0) {
        const { inserted, skipped } = await insertCyclesToPostgres(wrench, newRows);
        totalRowsIngested += inserted;
        totalDuplicatesSkipped += skipped;
        console.log(`   -> [${wrench.wrench_id}] ${file.name}: +${inserted} new cycles ingested (${skipped} existing/clubbed).`);
      }
    }

    lastSyncStats.filesProcessed = filesProcessed;
    lastSyncStats.rowsIngested = totalRowsIngested;
    lastSyncStats.duplicatesSkipped = totalDuplicatesSkipped;
    lastSyncStats.status = 'COMPLETED';

    const durationMs = Date.now() - startTime.getTime();
    console.log(`✅ [CSV Ingestion Completed in ${durationMs}ms]`);
    console.log(`   Files Checked: ${filesProcessed} | New Rows Added: ${totalRowsIngested} | Clubbed: ${totalDuplicatesSkipped}`);
    console.log(`================================================================\n`);

    return {
      success: true,
      folder: folderPath,
      filesProcessed,
      rowsIngested: totalRowsIngested,
      duplicatesSkipped: totalDuplicatesSkipped,
      durationMs
    };
  } catch (err) {
    lastSyncStats.status = 'ERROR';
    lastSyncStats.error = err.message;
    console.error(`❌ [CSV Ingestion Error]:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Returns the current live sync metrics and mount status
 */
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
  locateTodayFolder,
  getCsvIngestionStatus,
  DATA_MOUNT_PATH
};
