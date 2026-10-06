import * as db from '../../lib/db';
import { loadBoardForItem } from '../../lib/guard';
import { errorResponse, json, options, readJson } from '../../lib/http';
import { calcEndDate } from '../../lib/workdays';
import { AppError, Env } from '../../lib/types';

interface PatchBody {
  title?: string;
  groupName?: string | null;
  track?: string | null;
  owner?: string | null;
  startDate?: string;
  workDays?: number;
  note?: string;
  color?: string;
}

export async function onRequestPut(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoardForItem(context, context.params.id, 'write');
    const existing = await db.getGanttItem(context.env, context.params.id);
    if (!existing) throw new AppError('找不到這個甘特圖項目，可能已被刪除。', 404, 'item_not_found');

    const body = await readJson<PatchBody>(context.request);
    const startDate = body.startDate ?? existing.start_date;
    const workDays =
      body.workDays !== undefined ? Math.max(1, Math.floor(Number(body.workDays) || 1)) : existing.work_days;

    const calendar = await db.getWorkCalendar(context.env, board.id);
    let endDate: string;
    try {
      endDate = calcEndDate(startDate, workDays, calendar);
    } catch {
      throw new AppError('日期資料異常，請確認開始日期格式是否正確 (YYYY-MM-DD)。', 400, 'invalid_date');
    }

    const item = await db.updateGanttItem(context.env, context.params.id, {
      title: body.title,
      groupName: body.groupName,
      track: body.track !== undefined ? (body.track ?? '').trim() || null : undefined,
      owner: body.owner !== undefined ? (body.owner ?? '').trim() || null : undefined,
      startDate,
      workDays,
      endDate,
      note: body.note,
      color: body.color,
    });
    return json({ item });
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
    await loadBoardForItem(context, context.params.id, 'write');
    await db.deleteGanttItem(context.env, context.params.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
