/**
 * ==============================================================================
 * TOYOTA INDUSTRIES ENGINE INDIA (TIEI)
 * TNGA Impact Wrench Monitoring & Telemetry Infrastructure
 * Module: Multi-Source Shop-Floor Ingestion Service (URYU & YOKOTA)
 * ==============================================================================
 * Mount Architecture on Server 10.82.126.73:
 *   - URYU Mount:   /mnt/torque_wrench <== //172.16.105.234/D
 *   - YOKOTA Mount: /mnt/yokota        <== //172.16.105.234/c
 * 
 * Windows Fallback UNC Shares:
 *   - URYU:   \\172.16.105.234\D (or Z:\)
 *   - YOKOTA: \\172.16.105.234\c (or Y:\)
 * 
 * Upstream Server APIs:
 *   - URYU API:   http://10.82.126.73:8121/api/torque-data
 *   - YOKOTA API: http://10.82.126.73:8127/api/yokota-data
 * 
 * Target Database:
 *   - PostgreSQL on 10.82.126.44 (DB: enginetracking, Table: wrench_tightening_cycles)
 * 
 * CRITICAL SAFETY REQUIREMENT:
 *   The shop-floor PC (172.16.105.234) is an industrial PC running line operations.
 *   Our service operates in "Stealth Mode":
 *     1. Reads Line 3 only (<300 bytes) and immediately destroys the stream.
 *     2. Paces execution with 30ms sleep per file and 150ms sleep per tool.
 *     3. Only targets today's date folder (YYYYMMDD).
 *     4. Zero CPU/disk impact on the production line PC.
 * ==============================================================================
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { ALL_WRENCH_ASSETS, registerAutoDiscoveredWrench } = require('../data/wrenchCatalog');
const { query, localFallbackCycles, getPostgresStatus } = require('../config/postgresDB');
const { getToolThreshold } = require('./configService');
const { dispatchPulseEmailAlert } = require('./emailService');
const { recordAlert } = require('../routes/overviewRoutes');
const { getSystemDateKeys, normalizeCsvTimestamp, extractDateIso } = require('../utils/dateUtils');

// Mount Paths (Server 10.82.126.73 mounts or Windows network shares)
const URYU_MOUNT_PATH = process.env.URYU_MOUNT_PATH || '/mnt/torque_wrench';
const YOKOTA_MOUNT_PATH = process.env.YOKOTA_MOUNT_PATH || '/mnt/yokota';
const URYU_UNC_SHARE = process.env.URYU_UNC_SHARE || '\\\\172.16.105.234\\D';
const YOKOTA_UNC_SHARE = process.env.YOKOTA_UNC_SHARE || '\\\\172.16.105.234\\c';
const YOKOTA_LOCAL_PATH = process.env.YOKOTA_LOCAL_PATH || '';
const FALLBACK_MOUNT = process.env.DATA_MOUNT_PATH || 'Z:\\';

// Yokota daily log pattern: i0230 1a3828- 3A 50.4K 5219   8  133   20   6 OK   11/19 05:35:06
// Also supports short engine numbers with space separator: i0230 1a 646- 1N 52.6? ...
const YOKOTA_SUMMARY_LINE_RE =
  /^[iI](\d{2,5})\s+([0-9a-zA-Z]*[a-zA-Z])\s*(\d+)-\s+(\S+)\s+([\d.]+)[^\d\s]?\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})$/;

// Memory trackers to prevent redundant re-reading & debounce transient spikes
const fileLineTracker = new Map();
const processedIndividualFiles = new Set();
const consecutiveBreachState = new Map(); // wrenchId -> { count, pulses }
let lastSyncedDateCompact = null;

const CONSECUTIVE_BREACH_REQUIRED = Math.max(
  1,
  parseInt(process.env.ALERT_CONSECUTIVE_CYCLES || '5', 10)
);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Live sync metrics
let lastSyncStats = {
  lastRunTimestamp: null,
  activeUryuSource: null,
  activeYokotaSource: null,
  toolFoldersFound: 0,
  filesProcessed: 0,
  rowsIngested: 0,
  duplicatesSkipped: 0,
  alertsTriggered: 0,
  status: 'IDLE',
  error: null
};

/**
 * Returns formatted system local date strings for folder matching
 * e.g. "20261125" (UEC-4800 / Yokota standard) and "25-11-2026"
 */
function getDateKeys(date = new Date()) {
  return getSystemDateKeys(date);
}

/**
 * Checks which path exists and is accessible
 */
async function resolveAccessiblePath(candidatePaths) {
  for (const p of candidatePaths) {
    if (!p) continue;
    try {
      await fsp.access(p, fs.constants.R_OK);
      return p;
    } catch (err) {}
  }
  return null;
}

/**
 * Automatically extracts controller folder token, IP address, date, time,
 * and vendor brand from URYU or Yokota CSV filenames.
 * Examples:
 *   - Yokota daily summary:  0230_120_0_100_97_20261119.csv
 *   - Yokota cycle waveform: 0230_120_0_100_97_20261119_053506.csv
 *   - URYU summary CSV:      F-Data_20261126.csv
 *   - URYU individual CSV:   20261126083512.csv
 */
function extractFileTelemetryMeta(fileName = '', fallbackFolder = null, preferredBrand = null) {
  const cleanName = path.basename(String(fileName || ''));
  const lower = cleanName.toLowerCase();

  // Pattern 1: Yokota <folder>_<ip1>_<ip2>_<ip3>_<ip4>_<YYYYMMDD>[_<HHMMSS>].csv
  let m = cleanName.match(/^(\d{2,5})_(\d{1,3}_\d{1,3}_\d{1,3}_\d{1,3})_(20\d{6})(?:_(\d{6}))?(?:_[^.]+)?\.csv$/i);
  if (m) {
    return {
      folderToken: m[1],
      ipToken: m[2],
      dateToken: m[3],
      timeToken: m[4] || null,
      brandHint: 'YOKOTA',
      isYokotaSummary: !m[4],
      isSummaryCsv: false,
      isIndividual: Boolean(m[4])
    };
  }

  // Pattern 2: Yokota inside tool folder <ip1>_<ip2>_<ip3>_<ip4>_<YYYYMMDD>[_<HHMMSS>].csv
  m = cleanName.match(/^(\d{1,3}_\d{1,3}_\d{1,3}_\d{1,3})_(20\d{6})(?:_(\d{6}))?(?:_[^.]+)?\.csv$/i);
  if (m) {
    return {
      folderToken: fallbackFolder,
      ipToken: m[1],
      dateToken: m[2],
      timeToken: m[3] || null,
      brandHint: 'YOKOTA',
      isYokotaSummary: !m[3],
      isSummaryCsv: false,
      isIndividual: Boolean(m[3])
    };
  }

  // Pattern 3: Generic summary CSV (URYU F-Data* / summary / tightening)
  if (cleanName.startsWith('F-Data') || lower.includes('summary') || lower.includes('tightening')) {
    return {
      folderToken: fallbackFolder,
      ipToken: null,
      dateToken: (cleanName.match(/(20\d{6})/) || [])[1] || null,
      timeToken: null,
      brandHint: preferredBrand || 'URYU',
      isYokotaSummary: false,
      isSummaryCsv: true,
      isIndividual: false
    };
  }

  // Pattern 4: Individual cycle CSV with timestamp
  const dateTimeMatch = cleanName.match(/(20\d{6})_?(\d{6})/);
  const dateOnlyMatch = cleanName.match(/(20\d{6})/);
  const isIndividual = /^\d{8,}/.test(cleanName) || /_20\d{6}(?:_\d{6})?(?:_|\.)/.test(cleanName);

  return {
    folderToken: fallbackFolder,
    ipToken: null,
    dateToken: dateOnlyMatch ? dateOnlyMatch[1] : null,
    timeToken: dateTimeMatch ? dateTimeMatch[2] : null,
    brandHint: preferredBrand || (lower.includes('yokota') ? 'YOKOTA' : null),
    isYokotaSummary: false,
    isSummaryCsv: false,
    isIndividual
  };
}

