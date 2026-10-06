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
    const { board } = await loadBoard(context, 'read');
    const [holidays, lastImport] = await Promise.all([
      db.listHolidays(context.env, board.id),
      db.lastHolidayImport(context.env),
    ]);
    return json({ holidays, lastImport });
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
    const body = await readJson<{ date?: string; name?: string; isWorkday?: boolean }>(context.request);
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      throw new AppError('請提供正確的日期格式 (YYYY-MM-DD)。', 400, 'invalid_date');
    }
    const holiday = await db.addCustomHoliday(
      context.env,
      board.id,
      body.date,
      (body.name ?? '').trim() || (body.isWorkday ? '補班日' : '自訂休假日'),
      !!body.isWorkday
    );
    return json({ holiday }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
