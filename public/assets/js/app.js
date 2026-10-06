import { api } from './api.js';
import { toast, toastError, toastSuccess } from './toast.js';
import { renderGantt, escapeHtml } from './gantt.js';
import { DEFAULT_TRACKS } from './tracks.js';
import { emptyCalendar } from './workdays.js';
import {
  openCreateBoardModal,
  openItemEditModal,
  openTrackScheduleModal,
  openTrackSettingsModal,
  openIssueResolveModal,
  openHolidayModal,
  openShareModal,
  openJiraSettingsModal,
  openMembersModal,
} from './modals.js';
import { exportGanttPng, exportGanttExcel } from './export.js';
import { showLoginScreen } from './login.js';
import { openHelp } from './help.js';

const el = (id) => document.getElementById(id);

const state = {
  boards: [],
  boardId: null,
  board: null,
  items: [],
  backlog: [],
  syncLogs: [],
  holidays: [],
  calendar: emptyCalendar(),
  lastImport: null,
  tracks: DEFAULT_TRACKS,
  me: null,
  role: 'owner',
  members: [],
  jiraBaseUrl: null,
  jiraProjects: [],
  jiraVersions: [],
  selectedProjectKey: '',
  selectedVersionId: '',
  lastSyncSummary: null,
  backlogFilters: { key: '', summary: '', status: '', assignee: '' },
  selectedBacklogIds: new Set(),
  syncing: false,
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  // Nobody gets past this point without signing in with their own Jira account.
  try {
    state.me = await api.getMe();
  } catch (err) {
    if (err.status === 401) {
      await showLoginScreen();
      return;
    }
    toastError(err);
  }
  // From here on, a 401 means the session expired while the page was open.
  window.addEventListener('auth:required', () => showLoginScreen({ message: '登入已過期，請重新登入。' }));

  wireStaticHandlers();
  await loadMe();
  await loadJiraProjects();
  await loadBoards();

  const remembered = localStorage.getItem('jira-gantt:lastBoardId');
  if (remembered && state.boards.some((b) => b.id === remembered)) await selectBoard(remembered);
  else if (state.boards.length) await selectBoard(state.boards[0].id);
  else renderAll();
}

async function loadMe() {
  try {
    const me = await api.getMe();
    state.me = me;
    state.jiraBaseUrl = me.jira?.baseUrl || null;
    el('me-label').textContent = me.name || me.email;
    el('me-label').title = me.email;
    el('me-avatar').textContent = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
    addLogoutButton(me);
    el('unprotected-banner').hidden = !!me.protected;
    el('btn-jira').classList.toggle('needs-attention', !me.jira?.connected);
  } catch (err) {
    toastError(err);
  }
}

