// Workday / end-date calculation (spec 十二).
//
// Rules, in priority order:
//   1. A date listed as a 補班日 (calendar.workdays) IS a working day, even
//      on a Saturday or Sunday.
//   2. Saturday and Sunday are not working days.
//   3. A date listed as a holiday / custom day off is not a working day.

import { WorkCalendar } from './types';

export function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

export function emptyCalendar(): WorkCalendar {
  return { holidays: new Set<string>(), workdays: new Set<string>() };
}

/** Is this ISO date a working day under the given calendar? */
export function isWorkingDay(iso: string, calendar: WorkCalendar): boolean {
  if (calendar.workdays.has(iso)) return true;
  if (isWeekend(parseIso(iso))) return false;
  return !calendar.holidays.has(iso);
}

/**
 * End date such that exactly `workDays` working days fall between start and
 * end inclusive. The start date counts as day 1 when it is itself a working
 * day; otherwise counting begins at the next working day.
 */
export function calcEndDate(startDate: string, workDays: number, calendar: WorkCalendar): string {
  if (!startDate) throw new Error('start date required');
  const days = Math.max(1, Math.floor(workDays) || 1);
  let cursor = parseIso(startDate);
  let counted = 0;
  let safety = 0;
  while (counted < days) {
    const iso = toIso(cursor);
    if (isWorkingDay(iso, calendar)) {
      counted++;
      if (counted === days) return iso;
    }
    cursor = new Date(cursor.getTime() + 86400000);
    if (++safety > 3660) throw new Error('workday calculation exceeded safety bound');
  }
  return toIso(cursor);
}

/** Working days between two ISO dates, inclusive. */
export function countWorkDays(startDate: string, endDate: string, calendar: WorkCalendar): number {
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
