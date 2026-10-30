const express = require('express');
const router = express.Router();
const { ALL_WRENCH_ASSETS, ASSEMBLIES_METADATA } = require('../data/wrenchCatalog');

/**
 * GET /api/assemblies - List all 3 assemblies with child sub-assemblies
 */
router.get('/', (req, res) => {
  const result = ASSEMBLIES_METADATA.map(assy => {
    const assyTools = ALL_WRENCH_ASSETS.filter(w => w.assembly_id === assy.id);
    return {
      ...assy,
      total_tools: assyTools.length,
      tools: assyTools
    };
  });

  res.json({
    success: true,
    data: result
  });
});

/**
 * GET /api/assemblies/:assemblyId - Drilldown for specific assembly
 */
router.get('/:assemblyId', (req, res) => {
  const { assemblyId } = req.params;
  const assy = ASSEMBLIES_METADATA.find(a => a.id === assemblyId);

  if (!assy) {
    return res.status(404).json({ success: false, message: `Assembly '${assemblyId}' not found.` });
  }

  const assyTools = ALL_WRENCH_ASSETS.filter(w => w.assembly_id === assy.id);

  // Group tools by sub-assembly
  const subAssembliesWithTools = assy.sub_assemblies.map(sub => {
    const tools = assyTools.filter(t => t.sub_assembly_id === sub.id);
    return {
      ...sub,
      tools,
      tool_count: tools.length
    };
  });

  res.json({
    success: true,
    assembly: {
      ...assy,
      total_tools: assyTools.length,
      sub_assemblies: subAssembliesWithTools
    }
  });
});

module.exports = router;
