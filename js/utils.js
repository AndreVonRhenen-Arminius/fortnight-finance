export const CURRENCY = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' });
export const DATE = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
export const SHORT_DATE = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short' });

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

export function toDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isoDate(value) {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayISO() { return isoDate(new Date()); }
export function addDays(value, days) { const d = toDate(value); d.setDate(d.getDate() + days); return d; }

export function addMonthsClamped(value, months, preferredDay = null) {
  const d = toDate(value);
  const day = preferredDay || d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return target;
}

export function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}

export function money(value) { return CURRENCY.format(Number(value || 0)); }
export function formatDate(value) { const d = toDate(value); return d ? DATE.format(d) : '—'; }
export function formatShortDate(value) { const d = toDate(value); return d ? SHORT_DATE.format(d) : '—'; }
export function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }

export function frequencyLabel(value) {
  return ({ weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', once: 'One-time' })[value] || value;
}

export function nextOccurrence(value, frequency, preferredDay = null) {
  const d = toDate(value);
  if (!d) return null;
  if (frequency === 'weekly') return addDays(d, 7);
  if (frequency === 'fortnightly') return addDays(d, 14);
  if (frequency === 'monthly') return addMonthsClamped(d, 1, preferredDay);
  if (frequency === 'quarterly') return addMonthsClamped(d, 3, preferredDay);
  if (frequency === 'yearly') return addMonthsClamped(d, 12, preferredDay);
  return null;
}

export function occurrencesBetween(item, startValue, endValue) {
  if (!item.active || !item.nextDate) return [];
  const start = toDate(startValue);
  const end = toDate(endValue);
  let cursor = toDate(item.nextDate);
  const result = [];
  let guard = 0;

  if (item.frequency === 'once') {
    if (cursor >= start && cursor <= end) result.push(isoDate(cursor));
    return result;
  }

  while (cursor < start && guard++ < 1000) {
    cursor = nextOccurrence(cursor, item.frequency, item.dayOfMonth);
  }
  while (cursor && cursor <= end && guard++ < 1200) {
    result.push(isoDate(cursor));
    cursor = nextOccurrence(cursor, item.frequency, item.dayOfMonth);
  }
  return result;
}

export function fortnightContaining(anchorValue, targetValue = new Date()) {
  const anchor = toDate(anchorValue);
  const target = toDate(targetValue);
  const diff = daysBetween(anchor, target);
  const blocks = Math.floor(diff / 14);
  const start = addDays(anchor, blocks * 14);
  return { start: isoDate(start), end: isoDate(addDays(start, 13)) };
}

export function fingerprintTransaction(tx) {
  const raw = `${tx.accountId || ''}|${tx.date || ''}|${Number(tx.amount || 0).toFixed(2)}|${String(tx.description || '').trim().toUpperCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}

export function csvParse(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; i++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(field); field = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i++;
      row.push(field); field = '';
      if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
  return rows;
}

export function parseMoney(value) {
  if (value === null || value === undefined || value === '') return 0;
  const clean = String(value).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

export function parseDateFlexible(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) return isoDate(text);
  const nz = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (nz) {
    let year = Number(nz[3]); if (year < 100) year += 2000;
    return isoDate(new Date(year, Number(nz[2]) - 1, Number(nz[1])));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : isoDate(parsed);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
