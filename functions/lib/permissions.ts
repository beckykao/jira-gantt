// Board access rules.
//
//   owner   — the person who created the board. Full control, including
//             managing members and deleting the board.
//   editor  — invited by the owner. Can schedule, sync and edit.
//   viewer  — everyone else who is signed in: read-only.
//
// Boards created before multi-user support have no owner (owner_email IS
// NULL). Those stay editable by anyone signed in, so nothing breaks on
// upgrade; the first person to open one can claim it.

import { AppError, Board, Env } from './types';
import { Identity } from './auth';

export type Role = 'owner' | 'editor' | 'viewer';

export async function roleFor(env: Env, board: Board, who: Identity): Promise<Role> {
  if (!board.owner_email) return 'owner'; // unclaimed legacy board
  if (board.owner_email.toLowerCase() === who.email) return 'owner';
  const row = await env.DB.prepare(`SELECT role FROM board_members WHERE board_id = ? AND email = ?`)
    .bind(board.id, who.email)
    .first<{ role: string }>();
  if (row?.role === 'editor') return 'editor';
  return 'viewer';
}

export function canEdit(role: Role): boolean {
  return role === 'owner' || role === 'editor';
}

export async function assertCanEdit(env: Env, board: Board, who: Identity): Promise<Role> {
  const role = await roleFor(env, board, who);
  if (!canEdit(role)) {
    throw new AppError(
      `你目前是「${board.name}」的檢視者，無法修改內容。請向擁有者 ${board.owner_email ?? ''} 要求編輯權限。`.trim(),
      403,
      'read_only'
    );
  }
  return role;
}

export async function assertIsOwner(env: Env, board: Board, who: Identity): Promise<void> {
  const role = await roleFor(env, board, who);
  if (role !== 'owner') {
    throw new AppError('只有專案擁有者可以進行這個操作。', 403, 'owner_only');
  }
}
