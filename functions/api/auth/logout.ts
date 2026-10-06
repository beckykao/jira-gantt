// Sign out of this browser. The stored (encrypted) Jira token is kept so the
// person doesn't lose their connection; it is replaced on next sign-in.

import { errorResponse, json, options } from '../../lib/http';
import { clearSessionCookie, deleteSession } from '../../lib/session';
import { Env } from '../../lib/types';

export async function onRequestPost(context: { env: Env; request: Request }): Promise<Response> {
  try {
    await deleteSession(context.env, context.request);
    const res = json({ ok: true });
    res.headers.append('Set-Cookie', clearSessionCookie());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
