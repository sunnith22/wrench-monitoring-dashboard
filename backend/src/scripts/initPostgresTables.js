const fs = require('fs');
const path = require('path');
const { pool, query } = require('../config/postgresDB');

async function initializeTables() {
  console.log('🔄 [PostgreSQL Init] Checking table existence in database...');
  const sqlFile = path.join(__dirname, '../config/initPostgres.sql');
  const ddl = fs.readFileSync(sqlFile, 'utf8');

  try {
    if (!pool) {
      console.warn('⚠️ [PostgreSQL Init] Pool is not initialized. Tables will exist in-memory.');
      return;
    }

    const client = await pool.connect();
    try {
      console.log('⚡ [PostgreSQL Init] Running DDL migration on PostgreSQL database...');
      await client.query(ddl);
      console.log('✅ [PostgreSQL Init] Tables `wrench_tightening_cycles` and `shift_sync_logs` successfully created or verified!');
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(`⚠️ [PostgreSQL Init Warning] Could not execute DDL on host: ${err.message}`);
    console.log('💡 Note: When on the factory network (10.82.126.27), run: node src/scripts/initPostgresTables.js to apply schema.');
  }
}

if (require.main === module) {
  initializeTables().then(() => {
    if (pool) pool.end();
  });
}

module.exports = { initializeTables };
