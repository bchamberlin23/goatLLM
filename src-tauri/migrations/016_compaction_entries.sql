CREATE TABLE IF NOT EXISTS compaction_entries (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  first_kept_id   TEXT NOT NULL,
  summary         TEXT NOT NULL,
  read_files      TEXT NOT NULL DEFAULT '[]',
  modified_files  TEXT NOT NULL DEFAULT '[]',
  tokens_before   INTEGER NOT NULL,
  source          TEXT NOT NULL,
  is_split_turn   INTEGER NOT NULL DEFAULT 0,
  turn_prefix     TEXT,
  prompt_version  TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  mode            TEXT NOT NULL,
  model_id        TEXT
);

CREATE INDEX IF NOT EXISTS compaction_entries_conv_idx
  ON compaction_entries(conversation_id, created_at DESC);
