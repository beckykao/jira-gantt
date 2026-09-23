import * as db from '../../../../lib/db';
import { errorResponse, options } from '../../../../lib/http';
import { Env } from '../../../../lib/types';

export async function onRequestDelete(context: { env: Env; params: { holidayId: string } }): Promise<Response> {
  try {
    await db.deleteHoliday(context.env, Number(context.params.holidayId));
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
