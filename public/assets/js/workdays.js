// Client-side mirror of functions/lib/workdays.ts, for instant feedback while
// dragging and editing. The server always recomputes and is the source of truth.
//
// A "calendar" is { holidays: Set<iso>, workdays: Set<iso> } where workdays
// are 補班日 — working days that fall on a weekend.

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

export function isWeekend(date) {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

export function addDaysIso(isoStr, days) {
  const d = parseIso(isoStr);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function emptyCalendar() {
  return { holidays: new Set(), workdays: new Set() };
}

export function isWorkingDay(isoStr, calendar) {
  if (calendar.workdays.has(isoStr)) return true;
  if (isWeekend(parseIso(isoStr))) return false;
  return !calendar.holidays.has(isoStr);
}

export function calcEndDate(startDate, workDays, calendar) {
  const days = Math.max(1, Math.floor(workDays) || 1);
  let cursor = parseIso(startDate);
  let counted = 0;
  let safety = 0;
  while (counted < days) {
    const isoStr = toIso(cursor);
    if (isWorkingDay(isoStr, calendar)) {
      counted++;
      if (counted === days) return isoStr;
    }
    cursor = new Date(cursor.getTime() + 86400000);
    if (++safety > 3660) throw new Error('workday calculation exceeded safety bound');
  }
  return toIso(cursor);
}

export function countWorkDays(startDate, endDate, calendar) {
  let cursor = parseIso(startDate);
  const end = parseIso(endDate);
  let count = 0;
  let safety = 0;
  while (cursor.getTime() <= end.getTime()) {
    if (isWorkingDay(toIso(cursor), calendar)) count++;
    cursor = new Date(cursor.getTime() + 86400000);
    if (++safety > 3660) break;
  }
  return count;
}

/** First working day strictly after `isoStr`. */
export function nextWorkingDay(isoStr, calendar) {
  let cursor = addDaysIso(isoStr, 1);
  for (let i = 0; i < 400; i++) {
    if (isWorkingDay(cursor, calendar)) return cursor;
    cursor = addDaysIso(cursor, 1);
  }
  return cursor;
}

/**
 * Break [start, end] into the contiguous runs of *working* days it actually
 * occupies, so a bar can be drawn with gaps over weekends and holidays.
 * Returns [{ from, to }] in ISO dates.
 */
export function workingRuns(startDate, endDate, calendar) {
  const runs = [];
  let cursor = startDate;
  const end = parseIso(endDate).getTime();
  let open = null;
  let safety = 0;
  while (parseIso(cursor).getTime() <= end && safety++ < 3660) {
    if (isWorkingDay(cursor, calendar)) {
      if (!open) open = { from: cursor, to: cursor };
      else open.to = cursor;
    } else if (open) {
      runs.push(open);
      open = null;
    }
    cursor = addDaysIso(cursor, 1);
  }
  if (open) runs.push(open);
  return runs;
}

export function formatDateShort(isoStr) {
  if (!isoStr) return '';
  const [, m, d] = isoStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}