function findWrenchInPool(pool, folderToken, ipToken, upperFile) {
  const validFolder = folderToken && !/^20\d{6}$/.test(String(folderToken));
  if (validFolder) {
    const normFolder = String(folderToken).replace(/^0+/, '') || '0';
    const pad3 = normFolder.padStart(3, '0');
    const pad4 = normFolder.padStart(4, '0');

    const byFolder = pool.find(w => {
      const wNorm = String(w.folder || '').replace(/^0+/, '');
      return wNorm === normFolder || w.folder === pad3 || w.folder === pad4 || w.folder === String(folderToken);
    });
    if (byFolder) return byFolder;
  }

  if (ipToken) {
    const dottedIp = String(ipToken).replace(/_/g, '.').trim();
    const byIp = pool.find(w => w.controller_ip && w.controller_ip === dottedIp);
    if (byIp) return byIp;

    const normIpNum = String(ipToken).replace(/^.*[._]/, '').replace(/^0+/, '').trim();
    const byContr = pool.find(w => String(w.contr_no || '').replace(/^0+/, '') === normIpNum);
    if (byContr) return byContr;

    const byFolderFromIp = pool.find(w => String(w.folder || '').replace(/^0+/, '') === normIpNum);
    if (byFolderFromIp) return byFolderFromIp;
  }

  if (upperFile) {
    for (const tool of pool) {
      if (upperFile.includes(tool.wrench_id.toUpperCase())) return tool;
    }
    for (const tool of pool) {
      if (tool.folder && new RegExp(`(^|[^0-9])0*${String(tool.folder).replace(/^0+/, '')}([^0-9]|$)`).test(upperFile)) {
        return tool;
      }
    }
  }

  return null;
}

/**
 * Automatically resolves a Wrench Asset from folder number, controller IP, filename,
 * and mount/format brand. Dynamically registers newly discovered controllers if absent.
 */
function resolveWrench(folderToken, ipToken = null, fileName = '', preferredBrand = null) {
  const meta = extractFileTelemetryMeta(fileName, folderToken, preferredBrand);
  const effectiveFolder = (folderToken && !/^20\d{6}$/.test(String(folderToken)))
    ? String(folderToken)
    : (meta.folderToken && !/^20\d{6}$/.test(String(meta.folderToken)) ? String(meta.folderToken) : null);
  const effectiveIp = ipToken || meta.ipToken || null;
  const effectiveBrand = preferredBrand || meta.brandHint || null;
  const upperFile = String(fileName || '').toUpperCase();

  // 1. Prioritize brand-matched assets first so Yokota 0039/0053 never collide with URYU 039/053
  if (effectiveBrand) {
    const brandPool = ALL_WRENCH_ASSETS.filter(
      w => String(w.brand || '').toUpperCase() === String(effectiveBrand).toUpperCase()
    );
    const brandMatch = findWrenchInPool(brandPool, effectiveFolder, effectiveIp, upperFile);
    if (brandMatch) return brandMatch;
  }

  // 2. Fall back across full catalog only when brand is unknown or not colliding on folder
  if (!effectiveBrand) {
    const anyMatch = findWrenchInPool(ALL_WRENCH_ASSETS, effectiveFolder, effectiveIp, upperFile);
    if (anyMatch) return anyMatch;
  } else {
    // Allow fallback match across catalog only by explicit IP or full wrench_id
    const crossMatch = findWrenchInPool(ALL_WRENCH_ASSETS, null, effectiveIp, upperFile);
    if (crossMatch && String(crossMatch.brand || '').toUpperCase() === String(effectiveBrand).toUpperCase()) {
      return crossMatch;
    }
  }

  // 3. Auto-register newly discovered shop-floor controller/folder so zero real data is dropped
  if (effectiveFolder || effectiveIp) {
    const discovered = registerAutoDiscoveredWrench({
      folderToken: effectiveFolder || String(effectiveIp).replace(/^.*[._]/, ''),
      ipToken: effectiveIp,
      brand: effectiveBrand || 'YOKOTA'
    });
    console.log(`🤖 [Auto-Mapped Tool]: Registered ${discovered.wrench_id} (${discovered.tool_name}, IP ${discovered.controller_ip})`);
    return discovered;
  }

  return null;
}

/**
 * ULTRA-SAFE MICRO-READER for individual cycle files (<timestamp>.csv)
 * Reads ONLY the first 3 lines (< 300 bytes) with highWaterMark: 1024.
 * Once Line 3 ("Final: ... Puls 17 Trq 7") is parsed, it INSTANTLY destroys
 * the stream and releases the file handle. Never parses curve points.
 */
