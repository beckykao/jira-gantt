import * as db from '../../../../lib/db';
import { loadBoard } from '../../../../lib/guard';
import { errorResponse, options } from '../../../../lib/http';
import { Env } from '../../../../lib/types';

export async function onRequestDelete(context: {
  env: Env;
  request: Request;
  params: { id: string; holidayId: string };
}): Promise<Response> {
  try {
    await loadBoard(context, 'write');
    await db.deleteHoliday(context.env, Number(context.params.holidayId));
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
