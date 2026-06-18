CREATE TABLE IF NOT EXISTS meeting_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  duration_ms INTEGER,
  audio_filename TEXT,
  transcript TEXT,
  summary TEXT,
  action_items TEXT NOT NULL DEFAULT '[]',
  decisions TEXT NOT NULL DEFAULT '[]',
  participants TEXT NOT NULL DEFAULT '[]',
  model_id TEXT,
  conversation_id TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_meeting_sessions_updated ON meeting_sessions(updated_at);

CREATE TABLE IF NOT EXISTS meeting_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
