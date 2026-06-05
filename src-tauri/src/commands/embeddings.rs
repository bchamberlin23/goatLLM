use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;

use super::db::DbState;
use super::workspace::{check_denylist_ws, get_ws_patterns, WorkspaceState};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct Chunk {
    file_path: String,
    start_line: u32,
    end_line: u32,
    content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct EmbeddingRow {
    file_path: String,
    start_line: u32,
    end_line: u32,
    content: String,
    embedding: Vec<f32>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SearchHit {
    file: String,
    start_line: u32,
    end_line: u32,
    content: String,
    score: f32,
}

pub(crate) fn chunk_file(path: &str, content: &str) -> Vec<Chunk> {
    const WINDOW: usize = 80;
    const OVERLAP: usize = 20;

    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut start = 0usize;
    while start < lines.len() {
        let end = (start + WINDOW).min(lines.len());
        let body = lines[start..end].join("\n");
        if body.trim().is_empty() {
            if end == lines.len() {
                break;
            }
            start = end.saturating_sub(OVERLAP).max(start + 1);
            continue;
        }
        out.push(Chunk {
            file_path: path.to_string(),
            start_line: (start + 1) as u32,
            end_line: end as u32,
            content: body,
        });
        if end == lines.len() {
            break;
        }
        start = end.saturating_sub(OVERLAP);
    }
    out
}

/// Skip the same set as `search_content`, plus binary-by-extension.
pub(crate) fn should_index_path(name: &str, is_dir: bool) -> bool {
    if is_dir {
        return !matches!(
            name,
            "node_modules"
                | ".git"
                | "target"
                | "dist"
                | "build"
                | ".next"
                | "out"
                | ".cache"
                | ".venv"
                | "venv"
                | "__pycache__"
        );
    }
    let lower = name.to_lowercase();
    let bad_ext = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf", ".zip", ".tar", ".gz",
        ".bz2", ".7z", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".mov", ".avi",
        ".webm", ".wasm", ".so", ".dll", ".dylib", ".exe", ".o", ".a", ".rlib", ".lock",
    ];
    !bad_ext.iter().any(|e| lower.ends_with(e))
}

#[tauri::command]
pub(crate) fn workspace_chunks(
    workspace: String,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<Vec<Chunk>, String> {
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    workspace_chunks_impl(workspace, &ws_patterns)
}

pub(crate) fn workspace_chunks_impl(
    workspace: String,
    ws_patterns: &[String],
) -> Result<Vec<Chunk>, String> {
    use walkdir::WalkDir;

    let ws = std::path::Path::new(&workspace);
    let mut chunks = Vec::new();

    for entry in WalkDir::new(ws)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            should_index_path(&name, e.file_type().is_dir())
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        if check_denylist_ws(entry.path(), ws_patterns).is_err() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.len() > 1_000_000 {
            // Skip files >1MB. Same threshold as search_content.
            continue;
        }
        let content = match fs::read_to_string(entry.path()) {
            Ok(s) => s,
            Err(_) => continue, // binary or unreadable
        };
        let rel = entry
            .path()
            .strip_prefix(ws)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .to_string();
        chunks.extend(chunk_file(&rel, &content));
    }

    Ok(chunks)
}

pub(crate) fn f32_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

pub(crate) fn blob_to_f32(b: &[u8]) -> Vec<f32> {
    let mut out = Vec::with_capacity(b.len() / 4);
    let mut i = 0;
    while i + 4 <= b.len() {
        let mut buf = [0u8; 4];
        buf.copy_from_slice(&b[i..i + 4]);
        out.push(f32::from_le_bytes(buf));
        i += 4;
    }
    out
}

pub(crate) fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

#[tauri::command]
pub(crate) fn embeddings_clear(
    workspace: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute(
        "DELETE FROM embeddings WHERE workspace = ?1",
        rusqlite::params![workspace],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn embeddings_count(
    workspace: String,
    state: tauri::State<'_, DbState>,
) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let n: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM embeddings WHERE workspace = ?1",
            rusqlite::params![workspace],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n)
}

#[tauri::command]
pub(crate) fn embeddings_insert(
    workspace: String,
    rows: Vec<EmbeddingRow>,
    model: String,
    state: tauri::State<'_, DbState>,
) -> Result<usize, String> {
    let mut db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let tx = db.transaction().map_err(|e| e.to_string())?;
    let mut inserted = 0usize;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO embeddings (workspace, file_path, start_line, end_line, content, embedding, model, dim, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )
            .map_err(|e| e.to_string())?;
        for row in &rows {
            let blob = f32_to_blob(&row.embedding);
            let dim = row.embedding.len() as i64;
            stmt.execute(rusqlite::params![
                workspace,
                row.file_path,
                row.start_line as i64,
                row.end_line as i64,
                row.content,
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
pub(crate) fn embeddings_search(
    workspace: String,
    query_embedding: Vec<f32>,
    top_k: Option<u32>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<SearchHit>, String> {
    let k = top_k.unwrap_or(8).clamp(1, 50) as usize;
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;

    let mut stmt = db
        .prepare("SELECT file_path, start_line, end_line, content, embedding FROM embeddings WHERE workspace = ?1")
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, i64, i64, String, Vec<u8>)> = stmt
        .query_map(rusqlite::params![workspace], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Vec<u8>>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut scored: Vec<SearchHit> = rows
        .into_iter()
        .map(|(file, s, e, content, blob)| {
            let emb = blob_to_f32(&blob);
            let score = cosine(&query_embedding, &emb);
            SearchHit {
                file,
                start_line: s as u32,
                end_line: e as u32,
                content,
                score,
            }
        })
        .collect();

    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(k);
    Ok(scored)
}

#[cfg(test)]
mod tests;
