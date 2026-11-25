const crypto = require('crypto');
const { query, localFallbackCycles } = require('../config/postgresDB');
const { getLocalDateKeys, extractDateIso } = require('../utils/dateUtils');

/**
 * Generate a unique deterministic composite key for deduplication
 */
function generateRecordKey(wrenchId, timestamp, engineNo, workNo) {
  const raw = `${wrenchId}_${timestamp}_${engineNo}_${workNo}`;
  return crypto.createHash('md5').update(raw).digest('hex').substring(0, 16);
}

/**
 * Cache live shop-floor records into local memory store so dashboard overview is fast
 */
function cacheLiveRecords(records) {
  if (!records || records.length === 0) return;
  for (const rec of records) {
    const exists = localFallbackCycles.some(c => c.wrench_id === rec.wrench_id && c.tightening_time === rec.timestamp);
    if (!exists) {
      localFallbackCycles.push({
        id: localFallbackCycles.length + 1,
        wrench_id: rec.wrench_id,
        tool_name: rec.tool_name,
        station: rec.station,
        line: rec.line || 'MK1',
        engine_no: rec.engine_number,
        tightening_time: rec.timestamp,
        reception_time: rec.reception_timestamp || rec.timestamp,
        torque_val: rec.torque,
        torque_status: rec.judgement,
        angle_val: rec.angle,
        angle_status: 'OK',
        pulse_count: rec.pulse_count,
        pulse_status: rec.judgement === 'NG' ? 'CRITICAL' : 'NORMAL',
        cycle_counter: localFallbackCycles.length + 1,
        folder: rec.folder,
        created_at: new Date().toISOString()
      });
    }
  }
}

/**
 * Fetch tightening data for a given wrench asset and calendar date (defaults to TODAY only):
 * Tier 1: Query PostgreSQL `wrench_tightening_cycles` on 10.82.126.44 (filtered strictly by date)
 * Tier 2: Check local in-memory live store (`localFallbackCycles`)
 */
async function fetchWrenchOperations(wrenchAsset, dateStr) {
  const targetDate = dateStr || getLocalDateKeys().iso;

  // 1. Try PostgreSQL on 10.82.126.44 FIRST (central source of truth, date-filtered)
  try {
    const sqlRes = await query(
      `SELECT * FROM wrench_tightening_cycles 
       WHERE (wrench_id = $1 OR (station = $2 AND folder = $3))
         AND (tightening_time::timestamptz AT TIME ZONE 'Asia/Kolkata')::date = $4::date
       ORDER BY tightening_time ASC`,
      [wrenchAsset.wrench_id, wrenchAsset.station, wrenchAsset.folder, targetDate]
    );

    if (sqlRes && sqlRes.rows && sqlRes.rows.length > 0) {
      return sqlRes.rows.map(row => ({
        record_key: `${row.wrench_id}_${row.tightening_time}_${row.engine_no}`,
        wrench_id: row.wrench_id,
        tool_name: row.tool_name || wrenchAsset.tool_name,
        assembly_name: wrenchAsset.assembly_name,
        sub_assembly_name: wrenchAsset.sub_assembly_name,
        station: row.station,
        folder: row.folder,
        brand: wrenchAsset.brand,
        timestamp: row.tightening_time instanceof Date ? row.tightening_time.toISOString() : String(row.tightening_time),
        reception_timestamp: row.reception_time || row.tightening_time,
        work_no: String(row.cycle_counter || 1),
        engine_number: row.engine_no,
        barcode: `${row.engine_no}-TNGA`,
        pulse_count: Number(row.pulse_count),
        torque: Number(row.torque_val),
        torque_unit: 'N·m',
        angle: Number(row.angle_val),
        angle_unit: 'deg',
        tightening_time: 1.45,
        time_unit: 'sec',
        judgement: row.torque_status || 'OK',
        import_status: 'VALIDATED'
      }));
    }
  } catch (sqlErr) {
    // Continue to local store fallback
  }

  // 2. Check cached live records in local store (strictly filtered to targetDate)
  const cached = localFallbackCycles.filter(
    c => (c.wrench_id === wrenchAsset.wrench_id || (c.station === wrenchAsset.station && c.folder === wrenchAsset.folder)) &&
         extractDateIso(c.tightening_time) === targetDate
  );
  if (cached.length > 0) {
    return cached.map(row => ({
      record_key: `${row.wrench_id}_${row.tightening_time}_${row.engine_no}`,
      wrench_id: row.wrench_id,
      tool_name: row.tool_name || wrenchAsset.tool_name,
      assembly_name: wrenchAsset.assembly_name,
      sub_assembly_name: wrenchAsset.sub_assembly_name,
      station: row.station,
      folder: row.folder,
      brand: wrenchAsset.brand,
      timestamp: row.tightening_time,
      reception_timestamp: row.reception_time || row.tightening_time,
      work_no: String(row.cycle_counter || 1),
      engine_number: row.engine_no,
      barcode: `${row.engine_no}-TNGA`,
      pulse_count: Number(row.pulse_count),
      torque: Number(row.torque_val),
      torque_unit: 'N·m',
      angle: Number(row.angle_val),
      angle_unit: 'deg',
      tightening_time: 1.45,
      time_unit: 'sec',
      judgement: row.torque_status || 'OK',
      import_status: 'VALIDATED'
    }));
  }

  // 3. Return empty array if no genuine records found in PostgreSQL or local cache
  return [];
}

