const express = require('express');
const router = express.Router();
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { recordAlert } = require('./overviewRoutes');

/**
 * Helper to generate multi-day daily average pulse trend
 * Exactly matches predictive maintenance behavior:
 * - Days 1 to 4: progressive pulse increase
 * - Day 4.5 / 5: Increasing Trend Alert triggered & recorded in Alert Tracker
 * - Day 5: Tool Changed milestone (serial reset)
 * - Days 6 to 8: pulse count drops back down to nominal baseline
 */
function generateDailyPulseTrend(wrench, daysCount = 8) {
  const threshold = wrench.default_pulse_threshold || 25;
  const nominalBase = threshold - 7.5; // e.g. 17.5 pulses
  const points = [];

  const today = new Date();
  const toolChangeDay = Math.min(5, Math.ceil(daysCount * 0.6)); // Day 5 for 8 days
  const alertDay = toolChangeDay - 1; // Day 4 for 8 days

  let activeSerial = 'SN-URYU-48190';
  const newSerial = wrench.tool_serial || 'SN-URYU-48202';

  for (let i = 1; i <= daysCount; i++) {
    const dayDate = new Date(today);
    dayDate.setDate(today.getDate() - (daysCount - i));
    const dateStr = dayDate.toISOString().split('T')[0];
    const dateDisplay = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    let avgPulse = 0;
    let isAlertPoint = false;
    let alertLabel = null;
    let isToolChanged = false;
    let toolChangeLabel = null;
    let status = 'NORMAL';

    if (i < toolChangeDay) {
      // Ascending degradation curve up to alert/threshold
      const stepIncrease = ((threshold + 1.8 - nominalBase) / (toolChangeDay - 1)) * (i - 1);
      avgPulse = Number((nominalBase + stepIncrease + (Math.sin(i) * 0.25)).toFixed(1));

      if (i >= alertDay) {
        isAlertPoint = true;
        alertLabel = 'Increasing trend alert';
        status = 'WARNING';
      }
    } else if (i === toolChangeDay) {
      // Peak day: threshold breached and tool replaced
      avgPulse = Number((threshold + 1.8).toFixed(1));
      isAlertPoint = true;
      alertLabel = 'Threshold limit exceeded';
      isToolChanged = true;
      toolChangeLabel = `Tool changed (${activeSerial} → ${newSerial})`;
      activeSerial = newSerial;
      status = 'CRITICAL';

      // Automatically record in Alert Tracker if alert point reached
      recordAlert({
        wrench_id: wrench.wrench_id,
        tool_name: wrench.tool_name,
        assembly_name: wrench.assembly_name,
        sub_assembly_name: wrench.sub_assembly_name,
        station: wrench.station,
        event_time: dayDate,
        severity: 'CRITICAL',
        rule_reason: 'INCREASING_PULSE_TREND',
        observed_value: avgPulse,
        threshold_limit: threshold,
        unit: 'avg pulses/day',
        engine_number: `NG60${240 + i}`,
        investigation_notes: `Day ${i}: Sustained upward pulse degradation trend detected (${avgPulse} pulses/day vs threshold ${threshold}). Tool replacement recorded.`
      });
    } else {
      // Days post replacement: curve decreases back down to baseline
      const decaySteps = daysCount - toolChangeDay;
      const progress = (i - toolChangeDay) / Math.max(1, decaySteps);
      const droppedPulse = (threshold + 1.8) - ((threshold + 1.8 - nominalBase) * Math.min(1, progress * 1.15));
      avgPulse = Number((droppedPulse + (Math.sin(i * 2) * 0.2)).toFixed(1));
      status = 'NORMAL';
    }

    const minPulse = Math.max(12, Math.round(avgPulse - 3.5));
    const maxPulse = Math.round(avgPulse + 4.2);
    const operationsCount = 280 + Math.floor(Math.sin(i) * 25);
    const okCount = Math.round(operationsCount * (status === 'CRITICAL' ? 0.94 : 0.99));
    const ngCount = operationsCount - okCount;

    points.push({
      day: i,
      day_label: `Day ${i}`,
      date: dateStr,
      date_display: dateDisplay,
      avg_pulse_count: avgPulse,
      min_pulse: minPulse,
      max_pulse: maxPulse,
      operations_count: operationsCount,
      ok_count: okCount,
      ng_count: ngCount,
      threshold_limit: threshold,
      is_alert_point: isAlertPoint,
      alert_label: alertLabel,
      is_tool_changed: isToolChanged,
      tool_change_label: toolChangeLabel,
      tool_serial: activeSerial,
      status
    });
  }

  return {
    wrench_id: wrench.wrench_id,
    tool_name: wrench.tool_name,
    assembly_name: wrench.assembly_name,
    sub_assembly_name: wrench.sub_assembly_name,
    station: wrench.station,
    threshold: threshold,
    days_count: daysCount,
    nominal_baseline: Number(nominalBase.toFixed(1)),
    peak_avg_pulse: Number((threshold + 1.8).toFixed(1)),
    latest_avg_pulse: points[points.length - 1].avg_pulse_count,
    alert_day: alertDay,
    tool_change_day: toolChangeDay,
    trend_summary: 'Increasing trend observed across Days 1-5, followed by tool replacement and recovery to nominal baseline.',
    daily_points: points
  };
}

