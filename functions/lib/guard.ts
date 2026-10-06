// One-line request guards so each route handler stays short: resolve who is
// calling, load the board, and check the permission the route needs.

import * as db from './db';
import { getIdentity, Identity } from './auth';
import { assertCanEdit, assertIsOwner, roleFor, Role } from './permissions';
import { AppError, Board, Env } from './types';

export interface Ctx {
  env: Env;
  request: Request;
  params: Record<string, string>;
}

export async function whoIs(context: { env: Env; request: Request }): Promise<Identity> {
  const who = await getIdentity(context.request, context.env);
  await db.ensureUser(context.env, who.email, who.name);
  return who;
}

export async function loadBoard(
  context: { env: Env; request: Request; params: Record<string, string> },
  need: 'read' | 'write' | 'owner'
): Promise<{ board: Board; who: Identity; role: Role }> {
  const who = await whoIs(context);
  const board = await db.getBoard(context.env, context.params.id);
  if (!board) throw new AppError('找不到這個甘特圖專案，可能已被刪除。', 404, 'board_not_found');

  if (need === 'owner') await assertIsOwner(context.env, board, who);
  else if (need === 'write') await assertCanEdit(context.env, board, who);

  const role = await roleFor(context.env, board, who);
  return { board, who, role };
}

/** For /api/items/* routes, which address an item rather than a board. */
export async function loadBoardForItem(
  context: { env: Env; request: Request },
  itemId: string,
  need: 'read' | 'write'
): Promise<{ board: Board; who: Identity }> {
  const who = await whoIs(context);
  const item = await db.getGanttItem(context.env, itemId);
  if (!item) throw new AppError('找不到這個甘特圖項目，可能已被刪除。', 404, 'item_not_found');
  const board = await db.getBoard(context.env, item.board_id);
  if (!board) throw new AppError('找不到這個項目所屬的專案。', 404, 'board_not_found');
  if (need === 'write') await assertCanEdit(context.env, board, who);
  return { board, who };
}
