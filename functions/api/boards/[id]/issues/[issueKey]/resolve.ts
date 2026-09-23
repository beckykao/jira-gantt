// Handles the "此需求已不在目前 Jira Version" / "已移至 Version XXX" prompts
// (spec 七之 3、5): user chooses to move, keep, or remove the schedule item.

import * as db from '../../../../../lib/db';
import { errorResponse, json, options, readJson } from '../../../../../lib/http';
import { AppError, Env } from '../../../../../lib/types';

interface ResolveBody {
  action: 'move' | 'keep' | 'remove';
}

export async function onRequestPost(context: {
  env: Env;
  request: Request;
  params: { id: string; issueKey: string };
}): Promise<Response> {
  try {
    const { id: boardId, issueKey } = context.params;
    const body = await readJson<ResolveBody>(context.request);
    if (!['move', 'keep', 'remove'].includes(body.action)) {
      throw new AppError('不明的操作類型。', 400, 'invalid_action');
    }

    if (body.action === 'remove') {
      const items = await db.listGanttItems(context.env, boardId);
      const target = items.find((it) => it.issue_key === issueKey);
      if (target) await db.deleteGanttItem(context.env, target.id);
    } else {
      await db.resolveMovedIssue(context.env, boardId, issueKey, body.action);
    }

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
