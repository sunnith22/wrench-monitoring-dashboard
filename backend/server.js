require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getPostgresStatus } = require('./src/config/postgresDB');
const { initializeTables } = require('./src/scripts/initPostgresTables');

const overviewRoutes = require('./src/routes/overviewRoutes').router;
const wrenchesRoutes = require('./src/routes/wrenchesRoutes');
const assembliesRoutes = require('./src/routes/assembliesRoutes');
const trendsRoutes = require('./src/routes/trendsRoutes');
const toolChangeRoutes = require('./src/routes/toolChangeRoutes');
const alertsRoutes = require('./src/routes/alertsRoutes');
const rawRecordsRoutes = require('./src/routes/rawRecordsRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const mountApiRoutes = require('./src/routes/mountApiRoutes');
const { startDynamicSyncScheduler } = require('./src/services/shiftSyncWorker');

const app = express();
const PORT = process.env.PORT || 8143;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/dashboard/overview', overviewRoutes);
app.use('/api/wrenches', wrenchesRoutes);
app.use('/api/assemblies', assembliesRoutes);
app.use('/api/trends', trendsRoutes);
app.use('/api/tool-changes', toolChangeRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/data/records', rawRecordsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/mount', mountApiRoutes);

// Health Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'Pulse Monitoring Dashboard API',
    port: PORT,
    timestamp: new Date().toISOString(),
    postgresql: getPostgresStatus()
  });
});

// Start Server
app.listen(PORT, async () => {
  console.log('=======================================================');
  console.log(`🚀 Pulse Monitoring Dashboard API running on port ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/health`);
  console.log(`🔧 Overview API: http://localhost:${PORT}/api/dashboard/overview`);
  console.log(`⚙️ Admin API: http://localhost:${PORT}/api/admin/schedule`);
  console.log(`🔌 Mount API: http://localhost:${PORT}/api/mount/telemetry?folder=029`);
  console.log('=======================================================');
  await initializeTables();
  startDynamicSyncScheduler();
});
