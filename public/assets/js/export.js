// PNG export (html2canvas) and Excel export (ExcelJS).
//
// html2canvas is loaded globally via a <script> tag in index.html. ExcelJS is
// loaded on demand the first time someone exports to Excel (it supports cell
// fills, which SheetJS community edition does not — that is what draws the
// coloured bars in the spreadsheet).

import { toastError, toastSuccess } from './toast.js';
import { addDaysIso, isWorkingDay, parseIso, emptyCalendar } from './workdays.js';
import { trackColor, trackSortIndex } from './tracks.js';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

// Browsers refuse to create canvases beyond roughly these limits.
const MAX_CANVAS_SIDE = 16000;
const MAX_CANVAS_AREA = 120_000_000;

export async function exportGanttPng(ganttContainerEl, boardName) {
  try {
    if (!window.html2canvas) {
      throw new Error('匯出元件尚未載入完成，請稍候再試一次。');
    }
    const wrap = ganttContainerEl?.querySelector('.gantt-wrap');
    if (!wrap) throw new Error('目前沒有可匯出的甘特圖內容。');

    const list = wrap.querySelector('.gantt-list');
    const timeline = wrap.querySelector('.gantt-timeline');
    const inner = wrap.querySelector('.gantt-timeline-inner');

    // On screen the chart sits in a 70vh box and the timeline scrolls in both
    // directions, so a plain screenshot only captures the visible part.
    // Measure the full content size, then un-clip everything in the copy
    // html2canvas renders from (the page the user sees is not touched).
    const listWidth = list.offsetWidth;
    const timelineWidth = inner.scrollWidth;
    const fullWidth = listWidth + timelineWidth + 2; // + wrap border
    const fullHeight = Math.max(list.scrollHeight, timeline.scrollHeight) + 2;

    let scale = Math.min(2, window.devicePixelRatio || 1.5);
    scale = Math.min(
      scale,
      MAX_CANVAS_SIDE / fullWidth,
      MAX_CANVAS_SIDE / fullHeight,
      Math.sqrt(MAX_CANVAS_AREA / (fullWidth * fullHeight))
    );

    const canvas = await window.html2canvas(wrap, {
      backgroundColor: '#ffffff',
      scale,
      width: fullWidth,
      height: fullHeight,
      // A wide virtual window keeps the desktop layout (no mobile breakpoint).
      windowWidth: Math.max(fullWidth + 40, 1280),
      windowHeight: fullHeight + 40,
      scrollX: 0,
      scrollY: 0,
      onclone: (doc) => {
        const w = doc.querySelector('.gantt-wrap');
        const l = w.querySelector('.gantt-list');
        const t = w.querySelector('.gantt-timeline');
        Object.assign(w.style, {
          maxHeight: 'none',
          height: `${fullHeight}px`,
          width: `${fullWidth}px`,
          overflow: 'visible',
          flexDirection: 'row',
        });
        Object.assign(l.style, {
          maxHeight: 'none',
          overflow: 'visible',
          flex: 'none',
          width: `${listWidth}px`,
        });
        Object.assign(t.style, {
          maxHeight: 'none',
          overflow: 'visible',
          flex: 'none',
          width: `${timelineWidth}px`,
        });
        l.scrollTop = 0;
        t.scrollTop = 0;
        t.scrollLeft = 0;
        // Edit / delete / add buttons and drag handles are noise in an image.
        w.querySelectorAll('.row-actions, .drag-handle').forEach((n) => (n.style.visibility = 'hidden'));
      },
    });

    canvas.toBlob((blob) => {
      if (!blob) {
        toastError(new Error('PNG 匯出失敗，請稍後再試。'));
        return;
      }
      downloadBlob(blob, `${boardName || 'gantt'}-${todayStamp()}.png`);
      toastSuccess('PNG 已匯出');
    }, 'image/png');
  } catch (err) {
    toastError(err);
  }
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

const EXCELJS_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
];

let excelJsPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => {
      s.remove();
      reject(new Error(`無法載入 ${src}`));
    };
    document.head.appendChild(s);
  });
}

