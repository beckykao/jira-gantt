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
    return json({ backlog: await db.listBacklog(context.env, board.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
