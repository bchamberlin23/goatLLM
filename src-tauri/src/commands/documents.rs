use serde::{Deserialize, Serialize};

use super::db::DbState;
use super::embeddings::{blob_to_f32, cosine, f32_to_blob};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeSourcePayload {
    kind: String,
    label: String,
    uri: Option<String>,
    page: Option<i64>,
    line_start: Option<i64>,
    line_end: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeDocumentPayload {
    id: String,
    workspace_id: String,
    title: String,
    filename: String,
    mime_type: String,
    source: KnowledgeSourcePayload,
    text: String,
    characters: i64,
    status: String,
    embedded: bool,
    pinned: bool,
    chunk_count: Option<i64>,
    embedding_model: Option<String>,
    last_embedded_at: Option<i64>,
    last_synced_at: Option<i64>,
    last_error: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentWorkspacePayload {
    id: String,
    name: String,
    workspace_path: Option<String>,
    documents: Vec<KnowledgeDocumentPayload>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeChunkPayload {
    id: String,
    document_id: String,
    start_line: i64,
    end_line: i64,
    content: String,
    embedding: Option<Vec<f32>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeSearchHit {
    id: String,
    document_id: String,
    title: String,
    content: String,
    score: f32,
    pinned: bool,
    updated_at: i64,
    source: KnowledgeSourcePayload,
    start_line: i64,
    end_line: i64,
}

fn source_to_json(source: &KnowledgeSourcePayload) -> Result<String, String> {
    serde_json::to_string(source).map_err(|e| e.to_string())
}

fn source_from_json(raw: String, fallback: &str) -> KnowledgeSourcePayload {
    serde_json::from_str::<KnowledgeSourcePayload>(&raw).unwrap_or(KnowledgeSourcePayload {
        kind: "upload".to_string(),
        label: fallback.to_string(),
        uri: None,
        page: None,
        line_start: None,
        line_end: None,
    })
}

#[tauri::command]
pub(crate) fn document_workspaces_load(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<DocumentWorkspacePayload>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut workspace_stmt = db
        .prepare(
            "SELECT id, name, workspace_path, created_at, updated_at \
             FROM document_workspaces ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let workspace_rows: Vec<(String, String, String, i64, i64)> = workspace_stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|row| row.ok())
        .collect();

    let mut out = Vec::new();
    for (id, name, workspace_path, created_at, updated_at) in workspace_rows {
        let mut doc_stmt = db
            .prepare(
                "SELECT id, workspace_id, title, filename, mime_type, source_json, text, characters, status, embedded, pinned, \
                        chunk_count, embedding_model, last_embedded_at, last_synced_at, last_error, created_at, updated_at \
                 FROM knowledge_documents WHERE workspace_id = ?1 ORDER BY pinned DESC, updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let documents = doc_stmt
            .query_map(rusqlite::params![id.clone()], |row| {
                let filename: String = row.get(3)?;
                let source_raw: String = row.get(5)?;
                Ok(KnowledgeDocumentPayload {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    title: row.get(2)?,
                    filename: filename.clone(),
                    mime_type: row.get(4)?,
                    source: source_from_json(source_raw, &filename),
                    text: row.get(6)?,
                    characters: row.get(7)?,
                    status: row.get(8)?,
                    embedded: row.get::<_, i64>(9)? != 0,
                    pinned: row.get::<_, i64>(10)? != 0,
                    chunk_count: row.get(11)?,
                    embedding_model: row.get(12)?,
                    last_embedded_at: row.get(13)?,
                    last_synced_at: row.get(14)?,
                    last_error: row.get(15)?,
                    created_at: row.get(16)?,
                    updated_at: row.get(17)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|row| row.ok())
            .collect();
        out.push(DocumentWorkspacePayload {
            id,
            name,
            workspace_path: if workspace_path.is_empty() {
                None
            } else {
                Some(workspace_path)
            },
            documents,
            created_at,
            updated_at,
        });
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn document_workspace_save(
    workspace: DocumentWorkspacePayload,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO document_workspaces (id, name, workspace_path, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            workspace.id,
            workspace.name,
            workspace.workspace_path.unwrap_or_default(),
            workspace.created_at,
            workspace.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;

    for document in &workspace.documents {
        let source_json = source_to_json(&document.source)?;
        tx.execute(
            "INSERT OR REPLACE INTO knowledge_documents \
             (id, workspace_id, title, filename, mime_type, source_json, text, characters, status, embedded, pinned, chunk_count, embedding_model, last_embedded_at, last_synced_at, last_error, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            rusqlite::params![
                document.id,
                workspace.id,
                document.title,
                document.filename,
                document.mime_type,
                source_json,
                document.text,
                document.characters,
                document.status,
                if document.embedded { 1 } else { 0 },
                if document.pinned { 1 } else { 0 },
                document.chunk_count,
                document.embedding_model,
                document.last_embedded_at,
                document.last_synced_at,
                document.last_error,
                document.created_at,
                document.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let ids: Vec<String> = workspace.documents.iter().map(|doc| doc.id.clone()).collect();
    if ids.is_empty() {
        tx.execute(
            "DELETE FROM knowledge_documents WHERE workspace_id = ?1",
            rusqlite::params![workspace.id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "DELETE FROM knowledge_documents WHERE workspace_id = ? AND id NOT IN ({})",
            placeholders
        );
        let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len() + 1);
        params.push(&workspace.id);
        for id in &ids {
            params.push(id);
        }
        tx.execute(&sql, params.as_slice()).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn document_workspace_delete(
    workspace_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute(
        "DELETE FROM document_workspaces WHERE id = ?1",
        rusqlite::params![workspace_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn document_chunks_replace(
    workspace_id: String,
    document_id: String,
    chunks: Vec<KnowledgeChunkPayload>,
    model: Option<String>,
    state: tauri::State<'_, DbState>,
) -> Result<usize, String> {
    let mut db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM knowledge_document_chunks WHERE document_id = ?1",
        rusqlite::params![document_id],
    )
    .map_err(|e| e.to_string())?;

    let mut inserted = 0usize;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO knowledge_document_chunks \
                 (id, workspace_id, document_id, start_line, end_line, content, embedding, model, dim, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .map_err(|e| e.to_string())?;
        for chunk in &chunks {
            let blob = chunk.embedding.as_ref().map(|embedding| f32_to_blob(embedding));
            let dim = chunk.embedding.as_ref().map(|embedding| embedding.len() as i64);
            stmt.execute(rusqlite::params![
                chunk.id,
                workspace_id,
                document_id,
                chunk.start_line,
                chunk.end_line,
                chunk.content,
                blob,
                model,
                dim,
                now,
            ])
            .map_err(|e| e.to_string())?;
            inserted += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(inserted)
}

#[tauri::command]
pub(crate) fn document_chunks_delete(
    document_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute(
        "DELETE FROM knowledge_document_chunks WHERE document_id = ?1",
        rusqlite::params![document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn document_chunks_search(
    workspace_id: String,
    query_embedding: Vec<f32>,
    limit: Option<i64>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<KnowledgeSearchHit>, String> {
    let limit_val = limit.unwrap_or(8).clamp(1, 50) as usize;
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut stmt = db
        .prepare(
            "SELECT c.id, c.document_id, d.title, c.content, c.embedding, d.pinned, d.updated_at, d.source_json, d.filename, c.start_line, c.end_line \
             FROM knowledge_document_chunks c JOIN knowledge_documents d ON d.id = c.document_id \
             WHERE c.workspace_id = ?1 AND c.embedding IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![workspace_id], |row| {
            let source_raw: String = row.get(7)?;
            let filename: String = row.get(8)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Vec<u8>>(4)?,
                row.get::<_, i64>(5)? != 0,
                row.get::<_, i64>(6)?,
                source_from_json(source_raw, &filename),
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut scored: Vec<KnowledgeSearchHit> = rows
        .filter_map(|row| row.ok())
        .map(|(id, document_id, title, content, blob, pinned, updated_at, source, start_line, end_line)| {
            let embedding = blob_to_f32(&blob);
            KnowledgeSearchHit {
                id,
                document_id,
                title,
                content,
                score: cosine(&query_embedding, &embedding),
                pinned,
                updated_at,
                source,
                start_line,
                end_line,
            }
        })
        .collect();

    scored.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    scored.truncate(limit_val);
    Ok(scored)
}
