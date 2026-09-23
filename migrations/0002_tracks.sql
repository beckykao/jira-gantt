-- Multi-track support: one Jira issue can be split into several work tracks
-- (前端 / 中台 / PM測試 ...), each with its own dates, work days and owner.
-- Apply with: wrangler d1 migrations apply jira_gantt_db --local|--remote

-- Which work track this schedule row belongs to. NULL/'' = an ungrouped row
-- (e.g. a plain manual item that isn't split by track).
ALTER TABLE gantt_items ADD COLUMN track TEXT;

-- Per-track owner. Jira only carries one assignee per issue, but each track
-- is usually handled by a different person.
ALTER TABLE gantt_items ADD COLUMN owner TEXT;

-- Per-board track presets, stored as a JSON array of {name, color}.
-- Editable in the UI (新增 / 改名 / 刪除 / 排序 / 換色).
ALTER TABLE boards ADD COLUMN track_presets TEXT NOT NULL
  DEFAULT '[{"name":"前端","color":"#3355EE"},{"name":"中台","color":"#12B886"},{"name":"PM測試","color":"#F59F00"}]';

CREATE INDEX IF NOT EXISTS idx_gantt_items_issue_track
  ON gantt_items(board_id, issue_key, track);
