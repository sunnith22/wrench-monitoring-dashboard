import React, { useState, useEffect } from 'react';
import { TngaApi } from '../services/api';
import {
  Bell,
  ShieldAlert,
  CheckCircle,
  Clock,
  Check,
  X,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Info,
  ArrowRight
} from 'lucide-react';

export default function AlertsTrackerPage({ onSelectWrench, onNavigateTab, onAlertUpdated }) {
  const [alerts, setAlerts] = useState([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  // Investigation / Closure Modal State
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [actionNotes, setActionNotes] = useState('Joint friction checked and verified within standard.');
  const [actionTaken, setActionTaken] = useState('Joint re-torqued and verified with manual gauge');
  const [userName, setUserName] = useState('M. Tanaka (Line Lead)');
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

  const handleAcknowledge = async (e, alertId) => {
    e.stopPropagation();
    try {
      await TngaApi.updateAlertStatus(alertId, {
        status: 'ACKNOWLEDGED',
        user_name: 'M. Tanaka (Supervisor)'
      });
      fetchAlerts();
      if (onAlertUpdated) onAlertUpdated();
    } catch (err) {
      alert(`Failed to acknowledge: ${err.message}`);
    }
  };

  const handleQuickClose = async (e, alertId) => {
    e.stopPropagation();
    try {
      await TngaApi.updateAlertStatus(alertId, {
        status: 'CLOSED',
        user_name: 'Line Supervisor',
        investigation_notes: 'Quick close on shop floor: Tool calibrated and cycle verified normal.',
        action_taken: 'Tool calibrated on shop-floor bench tester'
      });
      fetchAlerts();
      if (onAlertUpdated) onAlertUpdated();
    } catch (err) {
      alert(`Failed to close: ${err.message}`);
    }
  };

  const handleCloseAlert = async (e) => {
    e.preventDefault();
    if (!selectedAlert) return;
    setUpdating(true);

    try {
      await TngaApi.updateAlertStatus(selectedAlert.alert_id, {
        status: 'CLOSED',
        user_name: userName || 'Maintenance Lead',
        investigation_notes: actionNotes || 'Fastener inspected and confirmed within nominal spec.',
        action_taken: actionTaken || 'Joint re-torqued and verified with manual gauge'
      });
      setSelectedAlert(null);
      fetchAlerts();
      if (onAlertUpdated) onAlertUpdated();
    } catch (err) {
      alert(`Failed to close alert: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div>
      {/* 1. Header & Filters */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bell size={20} color="var(--accent-red)" />
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                Persistent Alert Tracker & Investigation Workflow
              </h2>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
              Traceable shop-floor record of pulse and torque deviations. Click any alert row or use the action buttons to investigate and close issues.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
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
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Responsive Alerts Lifecycle Table */}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="data-table" style={{ width: '100%', minWidth: '950px' }}>
          <thead>
            <tr>
              <th style={{ width: '90px' }}>Alert ID</th>
              <th>Wrench & Station</th>
              <th>Assembly</th>
              <th style={{ width: '95px' }}>Severity</th>
              <th>Rule / Reason</th>
              <th>Deviation</th>
              <th style={{ width: '95px' }}>Engine No.</th>
              <th style={{ width: '110px' }}>Status</th>
              <th style={{ width: '210px', textAlign: 'center' }}>Actions / Close Issue</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No alerts matching the selected filters.
                </td>
              </tr>
            ) : (
              alerts.map(alt => {
                const isOpen = alt.status === 'OPEN';
                const isAck = alt.status === 'ACKNOWLEDGED';
                const isClosed = alt.status === 'CLOSED';

                return (
                  <tr
                    key={alt.alert_id}
                    onClick={() => setSelectedAlert(alt)}
                    style={{
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                      backgroundColor: isOpen ? '#fffdfd' : (isAck ? '#fffdf7' : 'transparent')
                    }}
                    title="Click row to open Investigation & Closure modal"
                  >
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {alt.alert_id}
                    </td>

                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{alt.tool_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {alt.wrench_id} • Station {alt.station}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontSize: '12px', fontWeight: 500 }}>{alt.assembly_name}</div>
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

                    <td style={{ fontSize: '12px', fontWeight: 500 }}>
                      {alt.rule_reason}
                    </td>

                    <td>
                      <div style={{ fontSize: '12px' }}>
                        <strong style={{ color: alt.severity === 'CRITICAL' ? 'var(--accent-red-text)' : '#b45309' }}>
                          {alt.observed_value}
                        </strong>
                        <span style={{ color: 'var(--text-muted)', marginLeft: '4px', fontSize: '11px' }}>
                          (Limit: {alt.threshold_limit} {alt.unit || 'pulses'})
                        </span>
                      </div>
                    </td>

                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {alt.engine_number || 'N/A'}
                    </td>

                    <td>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: isOpen ? '#fee2e2' : (isAck ? '#fef3c7' : '#dcfce7'),
                        color: isOpen ? '#b91c1c' : (isAck ? '#b45309' : '#15803d'),
                        border: `1px solid ${isOpen ? '#fecaca' : (isAck ? '#fde68a' : '#bbf7d0')}`
                      }}>
                        {alt.status}
                      </span>
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={e => e.stopPropagation()}>
                        {isOpen && (
                          <button
                            type="button"
                            onClick={(e) => handleAcknowledge(e, alt.alert_id)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            title="Acknowledge Alert"
                          >
                            Ack
                          </button>
                        )}

                        {!isClosed ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setSelectedAlert(alt)}
                              className="btn btn-primary"
                              style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                              title="Investigate and close alert"
                            >
                              <CheckCircle2 size={13} />
                              <span>Close Issue</span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => handleQuickClose(e, alt.alert_id)}
                              className="btn btn-secondary"
                              style={{ padding: '4px 6px', fontSize: '11px', color: '#16a34a' }}
                              title="Instant 1-Click Close"
                            >
                              ✓
                            </button>
                          </>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>
                              ✓ Resolved
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedAlert(alt)}
                              className="btn btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '10px' }}
                            >
                              View
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 3. Investigation & Closure Modal */}
      {selectedAlert && (
        <div className="modal-overlay" onClick={() => setSelectedAlert(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '580px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle2 size={18} color="#2563eb" />
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  {selectedAlert.status === 'CLOSED' ? `Alert Resolution: ${selectedAlert.alert_id}` : `Investigate & Close Alert: ${selectedAlert.alert_id}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAlert(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCloseAlert}>
              <div className="modal-body">
                {/* Alert Summary Box */}
                <div style={{
                  padding: '12px 14px',
                  background: selectedAlert.status === 'CLOSED' ? '#f0fdf4' : 'var(--bg-subtle)',
                  border: `1px solid ${selectedAlert.status === 'CLOSED' ? '#bbf7d0' : 'var(--border-color)'}`,
                  borderRadius: '8px',
                  marginBottom: '16px',
                  fontSize: '13px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <strong>{selectedAlert.tool_name}</strong>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: selectedAlert.severity === 'CRITICAL' ? '#fee2e2' : '#fef3c7',
                      color: selectedAlert.severity === 'CRITICAL' ? '#b91c1c' : '#b45309'
                    }}>
                      {selectedAlert.severity}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Station: <strong>{selectedAlert.station}</strong> • Wrench: <strong>{selectedAlert.wrench_id}</strong>
                  </div>
                  <div style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-primary)' }}>
                    Measured: <strong style={{ color: 'var(--accent-red-text)' }}>{selectedAlert.observed_value} pulses</strong> (Limit: {selectedAlert.threshold_limit}) • Engine: <strong>{selectedAlert.engine_number}</strong>
                  </div>
                </div>

                {selectedAlert.status === 'CLOSED' ? (
                  <div>
                    <div style={{ marginBottom: '12px', fontSize: '13px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Closed By: </span>
                      <strong>{selectedAlert.closed_by || 'Maintenance Lead'}</strong>
                      {selectedAlert.closed_at && (
                        <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '12px' }}>
                          ({new Date(selectedAlert.closed_at).toLocaleString()})
                        </span>
                      )}
                    </div>
                    <div style={{ marginBottom: '12px', fontSize: '13px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Action Taken: </span>
                      <strong>{selectedAlert.action_taken || 'Tool inspected and verified'}</strong>
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Investigation Notes: </span>
                      <p style={{ marginTop: '4px', padding: '10px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        {selectedAlert.investigation_notes || 'No extra notes recorded.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="form-group" style={{ marginBottom: '14px' }}>
                      <label className="form-label" style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px', display: 'block' }}>
                        Technician / Line Lead Name:
                      </label>
                      <input
                        type="text"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        className="form-input"
                        placeholder="e.g. M. Tanaka (Supervisor)"
                        required
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: '14px' }}>
                      <label className="form-label" style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px', display: 'block' }}>
                        Corrective Action Taken:
                      </label>
                      <select
                        value={actionTaken}
                        onChange={(e) => setActionTaken(e.target.value)}
                        className="form-input"
                        required
                      >
                        <option value="Joint re-torqued and verified with manual gauge">Joint re-torqued and verified with manual gauge</option>
                        <option value="Tool calibrated on shop-floor bench tester">Tool calibrated on shop-floor bench tester</option>
                        <option value="Tool removed for maintenance / fluid overhaul">Tool removed for maintenance / fluid overhaul</option>
                        <option value="Fastener batch replaced due to thread anomaly">Fastener batch replaced due to thread anomaly</option>
                        <option value="False alert / operational pause verified OK">False alert / operational pause verified OK</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label" style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px', display: 'block' }}>
                        Investigation Notes / Root Cause:
                      </label>
                      <textarea
                        rows="2"
                        value={actionNotes}
                        onChange={(e) => setActionNotes(e.target.value)}
                        placeholder="e.g. Joint friction high due to dry thread, calibrated anvil..."
                        className="form-input"
                        required
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedAlert(null)}
                  className="btn btn-secondary"
                  style={{ padding: '7px 14px' }}
                >
                  Close
                </button>
                {selectedAlert.status !== 'CLOSED' && (
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={updating}
                    style={{ padding: '7px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <CheckCircle2 size={15} />
                    <span>{updating ? 'Saving...' : 'Mark Alert as Closed & Resolved'}</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