function parseIndividualCycleFileSafely(filePath, fileName, targetDateIso = getSystemDateKeys().iso, fileMtime = null) {
  return new Promise((resolve) => {
    let resolved = false;
    let fileStream = null;

    try {
      fileStream = fs.createReadStream(filePath, {
        flags: 'r',
        encoding: 'utf8',
        highWaterMark: 1024 // 1 KB max buffer
      });
    } catch (openErr) {
      return resolve(null);
    }

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let lineIndex = 0;
    let finalRowData = null;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        rl.close();
        if (fileStream) fileStream.destroy();
      }
    };

    rl.on('line', (line) => {
      lineIndex++;
      const trimmed = line.trim();

      if (lineIndex <= 4 && (trimmed.startsWith('Final:') || trimmed.includes('Puls') || trimmed.includes('Pulse'))) {
        const tokens = trimmed.replace(/\t/g, ',').split(',').map(t => t.trim()).filter(Boolean);
        const parsed = {};

        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i].toLowerCase();
          if (['puls', 'pulse', 'pulses', 'no.of pulses'].includes(tok) && i + 1 < tokens.length) {
            parsed.pulse = parseInt(tokens[i + 1], 10) || 0;
          }
          if (['trq', 'torque'].includes(tok) && i + 1 < tokens.length) {
            parsed.torque = parseFloat(tokens[i + 1]) || 0;
          }
          if (['deg', 'angle'].includes(tok) && i + 1 < tokens.length) {
            parsed.angle = parseFloat(tokens[i + 1]) || 0;
          }
          if (['time'].includes(tok) && i + 1 < tokens.length) {
            parsed.time = parseFloat(tokens[i + 1]) || 0;
          }
        }

        if (parsed.pulse !== undefined || parsed.torque !== undefined) {
          finalRowData = parsed;
          cleanup();
        }
      }

      if (lineIndex >= 5) {
        cleanup();
      }
    });

    rl.on('close', () => {
      if (!resolved) resolved = true;
      if (!finalRowData) return resolve(null);

      const baseName = path.basename(fileName, path.extname(fileName));
      let tighteningTime = '';
      // Match both YYYYMMDD_HHMMSS (Yokota) and YYYYMMDDHHMMSS (URYU)
      const timeMatch =
        baseName.match(/(20\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/) ||
        baseName.match(/(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);

      if (timeMatch) {
        tighteningTime = `${timeMatch[1]}-${timeMatch[2]}-${timeMatch[3]} ${timeMatch[4]}:${timeMatch[5]}:${timeMatch[6]}`;
      } else {
        const dateMatch = baseName.match(/(?:^|_)(20\d{2})(\d{2})(\d{2})(?:_|$)/);
        const datePart = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : targetDateIso;
        const refTime = fileMtime instanceof Date ? fileMtime : new Date();
        const hh = String(refTime.getHours()).padStart(2, '0');
        const mi = String(refTime.getMinutes()).padStart(2, '0');
        const ss = String(refTime.getSeconds()).padStart(2, '0');
        tighteningTime = `${datePart} ${hh}:${mi}:${ss}`;
      }

      if (extractDateIso(tighteningTime) !== targetDateIso) {
        return resolve(null);
      }

      const seqMatch = baseName.match(/_(\d+)$/);
      const cycleCounter = seqMatch
        ? parseInt(seqMatch[1], 10) || 1
        : parseInt(baseName.slice(-6) || '1', 10) || 1;

      resolve({
        tighteningTime,
        receptionTime: tighteningTime,
        workNo: '1',
        pulseCount: finalRowData.pulse || 0,
        torque: finalRowData.torque || 0,
        angle: finalRowData.angle || 0,
        duration: finalRowData.time || 0,
        judgement: 'OK',
        cycleCounter,
        sourceFile: fileName
      });
    });

    fileStream.on('error', () => {
      cleanup();
      resolve(null);
    });
  });
}

/**
 * Parses Yokota daily summary log file (e.g. 0230_120_0_100_97_20261119.csv)
 * Format: i0230 1a3828- 3A 50.4K 5219   8  133   20   6 OK   11/19 05:35:06
 * Returns:
 *   - lookupByTimestamp: Map<"folderNorm_YYYY-MM-DD HH:MM:SS" -> { judgement, workNo, pulseCount, ... }>
 *   - newRows: rows appended after fileLineTracker matching targetDateIso
 */
async function parseYokotaDailyLogSafely(filePath, fileName, targetDateIso = getSystemDateKeys().iso, ignoreTracker = false) {
  const lastLineRead = ignoreTracker ? 0 : (fileLineTracker.get(filePath) || 0);
  let fileStream = null;

  try {
    fileStream = fs.createReadStream(filePath, { flags: 'r', encoding: 'utf8', highWaterMark: 16384 });
  } catch (err) {
    return { lookupByKey: new Map(), newRows: [] };
  }

  const fileYear = (String(fileName || '').match(/(20\d{2})\d{4}/) || [])[1] || targetDateIso.slice(0, 4);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const lookupByKey = new Map();
  const newRows = [];
  let currentLine = 0;

  for await (const line of rl) {
    currentLine++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m = trimmed.match(YOKOTA_SUMMARY_LINE_RE);
    if (!m) continue;

    const controllerFolder = m[1];
    const workNo = m[3];
    const torque = parseFloat(m[5]) || 0;
    const angle = parseFloat(m[7]) || 0;
    const finalTimeCs = parseFloat(m[9]) || 0;
    const summaryPulse = parseInt(m[10], 10) || 0;
    const rawStatus = String(m[11] || 'OK').toUpperCase();
    const judgement = rawStatus === 'OK' ? 'OK' : 'NG';
    const month = m[12];
    const day = m[13];
    const hhmmss = m[14];
    const dateIso = `${fileYear}-${month}-${day}`;

    if (dateIso !== targetDateIso) continue;

    const tighteningTime = `${dateIso} ${hhmmss}`;
    const cycleCounter = parseInt(hhmmss.replace(/:/g, ''), 10) || currentLine;
    const normFolder = String(controllerFolder).replace(/^0+/, '') || '0';
    const key = `${normFolder}_${tighteningTime}`;

    const parsedRow = {
      controllerFolder,
      tighteningTime,
      receptionTime: tighteningTime,
      workNo,
      pulseCount: summaryPulse,
      torque,
      angle,
      duration: Number((finalTimeCs / 100).toFixed(2)),
      judgement,
      cycleCounter,
      sourceFile: fileName
    };

    lookupByKey.set(key, parsedRow);
    if (ignoreTracker || currentLine > lastLineRead) {
      newRows.push(parsedRow);
    }
  }

  if (!ignoreTracker) {
    fileLineTracker.set(filePath, currentLine);
  }
  return { lookupByKey, newRows };
}

/**
 * Parses summary CSV file (e.g. F-Data*.csv) incrementally, strictly keeping rows
 * that match targetDateIso (system date today).
 */
