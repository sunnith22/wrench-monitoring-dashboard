import React, { useState, useEffect } from 'react';
import { TngaApi } from '../services/api';
import {
  Wrench,
  Activity,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Layers,
  Search
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine
} from 'recharts';

export default function WrenchAnalysisPage({ wrenchId, onSelectWrench }) {
  const [wrenchesList, setWrenchesList] = useState([]);
  const [selectedId, setSelectedId] = useState(wrenchId || 'URYU_ST28_F016');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [wrenchData, setWrenchData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load wrenches catalog for selector
  useEffect(() => {
    TngaApi.getWrenches()
      .then(res => {
        if (res.data) setWrenchesList(res.data);
      })
      .catch(console.error);
  }, []);

  // Update selectedId if parent prop changes
  useEffect(() => {
    if (wrenchId) setSelectedId(wrenchId);
  }, [wrenchId]);

  // Load detailed telemetry for selected tool & date
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    TngaApi.getWrenchDetail(selectedId, selectedDate)
      .then(res => {
        setWrenchData(res);
      })
      .catch(err => console.error('Failed to load telemetry:', err))
      .finally(() => setLoading(false));
  }, [selectedId, selectedDate]);

  const { wrench, analytics, recent_operations = [] } = wrenchData || {};
  const thresholdMax = wrench?.default_pulse_threshold || 25;
  const chartData = analytics?.chartData || [];
  const dailyAverages = analytics?.dailyAverages || [];

  return (
    <div>
      {/* 1. Selector Bar */}
      <div className="card" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          {/* Active Tool Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 380px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              background: 'var(--accent-blue-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-blue)',
              border: '1px solid var(--accent-blue-border)'
            }}>
              <Wrench size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Select Impact Wrench
              </label>
              <select
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  if (onSelectWrench) onSelectWrench(e.target.value);
                }}
                className="form-input"
                style={{ fontWeight: 600, fontSize: '13px', padding: '7px 12px' }}
              >
                {wrenchesList.map(w => (
                  <option key={w.wrench_id} value={w.wrench_id}>
                    [{w.brand}] {w.wrench_id} - {w.tool_name} ({w.assembly_name} • {w.sub_assembly_name})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={16} color="var(--accent-cyan)" />
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>
              Date:
            </span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="form-input"
              style={{ width: '150px', padding: '6px 10px' }}
            />
          </div>
        </div>

        {/* Selected Wrench Quick Specs Strip */}
        {wrench && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '12px',
            marginTop: '16px',
            padding: '10px 16px',
            background: 'var(--bg-subtle)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            fontSize: '12px'
          }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Assembly: </span>
              <strong>{wrench.assembly_name} ({wrench.sub_assembly_name})</strong>
            </div>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-color)' }} />
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Station: </span>
              <strong>Station {wrench.station} (F{wrench.folder})</strong>
            </div>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-color)' }} />
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Target Torque: </span>
              <strong>{wrench.approved_torque_target} N·m</strong> [{wrench.approved_torque_min} - {wrench.approved_torque_max}]
            </div>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-color)' }} />
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Serial No: </span>
              <strong style={{ fontFamily: 'monospace' }}>{wrench.tool_serial}</strong>
            </div>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-color)' }} />
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Threshold Limit: </span>
              <strong style={{ color: 'var(--accent-red-text)' }}>{thresholdMax} Pulses</strong>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Retrieving telemetry records...
        </div>
      ) : (
        <>
          {/* 2. Top KPI Cards */}
          <div className="grid-cols-4">
            {/* Average Pulse Count */}
            <div className="card">
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Average Pulse Count
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                {analytics?.averagePulse || 0}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  pulses / cycle
                </span>
              </div>
              <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Min: <strong>{analytics?.minPulse}</strong> • Max: <strong>{analytics?.maxPulse}</strong>
              </div>
            </div>

            {/* Last Measured Pulse */}
            <div className="card">
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Latest Cycle Pulse
              </span>
              <div style={{
                fontSize: '32px',
                fontWeight: 800,
                color: (analytics?.lastPulse || 0) > thresholdMax ? 'var(--accent-red-text)' : 'var(--text-primary)',
                marginTop: '4px'
              }}>
                {analytics?.lastPulse || 0}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  pulses
                </span>
              </div>
              <div style={{ marginTop: '10px', fontSize: '12px' }}>
                {(analytics?.lastPulse || 0) > thresholdMax ? (
                  <span style={{ color: 'var(--accent-red-text)', fontWeight: 600 }}>⚠️ Exceeded Threshold!</span>
                ) : (
                  <span style={{ color: 'var(--accent-green-text)', fontWeight: 500 }}>✓ Within Safe Limits</span>
                )}
              </div>
            </div>

            {/* Average Torque */}
            <div className="card">
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Average Torque
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                {analytics?.averageTorque || 0}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  N·m
                </span>
              </div>
              <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Target: {wrench?.approved_torque_target} N·m
              </div>
            </div>

            {/* Cycle Tightening Duration */}
            <div className="card">
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Average Duration
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                {analytics?.averageDuration || 0}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  seconds
                </span>
              </div>
              <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Target: {wrench?.tightening_time_target}s
              </div>
            </div>
          </div>

          {/* 3. Raw Pulse Count Scatter Chart (Section 2.5 A) */}
          <div className="card" style={{ marginBottom: '22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={18} color="var(--accent-blue)" />
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Individual Wrench Raw Pulse Count vs Time
                </h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
                <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>● OK Pulse</span>
                <span style={{ color: 'var(--accent-red-text)', fontWeight: 600 }}>● Threshold Breach</span>
                <span style={{ color: 'var(--accent-red-text)' }}>--- Limit ({thresholdMax})</span>
              </div>
            </div>

            <div style={{ width: '100%', height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} dy={8} />
                  <YAxis stroke="#94a3b8" fontSize={11} domain={[0, thresholdMax + 8]} tickLine={false} dx={-4} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const d = payload[0].payload;
                        return (
                          <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-md)', fontSize: '12px' }}>
                            <div style={{ fontWeight: 700, marginBottom: '4px' }}>Cycle #{d.index} • Engine: {d.engine_number}</div>
                            <div>Pulse Count: <strong style={{ color: d.is_breach ? 'var(--accent-red-text)' : 'var(--accent-blue)' }}>{d.pulse_count}</strong></div>
                            <div>Torque: <strong>{d.torque} N·m</strong> • Angle: <strong>{d.angle}°</strong></div>
                            <div>Time: <strong>{d.tightening_time}s</strong></div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <ReferenceLine y={thresholdMax} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={1.8} label={{ value: `Limit: ${thresholdMax}`, fill: '#dc2626', fontSize: 11, fontWeight: 700 }} />
                  <Line
                    type="monotone"
                    dataKey="pulse_count"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={(props) => {
                      const { cx, cy, payload } = props;
                      if (!cx || !cy) return null;
                      const isBreach = payload.pulse_count > thresholdMax;
                      return <circle cx={cx} cy={cy} r={isBreach ? 5.5 : 3.5} fill={isBreach ? '#ef4444' : '#2563eb'} stroke="#ffffff" strokeWidth={1.5} />;
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 4. Daily Average Pulse Count Summary (Section 2.5 C) */}
          <div className="card" style={{ marginBottom: '22px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '14px' }}>
              Daily Average Pulse Count & Operations Count
            </h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Calendar Date</th>
                  <th>Operations Contributing to Average</th>
                  <th>Average Pulse Count</th>
                  <th>OK Cycles</th>
                  <th>NG Cycles</th>
                  <th>Daily Quality Status</th>
                </tr>
              </thead>
              <tbody>
                {dailyAverages.map((day, idx) => (
                  <tr key={idx}>
                    <td><strong>{day.date}</strong></td>
                    <td>{day.operations_count} tightening operations</td>
                    <td><strong style={{ color: 'var(--accent-blue)', fontSize: '14px' }}>{day.average_pulse} pulses</strong></td>
                    <td style={{ color: 'var(--accent-green-text)', fontWeight: 600 }}>{day.ok_count}</td>
                    <td style={{ color: day.ng_count > 0 ? 'var(--accent-red-text)' : 'var(--text-muted)', fontWeight: 600 }}>{day.ng_count}</td>
                    <td>
                      <span className={`badge ${day.ng_count > 0 ? 'badge-critical' : 'badge-normal'}`}>
                        {day.ng_count > 0 ? 'Deviations Detected' : 'Optimal'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 5. Recent Operation Table (Section 2.4) */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Recent Tightening Operations (Source Traceability)
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Showing latest 15 operations</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Engine / Job Barcode</th>
                  <th>Work No.</th>
                  <th>Pulse Count</th>
                  <th>Torque (N·m)</th>
                  <th>Angle (deg)</th>
                  <th>Duration (s)</th>
                  <th>Vendor Judgement</th>
                </tr>
              </thead>
              <tbody>
                {recent_operations.map((op, idx) => (
                  <tr key={idx}>
                    <td>{op.timestamp}</td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{op.engine_number}</td>
                    <td>{op.work_no}</td>
                    <td>
                      <strong style={{ color: op.pulse_count > thresholdMax ? '#dc2626' : 'var(--text-primary)' }}>
                        {op.pulse_count} {op.pulse_count > thresholdMax && '⚠️'}
                      </strong>
                    </td>
                    <td>{op.torque} N·m</td>
                    <td>{op.angle}°</td>
                    <td>{op.tightening_time} s</td>
                    <td>
                      <span className={`badge ${op.judgement === 'OK' ? 'badge-normal' : 'badge-critical'}`}>
                        {op.judgement}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
