const express = require('express');
const router = express.Router();
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { fetchWrenchOperations } = require('../services/dataIngestionService');
const { calculateWrenchAnalytics } = require('../services/analyticsService');
const { getToolThreshold, getToolThresholdDetails } = require('../services/configService');

/**
 * GET /api/wrenches - Master Asset Register list (73 tools)
 */
router.get('/', (req, res) => {
  const { assembly, sub_assembly, brand, search } = req.query;

  let filtered = ALL_WRENCH_ASSETS.map(w => ({
    ...w,
    default_pulse_threshold: getToolThreshold(w.wrench_id),
    pulse_threshold_details: getToolThresholdDetails(w.wrench_id)
  }));

  if (assembly && assembly !== 'ALL') {
    filtered = filtered.filter(w => w.assembly_id === assembly || w.assembly_name === assembly);
  }

  if (sub_assembly && sub_assembly !== 'ALL') {
    filtered = filtered.filter(w => w.sub_assembly_id === sub_assembly || w.sub_assembly_name === sub_assembly);
  }

  if (brand && brand !== 'ALL') {
    filtered = filtered.filter(w => w.brand.toUpperCase() === brand.toUpperCase());
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(w =>
      w.wrench_id.toLowerCase().includes(q) ||
      w.tool_name.toLowerCase().includes(q) ||
      String(w.station).toLowerCase().includes(q) ||
      String(w.folder).includes(q) ||
      w.tool_serial.toLowerCase().includes(q)
    );
  }

  res.json({
    success: true,
    count: filtered.length,
    data: filtered
  });
});

/**
 * GET /api/wrenches/:wrenchId - Deep-Dive Individual Wrench Telemetry & Analytics
 */
router.get('/:wrenchId', async (req, res) => {
  try {
    const { wrenchId } = req.params;
    const { date } = req.query;

    const baseWrench = ALL_WRENCH_ASSETS.find(w => w.wrench_id === wrenchId);
    if (!baseWrench) {
      return res.status(404).json({
        success: false,
        message: `Wrench '${wrenchId}' not found in TNGA Asset Register.`
      });
    }

    // Retrieve live dynamic threshold configured by Admin
    const activeThreshold = getToolThreshold(baseWrench.wrench_id);
    const wrench = {
      ...baseWrench,
      default_pulse_threshold: activeThreshold,
      pulse_threshold_details: getToolThresholdDetails(baseWrench.wrench_id)
    };

    // Ingest tightening operations
    const rawRecords = await fetchWrenchOperations(wrench, date);

    // Calculate statistical metrics using the dynamic threshold
    const analytics = calculateWrenchAnalytics(rawRecords, activeThreshold);

    res.json({
      success: true,
      wrench,
      analytics,
      recent_operations: rawRecords.slice(-15).reverse()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