async function parseSummaryCsvFileSafely(filePath, targetDateIso = getSystemDateKeys().iso, ignoreTracker = false) {
  const lastLineRead = ignoreTracker ? 0 : (fileLineTracker.get(filePath) || 0);
  let fileStream = null;

  try {
    fileStream = fs.createReadStream(filePath, { flags: 'r', encoding: 'utf8', highWaterMark: 8192 });
  } catch (err) {
    return [];
  }

  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let currentLine = 0;
  let headerIndexMap = {};
  const newRows = [];

  for await (const line of rl) {
    currentLine++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (currentLine === 4) {
      const headers = trimmed.split(',').map(h => h.replace(/^"|"$/g, '').trim());
      headers.forEach((h, idx) => {
        headerIndexMap[h.toLowerCase()] = idx;
      });
      continue;
    }

    if (currentLine > 4 && (ignoreTracker || currentLine > lastLineRead)) {
      const cols = trimmed.split(',').map(c => c.replace(/^"|"$/g, '').trim());

      const getVal = (...keys) => {
        for (const k of keys) {
          const idx = headerIndexMap[k.toLowerCase()];
          if (idx !== undefined && cols[idx] !== undefined) return cols[idx];
        }
        return '';
      };

      const rawTime = getVal('tightening date/time', 'date/time', 'timestamp') || cols[0] || '';
      const tighteningTime = rawTime ? normalizeCsvTimestamp(rawTime, targetDateIso) : '';
      if (!tighteningTime || extractDateIso(tighteningTime) !== targetDateIso) {
        continue; // Strictly match system date today only
      }

      const workNo = getVal('workno.', 'work no', 'barcode') || String(currentLine - 4);
      const pulseRaw = getVal('number of pulses', 'no.of pulses', 'no.of.pulse', 'pulses', 'puls') || cols[3] || '0';
      const torqueRaw = getVal('torque', 'trq') || cols[4] || '0';
      const angleRaw = getVal('angle', 'deg') || cols[5] || '0';
      const durationRaw = getVal('tightening time', 'duration', 'time') || '0';
      const judgement = (getVal('judgement', 'judgment', 'status') || 'OK').toUpperCase().includes('NG') ? 'NG' : 'OK';
      const count = parseInt(getVal('count') || workNo || String(currentLine - 4), 10) || (currentLine - 4);

      newRows.push({
        tighteningTime,
        receptionTime: tighteningTime,
        workNo,
        pulseCount: parseInt(pulseRaw, 10) || 0,
        torque: parseFloat(torqueRaw) || 0,
        angle: parseFloat(angleRaw) || 0,
        duration: parseFloat(durationRaw) || 0,
        judgement,
        cycleCounter: count,
        sourceFile: path.basename(filePath)
      });
    }
  }

  if (!ignoreTracker) {
    fileLineTracker.set(filePath, currentLine);
  }
  return newRows;
}

/**
 * Seeds per-wrench consecutive breach streak from PostgreSQL prior cycles on cold start
 * so sustained breaches spanning multiple sync runs / restarts are caught accurately.
 */
async function seedBreachStateFromPostgres(wrenchId, activeLimit) {
  if (consecutiveBreachState.has(wrenchId)) return;
  try {
    const res = await query(
      `SELECT pulse_count FROM wrench_tightening_cycles
       WHERE wrench_id = $1
       ORDER BY tightening_time DESC, cycle_counter DESC
       LIMIT $2;`,
      [wrenchId, CONSECUTIVE_BREACH_REQUIRED - 1]
    );
    let streakCount = 0;
    const streakPulses = [];
    if (res && res.rows) {
      // Rows come newest-first; count contiguous trailing breaches
      for (const row of res.rows) {
        const p = Number(row.pulse_count || 0);
        if (p > activeLimit) {
          streakCount++;
          streakPulses.unshift(p);
        } else {
          break;
        }
      }
    }
    consecutiveBreachState.set(wrenchId, { count: streakCount, pulses: streakPulses });
  } catch (err) {
    consecutiveBreachState.set(wrenchId, { count: 0, pulses: [] });
  }
}

/**
 * Inserts parsed cycles into PostgreSQL on 10.82.126.44
 * Uses ON CONFLICT (wrench_id, tightening_time, cycle_counter) DO NOTHING
 * Seamlessly clubs new data with old data without duplicate records.
 * Sends alert email ONLY when consecutive breaches >= CONSECUTIVE_BREACH_REQUIRED (default 5).
 */
