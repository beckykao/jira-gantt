// D1 data-access helpers. Keeping raw SQL in one place makes it easy to
// audit that Jira sync never touches gantt scheduling columns.

import type {
  Board,
  BoardMemberRow,
  Env,
  GanttItemRow,
  HolidayRow,
  JiraIssueRow,
  ShareLinkRow,
  SyncLogRow,
  SyncState,
  UserRow,
  WorkCalendar,
} from './types';
import { nowIso, uuid } from './http';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUser(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<UserRow>();
}

export async function ensureUser(env: Env, email: string, displayName: string | null): Promise<UserRow> {
  const existing = await getUser(env, email);
  if (existing) return existing;
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO users (email, display_name, jira_check_ok, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`
  )
    .bind(email, displayName, ts, ts)
    .run();
  return (await getUser(env, email))!;
}

export async function saveUserJira(
  env: Env,
  email: string,
  data: { baseUrl: string; jiraEmail: string; tokenEnc: string | null }
): Promise<void> {
  const ts = nowIso();
  if (data.tokenEnc === null) {
    // Keep the existing token, only update the other two fields.
    await env.DB.prepare(
      `UPDATE users SET jira_base_url = ?, jira_email = ?, updated_at = ? WHERE email = ?`
    )
      .bind(data.baseUrl, data.jiraEmail, ts, email)
      .run();
    return;
  }
  await env.DB.prepare(
    `UPDATE users SET jira_base_url = ?, jira_email = ?, jira_token_enc = ?, jira_check_ok = 0, updated_at = ? WHERE email = ?`
  )
    .bind(data.baseUrl, data.jiraEmail, data.tokenEnc, ts, email)
    .run();
}

export async function clearUserJira(env: Env, email: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE users SET jira_base_url = NULL, jira_email = NULL, jira_token_enc = NULL,
     jira_check_ok = 0, jira_checked_at = NULL, updated_at = ? WHERE email = ?`
  )
    .bind(nowIso(), email)
    .run();
}

export async function markJiraChecked(env: Env, email: string, ok: boolean): Promise<void> {
  await env.DB.prepare(`UPDATE users SET jira_check_ok = ?, jira_checked_at = ?, updated_at = ? WHERE email = ?`)
    .bind(ok ? 1 : 0, nowIso(), nowIso(), email)
    .run();
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/** Boards this person owns, was invited to, or that predate ownership. */
export async function listBoards(env: Env, email: string): Promise<Board[]> {
  const { results } = await env.DB.prepare(
    `SELECT b.* FROM boards b
     WHERE b.owner_email IS NULL
        OR b.owner_email = ?
        OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.email = ?)
     ORDER BY b.updated_at DESC`
  )
    .bind(email, email)
    .all<Board>();
  return results ?? [];
}

export async function getBoard(env: Env, id: string): Promise<Board | null> {
  return env.DB.prepare(`SELECT * FROM boards WHERE id = ?`).bind(id).first<Board>();
}

export async function createBoard(
  env: Env,
  input: {
    name: string;
    ownerEmail: string;
    jira_project_key?: string | null;
    jira_project_name?: string | null;
  }
): Promise<Board> {
  const id = uuid();
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO boards (id, name, owner_email, jira_project_key, jira_project_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, input.name, input.ownerEmail, input.jira_project_key ?? null, input.jira_project_name ?? null, ts, ts)
    .run();
  return (await getBoard(env, id))!;
}

/** Take ownership of a board created before multi-user support existed. */
export async function claimBoard(env: Env, boardId: string, email: string): Promise<void> {
  await env.DB.prepare(`UPDATE boards SET owner_email = ?, updated_at = ? WHERE id = ? AND owner_email IS NULL`)
    .bind(email, nowIso(), boardId)
    .run();
}

// ---------------------------------------------------------------------------
// Board members
// ---------------------------------------------------------------------------

export async function listMembers(env: Env, boardId: string): Promise<BoardMemberRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM board_members WHERE board_id = ? ORDER BY created_at ASC`
  )
    .bind(boardId)
    .all<BoardMemberRow>();
  return results ?? [];
}

export async function addMember(env: Env, boardId: string, email: string, role: 'editor' | 'viewer'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO board_members (board_id, email, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(board_id, email) DO UPDATE SET role = excluded.role`
  )
    .bind(boardId, email, role, nowIso())
    .run();
}

