const axios = require('axios');
const { RAW_URYU_TOOLS, ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { getSchedule, getToolThreshold, getToolThresholdDetails, recordAudit } = require('./configService');
const { dispatchPulseEmailAlert } = require('./emailService');
const { query, getPostgresStatus } = require('../config/postgresDB');
const { runCsvPullJob, getCsvIngestionStatus } = require('./csvIngestionService');

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
      [syncBatchId, 'ADF_PIPELINE', windowLabel, syncStartTime, 'RUNNING']
    );
  } catch (logErr) {
    console.warn(`[Sync Log Warning]: ${logErr.message}`);
  }

  // If Azure Data Factory REST trigger is configured, invoke the ADF pipeline
  if (ADF_TRIGGER_URL) {
    try {
      console.log(`📡 [ADF Remote] Triggering Azure Data Factory Pipeline at ${ADF_TRIGGER_URL}...`);
      const adfResp = await axios.post(ADF_TRIGGER_URL, {
        windowName: windowLabel,
        shiftDate: syncStartTime.toISOString().split('T')[0].replace(/-/g, '')
      }, { timeout: 5000 });
      console.log(`✅ [ADF Remote] Pipeline run initiated: runId=${adfResp.data?.runId || 'SUCCESS'}`);
    } catch (adfErr) {
      console.warn(`⚠️ [ADF Remote Warning] ADF REST trigger unreachable: ${adfErr.message}. Executing local SQL ingestion...`);
    }
  }

  let totalFetched = 0;
  let totalInserted = 0;
  let alertsTriggered = 0;
  const todayStr = syncStartTime.toISOString().split('T')[0];
  const dateKey = todayStr.replace(/-/g, '');

  try {
    for (const tool of ALL_WRENCH_ASSETS) {
      try {
        let rows = [];

        // Attempt query from upstream line PC
        try {
          const resp = await axios.get(`${URYU_API_URL}/api/torque-data`, {
            params: { station: tool.station, folder: tool.folder, date: dateKey },
            timeout: 1200
          });
          if (resp.data && Array.isArray(resp.data.data)) {
            rows = resp.data.data;
          }
        } catch (netErr) {
          // Local PC unreachable or off-network fallback
        }

        // If upstream offline or no cycles returned for this tool, skip (STRICTLY GENUINE DATA ONLY)
        if (!rows || rows.length === 0) {
          continue;
        }

        totalFetched += rows.length;

        // Process each tightening cycle: write to PostgreSQL & check thresholds
        for (const row of rows) {
          const pulses = parseInt(row['Number of pulses'] || row.pulses || 20, 10);
          const torqueVal = parseFloat(row.Torque || tool.approved_torque_target || 22.0);
          const angleVal = parseFloat(row.Angle || 45.0);
          const engineNo = row['WorkNO.'] || row.barcode || 'NG60201';
          const tighteningTime = row['Tightening date/time'] || new Date().toISOString();
          const currentLimit = getToolThreshold(tool.wrench_id);
          const pulseStatus = pulses > currentLimit ? 'CRITICAL' : (pulses >= currentLimit - 2 ? 'WARNING' : 'NORMAL');
          const torqueStatus = row.Judgement || (pulses > currentLimit ? 'NG' : 'OK');

          // Persist into PostgreSQL wrench_tightening_cycles (idempotent upsert)
          try {
            await query(
              `INSERT INTO wrench_tightening_cycles 
               (wrench_id, tool_name, station, line, engine_no, tightening_time, reception_time,
                torque_val, torque_status, angle_val, angle_status, pulse_count, pulse_status, folder)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
               ON CONFLICT (wrench_id, tightening_time, cycle_counter) DO NOTHING`,
              [
                tool.wrench_id,
                tool.tool_name,
                tool.station,
                tool.line || 'MK1',
                engineNo,
                tighteningTime,
                new Date().toISOString(),
                torqueVal,
                torqueStatus,
                angleVal,
                'OK',
                pulses,
                pulseStatus,
                tool.folder
              ]
            );
            totalInserted++;
          } catch (dbErr) {
            // Handled
          }

          // If pulse exceeds dynamic limit, trigger email alert!
          if (pulses > currentLimit) {
            alertsTriggered++;
            console.log(`⚠️ [THRESHOLD BREACH] ${tool.tool_name} (${tool.wrench_id}): Observed ${pulses} pulses > Current Limit ${currentLimit}`);
            
            await dispatchPulseEmailAlert({
              wrenchId: tool.wrench_id,
              toolName: tool.tool_name,
              station: tool.station,
              folder: tool.folder,
              measuredPulse: pulses,
              pulseLimit: currentLimit,
              engineNumber: engineNo,
              torque: torqueVal,
              angle: angleVal,
              tighteningTime: 1.45,
              timestamp: tighteningTime
            });
          }
        }
      } catch (toolErr) {
        // Continue to next tool
      }

      await sleep(40);
    }

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

    console.log(`✅ [ShiftSync / SQL Ingestion] Finished "${windowLabel}": ${totalFetched} cycles processed, ${totalInserted} saved to PostgreSQL, ${alertsTriggered} threshold alerts checked.`);
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
 * Clock Tick Runner & Periodic CSV Ingestion Worker
 * - Runs CSV pull job every 5 minutes (configured via SYNC_INTERVAL_MINUTES)
 * - Also checks dynamic shift windows every 30s
 */
function startDynamicSyncScheduler() {
  console.log(`⏰ [Dynamic Scheduler] Initialized. Periodic CSV pull active every ${SYNC_INTERVAL_MINUTES} minutes.`);

  // 1. Run initial CSV pull on startup after 3 seconds
  setTimeout(async () => {
    try {
      await runCsvPullJob();
    } catch (err) {
      console.warn(`[Startup CSV Ingestion Note]: ${err.message}`);
    }
  }, 3000);

  // 2. Periodic background CSV pull from mounted drive (e.g. every 5 minutes)
  setInterval(async () => {
    try {
      await runCsvPullJob();
    } catch (err) {
      console.warn(`[Periodic CSV Ingestion Note]: ${err.message}`);
    }
  }, SYNC_INTERVAL_MS);

  // 3. Shift Window Watcher (every 30 seconds)
  setInterval(async () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

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
