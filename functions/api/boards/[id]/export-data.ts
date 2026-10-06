// One-shot payload for client-side PNG/Excel export (spec 十四).

import * as db from '../../../lib/db';
import { loadBoard } from '../../../lib/guard';
import { errorResponse, json, options } from '../../../lib/http';
import { Env } from '../../../lib/types';

export async function onRequestGet(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoard(context, 'read');
    const items = await db.listGanttItems(context.env, board.id);
    return json({ board, items, exportedAt: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