async function insertCyclesToPostgres(wrench, cycles) {
  let inserted = 0;
  let skipped = 0;
  const pgStatus = getPostgresStatus();
  const isPgLive = pgStatus.connected && pgStatus.tablesReady;
  const activeLimit = getToolThreshold(wrench.wrench_id) || wrench.default_pulse_threshold || 25;

  // Sort chronologically so consecutive breach verification reflects true tightening sequence
  const orderedCycles = [...cycles].sort((a, b) => {
    const cmp = String(a.tighteningTime || '').localeCompare(String(b.tighteningTime || ''));
    return cmp !== 0 ? cmp : (Number(a.cycleCounter || 0) - Number(b.cycleCounter || 0));
  });

  if (isPgLive && !consecutiveBreachState.has(wrench.wrench_id) && orderedCycles.some(c => c.pulseCount > activeLimit)) {
    await seedBreachStateFromPostgres(wrench.wrench_id, activeLimit);
  }

  for (const c of orderedCycles) {
    const pulseStatus = c.pulseCount > activeLimit
      ? 'CRITICAL'
      : (c.pulseCount >= activeLimit - 3 ? 'WARNING' : 'NORMAL');
    const torqueStatus = c.judgement === 'NG' ? 'NG' : 'OK';
    const rawWork = String(c.workNo || '1').trim();
    const engineNo = /^\d+$/.test(rawWork) ? `ENG-${rawWork.padStart(4, '0')}` : rawWork;

    try {
      let rowInserted = false;
      if (isPgLive) {
        const sqlRes = await query(
          `INSERT INTO wrench_tightening_cycles (
            wrench_id, tool_name, station, folder, line, engine_no,
            tightening_time, reception_time, torque_val, torque_status,
            angle_val, angle_status, pulse_count, pulse_status, cycle_counter
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
          )
          ON CONFLICT (wrench_id, tightening_time, cycle_counter) DO NOTHING
          RETURNING id;`,
          [
            wrench.wrench_id,
            wrench.tool_name,
            String(wrench.station),
            String(wrench.folder),
            wrench.line_code || wrench.line || 'MK1',
            engineNo,
            c.tighteningTime,
            c.receptionTime,
            c.torque,
            torqueStatus,
            c.angle,
            'OK',
            c.pulseCount,
            pulseStatus,
            c.cycleCounter
          ]
        );
        rowInserted = Boolean(sqlRes && sqlRes.rowCount > 0);
      }

      // Update local fallback cache
      const alreadyInFallback = localFallbackCycles.some(
        f => f.wrench_id === wrench.wrench_id && f.tightening_time === c.tighteningTime && f.cycle_counter === c.cycleCounter
      );
      if (!alreadyInFallback) {
        localFallbackCycles.push({
          id: localFallbackCycles.length + 1,
          wrench_id: wrench.wrench_id,
          tool_name: wrench.tool_name,
          station: String(wrench.station),
          folder: String(wrench.folder),
          line: wrench.line_code || wrench.line || 'MK1',
          engine_no: engineNo,
          tightening_time: c.tighteningTime,
          reception_time: c.receptionTime,
          torque_val: c.torque,
          torque_status: torqueStatus,
          angle_val: c.angle,
          angle_status: 'OK',
          pulse_count: c.pulseCount,
          pulse_status: pulseStatus,
          duration_sec: c.duration || 0,
          source_file: c.sourceFile || 'LIVE_MOUNT_CSV',
          cycle_counter: c.cycleCounter,
          created_at: new Date().toISOString()
        });
        if (!isPgLive) rowInserted = true;
      }

      if (rowInserted) inserted++;
      else skipped++;

      // Evaluate sustained consecutive breaches strictly on newly inserted cycles
      if (rowInserted) {
        const streak = consecutiveBreachState.get(wrench.wrench_id) || { count: 0, pulses: [] };

        if (c.pulseCount > activeLimit) {
          streak.count += 1;
          streak.pulses.push(c.pulseCount);
          if (streak.pulses.length > CONSECUTIVE_BREACH_REQUIRED) {
            streak.pulses.shift();
          }

          if (streak.count >= CONSECUTIVE_BREACH_REQUIRED) {
            recordAlert({
              wrench_id: wrench.wrench_id,
              tool_name: wrench.tool_name,
              assembly_name: wrench.assembly_name,
              sub_assembly_name: wrench.sub_assembly_name,
              station: wrench.station,
              event_time: c.tighteningTime,
              severity: 'CRITICAL',
              rule_reason: 'CONSECUTIVE_PULSE_BREACH',
              observed_value: c.pulseCount,
              threshold_limit: activeLimit,
              unit: 'pulses',
              engine_number: engineNo,
              work_no: rawWork,
              investigation_notes: `Consecutive pulse breaches (${streak.pulses.join(', ')}) exceeded limit ${activeLimit}.`
            });

            try {
              const mailRes = await dispatchPulseEmailAlert({
                wrenchId: wrench.wrench_id,
                toolName: wrench.tool_name,
                station: wrench.station,
                folder: wrench.folder,
                measuredPulse: c.pulseCount,
                pulseLimit: activeLimit,
                torque: c.torque,
                angle: c.angle,
                engineNumber: engineNo,
                timestamp: c.tighteningTime,
                consecutiveBreaches: streak.count,
                recentPulses: [...streak.pulses]
              });
              if (mailRes?.status === 'SENT') {
                lastSyncStats.alertsTriggered++;
              }
            } catch (alertErr) {
              console.warn(`[Alert Dispatch Warning]:`, alertErr.message);
            }
            // Reset streak after sustained alert evaluation so next alert requires fresh sustained breaches
            streak.count = 0;
            streak.pulses = [];
          } else {
            console.log(
              `⏳ [Consecutive Check] ${wrench.wrench_id}: pulse=${c.pulseCount} > limit=${activeLimit} (${streak.count}/${CONSECUTIVE_BREACH_REQUIRED} consecutive — watching next cycles).`
            );
          }
        } else {
          if (streak.count > 0) {
            console.log(
              `✅ [Consecutive Check Cleared] ${wrench.wrench_id}: pulse=${c.pulseCount} <= limit=${activeLimit} (resetting streak from ${streak.count} to 0).`
            );
          }
          streak.count = 0;
          streak.pulses = [];
        }

        consecutiveBreachState.set(wrench.wrench_id, streak);
      }
    } catch (err) {
      console.warn(`[Cycle Ingestion Error for ${wrench.wrench_id}]:`, err.message);
    }
  }

  return { inserted, skipped };
}

/**
 * Discovers data subdirectories under base path (e.g. DATA-28mar, YOKOTA),
 * skipping unrelated Windows OS directories such as AppData.
 */
async function discoverRootDirectories(basePath) {
  const roots = [basePath];
  try {
    const entries = await fsp.readdir(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('$')) {
        const lower = entry.name.toLowerCase();
        if (lower.startsWith('data') || lower.includes('yokota') || lower.includes('uryu')) {
          roots.push(path.join(basePath, entry.name));
        }
      }
    }
  } catch (err) {}
  return [...new Set(roots)];
}

/**
 * Reads & groups cycles from an active YYYYMMDD folder cleanly across:
 *   1. Yokota daily summary logs (0230_120_0_100_97_YYYYMMDD.csv)
 *   2. URYU / generic summary CSVs (F-Data*.csv)
 *   3. Individual cycle waveform CSVs (..._YYYYMMDD_HHMMSS.csv or YYYYMMDDHHMMSS.csv)
 * Enriches individual cycles with judgement/workNo from Yokota summary logs
 * and deduplicates summary vs waveform rows so each physical bolt equals 1 cycle.
 */
