const { Pool } = require('pg');

const POSTGRES_USER = process.env.POSTGRES_USER || 'tracedb';
const POSTGRES_HOST = process.env.POSTGRES_HOST || '10.82.126.27';
const POSTGRES_DB = process.env.POSTGRES_DB || 'enginetracking';
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'Toyota_2022';
const POSTGRES_PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10);

let pool = null;
let isConnected = false;
let connectionError = null;

// Local In-Memory Fallback Store (active if shop-floor network 10.82.126.27 is unreachable)
const localFallbackCycles = [];
const localFallbackSyncLogs = [];

try {
  pool = new Pool({
    user: POSTGRES_USER,
    host: POSTGRES_HOST,
    database: POSTGRES_DB,
    password: POSTGRES_PASSWORD,
    port: POSTGRES_PORT,
    max: 20,                          // Maximum 20 connections in pool
    min: 4,                           // Keep 4 idle connections ready
    idleTimeoutMillis: 30000,         // Close idle connections after 30s
    connectionTimeoutMillis: 4000     // Return error if connection cannot be acquired in 4s
  });

  // Test connection on startup
  pool.connect((err, client, release) => {
    if (err) {
      isConnected = false;
      connectionError = err.message;
      console.warn(`⚠️ [PostgreSQL Warning] Could not connect to ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB} (${err.message}).`);
      console.log('💾 [PostgreSQL] Fallback Store Active: Local in-memory caching will serve dashboard until plant network connects.');
      return;
    }
    isConnected = true;
    connectionError = null;
    console.log(`✅ [PostgreSQL] Successfully connected to ${POSTGRES_DB} at ${POSTGRES_HOST}:${POSTGRES_PORT}`);
    release();
  });

  // Handle idle client errors without crashing the Node.js process
  pool.on('error', (err) => {
    console.error('⚠️ [PostgreSQL Pool Error] Unexpected error on idle client:', err.message);
  });
} catch (e) {
  isConnected = false;
  connectionError = e.message;
  console.warn(`⚠️ [PostgreSQL Init Warning]: ${e.message}`);
}

/**
 * Resilient query executor that falls back to in-memory store if PostgreSQL is temporarily unreachable
 */
async function query(text, params = []) {
  if (pool && isConnected) {
    try {
      const start = Date.now();
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      if (process.env.DEBUG_SQL) {
        console.log(`[SQL Query] duration=${duration}ms rows=${res.rowCount}`);
      }
      return res;
    } catch (err) {
      console.warn(`[SQL Error] Query failed: ${err.message}. Falling back to cached memory store.`);
    }
  }

  // Fallback in-memory operations for development / offline plant network
  return executeInMemoryQuery(text, params);
}

/**
 * Lightweight in-memory query simulator for local testing without physical plant network
 */
function executeInMemoryQuery(text, params) {
  const sql = text.trim().toUpperCase();

  if (sql.startsWith('SELECT') && sql.includes('WRENCH_TIGHTENING_CYCLES')) {
    let rows = [...localFallbackCycles];
    if (params.length > 0 && typeof params[0] === 'string') {
      rows = rows.filter(r => r.wrench_id === params[0]);
    }
    return { rows, rowCount: rows.length };
  }

  if (sql.startsWith('SELECT') && sql.includes('SHIFT_SYNC_LOGS')) {
    return { rows: [...localFallbackSyncLogs].reverse().slice(0, 50), rowCount: localFallbackSyncLogs.length };
  }

  if (sql.startsWith('INSERT INTO WRENCH_TIGHTENING_CYCLES')) {
    // Basic mock insertion
    const newRecord = {
      id: localFallbackCycles.length + 1,
      wrench_id: params[0] || 'URYU_TOOL',
      tool_name: params[1] || 'Tool',
      station: params[2] || 'ST1',
      line: params[3] || 'MK1',
      engine_no: params[4] || 'ENG123',
      tightening_time: params[5] || new Date().toISOString(),
      torque_val: params[6] || 20.0,
      torque_status: params[7] || 'OK',
      angle_val: params[8] || 45.0,
      angle_status: params[9] || 'OK',
      pulse_count: params[10] || 20,
      pulse_status: params[11] || 'NORMAL',
      cycle_counter: params[12] || 1,
      folder: params[13] || '016',
      created_at: new Date().toISOString()
    };
    localFallbackCycles.push(newRecord);
    return { rows: [newRecord], rowCount: 1 };
  }

  if (sql.startsWith('INSERT INTO SHIFT_SYNC_LOGS')) {
    const newLog = {
      id: localFallbackSyncLogs.length + 1,
      sync_id: params[0] || 'SYNC_' + Date.now(),
      sync_source: params[1] || 'ADF_PIPELINE',
      window_name: params[2] || 'Scheduled Window',
      start_time: params[3] || new Date().toISOString(),
      end_time: params[4] || new Date().toISOString(),
      records_pulled: params[5] || 0,
      records_inserted: params[6] || 0,
      status: params[7] || 'SUCCESS',
      created_at: new Date().toISOString()
    };
    localFallbackSyncLogs.push(newLog);
    return { rows: [newLog], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
}

function getPostgresStatus() {
  return {
    connected: isConnected,
    host: POSTGRES_HOST,
    port: POSTGRES_PORT,
    database: POSTGRES_DB,
    user: POSTGRES_USER,
    error: connectionError,
    inMemoryRecords: localFallbackCycles.length
  };
}

module.exports = {
  pool,
  query,
  getPostgresStatus,
  localFallbackCycles,
  localFallbackSyncLogs
};
