import React, { useState, useEffect } from 'react';
import { TngaApi } from '../services/api';
import { FileText, Download, Search, ChevronLeft, ChevronRight } from 'lucide-react';

export default function RawDataPage() {
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchRecords = (p = 1) => {
    setLoading(true);
    TngaApi.getRawRecords({ page: p, limit: 25, search: searchTerm })
      .then(res => {
        setRecords(res.data || []);
        setPage(res.current_page || 1);
        setTotalPages(res.total_pages || 1);
        setTotalRecords(res.total_count || 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRecords(1);
  }, [searchTerm]);

  const handleExportCSV = () => {
    if (records.length === 0) return;
    const headers = ['Record Key', 'Timestamp', 'Wrench ID', 'Tool Name', 'Engine Number', 'Work No', 'Pulse Count', 'Torque (Nm)', 'Angle (deg)', 'Duration (s)', 'Judgement', 'Source File', 'Status'];
    const rows = records.map(r => [
      r.record_key,
      r.timestamp,
      r.wrench_id,
      `"${r.tool_name}"`,
      r.engine_number,
      r.work_no,
      r.pulse_count,
      r.torque,
      r.angle,
      r.tightening_time,
      r.judgement,
      r.source_file,
      r.import_status
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `TNGA_Raw_Tightening_Records_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      {/* 1. Header & Actions */}
      <div className="card" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginBottom: '14px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Raw Tightening Operation Records Explorer (Section 2.10)
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Audit-grade operation data preserving vendor source fields, unique hashes, and validation status.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={handleExportCSV} className="btn btn-secondary">
              <Download size={15} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', maxWidth: '380px' }}>
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search by Engine, Wrench, or Key..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input"
            style={{ paddingLeft: '36px' }}
          />
        </div>
      </div>

      {/* 2. Raw Records Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '20px' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Record Key</th>
              <th>Operation Timestamp</th>
              <th>Wrench ID</th>
              <th>Tool Name</th>
              <th>Engine Barcode</th>
              <th>Work No.</th>
              <th>Pulses</th>
              <th>Torque</th>
              <th>Angle</th>
              <th>Time</th>
              <th>Judgement</th>
              <th>Source File</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="13" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  Loading operation records...
                </td>
              </tr>
            ) : records.map(r => (
              <tr key={r.record_key}>
                <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--accent-blue)' }}>{r.record_key}</td>
                <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{r.timestamp}</td>
                <td style={{ fontWeight: 600 }}>{r.wrench_id}</td>
                <td>{r.tool_name}</td>
                <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.engine_number}</td>
                <td>{r.work_no}</td>
                <td><strong>{r.pulse_count}</strong></td>
                <td>{r.torque} N·m</td>
                <td>{r.angle}°</td>
                <td>{r.tightening_time}s</td>
                <td>
                  <span className={`badge ${r.judgement === 'OK' ? 'badge-normal' : 'badge-critical'}`}>
                    {r.judgement}
                  </span>
                </td>
                <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.source_file}</td>
                <td>
                  <span style={{ fontSize: '11px', color: 'var(--accent-green-text)', fontWeight: 600 }}>
                    {r.import_status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 3. Pagination Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalRecords} total operations)
        </span>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => fetchRecords(page - 1)}
            disabled={page <= 1}
            className="btn btn-secondary"
            style={{ padding: '6px 12px' }}
          >
            <ChevronLeft size={16} />
            <span>Previous</span>
          </button>
          <button
            onClick={() => fetchRecords(page + 1)}
            disabled={page >= totalPages}
            className="btn btn-secondary"
            style={{ padding: '6px 12px' }}
          >
            <span>Next</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
