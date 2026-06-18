ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';
ALTER TABLE memories ADD COLUMN workspace_path TEXT;
ALTER TABLE memories ADD COLUMN source_conversation_id TEXT;
ALTER TABLE memories ADD COLUMN source_message_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE memories ADD COLUMN source_excerpt TEXT;
ALTER TABLE memories ADD COLUMN updated_at INTEGER;
ALTER TABLE memories ADD COLUMN auto_extracted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN confidence REAL;

UPDATE memories SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, workspace_path);

CREATE TABLE IF NOT EXISTS memory_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
