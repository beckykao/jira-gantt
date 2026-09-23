// Thin fetch wrapper around the Pages Functions API. All Jira credentials
// stay server-side — this file never sees them.

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  } catch (e) {
    const err = new Error('無法連線到伺服器，請檢查網路連線後再試一次。');
    err.code = 'network_error';
    throw err;
  }
  if (res.status === 204) return null;
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    const message = body?.error?.message || `發生錯誤 (HTTP ${res.status})`;
    const err = new Error(message);
    err.code = body?.error?.code || 'http_error';
    err.status = res.status;
    throw err;
  }
  return body;
}

export const api = {
  // config
  getConfig: () => request('/api/config'),

  // jira
  listJiraProjects: () => request('/api/jira/projects'),
  listJiraVersions: (projectKey) => request(`/api/jira/${encodeURIComponent(projectKey)}/versions`),

  // boards
  listBoards: () => request('/api/boards'),
  createBoard: (data) => request('/api/boards', { method: 'POST', body: JSON.stringify(data) }),
  getBoard: (id) => request(`/api/boards/${id}`),
  updateBoard: (id, data) => request(`/api/boards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBoard: (id) => request(`/api/boards/${id}`, { method: 'DELETE' }),

  // sync
  syncBoard: (id, data) => request(`/api/boards/${id}/sync`, { method: 'POST', body: JSON.stringify(data) }),
  listSyncLogs: (id) => request(`/api/boards/${id}/sync`),

  // backlog / items
  getBacklog: (id) => request(`/api/boards/${id}/backlog`),
  listItems: (id) => request(`/api/boards/${id}/items`),
  createItem: (boardId, data) => request(`/api/boards/${boardId}/items`, { method: 'POST', body: JSON.stringify(data) }),
  updateItem: (itemId, data) => request(`/api/items/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteItem: (itemId) => request(`/api/items/${itemId}`, { method: 'DELETE' }),
  reorderItems: (orders) => request('/api/items/reorder', { method: 'POST', body: JSON.stringify({ orders }) }),

  // issue resolution (moved / removed from version)
  resolveIssue: (boardId, issueKey, action) =>
    request(`/api/boards/${boardId}/issues/${encodeURIComponent(issueKey)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // work tracks (分工)
  listTracks: (boardId) => request(`/api/boards/${boardId}/tracks`),
  saveTracks: (boardId, tracks) =>
    request(`/api/boards/${boardId}/tracks`, { method: 'PUT', body: JSON.stringify({ tracks }) }),

  // holidays
  listHolidays: (boardId) => request(`/api/boards/${boardId}/holidays`),
  addHoliday: (boardId, data) => request(`/api/boards/${boardId}/holidays`, { method: 'POST', body: JSON.stringify(data) }),
  deleteHoliday: (boardId, holidayId) => request(`/api/boards/${boardId}/holidays/${holidayId}`, { method: 'DELETE' }),

  // share
  listShareLinks: (boardId) => request(`/api/boards/${boardId}/share`),
  createShareLink: (boardId) => request(`/api/boards/${boardId}/share`, { method: 'POST' }),
  revokeShareLink: (boardId, linkId) => request(`/api/boards/${boardId}/share/${linkId}`, { method: 'DELETE' }),

  // export
  getExportData: (boardId) => request(`/api/boards/${boardId}/export-data`),

  // public share view
  getSharedBoard: (token) => request(`/api/share/${token}`),
};
