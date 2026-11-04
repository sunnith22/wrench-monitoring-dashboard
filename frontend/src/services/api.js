import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 
  (typeof window !== 'undefined' 
    ? `${window.location.protocol}//${window.location.hostname}:8140/api` 
    : 'http://localhost:8140/api');

const client = axios.create({
  baseURL: API_BASE,
  timeout: 8000
});

export const TngaApi = {
  // Overview
  getOverview: () => client.get('/dashboard/overview').then(res => res.data),

  // Wrenches & Asset Register
  getWrenches: (params) => client.get('/wrenches', { params }).then(res => res.data),
  getWrenchDetail: (wrenchId, date) => client.get(`/wrenches/${wrenchId}`, { params: { date } }).then(res => res.data),

  // Assemblies
  getAssemblies: () => client.get('/assemblies').then(res => res.data),
  getAssemblyDetail: (assemblyId) => client.get(`/assemblies/${assemblyId}`).then(res => res.data),

  // Trends
  getDailyTrends: (wrenchId, days) =>
    client.get('/trends/daily', { params: { wrench_id: wrenchId, days } }).then(res => res.data),
  getComparativeTrends: (wrenchIds, days) =>
    client.get('/trends/compare', { params: { wrench_ids: wrenchIds, days } }).then(res => res.data),

  // Tool Changes
  getToolChanges: (params) => client.get('/tool-changes', { params }).then(res => res.data),
  recordToolChange: (data) => client.post('/tool-changes', data).then(res => res.data),

  // Alerts
  getAlerts: (params) => client.get('/alerts', { params }).then(res => res.data),
  updateAlertStatus: (alertId, data) => client.patch(`/alerts/${alertId}/status`, data).then(res => res.data),

  // Raw Data Records
  getRawRecords: (params) => client.get('/data/records', { params }).then(res => res.data)
};
