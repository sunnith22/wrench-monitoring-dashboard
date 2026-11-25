const axios = require('axios');
const { RAW_URYU_TOOLS, ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { getSchedule, getToolThreshold, getToolThresholdDetails, recordAudit } = require('./configService');
const { dispatchPulseEmailAlert } = require('./emailService');
const { query, getPostgresStatus } = require('../config/postgresDB');
const { runCsvPullJob, getCsvIngestionStatus } = require('./csvIngestionService');
const { getSystemDateKeys } = require('../utils/dateUtils');

const SYNC_INTERVAL_MINUTES = parseInt(process.env.SYNC_INTERVAL_MINUTES || '5', 10);
const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;

let isSyncRunning = false;
let lastSyncResult = {
  timestamp: null,
  windowName: 'None',
  totalFetched: 0,
  alertsTriggered: 0,
  status: 'IDLE'
};

const completedWindowsToday = new Set();

function isTimeInWindow(startTime, endTime, now = new Date()) {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  const curMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return curMinutes >= startMinutes && curMinutes <= endMinutes;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Executes a sync pass across production tools, writing into PostgreSQL and triggering alerts
 */
async function runSyncPass(windowLabel = 'Manual Trigger') {
  if (isSyncRunning) {
    return { success: false, message: 'A sync pass is already currently running' };
  }

  isSyncRunning = true;
  const syncStartTime = new Date();
  const syncBatchId = `SYNC_${Date.now()}`;
  lastSyncResult.status = 'RUNNING';
  lastSyncResult.windowName = windowLabel;
  lastSyncResult.timestamp = syncStartTime.toISOString();

  console.log(`\n🚀 [ShiftSync / SQL Ingestion] Starting data extraction: "${windowLabel}" [${syncBatchId}] at ${syncStartTime.toLocaleTimeString()}...`);

  // Log start in PostgreSQL shift_sync_logs
  try {
    await query(
      `INSERT INTO shift_sync_logs (sync_id, sync_source, window_name, start_time, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [syncBatchId, 'MOUNT_CSV', windowLabel, syncStartTime, 'RUNNING']
    );
  } catch (logErr) {
    console.warn(`[Sync Log Warning]: ${logErr.message}`);
  }

  let totalFetched = 0;
  let totalInserted = 0;
  let alertsTriggered = 0;

  try {
    // 1. Run the stealth CSV / Mount Ingestion Job (reading /mnt/torque_wrench & /mnt/yokota or server APIs)
    const pullResult = await runCsvPullJob();
    totalFetched = pullResult.filesProcessed || 0;
    totalInserted = pullResult.rowsIngested || 0;
    alertsTriggered = pullResult.alertsTriggered || 0;

    const syncEndTime = new Date();
    lastSyncResult = {
      timestamp: syncEndTime.toISOString(),
      windowName: windowLabel,
      totalFetched,
      totalInserted,
      alertsTriggered,
      status: 'SUCCESS'
    };

    // Update PostgreSQL shift_sync_logs
    try {
      await query(
        `UPDATE shift_sync_logs 
         SET status = 'SUCCESS', end_time = $1, records_pulled = $2, records_inserted = $3 
         WHERE sync_id = $4`,
        [syncEndTime, totalFetched, totalInserted, syncBatchId]
      );
    } catch (logEndErr) {
      // Handled
    }

    console.log(`✅ [ShiftSync / SQL Ingestion] Finished "${windowLabel}": ${totalFetched} files checked, ${totalInserted} saved to PostgreSQL.`);
    return { success: true, ...lastSyncResult };
  } catch (err) {
    lastSyncResult.status = 'ERROR';
    console.error(`❌ [ShiftSync Error] Failed during ${windowLabel}:`, err.message);

    try {
      await query(
        `UPDATE shift_sync_logs SET status = 'FAILED', error_message = $1 WHERE sync_id = $2`,
        [err.message, syncBatchId]
      );
    } catch (ignore) {}

    return { success: false, error: err.message };
  } finally {
    isSyncRunning = false;
  }
}

/**
 * Clock Tick Runner: checks every 30s against all dynamic windows in configService
 * ZERO CONTINUOUS LOAD: Pulls ONLY during Admin Shift Windows (e.g. Tea Break, Lunch)
 * or when manually triggered via Admin Portal.
 */
function startDynamicSyncScheduler() {
  const ENABLE_CONTINUOUS_SYNC = process.env.ENABLE_CONTINUOUS_SYNC === 'true';

  if (ENABLE_CONTINUOUS_SYNC) {
    console.log(`⏰ [Dynamic Scheduler] Continuous Pull ACTIVE every ${SYNC_INTERVAL_MINUTES} mins.`);
    setInterval(async () => {
      try {
        await runSyncPass('Periodic Interval Pull');
      } catch (err) {
        console.warn(`[Periodic Pull Warning]: ${err.message}`);
      }
    }, SYNC_INTERVAL_MS);
  } else {
    console.log(`⏰ [Dynamic Scheduler] Mode: ADMIN_SCHEDULE_ONLY (Zero continuous load).`);
    console.log(`   Pulls will execute ONLY during Admin Shift Windows (e.g. Tea Break, Lunch) or on manual trigger.`);
  }

  // Shift Window Watcher: checks every 30 seconds against Admin Portal schedule
  setInterval(async () => {
    const now = new Date();
    const todayStr = getSystemDateKeys(now).iso;

    // Reset daily executed window cache at midnight
    if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 30) {
      completedWindowsToday.clear();
    }

    const activeSchedule = getSchedule();

    for (const win of activeSchedule) {
      if (!win.enabled) continue;

      const windowKey = `${todayStr}_${win.id}`;
      if (isTimeInWindow(win.startTime, win.endTime, now) && !completedWindowsToday.has(windowKey)) {
        completedWindowsToday.add(windowKey);
        await runSyncPass(`${win.name} (${win.startTime} - ${win.endTime})`);
        break;
      }
    }
  }, 30000);
}

function getSyncStatus() {
  return {
    isRunning: isSyncRunning,
    lastSync: lastSyncResult,
    csvIngestion: getCsvIngestionStatus(),
    completedWindowsCountToday: completedWindowsToday.size,
    sqlStatus: getPostgresStatus()
  };
}

module.exports = {
  startDynamicSyncScheduler,
  runSyncPass,
  getSyncStatus
};
