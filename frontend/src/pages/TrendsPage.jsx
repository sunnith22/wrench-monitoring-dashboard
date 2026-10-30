import React, { useState, useEffect } from 'react';
import { TngaApi } from '../services/api';
import {
  TrendingUp,
  AlertTriangle,
  Repeat,
  CheckCircle,
  Calendar,
  Layers,
  Wrench,
  Info,
  Clock,
  Activity
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend
} from 'recharts';

export default function TrendsPage() {
  const [wrenchesList, setWrenchesList] = useState([]);
  const [selectedWrenchId, setSelectedWrenchId] = useState('URYU_ST28_F016');
  const [selectedDays, setSelectedDays] = useState(8); // 8 days as in sketch
  const [trendData, setTrendData] = useState(null);
  const [viewMode, setViewMode] = useState('single'); // 'single' | 'compare'
  const [compareIds, setCompareIds] = useState(['URYU_ST28_F016', 'URYU_STBlock_sub_assy_F001', 'YOKOTA_ST58_F0250']);
  const [compareData, setCompareData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load all wrenches
  useEffect(() => {
    TngaApi.getWrenches().then(res => setWrenchesList(res.data || [])).catch(console.error);
  }, []);

  // Load trend data
  useEffect(() => {
    setLoading(true);
    if (viewMode === 'single') {
      TngaApi.getDailyTrends(selectedWrenchId, selectedDays)
        .then(res => setTrendData(res.data))
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      TngaApi.getComparativeTrends(compareIds.join(','), selectedDays)
        .then(res => setCompareData(res))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [selectedWrenchId, selectedDays, viewMode, compareIds]);

  const dailyPoints = trendData?.daily_points || [];
  const threshold = trendData?.threshold || 25;
  const toolChangeDay = trendData?.tool_change_day || 5;
  const alertDay = trendData?.alert_day || 4;

  // Custom Chart Dot component to draw Alert point and Tool Change point
  const CustomDailyDot = (props) => {
    const { cx, cy, payload } = props;
    if (!cx || !cy) return null;

    if (payload.is_tool_changed) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={7} fill="#10b981" stroke="#ffffff" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={11} fill="none" stroke="#10b981" strokeWidth={1.5} strokeDasharray="2 2" />
        </g>
      );
    }

    if (payload.is_alert_point) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={7} fill="#ef4444" stroke="#ffffff" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={11} fill="none" stroke="#ef4444" strokeWidth={1.5} />
        </g>
      );
    }

    return (
      <circle cx={cx} cy={cy} r={4.5} fill="#2563eb" stroke="#ffffff" strokeWidth={1.5} />
    );
  };

  // Custom Tooltip for Daily Trend Graph
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          background: '#ffffff',
          padding: '12px 16px',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
          fontSize: '12px',
          minWidth: '220px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
            <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{data.day_label} ({data.date_display})</strong>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{data.date}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Avg Pulse Count:</span>
              <strong style={{ color: data.avg_pulse_count > threshold ? '#dc2626' : '#2563eb', fontSize: '14px' }}>
                {data.avg_pulse_count} pulses/day
              </strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Operations Count:</span>
              <span style={{ fontWeight: 600 }}>{data.operations_count} cycles</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Pulse Spread:</span>
              <span>{data.min_pulse} – {data.max_pulse} pulses</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Active Serial:</span>
              <span style={{ fontFamily: 'monospace' }}>{data.tool_serial}</span>
            </div>

            {data.is_alert_point && (
              <div style={{
                marginTop: '4px',
                padding: '4px 8px',
                background: '#fef2f2',
                borderRadius: '6px',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontWeight: 600
              }}>
                ⚠️ {data.alert_label} (Logged in Alert Tracker)
              </div>
            )}

            {data.is_tool_changed && (
              <div style={{
                marginTop: '4px',
                padding: '4px 8px',
                background: '#ecfdf5',
                borderRadius: '6px',
                border: '1px solid #a7f3d0',
                color: '#047857',
                fontWeight: 600
              }}>
                🔧 {data.tool_change_label}
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      {/* 1. Header & Controls */}
      <div className="card" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={22} color="var(--accent-blue)" />
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
                Average Pulse Count per Day vs. Days (Main Trends Graph)
              </h2>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
              Predictive condition monitoring: tracks daily pulse increases, triggers increasing trend alerts, and verifies recovery post-tool replacement.
            </p>
          </div>

          {/* View Mode Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-subtle)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <button
              onClick={() => setViewMode('single')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'single' ? '#ffffff' : 'transparent',
                color: viewMode === 'single' ? 'var(--accent-blue)' : 'var(--text-muted)',
                boxShadow: viewMode === 'single' ? 'var(--shadow-sm)' : 'none'
              }}
            >
              Single Tool Analysis
            </button>
            <button
              onClick={() => setViewMode('compare')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'compare' ? '#ffffff' : 'transparent',
                color: viewMode === 'compare' ? 'var(--accent-blue)' : 'var(--text-muted)',
                boxShadow: viewMode === 'compare' ? 'var(--shadow-sm)' : 'none'
              }}
            >
              Multi-Wrench Overlay
            </button>
          </div>
        </div>

        {/* Second Row: Tool Selector & Day Range Selector */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          {viewMode === 'single' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 380px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Tool:
              </label>
              <select
                value={selectedWrenchId}
                onChange={(e) => setSelectedWrenchId(e.target.value)}
                className="form-input"
                style={{ fontWeight: 600, fontSize: '13px', padding: '7px 12px' }}
              >
                {wrenchesList.map(w => (
                  <option key={w.wrench_id} value={w.wrench_id}>
                    [{w.brand}] {w.wrench_id} - {w.tool_name} (Station {w.station} • {w.assembly_name})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Comparing 3 Assembly Wrenches across Days 1–{selectedDays}
            </div>
          )}

          {/* Days Range Selector (Default: 8 Days from user sketch) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
              Timeframe:
            </span>
            {[
              { days: 8, label: '8 Days (Standard)' },
              { days: 14, label: '14 Days' },
              { days: 30, label: '30 Days' }
            ].map(item => (
              <button
                key={item.days}
                onClick={() => setSelectedDays(item.days)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: `1px solid ${selectedDays === item.days ? 'var(--accent-blue-border)' : 'var(--border-color)'}`,
                  background: selectedDays === item.days ? 'var(--accent-blue-light)' : '#ffffff',
                  color: selectedDays === item.days ? 'var(--accent-blue)' : 'var(--text-secondary)'
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Computing daily average pulse trends...
        </div>
      ) : viewMode === 'single' ? (
        <>
          {/* 2. Top Summary KPI Cards */}
          <div className="grid-cols-4" style={{ marginBottom: '22px' }}>
            <div className="card">
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Latest Daily Average
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                {trendData?.latest_avg_pulse}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  pulses/day
                </span>
              </div>
              <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--accent-green-text)', fontWeight: 600 }}>
                ✓ Normalized post-replacement
              </div>
            </div>

            <div className="card">
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Nominal Baseline
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--accent-blue)', marginTop: '4px' }}>
                {trendData?.nominal_baseline}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  pulses/day
                </span>
              </div>
              <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Target operational range
              </div>
            </div>

            <div className="card">
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Approved Limit Threshold
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--accent-red-text)', marginTop: '4px' }}>
                {threshold}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  max pulses
                </span>
              </div>
              <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Peak reached: <strong>{trendData?.peak_avg_pulse}</strong> pulses
              </div>
            </div>

            <div className="card">
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Maintenance Status
              </span>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent-green-text)', marginTop: '10px' }}>
                🔧 Tool Changed on Day {toolChangeDay}
              </div>
              <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Alert recorded in Alert Tracker
              </div>
            </div>
          </div>

          {/* 3. The Main Trends Graph (Sketch Implementation) */}
          <div className="card" style={{ marginBottom: '22px' }}>
            {/* Header Legend matching user's handwriting annotations */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginBottom: '18px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Avg Pulse Count per Day vs. Days
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {trendData?.tool_name} ({trendData?.assembly_name} • {trendData?.sub_assembly_name})
                </span>
              </div>

              {/* Visual Annotations Legend */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '18px', fontSize: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#2563eb' }} />
                  <span style={{ fontWeight: 600 }}>Daily Avg Pulse Count</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444' }} />
                  <span style={{ color: '#b91c1c', fontWeight: 700 }}>Increasing Trend Alert (Day {alertDay})</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#10b981' }} />
                  <span style={{ color: '#047857', fontWeight: 700 }}>Tool Changed (Day {toolChangeDay})</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '16px', height: '2px', background: '#ef4444', borderTop: '2px dashed #ef4444' }} />
                  <span style={{ color: 'var(--accent-red-text)' }}>Threshold ({threshold})</span>
                </div>
              </div>
            </div>

            {/* Recharts Main Graph */}
            <div style={{ width: '100%', height: '380px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyPoints} margin={{ top: 20, right: 40, left: 10, bottom: 25 }}>
                  <defs>
                    <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  
                  {/* X-Axis: Days (1, 2, 3, 4, 5, 6, 7, 8) as in user's sketch */}
                  <XAxis
                    dataKey="day_label"
                    stroke="#64748b"
                    fontSize={12}
                    fontWeight={600}
                    tickLine={false}
                    dy={10}
                    label={{ value: 'Days', position: 'insideBottom', offset: -16, fill: '#0f172a', fontWeight: 700, fontSize: 13 }}
                  />

                  {/* Y-Axis: Avg pulse count per day */}
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    dx={-6}
                    domain={[12, threshold + 6]}
                    label={{ value: 'Avg pulse count per day', angle: -90, position: 'insideLeft', fill: '#0f172a', fontWeight: 700, fontSize: 13 }}
                  />

                  <Tooltip content={<CustomTooltip />} />

                  {/* Threshold Limit Line */}
                  <ReferenceLine
                    y={threshold}
                    stroke="#ef4444"
                    strokeDasharray="5 5"
                    strokeWidth={1.8}
                    label={{
                      value: `Approved Limit: ${threshold} pulses`,
                      fill: '#dc2626',
                      position: 'top',
                      fontSize: 11,
                      fontWeight: 700
                    }}
                  />

                  {/* Tool Change Vertical Reference Line (Day 5 peak in sketch) */}
                  <ReferenceLine
                    x={`Day ${toolChangeDay}`}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    label={{
                      value: '🔧 Tool Changed',
                      fill: '#047857',
                      position: 'insideTopLeft',
                      fontSize: 12,
                      fontWeight: 800
                    }}
                  />

                  {/* Increasing Trend Alert Vertical Reference Line (Day 4 in sketch) */}
                  <ReferenceLine
                    x={`Day ${alertDay}`}
                    stroke="#ef4444"
                    strokeDasharray="3 3"
                    strokeWidth={1.5}
                    label={{
                      value: '⚠️ Increasing trend alert',
                      fill: '#b91c1c',
                      position: 'insideTopRight',
                      fontSize: 11,
                      fontWeight: 700
                    }}
                  />

                  {/* Area fill under curve */}
                  <Area
                    type="monotone"
                    dataKey="avg_pulse_count"
                    stroke="none"
                    fill="url(#pulseGradient)"
                  />

                  {/* Primary Trend Line */}
                  <Line
                    type="monotone"
                    dataKey="avg_pulse_count"
                    stroke="#2563eb"
                    strokeWidth={2.8}
                    dot={<CustomDailyDot />}
                    activeDot={{ r: 8, stroke: '#ffffff', strokeWidth: 2, fill: '#2563eb' }}
                    name="Avg Pulses / Day"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 4. Detailed Daily Breakdown Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Daily Average Pulse Progression & Milestone Log
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {dailyPoints.length} Consecutive Operating Days
              </span>
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Calendar Date</th>
                  <th>Avg Pulse Count / Day</th>
                  <th>Operations Contributing</th>
                  <th>OK / NG Ratio</th>
                  <th>Active Tool Serial</th>
                  <th>Quality Status</th>
                  <th>Event / Milestone</th>
                </tr>
              </thead>
              <tbody>
                {dailyPoints.map(dp => (
                  <tr key={dp.day} style={{ background: dp.is_tool_changed ? '#f0fdf4' : dp.is_alert_point ? '#fef2f2' : '#ffffff' }}>
                    <td>
                      <strong style={{ fontSize: '13px' }}>{dp.day_label}</strong>
                    </td>
                    <td>{dp.date} ({dp.date_display})</td>
                    <td>
                      <strong style={{
                        fontSize: '14px',
                        color: dp.avg_pulse_count > threshold ? '#dc2626' : dp.avg_pulse_count >= threshold - 2 ? '#b45309' : '#2563eb'
                      }}>
                        {dp.avg_pulse_count} pulses
                      </strong>
                    </td>
                    <td>{dp.operations_count} operations</td>
                    <td>
                      <span style={{ color: 'var(--accent-green-text)', fontWeight: 600 }}>{dp.ok_count} OK</span> / <span style={{ color: dp.ng_count > 0 ? 'var(--accent-red-text)' : 'var(--text-muted)' }}>{dp.ng_count} NG</span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{dp.tool_serial}</td>
                    <td>
                      <span className={`badge ${dp.status === 'CRITICAL' ? 'badge-critical' : dp.status === 'WARNING' ? 'badge-warning' : 'badge-normal'}`}>
                        {dp.status}
                      </span>
                    </td>
                    <td>
                      {dp.is_tool_changed ? (
                        <span style={{ fontWeight: 700, color: '#047857' }}>
                          🔧 {dp.tool_change_label}
                        </span>
                      ) : dp.is_alert_point ? (
                        <span style={{ fontWeight: 700, color: '#b91c1c' }}>
                          ⚠️ {dp.alert_label} (Alert Logged)
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Normal Routine Cycle</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        /* Multi-Wrench Overlay Comparison (Section 2.5 D) */
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
              All Wrenches — Daily Average Pulse Count Comparison
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Comparing {compareData?.wrenches?.length || 3} Wrenches across {selectedDays} Days
            </span>
          </div>

          <div style={{ width: '100%', height: '360px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={compareData?.overlay_points || []} margin={{ top: 10, right: 30, left: 10, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day_label" stroke="#64748b" fontSize={12} tickLine={false} dy={8} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} dx={-4} label={{ value: 'Avg pulses per day', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#ffffff', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                {compareData?.wrenches?.map((w, idx) => {
                  const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6'];
                  return (
                    <Line
                      key={w.wrench_id}
                      type="monotone"
                      dataKey={`${w.wrench_id}_avg_pulse`}
                      name={`${w.tool_name} (Station ${w.station || ''})`}
                      stroke={colors[idx % colors.length]}
                      strokeWidth={2.4}
                      dot={{ r: 4 }}
                    />
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
