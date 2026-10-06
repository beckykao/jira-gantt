// Thin Jira Cloud REST API v3 client. Always called server-side, with the
// credentials of whoever made the request — the browser never receives a
// Jira token.

import { AppError, JiraCreds, JiraIssueSummary } from './types';

const NOT_CONNECTED =
  '你還沒有設定 Jira 連線。請點右上角的「Jira 連線」填入你的 Jira 網址、帳號 email 與 API Token。';

function normalizeBaseUrl(raw: string): string {
  return (raw || '').trim().replace(/\/+$/, '');
}

async function jiraFetch(creds: JiraCreds, path: string, init?: RequestInit): Promise<Response> {
  const base = normalizeBaseUrl(creds?.baseUrl ?? '');
  if (!base || !creds?.email || !creds?.token) {
    throw new AppError(NOT_CONNECTED, 400, 'jira_not_connected');
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${btoa(`${creds.email}:${creds.token}`)}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new AppError('無法連線到 Jira，請確認網路狀態或 Jira 站台網址是否正確。', 502, 'jira_unreachable');
  }
  if (res.status === 401 || res.status === 403) {
    throw new AppError('Jira 帳號或 API Token 無效，請到「Jira 連線」重新確認後再試。', 401, 'jira_unauthorized');
  }
  return res;
}

/** Cheap call used by the settings page's "測試連線" button. */
export async function testConnection(creds: JiraCreds): Promise<{ accountId: string; displayName: string }> {
  const res = await jiraFetch(creds, `/rest/api/3/myself`);
  if (!res.ok) {
    throw new AppError(`Jira 連線測試失敗（HTTP ${res.status}），請確認網址與帳號是否正確。`, res.status, 'jira_error');
  }
  const me = (await res.json()) as { accountId?: string; displayName?: string; emailAddress?: string };
  return { accountId: me.accountId ?? '', displayName: me.displayName ?? me.emailAddress ?? '' };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export async function listProjects(creds: JiraCreds): Promise<JiraProject[]> {
  const res = await jiraFetch(creds, `/rest/api/3/project/search?maxResults=200&orderBy=name`);
  if (!res.ok) {
    throw new AppError('無法取得 Jira 專案清單，請稍後再試。', res.status, 'jira_error');
  }
  const data = (await res.json()) as { values: Array<{ id: string; key: string; name: string }> };
  return (data.values ?? []).map((p) => ({ id: p.id, key: p.key, name: p.name }));
}

export interface JiraVersion {
  id: string;
  name: string;
  released: boolean;
  archived: boolean;
}

export async function listVersions(creds: JiraCreds, projectKey: string): Promise<JiraVersion[]> {
  const res = await jiraFetch(creds, `/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`);
  if (res.status === 404) {
    throw new AppError(`找不到 Jira 專案「${projectKey}」，請確認專案代碼是否正確。`, 404, 'jira_project_not_found');
  }
  if (!res.ok) {
    throw new AppError('無法取得 Jira Version 清單，請稍後再試。', res.status, 'jira_error');
  }
  const data = (await res.json()) as Array<{ id: string; name: string; released: boolean; archived: boolean }>;
  return data.map((v) => ({ id: v.id, name: v.name, released: !!v.released, archived: !!v.archived }));
}

interface RawJiraIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string } | null;
    issuetype?: { name?: string };
    fixVersions?: Array<{ id: string; name: string }>;
    updated?: string;
    project?: { key?: string };
  };
}

function normalizeIssue(raw: RawJiraIssue, versionId: string, versionName: string): JiraIssueSummary {
  return {
    issueKey: raw.key,
    projectKey: raw.fields.project?.key ?? '',
    summary: raw.fields.summary ?? '',
    status: raw.fields.status?.name ?? '',
    assignee: raw.fields.assignee?.displayName ?? '未指派',
    issueType: raw.fields.issuetype?.name ?? '',
    versionId,
    versionName,
    jiraUpdatedAt: raw.fields.updated ?? '',
  };
}

const ISSUE_FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'fixVersions', 'updated', 'project'];

/** Pull the human-readable part out of a Jira error payload so the UI can say
 * what actually went wrong instead of a bare status code. */
