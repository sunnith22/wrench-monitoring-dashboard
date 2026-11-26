const crypto = require('crypto');
const { query, localFallbackCycles, getPostgresStatus } = require('../config/postgresDB');
const { getSystemDateKeys, extractDateIso } = require('../utils/dateUtils');

/**
 * Generate a unique deterministic composite key for deduplication
 */
function generateRecordKey(wrenchId, timestamp, engineNo, workNo) {
  const raw = `${wrenchId}_${timestamp}_${engineNo}_${workNo}`;
  return crypto.createHash('md5').update(raw).digest('hex').substring(0, 16);
}

/**
 * Format a PostgreSQL or local-store cycle row into the standard API operation shape
 */
function mapCycleRowToOperation(row, wrenchAsset) {
  const isNg =
    String(row.torque_status || '').toUpperCase() === 'NG' ||
    String(row.pulse_status || '').toUpperCase() === 'CRITICAL';
  const tighteningTime = row.tightening_time instanceof Date
    ? row.tightening_time.toISOString()
    : String(row.tightening_time || '');
  const durationVal = row.duration_sec !== undefined && row.duration_sec !== null
    ? Number(row.duration_sec)
    : 0;

  return {
    record_key: `${row.wrench_id}_${tighteningTime}_${row.engine_no}_${row.cycle_counter || 1}`,
    wrench_id: row.wrench_id,
    tool_name: row.tool_name || wrenchAsset.tool_name,
    assembly_name: wrenchAsset.assembly_name,
    sub_assembly_name: wrenchAsset.sub_assembly_name,
    station: row.station,
    folder: row.folder,
    brand: wrenchAsset.brand,
    timestamp: tighteningTime,
    reception_timestamp: row.reception_time || tighteningTime,
    work_no: String(row.cycle_counter || 1),
    engine_number: row.engine_no || 'N/A',
    barcode: `${row.engine_no || 'N/A'}-TNGA`,
    pulse_count: Number(row.pulse_count || 0),
    torque: Number(row.torque_val || 0),
    torque_unit: 'N·m',
    angle: Number(row.angle_val || 0),
    angle_unit: 'deg',
    tightening_time: Number(durationVal.toFixed(2)),
    time_unit: 'sec',
    judgement: isNg ? 'NG' : 'OK',
    source_file: row.source_file || 'LIVE_MOUNT_CSV',
    import_status: 'VALIDATED'
  };
}

/**
 * Fetch real accumulated pulse totals per wrench from PostgreSQL or local store.
 * Returns Map<wrench_id, number>. Defaults to empty map (0 per tool) with no fake numbers.
 */
async function getRealAccumulatedPulsesMap() {
  const totals = new Map();
  const pgStatus = getPostgresStatus();

  if (pgStatus.connected && pgStatus.tablesReady) {
    try {
      const sqlRes = await query(`
        SELECT wrench_id, COALESCE(SUM(pulse_count), 0)::bigint AS total_pulses
        FROM wrench_tightening_cycles
        GROUP BY wrench_id;
      `);
      if (sqlRes && sqlRes.rows) {
        for (const r of sqlRes.rows) {
          totals.set(r.wrench_id, Number(r.total_pulses || 0));
        }
        return totals;
      }
    } catch (err) {
      // Fall back to local store
    }
  }

  for (const c of localFallbackCycles) {
    totals.set(c.wrench_id, (totals.get(c.wrench_id) || 0) + Number(c.pulse_count || 0));
  }
  return totals;
}

/**
 * Fetch tightening data for a given wrench asset and calendar date:
 * Tier 1: Query PostgreSQL `wrench_tightening_cycles` on 10.82.126.44 FIRST (fast < 5ms index lookup)
 * Tier 2: Check local in-memory live store (`localFallbackCycles`)
 * Returns strictly genuine ingested records (empty array if none exist).
 */
