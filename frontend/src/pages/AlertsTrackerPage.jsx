import React, { useState, useEffect } from 'react';
import { TngaApi } from '../services/api';
import { Bell, ShieldAlert, CheckCircle, Clock, Check, X, Filter } from 'lucide-react';

export default function AlertsTrackerPage({ onSelectWrench, onNavigateTab }) {
  const [alerts, setAlerts] = useState([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  // Investigation / Closure Modal State
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [actionNotes, setActionNotes] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [userName, setUserName] = useState('Line Supervisor');
  const [updating, setUpdating] = useState(false);

  const fetchAlerts = () => {
    setLoading(true);
    TngaApi.getAlerts({ status: statusFilter, severity: severityFilter })
      .then(res => setAlerts(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAlerts();
  }, [statusFilter, severityFilter]);

  const handleAcknowledge = async (alertId) => {
    try {
      await TngaApi.updateAlertStatus(alertId, {
        status: 'ACKNOWLEDGED',
        user_name: 'M. Tanaka (Supervisor)'
      });
      fetchAlerts();
    } catch (err) {
      alert(`Failed to acknowledge: ${err.message}`);
    }
  };

  const handleCloseAlert = async (e) => {
    e.preventDefault();
    if (!selectedAlert) return;
    setUpdating(true);

    try {
      await TngaApi.updateAlertStatus(selectedAlert.alert_id, {
        status: 'CLOSED',
        user_name: userName,
        investigation_notes: actionNotes,
        action_taken: actionTaken
      });
      setSelectedAlert(null);
      setActionNotes('');
      setActionTaken('');
      fetchAlerts();
    } catch (err) {
      alert(`Failed to close alert: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div>
      {/* 1. Header & Filters */}
      <div className="card" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Persistent Alert Tracker & Investigation Workflow (Section 2.7)
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Traceable shop-floor record of pulse and torque deviations. Alerts remain in history after closure.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Status Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="form-input"
                style={{ width: '130px', padding: '6px 10px', fontSize: '12px' }}
              >
                <option value="ALL">All Statuses</option>
                <option value="OPEN">Open Only</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
                <option value="INVESTIGATING">Investigating</option>
                <option value="CLOSED">Closed Only</option>
              </select>
            </div>

            {/* Severity Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Severity:</span>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="form-input"
                style={{ width: '130px', padding: '6px 10px', fontSize: '12px' }}
              >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARNING">Warning</option>
                <option value="INFO">Information</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Alerts Lifecycle Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Alert ID</th>
              <th>Wrench & Station</th>
              <th>Assembly / Sub-Assembly</th>
              <th>Severity</th>
              <th>Rule / Reason</th>
              <th>Measured Value</th>
              <th>Limit</th>
              <th>Engine No.</th>
              <th>Lifecycle Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No alerts matching the selected filters.
                </td>
              </tr>
            ) : (
              alerts.map(alt => (
                <tr key={alt.alert_id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{alt.alert_id}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{alt.tool_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{alt.wrench_id} • Station {alt.station}</div>
                  </td>
                  <td>
                    <div>{alt.assembly_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{alt.sub_assembly_name}</div>
                  </td>
                  <td>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: alt.severity === 'CRITICAL' ? 'var(--accent-red-light)' : 'var(--accent-amber-light)',
                      color: alt.severity === 'CRITICAL' ? 'var(--accent-red-text)' : 'var(--accent-amber-text)',
                      border: `1px solid ${alt.severity === 'CRITICAL' ? 'var(--accent-red-border)' : 'var(--accent-amber-border)'}`
                    }}>
                      {alt.severity}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px', fontWeight: 500 }}>{alt.rule_reason}</td>
                  <td>
                    <strong style={{ color: alt.severity === 'CRITICAL' ? 'var(--accent-red-text)' : 'var(--text-primary)' }}>
                      {alt.observed_value} {alt.unit}
                    </strong>
                  </td>
                  <td>{alt.threshold_limit} {alt.unit}</td>
                  <td style={{ fontFamily: 'monospace' }}>{alt.engine_number}</td>
                  <td>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: alt.status === 'OPEN' ? '#fee2e2' : alt.status === 'ACKNOWLEDGED' ? '#fef3c7' : '#dcfce7',
                      color: alt.status === 'OPEN' ? '#b91c1c' : alt.status === 'ACKNOWLEDGED' ? '#b45309' : '#15803d'
                    }}>
                      {alt.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {alt.status === 'OPEN' && (
                        <button
                          onClick={() => handleAcknowledge(alt.alert_id)}
                          className="btn btn-secondary"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                          title="Acknowledge Alert"
                        >
                          Acknowledge
                        </button>
                      )}
                      {alt.status !== 'CLOSED' && (
                        <button
                          onClick={() => setSelectedAlert(alt)}
                          className="btn btn-primary"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                        >
                          Investigate / Close
                        </button>
                      )}
                      {alt.status === 'CLOSED' && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Closed by {alt.closed_by || 'Tech'}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 3. Investigation & Closure Modal */}
      {selectedAlert && (
        <div className="modal-overlay" onClick={() => setSelectedAlert(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Investigate & Close Alert: {selectedAlert.alert_id}
              </h3>
              <button onClick={() => setSelectedAlert(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCloseAlert}>
              <div className="modal-body">
                <div style={{ padding: '10px 14px', background: 'var(--bg-subtle)', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
                  <strong>{selectedAlert.tool_name}</strong> ({selectedAlert.wrench_id})<br />
                  Measured: <strong style={{ color: 'var(--accent-red-text)' }}>{selectedAlert.observed_value} pulses</strong> (Limit: {selectedAlert.threshold_limit}) • Engine: {selectedAlert.engine_number}
                </div>

                <div className="form-group">
                  <label className="form-label">Technician / Lead Name:</label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Investigation Notes / Findings:</label>
                  <textarea
                    rows="2"
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                    placeholder="e.g. Joint friction high due to dry thread, calibrated anvil..."
                    className="form-input"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Corrective Action Taken:</label>
                  <select
                    value={actionTaken}
                    onChange={(e) => setActionTaken(e.target.value)}
                    className="form-input"
                    required
                  >
                    <option value="">Select Action Taken...</option>
                    <option value="Joint re-torqued and verified with manual gauge">Joint re-torqued and verified with manual gauge</option>
                    <option value="Tool calibrated on shop-floor bench tester">Tool calibrated on shop-floor bench tester</option>
                    <option value="Tool removed for maintenance / fluid overhaul">Tool removed for maintenance / fluid overhaul</option>
                    <option value="Fastener batch replaced due to thread anomaly">Fastener batch replaced due to thread anomaly</option>
                    <option value="False alert / operational pause verified OK">False alert / operational pause verified OK</option>
                  </select>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setSelectedAlert(null)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={updating}>
                  {updating ? 'Saving...' : 'Mark Alert as Closed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
