use serde::{Deserialize, Serialize};

use super::db::DbState;
use super::embeddings::{blob_to_f32, cosine, f32_to_blob};

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct MemoryRow {
    id: String,
    text: String,
    category: String,
    uses: i64,
    created_at: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct MemorySearchHit {
    id: String,
    text: String,
    category: String,
    score: f32,
    uses: i64,
    created_at: i64,
}

#[tauri::command]
pub(crate) fn memory_insert(
    id: String,
    text: String,
    category: String,
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
        "INSERT INTO memories (id, text, category, embedding, model, dim, uses, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7) \
         ON CONFLICT(id) DO UPDATE SET text = ?2, category = ?3, embedding = ?4, model = ?5, dim = ?6",
        rusqlite::params![id, text, category, blob, model, dim, now],
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
        let mut s = db.prepare("SELECT id, text, category, uses, created_at FROM memories WHERE category = ?1 ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = s
            .query_map(rusqlite::params![cat], |row| {
                Ok(MemoryRow {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    category: row.get(2)?,
                    uses: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let results: Vec<MemoryRow> = rows.filter_map(|r| r.ok()).collect();
        Ok(results)
    } else {
        let mut s = db.prepare("SELECT id, text, category, uses, created_at FROM memories ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = s
            .query_map(rusqlite::params![], |row| {
                Ok(MemoryRow {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    category: row.get(2)?,
                    uses: row.get(3)?,
                    created_at: row.get(4)?,
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

    let mut stmt = db.prepare("SELECT id, text, category, embedding, uses, created_at FROM memories WHERE embedding IS NOT NULL")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut scored: Vec<MemorySearchHit> = rows
        .filter_map(|r| r.ok())
        .map(|(id, text, category, blob, uses, created_at)| {
            let emb = blob_to_f32(&blob);
            let score = cosine(&query_embedding, &emb);
            MemorySearchHit {
                id,
                text,
                category,
                score,
                uses,
                created_at,
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
    let mut stmt = db.prepare("SELECT id, text, category, uses, created_at FROM memories WHERE lower(text) LIKE ?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![search_pattern], |row| {
            Ok(MemorySearchHit {
                id: row.get(0)?,
                text: row.get(1)?,
                category: row.get(2)?,
                score: 1.0,
                uses: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results: Vec<MemorySearchHit> = rows.filter_map(|r| r.ok()).collect();
    results.truncate(limit_val);
    Ok(results)
}