/**
 * GET /api/trends/daily - Primary Daily Average Pulse vs Day Trend Graph
 * Query params: wrench_id, days (default: 8, or 14, 30)
 */
router.get('/daily', (req, res) => {
  try {
    const { wrench_id = 'URYU_ST28_F016', days = '8' } = req.query;
    const daysCount = parseInt(days, 10) || 8;

    const wrench = ALL_WRENCH_ASSETS.find(w => w.wrench_id === wrench_id) || ALL_WRENCH_ASSETS[0];
    const trendData = generateDailyPulseTrend(wrench, daysCount);

    res.json({
      success: true,
      data: trendData
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/trends/compare - Multi-wrench comparative daily average pulse overlay
 * Query params: wrench_ids (comma-separated), days (default: 8)
 */
router.get('/compare', (req, res) => {
  try {
    const { wrench_ids, days = '8' } = req.query;
    const daysCount = parseInt(days, 10) || 8;

    let targetIds = [];
    if (wrench_ids) {
      targetIds = wrench_ids.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      targetIds = ['URYU_ST28_F016', 'URYU_STBlock_sub_assy_F001', 'YOKOTA_ST58_F0250'];
    }

    const selectedWrenches = ALL_WRENCH_ASSETS.filter(w => targetIds.includes(w.wrench_id));
    const allTrends = selectedWrenches.map(w => generateDailyPulseTrend(w, daysCount));

    // Build merged overlay points for Day 1..N
    const overlayPoints = [];
    for (let d = 0; d < daysCount; d++) {
      const first = allTrends[0]?.daily_points[d];
      const point = {
        day: d + 1,
        day_label: `Day ${d + 1}`,
        date: first?.date,
        date_display: first?.date_display
      };

      allTrends.forEach(t => {
        const dp = t.daily_points[d];
        point[`${t.wrench_id}_avg_pulse`] = dp?.avg_pulse_count || 0;
        point[`${t.wrench_id}_name`] = t.tool_name;
        point[`${t.wrench_id}_threshold`] = t.threshold;
        if (dp?.is_tool_changed) {
          point[`${t.wrench_id}_tool_changed`] = true;
        }
      });

      overlayPoints.push(point);
    }

    res.json({
      success: true,
      days_count: daysCount,
      wrenches: allTrends.map(t => ({
        wrench_id: t.wrench_id,
        tool_name: t.tool_name,
        assembly_name: t.assembly_name,
        sub_assembly_name: t.sub_assembly_name,
        threshold: t.threshold,
        nominal_baseline: t.nominal_baseline,
        latest_avg_pulse: t.latest_avg_pulse,
        tool_change_day: t.tool_change_day
      })),
      overlay_points: overlayPoints
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