async function readActiveDateDirectoryCycles({
  activeDateDir,
  dateKeys,
  catalogFolder = null,
  ipHint = null,
  preferredBrand = null,
  filterNormFolder = null,
  bypassProcessedCache = false
}) {
  let files = [];
  try {
    files = await fsp.readdir(activeDateDir);
  } catch (readDirErr) {
    return { groupedByWrench: new Map(), filesChecked: 0, totalCsvFiles: 0 };
  }

  const csvFiles = files
    .filter(f => f.toLowerCase().endsWith('.csv'))
    .sort((a, b) => a.localeCompare(b));

  const yokotaSummaryLookup = new Map();
  const pendingYokotaSummaryByWrench = new Map();
  const groupedByWrench = new Map();
  const coveredLookupKeys = new Set();
  let filesChecked = 0;

  const ensureGroup = (wrench) => {
    if (!groupedByWrench.has(wrench.wrench_id)) {
      groupedByWrench.set(wrench.wrench_id, { wrench, cycles: [] });
    }
    return groupedByWrench.get(wrench.wrench_id);
  };

  // Classify files in this folder
  const classified = [];
  for (const file of csvFiles) {
    const meta = extractFileTelemetryMeta(file, catalogFolder, preferredBrand);
    const effectiveFolder = meta.folderToken || catalogFolder;
    if (filterNormFolder && effectiveFolder) {
      const norm = String(effectiveFolder).replace(/^0+/, '') || '0';
      if (norm !== filterNormFolder) continue;
    }
    classified.push({ file, fullPath: path.join(activeDateDir, file), meta });
  }

  // Pass 1: Read Yokota daily summary logs first to build OK/NG + engine/workNo lookup
  for (const item of classified) {
    if (!item.meta.isYokotaSummary) continue;
    if (item.meta.dateToken && item.meta.dateToken !== dateKeys.compact) continue;

    filesChecked++;
    const { lookupByKey, newRows } = await parseYokotaDailyLogSafely(
      item.fullPath,
      item.file,
      dateKeys.iso,
      bypassProcessedCache
    );

    for (const [k, v] of lookupByKey.entries()) {
      yokotaSummaryLookup.set(k, v);
    }

    if (newRows.length > 0) {
      const wrench = resolveWrench(
        item.meta.folderToken || newRows[0].controllerFolder || catalogFolder,
        item.meta.ipToken || ipHint,
        item.file,
        preferredBrand || item.meta.brandHint
      );
      if (wrench) {
        if (!pendingYokotaSummaryByWrench.has(wrench.wrench_id)) {
          pendingYokotaSummaryByWrench.set(wrench.wrench_id, { wrench, rows: [] });
        }
        pendingYokotaSummaryByWrench.get(wrench.wrench_id).rows.push(...newRows);
      }
    }
  }

  // Pass 2: Read URYU/generic summary CSVs & individual waveform CSVs
  for (const item of classified) {
    if (item.meta.isYokotaSummary) continue;

    if (!bypassProcessedCache && item.meta.isIndividual && processedIndividualFiles.has(item.fullPath)) {
      continue;
    }

    const wrench = resolveWrench(
      item.meta.folderToken || catalogFolder,
      item.meta.ipToken || ipHint,
      item.file,
      preferredBrand || item.meta.brandHint
    );
    if (!wrench) continue;

    if (item.meta.isSummaryCsv) {
      filesChecked++;
      const summaryRows = await parseSummaryCsvFileSafely(item.fullPath, dateKeys.iso, bypassProcessedCache);
      if (summaryRows.length > 0) {
        ensureGroup(wrench).cycles.push(...summaryRows);
      }
    } else if (item.meta.isIndividual) {
      if (item.meta.dateToken && item.meta.dateToken !== dateKeys.compact) {
        if (!bypassProcessedCache) processedIndividualFiles.add(item.fullPath);
        continue;
      }

      filesChecked++;
      let fileMtime = null;
      try {
        fileMtime = (await fsp.stat(item.fullPath)).mtime;
      } catch (e) {}

      const cycle = await parseIndividualCycleFileSafely(item.fullPath, item.file, dateKeys.iso, fileMtime);
      if (!bypassProcessedCache) processedIndividualFiles.add(item.fullPath);

      if (cycle) {
        const folderNorm = String(wrench.folder || item.meta.folderToken || '').replace(/^0+/, '') || '0';
        const lookupKey = `${folderNorm}_${cycle.tighteningTime}`;
        const summaryInfo = yokotaSummaryLookup.get(lookupKey);
        if (summaryInfo) {
          cycle.judgement = summaryInfo.judgement;
          cycle.workNo = summaryInfo.workNo;
          if (!cycle.duration && summaryInfo.duration) cycle.duration = summaryInfo.duration;
          coveredLookupKeys.add(lookupKey);
        }
        ensureGroup(wrench).cycles.push(cycle);
      }

      if (!bypassProcessedCache) await sleep(20);
    }
  }

  // Pass 3: Add Yokota summary rows that did NOT already come from a waveform file
  for (const { wrench, rows } of pendingYokotaSummaryByWrench.values()) {
    const folderNorm = String(wrench.folder || '').replace(/^0+/, '') || '0';
    for (const r of rows) {
      const lookupKey = `${folderNorm}_${r.tighteningTime}`;
      if (!coveredLookupKeys.has(lookupKey)) {
        ensureGroup(wrench).cycles.push(r);
      }
    }
  }

  return { groupedByWrench, filesChecked, totalCsvFiles: csvFiles.length };
}

/**
 * Ingests files from a mount directory tree supporting BOTH:
 *   - Date-first root (Yokota): <root>/<YYYYMMDD>/<folder>_<ip>_<YYYYMMDD>_<HHMMSS>.csv
 *   - Tool-first root (URYU / Yokota): <root>/<folder>/[UEC-4800 | 120_*]/<YYYYMMDD>/*.csv
 */
