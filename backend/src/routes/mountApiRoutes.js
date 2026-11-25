const express = require('express');
const router = express.Router();
const {
  getFolderTelemetryDirect,
  syncSingleFolder,
  getCsvIngestionStatus
} = require('../services/csvIngestionService');
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');

/**
 * GET /api/mount/status
 * Returns health, paths, and connectivity of the mounted shop-floor drives
 */
router.get('/status', (req, res) => {
  try {
    const status = getCsvIngestionStatus();
    res.json({
      success: true,
      message: 'Mount Point Telemetry API is active',
      status
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/mount/tools
 * Lists all 73 tools and their logical folder numbers for easy API querying
 */
router.get('/tools', (req, res) => {
  const tools = ALL_WRENCH_ASSETS.map(w => ({
    wrench_id: w.wrench_id,
    tool_name: w.tool_name,
    station: w.station,
    folder: w.folder,
    brand: w.brand,
    assembly_name: w.assembly_name,
    sub_assembly_name: w.sub_assembly_name,
    target_torque: w.approved_torque_target,
    default_threshold: w.default_pulse_threshold
  }));

  res.json({
    success: true,
    count: tools.length,
    tools
  });
});

/**
 * GET /api/mount/telemetry
 * Fetches JSON telemetry for a specific tool folder directly from the mount point.
 * Super fast: Jumps straight to the folder without scanning other tools.
 * Query params:
 *   - folder (required, e.g. "029" or "29" or "0103")
 *   - date (optional, YYYYMMDD or YYYY-MM-DD, defaults to today)
 *   - refresh (optional, boolean, set true to bypass in-memory cache)
 */
router.get('/telemetry', async (req, res) => {
  try {
    const { folder, date, refresh } = req.query;

    if (!folder) {
      return res.status(400).json({
        success: false,
        message: 'Query parameter "folder" is required (e.g. /api/mount/telemetry?folder=029)'
      });
    }

    const bypassCache = refresh === 'true' || refresh === '1';
    const result = await getFolderTelemetryDirect(folder, date, bypassCache);

    if (!result.success && result.records?.length === 0) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mount/sync-folder
 * Immediately ingests a single tool folder into PostgreSQL (tnga_wrench_db).
 * Fast: Only reads and writes that one tool, clubbing records without lag.
 * Body params:
 *   - folder (required, e.g. "029")
 *   - date (optional, defaults to today)
 */
router.post('/sync-folder', async (req, res) => {
  try {
    const { folder, date } = req.body;

    if (!folder) {
      return res.status(400).json({
        success: false,
        message: 'Request body must include "folder" (e.g. { "folder": "029" })'
      });
    }

    const result = await syncSingleFolder(folder, date);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
