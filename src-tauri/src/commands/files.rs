use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

use super::workspace::{
    check_denylist_ws, get_ws_patterns, resolve_path, resolve_write_path, WorkspaceState,
};

#[derive(Debug, Serialize)]
pub(crate) struct DirEntry {
    name: String,
    is_dir: bool,
    size: u64,
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            std::path::Component::RootDir => normalized.push(component.as_os_str()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                let _ = normalized.pop();
            }
            std::path::Component::Normal(part) => normalized.push(part),
        }
    }
    normalized
}

pub(crate) fn resolve_child_path(
    base: &Path,
    relative: &str,
    label: &str,
) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err(format!("{}: absolute paths are not allowed", label));
    }

    fs::create_dir_all(base).map_err(|e| format!("{}: cannot create base dir: {}", label, e))?;
    let canonical_base =
        fs::canonicalize(base).map_err(|e| format!("{}: cannot resolve base dir: {}", label, e))?;
    let full = normalize_absolute_path(&canonical_base.join(rel));
    if !full.starts_with(&canonical_base) {
        return Err(format!("{}: path escapes base directory", label));
    }

    let check_path = if full.exists() {
        full.clone()
    } else {
        full.parent()
            .map(|x| x.to_path_buf())
            .unwrap_or_else(|| canonical_base.clone())
    };
    let mut existing = check_path.as_path();
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| format!("{}: cannot validate path", label))?;
    }
    let canonical_existing = fs::canonicalize(existing)
        .map_err(|e| format!("{}: cannot validate path: {}", label, e))?;
    if !canonical_existing.starts_with(&canonical_base) {
        return Err(format!("{}: path escapes base directory", label));
    }

    Ok(full)
}

#[tauri::command]
pub(crate) fn write_file(
    workspace: String,
    path: String,
    content: String,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<String, String> {
    let full = resolve_write_path(&workspace, &path)?;
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    check_denylist_ws(&full, &ws_patterns)?;

    // Create parent directories if needed
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent dirs: {}", e))?;
    }

    fs::write(&full, &content).map_err(|e| format!("Cannot write '{}': {}", path, e))?;

    let size = content.len();
    Ok(format!("Wrote {} bytes to {}", size, path))
}

#[tauri::command]
pub(crate) fn delete_file(
    workspace: String,
    path: String,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<String, String> {
    let full = resolve_path(&workspace, &path)?;
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    check_denylist_ws(&full, &ws_patterns)?;

    if full.is_dir() {
        return Err(format!(
            "Cannot delete '{}': directories are not supported",
            path
        ));
    }

    fs::remove_file(&full).map_err(|e| format!("Cannot delete '{}': {}", path, e))?;

    Ok(format!("Deleted {}", path))
}

/// Write to a temp-dir path. Used by the bash-output spillover so a giant
/// `cargo build` log doesn't get lost when truncated. Only allows paths
/// under the OS temp dir or `/tmp` to avoid being a generic absolute-write
/// escape hatch.
#[tauri::command]
pub(crate) fn write_temp_file(path: String, content: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_absolute() {
        return Err(format!(
            "write_temp_file requires an absolute temp path: got '{}'",
            path
        ));
    }

    let normalized = normalize_absolute_path(&p);
    let tmp = fs::canonicalize(std::env::temp_dir()).unwrap_or_else(|_| std::env::temp_dir());
    let tmp_fallback =
        fs::canonicalize("/tmp").unwrap_or_else(|_| std::path::PathBuf::from("/tmp"));
    let allowed_roots = [tmp, tmp_fallback];

    let check_path = if normalized.exists() {
        normalized.clone()
    } else {
        normalized
            .parent()
            .map(|x| x.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from("/"))
    };
    let mut existing = check_path.as_path();
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| format!("Cannot validate temp path '{}'", path))?;
    }
    let canonical_existing =
        fs::canonicalize(existing).map_err(|e| format!("Cannot validate '{}': {}", path, e))?;

    if !allowed_roots
        .iter()
        .any(|root| canonical_existing.starts_with(root))
    {
        return Err(format!(
            "write_temp_file refuses paths outside the temp dir: got '{}', expected under '{}' or /tmp",
            path,
            allowed_roots[0].display()
        ));
    }
    if let Some(dir) = normalized.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Cannot create '{}': {}", dir.display(), e))?;
    }
    fs::write(&normalized, &content).map_err(|e| format!("Cannot write '{}': {}", path, e))?;
    Ok(format!("Wrote {} bytes to {}", content.len(), path))
}

/// Return the OS-level temp directory path.  Used by tools that want to
/// spill big payloads to disk instead of cramming them into the agent's
/// context window.
#[tauri::command]
pub(crate) fn os_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// Return the user's home directory as a string. Used by the skills
/// loader so it can scan well-known skill locations like `~/.goat/skills`.
#[tauri::command]
pub(crate) fn home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot resolve home directory".to_string())
}

