-- Agent event log: append-only record of everything in an agent session.
-- Serves resumability, debugging, and sharing.

CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'message', 'tool_call', 'tool_result', 'approval', 'error', 'lifecycle'
  )),
  payload JSON NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_events_conv ON agent_events(conversation_id, created_at);
