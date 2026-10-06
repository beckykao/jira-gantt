-- Login sessions for "sign in with your own Jira API token".
--
-- The browser holds a random session id in an HttpOnly cookie. Only its
-- SHA-256 hash is stored here, so a leaked database copy cannot be used to
-- sign in as anyone.
-- Apply with: wrangler d1 migrations apply jira_gantt_db --local|--remote

CREATE TABLE IF NOT EXISTS sessions (
  id_hash      TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
