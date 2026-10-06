// Sign in with your own Jira account.
//
// The browser sends a Jira email + API token. We ask the company Jira
// (JIRA_ALLOWED_BASE_URL) "who is this?" with exactly those credentials; Jira
// only answers if the token belongs to that email. If it does, the token is
// stored encrypted as this person's Jira connection and a session cookie is
// issued. Nobody else's token is ever used for this person.

import { accessConfigured } from '../../lib/auth';
import * as db from '../../lib/db';
import { encryptSecret } from '../../lib/crypto';
import { errorResponse, json, nowIso, options, readJson } from '../../lib/http';
import * as jira from '../../lib/jira';
import { createSession, normalizeAllowedBaseUrl } from '../../lib/session';
import { AppError, Env } from '../../lib/types';

interface Body {
  jiraEmail?: string;
  token?: string;
}

export async function onRequestPost(context: { env: Env; request: Request }): Promise<Response> {
  try {
    const { env, request } = context;
    if (accessConfigured(env)) {
      throw new AppError('本系統使用公司登入頁，請直接重新整理頁面。', 400, 'login_uses_access');
    }
    const baseUrl = normalizeAllowedBaseUrl(env);
    if (!baseUrl) {
      throw new AppError(
        '系統尚未設定公司的 Jira 網址（JIRA_ALLOWED_BASE_URL），暫時無法登入。請聯絡管理員。',
        500,
        'login_not_configured'
      );
    }

    const body = await readJson<Body>(request);
    const email = (body.jiraEmail ?? '').trim().toLowerCase();
    const token = (body.token ?? '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw new AppError('請填入你登入 Jira 用的 email。', 400, 'jira_email_required');
    }
    if (!token) throw new AppError('請貼上你的 Jira API Token。', 400, 'token_required');

    let me: { accountId: string; displayName: string };
    try {
      me = await jira.testConnection({ baseUrl, email, token });
    } catch (err) {
      if (err instanceof AppError && err.code === 'jira_unauthorized') {
        throw new AppError('Email 或 API Token 不正確，請確認後再試一次。', 401, 'login_failed');
      }
      throw err;
    }

    await db.ensureUser(env, email, me.displayName || null);
    if (me.displayName) {
      await env.DB.prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE email = ?`)
        .bind(me.displayName, nowIso(), email)
        .run();
    }
    const tokenEnc = await encryptSecret(token, env.ENCRYPTION_KEY);
    await db.saveUserJira(env, email, { baseUrl, jiraEmail: email, tokenEnc });
    await db.markJiraChecked(env, email, true);

    const cookie = await createSession(env, email);
    const res = json({ ok: true, email, name: me.displayName || null });
    res.headers.append('Set-Cookie', cookie);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