function addLogoutButton(me) {
  const btn = el('btn-logout');
  if (!btn || !me.canLogout || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.hidden = false;
  btn.title = '登出這台電腦';
  btn.addEventListener('click', async () => {
    try {
      await api.logout();
    } finally {
      location.reload();
    }
  });
}

async function loadJiraProjects() {
  try {
    const res = await api.listJiraProjects();
    state.jiraProjects = res.projects || [];
    const sel = el('project-select');
    sel.innerHTML =
      `<option value="">請選擇 Jira 專案...</option>` +
      state.jiraProjects
        .map((p) => `<option value="${escapeHtml(p.key)}">${escapeHtml(p.key)} - ${escapeHtml(p.name)}</option>`)
        .join('');
    sel.disabled = false;
  } catch (err) {
    const notConnected = err.code === 'jira_not_connected';
    el('project-select').innerHTML = `<option value="">${notConnected ? '請先設定 Jira 連線' : '無法載入 Jira 專案'}</option>`;
    if (!notConnected) toastError(err);
  }
}

async function loadBoards() {
  const res = await api.listBoards();
  state.boards = res.boards || [];
  el('board-select').innerHTML =
    `<option value="">請選擇甘特圖專案...</option>` +
    state.boards.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
}

// ---------------------------------------------------------------------------
// Board selection
// ---------------------------------------------------------------------------
async function selectBoard(id) {
  state.boardId = id;
  localStorage.setItem('jira-gantt:lastBoardId', id);
  el('board-select').value = id;
  await refreshBoard();

  if (state.board?.jira_project_key) {
    el('project-select').value = state.board.jira_project_key;
    state.selectedProjectKey = state.board.jira_project_key;
    await loadVersionsForProject(state.board.jira_project_key);
    if (state.board.current_version_id) {
      el('version-select').value = state.board.current_version_id;
      state.selectedVersionId = state.board.current_version_id;
    }
  } else {
    el('project-select').value = '';
    state.selectedProjectKey = '';
    el('version-select').innerHTML = `<option value="">請先選擇 Project</option>`;
    el('version-select').disabled = true;
    state.selectedVersionId = '';
  }
  updateSyncButtonState();
}

async function refreshBoard() {
  if (!state.boardId) return;
  try {
    const [data, holRes, trackRes] = await Promise.all([
      api.getBoard(state.boardId),
      api.listHolidays(state.boardId),
      api.listTracks(state.boardId),
    ]);
    state.board = data.board;
    state.items = data.items || [];
    state.backlog = data.backlog || [];
    state.syncLogs = data.syncLogs || [];
    state.members = data.members || [];
    state.role = data.role || 'viewer';
    if (state.syncLogs.length) state.lastSyncSummary = state.syncLogs[0];
    state.holidays = holRes.holidays || [];
    state.lastImport = holRes.lastImport || null;
    state.calendar = {
      holidays: new Set(state.holidays.filter((h) => !h.is_workday).map((h) => h.date)),
      workdays: new Set(state.holidays.filter((h) => h.is_workday).map((h) => h.date)),
    };
    state.tracks = trackRes.tracks || DEFAULT_TRACKS;
  } catch (err) {
    toastError(err);
  }
  renderAll();
}

async function loadVersionsForProject(projectKey) {
  const sel = el('version-select');
  sel.disabled = true;
  sel.innerHTML = `<option value="">載入中...</option>`;
  try {
    const res = await api.listJiraVersions(projectKey);
    state.jiraVersions = res.versions || [];
    if (!state.jiraVersions.length) {
      sel.innerHTML = `<option value="">此專案尚無 Version</option>`;
      toast('這個 Jira 專案目前沒有任何 Version。', 'error');
      return;
    }
    sel.innerHTML =
      `<option value="">請選擇 Version...</option>` +
      state.jiraVersions
        .map((v) => `<option value="${v.id}">${escapeHtml(v.name)}${v.released ? '（已發布）' : ''}</option>`)
        .join('');
    sel.disabled = false;
  } catch (err) {
    sel.innerHTML = `<option value="">載入失敗</option>`;
    toastError(err);
  }
}

function updateSyncButtonState() {
  const canEdit = state.role === 'owner' || state.role === 'editor';
  el('btn-sync').disabled =
    !(state.boardId && state.selectedProjectKey && state.selectedVersionId) || state.syncing || !canEdit;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
async function doSync() {
  if (!state.boardId || !state.selectedProjectKey || !state.selectedVersionId) return;
  state.syncing = true;
  const btn = el('btn-sync');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.innerHTML = `<span class="spinner"></span> 同步中...`;
  try {
    const projectName =
      state.jiraProjects.find((p) => p.key === state.selectedProjectKey)?.name || state.selectedProjectKey;
    const versionName = state.jiraVersions.find((v) => v.id === state.selectedVersionId)?.name || '';
    const res = await api.syncBoard(state.boardId, {
      projectKey: state.selectedProjectKey,
      projectName,
      versionId: state.selectedVersionId,
      versionName,
    });
    state.lastSyncSummary = res.log;
    toastSuccess(
      `同步完成：新增 ${res.summary.added.length}，更新 ${res.summary.updated.length}，移出 Version ${res.summary.removed.length}，無變更 ${res.summary.unchanged.length}`
    );
    await refreshBoard();
  } catch (err) {
    toastError(err);
  } finally {
    state.syncing = false;
    btn.textContent = originalLabel;
    updateSyncButtonState();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderAll() {
  renderBoardHeader();
  renderSyncSummary();
  renderBacklog();
  renderGanttSection();
}

function renderBoardHeader() {
  const hasBoard = !!state.board;
  el('no-board-panel').hidden = hasBoard;
  el('sync-summary-section').hidden = !hasBoard;
  el('backlog-section').hidden = !hasBoard;
  el('gantt-section').hidden = !hasBoard;
  const canEdit = state.role === 'owner' || state.role === 'editor';
  ['btn-tracks', 'btn-holidays', 'btn-share', 'btn-export-png', 'btn-export-xlsx', 'btn-members'].forEach((id) => {
    const node = el(id);
    if (node) node.disabled = !hasBoard;
  });
  ['btn-rename-board', 'btn-new-manual-item', 'btn-batch-add'].forEach((id) => {
    const node = el(id);
    if (node) node.disabled = !hasBoard || !canEdit;
  });
  el('btn-delete-board').disabled = !hasBoard || state.role !== 'owner';

  const badge = el('role-badge');
  if (!hasBoard) badge.hidden = true;
  else {
    badge.hidden = false;
    badge.textContent = state.role === 'owner' ? '擁有者' : state.role === 'editor' ? '編輯者' : '檢視者（唯讀）';
    badge.className = 'role-badge' + (canEdit ? '' : ' viewer');
  }

  if (state.board?.last_synced_at) {
    const d = new Date(state.board.last_synced_at);
    el('last-sync-label').innerHTML = `最後同步：<strong>${d.toLocaleString('zh-TW', { hour12: false })}</strong>`;
  } else {
    el('last-sync-label').textContent = '尚未同步';
  }
  updateSyncButtonState();
}

function renderSyncSummary() {
  const body = el('sync-summary-body');
  if (!state.lastSyncSummary) {
    body.innerHTML = `<span class="sync-meta">尚未執行過同步。選擇 Project 與 Version 後按「同步 Jira」開始。</span>`;
    return;
  }
  const s = state.lastSyncSummary;
  const when = new Date(s.synced_at).toLocaleString('zh-TW', { hour12: false });
  body.innerHTML = `
    <span class="sync-chip added"><b>${s.added_count}</b>新增</span>
    <span class="sync-chip updated"><b>${s.updated_count}</b>更新</span>
    <span class="sync-chip removed"><b>${s.removed_count}</b>移出 Version</span>
    <span class="sync-chip unchanged"><b>${s.unchanged_count}</b>無變更</span>
    <span class="sync-meta">Version ${escapeHtml(s.version_name || '-')}　·　${when}${
      s.status === 'failed' ? `　·　<span style="color:var(--color-danger)">同步失敗：${escapeHtml(s.error_message || '')}</span>` : ''
    }</span>`;
}

function filteredBacklog() {
  const f = state.backlogFilters;
  return state.backlog.filter((it) => {
    if (f.key && !it.issue_key.toLowerCase().includes(f.key.toLowerCase())) return false;
    if (f.summary && !(it.summary || '').toLowerCase().includes(f.summary.toLowerCase())) return false;
    if (f.status && it.status !== f.status) return false;
    if (f.assignee && it.assignee !== f.assignee) return false;
    return true;
  });
}

function renderBacklog() {
  el('backlog-count').textContent = state.backlog.length;

  const statusSel = el('backlog-filter-status');
  const assigneeSel = el('backlog-filter-assignee');
  const statuses = [...new Set(state.backlog.map((i) => i.status).filter(Boolean))];
  const assignees = [...new Set(state.backlog.map((i) => i.assignee).filter(Boolean))];
  const curStatus = statusSel.value;
  const curAssignee = assigneeSel.value;
  statusSel.innerHTML =
    `<option value="">全部 Status</option>` +
    statuses.map((s) => `<option${s === curStatus ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('');
  assigneeSel.innerHTML =
    `<option value="">全部 Assignee</option>` +
    assignees.map((a) => `<option${a === curAssignee ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('');

  const rows = filteredBacklog();
  const tbody = el('backlog-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--color-text-muted);padding:24px;">${
      state.backlog.length ? '沒有符合篩選條件的需求。' : '目前沒有待排程的 Jira 需求。按「同步 Jira」取得最新需求。'
    }</td></tr>`;
  } else {
    tbody.innerHTML = rows
      .map(
        (it) => `
      <tr>
        <td><input type="checkbox" class="backlog-check" data-key="${escapeHtml(it.issue_key)}" ${
          state.selectedBacklogIds.has(it.issue_key) ? 'checked' : ''
        } /></td>
        <td><a class="issue-key-pill" target="_blank" rel="noopener" href="${
          state.jiraBaseUrl ? `${state.jiraBaseUrl}/browse/${encodeURIComponent(it.issue_key)}` : '#'
        }">${escapeHtml(it.issue_key)}</a></td>
        <td>${escapeHtml(it.summary)}</td>
        <td><span class="badge badge-status">${escapeHtml(it.status || '-')}</span></td>
        <td>${escapeHtml(it.assignee || '未指派')}</td>
        <td><span class="badge badge-type">${escapeHtml(it.issue_type || '-')}</span></td>
        <td><button class="btn btn-sm btn-primary" data-add-single="${escapeHtml(it.issue_key)}">排程</button></td>
      </tr>`
      )
      .join('');
  }

  tbody.querySelectorAll('.backlog-check').forEach((cb) =>
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedBacklogIds.add(cb.dataset.key);
      else state.selectedBacklogIds.delete(cb.dataset.key);
      el('btn-batch-add').disabled = state.selectedBacklogIds.size === 0;
    })
  );
  tbody.querySelectorAll('[data-add-single]').forEach((btn) =>
    btn.addEventListener('click', () => addSingleToGantt(btn.dataset.addSingle))
  );

  el('backlog-select-all').checked = rows.length > 0 && rows.every((r) => state.selectedBacklogIds.has(r.issue_key));
  el('btn-batch-add').disabled = state.selectedBacklogIds.size === 0;
}

function renderGanttSection() {
  el('gantt-count').textContent = state.items.length;
  renderGantt(el('gantt-container'), {
    items: state.items,
    calendar: state.calendar,
    jiraBaseUrl: state.jiraBaseUrl,
    presets: state.tracks,
    readOnly: !(state.role === 'owner' || state.role === 'editor'),
    onItemChange: handleItemChange,
    onEdit: handleEditItem,
    onDelete: handleDeleteItem,
    onDeleteGroup: handleDeleteGroup,
    onReorder: handleReorder,
    onResolveIssue: handleResolveIssue,
    onAddTrack: handleAddTrackToGroup,
    onRerender: renderGanttSection,
  });
}

// ---------------------------------------------------------------------------
// Scheduling (multi-track)
// ---------------------------------------------------------------------------
async function addSingleToGantt(issueKey) {
  const issue = state.backlog.find((i) => i.issue_key === issueKey);
  if (!issue) return;
  openTrackScheduleModal({
    heading: '加入甘特圖',
    subtitle: `${issueKey}｜${issue.summary}`,
    presets: state.tracks,
    calendar: state.calendar,
    onSave: async (tracks) => {
      await api.createItem(state.boardId, { issueKey, tracks });
      toastSuccess(`${issueKey} 已加入甘特圖（${tracks.length} 個分工）`);
      await refreshBoard();
    },
  });
}

async function addBatchToGantt() {
  const keys = Array.from(state.selectedBacklogIds);
  if (!keys.length) return;
  openTrackScheduleModal({
    heading: `批次加入甘特圖（${keys.length} 筆需求）`,
    subtitle: '以下分工設定會套用到所有勾選的需求，加入後可再個別調整。',
    presets: state.tracks,
    calendar: state.calendar,
    submitLabel: `加入 ${keys.length} 筆`,
    onSave: async (tracks) => {
      const results = await Promise.allSettled(
        keys.map((issueKey) => api.createItem(state.boardId, { issueKey, tracks }))
      );
      const failed = results.filter((r) => r.status === 'rejected');
      state.selectedBacklogIds.clear();
      await refreshBoard();
      if (failed.length) toast(`已加入 ${keys.length - failed.length} 筆，${failed.length} 筆失敗。`, 'error');
      else toastSuccess(`已加入 ${keys.length} 筆需求，每筆 ${tracks.length} 個分工`);
    },
  });
}

/** "＋" on a parent row: add more tracks to an issue already on the chart. */
function handleAddTrackToGroup(group) {
  if (!group) return;
  const used = group.items.map((i) => i.track).filter(Boolean);
  openTrackScheduleModal({
    heading: '新增分工',
    subtitle: group.issueKey ? `${group.issueKey}｜${group.title}` : group.title,
    presets: state.tracks,
    calendar: state.calendar,
    disabledTracks: used,
    submitLabel: '新增',
    onSave: async (tracks) => {
      if (group.issueKey) {
        await api.createItem(state.boardId, { issueKey: group.issueKey, tracks });
      } else {
        await api.createItem(state.boardId, {
          source: 'manual',
          title: group.title,
          groupName: group.groupName,
          tracks,
        });
      }
      toastSuccess(`已新增 ${tracks.length} 個分工`);
      await refreshBoard();
    },
  });
}

function openNewManualItemModal() {
  openItemEditModal({
    mode: 'create-manual',
    presets: state.tracks,
    onSave: async (payload) => {
      await api.createItem(state.boardId, {
        source: 'manual',
        title: payload.title,
        groupName: payload.groupName,
        track: payload.track,
        owner: payload.owner,
        startDate: payload.startDate,
        workDays: payload.workDays,
        note: payload.note,
        color: payload.color,
      });
      toastSuccess('項目已新增');
      await refreshBoard();
    },
  });
}

function handleEditItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  openItemEditModal({
    mode: 'edit',
    item,
    presets: state.tracks,
    defaultTitle: item.source === 'jira' ? `${item.issue_key}｜${item.jira_summary || ''}` : item.title,
    onSave: async (payload) => {
      await api.updateItem(id, payload);
      toastSuccess('已儲存');
      await refreshBoard();
    },
    onDelete: async () => {
      await api.deleteItem(id);
      toastSuccess('已刪除');
      await refreshBoard();
    },
  });
}

async function handleDeleteItem(id) {
  if (!confirm('確定要刪除這一條排程嗎？')) return;
  try {
    await api.deleteItem(id);
    toastSuccess('已刪除');
    await refreshBoard();
  } catch (err) {
    toastError(err);
  }
}

async function handleDeleteGroup(ids, title) {
  if (!ids.length) return;
  if (!confirm(`確定要刪除「${title}」底下全部 ${ids.length} 條分工排程嗎？`)) return;
  try {
    await Promise.all(ids.map((id) => api.deleteItem(id)));
    toastSuccess('已刪除');
    await refreshBoard();
  } catch (err) {
    toastError(err);
  }
}

async function handleItemChange(id, patch) {
  try {
    await api.updateItem(id, patch);
    await refreshBoard();
  } catch (err) {
    toastError(err);
    await refreshBoard();
  }
}

async function handleReorder(orderedIds) {
  const orders = orderedIds.map((id, idx) => ({ id, sortOrder: idx }));
  const byId = new Map(state.items.map((i) => [i.id, i]));
  state.items = orderedIds.map((id, idx) => ({ ...byId.get(id), sort_order: idx })).filter((i) => i && i.id);
  renderGanttSection();
  try {
    await api.reorderItems(orders);
  } catch (err) {
    toastError(err);
    await refreshBoard();
  }
}

function handleResolveIssue(issueKey, movedToVersion) {
  if (!issueKey) return;
  openIssueResolveModal({
    issueKey,
    movedToVersion,
    onResolve: async (action) => {
      await api.resolveIssue(state.boardId, issueKey, action);
      toastSuccess(action === 'remove' ? '已從甘特圖移除' : action === 'move' ? '已移至新 Version' : '已保留目前排程');
      await refreshBoard();
    },
  });
}

// ---------------------------------------------------------------------------
// Board CRUD / settings
// ---------------------------------------------------------------------------
function handleNewBoard() {
  openCreateBoardModal({
    onCreate: async (name) => {
      const res = await api.createBoard({ name });
      await loadBoards();
      await selectBoard(res.board.id);
      toastSuccess('專案已建立');
    },
  });
}

async function handleRenameBoard() {
  if (!state.board) return;
  const name = prompt('輸入新的專案名稱：', state.board.name);
  if (!name || !name.trim() || name.trim() === state.board.name) return;
  try {
    await api.updateBoard(state.board.id, { name: name.trim() });
    await loadBoards();
    await refreshBoard();
    el('board-select').value = state.boardId;
    toastSuccess('已更新專案名稱');
  } catch (err) {
    toastError(err);
  }
}

async function handleDeleteBoard() {
  if (!state.board) return;
  if (!confirm(`確定要刪除專案「${state.board.name}」嗎？此動作將刪除所有排程資料且無法復原。`)) return;
  try {
    await api.deleteBoard(state.board.id);
    toastSuccess('專案已刪除');
    state.boardId = null;
    state.board = null;
    localStorage.removeItem('jira-gantt:lastBoardId');
    await loadBoards();
    if (state.boards.length) await selectBoard(state.boards[0].id);
    else renderAll();
  } catch (err) {
    toastError(err);
  }
}

function openTracksModal() {
  openTrackSettingsModal({
    presets: state.tracks,
    onSave: async (tracks) => {
      await api.saveTracks(state.boardId, tracks);
      toastSuccess('分工設定已更新');
      await refreshBoard();
    },
  });
}

function openHolidaysModal() {
  openHolidayModal({
    holidays: state.holidays,
    lastImport: state.lastImport,
    canEdit: state.role === 'owner' || state.role === 'editor',
    onAdd: async (date, name, isWorkday) => {
      await api.addHoliday(state.boardId, { date, name, isWorkday });
      toastSuccess(isWorkday ? '補班日已新增' : '休假日已新增');
      await refreshBoard();
    },
    onDelete: async (id) => {
      await api.deleteHoliday(state.boardId, id);
      toastSuccess('已刪除');
      await refreshBoard();
    },
    onImport: async ({ csv, fileName, apply }) => {
      const res = await api.importHolidays(state.boardId, { csv, fileName, apply });
      if (apply) {
        toastSuccess(`日曆已匯入：新增 ${res.result.added}、更新 ${res.result.updated}`);
        await refreshBoard();
      }
      return res;
    },
  });
}

function openJiraModal() {
  openJiraSettingsModal({
    status: state.me?.jira ?? { connected: false },
    onSave: async (data) => {
      await api.saveJiraSettings(data);
      toastSuccess('Jira 連線已儲存');
      await loadMe();
      await loadJiraProjects();
    },
    onTest: async (data) => {
      // Save first so the test uses exactly what is on screen.
      await api.saveJiraSettings(data);
      const res = await api.testJiraConnection();
      await loadMe();
      return res;
    },
    onClear: async () => {
      const res = await api.clearJiraSettings();
      if (res?.signedOut) {
        location.reload(); // your Jira token is your sign-in
        return;
      }
      toastSuccess('已清除 Jira 連線');
      await loadMe();
      await loadJiraProjects();
    },
  });
}

async function openBoardMembersModal() {
  try {
    const res = await api.listMembers(state.boardId);
    openMembersModal({
      board: state.board,
      owner: res.owner,
      members: res.members || [],
      myRole: res.myRole,
      onAdd: async (email, role) => {
        await api.addMember(state.boardId, email, role);
        toastSuccess(`已加入 ${email}`);
        await refreshBoard();
      },
      onRemove: async (email) => {
        await api.removeMember(state.boardId, email);
        toastSuccess(`已移除 ${email}`);
        await refreshBoard();
      },
      onTransfer: async (email) => {
        await api.transferOwner(state.boardId, email);
        toastSuccess(`已把擁有者轉移給 ${email}`);
        await refreshBoard();
      },
    });
  } catch (err) {
    toastError(err);
  }
}

async function openShareLinkModal() {
  try {
    const res = await api.listShareLinks(state.boardId);
    openShareModal({
      links: res.links || [],
      onCreate: async () => {
        await api.createShareLink(state.boardId);
        toastSuccess('分享連結已建立');
        openShareLinkModal();
      },
      onRevoke: async (linkId) => {
        await api.revokeShareLink(state.boardId, linkId);
        toastSuccess('分享連結已停用');
        openShareLinkModal();
      },
    });
  } catch (err) {
    toastError(err);
  }
}

async function handleExportPng() {
  await exportGanttPng(el('gantt-container'), state.board?.name);
}

async function handleExportExcel() {
  try {
    const data = await api.getExportData(state.boardId);
    await exportGanttExcel(data.board, data.items, { calendar: state.calendar, presets: state.tracks });
  } catch (err) {
    toastError(err);
  }
}

// ---------------------------------------------------------------------------
// Static event wiring
// ---------------------------------------------------------------------------
function wireStaticHandlers() {
  el('board-select').addEventListener('change', (e) => {
    if (e.target.value) selectBoard(e.target.value);
  });
  el('btn-new-board').addEventListener('click', handleNewBoard);
  el('btn-rename-board').addEventListener('click', handleRenameBoard);
  el('btn-delete-board').addEventListener('click', handleDeleteBoard);

  el('project-select').addEventListener('change', async (e) => {
    state.selectedProjectKey = e.target.value;
    state.selectedVersionId = '';
    if (state.selectedProjectKey) await loadVersionsForProject(state.selectedProjectKey);
    else {
      el('version-select').innerHTML = `<option value="">請先選擇 Project</option>`;
      el('version-select').disabled = true;
    }
    updateSyncButtonState();
  });
  el('version-select').addEventListener('change', (e) => {
    state.selectedVersionId = e.target.value;
    updateSyncButtonState();
  });
  el('btn-sync').addEventListener('click', doSync);

  el('btn-batch-add').addEventListener('click', addBatchToGantt);
  el('backlog-select-all').addEventListener('change', (e) => {
    const rows = filteredBacklog();
    if (e.target.checked) rows.forEach((r) => state.selectedBacklogIds.add(r.issue_key));
    else rows.forEach((r) => state.selectedBacklogIds.delete(r.issue_key));
    renderBacklog();
  });
  el('backlog-search-key').addEventListener('input', (e) => {
    state.backlogFilters.key = e.target.value;
    renderBacklog();
  });
  el('backlog-search-summary').addEventListener('input', (e) => {
    state.backlogFilters.summary = e.target.value;
    renderBacklog();
  });
  el('backlog-filter-status').addEventListener('change', (e) => {
    state.backlogFilters.status = e.target.value;
    renderBacklog();
  });
  el('backlog-filter-assignee').addEventListener('change', (e) => {
    state.backlogFilters.assignee = e.target.value;
    renderBacklog();
  });

  el('btn-new-manual-item').addEventListener('click', openNewManualItemModal);
  el('btn-tracks').addEventListener('click', openTracksModal);
  el('btn-holidays').addEventListener('click', openHolidaysModal);
  el('btn-jira').addEventListener('click', openJiraModal);
  el('btn-help').addEventListener('click', () => openHelp({ sessionDays: state.me?.sessionDays || 90 }));
  el('btn-members').addEventListener('click', openBoardMembersModal);
  el('btn-share').addEventListener('click', openShareLinkModal);
  el('btn-export-png').addEventListener('click', handleExportPng);
  el('btn-export-xlsx').addEventListener('click', handleExportExcel);
}

init();
