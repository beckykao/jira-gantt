import * as db from '../../../lib/db';
import { loadBoard } from '../../../lib/guard';
import { errorResponse, json, options, readJson } from '../../../lib/http';
import { AppError, Env } from '../../../lib/types';

export async function onRequestGet(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board, who, role } = await loadBoard(context, 'read');
    const [items, backlog, syncLogs, members] = await Promise.all([
      db.listGanttItems(context.env, board.id),
      db.listBacklog(context.env, board.id),
      db.listSyncLogs(context.env, board.id, 5),
      db.listMembers(context.env, board.id),
    ]);
    return json({ board, items, backlog, syncLogs, members, role, me: who.email });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPut(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoard(context, 'write');
    const body = await readJson<{ name?: string }>(context.request);
    const name = body.name?.trim();
    if (!name) throw new AppError('請輸入專案名稱。', 400, 'name_required');
    const updated = await db.updateBoard(context.env, board.id, { name });
    return json({ board: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoard(context, 'owner');
    await db.deleteBoard(context.env, board.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