function loadExcelJs() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelJsPromise) {
    excelJsPromise = (async () => {
      for (const url of EXCELJS_URLS) {
        try {
          await loadScript(url);
          if (window.ExcelJS) return window.ExcelJS;
        } catch {
          /* try the next mirror */
        }
      }
      excelJsPromise = null;
      throw new Error('Excel 匯出元件載入失敗，請檢查網路後再試一次。');
    })();
  }
  return excelJsPromise;
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const COLOR = {
  headerBg: 'FFF1F3F5',
  border: 'FFDEE2E6',
  weekendBg: 'FFF8F9FA',
  holidayBg: 'FFFFF0F0',
  holidayText: 'FFE03131',
  parentBg: 'FFFBFCFE',
  parentBar: 'FFADB5BD',
  gapBg: 'FFE9ECEF',
  todayBg: 'FFEDF2FF',
};

const argb = (hex) => `FF${String(hex || '#4C6EF5').replace('#', '').toUpperCase()}`;
const solid = (color) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });

function itemSummary(it) {
  return it.source === 'jira' ? it.jira_summary || it.title || '' : it.title || '';
}

/** Same grouping as the on-screen chart: one parent per Jira issue / manual group. */
function groupItems(items, presets) {
  const map = new Map();
  for (const it of items) {
    const key = it.issue_key ? `jira:${it.issue_key}` : it.group_name ? `group:${it.group_name}` : `solo:${it.id}`;
    if (!map.has(key)) map.set(key, { key, items: [] });
    map.get(key).items.push(it);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.items.sort((a, b) => trackSortIndex(presets, a.track) - trackSortIndex(presets, b.track) || a.sort_order - b.sort_order);
    g.minSort = Math.min(...g.items.map((i) => i.sort_order));
    g.start = g.items.reduce((m, i) => (i.start_date < m ? i.start_date : m), g.items[0].start_date);
    g.end = g.items.reduce((m, i) => (i.end_date > m ? i.end_date : m), g.items[0].end_date);
    const first = g.items[0];
    g.issueKey = first.issue_key || '';
    g.title = first.source === 'jira' ? first.jira_summary || first.title || first.issue_key : first.group_name || first.title || '';
    g.status = first.source === 'jira' ? first.jira_status || '' : '';
    g.assignee = first.source === 'jira' ? first.jira_assignee || '' : '';
    g.flat = g.items.length === 1 && !first.track;
  }
  groups.sort((a, b) => a.minSort - b.minSort);
  return groups;
}

function dayDiff(a, b) {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);
}

/**
 * @param board     board info ({ name })
 * @param items     schedule items from /export-data
 * @param options   { calendar, presets } — same values the on-screen chart uses
 */
