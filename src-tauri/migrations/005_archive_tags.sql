-- Conversation archive + tags. Both fields are denormalized onto the
-- `conversations` row so the sidebar can render archived state and tag
-- chips without an extra join. Tags are stored as a JSON array of strings;
-- a small enough list that we don't bother with a normalized table.
ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(archived);
