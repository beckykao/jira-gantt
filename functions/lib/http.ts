// Small helpers to keep API route handlers short and give consistent,
// human-readable error responses (spec section 十六：錯誤處理).

import { AppError } from './types';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function options(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/** Friendly, user-facing messages for known failure modes. Never leaks raw
 * stack traces or Jira's internal error payloads to the client. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return json({ error: { message: err.message, code: err.code } }, err.status);
  }
  console.error('Unhandled error:', err);
  return json(
    { error: { message: '系統發生未預期的錯誤，請稍後再試一次。若持續發生請聯絡管理員。', code: 'internal_error' } },
    500
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError('請求格式錯誤，無法解析 JSON 內容。', 400, 'invalid_json');
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}
