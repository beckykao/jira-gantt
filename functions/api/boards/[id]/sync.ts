import * as db from '../../../lib/db';
import { loadBoard } from '../../../lib/guard';
import { errorResponse, json, options, readJson } from '../../../lib/http';
import { resolveJiraCreds } from '../../../lib/jiraCreds';
import { syncBoardVersion } from '../../../lib/sync';
import { AppError, Env } from '../../../lib/types';

export async function onRequestGet(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoard(context, 'read');
    return json({ logs: await db.listSyncLogs(context.env, board.id, 20) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board, who } = await loadBoard(context, 'write');
    const creds = await resolveJiraCreds(context.env, who.email);

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
      summary = await syncBoardVersion(context.env, creds, board.id, projectKey, versionId, versionName);
    } catch (err) {
      await db.insertSyncLog(context.env, {
        board_id: board.id,
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
      board_id: board.id,
      version_id: summary.versionId,
      version_name: summary.versionName,
      added_count: summary.added.length,
      updated_count: summary.updated.length,
      removed_count: summary.removed.length,
      unchanged_count: summary.unchanged.length,
      status: 'success',
      error_message: null,
    });

    if (!board.jira_project_key && projectKey) {
      await db.setBoardJiraProject(context.env, board.id, projectKey, body.projectName ?? projectKey);
    }

    return json({ summary, log });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
