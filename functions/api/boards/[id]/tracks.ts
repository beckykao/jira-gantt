// Per-board work-track presets (分工). Fully user-editable: add, rename,
// delete, reorder, recolour. Renaming carries existing schedule rows over to
// the new name; recolouring repaints that track's rows.

import * as db from '../../../lib/db';
import { loadBoard } from '../../../lib/guard';
import { errorResponse, json, options, readJson } from '../../../lib/http';
import { AppError, Env, TrackPreset, parseTrackPresets } from '../../../lib/types';

export async function onRequestGet(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoard(context, 'read');
    return json({ tracks: parseTrackPresets(board.track_presets) });
  } catch (err) {
    return errorResponse(err);
  }
}

interface PutBody {
  tracks: Array<TrackPreset & { previousName?: string }>;
}

export async function onRequestPut(context: {
  env: Env;
  request: Request;
  params: { id: string };
}): Promise<Response> {
  try {
    const { board } = await loadBoard(context, 'write');
    const body = await readJson<PutBody>(context.request);
    if (!Array.isArray(body.tracks)) throw new AppError('分工清單格式錯誤。', 400, 'invalid_tracks');

    const cleaned: TrackPreset[] = [];
    const seen = new Set<string>();
    for (const t of body.tracks) {
      const name = String(t?.name ?? '').trim();
      if (!name) continue;
      if (seen.has(name)) throw new AppError(`分工名稱「${name}」重複了，請改成不同的名稱。`, 400, 'duplicate_track');
      seen.add(name);
      cleaned.push({ name, color: typeof t.color === 'string' && t.color ? t.color : '#4C6EF5' });
    }
    if (!cleaned.length) throw new AppError('至少要保留一個分工。', 400, 'tracks_empty');

    const previous = parseTrackPresets(board.track_presets);

    for (const t of body.tracks) {
      const newName = String(t?.name ?? '').trim();
      const oldName = String(t?.previousName ?? '').trim();
      if (newName && oldName && newName !== oldName) {
        await db.renameTrack(context.env, board.id, oldName, newName);
      }
    }

    for (const t of cleaned) {
      const before = previous.find((p) => p.name === t.name);
      const renamedFrom = body.tracks.find((x) => String(x?.name ?? '').trim() === t.name)?.previousName;
      const beforeByOldName = renamedFrom ? previous.find((p) => p.name === renamedFrom) : undefined;
      const priorColor = before?.color ?? beforeByOldName?.color;
      if (priorColor !== t.color) {
        await db.recolorTrack(context.env, board.id, t.name, t.color);
      }
    }

    await db.setBoardTrackPresets(context.env, board.id, JSON.stringify(cleaned));
    return json({ tracks: cleaned });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequestOptions = options;