/**
 * Normalizes raw vendor records into standard TNGA schema
 */
function normalizeRecords(rawRows, wrenchAsset, dateStr) {
  return rawRows.map((row, idx) => {
    const timestamp = row['Tightening date/time'] || row['Reception date/time'] || row.datetime || row.timestamp || `${dateStr} 08:${String(idx).padStart(2, '0')}:00`;
    const engineNo = row['WorkNO.'] || row.work_no || row.barcode || row.EngineNo || `NG60${100 + idx}`;
    const workNo = String(row['Count'] || row.count || row.work_no || row.WorkNo || '1');
    const pulseCount = parseInt(row['Number of pulses'] || row.number_of_pulses || row.pulses || row.unknownValue3 || 20, 10);
    const torque = parseFloat(row.Torque || row.torque || wrenchAsset.approved_torque_target || 20.0);
    const angle = parseFloat(row.Angle || row.angle || 45.0);
    const duration = parseFloat(row['Tightening time'] || row.tightening_time || row.duration || wrenchAsset.tightening_time_target || 1.45);
    const judgement = row.Judgement || row.judgement || (pulseCount > wrenchAsset.default_pulse_threshold ? 'NG_PULSE' : 'OK');

    return {
      record_key: generateRecordKey(wrenchAsset.wrench_id, timestamp, engineNo, workNo),
      wrench_id: wrenchAsset.wrench_id,
      tool_name: wrenchAsset.tool_name,
      assembly_name: wrenchAsset.assembly_name,
      sub_assembly_name: wrenchAsset.sub_assembly_name,
      station: wrenchAsset.station,
      folder: wrenchAsset.folder,
      brand: wrenchAsset.brand,
      timestamp,
      reception_timestamp: timestamp,
      work_no: workNo,
      engine_number: engineNo,
      barcode: `${engineNo}-TNGA-A25A`,
      pulse_count: pulseCount,
      torque: Number(torque.toFixed(2)),
      torque_unit: 'N·m',
      angle: Number(angle.toFixed(1)),
      angle_unit: 'deg',
      torque_angle: Number((angle * 0.95).toFixed(1)),
      tightening_time: Number(duration.toFixed(2)),
      time_unit: 'sec',
      judgement: judgement.toUpperCase().includes('NG') ? 'NG' : 'OK',
      axis_mount_count: 1,
      source_file: `F-Data_ST${wrenchAsset.station}_${dateStr.replace(/-/g, '')}.csv`,
      import_status: 'LIVE_SHOP_FLOOR'
    };
  });
}

/**
 * High-fidelity plant operations generator for offline / demonstration mode
 */
function generatePlantOperations(wrenchAsset, dateStr) {
  const records = [];
  const cycleCount = 38;
  const baseThreshold = wrenchAsset.default_pulse_threshold || 24;
  const nominalMean = baseThreshold - 4.5;
  const targetTorque = wrenchAsset.approved_torque_target || 22.0;

  for (let i = 0; i < cycleCount; i++) {
    const hour = Math.floor(8 + (i * 12) / 60);
    const minute = Math.floor((i * 12) % 60);
    const second = Math.floor((i * 37) % 60);
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
    const timestamp = `${dateStr} ${timeStr}`;
    const engineNo = `NG60${200 + i}`;
    const workNo = "1";

    let pulseCount;
    if (i === 16) {
      pulseCount = baseThreshold + 4; // Critical spike
    } else if (i === 31) {
      pulseCount = baseThreshold + 2; // Warning spike
    } else {
      const variation = Math.round((Math.sin(i / 3) * 1.8) + (Math.random() * 2.2 - 1.1));
      pulseCount = Math.max(12, Math.round(nominalMean + variation));
    }

    const torque = targetTorque + (Math.sin(i / 2) * 0.8) + (Math.random() * 0.6 - 0.3);
    const angle = 45.0 + (pulseCount * 1.2) + (Math.random() * 3.0 - 1.5);
    const duration = (wrenchAsset.tightening_time_target || 1.45) + (pulseCount > baseThreshold ? 0.45 : (Math.random() * 0.2 - 0.1));
    const judgement = pulseCount > baseThreshold ? 'NG' : 'OK';

    records.push({
      record_key: generateRecordKey(wrenchAsset.wrench_id, timestamp, engineNo, workNo),
      wrench_id: wrenchAsset.wrench_id,
      tool_name: wrenchAsset.tool_name,
      assembly_name: wrenchAsset.assembly_name,
      sub_assembly_name: wrenchAsset.sub_assembly_name,
      station: wrenchAsset.station,
      folder: wrenchAsset.folder,
      brand: wrenchAsset.brand,
      timestamp,
      reception_timestamp: timestamp,
      work_no: workNo,
      engine_number: engineNo,
      barcode: `${engineNo}-TNGA-A25A`,
      pulse_count: pulseCount,
      torque: Number(torque.toFixed(2)),
      torque_unit: 'N·m',
      angle: Number(angle.toFixed(1)),
      angle_unit: 'deg',
      torque_angle: Number((angle * 0.94).toFixed(1)),
      tightening_time: Number(duration.toFixed(2)),
      time_unit: 'sec',
      judgement,
      axis_mount_count: 1,
      source_file: `F-Data_ST${wrenchAsset.station}_${dateStr.replace(/-/g, '')}.csv`,
      import_status: 'VALIDATED'
    });
  }

  return records;
}

module.exports = {
  fetchWrenchOperations,
  generateRecordKey,
  generatePlantOperations
};
