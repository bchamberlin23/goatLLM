use serde::{Deserialize, Serialize};

use super::db::DbState;
use super::embeddings::{blob_to_f32, cosine, f32_to_blob};

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct MemoryRow {
    id: String,
    text: String,
    category: String,
    scope: String,
    workspace_path: Option<String>,
    source_conversation_id: Option<String>,
    source_message_ids: Vec<String>,
    source_excerpt: Option<String>,
    auto_extracted: bool,
    confidence: Option<f64>,
    uses: i64,
    created_at: i64,
    updated_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub(crate) struct MemorySearchHit {
    id: String,
    text: String,
    category: String,
    scope: String,
    workspace_path: Option<String>,
    source_conversation_id: Option<String>,
    source_message_ids: Vec<String>,
    source_excerpt: Option<String>,
    auto_extracted: bool,
    confidence: Option<f64>,
    score: f32,
    uses: i64,
    created_at: i64,
    updated_at: Option<i64>,
}

fn source_ids_from_json(raw: String) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}

#[tauri::command]
pub(crate) fn memory_insert(
    id: String,
    text: String,
    category: String,
    embedding: Option<Vec<f32>>,
    model: Option<String>,
    scope: Option<String>,
    workspace_path: Option<String>,
    source_conversation_id: Option<String>,
    source_message_ids: Option<Vec<String>>,
    source_excerpt: Option<String>,
    auto_extracted: Option<bool>,
    confidence: Option<f64>,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let blob = embedding.as_ref().map(|emb| f32_to_blob(emb));
    let dim = embedding.as_ref().map(|emb| emb.len() as i64);
    let source_message_ids_json =
        serde_json::to_string(&source_message_ids.unwrap_or_default()).map_err(|e| e.to_string())?;
    let safe_scope = scope.unwrap_or_else(|| "global".to_string());

    db.execute(
        "INSERT INTO memories \
         (id, text, category, embedding, model, dim, uses, created_at, scope, workspace_path, source_conversation_id, source_message_ids, source_excerpt, updated_at, auto_extracted, confidence) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10, ?11, ?12, ?7, ?13, ?14) \
         ON CONFLICT(id) DO UPDATE SET text = ?2, category = ?3, embedding = ?4, model = ?5, dim = ?6, scope = ?8, workspace_path = ?9, source_conversation_id = ?10, source_message_ids = ?11, source_excerpt = ?12, updated_at = ?7, auto_extracted = ?13, confidence = ?14",
        rusqlite::params![
            id,
            text,
            category,
            blob,
            model,
            dim,
            now,
            safe_scope,
            workspace_path,
            source_conversation_id,
            source_message_ids_json,
            source_excerpt,
            if auto_extracted.unwrap_or(false) { 1 } else { 0 },
            confidence,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn memory_update(
    id: String,
    text: String,
    category: String,
    scope: Option<String>,
    workspace_path: Option<String>,
    embedding: Option<Vec<f32>>,
    model: Option<String>,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let blob = embedding.as_ref().map(|emb| f32_to_blob(emb));
    let dim = embedding.as_ref().map(|emb| emb.len() as i64);
    db.execute(
        "UPDATE memories \
         SET text = ?2, category = ?3, scope = ?4, workspace_path = ?5, embedding = ?6, model = ?7, dim = ?8, updated_at = ?9 \
         WHERE id = ?1",
        rusqlite::params![id, text, category, scope.unwrap_or_else(|| "global".to_string()), workspace_path, blob, model, dim, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn memory_list(
    category: Option<String>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<MemoryRow>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(cat) = category {
        let mut s = db.prepare("SELECT id, text, category, scope, workspace_path, source_conversation_id, source_message_ids, source_excerpt, auto_extracted, confidence, uses, created_at, updated_at FROM memories WHERE category = ?1 ORDER BY COALESCE(updated_at, created_at) DESC")
            .map_err(|e| e.to_string())?;
        let rows = s
            .query_map(rusqlite::params![cat], |row| {
                let source_raw: String = row.get(6)?;
                Ok(MemoryRow {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    category: row.get(2)?,
                    scope: row.get(3)?,
                    workspace_path: row.get(4)?,
                    source_conversation_id: row.get(5)?,
                    source_message_ids: source_ids_from_json(source_raw),
                    source_excerpt: row.get(7)?,
                    auto_extracted: row.get::<_, i64>(8)? != 0,
                    confidence: row.get(9)?,
                    uses: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let results: Vec<MemoryRow> = rows.filter_map(|r| r.ok()).collect();
        Ok(results)
    } else {
        let mut s = db.prepare("SELECT id, text, category, scope, workspace_path, source_conversation_id, source_message_ids, source_excerpt, auto_extracted, confidence, uses, created_at, updated_at FROM memories ORDER BY COALESCE(updated_at, created_at) DESC")
            .map_err(|e| e.to_string())?;
        let rows = s
            .query_map(rusqlite::params![], |row| {
                let source_raw: String = row.get(6)?;
                Ok(MemoryRow {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    category: row.get(2)?,
                    scope: row.get(3)?,
                    workspace_path: row.get(4)?,
                    source_conversation_id: row.get(5)?,
                    source_message_ids: source_ids_from_json(source_raw),
                    source_excerpt: row.get(7)?,
                    auto_extracted: row.get::<_, i64>(8)? != 0,
                    confidence: row.get(9)?,
                    uses: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let results: Vec<MemoryRow> = rows.filter_map(|r| r.ok()).collect();
        Ok(results)
    }
}

#[tauri::command]
pub(crate) fn memory_delete(id: String, state: tauri::State<'_, DbState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute("DELETE FROM memories WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn memory_increment_uses(
    id: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute(
        "UPDATE memories SET uses = uses + 1 WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn memory_search(
    query_embedding: Vec<f32>,
    limit: Option<i64>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<MemorySearchHit>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let limit_val = limit.unwrap_or(8).clamp(1, 100) as usize;

    let mut stmt = db.prepare("SELECT id, text, category, scope, workspace_path, source_conversation_id, source_message_ids, source_excerpt, auto_extracted, confidence, embedding, uses, created_at, updated_at FROM memories WHERE embedding IS NOT NULL")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, Option<f64>>(9)?,
                row.get::<_, Vec<u8>>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, Option<i64>>(13)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut scored: Vec<MemorySearchHit> = rows
        .filter_map(|r| r.ok())
        .map(|(id, text, category, scope, workspace_path, source_conversation_id, source_message_ids, source_excerpt, auto_extracted, confidence, blob, uses, created_at, updated_at)| {
            let emb = blob_to_f32(&blob);
            let score = cosine(&query_embedding, &emb);
            MemorySearchHit {
                id,
                text,
                category,
                scope,
                workspace_path,
                source_conversation_id,
                source_message_ids: source_ids_from_json(source_message_ids),
                source_excerpt,
                auto_extracted: auto_extracted != 0,
                confidence,
                score,
                uses,
                created_at,
                updated_at,
            }
        })
        .collect();

    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(limit_val);
    Ok(scored)
}

#[tauri::command]
pub(crate) fn memory_search_text(
    query: String,
    limit: Option<i64>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<MemorySearchHit>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let limit_val = limit.unwrap_or(8).clamp(1, 100) as usize;

    let search_pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = db.prepare("SELECT id, text, category, scope, workspace_path, source_conversation_id, source_message_ids, source_excerpt, auto_extracted, confidence, uses, created_at, updated_at FROM memories WHERE lower(text) LIKE ?1 ORDER BY COALESCE(updated_at, created_at) DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![search_pattern], |row| {
            let source_raw: String = row.get(6)?;
            Ok(MemorySearchHit {
                id: row.get(0)?,
                text: row.get(1)?,
                category: row.get(2)?,
                scope: row.get(3)?,
                workspace_path: row.get(4)?,
                source_conversation_id: row.get(5)?,
                source_message_ids: source_ids_from_json(source_raw),
                source_excerpt: row.get(7)?,
                auto_extracted: row.get::<_, i64>(8)? != 0,
                confidence: row.get(9)?,
                score: 1.0,
                uses: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results: Vec<MemorySearchHit> = rows.filter_map(|r| r.ok()).collect();
    results.truncate(limit_val);
    Ok(results)
}

#[tauri::command]
pub(crate) fn memory_settings_load(
    key: String,
    state: tauri::State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let raw: Result<String, _> = db.query_row(
        "SELECT value FROM memory_settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    );
    match raw {
        Ok(value) => serde_json::from_str(&value).map(Some).map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub(crate) fn memory_settings_save(
    key: String,
    value: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    db.execute(
        "INSERT OR REPLACE INTO memory_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![key, value, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
