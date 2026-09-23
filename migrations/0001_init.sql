-- Jira Gantt Tool - initial schema
-- Apply with: wrangler d1 migrations apply jira_gantt_db --local|--remote

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- boards: one "甘特圖專案". May or may not be linked to a Jira project.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boards (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  jira_project_key    TEXT,
  jira_project_name   TEXT,
  current_version_id  TEXT,
  current_version_name TEXT,
  last_synced_at      TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- jira_issues: raw Jira data cache, keyed by issue_key (never Summary).
-- Completely separate from gantt scheduling data (gantt_items) so that a
-- sync can never clobber user-owned schedule fields.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jira_issues (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id              TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  issue_key             TEXT NOT NULL,
  project_key           TEXT,
  summary               TEXT NOT NULL DEFAULT '',
  status                TEXT,
  assignee              TEXT,
  issue_type            TEXT,
  version_id            TEXT,
  version_name          TEXT,
  jira_updated_at       TEXT,
  last_synced_at        TEXT,
  sync_state            TEXT NOT NULL DEFAULT 'active', -- active | removed
  moved_to_version_id   TEXT,
  moved_to_version_name TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE(board_id, issue_key)
);

CREATE INDEX IF NOT EXISTS idx_jira_issues_board ON jira_issues(board_id);
CREATE INDEX IF NOT EXISTS idx_jira_issues_board_state ON jira_issues(board_id, sync_state);

-- ---------------------------------------------------------------------------
-- gantt_items: user-owned schedule rows. source='manual' items have no
-- issue_key. source='jira' items reference jira_issues via (board_id,
-- issue_key) but own all scheduling fields independently.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gantt_items (
  id           TEXT PRIMARY KEY,
  board_id     TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  issue_key    TEXT,
  source       TEXT NOT NULL DEFAULT 'manual', -- jira | manual
  title        TEXT NOT NULL DEFAULT '',        -- used for manual items only
  group_name   TEXT,
  start_date   TEXT NOT NULL,
  work_days    INTEGER NOT NULL DEFAULT 1,
  end_date     TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '#4C6EF5',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gantt_items_board ON gantt_items(board_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_gantt_items_issue ON gantt_items(board_id, issue_key);

-- ---------------------------------------------------------------------------
-- holidays: board_id NULL rows are global (government). board_id set rows
-- are that board's custom extra holidays.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holidays (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   TEXT REFERENCES boards(id) ON DELETE CASCADE,
  date       TEXT NOT NULL, -- YYYY-MM-DD
  name       TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'custom', -- government | custom
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_unique
  ON holidays(date, type, COALESCE(board_id, ''));
CREATE INDEX IF NOT EXISTS idx_holidays_board ON holidays(board_id);

-- ---------------------------------------------------------------------------
-- sync_logs: history + summary of each "同步 Jira" run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id       TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  version_id     TEXT,
  version_name   TEXT,
  added_count    INTEGER NOT NULL DEFAULT 0,
  updated_count  INTEGER NOT NULL DEFAULT 0,
  removed_count  INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'success', -- success | partial | failed
  error_message  TEXT,
  synced_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_board ON sync_logs(board_id, synced_at DESC);

-- ---------------------------------------------------------------------------
-- share_links: read-only public share tokens for a board.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS share_links (
  id         TEXT PRIMARY KEY, -- the token itself
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_share_links_board ON share_links(board_id);

-- ---------------------------------------------------------------------------
-- Seed: ROC (Taiwan) government holidays 2026 & 2027.
-- Source: Directorate-General of Personnel Administration (DGPA) office
-- calendars for 民國115年/116年. Verify against the official DGPA calendar
-- (https://www.dgpa.gov.tw) each year and adjust via the custom-holiday UI
-- if your organization's calendar differs.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO holidays (board_id, date, name, type, created_at) VALUES
  (NULL, '2026-01-01', '元旦', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-14', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-15', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-16', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-17', '春節(除夕)', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-18', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-19', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-20', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-21', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-22', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-27', '和平紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-02-28', '和平紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-03-01', '和平紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-04-03', '兒童節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-04-04', '兒童節、清明節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-04-05', '清明節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-04-06', '清明節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-05-01', '勞動節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-05-02', '勞動節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-05-03', '勞動節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-06-19', '端午節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-06-20', '端午節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-06-21', '端午節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-09-25', '中秋節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-09-26', '中秋節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-09-27', '中秋節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-09-28', '教師節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-10-09', '國慶日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-10-10', '國慶日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-10-11', '國慶日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-10-24', '台灣光復節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-10-25', '台灣光復節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-10-26', '台灣光復節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-12-25', '行憲紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-12-26', '行憲紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2026-12-27', '行憲紀念日', 'government', '2026-01-01T00:00:00Z'),

  (NULL, '2027-01-01', '元旦', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-01-02', '元旦', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-01-03', '元旦', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-02-04', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-02-05', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-02-06', '春節(除夕)', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-02-07', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-02-08', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-02-09', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-02-10', '春節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-02-27', '和平紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-02-28', '和平紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-03-01', '和平紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-04-03', '兒童節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-04-04', '兒童節、清明節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-04-05', '清明節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-04-06', '清明節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-04-30', '勞動節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-05-01', '勞動節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-05-02', '勞動節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-06-09', '端午節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-09-15', '中秋節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-09-28', '教師節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-10-09', '國慶日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-10-10', '國慶日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-10-11', '國慶日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-10-23', '台灣光復節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-10-24', '台灣光復節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-10-25', '台灣光復節', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-12-24', '行憲紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-12-25', '行憲紀念日', 'government', '2026-01-01T00:00:00Z'),
  (NULL, '2027-12-26', '行憲紀念日', 'government', '2026-01-01T00:00:00Z');
