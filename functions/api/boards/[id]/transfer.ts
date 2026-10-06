// Transfer board ownership to an existing member.
//
// Only the current owner can do this. The new owner must already be a member
// of the board and must have signed in at least once (so a typo'd email can't
// leave the board without a reachable owner). Afterwards the previous owner
// stays on the board as an editor.

import * as db from '../../../lib/db';
import { loadBoard } from '../../../lib/guard';
import { errorResponse, json, options, readJson } from '../../../lib/http';
import { AppError, Env } from '../../../lib/types';

export async function onRequestPost(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board, who } = await loadBoard(context, 'owner');
    const body = await readJson<{ email?: string }>(context.request);
    const email = (body.email ?? '').trim().toLowerCase();
    if (!email) throw new AppError('請選擇要接手的成員。', 400, 'email_required');

    const currentOwner = (board.owner_email ?? '').toLowerCase() || null;
    if (email === currentOwner) throw new AppError('這個人已經是專案擁有者了。', 400, 'already_owner');

    const members = await db.listMembers(context.env, board.id);
    if (!members.some((m) => m.email.toLowerCase() === email)) {
      throw new AppError('只能轉移給這個專案的成員，請先把對方加入成員。', 400, 'not_a_member');
    }
    if (!(await db.getUser(context.env, email))) {
      throw new AppError(`${email} 還沒有登入過本系統，請對方先用自己的 Jira 帳號登入一次，再進行轉移。`, 400, 'user_never_signed_in');
    }

    // Unclaimed legacy boards (no owner) are handed over by whoever opened them.
    await db.transferOwnership(context.env, board.id, currentOwner ?? who.email, email);
    return json({ owner: email, members: await db.listMembers(context.env, board.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
