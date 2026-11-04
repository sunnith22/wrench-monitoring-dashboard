import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import AssemblyPage from './pages/AssemblyPage';
import WrenchAnalysisPage from './pages/WrenchAnalysisPage';
import TrendsPage from './pages/TrendsPage';
import AlertsTrackerPage from './pages/AlertsTrackerPage';
import ToolChangeLogPage from './pages/ToolChangeLogPage';
import WrenchMapPage from './pages/WrenchMapPage';
import RawDataPage from './pages/RawDataPage';
import { TngaApi } from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [selectedWrenchId, setSelectedWrenchId] = useState('URYU_ST28_F016');
  const [globalSearch, setGlobalSearch] = useState('');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const loadOverview = useCallback(() => {
    setLoading(true);
    TngaApi.getOverview()
      .then(res => {
        setOverview(res);
        setLastUpdated(res.last_data_update || new Date().toLocaleTimeString());
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadOverview();
    const interval = setInterval(loadOverview, 10000); // 10s automatic polling
    return () => clearInterval(interval);
  }, [loadOverview]);

  const handleGlobalSearchSubmit = (searchTerm) => {
    if (!searchTerm) return;
    // Switch to wrench analysis with this search
    setSelectedWrenchId(searchTerm.trim());
    setActiveTab('wrench-analysis');
  };

  const handleSelectWrench = (wrenchId) => {
    setSelectedWrenchId(wrenchId);
  };

  return (
    <div className="app-container">
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        globalSearch={globalSearch}
        onGlobalSearchChange={setGlobalSearch}
        onGlobalSearchSubmit={handleGlobalSearchSubmit}
        openAlertsCount={overview?.kpi?.open_alerts || 0}
        onRefresh={loadOverview}
        loading={loading}
        lastUpdated={lastUpdated}
      />

      <main className="main-content">
        {activeTab === 'home' && (
          <HomePage
            overview={overview}
            onNavigateTab={setActiveTab}
            onSelectWrench={handleSelectWrench}
          />
        )}

        {activeTab === 'assembly-1' && (
          <AssemblyPage
            assemblyId="assembly-1"
            onSelectWrench={handleSelectWrench}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'assembly-2' && (
          <AssemblyPage
            assemblyId="assembly-2"
            onSelectWrench={handleSelectWrench}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'assembly-3' && (
          <AssemblyPage
            assemblyId="assembly-3"
            onSelectWrench={handleSelectWrench}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'wrench-analysis' && (
          <WrenchAnalysisPage
            wrenchId={selectedWrenchId}
            onSelectWrench={handleSelectWrench}
          />
        )}

        {activeTab === 'trends' && (
          <TrendsPage />
        )}

        {activeTab === 'alerts' && (
          <AlertsTrackerPage
            onSelectWrench={handleSelectWrench}
            onNavigateTab={setActiveTab}
            onAlertUpdated={loadOverview}
          />
        )}

        {activeTab === 'tool-change' && (
          <ToolChangeLogPage />
        )}

        {activeTab === 'wrench-map' && (
          <WrenchMapPage
            onSelectWrench={handleSelectWrench}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'raw-data' && (
          <RawDataPage />
        )}
      </main>
    </div>
  );
}
