// Public, unauthenticated, read-only endpoint backing share.html. Never
// includes Jira tokens/credentials — only display fields.

import * as db from '../../lib/db';
import { errorResponse, json, options } from '../../lib/http';
import { AppError, Env } from '../../lib/types';

export async function onRequestGet(context: { env: Env; params: { token: string } }): Promise<Response> {
  try {
    const link = await db.getActiveShareLink(context.env, context.params.token);
    if (!link) {
      throw new AppError('這個分享連結不存在或已被停用，請向專案擁有者確認最新連結。', 404, 'share_link_not_found');
    }
    const board = await db.getBoard(context.env, link.board_id);
    if (!board) {
      throw new AppError('這個分享連結對應的甘特圖專案已被刪除。', 404, 'board_not_found');
    }
    const items = await db.listGanttItems(context.env, board.id);
    const safeItems = items.map((it) => ({
      id: it.id,
      issueKey: it.issue_key,
      source: it.source,
      title: it.source === 'jira' ? it.jira_summary ?? it.title : it.title,
      groupName: it.group_name,
      track: it.track,
      owner: it.owner,
      startDate: it.start_date,
      workDays: it.work_days,
      endDate: it.end_date,
      note: it.note,
      color: it.color,
      sortOrder: it.sort_order,
      jiraStatus: it.jira_status,
      jiraAssignee: it.jira_assignee,
      jiraIssueType: it.jira_issue_type,
      jiraRemoved: it.jira_sync_state === 'removed',
    }));
    return json({
      board: { id: board.id, name: board.name, jiraProjectName: board.jira_project_name, lastSyncedAt: board.last_synced_at },
      items: safeItems,
      jiraBaseUrl: context.env.JIRA_BASE_URL || null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
