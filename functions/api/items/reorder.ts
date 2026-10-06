import * as db from '../../lib/db';
import { loadBoardForItem } from '../../lib/guard';
import { errorResponse, json, options, readJson } from '../../lib/http';
import { AppError, Env } from '../../lib/types';

interface ReorderBody {
  orders: { id: string; sortOrder: number }[];
}

export async function onRequestPost(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const body = await readJson<ReorderBody>(context.request);
    if (!Array.isArray(body.orders) || body.orders.length === 0) {
      throw new AppError('排序資料格式錯誤。', 400, 'invalid_orders');
    }
    // Every row in one reorder belongs to the same board; checking the first
    // is enough to establish write permission.
    await loadBoardForItem(context, body.orders[0].id, 'write');
    await db.reorderGanttItems(context.env, body.orders);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
