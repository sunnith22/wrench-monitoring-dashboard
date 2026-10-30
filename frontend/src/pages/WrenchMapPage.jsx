import React, { useState, useEffect } from 'react';
import { TngaApi } from '../services/api';
import { MapPin, Search, Filter, Wrench, ArrowRight } from 'lucide-react';

export default function WrenchMapPage({ onSelectWrench, onNavigateTab }) {
  const [wrenches, setWrenches] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [assemblyFilter, setAssemblyFilter] = useState('ALL');
  const [brandFilter, setBrandFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    TngaApi.getWrenches({ search: searchTerm, assembly: assemblyFilter, brand: brandFilter })
      .then(res => setWrenches(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [searchTerm, assemblyFilter, brandFilter]);

  return (
    <div>
      {/* 1. Header & Filters */}
      <div className="card" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Wrench Map & Master Asset Register (Section 2.8)
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Central register of all 73 impact wrenches across Assembly 1, 2, and 3 with controller IPs and calibration dates.
            </p>
          </div>

          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Showing <strong>{wrenches.length}</strong> of 73 tools
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={15} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by ID, tool, serial or IP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '36px' }}
            />
          </div>

          {/* Assembly Filter */}
          <select
            value={assemblyFilter}
            onChange={(e) => setAssemblyFilter(e.target.value)}
            className="form-input"
            style={{ width: '180px' }}
          >
            <option value="ALL">All Assemblies</option>
            <option value="assembly-1">Assembly 1</option>
            <option value="assembly-2">Assembly 2</option>
            <option value="assembly-3">Assembly 3</option>
          </select>

          {/* Brand Filter */}
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="form-input"
            style={{ width: '140px' }}
          >
            <option value="ALL">All Brands</option>
            <option value="URYU">URYU (61)</option>
            <option value="YOKOTA">YOKOTA (12)</option>
          </select>
        </div>
      </div>

      {/* 2. Asset Register Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Wrench ID</th>
              <th>Tool Name & Fastener</th>
              <th>Assembly</th>
              <th>Sub-Assembly</th>
              <th>Station / Folder</th>
              <th>Brand</th>
              <th>Controller IP</th>
              <th>Tool Serial</th>
              <th>Pulse Limit</th>
              <th>Target Torque</th>
              <th>Accumulated Pulses</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {wrenches.map(tool => (
              <tr key={tool.wrench_id}>
                <td>
                  <strong style={{ color: 'var(--accent-blue)', fontFamily: 'monospace' }}>
                    {tool.wrench_id}
                  </strong>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{tool.tool_name}</div>
                </td>
                <td>{tool.assembly_name}</td>
                <td>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-subtle)', fontWeight: 600 }}>
                    {tool.sub_assembly_name}
                  </span>
                </td>
                <td>Station {tool.station} • F{tool.folder}</td>
                <td>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: tool.brand === 'YOKOTA' ? 'var(--accent-green-light)' : 'var(--accent-blue-light)',
                    color: tool.brand === 'YOKOTA' ? 'var(--accent-green-text)' : 'var(--accent-blue)'
                  }}>
                    {tool.brand}
                  </span>
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{tool.controller_ip}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{tool.tool_serial}</td>
                <td><strong style={{ color: 'var(--accent-red-text)' }}>{tool.default_pulse_threshold} pulses</strong></td>
                <td><strong>{tool.approved_torque_target} N·m</strong></td>
                <td>{tool.accumulated_pulses.toLocaleString()}</td>
                <td>
                  <button
                    onClick={() => {
                      onSelectWrench(tool.wrench_id);
                      onNavigateTab('wrench-analysis');
                    }}
                    className="btn btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                  >
                    Analyze
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
