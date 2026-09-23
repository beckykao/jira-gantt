import * as db from '../../../lib/db';
import { errorResponse, json, options, readJson } from '../../../lib/http';
import { AppError, Env } from '../../../lib/types';

export async function onRequestGet(context: { env: Env; params: { id: string } }): Promise<Response> {
  try {
    const holidays = await db.listHolidays(context.env, context.params.id);
    return json({ holidays });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost(context: { env: Env; request: Request; params: { id: string } }): Promise<Response> {
  try {
    const body = await readJson<{ date?: string; name?: string }>(context.request);
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      throw new AppError('請提供正確的日期格式 (YYYY-MM-DD)。', 400, 'invalid_date');
    }
    const holiday = await db.addCustomHoliday(context.env, context.params.id, body.date, (body.name ?? '').trim() || '自訂休假日');
    return json({ holiday }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
