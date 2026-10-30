import React from 'react';
import {
  Wrench,
  CheckCircle,
  AlertTriangle,
  Layers,
  ArrowRight,
  TrendingUp,
  Activity,
  ShieldAlert,
  Clock
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

export default function HomePage({ overview, onNavigateTab, onSelectWrench }) {
  const { kpi, judgement_donut = [], assembly_cards = [], recent_alerts = [] } = overview || {};

  return (
    <div>
      {/* 1. KPI Cards Row */}
      <div className="grid-cols-4">
        {/* Total Wrenches */}
        <div className="card" style={{ borderLeft: '4px solid var(--accent-blue)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Total Plant Wrenches
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                {kpi?.total_registered_wrenches || 73}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  active tools
                </span>
              </div>
            </div>
            <div style={{ padding: '10px', borderRadius: '10px', background: 'var(--accent-blue-light)', color: 'var(--accent-blue)' }}>
              <Wrench size={20} />
            </div>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            61 URYU + 12 Yokota Impact Wrenches
          </div>
        </div>

        {/* OK Tightening Count */}
        <div className="card" style={{ borderLeft: '4px solid var(--accent-green)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                OK Operations (Shift)
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--accent-green-text)', marginTop: '4px' }}>
                {kpi?.ok_count || 2736}
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent-green-text)', marginLeft: '6px' }}>
                  ({kpi?.ok_percentage || 98.6}%)
                </span>
              </div>
            </div>
            <div style={{ padding: '10px', borderRadius: '10px', background: 'var(--accent-green-light)', color: 'var(--accent-green-text)' }}>
              <CheckCircle size={20} />
            </div>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Total Recorded Cycles: <strong>{kpi?.total_operations || 2774}</strong>
          </div>
        </div>

        {/* NG Operations */}
        <div className="card" style={{ borderLeft: '4px solid var(--accent-red)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                NG Deviations (Shift)
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--accent-red-text)', marginTop: '4px' }}>
                {kpi?.ng_count || 38}
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent-red-text)', marginLeft: '6px' }}>
                  ({kpi?.ng_percentage || 1.4}%)
                </span>
              </div>
            </div>
            <div style={{ padding: '10px', borderRadius: '10px', background: 'var(--accent-red-light)', color: 'var(--accent-red-text)' }}>
              <AlertTriangle size={20} />
            </div>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Pulse or torque limits exceeded
          </div>
        </div>

        {/* Open Alerts */}
        <div className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Active Open Alerts
              </span>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#b45309', marginTop: '4px' }}>
                {kpi?.open_alerts || 1}
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                  requiring action
                </span>
              </div>
            </div>
            <div style={{ padding: '10px', borderRadius: '10px', background: 'var(--accent-amber-light)', color: 'var(--accent-amber-text)' }}>
              <ShieldAlert size={20} />
            </div>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Acknowledged: <strong>{kpi?.acknowledged_alerts || 1}</strong>
          </div>
        </div>
      </div>

      {/* 2. Middle Row: OK/NG Donut Chart & High Priority Alerts */}
      <div className="grid-cols-2">
        {/* OK vs NG Donut Chart (Section 2.9) */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Production Judgement Summary (OK vs NG)
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Shift Total: {kpi?.total_operations || 2774} Tightenings
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', height: '220px' }}>
            <div style={{ flex: 1, height: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={judgement_donut}
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {judgement_donut.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val, name, item) => [`${val} cycles (${item.payload.percentage}%)`, name]}
                    contentStyle={{ background: '#ffffff', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div style={{ width: '180px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>OK Tightening</span>
                </div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent-green-text)', marginLeft: '18px' }}>
                  {kpi?.ok_count || 2736} ({kpi?.ok_percentage || 98.6}%)
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>NG Deviation</span>
                </div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent-red-text)', marginLeft: '18px' }}>
                  {kpi?.ng_count || 38} ({kpi?.ng_percentage || 1.4}%)
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* High Priority Alerts Panel */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={18} color="var(--accent-red)" />
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Active Priority Alerts
              </h3>
            </div>
            <button onClick={() => onNavigateTab('alerts')} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}>
              View All Alerts
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {recent_alerts.map(alt => (
              <div
                key={alt.alert_id}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: alt.severity === 'CRITICAL' ? 'var(--accent-red-light)' : 'var(--accent-amber-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: alt.severity === 'CRITICAL' ? '#ef4444' : '#f59e0b',
                      color: '#ffffff'
                    }}>
                      {alt.severity}
                    </span>
                    <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                      {alt.tool_name}
                    </strong>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      ({alt.assembly_name} • {alt.sub_assembly_name})
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Measured: <strong style={{ color: alt.severity === 'CRITICAL' ? 'var(--accent-red-text)' : '#b45309' }}>{alt.observed_value} pulses</strong> (Limit: {alt.threshold_limit}) • Engine: {alt.engine_number}
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (onSelectWrench) onSelectWrench(alt.wrench_id);
                    onNavigateTab('wrench-analysis');
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                >
                  Analyze Wrench
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Assembly Navigation Cards (Section 2.8 & 2.9) */}
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
          Assembly Line Navigation
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Select an assembly line to drill down into sub-assemblies and individual wrenches.
        </p>
      </div>

      <div className="grid-cols-3">
        {assembly_cards.map(card => (
          <div
            key={card.id}
            className="card"
            style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
            onClick={() => onNavigateTab(card.id)}
          >
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '4px',
              background: card.open_alerts > 0 ? 'var(--accent-amber)' : 'var(--accent-blue)'
            }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <div>
                <h4 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {card.name}
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {card.subtitle}
                </p>
              </div>
              <div style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'var(--bg-subtle)',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--text-primary)'
              }}>
                {card.tool_count} Wrenches
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '14px 0' }}>
              {card.sub_assemblies.map((sub, idx) => (
                <span
                  key={idx}
                  style={{
                    fontSize: '11px',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    background: 'var(--accent-blue-light)',
                    color: 'var(--accent-blue)',
                    fontWeight: 600,
                    border: '1px solid var(--accent-blue-border)'
                  }}
                >
                  {sub}
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '12px', color: card.open_alerts > 0 ? '#b45309' : 'var(--accent-green-text)', fontWeight: 600 }}>
                {card.open_alerts > 0 ? `⚠️ ${card.open_alerts} Open Alert` : '✓ All Tools Operational'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-blue)', fontSize: '12px', fontWeight: 600 }}>
                <span>Open Line</span>
                <ArrowRight size={14} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
