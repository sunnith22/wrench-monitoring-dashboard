const { getSchedule } = require('./configService');
const { query, getPostgresStatus } = require('../config/postgresDB');
const { runCsvPullJob, getCsvIngestionStatus } = require('./csvIngestionService');
const { getLocalDateKeys } = require('../utils/dateUtils');

const SYNC_INTERVAL_MINUTES = parseInt(process.env.SYNC_INTERVAL_MINUTES || '5', 10);
const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;

let isSyncRunning = false;
let lastSyncResult = {
  timestamp: null,
  windowName: 'None',
  totalFetched: 0,
  totalInserted: 0,
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

/**
 * Executes a TODAY-ONLY sync pass across mounted production tools,
 * writing into PostgreSQL (tnga_wrench_db) and evaluating alerts.
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

  console.log(`\n🚀 [Backend Sync] Starting today-only extraction: "${windowLabel}" [${syncBatchId}] at ${syncStartTime.toLocaleTimeString()}...`);

  try {
    await query(
      `INSERT INTO shift_sync_logs (sync_id, sync_source, window_name, start_time, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [syncBatchId, 'BACKEND_MOUNT_SYNC', windowLabel, syncStartTime, 'RUNNING']
    );
  } catch (logErr) {
    console.warn(`[Sync Log Warning]: ${logErr.message}`);
  }

  try {
    const pullResult = await runCsvPullJob();
    const totalFetched = pullResult.filesProcessed || 0;
    const totalInserted = pullResult.rowsIngested || 0;
    const alertsTriggered = pullResult.alertsTriggered || 0;

    const syncEndTime = new Date();
    lastSyncResult = {
      timestamp: syncEndTime.toISOString(),
      windowName: windowLabel,
      totalFetched,
      totalInserted,
      alertsTriggered,
      status: 'SUCCESS'
    };

    try {
      await query(
        `UPDATE shift_sync_logs 
         SET status = 'SUCCESS', end_time = $1, records_pulled = $2, records_inserted = $3 
         WHERE sync_id = $4`,
        [syncEndTime, totalFetched, totalInserted, syncBatchId]
      );
    } catch (logEndErr) {}

    console.log(`✅ [Backend Sync] Finished "${windowLabel}": ${totalFetched} today files checked, ${totalInserted} saved to PostgreSQL.`);
    return { success: true, ...lastSyncResult };
  } catch (err) {
    lastSyncResult.status = 'ERROR';
    console.error(`❌ [Backend Sync Error] Failed during ${windowLabel}:`, err.message);

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
 * Clock Tick Runner: checks every 30s against all dynamic windows in configService.
 * ZERO CONTINUOUS LOAD by default: pulls strictly during Admin Shift Windows
 * (or on SYNC_ON_STARTUP=true / ENABLE_CONTINUOUS_SYNC=true via .env).
 */
function startDynamicSyncScheduler() {
  const ENABLE_CONTINUOUS_SYNC = process.env.ENABLE_CONTINUOUS_SYNC === 'true';
  const SYNC_ON_STARTUP = process.env.SYNC_ON_STARTUP === 'true';

  if (SYNC_ON_STARTUP) {
    setTimeout(async () => {
      try {
        await runSyncPass('Startup Today-Only Sync');
      } catch (err) {
        console.warn(`[Startup Sync Warning]: ${err.message}`);
      }
    }, 3000);
  }

  if (ENABLE_CONTINUOUS_SYNC) {
    console.log(`⏰ [Dynamic Scheduler] Continuous Today-Only Pull ACTIVE every ${SYNC_INTERVAL_MINUTES} mins.`);
    setInterval(async () => {
      try {
        await runSyncPass('Periodic Interval Pull (Today)');
      } catch (err) {
        console.warn(`[Periodic Pull Warning]: ${err.message}`);
      }
    }, SYNC_INTERVAL_MS);
  } else {
    console.log(`⏰ [Dynamic Scheduler] Mode: ADMIN_SCHEDULE_ONLY (Zero continuous load on line PC).`);
    console.log(`   Today-only pulls run automatically during break windows or manual Admin trigger.`);
  }

  setInterval(async () => {
    const now = new Date();
    const todayStr = getLocalDateKeys(now).iso;

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
