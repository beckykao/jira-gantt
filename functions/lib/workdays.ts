// Workday / end-date calculation shared logic (spec section 十二).
// Rules: exclude Saturday/Sunday, exclude government + custom holidays.
// The start date counts as day 1 if it is itself a workday.

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Given a start date (YYYY-MM-DD), a positive work-day count, and a set of
 * holiday ISO date strings, returns the end date (YYYY-MM-DD) such that
 * exactly `workDays` non-weekend, non-holiday days fall between start and
 * end inclusive.
 */
export function calcEndDate(startDate: string, workDays: number, holidaySet: Set<string>): string {
  if (!startDate) throw new Error('start date required');
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

/** Count how many workdays fall strictly between two ISO dates (inclusive). */
export function countWorkDays(startDate: string, endDate: string, holidaySet: Set<string>): number {
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