/**
 * Hand a board to one of its members. In one atomic batch: the new owner
 * leaves the member list, and the previous owner (if any) stays on as editor.
 */
export async function transferOwnership(
  env: Env,
  boardId: string,
  fromEmail: string | null,
  toEmail: string
): Promise<void> {
  const ts = nowIso();
  const stmts = [
    env.DB.prepare(`UPDATE boards SET owner_email = ?, updated_at = ? WHERE id = ?`).bind(toEmail, ts, boardId),
    env.DB.prepare(`DELETE FROM board_members WHERE board_id = ? AND email = ?`).bind(boardId, toEmail),
  ];
  if (fromEmail) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO board_members (board_id, email, role, created_at) VALUES (?, ?, 'editor', ?)
         ON CONFLICT(board_id, email) DO UPDATE SET role = 'editor'`
      ).bind(boardId, fromEmail, ts)
    );
  }
  await env.DB.batch(stmts);
}

export async function removeMember(env: Env, boardId: string, email: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM board_members WHERE board_id = ? AND email = ?`).bind(boardId, email).run();
}

export async function updateBoard(
  env: Env,
  id: string,
  patch: Partial<Pick<Board, 'name'>>
): Promise<Board | null> {
  const existing = await getBoard(env, id);
  if (!existing) return null;
  const name = patch.name ?? existing.name;
  await env.DB.prepare(`UPDATE boards SET name = ?, updated_at = ? WHERE id = ?`)
    .bind(name, nowIso(), id)
    .run();
  return getBoard(env, id);
}

export async function setBoardJiraProject(
  env: Env,
  id: string,
  jiraProjectKey: string,
  jiraProjectName: string
): Promise<void> {
  await env.DB.prepare(`UPDATE boards SET jira_project_key = ?, jira_project_name = ?, updated_at = ? WHERE id = ?`)
    .bind(jiraProjectKey, jiraProjectName, nowIso(), id)
    .run();
}

export async function deleteBoard(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM boards WHERE id = ?`).bind(id).run();
}

export async function touchBoardSync(
  env: Env,
  id: string,
  versionId: string,
  versionName: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE boards SET current_version_id = ?, current_version_name = ?, last_synced_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(versionId, versionName, nowIso(), nowIso(), id)
    .run();
}

// ---------------------------------------------------------------------------
// jira_issues
// ---------------------------------------------------------------------------

export async function listJiraIssues(env: Env, boardId: string): Promise<JiraIssueRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM jira_issues WHERE board_id = ?`)
    .bind(boardId)
    .all<JiraIssueRow>();
  return results ?? [];
}

