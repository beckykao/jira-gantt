// Client-side mirror of functions/lib/workdays.ts — used for instant UI
// feedback while dragging/editing. The server always recomputes and is the
// source of truth; this is a convenience only.

export function isWeekend(date) {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

export function toIso(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDaysIso(iso, days) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function calcEndDate(startDate, workDays, holidaySet) {
  const days = Math.max(1, Math.floor(workDays) || 1);
  let cursor = parseIso(startDate);
  let counted = 0;
  let safety = 0;
  while (counted < days) {
    const iso = toIso(cursor);
    if (!isWeekend(cursor) && !holidaySet.has(iso)) {
      counted++;
      if (counted === days) return iso;
    }
    cursor = new Date(cursor.getTime() + 86400000);
    safety++;
    if (safety > 3660) throw new Error('workday calculation exceeded safety bound');
  }
  return toIso(cursor);
}

export function countWorkDays(startDate, endDate, holidaySet) {
  let cursor = parseIso(startDate);
  const end = parseIso(endDate);
  let count = 0;
  let safety = 0;
  while (cursor.getTime() <= end.getTime()) {
    const iso = toIso(cursor);
    if (!isWeekend(cursor) && !holidaySet.has(iso)) count++;
    cursor = new Date(cursor.getTime() + 86400000);
    safety++;
    if (safety > 3660) break;
  }
  return count;
}

export function formatDateShort(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}
