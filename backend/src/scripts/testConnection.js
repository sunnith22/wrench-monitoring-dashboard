require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const POSTGRES_USER = process.env.POSTGRES_USER || 'tracedb';
const POSTGRES_HOST = process.env.POSTGRES_HOST || '10.82.126.44';
const POSTGRES_DB = process.env.POSTGRES_DB || 'tnga_wrench_db';
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'Toyota_2022';
const POSTGRES_PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10);

const URYU_MOUNT_PATH = process.env.URYU_MOUNT_PATH || '/mnt/torque_wrench';
const YOKOTA_MOUNT_PATH = process.env.YOKOTA_MOUNT_PATH || '/mnt/yokota';
const URYU_UNC_SHARE = process.env.URYU_UNC_SHARE || '\\\\172.16.105.234\\D';
const YOKOTA_UNC_SHARE = process.env.YOKOTA_UNC_SHARE || '\\\\172.16.105.234\\c';

async function runDiagnostic() {
  console.log('================================================================');
  console.log('   TOYOTA INDUSTRIES ENGINE INDIA (TIEI) - SYSTEM DIAGNOSTICS   ');
  console.log('   TNGA Impact Wrench Telemetry & Storage Verification          ');
  console.log('================================================================\n');

  console.log('Timestamp:', new Date().toISOString());
  console.log('Testing connectivity across plant infrastructure...\n');

  // 1. PostgreSQL Diagnostic
  console.log('----------------------------------------------------------------');
  console.log(`1. Testing PostgreSQL Database: ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`);
  console.log('----------------------------------------------------------------');

  const pool = new Pool({
    user: POSTGRES_USER,
    host: POSTGRES_HOST,
    database: POSTGRES_DB,
    password: POSTGRES_PASSWORD,
    port: POSTGRES_PORT,
    connectionTimeoutMillis: 3000
  });

  let pgClient = null;
  let pgConnected = false;
  let pgCyclesCount = 0;
  let pgCyclesTableExists = false;

  try {
    pgClient = await pool.connect();
    pgConnected = true;
    console.log(`✅ [PostgreSQL] Connected successfully to ${POSTGRES_HOST}:${POSTGRES_PORT} as '${POSTGRES_USER}'`);

    const resCycles = await pgClient.query("SELECT to_regclass('public.wrench_tightening_cycles') as tbl_exists;");
    pgCyclesTableExists = Boolean(resCycles.rows[0]?.tbl_exists);

    if (pgCyclesTableExists) {
      const countRes = await pgClient.query("SELECT COUNT(*) as cnt FROM wrench_tightening_cycles;");
      pgCyclesCount = parseInt(countRes.rows[0].cnt, 10);
      console.log(`✅ [PostgreSQL] Table 'wrench_tightening_cycles' verified (Total rows: ${pgCyclesCount})`);
    } else {
      console.log(`ℹ️ [PostgreSQL] Table 'wrench_tightening_cycles' not yet created. It will auto-create on backend startup.`);
    }
  } catch (err) {
    console.log(`❌ [PostgreSQL Error]: ${err.message}`);
    if (err.message.includes('ECONNREFUSED')) {
      console.log(`   -> Cannot reach ${POSTGRES_HOST}:${POSTGRES_PORT}. Verify network routing and firewall.`);
    }
  } finally {
    if (pgClient) pgClient.release();
    await pool.end().catch(() => {});
  }

  // 2. Mount Point & UNC Share Diagnostics
  console.log('\n----------------------------------------------------------------');
  console.log(`2. Testing Shop-Floor Data Sources (Mount Points & Shares)`);
  console.log('----------------------------------------------------------------');

  function checkPath(label, targetPath) {
    try {
      if (fs.existsSync(targetPath)) {
        const items = fs.readdirSync(targetPath);
        console.log(`✅ [${label}] Accessible: ${targetPath} (${items.length} items found)`);
        return true;
      } else {
        console.log(`ℹ️ [${label}] Not mounted or not found at: ${targetPath}`);
        return false;
      }
    } catch (err) {
      console.log(`⚠️ [${label}] Error accessing ${targetPath}: ${err.message}`);
      return false;
    }
  }

  console.log('Checking Linux Mounts:');
  const uryuMountOk = checkPath('URYU Linux Mount', URYU_MOUNT_PATH);
  const yokotaMountOk = checkPath('YOKOTA Linux Mount', YOKOTA_MOUNT_PATH);

  console.log('\nChecking Windows UNC Shares (for Windows host):');
  const uryuUncOk = checkPath('URYU Windows UNC', URYU_UNC_SHARE);
  const yokotaUncOk = checkPath('YOKOTA Windows UNC', YOKOTA_UNC_SHARE);

  // Summary
  console.log('\n================================================================');
  console.log('                    DIAGNOSTIC SUMMARY                          ');
  console.log('================================================================');
  console.log(`PostgreSQL Server (10.82.126.44): ${pgConnected ? 'CONNECTED ✅' : 'OFFLINE ❌'}`);
  console.log(`Cycles Table Active:              ${pgCyclesTableExists ? `YES (${pgCyclesCount} cycles stored) ✅` : 'PENDING INIT ℹ️'}`);
  console.log(`URYU Data Source Available:       ${(uryuMountOk || uryuUncOk) ? 'YES ✅' : 'OFFLINE (Check mount) ⚠️'}`);
  console.log(`YOKOTA Data Source Available:     ${(yokotaMountOk || yokotaUncOk) ? 'YES ✅' : 'OFFLINE (Check mount) ⚠️'}`);
  console.log(`Main Dashboard Telemetry Source:  PostgreSQL (10.82.126.44)`);
  console.log('================================================================\n');
}

runDiagnostic();
