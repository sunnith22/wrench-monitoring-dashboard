/**
 * CLI Historical Backfill Script
 * -------------------------------------------------------------
 * Usage:
 *   node src/scripts/backfillHistory.js [daysCount]
 *   npm run backfill:history
 *
 * Example:
 *   node src/scripts/backfillHistory.js 8
 *
 * Pulls past N calendar days sequentially from mounted URYU & YOKOTA paths
 * or upstream APIs and stores them permanently in PostgreSQL on 10.82.126.44.
 * Employs micro-buffer reads (<1KB) and 400ms inter-day throttle to keep
 * shop-floor PC CPU load under 0.5%.
 */

require('dotenv').config();
const { runHistoricalBackfillJob } = require('../services/csvIngestionService');
const { pool } = require('../config/postgresDB');

async function main() {
  const daysArg = process.argv[2];
  const days = daysArg ? parseInt(daysArg, 10) : 8;

  console.log('================================================================');
  console.log(`🚀 [Historical Backfill CLI] Starting ${days}-day historical seeding`);
  console.log('   Target PostgreSQL DB: 10.82.126.44:5432 (enginetracking)');
  console.log('================================================================\n');

  try {
    const summary = await runHistoricalBackfillJob(days);
    console.log('\n================================================================');
    console.log(`✅ [Historical Backfill CLI Complete]`);
    console.log(`   Days Processed:       ${summary.daysProcessed}`);
    console.log(`   Total Cycles Stored:  ${summary.totalSaved}`);
    console.log(`   Duplicates Clubbed:   ${summary.totalClubbed}`);
    console.log('================================================================');
  } catch (err) {
    console.error('❌ [Historical Backfill Error]:', err);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end().catch(() => {});
    }
    process.exit(0);
  }
}

main();