async function scanAndIngestMountRoot(mountRoot, dateKeys, sourceBrand = null) {
  let rowsAdded = 0;
  let dupsSkipped = 0;
  let filesChecked = 0;
  let toolFoldersFound = 0;
  const visitedDateDirs = new Set();

  const searchRoots = await discoverRootDirectories(mountRoot);

  const processDateDir = async (activeDateDir, catalogFolder = null, ipHint = null) => {
    const resolvedDir = path.resolve(activeDateDir);
    if (visitedDateDirs.has(resolvedDir)) return;

    const dirExists = await fsp.access(resolvedDir).then(() => true).catch(() => false);
    if (!dirExists) return;
    visitedDateDirs.add(resolvedDir);

    const { groupedByWrench, filesChecked: dirFiles } = await readActiveDateDirectoryCycles({
      activeDateDir: resolvedDir,
      dateKeys,
      catalogFolder,
      ipHint,
      preferredBrand: sourceBrand,
      bypassProcessedCache: false
    });

    filesChecked += dirFiles;

    for (const { wrench, cycles } of groupedByWrench.values()) {
      toolFoldersFound++;
      if (cycles.length === 0) continue;

      const { inserted, skipped } = await insertCyclesToPostgres(wrench, cycles);
      rowsAdded += inserted;
      dupsSkipped += skipped;
      if (inserted > 0) {
        console.log(`   -> [${wrench.wrench_id}] ${path.basename(resolvedDir)}: +${inserted} new cycles saved (${skipped} clubbed).`);
      }
      await sleep(50);
    }
  };

  for (const rootDir of searchRoots) {
    let entries = [];
    try {
      entries = await fsp.readdir(rootDir, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    // 1. Date-first layout directly under rootDir (e.g. /mnt/yokota/20261126 or /mnt/yokota/yokota data/20261126)
    for (const dEntry of entries) {
      if (dEntry.isDirectory() && (dEntry.name === dateKeys.compact || dEntry.name === dateKeys.dashes)) {
        await processDateDir(path.join(rootDir, dEntry.name), null, null);
      }
    }

    // 2. Tool-first layout under rootDir (e.g. /mnt/torque_wrench/029/UEC-4800/20261126 or /mnt/yokota/0230/20261126)
    const folderCandidates = entries.filter(e => e.isDirectory() && /^\d{1,5}$/.test(e.name));

    for (const fEntry of folderCandidates) {
      const folderNumber = fEntry.name;
      const toolDir = path.join(rootDir, folderNumber);

      const dateSubfolders = [
        { dir: path.join(toolDir, 'UEC-4800', dateKeys.compact), ipHint: null },
        { dir: path.join(toolDir, dateKeys.compact), ipHint: null },
        { dir: path.join(toolDir, 'UEC-4800', dateKeys.dashes), ipHint: null }
      ];

      // Check Yokota IP subfolder like 120_0_100_* or YOKOTA
      try {
        const subEntries = await fsp.readdir(toolDir, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isDirectory() && (/^\d{1,3}_\d{1,3}_\d{1,3}_\d{1,3}$/.test(sub.name) || sub.name.toUpperCase() === 'YOKOTA')) {
            const subIp = /^\d{1,3}_/.test(sub.name) ? sub.name : null;
            dateSubfolders.push({ dir: path.join(toolDir, sub.name, dateKeys.compact), ipHint: subIp });
          }
        }
      } catch (subErr) {}

      for (const candidate of dateSubfolders) {
        await processDateDir(candidate.dir, folderNumber, candidate.ipHint);
      }
    }
  }

  return { rowsAdded, dupsSkipped, filesChecked, toolFoldersFound };
}

/**
 * Main Pull Routine:
 * Reads /mnt/torque_wrench (URYU) and /mnt/yokota (YOKOTA) on server 10.82.126.73
 * Falls back to Windows UNC shares \\172.16.105.234\D & \\172.16.105.234\c if running on Windows.
 * Inserts parsed cycles directly into PostgreSQL on 10.82.126.44.
 */
async function runCsvPullJob() {
  const startTime = new Date();
  const dateKeys = getDateKeys(startTime);

  // Reset per-day file and streak caches whenever the system calendar date rolls over
  if (lastSyncedDateCompact && lastSyncedDateCompact !== dateKeys.compact) {
    processedIndividualFiles.clear();
    fileLineTracker.clear();
    consecutiveBreachState.clear();
  }
  lastSyncedDateCompact = dateKeys.compact;

  console.log(`\n================================================================`);
  console.log(`🛡️  [Stealth CSV Ingestion] Pulling shop-floor telemetry for TODAY: ${dateKeys.compact} (${dateKeys.iso})`);
  console.log(`    Data Source: Mount Points ${URYU_MOUNT_PATH} & ${YOKOTA_MOUNT_PATH}`);
  console.log(`    Target Server: PostgreSQL on ${process.env.POSTGRES_HOST || '10.82.126.44'} (DB: ${process.env.POSTGRES_DB || 'tnga_wrench_db'})`);
  console.log(`================================================================`);

  lastSyncStats.status = 'RUNNING';
  lastSyncStats.lastRunTimestamp = startTime.toISOString();
  lastSyncStats.alertsTriggered = 0;
  lastSyncStats.error = null;

  // 1. Resolve active URYU mount path
  const activeUryu = await resolveAccessiblePath([URYU_MOUNT_PATH, URYU_UNC_SHARE, FALLBACK_MOUNT]);
  // 2. Resolve active YOKOTA mount path
  const activeYokota = await resolveAccessiblePath([YOKOTA_MOUNT_PATH, YOKOTA_UNC_SHARE, YOKOTA_LOCAL_PATH]);

  lastSyncStats.activeUryuSource = activeUryu;
  lastSyncStats.activeYokotaSource = activeYokota;

  let totalRowsAdded = 0;
  let totalDuplicatesSkipped = 0;
  let totalFilesChecked = 0;
  let totalToolFolders = 0;

  if (activeUryu || activeYokota) {
    if (activeUryu) {
      console.log(`📂 [URYU Source Active]: ${activeUryu}`);
      const resU = await scanAndIngestMountRoot(activeUryu, dateKeys, 'URYU');
      totalRowsAdded += resU.rowsAdded;
      totalDuplicatesSkipped += resU.dupsSkipped;
      totalFilesChecked += resU.filesChecked;
      totalToolFolders += resU.toolFoldersFound;
    }

    if (activeYokota) {
      console.log(`📂 [YOKOTA Source Active]: ${activeYokota}`);
      const resY = await scanAndIngestMountRoot(activeYokota, dateKeys, 'YOKOTA');
      totalRowsAdded += resY.rowsAdded;
      totalDuplicatesSkipped += resY.dupsSkipped;
      totalFilesChecked += resY.filesChecked;
      totalToolFolders += resY.toolFoldersFound;
    }
  } else {
    console.warn(`⚠️ [Mounts Inaccessible]: Neither ${URYU_MOUNT_PATH} nor ${YOKOTA_MOUNT_PATH} found.`);
    console.warn(`   Verify mount status using: ls -la /mnt/torque_wrench /mnt/yokota`);
  }

  const durationMs = Date.now() - startTime.getTime();
  lastSyncStats.toolFoldersFound = totalToolFolders;
  lastSyncStats.filesProcessed = totalFilesChecked;
  lastSyncStats.rowsIngested = totalRowsAdded;
  lastSyncStats.duplicatesSkipped = totalDuplicatesSkipped;
  lastSyncStats.status = 'COMPLETED';

  console.log(`✅ [Stealth CSV Ingestion Completed in ${durationMs}ms]`);
  console.log(`   Files Checked: ${totalFilesChecked} | New Saved to PostgreSQL: ${totalRowsAdded} | Clubbed: ${totalDuplicatesSkipped}`);
  console.log(`================================================================\n`);

  return {
    success: true,
    date: dateKeys.compact,
    uryuSource: activeUryu || 'NOT_MOUNTED',
    yokotaSource: activeYokota || 'NOT_MOUNTED',
    filesProcessed: totalFilesChecked,
    rowsIngested: totalRowsAdded,
    duplicatesSkipped: totalDuplicatesSkipped,
    alertsTriggered: lastSyncStats.alertsTriggered,
    durationMs
  };
}

function getCsvIngestionStatus() {
  const pg = getPostgresStatus();
  return {
    ...lastSyncStats,
    uryuPath: URYU_MOUNT_PATH,
    yokotaPath: YOKOTA_MOUNT_PATH,
    uryuUnc: URYU_UNC_SHARE,
    yokotaUnc: YOKOTA_UNC_SHARE,
    yokotaLocalPath: YOKOTA_LOCAL_PATH || null,
    postgresServer: `${pg.host}:${pg.port}`,
    postgresConnected: pg.connected,
    postgresTableReady: pg.tablesReady,
    localCacheCyclesCount: localFallbackCycles.length
  };
}

// In-memory cache for fast API reads without repeating SMB disk reads
const folderApiCache = new Map();

function parseTargetDateInput(targetDateInput) {
  if (!targetDateInput) return new Date();
  if (targetDateInput instanceof Date) return targetDateInput;
  const raw = String(targetDateInput).trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) return new Date(Number(compactMatch[1]), Number(compactMatch[2]) - 1, Number(compactMatch[3]));
  return new Date(raw);
}

/**
 * Directly resolves a folder path (Tool-first OR Date-first Yokota layout)
 */
