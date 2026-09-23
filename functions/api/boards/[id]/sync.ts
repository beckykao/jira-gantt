import * as db from '../../../lib/db';
import { errorResponse, json, options, readJson } from '../../../lib/http';
import { syncBoardVersion } from '../../../lib/sync';
import { AppError, Env } from '../../../lib/types';

export async function onRequestGet(context: { env: Env; params: { id: string } }): Promise<Response> {
  try {
    const logs = await db.listSyncLogs(context.env, context.params.id, 20);
    return json({ logs });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost(context: { env: Env; request: Request; params: { id: string } }): Promise<Response> {
  const boardId = context.params.id;
  try {
    const board = await db.getBoard(context.env, boardId);
    if (!board) throw new AppError('找不到這個甘特圖專案，可能已被刪除。', 404, 'board_not_found');

    const body = await readJson<{
      projectKey?: string;
      projectName?: string;
      versionId?: string;
      versionName?: string;
    }>(context.request);
    const projectKey = body.projectKey ?? board.jira_project_key ?? '';
    const versionId = body.versionId;
    const versionName = body.versionName ?? '';
    if (!projectKey) throw new AppError('請先選擇 Jira 專案。', 400, 'missing_project');
    if (!versionId) throw new AppError('請先選擇 Jira Version。', 400, 'missing_version');

    let summary;
    try {
      summary = await syncBoardVersion(context.env, boardId, projectKey, versionId, versionName);
    } catch (err) {
      // Record a failed/partial sync attempt so it's visible in history
      // (spec 十六: 同步一半失敗 must be handled gracefully, not silently).
      await db.insertSyncLog(context.env, {
        board_id: boardId,
        version_id: versionId,
        version_name: versionName,
        added_count: 0,
        updated_count: 0,
        removed_count: 0,
        unchanged_count: 0,
        status: 'failed',
        error_message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const log = await db.insertSyncLog(context.env, {
      board_id: boardId,
      version_id: summary.versionId,
      version_name: summary.versionName,
      added_count: summary.added.length,
      updated_count: summary.updated.length,
      removed_count: summary.removed.length,
      unchanged_count: summary.unchanged.length,
      status: 'success',
      error_message: null,
    });

    // Record the linked Jira project on the board the first time it syncs.
    if (!board.jira_project_key && projectKey) {
      await db.setBoardJiraProject(context.env, boardId, projectKey, body.projectName ?? projectKey);
    }

    return json({ summary, log });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
