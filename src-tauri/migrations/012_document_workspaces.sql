CREATE TABLE IF NOT EXISTS document_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_path TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES document_workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  source_json TEXT NOT NULL,
  text TEXT NOT NULL,
  characters INTEGER NOT NULL,
  status TEXT NOT NULL,
  embedded INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER,
  embedding_model TEXT,
  last_embedded_at INTEGER,
  last_synced_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_document_chunks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES document_workspaces(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB,
  model TEXT,
  dim INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_workspace ON knowledge_documents(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_pinned ON knowledge_documents(workspace_id, pinned);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_workspace ON knowledge_document_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_document_chunks(document_id);
