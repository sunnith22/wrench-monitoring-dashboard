import React from 'react';
import {
  Wrench,
  Search,
  Activity,
  Bell,
  Home,
  Layers,
  TrendingUp,
  FileText,
  Repeat,
  MapPin,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

export default function Navbar({
  activeTab,
  onSelectTab,
  globalSearch,
  onGlobalSearchChange,
  onGlobalSearchSubmit,
  openAlertsCount,
  onRefresh,
  loading,
  lastUpdated
}) {
  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'assembly-1', label: 'Assembly 1', icon: Layers },
    { id: 'assembly-2', label: 'Assembly 2', icon: Layers },
    { id: 'assembly-3', label: 'Assembly 3', icon: Layers },
    { id: 'wrench-analysis', label: 'Wrench Analysis', icon: Wrench },
    { id: 'trends', label: 'Trends', icon: TrendingUp },
    { id: 'alerts', label: 'Alerts Tracker', icon: Bell, badge: openAlertsCount },
    { id: 'tool-change', label: 'Tool Change Log', icon: Repeat },
    { id: 'wrench-map', label: 'Wrench Map', icon: MapPin },
    { id: 'raw-data', label: 'Raw Data', icon: FileText }
  ];

  return (
    <header style={{ background: '#ffffff', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, zIndex: 100 }}>
      {/* Top Main Bar */}
      <div style={{
        padding: '14px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
            color: '#ffffff'
          }}>
            <Activity size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
              Pulse Monitoring Dashboard
            </h1>
          </div>
        </div>

        {/* Global Wrench Search (Section 2.4) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (onGlobalSearchSubmit) onGlobalSearchSubmit(globalSearch);
          }}
          style={{ position: 'relative', width: '320px', maxWidth: '100%' }}
        >
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search by Wrench ID (e.g. URYU_ST28_F016)..."
            value={globalSearch}
            onChange={(e) => onGlobalSearchChange(e.target.value)}
            className="form-input"
            style={{ paddingLeft: '36px', height: '38px', fontSize: '13px' }}
          />
        </form>

        {/* Actions & Health Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Data Freshness Indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            borderRadius: '8px',
            background: 'var(--accent-green-light)',
            border: '1px solid var(--accent-green-border)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--accent-green-text)'
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
            <span>Feed: Active ({lastUpdated || 'Live'})</span>
          </div>

          {/* Quick Refresh Button */}
          <button onClick={onRefresh} className="btn btn-secondary" disabled={loading} style={{ padding: '6px 12px' }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            <span>Refresh</span>
          </button>

          {/* Admin Control Portal Link */}
          <a
            href="http://localhost:3020"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{
              padding: '6px 12px',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#2563eb',
              borderColor: '#bfdbfe',
              background: '#eff6ff',
              fontWeight: 600
            }}
            title="Open Admin Portal to change pulse limits and pulling schedule"
          >
            <ShieldCheck size={14} />
            <span>Admin Portal</span>
          </a>
        </div>
      </div>

      {/* Navigation Tabs Bar (Section 2.10) */}
      <nav className="nav-tabs">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`nav-tab-btn ${isActive ? 'active' : ''}`}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
              {tab.badge > 0 && (
                <span style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  background: '#ef4444',
                  color: '#ffffff',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  marginLeft: '4px'
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
