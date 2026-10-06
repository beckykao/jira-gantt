// Upload the government office-calendar CSV.
//
// POST with { csv, fileName, apply:false } previews what would change;
// apply:true writes it. The calendar is shared by every board, so the UI
// shows who last imported it.

import * as db from '../../../../lib/db';
import { loadBoard } from '../../../../lib/guard';
import { errorResponse, json, options, readJson } from '../../../../lib/http';
import { parseHolidayCsv } from '../../../../lib/holidayCsv';
import { AppError, Env } from '../../../../lib/types';

interface Body {
  csv?: string;
  fileName?: string;
  apply?: boolean;
}

export async function onRequestPost(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { who } = await loadBoard(context, 'write');
    const body = await readJson<Body>(context.request);
    if (!body.csv || !body.csv.trim()) {
      throw new AppError('沒有讀到 CSV 內容，請重新選擇檔案。', 400, 'csv_missing');
    }
    if (body.csv.length > 1_500_000) {
      throw new AppError('CSV 檔案太大（超過 1.5MB），請確認選到的是辦公日曆表。', 400, 'csv_too_large');
    }

    const parsed = parseHolidayCsv(body.csv);

    const existing = await context.env.DB.prepare(
      `SELECT date FROM holidays WHERE board_id IS NULL AND type = 'government'`
    ).all<{ date: string }>();
    const known = new Set((existing.results ?? []).map((r) => r.date));
    const added = parsed.rows.filter((r) => !known.has(r.date)).length;

    const preview = {
      format: parsed.format,
      years: parsed.years,
      total: parsed.stats.total,
      holidays: parsed.stats.holidays,
      workdays: parsed.stats.workdays,
      skipped: parsed.stats.skipped,
      willAdd: added,
      willUpdate: parsed.rows.length - added,
      sample: parsed.rows.slice(0, 8),
    };

    if (!body.apply) return json({ preview, applied: false });

    const result = await db.importGovernmentHolidays(context.env, parsed.rows);
    await db.logHolidayImport(context.env, {
      importedBy: who.email,
      fileName: body.fileName ?? '',
      added: result.added,
      updated: result.updated,
      workdays: parsed.stats.workdays,
    });

    return json({ preview, applied: true, result });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
