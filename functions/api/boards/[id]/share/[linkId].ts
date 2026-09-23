import * as db from '../../../../lib/db';
import { errorResponse, options } from '../../../../lib/http';
import { Env } from '../../../../lib/types';

export async function onRequestDelete(context: { env: Env; params: { linkId: string } }): Promise<Response> {
  try {
    await db.revokeShareLink(context.env, context.params.linkId);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
