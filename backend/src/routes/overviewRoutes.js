const express = require('express');
const router = express.Router();
const { ALL_WRENCH_ASSETS, ASSEMBLIES_METADATA } = require('../data/wrenchCatalog');
const { localFallbackCycles, getPostgresStatus, query } = require('../config/postgresDB');
const { getSystemDateKeys, extractDateIso } = require('../utils/dateUtils');

// In-Memory store for active alert records (starts empty; populated strictly from real breaches)
const inMemoryAlerts = [];

/**
 * GET /api/dashboard/overview - Management KPIs, OK/NG Donut, Assembly Health & Feed Status
 */
router.get('/', async (req, res) => {
  const totalWrenches = ALL_WRENCH_ASSETS.length;
  const activeWrenches = ALL_WRENCH_ASSETS.filter(w => w.status === 'ACTIVE').length;
  const uryuCount = ALL_WRENCH_ASSETS.filter(w => w.brand === 'URYU').length;
  const yokotaCount = ALL_WRENCH_ASSETS.filter(w => w.brand === 'YOKOTA').length;

  const todayIso = getSystemDateKeys().iso;
  const pgStatus = getPostgresStatus();
  const isPgLive = pgStatus.connected && pgStatus.tablesReady;

  let totalOperations = 0;
  let totalPulses = 0;
  let ngOperations = 0;
  let okOperations = 0;
  let dataFeedHealth = isPgLive ? 'PostgreSQL Live' : 'Local Store Ready';

  if (isPgLive) {
    try {
      const sqlRes = await query(
        `SELECT
           COUNT(*)::int AS total_operations,
           COALESCE(SUM(pulse_count), 0)::bigint AS total_pulses,
           COUNT(*) FILTER (
             WHERE UPPER(COALESCE(torque_status, 'OK')) = 'NG'
                OR UPPER(COALESCE(pulse_status, 'NORMAL')) = 'CRITICAL'
           )::int AS ng_count
         FROM wrench_tightening_cycles
         WHERE TO_CHAR(tightening_time::timestamptz, 'YYYY-MM-DD') = $1;`,
        [todayIso]
      );

      if (sqlRes && sqlRes.rows && sqlRes.rows.length > 0) {
        const row = sqlRes.rows[0];
        totalOperations = Number(row.total_operations || 0);
        totalPulses = Number(row.total_pulses || 0);
        ngOperations = Number(row.ng_count || 0);
        okOperations = Math.max(0, totalOperations - ngOperations);
      }
    } catch (err) {
      dataFeedHealth = 'Local Store Fallback';
    }
  }

  if (!isPgLive || dataFeedHealth === 'Local Store Fallback') {
    const todayRows = localFallbackCycles.filter(r => extractDateIso(r.tightening_time) === todayIso);
    totalOperations = todayRows.length;
    totalPulses = todayRows.reduce((acc, r) => acc + Number(r.pulse_count || 0), 0);
    ngOperations = todayRows.filter(
      r => String(r.torque_status || '').toUpperCase() === 'NG' || String(r.pulse_status || '').toUpperCase() === 'CRITICAL'
    ).length;
    okOperations = Math.max(0, totalOperations - ngOperations);
  }

  const okPercentage = totalOperations > 0
    ? Number(((okOperations / totalOperations) * 100).toFixed(1))
    : 0;
  const ngPercentage = totalOperations > 0
    ? Number(((ngOperations / totalOperations) * 100).toFixed(1))
    : 0;

  const openAlertsCount = inMemoryAlerts.filter(a => a.status === 'OPEN').length;
  const acknowledgedAlertsCount = inMemoryAlerts.filter(a => a.status === 'ACKNOWLEDGED').length;

  const assemblyCards = ASSEMBLIES_METADATA.map(assy => {
    const assyTools = ALL_WRENCH_ASSETS.filter(w => w.assembly_id === assy.id);
    const openAssyAlerts = inMemoryAlerts.filter(
      a => a.assembly_name === assy.name && a.status !== 'CLOSED'
    ).length;

    return {
      id: assy.id,
      name: assy.name,
      subtitle: assy.description,
      tool_count: assyTools.length,
      sub_assemblies: assy.sub_assemblies.map(s => s.name),
      open_alerts: openAssyAlerts
    };
  });

  res.json({
    success: true,
    date: todayIso,
    timestamp: new Date().toISOString(),
    last_data_update: new Date().toLocaleTimeString(),
    data_feed_health: totalOperations > 0 ? dataFeedHealth : 'Awaiting Live Sync',
    database_status: pgStatus,

    kpi: {
      total_registered_wrenches: totalWrenches,
      active_wrenches: activeWrenches,
      uryu_count: uryuCount,
      yokota_count: yokotaCount,

      total_operations: totalOperations,
      total_pulses: totalPulses,

      ok_count: okOperations,
      ng_count: ngOperations,

      ok_percentage: okPercentage,
      ng_percentage: ngPercentage,

      open_alerts: openAlertsCount,
      acknowledged_alerts: acknowledgedAlertsCount,
      total_alerts: inMemoryAlerts.length
    },

    judgement_donut: [
      {
        name: 'OK Tightenings',
        value: okOperations,
        percentage: okPercentage,
        color: '#10b981'
      },
      {
        name: 'NG Tightenings',
        value: ngOperations,
        percentage: ngPercentage,
        color: '#ef4444'
      }
    ],

    assembly_cards: assemblyCards,
    recent_alerts: inMemoryAlerts.filter(a => a.status !== 'CLOSED').slice(0, 5)
  });
});

function recordAlert(alertData) {
  const existing = inMemoryAlerts.find(a =>
    a.wrench_id === alertData.wrench_id &&
    a.rule_reason === alertData.rule_reason &&
    a.status !== 'CLOSED'
  );
  if (!existing) {
    const newAlert = {
      alert_id: `ALT-${1000 + inMemoryAlerts.length + 1}`,
      wrench_id: alertData.wrench_id,
      tool_name: alertData.tool_name,
      assembly_name: alertData.assembly_name,
      sub_assembly_name: alertData.sub_assembly_name,
      station: alertData.station,
      event_time: alertData.event_time || new Date(),
      severity: alertData.severity || 'CRITICAL',
      rule_reason: alertData.rule_reason || 'CONSECUTIVE_PULSE_BREACH',
      observed_value: alertData.observed_value,
      threshold_limit: alertData.threshold_limit,
      unit: alertData.unit || 'pulses',
      engine_number: alertData.engine_number || 'N/A',
      work_no: alertData.work_no || '1',
      status: 'OPEN',
      investigation_notes: alertData.investigation_notes || 'Automatic predictive alert: Sustained consecutive pulse limit breach detected.',
      action_taken: ''
    };
    inMemoryAlerts.unshift(newAlert);
    return newAlert;
  }
  // Keep latest measurement visible on active unclosed alert
  existing.observed_value = alertData.observed_value;
  existing.threshold_limit = alertData.threshold_limit;
  existing.engine_number = alertData.engine_number || existing.engine_number;
  existing.event_time = alertData.event_time || existing.event_time;
  return existing;
}

module.exports = {
  router,
  inMemoryAlerts,
  recordAlert
};
