// One-shot payload for client-side PNG/Excel export (spec 十四). Excel/PNG
// generation happens in the browser (SheetJS / canvas) so the Worker never
// needs a heavyweight file-generation library; this endpoint just assembles
// everything needed in one round trip.

import * as db from '../../../lib/db';
import { errorResponse, json, options } from '../../../lib/http';
import { AppError, Env } from '../../../lib/types';

export async function onRequestGet(context: { env: Env; params: { id: string } }): Promise<Response> {
  try {
    const board = await db.getBoard(context.env, context.params.id);
    if (!board) throw new AppError('找不到這個甘特圖專案，可能已被刪除。', 404, 'board_not_found');
    const items = await db.listGanttItems(context.env, board.id);
    return json({
      board,
      items,
      jiraBaseUrl: context.env.JIRA_BASE_URL || null,
      exportedAt: new Date().toISOString(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
