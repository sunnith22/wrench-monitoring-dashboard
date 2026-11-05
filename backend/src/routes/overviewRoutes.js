const express = require('express');
const router = express.Router();
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { localFallbackCycles, getPostgresStatus } = require('../config/postgresDB');

// In-Memory store for active alert records (starts clean for live shift)
const inMemoryAlerts = [];

/**
 * GET /api/dashboard/overview - Management KPIs, OK/NG Donut, Assembly Health & Feed Status
 */
router.get('/', (req, res) => {
  const totalWrenches = ALL_WRENCH_ASSETS.length; // 73
  const activeWrenches = ALL_WRENCH_ASSETS.filter(w => w.status === 'ACTIVE').length;

  // Assembly Tool Counts
  const assy1Tools = ALL_WRENCH_ASSETS.filter(w => w.assembly_id === 'assembly-1').length;
  const assy2Tools = ALL_WRENCH_ASSETS.filter(w => w.assembly_id === 'assembly-2').length;
  const assy3Tools = ALL_WRENCH_ASSETS.filter(w => w.assembly_id === 'assembly-3').length;

  // Calculate live dynamic counts strictly from real ingested operations
  const totalOperations = localFallbackCycles.length;
  const ngOperations = localFallbackCycles.filter(c => c.torque_status === 'NG' || c.pulse_status === 'CRITICAL').length;
  const okOperations = Math.max(0, totalOperations - ngOperations);
  const okPercentage = totalOperations > 0 ? Number(((okOperations / totalOperations) * 100).toFixed(1)) : 100;
  const ngPercentage = totalOperations > 0 ? Number(((ngOperations / totalOperations) * 100).toFixed(1)) : 0;

  const openAlertsCount = inMemoryAlerts.filter(a => a.status === 'OPEN').length;
  const acknowledgedAlertsCount = inMemoryAlerts.filter(a => a.status === 'ACKNOWLEDGED').length;

  const pgStatus = getPostgresStatus();

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    last_data_update: new Date().toLocaleTimeString(),
    data_feed_health: `OPTIMAL (${pgStatus.activeSource})`,
    database_status: pgStatus,
    kpi: {
      total_registered_wrenches: totalWrenches,
      active_wrenches: activeWrenches,
      total_operations: totalOperations,
      ok_count: okOperations,
      ng_count: ngOperations,
      ok_percentage: okPercentage,
      ng_percentage: ngPercentage,
      open_alerts: openAlertsCount,
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
        open_alerts: 0,
        status: 'NORMAL',
        sub_assemblies: ['Block Sub-Assy (5)', 'Head Sub-Assy (3)', 'Cam Housing (7)']
      },
      {
        id: 'assembly-2',
        name: 'Assembly 2',
        subtitle: 'Main Engine Assembly Lines MK1, MK2, MK3',
        tool_count: assy2Tools,
        open_alerts: 1,
        status: 'WARNING',
        sub_assemblies: ['MK1 (16)', 'MK2 (5)', 'MK3 (33)']
      },
      {
        id: 'assembly-3',
        name: 'Assembly 3',
        subtitle: 'Engine Testing (ET) & Sub-Part Supply (SPS)',
        tool_count: assy3Tools,
        open_alerts: 0,
        status: 'NORMAL',
        sub_assemblies: ['ET — Testing (1)', 'SPS — Supply (3)']
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