/// Return the goatLLM agent dir (`~/.goat/agent` by default). Created on
/// demand so first-run skill copy has somewhere to land.
#[tauri::command]
pub(crate) fn goat_agent_dir() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    let dir = home.join(".goat").join("agent");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create '{}': {}", dir.display(), e))?;
    Ok(dir.to_string_lossy().to_string())
}

/// List entries at an absolute path. Used by the skills loader, which has to
/// reach outside the workspace.
#[tauri::command]
pub(crate) fn list_dir_abs(path: String) -> Result<Vec<DirEntry>, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Ok(vec![]);
    }
    let entries = fs::read_dir(&p).map_err(|e| format!("Cannot list '{}': {}", path, e))?;
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

/// Read a text file at an absolute path. Caps output at 256KB to keep skills
/// from blowing up the system prompt.
#[tauri::command]
pub(crate) fn read_text_file_abs(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    let bytes = fs::read(&p).map_err(|e| format!("Cannot read '{}': {}", path, e))?;
    let max = 256 * 1024;
    let truncated = bytes.len() > max;
    let slice = if truncated { &bytes[..max] } else { &bytes[..] };
    let mut s = String::from_utf8_lossy(slice).to_string();
    if truncated {
        s.push_str("\n\n… [truncated — file exceeds 256KB cap]");
    }
    Ok(s)
}

/// Check whether an absolute path exists. Returns false on any error.
#[tauri::command]
pub(crate) fn path_exists_abs(path: String) -> bool {
    std::path::PathBuf::from(&path).exists()
}

/// Create a directory (and any missing parents) at an absolute path. Used to
/// eagerly provision a design project folder so the file tree shows it before
/// the first file is written.
#[tauri::command]
pub(crate) fn create_dir_abs(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    fs::create_dir_all(&p).map_err(|e| format!("Cannot create '{}': {}", path, e))?;
    Ok(p.to_string_lossy().to_string())
}

/// Recursively copy a directory tree from `src` to `dst`. Used to seed the
/// built-in `impeccable` skill into `~/.goat/agent/skills/impeccable` on
/// first run. Skips entries that already exist at the destination so the
/// user's edits are preserved across upgrades.
#[tauri::command]
pub(crate) fn copy_dir_abs(src: String, dst: String) -> Result<u32, String> {
    let src_path = std::path::PathBuf::from(&src);
    let dst_path = std::path::PathBuf::from(&dst);
    if !src_path.exists() {
        return Err(format!("Source does not exist: {}", src));
    }
    fn copy_recursive(src: &Path, dst: &Path) -> Result<u32, String> {
        let mut count = 0u32;
        if src.is_dir() {
            fs::create_dir_all(dst)
                .map_err(|e| format!("Cannot create '{}': {}", dst.display(), e))?;
            for entry in
                fs::read_dir(src).map_err(|e| format!("Cannot read '{}': {}", src.display(), e))?
            {
                let entry = entry.map_err(|e| format!("Read error: {}", e))?;
                let from = entry.path();
                let to = dst.join(entry.file_name());
                count += copy_recursive(&from, &to)?;
            }
        } else {
            // Don't clobber existing files — preserves user edits.
            if !dst.exists() {
                if let Some(parent) = dst.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Cannot create '{}': {}", parent.display(), e))?;
                }
                fs::copy(src, dst).map_err(|e| {
                    format!(
                        "Cannot copy '{}' → '{}': {}",
                        src.display(),
                        dst.display(),
                        e
                    )
                })?;
                count += 1;
            }
        }
        Ok(count)
    }
    copy_recursive(&src_path, &dst_path)
}

/// Write a file inside the goat agent skills directory (~/.goat/agent/skills/).
/// Only accepts relative paths under that dir — absolute writes and `..`
/// escapes are rejected. Used to seed built-in skills from the frontend.
#[tauri::command]
pub(crate) fn write_skill_file(relative_path: String, content: String) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    let base = home.join(".goat").join("agent").join("skills");
    let full = resolve_child_path(&base, &relative_path, "write_skill_file")?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent: {}", e))?;
    }
    fs::write(&full, &content).map_err(|e| format!("Cannot write: {}", e))?;
    Ok(format!("Wrote {} bytes", content.len()))
}

/// Resolve the path of a Tauri-bundled resource. Used to locate the
/// `resources/skills/impeccable` directory shipped with the app.
#[tauri::command]
pub(crate) fn resource_dir(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {}", e))?;
    let full = base.join(&path);
    Ok(full.to_string_lossy().to_string())
}

pub(crate) mod workspace_files;
pub(crate) use workspace_files::{list_dir, read_file, read_file_bytes};

#[cfg(test)]
mod tests;
