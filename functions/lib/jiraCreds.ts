// Resolve the Jira credentials to use for a request.
//
// Every person uses ONLY their own Jira connection — the one they signed in
// with (or later updated in「Jira 連線」). There is intentionally no shared /
// org-wide fallback account.

import * as db from './db';
import { decryptSecret } from './crypto';
import { normalizeAllowedBaseUrl } from './session';
import { AppError, Env, JiraCreds } from './types';

export async function resolveJiraCreds(env: Env, email: string): Promise<JiraCreds> {
  const user = await db.getUser(env, email);
  if (user?.jira_base_url && user.jira_email && user.jira_token_enc) {
    return {
      baseUrl: user.jira_base_url,
      email: user.jira_email,
      token: await decryptSecret(user.jira_token_enc, env.ENCRYPTION_KEY),
    };
  }
  throw new AppError(
    '你還沒有設定 Jira 連線。請點右上角的「Jira 連線」填入你的 API Token。',
    400,
    'jira_not_connected'
  );
}

/** Connection state for the settings page — never includes the token. */
export async function jiraStatus(env: Env, email: string) {
  const user = await db.getUser(env, email);
  const hasOwn = !!(user?.jira_base_url && user.jira_email && user.jira_token_enc);
  return {
    connected: hasOwn,
    usingOwnCredentials: hasOwn,
    usingSharedFallback: false,
    baseUrl: user?.jira_base_url ?? normalizeAllowedBaseUrl(env),
    jiraEmail: user?.jira_email ?? email,
    /** Base URL and email are fixed to the sign-in account. */
    locked: !!normalizeAllowedBaseUrl(env),
    tokenSet: !!user?.jira_token_enc,
    tokenMasked: user?.jira_token_enc ? '••••••••（已加密儲存）' : '',
    lastCheckedAt: user?.jira_checked_at ?? null,
    lastCheckOk: !!user?.jira_check_ok,
  };
}
