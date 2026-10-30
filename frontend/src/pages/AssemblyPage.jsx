import React, { useState, useEffect } from 'react';
import { TngaApi } from '../services/api';
import { Layers, Wrench, ArrowRight, ShieldAlert, CheckCircle } from 'lucide-react';

export default function AssemblyPage({ assemblyId, onSelectWrench, onNavigateTab }) {
  const [assemblyData, setAssemblyData] = useState(null);
  const [selectedSub, setSelectedSub] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    TngaApi.getAssemblyDetail(assemblyId)
      .then(res => {
        if (res.assembly) {
          setAssemblyData(res.assembly);
        }
      })
      .catch(err => console.error('Failed to load assembly:', err))
      .finally(() => setLoading(false));
  }, [assemblyId]);

  if (loading) {
    return <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading Assembly Details...</div>;
  }

  if (!assemblyData) {
    return <div style={{ padding: '60px', textAlign: 'center' }}>Assembly not found.</div>;
  }

  const subAssemblies = assemblyData.sub_assemblies || [];
  let displayedTools = [];
  if (selectedSub === 'ALL') {
    subAssemblies.forEach(sub => {
      displayedTools.push(...(sub.tools || []));
    });
  } else {
    const matched = subAssemblies.find(s => s.id === selectedSub);
    displayedTools = matched ? matched.tools : [];
  }

  return (
    <div>
      {/* Header */}
      <div className="card" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ padding: '8px', borderRadius: '8px', background: 'var(--accent-blue-light)', color: 'var(--accent-blue)' }}>
                <Layers size={20} />
              </div>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>
                {assemblyData.name}
              </h2>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {assemblyData.description}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Total Tools Assigned: <strong>{assemblyData.total_tools}</strong>
            </span>
          </div>
        </div>

        {/* Sub-Assembly Segmented Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Filter Sub-Assembly:
          </span>
          <button
            onClick={() => setSelectedSub('ALL')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: selectedSub === 'ALL' ? 'var(--accent-blue)' : 'var(--bg-subtle)',
              color: selectedSub === 'ALL' ? '#ffffff' : 'var(--text-secondary)'
            }}
          >
            All Sub-Assemblies ({assemblyData.total_tools})
          </button>
          {subAssemblies.map(sub => (
            <button
              key={sub.id}
              onClick={() => setSelectedSub(sub.id)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: selectedSub === sub.id ? 'var(--accent-blue)' : 'var(--bg-subtle)',
                color: selectedSub === sub.id ? '#ffffff' : 'var(--text-secondary)'
              }}
            >
              {sub.name} ({sub.tool_count})
            </button>
          ))}
        </div>
      </div>

      {/* Tools Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Wrench ID</th>
              <th>Tool Name & Operation</th>
              <th>Sub-Assembly</th>
              <th>Station / Folder</th>
              <th>Brand</th>
              <th>Target Torque</th>
              <th>Pulse Threshold</th>
              <th>Accumulated Pulses</th>
              <th>Serial Number</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {displayedTools.map(tool => (
              <tr key={tool.wrench_id}>
                <td>
                  <strong style={{ color: 'var(--accent-blue)' }}>{tool.wrench_id}</strong>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{tool.tool_name}</div>
                </td>
                <td>
                  <span style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'var(--bg-subtle)',
                    color: 'var(--text-secondary)',
                    fontWeight: 600
                  }}>
                    {tool.sub_assembly_name}
                  </span>
                </td>
                <td>
                  Station {tool.station} • F{tool.folder}
                </td>
                <td>
                  <span style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: tool.brand === 'YOKOTA' ? 'var(--accent-green-light)' : 'var(--accent-blue-light)',
                    color: tool.brand === 'YOKOTA' ? 'var(--accent-green-text)' : 'var(--accent-blue)',
                    fontWeight: 700
                  }}>
                    {tool.brand}
                  </span>
                </td>
                <td>
                  <strong>{tool.approved_torque_target} N·m</strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    [{tool.approved_torque_min} - {tool.approved_torque_max}]
                  </div>
                </td>
                <td>
                  <strong style={{ color: 'var(--accent-red-text)' }}>
                    {tool.default_pulse_threshold} pulses
                  </strong>
                </td>
                <td>
                  {tool.accumulated_pulses.toLocaleString()} pulses
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                  {tool.tool_serial}
                </td>
                <td>
                  <button
                    onClick={() => {
                      onSelectWrench(tool.wrench_id);
                      onNavigateTab('wrench-analysis');
                    }}
                    className="btn btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '11px' }}
                  >
                    <span>Analyze</span>
                    <ArrowRight size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
