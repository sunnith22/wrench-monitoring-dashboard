require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const POSTGRES_USER = process.env.POSTGRES_USER || 'tracedb';
const POSTGRES_HOST = process.env.POSTGRES_HOST || '10.82.126.44';
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'Toyota_2022';
const POSTGRES_PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10);
const TARGET_DB = process.env.POSTGRES_DB || 'tnga_wrench_db';

async function setupNewDatabase() {
  console.log('================================================================');
  console.log('   TOYOTA INDUSTRIES ENGINE INDIA (TIEI) - POSTGRESQL SETUP     ');
  console.log(`   Initializing New Dedicated Database: ${TARGET_DB}            `);
  console.log('================================================================\n');

  // 1. Connect to default maintenance database 'postgres' to check / create TARGET_DB
  const adminClient = new Client({
    user: POSTGRES_USER,
    host: POSTGRES_HOST,
    database: 'postgres',
    password: POSTGRES_PASSWORD,
    port: POSTGRES_PORT,
    connectionTimeoutMillis: 4000
  });

  let dbCreated = false;
  try {
    console.log(`📡 Connecting to PostgreSQL host ${POSTGRES_HOST}:${POSTGRES_PORT} as '${POSTGRES_USER}'...`);
    await adminClient.connect();
    console.log(`✅ Connected to maintenance database.`);

    const checkRes = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1;",
      [TARGET_DB]
    );

    if (checkRes.rows.length > 0) {
      console.log(`✅ Database '${TARGET_DB}' already exists on host.`);
      dbCreated = true;
    } else {
      console.log(`⚡ Creating new database '${TARGET_DB}'...`);
      await adminClient.query(`CREATE DATABASE "${TARGET_DB}";`);
      console.log(`🎉 Database '${TARGET_DB}' created successfully!`);
      dbCreated = true;
    }
  } catch (err) {
    console.warn(`ℹ️ [Database Creation Note]: ${err.message}`);
    console.log(`\n💡 If user '${POSTGRES_USER}' does not have CREATEDB privileges:`);
    console.log(`   Run the following commands in psql or pgAdmin connected as postgres:`);
    console.log(`   ------------------------------------------------------------`);
    console.log(`   CREATE DATABASE "${TARGET_DB}";`);
    console.log(`   GRANT ALL PRIVILEGES ON DATABASE "${TARGET_DB}" TO ${POSTGRES_USER};`);
    console.log(`   ------------------------------------------------------------\n`);
  } finally {
    await adminClient.end().catch(() => {});
  }

  // 2. Connect to the new database and create tables & indexes
  console.log(`\n🔄 Connecting directly to new database '${TARGET_DB}' to apply schema...`);
  const targetClient = new Client({
    user: POSTGRES_USER,
    host: POSTGRES_HOST,
    database: TARGET_DB,
    password: POSTGRES_PASSWORD,
    port: POSTGRES_PORT,
    connectionTimeoutMillis: 4000
  });

  try {
    await targetClient.connect();
    console.log(`✅ Connected to '${TARGET_DB}'. Applying tables and indexes...`);

    const sqlFile = path.join(__dirname, '../config/initPostgres.sql');
    const ddl = fs.readFileSync(sqlFile, 'utf8');

    await targetClient.query(ddl);
    console.log(`✅ Tables 'wrench_tightening_cycles' and 'shift_sync_logs' are ready in '${TARGET_DB}'!`);

    const countRes = await targetClient.query("SELECT COUNT(*) as cnt FROM wrench_tightening_cycles;");
    console.log(`📊 Current cycle records in '${TARGET_DB}': ${countRes.rows[0].cnt}`);
    console.log(`\n================================================================`);
    console.log(`🎉 [Setup Complete] Database '${TARGET_DB}' is fully active and ready!`);
    console.log(`================================================================\n`);
  } catch (err) {
    console.error(`❌ [Schema Init Error on ${TARGET_DB}]:`, err.message);
  } finally {
    await targetClient.end().catch(() => {});
  }
}

if (require.main === module) {
  setupNewDatabase();
}

module.exports = { setupNewDatabase };
