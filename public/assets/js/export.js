// PNG export (html2canvas) and Excel export (SheetJS). Both libraries are
// loaded globally via <script> tags in index.html from cdnjs, and both run
// entirely client-side against data already fetched from /export-data.

import { toastError, toastSuccess } from './toast.js';

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

export async function exportGanttPng(ganttContainerEl, boardName) {
  try {
    if (!window.html2canvas) {
      throw new Error('匯出元件尚未載入完成，請稍候再試一次。');
    }
    if (!ganttContainerEl || !ganttContainerEl.querySelector('.gantt-wrap')) {
      throw new Error('目前沒有可匯出的甘特圖內容。');
    }
    const canvas = await window.html2canvas(ganttContainerEl, {
      backgroundColor: '#ffffff',
      scale: Math.min(2, window.devicePixelRatio || 1.5),
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

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export function exportGanttExcel(board, items) {
  try {
    if (!window.XLSX) {
      throw new Error('匯出元件尚未載入完成，請稍候再試一次。');
    }
    const rows = items
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((it) => ({
        'Issue Key': it.issue_key || '',
        Summary: it.source === 'jira' ? it.jira_summary || it.title : it.title,
        分工: it.track || '',
        負責人: it.owner || '',
        來源: it.source === 'jira' ? 'Jira' : '手動',
        Status: it.source === 'jira' ? it.jira_status || '' : '',
        Assignee: it.source === 'jira' ? it.jira_assignee || '' : '',
        開始日期: it.start_date,
        結束日期: it.end_date,
        工作天數: it.work_days,
        備註: it.note || '',
      }));
    if (!rows.length) throw new Error('目前沒有可匯出的排程項目。');

    const ws = window.XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 40 },
      { wch: 10 },
      { wch: 12 },
      { wch: 8 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 30 },
    ];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '甘特圖排程');
    window.XLSX.writeFile(wb, `${board?.name || 'gantt'}-${todayStamp()}.xlsx`);
    toastSuccess('Excel 已匯出');
  } catch (err) {
    toastError(err);
  }
}
