/**
 * System local date helpers to ensure every daily fetch strictly matches
 * the host server's current system date (YYYY-MM-DD / YYYYMMDD / DD-MM-YYYY).
 */

function getSystemDateKeys(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return {
    compact: `${yyyy}${mm}${dd}`, // e.g. "20261125"
    dashes: `${dd}-${mm}-${yyyy}`,  // e.g. "25-11-2026"
    iso: `${yyyy}-${mm}-${dd}`      // e.g. "2026-11-25"
  };
}

function normalizeCsvTimestamp(rawVal, fallbackDateIso = getSystemDateKeys().iso) {
  const s = String(rawVal || '').trim();
  if (!s) return `${fallbackDateIso} 00:00:00`;

  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) {
    const [, y, mo, d, h, mi, sec = '0'] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')} ${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${sec.padStart(2, '0')}`;
  }

  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) {
    const [, d, mo, y, h, mi, sec = '0'] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')} ${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${sec.padStart(2, '0')}`;
  }

  m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const [, h, mi, sec = '0'] = m;
    return `${fallbackDateIso} ${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${sec.padStart(2, '0')}`;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const k = getSystemDateKeys(parsed);
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mi = String(parsed.getMinutes()).padStart(2, '0');
    const ss = String(parsed.getSeconds()).padStart(2, '0');
    return `${k.iso} ${hh}:${mi}:${ss}`;
  }

  return `${fallbackDateIso} 00:00:00`;
}

function extractDateIso(ts) {
  if (!ts) return '';
  if (ts instanceof Date) return getSystemDateKeys(ts).iso;
  const s = String(ts).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? s.slice(0, 10) : getSystemDateKeys(parsed).iso;
}

module.exports = {
  getSystemDateKeys,
  normalizeCsvTimestamp,
  extractDateIso
};
