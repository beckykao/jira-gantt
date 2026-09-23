import * as db from '../../../../lib/db';
import { errorResponse, json, options } from '../../../../lib/http';
import { AppError, Env } from '../../../../lib/types';

export async function onRequestGet(context: { env: Env; params: { id: string } }): Promise<Response> {
  try {
    const links = await db.listShareLinks(context.env, context.params.id);
    return json({ links });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost(context: { env: Env; params: { id: string } }): Promise<Response> {
  try {
    const board = await db.getBoard(context.env, context.params.id);
    if (!board) throw new AppError('找不到這個甘特圖專案，可能已被刪除。', 404, 'board_not_found');
    const link = await db.createShareLink(context.env, board.id);
    return json({ link }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
