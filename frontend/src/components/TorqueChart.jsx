import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Brush
} from 'recharts';
import { Gauge, ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw } from 'lucide-react';

export default function TorqueChart({
  chartData = [],
  toolName = '',
  targetTorque = 20.0,
  torqueMin = 17.0,
  torqueMax = 23.0
}) {
  const [startIndex, setStartIndex] = useState(0);
  const [endIndex, setEndIndex] = useState(undefined);
  const [expanded, setExpanded] = useState(false);
  const [showLine, setShowLine] = useState(true);

  // Keep brush indices updated when chartData changes
  useEffect(() => {
    if (chartData && chartData.length > 0) {
      setStartIndex(0);
      setEndIndex(chartData.length - 1);
    }
  }, [chartData.length]);

  const handleZoomIn = () => {
    const total = chartData.length;
    if (total <= 6) return;
    const start = startIndex ?? 0;
    const end = endIndex ?? (total - 1);
    const span = end - start;
    if (span <= 6) return;
    const step = Math.max(2, Math.floor(span / 4));
    setStartIndex(Math.min(start + step, end - 5));
    setEndIndex(Math.max(end - step, start + 5));
  };

  const handleZoomOut = () => {
    const total = chartData.length;
    const start = startIndex ?? 0;
    const end = endIndex ?? (total - 1);
    const span = end - start;
    const step = Math.max(2, Math.floor(span / 2));
    setStartIndex(Math.max(0, start - step));
    setEndIndex(Math.min(total - 1, end + step));
  };

  const handleZoomPreset = (count) => {
    const total = chartData.length;
    if (!count || total <= count) {
      setStartIndex(0);
      setEndIndex(total - 1);
    } else {
      setStartIndex(Math.max(0, total - count));
      setEndIndex(total - 1);
    }
  };
  // Extract torque numbers
  const torqueValues = chartData
    .map(d => parseFloat(d.torque))
    .filter(val => !isNaN(val) && val > 0);

  const target = Number(targetTorque || 20.0);
  const minVal = Number(torqueMin || (target * 0.85).toFixed(1));
  const maxVal = Number(torqueMax || (target * 1.15).toFixed(1));

  // Custom Dot component: Red if outside tolerance limits, cyan/emerald if within
  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    if (!cx || !cy) return null;

    const t = parseFloat(payload.torque);
    const isOut = t < minVal || t > maxVal;

    return (
      <circle
        cx={cx}
        cy={cy}
        r={isOut ? 5.5 : 3.5}
        fill={isOut ? '#ef4444' : '#0284c7'}
        stroke="#ffffff"
        strokeWidth={1.5}
      />
    );
  };

  // Custom Light-Theme Tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const t = parseFloat(data.torque);
      const isOut = t < minVal || t > maxVal;

      return (
        <div style={{
          background: '#ffffff',
          border: `1px solid ${isOut ? 'var(--accent-red-border)' : 'var(--border-color)'}`,
          borderRadius: '8px',
          padding: '12px 14px',
          boxShadow: 'var(--shadow-md)',
          fontSize: '12px'
        }}>
          <div style={{
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '6px',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '4px'
          }}>
            Cycle #{data.index} • Engine: {data.engine_number}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Measured Torque:</span>
              <strong style={{ color: isOut ? '#dc2626' : '#0284c7', fontSize: '13px' }}>
                {data.torque} N·m {isOut && '⚠️ (LIMIT BREACH)'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Target Torque:</span>
              <strong style={{ color: '#047857' }}>{target} N·m</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Tolerance Range:</span>
              <span style={{ color: 'var(--text-secondary)' }}>[{minVal} – {maxVal} N·m]</span>
            </div>
            {data.angle && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Angle:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{data.angle}°</span>
              </div>
            )}
            {data.tightening_time && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Tightening Time:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{data.tightening_time}s</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Timestamp:</span>
              <span style={{ color: 'var(--text-secondary)' }}>{data.time || data.timestamp}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const maxDataTorque = torqueValues.length > 0 ? Math.max(...torqueValues) : target;
  const minDataTorque = torqueValues.length > 0 ? Math.min(...torqueValues) : target;
  const yDomainMax = Math.max(maxVal + 3, maxDataTorque + 2);
  const yDomainMin = Math.max(0, Math.floor(Math.min(minVal - 3, minDataTorque)));

  return (
    <div className="card" style={{ marginBottom: '22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Gauge size={18} color="var(--accent-cyan)" />
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Torque vs. Time Graph (Per Cycle)
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            • {toolName}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#0284c7' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Measured Torque</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '16px', height: '2px', background: '#10b981' }} />
            <span style={{ color: '#047857', fontWeight: 600 }}>Target ({target} N·m)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '16px', height: '2px', background: '#ef4444', borderTop: '2px dashed #ef4444' }} />
            <span style={{ color: 'var(--accent-red-text)' }}>Max ({maxVal} N·m)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '16px', height: '2px', background: '#f59e0b', borderTop: '2px dashed #f59e0b' }} />
            <span style={{ color: '#b45309' }}>Min ({minVal} N·m)</span>
          </div>
        </div>
      </div>

      {/* Interactive Zoom Toolbar for Torque Chart */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        padding: '8px 12px',
        background: 'var(--bg-subtle)',
        borderRadius: '8px',
        marginBottom: '14px',
        fontSize: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ZoomIn size={14} color="var(--accent-cyan)" /> Zoom:
          </span>
          <button
            type="button"
            onClick={() => handleZoomPreset(null)}
            className="btn btn-secondary"
            style={{ padding: '3px 8px', fontSize: '11px', height: '26px' }}
            title="Show all torque operations across shift"
          >
            All ({chartData.length})
          </button>
          <button
            type="button"
            onClick={() => handleZoomPreset(50)}
            className="btn btn-secondary"
            style={{ padding: '3px 8px', fontSize: '11px', height: '26px' }}
            title="Zoom into the last 50 cycles"
          >
            Last 50
          </button>
          <button
            type="button"
            onClick={() => handleZoomPreset(20)}
            className="btn btn-secondary"
            style={{ padding: '3px 8px', fontSize: '11px', height: '26px' }}
            title="Zoom into the last 20 operations"
          >
            Last 20
          </button>
          <button
            type="button"
            onClick={() => handleZoomPreset(10)}
            className="btn btn-secondary"
            style={{ padding: '3px 8px', fontSize: '11px', height: '26px' }}
            title="Zoom into the last 10 operations for close-up detail"
          >
            Last 10 (Detail)
          </button>

          <span style={{ width: '1px', height: '18px', background: 'var(--border-color)', margin: '0 2px' }} />

          <button
            type="button"
            onClick={handleZoomIn}
            className="btn btn-secondary"
            style={{ padding: '3px 8px', fontSize: '11px', height: '26px' }}
            title="Zoom in step (+)"
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="btn btn-secondary"
            style={{ padding: '3px 8px', fontSize: '11px', height: '26px' }}
            title="Zoom out step (-)"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            onClick={() => handleZoomPreset(null)}
            className="btn btn-secondary"
            style={{ padding: '3px 8px', fontSize: '11px', height: '26px' }}
            title="Reset torque chart zoom"
          >
            <RotateCcw size={13} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setShowLine(prev => !prev)}
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              border: '1px solid var(--border-color)',
              background: !showLine ? 'var(--accent-blue-light)' : 'transparent',
              color: !showLine ? 'var(--accent-blue)' : 'var(--text-secondary)'
            }}
          >
            {showLine ? 'Continuous Line' : 'Points Only'}
          </button>

          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            className="btn btn-secondary"
            style={{ padding: '3px 8px', fontSize: '11px', height: '26px', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Expand or collapse chart height"
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            <span>{expanded ? 'Collapse' : 'Expand Height (450px)'}</span>
          </button>
        </div>
      </div>

      <div style={{ width: '100%', height: expanded ? '450px' : '320px', transition: 'height 0.2s ease' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
            <defs>
              <linearGradient id="tngaTorqueGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0284c7" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#0284c7" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#94a3b8"
              fontSize={11}
              tickLine={false}
              dy={8}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={11}
              domain={[yDomainMin, yDomainMax]}
              tickLine={false}
              dx={-4}
              label={{ value: 'Torque (N·m)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Target Torque Reference Line */}
            <ReferenceLine
              y={target}
              stroke="#10b981"
              strokeWidth={1.8}
              label={{
                value: `Target: ${target} N·m`,
                fill: '#047857',
                position: 'insideTopLeft',
                fontSize: 11,
                fontWeight: 700
              }}
            />

            {/* Upper Torque Limit */}
            <ReferenceLine
              y={maxVal}
              stroke="#ef4444"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: `Max: ${maxVal} N·m`,
                fill: '#dc2626',
                position: 'top',
                fontSize: 11,
                fontWeight: 700
              }}
            />

            {/* Lower Torque Limit */}
            <ReferenceLine
              y={minVal}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: `Min: ${minVal} N·m`,
                fill: '#b45309',
                position: 'bottom',
                fontSize: 11,
                fontWeight: 700
              }}
            />

            {showLine && (
              <Area
                type="monotone"
                dataKey="torque"
                stroke="none"
                fill="url(#tngaTorqueGrad)"
              />
            )}

            <Line
              type="monotone"
              dataKey="torque"
              stroke={showLine ? "#0284c7" : "transparent"}
              strokeWidth={showLine ? 2 : 0}
              isAnimationActive={false}
              dot={<CustomDot />}
              activeDot={{ r: 7, stroke: '#ffffff', strokeWidth: 2, fill: '#0284c7' }}
              name="Measured Torque"
            />

            <Brush
              dataKey="time"
              height={28}
              stroke="#0284c7"
              fill="#f0f9ff"
              startIndex={startIndex}
              endIndex={endIndex}
              onChange={(e) => {
                if (e) {
                  setStartIndex(e.startIndex);
                  setEndIndex(e.endIndex);
                }
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>💡 <em>Drag the slider handles at the bottom of the graph to zoom into any time period. Drag the window to pan.</em></span>
        <span>Showing cycles {startIndex + 1} to {(endIndex !== undefined ? endIndex : chartData.length - 1) + 1} of {chartData.length}</span>
      </div>
    </div>
  );
}
