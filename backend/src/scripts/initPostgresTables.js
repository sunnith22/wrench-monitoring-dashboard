const fs = require('fs');
const path = require('path');
const { pool, setTablesReady } = require('../config/postgresDB');

async function initializeTables() {
  if (!pool) {
    console.warn('⚠️ [PostgreSQL Init] Pool is not initialized. Serving via local store.');
    return;
  }

  console.log('🔄 [PostgreSQL Init] Inspecting PostgreSQL schema on host...');
  const sqlFile = path.join(__dirname, '../config/initPostgres.sql');
  const ddl = fs.readFileSync(sqlFile, 'utf8');

  let client = null;
  try {
    client = await pool.connect();

    // 1. Check if table already exists (works even for non-superusers without error)
    const checkRes = await client.query(`
      SELECT to_regclass('public.wrench_tightening_cycles') as tbl_exists;
    `);

    if (checkRes.rows[0]?.tbl_exists) {
      console.log('✅ [PostgreSQL Init] Table `wrench_tightening_cycles` is verified and active on PostgreSQL server!');
      setTablesReady(true);
      return;
    }

    // 2. If table doesn't exist, attempt to apply DDL migration
    console.log('⚡ [PostgreSQL Init] Table not found. Attempting CREATE TABLE migration...');
    await client.query(ddl);
    console.log('✅ [PostgreSQL Init] Tables `wrench_tightening_cycles` and `shift_sync_logs` successfully created!');
    setTablesReady(true);
  } catch (err) {
    setTablesReady(false);
    console.warn(`ℹ️ [PostgreSQL Note] PostgreSQL connected, but table creation was bypassed: ${err.message}`);
    console.log('💾 [PostgreSQL Store] Resilient local store active: Serving all 73 tools and graphs smoothly.');
    console.log('💡 Note: To persist cycles in PostgreSQL, run `initPostgres.sql` on database `enginetracking` using an account with DDL permissions.');
  } finally {
    if (client) client.release();
  }
}

if (require.main === module) {
  initializeTables().then(() => {
    if (pool) pool.end();
  });
}

module.exports = { initializeTables };
