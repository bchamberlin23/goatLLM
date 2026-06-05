use std::fs;
use std::sync::Mutex;

use super::super::workspace::{check_denylist_ws, get_ws_patterns, resolve_path, WorkspaceState};
use super::DirEntry;

#[tauri::command]
pub(crate) fn read_file(
    workspace: String,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<String, String> {
    let full = resolve_path(&workspace, &path)?;
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    check_denylist_ws(&full, &ws_patterns)?;

    let content =
        fs::read_to_string(&full).map_err(|e| format!("Cannot read '{}': {}", path, e))?;

    let lines: Vec<&str> = content.lines().collect();
    let start = offset.unwrap_or(0);
    let end = limit
        .map(|l| std::cmp::min(start + l, lines.len()))
        .unwrap_or(lines.len());

    if start >= lines.len() {
        return Ok(String::new());
    }

    Ok(lines[start..end].join("\n"))
}

/// Read a workspace file as a base64 data URL. Used by the workspace file
/// browser to preview binary assets (images, PDFs, fonts) that don't fit the
/// text-based read_file path. Capped at 25MB to avoid OOM on huge blobs.
#[tauri::command]
pub(crate) fn read_file_bytes(
    workspace: String,
    path: String,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<String, String> {
    use base64::Engine;
    const MAX_BYTES: u64 = 25 * 1024 * 1024;

    let full = resolve_path(&workspace, &path)?;
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    check_denylist_ws(&full, &ws_patterns)?;

    let metadata = fs::metadata(&full).map_err(|e| format!("Cannot stat '{}': {}", path, e))?;
    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "File too large to preview: {:.1} MB (max 25 MB)",
            metadata.len() as f64 / 1024.0 / 1024.0
        ));
    }

    let bytes = fs::read(&full).map_err(|e| format!("Cannot read '{}': {}", path, e))?;
    let mime = guess_mime_type(&path);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Best-effort MIME type guess from filename extension. Used by
/// read_file_bytes for the data URL prefix.
fn guess_mime_type(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub(crate) fn list_dir(
    workspace: String,
    path: String,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<Vec<DirEntry>, String> {
    let full = resolve_path(&workspace, &path)?;
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    check_denylist_ws(&full, &ws_patterns)?;

    let entries = fs::read_dir(&full).map_err(|e| format!("Cannot list '{}': {}", path, e))?;

    let mut result: Vec<DirEntry> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Read error: {}", e))?;
        let metadata = entry.metadata().ok();
        result.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
            size: metadata.map(|m| m.len()).unwrap_or(0),
        });
    }
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(result)
}
