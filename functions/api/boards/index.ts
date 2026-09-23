import * as db from '../../lib/db';
import { errorResponse, json, options, readJson } from '../../lib/http';
import { AppError, Env } from '../../lib/types';

export async function onRequestGet(context: { env: Env }): Promise<Response> {
  try {
    const boards = await db.listBoards(context.env);
    return json({ boards });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const body = await readJson<{ name?: string; jiraProjectKey?: string; jiraProjectName?: string }>(
      context.request
    );
    const name = (body.name ?? '').trim();
    if (!name) throw new AppError('請輸入甘特圖專案名稱。', 400, 'name_required');
    const board = await db.createBoard(context.env, {
      name,
      jira_project_key: body.jiraProjectKey ?? null,
      jira_project_name: body.jiraProjectName ?? null,
    });
    return json({ board }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
