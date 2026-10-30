require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB, getDbStatus } = require('./src/config/db');

const overviewRoutes = require('./src/routes/overviewRoutes').router;
const wrenchesRoutes = require('./src/routes/wrenchesRoutes');
const assembliesRoutes = require('./src/routes/assembliesRoutes');
const trendsRoutes = require('./src/routes/trendsRoutes');
const toolChangeRoutes = require('./src/routes/toolChangeRoutes');
const alertsRoutes = require('./src/routes/alertsRoutes');
const rawRecordsRoutes = require('./src/routes/rawRecordsRoutes');

const app = express();
const PORT = process.env.PORT || 8140;

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

// Health Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'Pulse Monitoring Dashboard API',
    port: PORT,
    timestamp: new Date().toISOString(),
    database: getDbStatus()
  });
});

// Start Server
app.listen(PORT, async () => {
  console.log('=======================================================');
  console.log(`🚀 Pulse Monitoring Dashboard API running on port ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/health`);
  console.log(`🔧 Overview API: http://localhost:${PORT}/api/dashboard/overview`);
  console.log('=======================================================');
  await connectDB();
});
