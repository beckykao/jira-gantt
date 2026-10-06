// Parser for the Taiwan government office calendar CSV.
//
// Primary format — 政府資料開放平臺「政府行政機關辦公日曆表」:
//   西元日期,星期,是否放假,備註
//   20260101,四,2,開國紀念日
//   20260103,六,2,
//   20260207,六,0,補行上班
// where 是否放假: 2 = 放假, 0 = 上班.
//
// Also accepted — a hand-made two-column list:
//   日期,名稱
//   2026-01-01,元旦
//
// Weekend rows that are simply "放假" with no name are skipped: weekends are
// already non-working days, so storing ~104 rows a year would only bloat the
// table. Weekend rows marked as 上班 ARE kept — those are 補班日 and must
// count as working days.

import { AppError } from './types';

export interface ParsedHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  isWorkday: boolean; // true = 補班日
}

export interface ParseResult {
  rows: ParsedHoliday[];
  format: 'dgpa' | 'simple';
  stats: { holidays: number; workdays: number; skipped: number; total: number };
  years: string[];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Accepts 20260101 / 2026-01-01 / 2026/1/1 and returns YYYY-MM-DD. */
function normalizeDate(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, '');
  if (!s) return null;
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function isWeekendIso(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

export function parseHolidayCsv(text: string): ParseResult {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    throw new AppError('CSV 檔案是空的，請確認檔案內容。', 400, 'csv_empty');
  }

  const header = splitCsvLine(lines[0]);
  const headerText = header.join(',');
  const looksDgpa = /是否放假/.test(headerText);
  const hasHeader = looksDgpa || /日期|date/i.test(headerText);
  const body = hasHeader ? lines.slice(1) : lines;

  // Locate columns for the DGPA layout; fall back to fixed positions.
  const dateIdx = looksDgpa ? Math.max(0, header.findIndex((h) => /日期|date/i.test(h))) : 0;
  const offIdx = looksDgpa ? header.findIndex((h) => /是否放假/.test(h)) : -1;
  const noteIdx = looksDgpa ? header.findIndex((h) => /備註|名稱|假日名稱/.test(h)) : 1;

  const rows: ParsedHoliday[] = [];
  const seen = new Set<string>();
  const years = new Set<string>();
  let skipped = 0;
  let holidays = 0;
  let workdays = 0;

  for (const line of body) {
    const cells = splitCsvLine(line);
    const date = normalizeDate(cells[dateIdx] ?? '');
    if (!date) {
      skipped++;
      continue;
    }
    if (seen.has(date)) {
      skipped++;
      continue;
    }

    const note = (noteIdx >= 0 ? cells[noteIdx] ?? '' : '').trim();

    if (looksDgpa && offIdx >= 0) {
      const off = (cells[offIdx] ?? '').trim();
      const isOff = off === '2';
      if (isOff) {
        if (!note && isWeekendIso(date)) {
          skipped++; // plain weekend, already non-working
          continue;
        }
        rows.push({ date, name: note || '放假', isWorkday: false });
        holidays++;
      } else {
        if (!isWeekendIso(date)) {
          skipped++; // ordinary working weekday
          continue;
        }
        rows.push({ date, name: note || '補行上班', isWorkday: true });
        workdays++;
      }
    } else {
      // simple 日期,名稱 — everything listed is a day off
      rows.push({ date, name: note || '休假日', isWorkday: false });
      holidays++;
    }

    seen.add(date);
    years.add(date.slice(0, 4));
  }

  if (!rows.length) {
    throw new AppError(
      '這個 CSV 裡沒有可匯入的假日資料。請確認是「政府行政機關辦公日曆表」格式（西元日期／星期／是否放假／備註），或是「日期,名稱」兩欄格式。',
      400,
      'csv_no_rows'
    );
  }

  return {
    rows,
    format: looksDgpa && offIdx >= 0 ? 'dgpa' : 'simple',
    stats: { holidays, workdays, skipped, total: rows.length },
    years: [...years].sort(),
  };
}
