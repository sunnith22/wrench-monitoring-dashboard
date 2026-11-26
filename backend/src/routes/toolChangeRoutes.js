const express = require('express');
const router = express.Router();
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');

// In-Memory store for real Tool Change History (starts empty; populated strictly from operator entries)
const inMemoryToolChanges = [];

/**
 * GET /api/tool-changes - List all manual tool changes
 */
router.get('/', (req, res) => {
  const { wrench_id, change_type } = req.query;

  let filtered = [...inMemoryToolChanges];

  if (wrench_id && wrench_id !== 'ALL') {
    filtered = filtered.filter(tc => tc.wrench_id === wrench_id);
  }

  if (change_type && change_type !== 'ALL') {
    filtered = filtered.filter(tc => tc.change_type === change_type);
  }

  res.json({
    success: true,
    count: filtered.length,
    data: filtered.sort((a, b) => new Date(b.change_timestamp) - new Date(a.change_timestamp))
  });
});

/**
 * POST /api/tool-changes - Record a manual tool replacement
 */
router.post('/', (req, res) => {
  try {
    const {
      wrench_id,
      pulses_at_change,
      change_type,
      removed_tool_serial,
      replacement_tool_serial,
      technician_name,
      comments
    } = req.body;

    if (!wrench_id || !pulses_at_change || !replacement_tool_serial || !technician_name) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: wrench_id, pulses_at_change, replacement_tool_serial, technician_name.'
      });
    }

    const wrench = ALL_WRENCH_ASSETS.find(w => w.wrench_id === wrench_id);
    if (!wrench) {
      return res.status(404).json({ success: false, message: `Wrench '${wrench_id}' not found in Asset Register.` });
    }

    const newRecord = {
      change_id: `TC-${new Date().getFullYear()}-${String(inMemoryToolChanges.length + 1).padStart(3, '0')}`,
      wrench_id,
      tool_name: wrench.tool_name,
      assembly_name: wrench.assembly_name,
      sub_assembly_name: wrench.sub_assembly_name,
      station: wrench.station,
      change_timestamp: new Date(),
      pulses_at_change: Number(pulses_at_change),
      change_type: change_type || 'PLANNED_THRESHOLD',
      removed_tool_serial: removed_tool_serial || wrench.tool_serial,
      replacement_tool_serial,
      technician_name,
      comments: comments || ''
    };

    // Update in-memory asset register serial & reset accumulated pulses
    wrench.tool_serial = replacement_tool_serial;
    wrench.accumulated_pulses = 0;

    inMemoryToolChanges.unshift(newRecord);

    res.status(201).json({
      success: true,
      message: `Manual tool change recorded successfully for ${wrench.tool_name} (ID: ${newRecord.change_id}).`,
      data: newRecord
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
