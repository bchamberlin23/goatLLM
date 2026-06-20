CREATE TABLE IF NOT EXISTS discovered_models (
  provider_id TEXT PRIMARY KEY,
  models_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