/** Backlog = active Jira issues for this board that have no gantt_items row yet. */
export async function listBacklog(env: Env, boardId: string): Promise<JiraIssueRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT ji.* FROM jira_issues ji
     WHERE ji.board_id = ? AND ji.sync_state = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM gantt_items gi
         WHERE gi.board_id = ji.board_id AND gi.issue_key = ji.issue_key
       )
     ORDER BY ji.issue_key ASC`
  )
    .bind(boardId)
    .all<JiraIssueRow>();
  return results ?? [];
}

export async function getJiraIssue(env: Env, boardId: string, issueKey: string): Promise<JiraIssueRow | null> {
  return env.DB.prepare(`SELECT * FROM jira_issues WHERE board_id = ? AND issue_key = ?`)
    .bind(boardId, issueKey)
    .first<JiraIssueRow>();
}

export async function upsertJiraIssueInsert(
  env: Env,
  boardId: string,
  data: {
    issueKey: string;
    projectKey: string;
    summary: string;
    status: string;
    assignee: string;
    issueType: string;
    versionId: string;
    versionName: string;
    jiraUpdatedAt: string;
  }
): Promise<void> {
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO jira_issues
      (board_id, issue_key, project_key, summary, status, assignee, issue_type,
       version_id, version_name, jira_updated_at, last_synced_at, sync_state,
       moved_to_version_id, moved_to_version_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?)`
  )
    .bind(
      boardId,
      data.issueKey,
      data.projectKey,
      data.summary,
      data.status,
      data.assignee,
      data.issueType,
      data.versionId,
      data.versionName,
      data.jiraUpdatedAt,
      ts,
      ts,
      ts
    )
    .run();
}

export async function updateJiraIssueFields(
  env: Env,
  boardId: string,
  issueKey: string,
  data: {
    summary: string;
    status: string;
    assignee: string;
    issueType: string;
    versionId: string;
    versionName: string;
    jiraUpdatedAt: string;
  }
): Promise<void> {
  await env.DB.prepare(
    `UPDATE jira_issues SET
       summary = ?, status = ?, assignee = ?, issue_type = ?,
       version_id = ?, version_name = ?, jira_updated_at = ?,
       last_synced_at = ?, sync_state = 'active',
       moved_to_version_id = NULL, moved_to_version_name = NULL,
       updated_at = ?
     WHERE board_id = ? AND issue_key = ?`
  )
    .bind(
      data.summary,
      data.status,
      data.assignee,
      data.issueType,
      data.versionId,
      data.versionName,
      data.jiraUpdatedAt,
      nowIso(),
      nowIso(),
      boardId,
      issueKey
    )
    .run();
}

export async function touchJiraIssueSeen(env: Env, boardId: string, issueKey: string): Promise<void> {
  await env.DB.prepare(`UPDATE jira_issues SET last_synced_at = ? WHERE board_id = ? AND issue_key = ?`)
    .bind(nowIso(), boardId, issueKey)
    .run();
}

export async function markJiraIssueRemoved(
  env: Env,
  boardId: string,
  issueKey: string,
  opts: { movedToVersionId?: string | null; movedToVersionName?: string | null; refreshedSummary?: string | null; refreshedStatus?: string | null } = {}
): Promise<void> {
  await env.DB.prepare(
    `UPDATE jira_issues SET
       sync_state = 'removed',
       last_synced_at = ?,
       moved_to_version_id = ?,
       moved_to_version_name = ?,
       summary = COALESCE(?, summary),
       status = COALESCE(?, status),
       updated_at = ?
     WHERE board_id = ? AND issue_key = ?`
  )
    .bind(
      nowIso(),
      opts.movedToVersionId ?? null,
      opts.movedToVersionName ?? null,
      opts.refreshedSummary ?? null,
      opts.refreshedStatus ?? null,
      nowIso(),
      boardId,
      issueKey
    )
    .run();
}

export async function resolveMovedIssue(
  env: Env,
  boardId: string,
  issueKey: string,
  action: 'move' | 'keep'
): Promise<void> {
  if (action === 'move') {
    const row = await getJiraIssue(env, boardId, issueKey);
    if (!row) return;
    await env.DB.prepare(
      `UPDATE jira_issues SET
         sync_state = 'active', version_id = moved_to_version_id, version_name = moved_to_version_name,
         moved_to_version_id = NULL, moved_to_version_name = NULL, updated_at = ?
       WHERE board_id = ? AND issue_key = ?`
    )
      .bind(nowIso(), boardId, issueKey)
      .run();
  }
  // 'keep' = no-op, just leaves it marked removed/moved as-is (user acknowledged it).
}

// ---------------------------------------------------------------------------
// gantt_items
// ---------------------------------------------------------------------------

