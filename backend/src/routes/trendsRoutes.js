const express = require('express');
const router = express.Router();
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');
const { fetchWrenchOperations } = require('../services/dataIngestionService');
const { getToolThreshold } = require('../services/configService');
const { localFallbackCycles } = require('../config/postgresDB');

/**
 * Builds daily average pulse trend strictly from REAL ingested live shop-floor operations.
 * NO simulated data, NO fake tool changes, NO fake alerts.
 */
async function buildRealDailyPulseTrend(wrench, daysCount = 8) {
  const threshold = wrench.default_pulse_threshold || 25;
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // 1. Ingest live operations for today from the shop-floor line PC
  const todayRecords = await fetchWrenchOperations(wrench, todayStr);

  const points = [];
  let alertDay = null;
  let toolChangeDay = null;

  for (let i = 1; i <= daysCount; i++) {
    const dayDate = new Date(today);
    dayDate.setDate(today.getDate() - (daysCount - i));
    const dateStr = dayDate.toISOString().split('T')[0];
    const dateDisplay = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    let dayRecords = [];
    if (dateStr === todayStr) {
      dayRecords = todayRecords;
    } else {
      dayRecords = localFallbackCycles.filter(c => c.wrench_id === wrench.wrench_id && c.tightening_time && c.tightening_time.startsWith(dateStr));
    }

    if (dayRecords.length > 0) {
      const pulseCounts = dayRecords.map(r => r.pulse_count || r.pulses || 0).filter(p => p > 0);
      const avgPulse = pulseCounts.length > 0
        ? Number((pulseCounts.reduce((a, b) => a + b, 0) / pulseCounts.length).toFixed(1))
        : 0;
      const minPulse = pulseCounts.length > 0 ? Math.min(...pulseCounts) : 0;
      const maxPulse = pulseCounts.length > 0 ? Math.max(...pulseCounts) : 0;
      const okCount = dayRecords.filter(r => r.judgement === 'OK' || r.torque_status === 'OK').length;
      const ngCount = dayRecords.length - okCount;
      const isAlert = avgPulse > threshold;
      if (isAlert && !alertDay) alertDay = i;

      points.push({
        day: i,
        day_label: `Day ${i} (${dateDisplay})`,
        date: dateStr,
        date_display: dateDisplay,
        avg_pulse_count: avgPulse,
        min_pulse: minPulse,
        max_pulse: maxPulse,
        operations_count: dayRecords.length,
        ok_count: okCount,
        ng_count: ngCount,
        threshold_limit: threshold,
        is_alert_point: isAlert,
        alert_label: isAlert ? 'Threshold exceeded' : null,
        is_tool_changed: false,
        tool_change_label: null,
        tool_serial: wrench.tool_serial || 'SN-URYU-ACTIVE',
        status: isAlert ? 'CRITICAL' : (avgPulse >= threshold - 3 ? 'WARNING' : 'NORMAL')
      });
    } else if (i === daysCount) {
      // Today (even if 0 records yet)
      points.push({
        day: i,
        day_label: `Today (${dateDisplay})`,
        date: dateStr,
        date_display: dateDisplay,
        avg_pulse_count: 0,
        min_pulse: 0,
        max_pulse: 0,
        operations_count: 0,
        ok_count: 0,
        ng_count: 0,
        threshold_limit: threshold,
        is_alert_point: false,
        alert_label: null,
        is_tool_changed: false,
        tool_change_label: null,
        tool_serial: wrench.tool_serial || 'SN-URYU-ACTIVE',
        status: 'NORMAL'
      });
    }
  }

  const latestPoint = points[points.length - 1];

  return {
    wrench_id: wrench.wrench_id,
    tool_name: wrench.tool_name,
    assembly_name: wrench.assembly_name,
    sub_assembly_name: wrench.sub_assembly_name,
    station: wrench.station,
    threshold: threshold,
    days_count: points.length,
    nominal_baseline: Number((threshold - 4).toFixed(1)),
    peak_avg_pulse: points.length > 0 ? Math.max(...points.map(p => p.avg_pulse_count)) : 0,
    latest_avg_pulse: latestPoint ? latestPoint.avg_pulse_count : 0,
    alert_day: alertDay,
    tool_change_day: toolChangeDay,
    trend_summary: alertDay
      ? `Alert: Daily average pulse count exceeded threshold limit on Day ${alertDay}.`
      : 'Live operating data active. All daily pulse averages within approved engineering limits.',
    daily_points: points
  };
}

/**
 * GET /api/trends/daily - Primary Daily Average Pulse vs Day Trend Graph (Live Data)
 * Query params: wrench_id, days (default: 8, or 14, 30)
 */
router.get('/daily', async (req, res) => {
  try {
    const { wrench_id = 'URYU_ST28_F016', days = '8' } = req.query;
    const daysCount = parseInt(days, 10) || 8;

    const baseWrench = ALL_WRENCH_ASSETS.find(w => w.wrench_id === wrench_id) || ALL_WRENCH_ASSETS[0];
    const activeThreshold = getToolThreshold(baseWrench.wrench_id);
    const wrench = {
      ...baseWrench,
      default_pulse_threshold: activeThreshold
    };

    const trendData = await buildRealDailyPulseTrend(wrench, daysCount);

    res.json({
      success: true,
      data: trendData
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/trends/compare - Multi-wrench comparative daily average pulse overlay (Live Data)
 * Query params: wrench_ids (comma-separated), days (default: 8)
 */
router.get('/compare', async (req, res) => {
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
    const allTrends = await Promise.all(
      selectedWrenches.map(w => {
        const activeThreshold = getToolThreshold(w.wrench_id);
        return buildRealDailyPulseTrend({ ...w, default_pulse_threshold: activeThreshold }, daysCount);
      })
    );

    const overlayPoints = [];
    const maxPoints = Math.max(...allTrends.map(t => t.daily_points.length), 1);
    for (let d = 0; d < maxPoints; d++) {
      const first = allTrends[0]?.daily_points[d];
      const point = {
        day: d + 1,
        day_label: first?.day_label || `Day ${d + 1}`,
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
      days_count: maxPoints,
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
