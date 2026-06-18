CREATE TABLE IF NOT EXISTS scheduled_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_result TEXT,
  last_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  result TEXT,
  error TEXT,
  trace TEXT NOT NULL DEFAULT '[]',
  output_artifact_ids TEXT NOT NULL DEFAULT '[]',
  conversation_id TEXT,
  read_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scheduled_agents_due ON scheduled_agents(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_agent ON scheduled_agent_runs(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_status ON scheduled_agent_runs(status);
