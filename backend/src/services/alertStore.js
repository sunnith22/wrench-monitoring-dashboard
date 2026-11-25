/**
 * Shared in-memory alert store used by ingestion, overview, and alerts routes.
 * Avoids circular imports between services and HTTP route handlers.
 */
const inMemoryAlerts = [];

function recordAlert(alertData) {
  const existing = inMemoryAlerts.find(a =>
    a.wrench_id === alertData.wrench_id &&
    a.rule_reason === (alertData.rule_reason || 'PULSE_THRESHOLD_EXCEEDED') &&
    a.status !== 'CLOSED'
  );
  if (existing) {
    existing.observed_value = alertData.observed_value;
    existing.event_time = alertData.event_time || new Date();
    return existing;
  }

  const newAlert = {
    alert_id: `ALT-${1000 + inMemoryAlerts.length + 1}`,
    wrench_id: alertData.wrench_id,
    tool_name: alertData.tool_name,
    assembly_name: alertData.assembly_name,
    sub_assembly_name: alertData.sub_assembly_name,
    station: alertData.station,
    event_time: alertData.event_time || new Date(),
    severity: alertData.severity || 'CRITICAL',
    rule_reason: alertData.rule_reason || 'PULSE_THRESHOLD_EXCEEDED',
    observed_value: alertData.observed_value,
    threshold_limit: alertData.threshold_limit,
    unit: alertData.unit || 'pulses',
    engine_number: alertData.engine_number || 'N/A',
    work_no: alertData.work_no || '1',
    status: 'OPEN',
    investigation_notes: alertData.investigation_notes || 'Automatic threshold breach alert during cycle ingestion.',
    action_taken: ''
  };
  inMemoryAlerts.unshift(newAlert);
  if (inMemoryAlerts.length > 200) inMemoryAlerts.pop();
  return newAlert;
}

module.exports = {
  inMemoryAlerts,
  recordAlert
};