async function jiraErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string> };
      const messages = [...(parsed.errorMessages ?? []), ...Object.values(parsed.errors ?? {})];
      return messages.length ? `Jira 回報：${messages.join('；')}` : '';
    } catch {
      return `Jira 回報：${text.slice(0, 200)}`;
    }
  } catch {
    return '';
  }
}

function buildVersionJql(projectKey: string, versionId: string): string {
  // Numeric version ids must NOT be quoted in JQL, otherwise Jira treats the
  // value as a version *name* and the query fails.
  const versionClause = /^\d+$/.test(versionId)
    ? `fixVersion = ${versionId}`
    : `fixVersion = ${JSON.stringify(versionId)}`;
  return `project = ${JSON.stringify(projectKey)} AND ${versionClause} ORDER BY key ASC`;
}

/**
 * Fetch every issue currently attached to a given fixVersion.
 *
 * Jira Cloud replaced POST /rest/api/3/search with POST /rest/api/3/search/jql
 * (token-based pagination, no `total`). We use the current endpoint and fall
 * back to the legacy one only if this instance doesn't have it (e.g. older
 * Jira Server / Data Center).
 */
export async function fetchIssuesByVersion(
  creds: JiraCreds,
  projectKey: string,
  versionId: string,
  versionName: string
): Promise<JiraIssueSummary[]> {
  const issues: JiraIssueSummary[] = [];
  const jql = buildVersionJql(projectKey, versionId);
  let nextPageToken: string | undefined;
  let useLegacyEndpoint = false;
  let legacyStartAt = 0;
  let guard = 0;

  while (guard++ < 500) {
    let res: Response;

    if (!useLegacyEndpoint) {
      const body: Record<string, unknown> = { jql, maxResults: 100, fields: ISSUE_FIELDS };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      res = await jiraFetch(creds, `/rest/api/3/search/jql`, { method: 'POST', body: JSON.stringify(body) });

      // This Jira doesn't offer the new endpoint — retry the whole fetch on the legacy one.
      if (res.status === 404 || res.status === 405) {
        useLegacyEndpoint = true;
        continue;
      }
    } else {
      res = await jiraFetch(creds, `/rest/api/3/search`, {
        method: 'POST',
        body: JSON.stringify({ jql, startAt: legacyStartAt, maxResults: 100, fields: ISSUE_FIELDS }),
      });
    }

    if (res.status === 400) {
      const detail = await jiraErrorDetail(res);
      throw new AppError(
        `Jira 查詢條件有誤，可能該 Version 已被刪除或已改名。${detail}`.trim(),
        400,
        'jira_version_invalid'
      );
    }
    if (!res.ok) {
      const detail = await jiraErrorDetail(res);
      throw new AppError(
        `向 Jira 取得需求清單失敗（HTTP ${res.status}）。${detail}`.trim(),
        res.status,
        'jira_error'
      );
    }

    const data = (await res.json()) as {
      issues?: RawJiraIssue[];
      nextPageToken?: string;
      isLast?: boolean;
      total?: number;
    };
    const batch = data.issues ?? [];
    for (const raw of batch) {
      issues.push(normalizeIssue(raw, versionId, versionName));
    }

    if (useLegacyEndpoint) {
      legacyStartAt += 100;
      if (batch.length === 0 || legacyStartAt >= (data.total ?? 0)) break;
    } else {
      nextPageToken = data.nextPageToken;
      if (!nextPageToken || data.isLast || batch.length === 0) break;
    }
  }

  return issues;
}

export interface JiraIssueLookup {
  found: boolean;
  summary?: string;
  status?: string;
  fixVersions?: Array<{ id: string; name: string }>;
}

/** Look up a single issue by key — used when an issue disappears from a
 * version sync, to tell "moved to another version" apart from "deleted /
 * no longer visible". */
export async function lookupIssue(creds: JiraCreds, issueKey: string): Promise<JiraIssueLookup> {
  const res = await jiraFetch(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${ISSUE_FIELDS.join(',')}`
  );
  if (res.status === 404) return { found: false };
  if (!res.ok) {
    // Treat other failures as "unknown / could not verify" rather than
    // silently deleting the user's schedule data — surface as removed but
    // without a moved-to-version hint.
    return { found: false };
  }
  const raw = (await res.json()) as RawJiraIssue;
  return {
    found: true,
    summary: raw.fields.summary,
    status: raw.fields.status?.name,
    fixVersions: raw.fields.fixVersions ?? [],
  };
}