export interface GanttItemView extends GanttItemRow {
  jira_summary: string | null;
  jira_status: string | null;
  jira_assignee: string | null;
  jira_issue_type: string | null;
  jira_sync_state: SyncState | null;
  jira_moved_to_version_name: string | null;
}

export async function listGanttItems(env: Env, boardId: string): Promise<GanttItemView[]> {
  const { results } = await env.DB.prepare(
    `SELECT gi.*,
            ji.summary AS jira_summary,
            ji.status AS jira_status,
            ji.assignee AS jira_assignee,
            ji.issue_type AS jira_issue_type,
            ji.sync_state AS jira_sync_state,
            ji.moved_to_version_name AS jira_moved_to_version_name
     FROM gantt_items gi
     LEFT JOIN jira_issues ji ON ji.board_id = gi.board_id AND ji.issue_key = gi.issue_key
     WHERE gi.board_id = ?
     ORDER BY gi.sort_order ASC, gi.created_at ASC`
  )
    .bind(boardId)
    .all<GanttItemView>();
  return results ?? [];
}

export async function getGanttItem(env: Env, id: string): Promise<GanttItemRow | null> {
  return env.DB.prepare(`SELECT * FROM gantt_items WHERE id = ?`).bind(id).first<GanttItemRow>();
}

export async function createGanttItem(
  env: Env,
  boardId: string,
  input: {
    issueKey?: string | null;
    source: 'jira' | 'manual';
    title: string;
    groupName?: string | null;
    track?: string | null;
    owner?: string | null;
    startDate: string;
    workDays: number;
    endDate: string;
    note?: string;
    color?: string;
    sortOrder?: number;
  }
): Promise<GanttItemRow> {
  const id = uuid();
  const ts = nowIso();
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const row = await env.DB.prepare(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM gantt_items WHERE board_id = ?`
    )
      .bind(boardId)
      .first<{ next: number }>();
    sortOrder = row?.next ?? 0;
  }
  await env.DB.prepare(
    `INSERT INTO gantt_items
      (id, board_id, issue_key, source, title, group_name, track, owner, start_date, work_days, end_date, note, color, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      boardId,
      input.issueKey ?? null,
      input.source,
      input.title,
      input.groupName ?? null,
      input.track ?? null,
      input.owner ?? null,
      input.startDate,
      input.workDays,
      input.endDate,
      input.note ?? '',
      input.color ?? '#4C6EF5',
      sortOrder,
      ts,
      ts
    )
    .run();
  return (await getGanttItem(env, id))!;
}

export async function updateGanttItem(
  env: Env,
  id: string,
  patch: Partial<{
    title: string;
    groupName: string | null;
    track: string | null;
    owner: string | null;
    startDate: string;
    workDays: number;
    endDate: string;
    note: string;
    color: string;
    sortOrder: number;
  }>
): Promise<GanttItemRow | null> {
  const existing = await getGanttItem(env, id);
  if (!existing) return null;
  const merged = {
    title: patch.title ?? existing.title,
    group_name: patch.groupName !== undefined ? patch.groupName : existing.group_name,
    track: patch.track !== undefined ? patch.track : existing.track,
    owner: patch.owner !== undefined ? patch.owner : existing.owner,
    start_date: patch.startDate ?? existing.start_date,
    work_days: patch.workDays ?? existing.work_days,
    end_date: patch.endDate ?? existing.end_date,
    note: patch.note ?? existing.note,
    color: patch.color ?? existing.color,
    sort_order: patch.sortOrder ?? existing.sort_order,
  };
  await env.DB.prepare(
    `UPDATE gantt_items SET title=?, group_name=?, track=?, owner=?, start_date=?, work_days=?, end_date=?, note=?, color=?, sort_order=?, updated_at=?
     WHERE id = ?`
  )
    .bind(
      merged.title,
      merged.group_name,
      merged.track,
      merged.owner,
      merged.start_date,
      merged.work_days,
      merged.end_date,
      merged.note,
      merged.color,
      merged.sort_order,
      nowIso(),
      id
    )
    .run();
  return getGanttItem(env, id);
}

/** Rename a track across every schedule row on a board (used when the user
 * renames a preset, so existing rows follow the new name). */
export async function renameTrack(env: Env, boardId: string, oldName: string, newName: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE gantt_items SET track = ?, updated_at = ? WHERE board_id = ? AND track = ?`
  )
    .bind(newName, nowIso(), boardId, oldName)
    .run();
}

/** Re-colour every schedule row of one track (colours are per-track by design). */
export async function recolorTrack(env: Env, boardId: string, track: string, color: string): Promise<void> {
  await env.DB.prepare(`UPDATE gantt_items SET color = ?, updated_at = ? WHERE board_id = ? AND track = ?`)
    .bind(color, nowIso(), boardId, track)
    .run();
}

export async function setBoardTrackPresets(env: Env, boardId: string, presetsJson: string): Promise<void> {
  await env.DB.prepare(`UPDATE boards SET track_presets = ?, updated_at = ? WHERE id = ?`)
    .bind(presetsJson, nowIso(), boardId)
    .run();
}

export async function deleteGanttItem(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM gantt_items WHERE id = ?`).bind(id).run();
}