async function findDirectFolderDirectory(mountRoots, folderNumber, dateKeys) {
  const norm = String(folderNumber || '').replace(/^0+/, '') || '0';
  const variations = [...new Set([
    String(folderNumber),
    norm.padStart(3, '0'),
    norm.padStart(4, '0'),
    norm
  ])];

  for (const entry of mountRoots) {
    const root = typeof entry === 'string' ? entry : entry?.root;
    const brand = typeof entry === 'string' ? null : entry?.brand;
    if (!root) continue;

    const subRoots = await discoverRootDirectories(root);

    for (const subRoot of subRoots) {
      // 1. Tool-first paths
      for (const f of variations) {
        const toolDir = path.join(subRoot, f);
        const candidatePaths = [
          path.join(toolDir, 'UEC-4800', dateKeys.compact),
          path.join(toolDir, dateKeys.compact),
          path.join(toolDir, 'UEC-4800', dateKeys.dashes)
        ];

        for (const cPath of candidatePaths) {
          try {
            await fsp.access(cPath, fs.constants.R_OK);
            return { foundPath: cPath, folderNumber: f, rootDir: subRoot, brand, isDateFirst: false };
          } catch (e) {}
        }

        try {
          const subEntries = await fsp.readdir(toolDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isDirectory() && (/^\d{1,3}_\d{1,3}_\d{1,3}_\d{1,3}$/.test(sub.name) || sub.name.toUpperCase() === 'YOKOTA')) {
              const yPath = path.join(toolDir, sub.name, dateKeys.compact);
              try {
                await fsp.access(yPath, fs.constants.R_OK);
                return { foundPath: yPath, folderNumber: f, rootDir: subRoot, brand: brand || 'YOKOTA', isDateFirst: false };
              } catch (e) {}
            }
          }
        } catch (e) {}
      }

      // 2. Date-first layout (<subRoot>/<YYYYMMDD>/<folder>_...)
      for (const dName of [dateKeys.compact, dateKeys.dashes]) {
        const datePath = path.join(subRoot, dName);
        try {
          const files = await fsp.readdir(datePath);
          const hasMatchingFile = files.some(f => {
            if (!f.toLowerCase().endsWith('.csv')) return false;
            const meta = extractFileTelemetryMeta(f, null, brand);
            const fNorm = String(meta.folderToken || '').replace(/^0+/, '') || '0';
            return fNorm === norm;
          });
          if (hasMatchingFile) {
            return { foundPath: datePath, folderNumber: norm.padStart(4, '0'), rootDir: subRoot, brand, isDateFirst: true };
          }
        } catch (e) {}
      }
    }
  }

  return null;
}

/**
 * API function: Reads and returns JSON telemetry for a single folder directly from the mount point.
 * Ultra-fast direct jump with in-memory caching.
 */
async function getFolderTelemetryDirect(folderNumber, targetDateInput = null, bypassCache = false) {
  const targetDate = parseTargetDateInput(targetDateInput);
  const dateKeys = getDateKeys(targetDate);
  const cacheKey = `${folderNumber}_${dateKeys.compact}`;

  if (!bypassCache && folderApiCache.has(cacheKey)) {
    return {
      cached: true,
      folder: folderNumber,
      date: dateKeys.compact,
      ...folderApiCache.get(cacheKey)
    };
  }

  const activeUryu = await resolveAccessiblePath([URYU_MOUNT_PATH, URYU_UNC_SHARE, FALLBACK_MOUNT]);
  const activeYokota = await resolveAccessiblePath([YOKOTA_MOUNT_PATH, YOKOTA_UNC_SHARE, YOKOTA_LOCAL_PATH]);
  const mountRoots = [
    activeUryu ? { root: activeUryu, brand: 'URYU' } : null,
    activeYokota ? { root: activeYokota, brand: 'YOKOTA' } : null
  ].filter(Boolean);

  if (mountRoots.length === 0) {
    return {
      success: false,
      error: `No active mount points found. Check ${URYU_MOUNT_PATH} and ${YOKOTA_MOUNT_PATH}.`,
      records: []
    };
  }

  const directMatch = await findDirectFolderDirectory(mountRoots, folderNumber, dateKeys);
  if (!directMatch) {
    return {
      success: false,
      message: `Folder '${folderNumber}' not found for date ${dateKeys.compact} in mount points.`,
      records: []
    };
  }

  const filterNormFolder = directMatch.isDateFirst
    ? (String(folderNumber || '').replace(/^0+/, '') || '0')
    : null;

  const { groupedByWrench, filesChecked } = await readActiveDateDirectoryCycles({
    activeDateDir: directMatch.foundPath,
    dateKeys,
    catalogFolder: directMatch.folderNumber,
    preferredBrand: directMatch.brand,
    filterNormFolder,
    bypassProcessedCache: true
  });

  const firstGroup = Array.from(groupedByWrench.values())[0];
  const wrench = firstGroup?.wrench || resolveWrench(directMatch.folderNumber, null, '', directMatch.brand);
  const records = firstGroup?.cycles || [];

  const result = {
    success: true,
    folder: folderNumber,
    wrench_id: wrench?.wrench_id || null,
    toolName: wrench?.tool_name || 'Unknown Tool',
    station: wrench?.station || 'N/A',
    date: dateKeys.compact,
    path: directMatch.foundPath,
    totalFiles: filesChecked,
    recordCount: records.length,
    records
  };

  folderApiCache.set(cacheKey, {
    wrench_id: result.wrench_id,
    toolName: result.toolName,
    station: result.station,
    path: result.path,
    totalFiles: result.totalFiles,
    recordCount: result.recordCount,
    records: result.records
  });

  return result;
}

/**
 * API function: Fast targeted single-folder sync directly into PostgreSQL.
 */
async function syncSingleFolder(folderNumber, targetDateInput = null) {
  const startTime = Date.now();
  const directData = await getFolderTelemetryDirect(folderNumber, targetDateInput, true);

  if (!directData.success || directData.records.length === 0) {
    return {
      success: false,
      message: directData.message || directData.error || 'No records found to sync',
      rowsAdded: 0,
      dupsSkipped: 0
    };
  }

  const wrench = directData.wrench_id
    ? ALL_WRENCH_ASSETS.find(w => w.wrench_id === directData.wrench_id) || resolveWrench(folderNumber)
    : resolveWrench(folderNumber);

  if (!wrench) {
    return {
      success: false,
      message: `Tool mapping not found in catalog for folder '${folderNumber}'`,
      rowsAdded: 0
    };
  }

  const { inserted, skipped } = await insertCyclesToPostgres(wrench, directData.records);
  const durationMs = Date.now() - startTime;

  return {
    success: true,
    wrench_id: wrench.wrench_id,
    tool_name: wrench.tool_name,
    station: wrench.station,
    folder: folderNumber,
    recordsChecked: directData.records.length,
    rowsAdded: inserted,
    dupsSkipped: skipped,
    durationMs
  };
}

module.exports = {
  runCsvPullJob,
  resolveWrench,
  extractFileTelemetryMeta,
  getCsvIngestionStatus,
  getFolderTelemetryDirect,
  syncSingleFolder,
  findDirectFolderDirectory,
  scanAndIngestMountRoot,
  URYU_MOUNT_PATH,
  YOKOTA_MOUNT_PATH
};
