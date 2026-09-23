// Diff-based Jira sync (spec 六～八). Never deletes/rebuilds the whole
// jira_issues table, never touches gantt_items, always compares against the
// previously-synced rows for this board.

import * as db from './db';
import * as jira from './jira';
import { Env } from './types';

export interface SyncSummary {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  versionId: string;
  versionName: string;
  syncedAt: string;
}

function fieldsChanged(
  row: { summary: string; status: string | null; assignee: string | null; issue_type: string | null; jira_updated_at: string | null; version_id: string | null },
  issue: { summary: string; status: string; assignee: string; issueType: string; jiraUpdatedAt: string; versionId: string }
): boolean {
  return (
    row.summary !== issue.summary ||
    (row.status ?? '') !== issue.status ||
    (row.assignee ?? '') !== issue.assignee ||
    (row.issue_type ?? '') !== issue.issueType ||
    (row.jira_updated_at ?? '') !== issue.jiraUpdatedAt ||
    (row.version_id ?? '') !== issue.versionId
  );
}

export async function syncBoardVersion(
  env: Env,
  boardId: string,
  projectKey: string,
  versionId: string,
  versionName: string
): Promise<SyncSummary> {
  const existingRows = await db.listJiraIssues(env, boardId);
  const existingActive = new Map(existingRows.filter((r) => r.sync_state === 'active').map((r) => [r.issue_key, r]));

  const fetched = await jira.fetchIssuesByVersion(env, projectKey, versionId, versionName);
  const fetchedKeys = new Set(fetched.map((i) => i.issueKey));

  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const removed: string[] = [];

  for (const issue of fetched) {
    const row = existingActive.get(issue.issueKey);
    if (!row) {
      await db.upsertJiraIssueInsert(env, boardId, issue);
      added.push(issue.issueKey);
    } else {
      if (fieldsChanged(row, issue)) {
        await db.updateJiraIssueFields(env, boardId, issue.issueKey, issue);
        updated.push(issue.issueKey);
      } else {
        await db.touchJiraIssueSeen(env, boardId, issue.issueKey);
        unchanged.push(issue.issueKey);
      }
      existingActive.delete(issue.issueKey);
    }
  }

  // Anything left in existingActive was active before this sync but is not
  // part of the fetched version anymore — verify individually before
  // marking removed, so we can tell "moved to another version" apart from
  // "deleted / inaccessible".
  for (const row of existingActive.values()) {
    if (fetchedKeys.has(row.issue_key)) continue; // safety, shouldn't happen
    const lookup = await jira.lookupIssue(env, row.issue_key);
    if (!lookup.found) {
      await db.markJiraIssueRemoved(env, boardId, row.issue_key, {});
      removed.push(row.issue_key);
      continue;
    }
    const otherVersion = (lookup.fixVersions ?? []).find((v) => v.id !== versionId);
    await db.markJiraIssueRemoved(env, boardId, row.issue_key, {
      movedToVersionId: otherVersion?.id ?? null,
      movedToVersionName: otherVersion?.name ?? null,
      refreshedSummary: lookup.summary ?? null,
      refreshedStatus: lookup.status ?? null,
    });
    removed.push(row.issue_key);
  }

  await db.touchBoardSync(env, boardId, versionId, versionName);

  return {
    added,
    updated,
    removed,
    unchanged,
    versionId,
    versionName,
    syncedAt: new Date().toISOString(),
  };
}