export async function reorderGanttItems(env: Env, orders: { id: string; sortOrder: number }[]): Promise<void> {
  const stmts = orders.map((o) =>
    env.DB.prepare(`UPDATE gantt_items SET sort_order = ?, updated_at = ? WHERE id = ?`).bind(
      o.sortOrder,
      nowIso(),
      o.id
    )
  );
  await env.DB.batch(stmts);
}

// ---------------------------------------------------------------------------
// holidays
// ---------------------------------------------------------------------------

export async function listHolidays(env: Env, boardId: string): Promise<HolidayRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM holidays WHERE board_id IS NULL OR board_id = ? ORDER BY date ASC`
  )
    .bind(boardId)
    .all<HolidayRow>();
  return results ?? [];
}

/** The day rules this board schedules against: days off, plus 補班日. */
export async function getWorkCalendar(env: Env, boardId: string): Promise<WorkCalendar> {
  const rows = await listHolidays(env, boardId);
  const holidays = new Set<string>();
  const workdays = new Set<string>();
  for (const r of rows) {
    if (r.is_workday) workdays.add(r.date);
    else holidays.add(r.date);
  }
  // A forced work day always wins over a day-off row for the same date.
  for (const d of workdays) holidays.delete(d);
  return { holidays, workdays };
}

export async function addCustomHoliday(
  env: Env,
  boardId: string,
  date: string,
  name: string,
  isWorkday = false
): Promise<HolidayRow> {
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO holidays (board_id, date, name, type, is_workday, created_at) VALUES (?, ?, ?, 'custom', ?, ?)
     ON CONFLICT(date, type, COALESCE(board_id, '')) DO UPDATE SET name = excluded.name, is_workday = excluded.is_workday`
  )
    .bind(boardId, date, name, isWorkday ? 1 : 0, ts)
    .run();
  const row = await env.DB.prepare(
    `SELECT * FROM holidays WHERE board_id = ? AND date = ? AND type = 'custom'`
  )
    .bind(boardId, date)
    .first<HolidayRow>();
  return row!;
}

