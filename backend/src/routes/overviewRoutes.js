const express = require('express');
const axios = require('axios');
const router = express.Router();
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { localFallbackCycles, getPostgresStatus, query } = require('../config/postgresDB');
const { inMemoryAlerts, recordAlert } = require('../services/alertStore');
const { getLocalDateKeys, extractDateIso } = require('../utils/dateUtils');

/**
 * GET /api/dashboard/overview - Management KPIs (TODAY ONLY from PostgreSQL),
 * OK/NG Donut, Assembly Navigation Cards & Active Priority Alerts.
 */
router.get('/', async (req, res) => {
  const totalWrenches = ALL_WRENCH_ASSETS.length; // 73
  const activeWrenches = ALL_WRENCH_ASSETS.filter(w => w.status === 'ACTIVE').length;

  const assy1Tools = ALL_WRENCH_ASSETS.filter(w => w.assembly_id === 'assembly-1').length;
  const assy2Tools = ALL_WRENCH_ASSETS.filter(w => w.assembly_id === 'assembly-2').length;
  const assy3Tools = ALL_WRENCH_ASSETS.filter(w => w.assembly_id === 'assembly-3').length;

  const todayIso = getLocalDateKeys().iso;
  const pgStatus = getPostgresStatus();

  // Compute live TODAY-ONLY KPIs from PostgreSQL (or local fallback store)
  const todayLocal = localFallbackCycles.filter(c => extractDateIso(c.tightening_time) === todayIso);
  let totalOperations = todayLocal.length;
  let ngOperations = todayLocal.filter(c => c.torque_status === 'NG' || c.pulse_status === 'CRITICAL').length;
  let totalPulses = todayLocal.reduce((acc, c) => acc + (Number(c.pulse_count) || 0), 0);
  let feedSourceLabel = pgStatus.activeSource;

  if (pgStatus.connected && pgStatus.tablesReady) {
    try {
      const sqlRes = await query(
        `SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE torque_status = 'NG' OR pulse_status = 'CRITICAL') as ng_count,
          COALESCE(SUM(pulse_count), 0) as total_pulses
         FROM wrench_tightening_cycles
         WHERE (tightening_time::timestamptz AT TIME ZONE 'Asia/Kolkata')::date = $1::date;`,
        [todayIso]
      );
      if (sqlRes && sqlRes.rows && sqlRes.rows[0]) {
        totalOperations = parseInt(sqlRes.rows[0].total || 0, 10);
        ngOperations = parseInt(sqlRes.rows[0].ng_count || 0, 10);
        totalPulses = parseInt(sqlRes.rows[0].total_pulses || 0, 10);
        feedSourceLabel = `PostgreSQL (${pgStatus.database} • Today)`;
      }
    } catch (sqlErr) {
      // Fall back to todayLocal computed above
    }
  }

  // Optional external Pulse API supplement ONLY if explicitly configured in .env
  const pulseApiUrl = process.env.PULSE_API_URL;
  if (pulseApiUrl && totalOperations === 0) {
    try {
      const pulseResponse = await axios.get(pulseApiUrl, { timeout: 800 });
      const pulseData = pulseResponse.data;
      if (pulseData && typeof pulseData.totalRecords === 'number') {
        totalOperations = pulseData.totalRecords || 0;
        totalPulses = pulseData.totalPulses || 0;
        feedSourceLabel = 'External Pulse API';
      }
    } catch (err) {
      // Stay silently on PostgreSQL if optional external API is offline
    }
  }

  const okOperations = Math.max(0, totalOperations - ngOperations);
  const okPercentage = totalOperations > 0 ? Number(((okOperations / totalOperations) * 100).toFixed(1)) : 100;
  const ngPercentage = totalOperations > 0 ? Number(((ngOperations / totalOperations) * 100).toFixed(1)) : 0;

  const openAlerts = inMemoryAlerts.filter(a => a.status === 'OPEN');
  const acknowledgedAlertsCount = inMemoryAlerts.filter(a => a.status === 'ACKNOWLEDGED').length;

  const countOpenByAssembly = (assemblyName) =>
    openAlerts.filter(a => a.assembly_name === assemblyName).length;

  const assy1Open = countOpenByAssembly('Assembly 1');
  const assy2Open = countOpenByAssembly('Assembly 2');
  const assy3Open = countOpenByAssembly('Assembly 3');

  res.json({
    success: true,
    date: todayIso,
    timestamp: new Date().toISOString(),
    last_data_update: new Date().toLocaleTimeString(),
    data_feed_health: `OPTIMAL (${feedSourceLabel})`,
    database_status: pgStatus,
    kpi: {
      total_registered_wrenches: totalWrenches,
      active_wrenches: activeWrenches,
      total_operations: totalOperations,
      total_pulses: totalPulses,
      ok_count: okOperations,
      ng_count: ngOperations,
      ok_percentage: okPercentage,
      ng_percentage: ngPercentage,
      open_alerts: openAlerts.length,
      acknowledged_alerts: acknowledgedAlertsCount,
      total_alerts: inMemoryAlerts.length
    },
    judgement_donut: [
      { name: 'OK Tightenings', value: okOperations, percentage: okPercentage, color: '#10b981' },
      { name: 'NG Tightenings', value: ngOperations, percentage: ngPercentage, color: '#ef4444' }
    ],
    assembly_cards: [
      {
        id: 'assembly-1',
        name: 'Assembly 1',
        subtitle: 'Block, Head & Cam Housing Sub-Assemblies',
        tool_count: assy1Tools,
        open_alerts: assy1Open,
        status: assy1Open > 0 ? 'WARNING' : 'NORMAL',
        sub_assemblies: ['Block Sub-Assy (5)', 'Head Sub-Assy (3)', 'Cam Housing (7)']
      },
      {
        id: 'assembly-2',
        name: 'Assembly 2',
        subtitle: 'Main Engine Assembly Lines MK1, MK2, MK3',
        tool_count: assy2Tools,
        open_alerts: assy2Open,
        status: assy2Open > 0 ? 'WARNING' : 'NORMAL',
        sub_assemblies: ['MK1 (16)', 'MK2 (5)', 'MK3 (33)']
      },
      {
        id: 'assembly-3',
        name: 'Assembly 3',
        subtitle: 'Engine Testing (ET) & Sub-Part Supply (SPS)',
        tool_count: assy3Tools,
        open_alerts: assy3Open,
        status: assy3Open > 0 ? 'WARNING' : 'NORMAL',
        sub_assemblies: ['ET — Testing (1)', 'SPS — Supply (3)']
      }
    ],
    recent_alerts: inMemoryAlerts.slice(0, 5)
  });
});

module.exports = {
  router,
  inMemoryAlerts,
  recordAlert
};
