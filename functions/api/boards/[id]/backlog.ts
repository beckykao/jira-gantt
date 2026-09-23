import * as db from '../../../lib/db';
import { errorResponse, json, options } from '../../../lib/http';
import { Env } from '../../../lib/types';

export async function onRequestGet(context: { env: Env; params: { id: string } }): Promise<Response> {
  try {
    const backlog = await db.listBacklog(context.env, context.params.id);
    return json({ backlog });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
