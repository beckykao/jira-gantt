// Cookie sessions for "sign in with your own Jira API token".
//
// After a successful login the browser gets a random 256-bit session id in an
// HttpOnly cookie (JavaScript on the page can't read it). The database only
// keeps a SHA-256 hash of that id.

import { Env } from './types';

export const SESSION_COOKIE = 'jg_session';
const DEFAULT_SESSION_DAYS = 90;

export function sessionDays(env: Env): number {
  const n = Number(env.SESSION_DAYS);
  return Number.isFinite(n) && n > 0 && n <= 365 ? n : DEFAULT_SESSION_DAYS;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

/** Creates a session and returns the Set-Cookie header value. */
export async function createSession(env: Env, email: string): Promise<string> {
  const id = randomId();
  const now = new Date();
  const days = sessionDays(env);
  const expires = new Date(now.getTime() + days * 86400000);

  // Housekeeping: drop expired sessions so the table doesn't grow forever.
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now.toISOString()).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id_hash, email, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(await sha256Hex(id), email, now.toISOString(), expires.toISOString(), now.toISOString())
    .run();

  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86400}`;
}

/** Email of the signed-in user, or null when the cookie is missing / unknown / expired. */
export async function getSessionEmail(env: Env, request: Request): Promise<string | null> {
  const id = readSessionCookie(request);
  if (!id) return null;
  const idHash = await sha256Hex(id);
  const row = await env.DB.prepare(`SELECT email, expires_at, last_seen_at FROM sessions WHERE id_hash = ?`)
    .bind(idHash)
    .first<{ email: string; expires_at: string; last_seen_at: string }>();
  if (!row) return null;

  const now = new Date();
  if (row.expires_at < now.toISOString()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id_hash = ?`).bind(idHash).run();
    return null;
  }
  // Update "last seen" at most once an hour to avoid a write on every request.
  if (now.getTime() - Date.parse(row.last_seen_at) > 3600000) {
    await env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?`)
      .bind(now.toISOString(), idHash)
      .run();
  }
  return row.email;
}

export async function deleteSession(env: Env, request: Request): Promise<void> {
  const id = readSessionCookie(request);
  if (!id) return;
  await env.DB.prepare(`DELETE FROM sessions WHERE id_hash = ?`).bind(await sha256Hex(id)).run();
}

/** Sign out everywhere (e.g. after the person replaces their Jira token). */
export async function deleteAllSessionsFor(env: Env, email: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE email = ?`).bind(email).run();
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** The configured company Jira URL without trailing slash, or null if unset / still the placeholder. */
export function normalizeAllowedBaseUrl(env: Env): string | null {
  const raw = (env.JIRA_ALLOWED_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw || raw.includes('your-domain')) return null;
  return raw;
}
