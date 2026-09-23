import * as db from '../../../lib/db';
import { errorResponse, json, options, readJson } from '../../../lib/http';
import { calcEndDate } from '../../../lib/workdays';
import { AppError, Env, parseTrackPresets, resolveTrackColor } from '../../../lib/types';

interface TrackInput {
  track?: string | null;
  owner?: string | null;
  startDate: string;
  workDays: number;
  note?: string;
  color?: string;
}

interface CreateItemBody extends Partial<TrackInput> {
  issueKey?: string | null;
  source?: 'jira' | 'manual';
  title?: string;
  groupName?: string | null;
  /** When present, one schedule row is created per entry — this is how a
   * single Jira issue gets split into 前端 / 中台 / PM測試 etc. */
  tracks?: TrackInput[];
}

export async function onRequestGet(context: { env: Env; params: { id: string } }): Promise<Response> {
  try {
    const items = await db.listGanttItems(context.env, context.params.id);
    return json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Add one or more schedule rows to the formal Gantt (spec 九 + 多分工).
 * A Jira issue may appear several times, once per track, but never twice
 * with the same track.
 */
export async function onRequestPost(context: { env: Env; request: Request; params: { id: string } }): Promise<Response> {
  try {
    const boardId = context.params.id;
    const board = await db.getBoard(context.env, boardId);
    if (!board) throw new AppError('找不到這個甘特圖專案，可能已被刪除。', 404, 'board_not_found');

    const body = await readJson<CreateItemBody>(context.request);
    const source: 'jira' | 'manual' = body.issueKey ? 'jira' : body.source === 'jira' ? 'jira' : 'manual';

    let title = (body.title ?? '').trim();
    if (source === 'jira') {
      if (!body.issueKey) throw new AppError('缺少 Jira issue key。', 400, 'missing_issue_key');
      const issue = await db.getJiraIssue(context.env, boardId, body.issueKey);
      if (!issue) throw new AppError('找不到這個 Jira 需求，請重新同步後再試。', 404, 'issue_not_found');
      title = issue.summary;
    } else if (!title) {
      throw new AppError('請輸入項目名稱。', 400, 'title_required');
    }

    const entries: TrackInput[] =
      Array.isArray(body.tracks) && body.tracks.length
        ? body.tracks
        : [
            {
              track: body.track ?? null,
              owner: body.owner ?? null,
              startDate: body.startDate ?? '',
              workDays: body.workDays ?? 1,
              note: body.note,
              color: body.color,
            },
          ];

    const presets = parseTrackPresets(board.track_presets);
    const holidaySet = await db.getHolidaySet(context.env, boardId);
    const existingItems = await db.listGanttItems(context.env, boardId);

    // Validate everything up front so a bad row doesn't leave a half-created batch.
    const prepared = entries.map((entry) => {
      const track = (entry.track ?? '').trim() || null;
      if (!entry.startDate) throw new AppError('請設定開始日期。', 400, 'start_date_required');
      const workDays = Math.max(1, Math.floor(Number(entry.workDays) || 1));

      if (source === 'jira') {
        const duplicate = existingItems.some(
          (it) => it.issue_key === body.issueKey && (it.track ?? '') === (track ?? '')
        );
        if (duplicate) {
          throw new AppError(
            track
              ? `${body.issueKey} 的「${track}」分工已經在甘特圖裡了。`
              : `${body.issueKey} 已經加入甘特圖了。`,
            409,
            'issue_track_already_added'
          );
        }
      }

      let endDate: string;
      try {
        endDate = calcEndDate(entry.startDate, workDays, holidaySet);
      } catch {
        throw new AppError('日期資料異常，請確認開始日期格式是否正確 (YYYY-MM-DD)。', 400, 'invalid_date');
      }

      return {
        track,
        owner: (entry.owner ?? '').trim() || null,
        startDate: entry.startDate,
        workDays,
        endDate,
        note: entry.note ?? '',
        color: entry.color || resolveTrackColor(presets, track),
      };
    });

    const created = [];
    for (const p of prepared) {
      created.push(
        await db.createGanttItem(context.env, boardId, {
          issueKey: source === 'jira' ? body.issueKey : null,
          source,
          title,
          groupName: body.groupName ?? null,
          track: p.track,
          owner: p.owner,
          startDate: p.startDate,
          workDays: p.workDays,
          endDate: p.endDate,
          note: p.note,
          color: p.color,
        })
      );
    }

    return json({ items: created, item: created[0] }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
