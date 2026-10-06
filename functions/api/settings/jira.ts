// Each person's own Jira connection. The token is encrypted with AES-GCM
// before it touches the database and is never sent back to the browser.

import * as db from '../../lib/db';
import { encryptSecret } from '../../lib/crypto';
import { whoIs } from '../../lib/guard';
import { errorResponse, json, options, readJson } from '../../lib/http';
import * as jira from '../../lib/jira';
import { jiraStatus, resolveJiraCreds } from '../../lib/jiraCreds';
import { clearSessionCookie, deleteAllSessionsFor, normalizeAllowedBaseUrl } from '../../lib/session';
import { AppError, Env } from '../../lib/types';

export async function onRequestGet(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const who = await whoIs(context);
    return json({ jira: await jiraStatus(context.env, who.email) });
  } catch (err) {
    return errorResponse(err);
  }
}

interface PutBody {
  baseUrl?: string;
  jiraEmail?: string;
  /** Omit or leave blank to keep the stored token unchanged. */
  token?: string;
}

export async function onRequestPut(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const who = await whoIs(context);
    const body = await readJson<PutBody>(context.request);

    const allowed = normalizeAllowedBaseUrl(context.env);
    // With Jira sign-in, the connection always belongs to the signed-in
    // account: you can replace your token, but not point it at someone else.
    const baseUrl = allowed ?? (body.baseUrl ?? '').trim().replace(/\/+$/, '');
    const jiraEmail = allowed ? who.email : (body.jiraEmail ?? '').trim();
    const token = (body.token ?? '').trim();
    if (allowed && body.jiraEmail && body.jiraEmail.trim().toLowerCase() !== who.email) {
      throw new AppError('Jira 連線只能使用你登入的帳號。要換帳號，請先登出再用另一個帳號登入。', 400, 'jira_email_locked');
    }

    if (!baseUrl) throw new AppError('請填入 Jira 網址，例如 https://your-domain.atlassian.net。', 400, 'base_url_required');
    if (!allowed && !/^https:\/\/[^\s/]+/.test(baseUrl)) {
      throw new AppError('Jira 網址格式不正確，需要以 https:// 開頭，且結尾不要加斜線或路徑。', 400, 'base_url_invalid');
    }
    if (!jiraEmail || !jiraEmail.includes('@')) {
      throw new AppError('請填入你登入 Jira 的 email。', 400, 'jira_email_required');
    }

    const existing = await db.getUser(context.env, who.email);
    if (!token && !existing?.jira_token_enc) {
      throw new AppError('請填入 Jira API Token。', 400, 'token_required');
    }

    if (token && allowed) {
      // Make sure the new token really belongs to this account before storing it.
      await jira.testConnection({ baseUrl, email: jiraEmail, token });
    }
    const tokenEnc = token ? await encryptSecret(token, context.env.ENCRYPTION_KEY) : null;
    await db.saveUserJira(context.env, who.email, { baseUrl, jiraEmail, tokenEnc });
    if (token && allowed) await db.markJiraChecked(context.env, who.email, true);

    return json({ jira: await jiraStatus(context.env, who.email) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const who = await whoIs(context);
    await db.clearUserJira(context.env, who.email);
    if (who.via === 'jira') {
      // Your Jira token IS your sign-in: removing it signs you out everywhere.
      await deleteAllSessionsFor(context.env, who.email);
      const res = json({ jira: await jiraStatus(context.env, who.email), signedOut: true });
      res.headers.append('Set-Cookie', clearSessionCookie());
      return res;
    }
    return json({ jira: await jiraStatus(context.env, who.email) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST = 測試連線 */
export async function onRequestPost(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const who = await whoIs(context);
    const creds = await resolveJiraCreds(context.env, who.email);
    try {
      const me = await jira.testConnection(creds);
      await db.markJiraChecked(context.env, who.email, true);
      return json({ ok: true, displayName: me.displayName, jira: await jiraStatus(context.env, who.email) });
    } catch (err) {
      await db.markJiraChecked(context.env, who.email, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