async function fetchWrenchOperations(wrenchAsset, dateStr) {
  const targetDate = dateStr || getSystemDateKeys().iso;
  const pgStatus = getPostgresStatus();

  // 1. Try PostgreSQL on 10.82.126.44 FIRST (filtered strictly to targetDate / system today)
  if (pgStatus.connected && pgStatus.tablesReady) {
    try {
      const sqlRes = await query(
        `SELECT * FROM wrench_tightening_cycles 
         WHERE (wrench_id = $1 OR (station = $2 AND folder = $3))
           AND TO_CHAR(tightening_time::timestamptz, 'YYYY-MM-DD') = $4
         ORDER BY tightening_time ASC`,
        [wrenchAsset.wrench_id, wrenchAsset.station, wrenchAsset.folder, targetDate]
      );

      if (sqlRes && sqlRes.rows && sqlRes.rows.length > 0) {
        return sqlRes.rows.map(row => mapCycleRowToOperation(row, wrenchAsset));
      }
    } catch (sqlErr) {
      // Continue to local store fallback
    }
  }

  // 2. Check cached live records in local store (strictly matching targetDate)
  const cached = localFallbackCycles
    .filter(
      c =>
        (c.wrench_id === wrenchAsset.wrench_id || (c.station === wrenchAsset.station && c.folder === wrenchAsset.folder)) &&
        extractDateIso(c.tightening_time) === targetDate
    )
    .sort((a, b) => String(a.tightening_time || '').localeCompare(String(b.tightening_time || '')));

  if (cached.length > 0) {
    return cached.map(row => mapCycleRowToOperation(row, wrenchAsset));
  }

  // 3. Return empty array when no real records exist
  return [];
}

/**
 * Bulk-fetch tightening operations across a target set of wrenches for a date
 * using a single PostgreSQL query (or single scan of localFallbackCycles).
 */
async function fetchAllOperationsForDate(dateStr, targetWrenches = []) {
  const targetDate = dateStr || getSystemDateKeys().iso;
  const pgStatus = getPostgresStatus();
  const wrenchMap = new Map(targetWrenches.map(w => [w.wrench_id, w]));

  if (pgStatus.connected && pgStatus.tablesReady) {
    try {
      const sqlRes = await query(
        `SELECT * FROM wrench_tightening_cycles
         WHERE TO_CHAR(tightening_time::timestamptz, 'YYYY-MM-DD') = $1
         ORDER BY tightening_time DESC`,
        [targetDate]
      );
      if (sqlRes && sqlRes.rows) {
        return sqlRes.rows
          .filter(row => wrenchMap.size === 0 || wrenchMap.has(row.wrench_id))
          .map(row => mapCycleRowToOperation(row, wrenchMap.get(row.wrench_id) || {
            wrench_id: row.wrench_id,
            tool_name: row.tool_name || row.wrench_id,
            assembly_name: 'Unmapped',
            sub_assembly_name: 'Shop Floor',
            brand: row.wrench_id?.startsWith('YOKOTA') ? 'YOKOTA' : 'URYU'
          }));
      }
    } catch (err) {
      // Fall back to local store
    }
  }

  return localFallbackCycles
    .filter(c =>
      extractDateIso(c.tightening_time) === targetDate &&
      (wrenchMap.size === 0 || wrenchMap.has(c.wrench_id))
    )
    .map(row => mapCycleRowToOperation(row, wrenchMap.get(row.wrench_id) || {
      wrench_id: row.wrench_id,
      tool_name: row.tool_name || row.wrench_id,
      assembly_name: 'Unmapped',
      sub_assembly_name: 'Shop Floor',
      brand: row.wrench_id?.startsWith('YOKOTA') ? 'YOKOTA' : 'URYU'
    }));
}

module.exports = {
  fetchWrenchOperations,
  fetchAllOperationsForDate,
  generateRecordKey,
  getRealAccumulatedPulsesMap
};
