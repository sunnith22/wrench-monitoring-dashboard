/**
 * Local-timezone (IST / plant server clock) date helpers and timestamp normalizers.
 * Avoids UTC midnight drift between 00:00 and 05:30 IST.
 */

function getLocalDateKeys(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return {
    compact: `${yyyy}${mm}${dd}`, // "20261125"
    dashes: `${dd}-${mm}-${yyyy}`,  // "25-11-2026"
    iso: `${yyyy}-${mm}-${dd}`      // "2026-11-25"
  };
}

/**
 * Normalizes vendor CSV timestamps (e.g. "2026/11/25 5:35:05", "25-11-2026 05:35:05")
 * into consistent PostgreSQL-safe "YYYY-MM-DD HH:mm:ss" strings.
 */
function normalizeCsvTimestamp(rawVal, fallbackDateIso = getLocalDateKeys().iso) {
  const s = String(rawVal || '').trim();
  if (!s) return `${fallbackDateIso} 00:00:00`;

  // YYYY/MM/DD HH:mm:ss or YYYY-MM-DD HH:mm:ss
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) {
    const [, y, mo, d, h, mi, sec = '0'] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')} ${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${sec.padStart(2, '0')}`;
  }

  // DD/MM/YYYY HH:mm:ss or DD-MM-YYYY HH:mm:ss
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) {
    const [, d, mo, y, h, mi, sec = '0'] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')} ${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${sec.padStart(2, '0')}`;
  }

  // Time only HH:mm:ss
  m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const [, h, mi, sec = '0'] = m;
    return `${fallbackDateIso} ${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${sec.padStart(2, '0')}`;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const k = getLocalDateKeys(parsed);
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mi = String(parsed.getMinutes()).padStart(2, '0');
    const ss = String(parsed.getSeconds()).padStart(2, '0');
    return `${k.iso} ${hh}:${mi}:${ss}`;
  }

  return `${fallbackDateIso} 00:00:00`;
}

function extractDateIso(ts) {
  if (!ts) return '';
  if (ts instanceof Date) return getLocalDateKeys(ts).iso;
  const s = String(ts).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? s.slice(0, 10) : getLocalDateKeys(parsed).iso;
}

module.exports = {
  getLocalDateKeys,
  normalizeCsvTimestamp,
  extractDateIso
};
