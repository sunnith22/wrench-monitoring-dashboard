const express = require('express');
const axios = require('axios');
const router = express.Router();
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { localFallbackCycles, getPostgresStatus, query } = require('../config/postgresDB');

// In-Memory store for active alert records (starts clean for live shift)
const inMemoryAlerts = [];

/**
 * GET /api/dashboard/overview - Management KPIs, OK/NG Donut, Assembly Health & Feed Status
 */

router.get('/', async (req, res) => {

  const totalWrenches = ALL_WRENCH_ASSETS.length;
  const activeWrenches = ALL_WRENCH_ASSETS.filter(
    w => w.status === 'ACTIVE'
  ).length;

  const assy1Tools = ALL_WRENCH_ASSETS.filter(
    w => w.assembly_id === 'assembly-1'
  ).length;

  const assy2Tools = ALL_WRENCH_ASSETS.filter(
    w => w.assembly_id === 'assembly-2'
  ).length;

  const assy3Tools = ALL_WRENCH_ASSETS.filter(
    w => w.assembly_id === 'assembly-3'
  ).length;

  let totalOperations = 0;
  let totalPulses = 0;
  let ngOperations = 0;
  let okOperations = 0;
  let okPercentage = 0;
  let ngPercentage = 0;

  try {

    const pulseResponse = await axios.get(
      'http://localhost:9000/api/today-pulse-all'
    );

    const pulseData = pulseResponse.data;

    totalOperations = pulseData.totalRecords || 0;
    totalPulses = pulseData.totalPulses || 0;

    okOperations = totalOperations;
    ngOperations = 0;

    okPercentage =
      totalOperations > 0 ? 100 : 0;

    ngPercentage = 0;

  } catch (err) {

    console.error(
      'Pulse API unavailable:',
      err.message
    );

  }

  const pgStatus = getPostgresStatus();

  const openAlertsCount =
    inMemoryAlerts.filter(
      a => a.status === 'OPEN'
    ).length;

  const acknowledgedAlertsCount =
    inMemoryAlerts.filter(
      a => a.status === 'ACKNOWLEDGED'
    ).length;

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    last_data_update: new Date().toLocaleTimeString(),
    data_feed_health: 'Pulse API Live',
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

    recent_alerts: inMemoryAlerts.slice(0, 5)
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
      rule_reason: alertData.rule_reason || 'INCREASING_PULSE_TREND',
      observed_value: alertData.observed_value,
      threshold_limit: alertData.threshold_limit,
      unit: alertData.unit || 'pulses/day',
      engine_number: alertData.engine_number || 'N/A',
      work_no: alertData.work_no || '1',
      status: 'OPEN',
      investigation_notes: alertData.investigation_notes || 'Automatic predictive alert: Sustained daily pulse increase detected.',
      action_taken: ''
    };
    inMemoryAlerts.unshift(newAlert);
    return newAlert;
  }
  return existing;
}

module.exports = {
  router,
  inMemoryAlerts,
  recordAlert
};
