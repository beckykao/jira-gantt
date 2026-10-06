// Shared types for the Jira Gantt backend (Cloudflare Pages Functions).

export interface Env {
  DB: D1Database;
  /** Key for encrypting stored Jira tokens (base64, 32 bytes). */
  ENCRYPTION_KEY?: string;
  /** Cloudflare Access — when both are set, requests must carry a valid Access JWT. */
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  /**
   * The company Jira site people sign in with, e.g. https://your-domain.atlassian.net.
   * Only tokens that this site accepts can log in.
   */
  JIRA_ALLOWED_BASE_URL?: string;
  /** How long a login lasts, in days (default 30). */
  SESSION_DAYS?: string;
}

export interface UserRow {
  email: string;
  display_name: string | null;
  jira_base_url: string | null;
  jira_email: string | null;
  jira_token_enc: string | null;
  jira_checked_at: string | null;
  jira_check_ok: number;
  created_at: string;
  updated_at: string;
}

export interface BoardMemberRow {
  board_id: string;
  email: string;
  role: 'editor' | 'viewer';
  created_at: string;
}

/** Resolved Jira credentials for one request. */
export interface JiraCreds {
  baseUrl: string;
  email: string;
  token: string;
}

export interface Board {
  id: string;
  name: string;
  owner_email: string | null;
  jira_project_key: string | null;
  jira_project_name: string | null;
  current_version_id: string | null;
  current_version_name: string | null;
  last_synced_at: string | null;
  /** JSON array of TrackPreset, editable per board. */
  track_presets: string;
  created_at: string;
  updated_at: string;
}

/** A work track (分工) such as 前端 / 中台 / PM測試. */
export interface TrackPreset {
  name: string;
  color: string;
}

export const DEFAULT_TRACK_PRESETS: TrackPreset[] = [
  { name: '前端', color: '#3355EE' },
  { name: '中台', color: '#12B886' },
  { name: 'PM測試', color: '#F59F00' },
];

const FALLBACK_TRACK_COLORS = ['#7048E8', '#E64980', '#15AABF', '#FA5252', '#2F9E44', '#495057'];

/** Colour for a track: the board's preset colour if it has one, otherwise a
 * stable colour derived from the name so the same track always looks the same. */
export function resolveTrackColor(presets: TrackPreset[], track: string | null | undefined): string {
  if (!track) return '#4C6EF5';
  const preset = presets.find((p) => p.name === track);
  if (preset) return preset.color;
  let hash = 0;
  for (let i = 0; i < track.length; i++) hash = (hash * 31 + track.charCodeAt(i)) >>> 0;
  return FALLBACK_TRACK_COLORS[hash % FALLBACK_TRACK_COLORS.length];
}

export function parseTrackPresets(raw: string | null | undefined): TrackPreset[] {
  if (!raw) return DEFAULT_TRACK_PRESETS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TRACK_PRESETS;
    const cleaned = parsed
      .filter((t) => t && typeof t.name === 'string' && t.name.trim())
      .map((t) => ({ name: String(t.name).trim(), color: typeof t.color === 'string' ? t.color : '#4C6EF5' }));
    return cleaned.length ? cleaned : DEFAULT_TRACK_PRESETS;
  } catch {
    return DEFAULT_TRACK_PRESETS;
  }
}

export type SyncState = 'active' | 'removed';
export type ItemSource = 'jira' | 'manual';

export interface JiraIssueRow {
  id: number;
  board_id: string;
  issue_key: string;
  project_key: string | null;
  summary: string;
  status: string | null;
  assignee: string | null;
  issue_type: string | null;
  version_id: string | null;
  version_name: string | null;
  jira_updated_at: string | null;
  last_synced_at: string | null;
  sync_state: SyncState;
  moved_to_version_id: string | null;
  moved_to_version_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface GanttItemRow {
  id: string;
  board_id: string;
  issue_key: string | null;
  source: ItemSource;
  title: string;
  group_name: string | null;
  /** Work track (分工), e.g. 前端 / 中台 / PM測試. */
  track: string | null;
  /** Per-track owner, independent of the Jira assignee. */
  owner: string | null;
  start_date: string;
  work_days: number;
  end_date: string;
  note: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface HolidayRow {
  id: number;
  board_id: string | null;
  date: string;
  name: string;
  type: 'government' | 'custom';
  /** 1 = 補班日: a working day even though it lands on a weekend. */
  is_workday: number;
  created_at: string;
}

/** The day rules a board schedules against. */
export interface WorkCalendar {
  /** Dates that are NOT worked (holidays + custom days off). */
  holidays: Set<string>;
  /** Dates that ARE worked even on a weekend (補班日). */
  workdays: Set<string>;
}

export interface SyncLogRow {
  id: number;
  board_id: string;
  version_id: string | null;
  version_name: string | null;
  added_count: number;
  updated_count: number;
  removed_count: number;
  unchanged_count: number;
  status: 'success' | 'partial' | 'failed';
  error_message: string | null;
  synced_at: string;
}

export interface ShareLinkRow {
  id: string;
  board_id: string;
  created_at: string;
  revoked_at: string | null;
}

// Normalized Jira issue shape used internally by the sync service.
export interface JiraIssueSummary {
  issueKey: string;
  projectKey: string;
  summary: string;
  status: string;
  assignee: string;
  issueType: string;
  versionId: string;
  versionName: string;
  jiraUpdatedAt: string;
}

export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'app_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
