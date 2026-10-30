import React, { useState, useEffect } from 'react';
import { TngaApi } from '../services/api';
import { Repeat, Plus, CheckCircle, Clock, ShieldAlert } from 'lucide-react';

export default function ToolChangeLogPage() {
  const [wrenchesList, setWrenchesList] = useState([]);
  const [history, setHistory] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form Fields
  const [selectedWrenchId, setSelectedWrenchId] = useState('');
  const [pulsesAtChange, setPulsesAtChange] = useState('');
  const [changeType, setChangeType] = useState('PLANNED_THRESHOLD');
  const [removedSerial, setRemovedSerial] = useState('');
  const [replacementSerial, setReplacementSerial] = useState('');
  const [technicianName, setTechnicianName] = useState('');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);

  const loadData = () => {
    setLoading(true);
    Promise.all([TngaApi.getWrenches(), TngaApi.getToolChanges()])
      .then(([wRes, tcRes]) => {
        setWrenchesList(wRes.data || []);
        setHistory(tcRes.data || []);
        if (wRes.data && wRes.data.length > 0 && !selectedWrenchId) {
          setSelectedWrenchId(wRes.data[0].wrench_id);
          setRemovedSerial(wRes.data[0].tool_serial);
          setPulsesAtChange(wRes.data[0].accumulated_pulses || 500000);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleWrenchSelect = (id) => {
    setSelectedWrenchId(id);
    const found = wrenchesList.find(w => w.wrench_id === id);
    if (found) {
      setRemovedSerial(found.tool_serial);
      setPulsesAtChange(found.accumulated_pulses || 500000);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSuccessMsg(null);

    try {
      const res = await TngaApi.recordToolChange({
        wrench_id: selectedWrenchId,
        pulses_at_change: Number(pulsesAtChange),
        change_type: changeType,
        removed_tool_serial: removedSerial,
        replacement_tool_serial: replacementSerial,
        technician_name: technicianName,
        comments
      });

      setSuccessMsg(`Replacement logged: ${res.data.change_id}. Tool counter reset for serial ${replacementSerial}.`);
      setShowForm(false);
      setReplacementSerial('');
      setComments('');
      loadData();
    } catch (err) {
      alert(`Failed to record tool change: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* 1. Header with Add Button */}
      <div className="card" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Manual Tool Change / Replacement Record Log (Section 2.3)
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Dedicated register to record tool replacements when reaching approved pulse thresholds or during unscheduled maintenance.
            </p>
          </div>

          <button onClick={() => setShowForm(!showForm)} className="btn btn-primary">
            <Plus size={16} />
            <span>{showForm ? 'Hide Form' : 'Record New Tool Replacement'}</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div style={{ padding: '12px 18px', background: 'var(--accent-green-light)', border: '1px solid var(--accent-green-border)', borderRadius: '8px', color: 'var(--accent-green-text)', marginBottom: '20px', fontWeight: 600, fontSize: '13px' }}>
          ✓ {successMsg}
        </div>
      )}

      {/* 2. Tool Replacement Form (Modal or Inline Drawer) */}
      {showForm && (
        <div className="card" style={{ marginBottom: '22px', border: '1px solid var(--accent-blue-border)', background: '#fafcff' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>
            New Tool Replacement Entry
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="grid-cols-2">
              <div className="form-group">
                <label className="form-label">Impact Wrench to Replace:</label>
                <select
                  value={selectedWrenchId}
                  onChange={(e) => handleWrenchSelect(e.target.value)}
                  className="form-input"
                  required
                >
                  {wrenchesList.map(w => (
                    <option key={w.wrench_id} value={w.wrench_id}>
                      [{w.brand}] {w.wrench_id} - {w.tool_name} ({w.assembly_name} • {w.sub_assembly_name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Replacement Reason (Section 2.3):</label>
                <select
                  value={changeType}
                  onChange={(e) => setChangeType(e.target.value)}
                  className="form-input"
                  required
                >
                  <option value="PLANNED_THRESHOLD">Planned: Reached Approved Pulse Threshold</option>
                  <option value="UNPLANNED_FAULT">Unplanned: Mechanical / Electrical Fault</option>
                  <option value="QUALITY_CONCERN">Unplanned: Quality Concern / Joint Failure</option>
                  <option value="PREVENTATIVE">Preventative Maintenance & Calibration</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Accumulated Pulses at Replacement:</label>
                <input
                  type="number"
                  value={pulsesAtChange}
                  onChange={(e) => setPulsesAtChange(e.target.value)}
                  className="form-input"
                  placeholder="e.g. 504120"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Decommissioned Tool Serial Number:</label>
                <input
                  type="text"
                  value={removedSerial}
                  onChange={(e) => setRemovedSerial(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Replacement (New) Tool Serial Number:</label>
                <input
                  type="text"
                  value={replacementSerial}
                  onChange={(e) => setReplacementSerial(e.target.value)}
                  placeholder="e.g. SN-URYU-48299"
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Technician / Maintenance Lead Name:</label>
                <input
                  type="text"
                  value={technicianName}
                  onChange={(e) => setTechnicianName(e.target.value)}
                  placeholder="e.g. K. Patel (Maintenance Team A)"
                  className="form-input"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Comments / Investigation Notes:</label>
              <textarea
                rows="2"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Details of calibration, anvil replacement, or reason for tool change..."
                className="form-input"
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Recording...' : 'Save Tool Change Record & Reset Counter'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 3. Replacement History Audit Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Historical Replacement Audit Log (Immutable History)
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {history.length} Replacement Events Recorded
          </span>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Change ID</th>
              <th>Date & Time</th>
              <th>Wrench & Station</th>
              <th>Assembly</th>
              <th>Change Reason</th>
              <th>Pulses at Change</th>
              <th>Old Serial</th>
              <th>New Serial</th>
              <th>Technician</th>
              <th>Comments</th>
            </tr>
          </thead>
          <tbody>
            {history.map(item => (
              <tr key={item.change_id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{item.change_id}</td>
                <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {new Date(item.change_timestamp).toLocaleDateString()} {new Date(item.change_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{item.tool_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.wrench_id} • Station {item.station}</div>
                </td>
                <td>{item.assembly_name}</td>
                <td>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: item.change_type === 'PLANNED_THRESHOLD' ? 'var(--accent-blue-light)' : 'var(--accent-red-light)',
                    color: item.change_type === 'PLANNED_THRESHOLD' ? 'var(--accent-blue)' : 'var(--accent-red-text)',
                    border: `1px solid ${item.change_type === 'PLANNED_THRESHOLD' ? 'var(--accent-blue-border)' : 'var(--accent-red-border)'}`
                  }}>
                    {item.change_type.replace('_', ' ')}
                  </span>
                </td>
                <td><strong>{item.pulses_at_change.toLocaleString()}</strong></td>
                <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{item.removed_tool_serial}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--accent-green-text)', fontWeight: 700 }}>{item.replacement_tool_serial}</td>
                <td>{item.technician_name}</td>
                <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{item.comments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
