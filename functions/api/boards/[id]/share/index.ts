import * as db from '../../../../lib/db';
import { loadBoard } from '../../../../lib/guard';
import { errorResponse, json, options } from '../../../../lib/http';
import { Env } from '../../../../lib/types';

export async function onRequestGet(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoard(context, 'read');
    return json({ links: await db.listShareLinks(context.env, board.id) });
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
    const { board } = await loadBoard(context, 'write');
    return json({ link: await db.createShareLink(context.env, board.id) }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