/** Replace the shared government calendar with an imported set of rows. */
export async function importGovernmentHolidays(
  env: Env,
  rows: Array<{ date: string; name: string; isWorkday: boolean }>
): Promise<{ added: number; updated: number }> {
  const existing = await env.DB.prepare(
    `SELECT date FROM holidays WHERE board_id IS NULL AND type = 'government'`
  ).all<{ date: string }>();
  const known = new Set((existing.results ?? []).map((r) => r.date));

  const ts = nowIso();
  const stmts = rows.map((r) =>
    env.DB.prepare(
      `INSERT INTO holidays (board_id, date, name, type, is_workday, created_at)
       VALUES (NULL, ?, ?, 'government', ?, ?)
       ON CONFLICT(date, type, COALESCE(board_id, '')) DO UPDATE SET
         name = excluded.name, is_workday = excluded.is_workday`
    ).bind(r.date, r.name, r.isWorkday ? 1 : 0, ts)
  );
  for (let i = 0; i < stmts.length; i += 40) {
    await env.DB.batch(stmts.slice(i, i + 40));
  }

  let added = 0;
  for (const r of rows) if (!known.has(r.date)) added++;
  return { added, updated: rows.length - added };
}

export async function logHolidayImport(
  env: Env,
  data: { importedBy: string; fileName: string; added: number; updated: number; workdays: number }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO holiday_imports (imported_by, file_name, added_count, updated_count, workday_count, imported_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(data.importedBy, data.fileName, data.added, data.updated, data.workdays, nowIso())
    .run();
}

export async function lastHolidayImport(env: Env): Promise<{
  imported_by: string;
  file_name: string | null;
  imported_at: string;
  added_count: number;
  updated_count: number;
} | null> {
  return env.DB.prepare(
    `SELECT imported_by, file_name, imported_at, added_count, updated_count
     FROM holiday_imports ORDER BY imported_at DESC LIMIT 1`
  ).first();
}

export async function deleteHoliday(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM holidays WHERE id = ? AND type = 'custom'`).bind(id).run();
}

// ---------------------------------------------------------------------------
// sync_logs
// ---------------------------------------------------------------------------

export async function insertSyncLog(
  env: Env,
  row: Omit<SyncLogRow, 'id' | 'synced_at'>
): Promise<SyncLogRow> {
  const ts = nowIso();
  const res = await env.DB.prepare(
    `INSERT INTO sync_logs (board_id, version_id, version_name, added_count, updated_count, removed_count, unchanged_count, status, error_message, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.board_id,
      row.version_id,
      row.version_name,
      row.added_count,
      row.updated_count,
      row.removed_count,
      row.unchanged_count,
      row.status,
      row.error_message,
      ts
    )
    .run();
  const id = res.meta.last_row_id as number;
  return { id, synced_at: ts, ...row };
}

export async function listSyncLogs(env: Env, boardId: string, limit = 20): Promise<SyncLogRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM sync_logs WHERE board_id = ? ORDER BY synced_at DESC LIMIT ?`
  )
    .bind(boardId, limit)
    .all<SyncLogRow>();
  return results ?? [];
}

// ---------------------------------------------------------------------------
// share_links
// ---------------------------------------------------------------------------

export async function createShareLink(env: Env, boardId: string): Promise<ShareLinkRow> {
  const id = uuid();
  const ts = nowIso();
  await env.DB.prepare(`INSERT INTO share_links (id, board_id, created_at, revoked_at) VALUES (?, ?, ?, NULL)`)
    .bind(id, boardId, ts)
    .run();
  return { id, board_id: boardId, created_at: ts, revoked_at: null };
}

export async function listShareLinks(env: Env, boardId: string): Promise<ShareLinkRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM share_links WHERE board_id = ? ORDER BY created_at DESC`
  )
    .bind(boardId)
    .all<ShareLinkRow>();
  return results ?? [];
}

export async function getActiveShareLink(env: Env, token: string): Promise<ShareLinkRow | null> {
  return env.DB.prepare(`SELECT * FROM share_links WHERE id = ? AND revoked_at IS NULL`)
    .bind(token)
    .first<ShareLinkRow>();
}

export async function revokeShareLink(env: Env, token: string): Promise<void> {
  await env.DB.prepare(`UPDATE share_links SET revoked_at = ? WHERE id = ?`).bind(nowIso(), token).run();
}
