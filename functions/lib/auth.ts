// Who is making this request?
//
// Two ways to sign in, checked in this order:
//
//   1. Cloudflare Access (optional). If CF_ACCESS_TEAM_DOMAIN and
//      CF_ACCESS_AUD are set, every request must carry a valid Access JWT.
//   2. Your own Jira API token (default). The login page sends a Jira email +
//      API token, the server checks it against the company Jira, and the
//      browser gets an HttpOnly session cookie (see session.ts / api/auth).
//
// There is deliberately NO anonymous fallback any more: a request without a
// valid sign-in gets 401, so two colleagues can never end up sharing one
// identity (and one Jira token).
//
// Notes on the Access mode:
// Access puts a signed JWT in the Cf-Access-Jwt-Assertion header; we verify
// that signature against the team's public keys before trusting the email —
// the plain Cf-Access-Authenticated-User-Email header alone is forgeable by
// anyone who reaches the origin directly.
//
// Required env vars for that mode:
//   CF_ACCESS_TEAM_DOMAIN  e.g. yourteam.cloudflareaccess.com
//   CF_ACCESS_AUD          the Application Audience tag of the Access app
//
import { getSessionEmail } from './session';
import { AppError, Env } from './types';

export interface Identity {
  email: string;
  name: string | null;
  verified: boolean;
  /** How this person signed in. */
  via: 'access' | 'jira';
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number; domain: string } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
}

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.domain === teamDomain && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const url = `https://${teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new AppError('無法驗證登入身分，請稍後再試。', 503, 'jwks_unavailable');
  const data = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: data.keys ?? [], fetchedAt: now, domain: teamDomain };
  return jwksCache.keys;
}

async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<Identity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError('登入憑證格式不正確，請重新整理頁面。', 401, 'bad_jwt');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = b64urlToJson<{ kid?: string; alg?: string }>(headerB64);
  const payload = b64urlToJson<{ email?: string; name?: string; aud?: string | string[]; exp?: number }>(payloadB64);

  if (header.alg !== 'RS256') throw new AppError('登入憑證演算法不受支援。', 401, 'bad_jwt_alg');
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new AppError('登入已逾期，請重新整理頁面以重新登入。', 401, 'jwt_expired');
  }
  const audList = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audList.includes(aud)) throw new AppError('登入憑證不屬於這個應用程式。', 401, 'jwt_aud_mismatch');

  const keys = await getJwks(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid) ?? keys[0];
  if (!jwk) throw new AppError('找不到可用的驗證金鑰，請稍後再試。', 503, 'no_jwk');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!ok) throw new AppError('登入憑證驗證失敗。', 401, 'jwt_invalid');
  if (!payload.email) throw new AppError('登入憑證中沒有 email，無法識別使用者。', 401, 'jwt_no_email');

  return { email: payload.email.toLowerCase(), name: payload.name ?? null, verified: true, via: 'access' };
}

/** Whether this deployment is actually protected by Access. */
export function accessConfigured(env: Env): boolean {
  return !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
}

/** Resolve who is making this request. Throws 401 when nobody is signed in. */
export async function getIdentity(request: Request, env: Env): Promise<Identity> {
  if (accessConfigured(env)) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) {
      throw new AppError('請透過公司的登入頁進入本系統。', 401, 'no_access_jwt');
    }
    return verifyAccessJwt(token, env.CF_ACCESS_TEAM_DOMAIN!, env.CF_ACCESS_AUD!);
  }

  const email = await getSessionEmail(env, request);
  if (!email) {
    throw new AppError('請先用你的 Jira 帳號登入。', 401, 'not_logged_in');
  }
  const user = await env.DB.prepare(`SELECT display_name FROM users WHERE email = ?`)
    .bind(email)
    .first<{ display_name: string | null }>();
  return { email, name: user?.display_name ?? null, verified: true, via: 'jira' };
}