export async function exportGanttExcel(board, items, options = {}) {
  try {
    if (!items?.length) throw new Error('目前沒有可匯出的排程項目。');
    const ExcelJS = await loadExcelJs();
    const wb = await buildWorkbook(ExcelJS, board, items, options);
    const buf = await wb.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${board?.name || 'gantt'}-${todayStamp()}.xlsx`
    );
    toastSuccess('Excel 已匯出');
  } catch (err) {
    toastError(err);
  }
}

/** Exported separately so it can be tested without a browser. */
export async function buildWorkbook(ExcelJS, board, items, { calendar = emptyCalendar(), presets = [] } = {}) {
  const groups = groupItems(items, presets);
  const rangeStart = addDaysIso(groups.reduce((m, g) => (g.start < m ? g.start : m), groups[0].start), -2);
  const rangeEnd = addDaysIso(groups.reduce((m, g) => (g.end > m ? g.end : m), groups[0].end), 2);
  const totalDays = dayDiff(rangeStart, rangeEnd) + 1;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jira 甘特圖';

  // ----- Sheet 1: Gantt chart -----------------------------------------------
  const ws = wb.addWorksheet('甘特圖', {
    views: [{ state: 'frozen', xSplit: 7, ySplit: 3 }],
    // Printing: landscape, whole chart fits one page wide.
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const INFO_COLS = [
    { header: '項目 / 分工', width: 42 },
    { header: '負責人', width: 10 },
    { header: 'Status', width: 10 },
    { header: 'Assignee', width: 11 },
    { header: '開始', width: 7 },
    { header: '結束', width: 7 },
    { header: '天數', width: 9 },
  ];
  const DAY_COL0 = INFO_COLS.length + 1; // first date column (1-based)

  INFO_COLS.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  for (let d = 0; d < totalDays; d++) ws.getColumn(DAY_COL0 + d).width = 4.2;

  const thin = { style: 'thin', color: { argb: COLOR.border } };
  const hair = { style: 'hair', color: { argb: COLOR.border } };
  const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

  const days = [];
  for (let d = 0; d < totalDays; d++) {
    const iso = addDaysIso(rangeStart, d);
    const dt = parseIso(iso);
    const working = isWorkingDay(iso, calendar);
    const weekend = [0, 6].includes(dt.getUTCDay());
    days.push({ iso, dt, working, holiday: !working && !weekend, weekend: !working && weekend });
  }

  // Header: row 1 month, row 2 day, row 3 weekday
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = r === 1 ? 18 : 16;
  INFO_COLS.forEach((c, i) => {
    ws.mergeCells(1, i + 1, 3, i + 1);
    const cell = ws.getCell(1, i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center' };
    cell.fill = solid(COLOR.headerBg);
    cell.border = { bottom: thin, right: thin };
  });

  let monthStart = 0;
  for (let d = 1; d <= totalDays; d++) {
    if (d === totalDays || days[d].dt.getUTCDate() === 1) {
      const first = days[monthStart].dt;
      if (d - 1 > monthStart) ws.mergeCells(1, DAY_COL0 + monthStart, 1, DAY_COL0 + d - 1);
      const c = ws.getCell(1, DAY_COL0 + monthStart);
      c.value = `${first.getUTCFullYear()}/${first.getUTCMonth() + 1}月`;
      c.font = { bold: true, size: 10 };
      c.alignment = { horizontal: 'left', vertical: 'middle' };
      c.fill = solid(COLOR.headerBg);
      c.border = { left: thin };
      monthStart = d;
    }
  }

  days.forEach((day, d) => {
    const col = DAY_COL0 + d;
    const off = day.holiday || day.weekend;
    const bg = day.holiday ? COLOR.holidayBg : day.weekend ? COLOR.weekendBg : COLOR.headerBg;
    const color = off ? COLOR.holidayText : 'FF495057';
    const dc = ws.getCell(2, col);
    dc.value = day.dt.getUTCDate();
    dc.font = { size: 9, bold: true, color: { argb: color } };
    const wc = ws.getCell(3, col);
    wc.value = WEEKDAY_LABELS[day.dt.getUTCDay()];
    wc.font = { size: 8, color: { argb: color } };
    for (const c of [dc, wc]) {
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.fill = solid(bg);
    }
    wc.border = { bottom: thin };
  });

  // Body
  let rowNo = 4;

  const paintRow = (row, { from, to, color, label, isParent = false }) => {
    const startIdx = dayDiff(rangeStart, from);
    const endIdx = dayDiff(rangeStart, to);
    let labelPlaced = false;
    days.forEach((day, d) => {
      const cell = row.getCell(DAY_COL0 + d);
      const inBar = d >= startIdx && d <= endIdx;
      if (inBar && (isParent || day.working)) {
        cell.fill = solid(color);
        if (!labelPlaced && label) {
          // Text overflows into the empty cells to the right, like a bar label.
          cell.value = label;
          cell.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
          labelPlaced = true;
        }
      } else if (inBar) {
        // Non-working day inside a task: grey gap, like the on-screen bar.
        cell.fill = solid(COLOR.gapBg);
      } else if (day.holiday) {
        cell.fill = solid(COLOR.holidayBg);
      } else if (day.weekend) {
        cell.fill = solid(COLOR.weekendBg);
      } else if (isParent) {
        cell.fill = solid(COLOR.parentBg);
      }
      cell.border = { bottom: hair };
    });
  };

  const writeInfo = (row, values, { isParent = false, color = null } = {}) => {
    values.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v ?? '';
      c.font = { size: 10, bold: isParent && i === 0 };
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', indent: i === 0 && !isParent ? 2 : 0 };
      c.border = { bottom: hair, ...(i === values.length - 1 ? { right: thin } : {}) };
      if (isParent) c.fill = solid(COLOR.parentBg);
    });
    if (color) row.getCell(1).font = { size: 10, bold: true, color: { argb: color } };
  };

  for (const g of groups) {
    const parentTitle = g.issueKey ? `[${g.issueKey}] ${g.title}` : g.title;

    if (g.flat) {
      const it = g.items[0];
      const row = ws.getRow(rowNo++);
      row.height = 20;
      writeInfo(row, [parentTitle, it.owner, g.status, g.assignee, md(it.start_date), md(it.end_date), it.work_days], { isParent: true });
      if (it.note) row.getCell(1).note = it.note;
      paintRow(row, { from: it.start_date, to: it.end_date, color: argb(trackColor(presets, it.track)), label: '' });
      continue;
    }

    const prow = ws.getRow(rowNo++);
    prow.height = 20;
    writeInfo(prow, [parentTitle, '', g.status, g.assignee, md(g.start), md(g.end), `${g.items.length} 個分工`], { isParent: true });
    paintRow(prow, { from: g.start, to: g.end, color: COLOR.parentBar, label: '', isParent: true });

    for (const it of g.items) {
      const color = argb(trackColor(presets, it.track));
      const row = ws.getRow(rowNo++);
      row.height = 18;
      writeInfo(row, [it.track || '(未分工)', it.owner, '', '', md(it.start_date), md(it.end_date), it.work_days], { color });
      if (it.note) row.getCell(1).note = it.note;
      paintRow(row, { from: it.start_date, to: it.end_date, color, label: [it.track, it.owner].filter(Boolean).join('・') });
    }
  }

  // Legend
  rowNo++;
  const legendRow = ws.getRow(rowNo);
  legendRow.getCell(1).value = '圖例';
  legendRow.getCell(1).font = { size: 9, bold: true };
  legendRow.getCell(1).alignment = { horizontal: 'right' };
  const trackNames = [...new Set(items.map((i) => i.track).filter(Boolean))].sort(
    (a, b) => trackSortIndex(presets, a) - trackSortIndex(presets, b)
  );
  const legend = [
    ...trackNames.map((t) => ({ name: t, fill: argb(trackColor(presets, t)), font: 'FFFFFFFF' })),
    { name: '假日', fill: COLOR.holidayBg, font: COLOR.holidayText },
    { name: '週末', fill: COLOR.weekendBg, font: 'FF495057' },
  ];
  legend.forEach((l, i) => {
    const c = legendRow.getCell(2 + i);
    c.value = l.name;
    c.fill = solid(l.fill);
    c.font = { size: 9, bold: true, color: { argb: l.font } };
    c.alignment = { horizontal: 'center' };
  });

  // ----- Sheet 2: detail table (same columns as the previous export) -------
  const detail = wb.addWorksheet('明細', { views: [{ state: 'frozen', ySplit: 1 }] });
  detail.columns = [
    { header: 'Issue Key', key: 'k', width: 14 },
    { header: 'Summary', key: 's', width: 40 },
    { header: '分工', key: 't', width: 10 },
    { header: '負責人', key: 'o', width: 12 },
    { header: '來源', key: 'src', width: 8 },
    { header: 'Status', key: 'st', width: 12 },
    { header: 'Assignee', key: 'a', width: 14 },
    { header: '開始日期', key: 'sd', width: 12 },
    { header: '結束日期', key: 'ed', width: 12 },
    { header: '工作天數', key: 'wd', width: 10 },
    { header: '備註', key: 'n', width: 30 },
  ];
  for (const g of groups) {
    for (const it of g.items) {
      const r = detail.addRow({
        k: it.issue_key || '',
        s: itemSummary(it),
        t: it.track || '',
        o: it.owner || '',
        src: it.source === 'jira' ? 'Jira' : '手動',
        st: it.source === 'jira' ? it.jira_status || '' : '',
        a: it.source === 'jira' ? it.jira_assignee || '' : '',
        sd: it.start_date,
        ed: it.end_date,
        wd: it.work_days,
        n: it.note || '',
      });
      if (it.track) {
        const c = r.getCell('t');
        c.fill = solid(argb(trackColor(presets, it.track)));
        c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      }
    }
  }
  const h = detail.getRow(1);
  h.font = { bold: true };
  h.eachCell((c) => (c.fill = solid(COLOR.headerBg)));
  detail.autoFilter = { from: 'A1', to: 'K1' };

  return wb;
}
