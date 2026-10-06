import { api } from './api.js';
import { toastError } from './toast.js';
import { renderGantt, escapeHtml } from './gantt.js';

function normalizeItem(it) {
  return {
    id: it.id,
    issue_key: it.issueKey,
    source: it.source,
    title: it.title,
    group_name: it.groupName,
    track: it.track,
    owner: it.owner,
    start_date: it.startDate,
    work_days: it.workDays,
    end_date: it.endDate,
    note: it.note,
    color: it.color,
    sort_order: it.sortOrder,
    jira_summary: it.source === 'jira' ? it.title : null,
    jira_status: it.jiraStatus,
    jira_assignee: it.jiraAssignee,
    jira_issue_type: it.jiraIssueType,
    jira_sync_state: it.jiraRemoved ? 'removed' : 'active',
    jira_moved_to_version_name: null,
  };
}

async function init() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  const titleEl = document.getElementById('share-title');
  const metaEl = document.getElementById('share-meta');
  const container = document.getElementById('share-gantt-container');

  if (!token) {
    titleEl.textContent = '找不到分享連結';
    metaEl.textContent = '網址缺少分享權杖 (token)，請確認連結是否完整。';
    return;
  }

  try {
    const data = await api.getSharedBoard(token);
    titleEl.textContent = data.board.name;
    const parts = [];
    if (data.board.jiraProjectName) parts.push(`Jira 專案：${data.board.jiraProjectName}`);
    if (data.board.lastSyncedAt) parts.push(`最後同步：${new Date(data.board.lastSyncedAt).toLocaleString('zh-TW', { hour12: false })}`);
    metaEl.textContent = parts.join('　·　') || '';

    const items = data.items.map(normalizeItem);
    const calendar = {
      holidays: new Set(data.calendar?.holidays ?? []),
      workdays: new Set(data.calendar?.workdays ?? []),
    };
    renderGantt(container, {
      items,
      calendar,
      jiraBaseUrl: null, // public viewers may not have Jira access
      readOnly: true,
    });
  } catch (err) {
    titleEl.textContent = '無法載入分享內容';
    metaEl.textContent = '';
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>${escapeHtml(err.message)}</div>`;
    toastError(err);
  }
}

init();
