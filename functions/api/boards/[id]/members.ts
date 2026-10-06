// Board sharing: the owner invites colleagues as editors (or explicit
// viewers). Everyone else who is signed in can read but not change.

import * as db from '../../../lib/db';
import { loadBoard } from '../../../lib/guard';
import { errorResponse, json, options, readJson } from '../../../lib/http';
import { AppError, Env } from '../../../lib/types';

export async function onRequestGet(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board, role } = await loadBoard(context, 'read');
    const members = await db.listMembers(context.env, board.id);
    return json({ owner: board.owner_email, members, myRole: role });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoard(context, 'owner');
    const body = await readJson<{ email?: string; role?: 'editor' | 'viewer' }>(context.request);
    const email = (body.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new AppError('請輸入正確的 email。', 400, 'email_invalid');
    if (email === (board.owner_email ?? '').toLowerCase()) {
      throw new AppError('這個人已經是專案擁有者了。', 400, 'already_owner');
    }
    await db.addMember(context.env, board.id, email, body.role === 'viewer' ? 'viewer' : 'editor');
    return json({ members: await db.listMembers(context.env, board.id) }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoard(context, 'owner');
    const body = await readJson<{ email?: string }>(context.request);
    const email = (body.email ?? '').trim().toLowerCase();
    if (!email) throw new AppError('缺少要移除的 email。', 400, 'email_required');
    await db.removeMember(context.env, board.id, email);
    return json({ members: await db.listMembers(context.env, board.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
