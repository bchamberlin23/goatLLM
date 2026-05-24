CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embeddings_workspace ON embeddings(workspace);
CREATE INDEX IF NOT EXISTS idx_embeddings_workspace_file ON embeddings(workspace, file_path);
