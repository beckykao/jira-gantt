-- Multi-user support:
--   * each person stores their own Jira credentials (token encrypted at rest)
--   * every board has an owner; other people are read-only unless invited
--   * holidays can mark a date as a forced WORK day (補班日), overriding the
--     weekend rule
-- Apply with: wrangler d1 migrations apply jira_gantt_db --local|--remote

-- ---------------------------------------------------------------------------
-- users: one row per person, keyed by the email Cloudflare Access reports.
-- jira_token_enc holds an AES-GCM ciphertext — never plaintext, and never
-- returned to the browser.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  email             TEXT PRIMARY KEY,
  display_name      TEXT,
  jira_base_url     TEXT,
  jira_email        TEXT,
  jira_token_enc    TEXT,
  jira_checked_at   TEXT,
  jira_check_ok     INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Board ownership. Existing boards have no owner yet: they stay editable by
-- everyone until someone claims them (see functions/lib/permissions.ts).
-- ---------------------------------------------------------------------------
ALTER TABLE boards ADD COLUMN owner_email TEXT;

CREATE TABLE IF NOT EXISTS board_members (
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'editor', -- editor | viewer
  created_at TEXT NOT NULL,
  PRIMARY KEY (board_id, email)
);

CREATE INDEX IF NOT EXISTS idx_board_members_email ON board_members(email);
CREATE INDEX IF NOT EXISTS idx_boards_owner ON boards(owner_email);

-- ---------------------------------------------------------------------------
-- 補班日: a date that IS a working day even though it falls on a weekend.
-- Rows with is_workday = 1 win over both the weekend rule and holiday rows.
-- ---------------------------------------------------------------------------
ALTER TABLE holidays ADD COLUMN is_workday INTEGER NOT NULL DEFAULT 0;

-- Who last imported the shared government calendar, shown in the UI.
CREATE TABLE IF NOT EXISTS holiday_imports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_by   TEXT NOT NULL,
  file_name     TEXT,
  added_count   INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  workday_count INTEGER NOT NULL DEFAULT 0,
  imported_at   TEXT NOT NULL
);
