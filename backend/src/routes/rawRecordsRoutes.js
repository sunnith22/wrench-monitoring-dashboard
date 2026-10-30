const express = require('express');
const router = express.Router();
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { fetchWrenchOperations } = require('../services/dataIngestionService');

/**
 * GET /api/data/records - Paginated Raw Operation Records Explorer
 */
router.get('/', async (req, res) => {
  try {
    const { wrench_id, assembly, page = 1, limit = 25, search, date } = req.query;

    let targetWrenches = [...ALL_WRENCH_ASSETS];
    if (wrench_id && wrench_id !== 'ALL') {
      targetWrenches = targetWrenches.filter(w => w.wrench_id === wrench_id);
    } else if (assembly && assembly !== 'ALL') {
      targetWrenches = targetWrenches.filter(w => w.assembly_id === assembly || w.assembly_name === assembly);
    } else {
      targetWrenches = targetWrenches.slice(0, 5); // Default sample 5 wrenches for raw view
    }

    let allRecords = [];
    for (const wrench of targetWrenches) {
      const records = await fetchWrenchOperations(wrench, date);
      allRecords.push(...records);
    }

    if (search) {
      const q = search.toLowerCase();
      allRecords = allRecords.filter(r =>
        r.record_key.toLowerCase().includes(q) ||
        r.engine_number.toLowerCase().includes(q) ||
        r.wrench_id.toLowerCase().includes(q) ||
        r.tool_name.toLowerCase().includes(q) ||
        r.judgement.toLowerCase().includes(q)
      );
    }

    // Sort descending by timestamp
    allRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const totalRecords = allRecords.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = allRecords.slice(startIndex, startIndex + limitNum);

    res.json({
      success: true,
      total_count: totalRecords,
      current_page: pageNum,
      total_pages: Math.ceil(totalRecords / limitNum),
      data: paginated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
