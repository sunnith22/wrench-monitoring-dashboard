const express = require('express');
const router = express.Router();
const { inMemoryAlerts } = require('./overviewRoutes');

/**
 * GET /api/alerts - Persistent Alert Tracker & Filter
 */
router.get('/', (req, res) => {
  const { status, severity, assembly, wrench_id } = req.query;

  let filtered = [...inMemoryAlerts];

  if (status && status !== 'ALL') {
    filtered = filtered.filter(a => a.status === status);
  }

  if (severity && severity !== 'ALL') {
    filtered = filtered.filter(a => a.severity === severity);
  }

  if (assembly && assembly !== 'ALL') {
    filtered = filtered.filter(a => a.assembly_name === assembly);
  }

  if (wrench_id && wrench_id !== 'ALL') {
    filtered = filtered.filter(a => a.wrench_id === wrench_id);
  }

  // Calculate distributions for charts
  const severityCounts = {
    CRITICAL: filtered.filter(a => a.severity === 'CRITICAL').length,
    WARNING: filtered.filter(a => a.severity === 'WARNING').length,
    INFO: filtered.filter(a => a.severity === 'INFO').length
  };

  const statusCounts = {
    OPEN: filtered.filter(a => a.status === 'OPEN').length,
    ACKNOWLEDGED: filtered.filter(a => a.status === 'ACKNOWLEDGED').length,
    INVESTIGATING: filtered.filter(a => a.status === 'INVESTIGATING').length,
    CLOSED: filtered.filter(a => a.status === 'CLOSED').length
  };

  res.json({
    success: true,
    total_count: filtered.length,
    severity_distribution: severityCounts,
    status_distribution: statusCounts,
    data: filtered.sort((a, b) => new Date(b.event_time) - new Date(a.event_time))
  });
});

/**
 * PATCH /api/alerts/:alertId/status - Update Alert Lifecycle State
 */
router.patch('/:alertId/status', (req, res) => {
  const { alertId } = req.params;
  const { status, user_name, investigation_notes, action_taken } = req.body;

  const alert = inMemoryAlerts.find(a => a.alert_id === alertId);
  if (!alert) {
    return res.status(404).json({ success: false, message: `Alert '${alertId}' not found.` });
  }

  if (status) {
    alert.status = status;
  }

  if (status === 'ACKNOWLEDGED') {
    alert.acknowledged_by = user_name || 'Line Supervisor';
    alert.acknowledged_at = new Date();
  }

  if (status === 'CLOSED') {
    alert.closed_by = user_name || 'Maintenance Lead';
    alert.closed_at = new Date();
    alert.action_taken = action_taken || 'Tool inspected and verified';
  }

  if (investigation_notes) {
    alert.investigation_notes = investigation_notes;
  }

  res.json({
    success: true,
    message: `Alert '${alertId}' updated to status '${alert.status}'.`,
    data: alert
  });
});

module.exports = router;
