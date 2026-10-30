const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://10.82.126.73:27017/tnga_wrench_monitoring';

let isMongoConnected = false;

// Disable Mongoose query buffering so operations fail immediately if Mongo is not connected
mongoose.set('bufferCommands', false);

async function connectDB() {
  try {
    console.log(`[MongoDB] Connecting to ${MONGO_URI}...`);
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
      socketTimeoutMS: 3000
    });
    isMongoConnected = true;
    console.log('✅ [MongoDB] Connected to TNGA Wrench Database.');
  } catch (err) {
    isMongoConnected = false;
    console.warn(`⚠️ [MongoDB Warning] External database not reachable: ${err.message}`);
    console.log('💾 [MongoDB] Active Fallback: Instant In-Memory Storage for asset register, tool changes & alerts.');
  }
}

function getDbStatus() {
  return {
    connected: isMongoConnected && mongoose.connection.readyState === 1,
    uri: MONGO_URI,
    readyState: mongoose.connection.readyState
  };
}

module.exports = {
  connectDB,
  getDbStatus
};
