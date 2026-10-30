/**
 * Statistical Analytics Engine for TNGA Impact Wrench Dashboard
 */

function calculateWrenchAnalytics(records, thresholdMax) {
  if (!records || records.length === 0) {
    return {
      totalCount: 0,
      averagePulse: 0,
      minPulse: 0,
      maxPulse: 0,
      lastPulse: 0,
      averageTorque: 0,
      averageDuration: 0,
      okCount: 0,
      ngCount: 0,
      okPercentage: 100,
      ngPercentage: 0,
      chartData: [],
      dailyAverages: [],
      thresholdBreaches: [],
      breachCount: 0,
      status: 'NORMAL'
    };
  }

  const pulseValues = records.map(r => r.pulse_count || 0);
  const torqueValues = records.map(r => r.torque || 0);
  const durationValues = records.map(r => r.tightening_time || 0);

  const totalCount = records.length;
  const sumPulse = pulseValues.reduce((a, b) => a + b, 0);
  const averagePulse = Number((sumPulse / totalCount).toFixed(1));
  const minPulse = Math.min(...pulseValues);
  const maxPulse = Math.max(...pulseValues);
  const lastPulse = pulseValues[pulseValues.length - 1];

  const averageTorque = Number((torqueValues.reduce((a, b) => a + b, 0) / totalCount).toFixed(2));
  const averageDuration = Number((durationValues.reduce((a, b) => a + b, 0) / totalCount).toFixed(2));

  // OK vs NG Judgement
  const okCount = records.filter(r => r.judgement === 'OK').length;
  const ngCount = totalCount - okCount;
  const okPercentage = Number(((okCount / totalCount) * 100).toFixed(1));
  const ngPercentage = Number(((ngCount / totalCount) * 100).toFixed(1));

  // 5-Point Moving Average & Time-Series Chart Data
  const chartData = records.map((rec, idx) => {
    const windowStart = Math.max(0, idx - 4);
    const windowSlice = pulseValues.slice(windowStart, idx + 1);
    const movingAvg = Number((windowSlice.reduce((a, b) => a + b, 0) / windowSlice.length).toFixed(1));
    const isBreach = rec.pulse_count > thresholdMax;

    return {
      index: idx + 1,
      record_key: rec.record_key,
      timestamp: rec.timestamp,
      time: rec.timestamp.includes(' ') ? rec.timestamp.split(' ')[1] : rec.timestamp,
      engine_number: rec.engine_number,
      work_no: rec.work_no,
      pulse_count: rec.pulse_count,
      moving_average: movingAvg,
      threshold: thresholdMax,
      torque: rec.torque,
      angle: rec.angle,
      tightening_time: rec.tightening_time,
      judgement: rec.judgement,
      is_breach: isBreach
    };
  });

  // Calculate Daily Averages with Operations Count (Section 2.5 Requirement C)
  const dailyBuckets = {};
  records.forEach(rec => {
    const dateKey = rec.timestamp.includes(' ') ? rec.timestamp.split(' ')[0] : 'Today';
    if (!dailyBuckets[dateKey]) {
      dailyBuckets[dateKey] = { date: dateKey, totalPulses: 0, count: 0, okCount: 0, ngCount: 0 };
    }
    dailyBuckets[dateKey].totalPulses += rec.pulse_count;
    dailyBuckets[dateKey].count += 1;
    if (rec.judgement === 'OK') dailyBuckets[dateKey].okCount += 1;
    else dailyBuckets[dateKey].ngCount += 1;
  });

  const dailyAverages = Object.values(dailyBuckets).map(b => ({
    date: b.date,
    average_pulse: Number((b.totalPulses / b.count).toFixed(1)),
    operations_count: b.count,
    ok_count: b.okCount,
    ng_count: b.ngCount
  }));

  // Identify Threshold Breaches
  const thresholdBreaches = chartData.filter(d => d.is_breach);
  const breachCount = thresholdBreaches.length;

  let status = 'NORMAL';
  if (breachCount > 0 || lastPulse > thresholdMax) {
    status = 'CRITICAL';
  } else if (lastPulse >= thresholdMax - 2) {
    status = 'WARNING';
  }

  return {
    totalCount,
    averagePulse,
    minPulse,
    maxPulse,
    lastPulse,
    averageTorque,
    averageDuration,
    okCount,
    ngCount,
    okPercentage,
    ngPercentage,
    chartData,
    dailyAverages,
    thresholdBreaches,
    breachCount,
    status
  };
}

module.exports = {
  calculateWrenchAnalytics
};
