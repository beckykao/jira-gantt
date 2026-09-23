import * as db from '../../../lib/db';
import { errorResponse, json, options, readJson } from '../../../lib/http';
import { AppError, Env } from '../../../lib/types';

export async function onRequestGet(context: { env: Env; params: { id: string } }): Promise<Response> {
  try {
    const board = await db.getBoard(context.env, context.params.id);
    if (!board) throw new AppError('找不到這個甘特圖專案，可能已被刪除。', 404, 'board_not_found');
    const [items, backlog, syncLogs] = await Promise.all([
      db.listGanttItems(context.env, board.id),
      db.listBacklog(context.env, board.id),
      db.listSyncLogs(context.env, board.id, 5),
    ]);
    return json({ board, items, backlog, syncLogs });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPut(context: { env: Env; request: Request; params: { id: string } }): Promise<Response> {
  try {
    const body = await readJson<{ name?: string }>(context.request);
    const board = await db.updateBoard(context.env, context.params.id, { name: body.name?.trim() });
    if (!board) throw new AppError('找不到這個甘特圖專案，可能已被刪除。', 404, 'board_not_found');
    return json({ board });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete(context: { env: Env; params: { id: string } }): Promise<Response> {
  try {
    await db.deleteBoard(context.env, context.params.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
