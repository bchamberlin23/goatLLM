-- Persist conversation mode (chat / agent / design) and optional workspace
-- path so the sidebar can render mode badges and design conversations survive
-- a full restart without losing their identity.
ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE conversations ADD COLUMN workspace_path TEXT NOT NULL DEFAULT '';
