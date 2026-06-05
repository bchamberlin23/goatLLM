use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

use super::files::resolve_child_path;

const WORKSPACES_DIR: &str = "workspaces";
const WORKSPACES_FILE: &str = "workspaces.json";

const DENY_PATTERNS: &[&str] = &[
    "**/.env",
    "**/.git/credentials",
    "**/*.pem",
    "**/*.key",
    "**/id_rsa",
    "**/.ssh/**",
    "**/secrets/**",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceConfig {
    path: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    deny_patterns: Vec<String>,
}

pub(crate) struct WorkspaceState {
    pub(crate) workspaces: Vec<WorkspaceConfig>,
}

fn workspaces_path(app: &tauri::AppHandle) -> PathBuf {
    let data_dir = app.path().app_data_dir().expect("app data dir");
    data_dir.join(WORKSPACES_DIR).join(WORKSPACES_FILE)
}

pub(crate) fn load_workspaces(app: &tauri::AppHandle) -> Vec<WorkspaceConfig> {
    let path = workspaces_path(app);
    if path.exists() {
        if let Ok(json) = fs::read_to_string(&path) {
            // Try new format first (Vec<WorkspaceConfig>)
            if let Ok(configs) = serde_json::from_str::<Vec<WorkspaceConfig>>(&json) {
                return configs;
            }
            // Fall back to old format (Vec<String> of paths)
            if let Ok(list) = serde_json::from_str::<Vec<String>>(&json) {
                return list
                    .into_iter()
                    .map(|path| WorkspaceConfig {
                        path,
                        deny_patterns: Vec::new(),
                    })
                    .collect();
            }
        }
    }
    Vec::new()
}

fn save_workspaces(app: &tauri::AppHandle, workspaces: &[WorkspaceConfig]) {
    let path = workspaces_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string(workspaces).unwrap_or_default());
}

pub(crate) fn resolve_path(workspace: &str, relative: &str) -> Result<PathBuf, String> {
    let ws = Path::new(workspace);
    // Strip workspace prefix if the model passed an absolute path
    let cleaned = strip_workspace_prefix(relative, workspace);
    let resolved = ws.join(&cleaned);
    let canonical = fs::canonicalize(&resolved)
        .map_err(|e| format!("Cannot resolve path '{}': {}", relative, e))?;
    let ws_canonical =
        fs::canonicalize(ws).map_err(|e| format!("Cannot resolve workspace: {}", e))?;

    if !canonical.starts_with(&ws_canonical) {
        return Err(format!(
            "Access denied: '{}' is outside workspace",
            relative
        ));
    }
    Ok(canonical)
}

/// Strip workspace prefix from a path if the model accidentally passed an absolute path.
fn strip_workspace_prefix(path: &str, workspace: &str) -> String {
    let mut result = path.to_string();

    // Repeatedly strip workspace prefix (model may embed it multiple times)
    let mut prev = String::new();
    while prev != result {
        prev = result.clone();
        // Handle "/Users/bench/Desktop/project/src/file.ts"
        let with_slash = format!("{}/", workspace);
        if result.starts_with(&with_slash) {
            result = result[with_slash.len()..].to_string();
            continue;
        }
        if result.starts_with(workspace) && result.len() > workspace.len() {
            result = result[workspace.len()..]
                .trim_start_matches('/')
                .to_string();
            continue;
        }
        // Handle "Users/bench/Desktop/project/src/file.ts" (no leading slash).
        // No length guard — when result equals ws_no_slash the model has
        // embedded the workspace name as the entire remaining path;
        // stripping to "" is correct (the file goes at workspace root).
        let ws_no_slash = workspace.trim_start_matches('/');
        let with_slash_no = format!("{}/", ws_no_slash);
        if result.starts_with(&with_slash_no) {
            result = result[with_slash_no.len()..].to_string();
            continue;
        }
        if result.starts_with(ws_no_slash) {
            result = result[ws_no_slash.len()..]
                .trim_start_matches('/')
                .to_string();
            continue;
        }
    }

    // Belt and suspenders — catch workspace embedded deeper in the path
    // or sitting at the start without a leading slash.
    let ws_no_slash = workspace.trim_start_matches('/');
    let start_needle = format!("{}/", ws_no_slash);
    if result.starts_with(&start_needle) {
        result = result[start_needle.len()..].to_string();
    }
    let mid_needle = format!("/{}/", ws_no_slash);
    while let Some(idx) = result.find(&mid_needle) {
        result = result[idx + mid_needle.len()..].to_string();
    }

    // Remove leading slash for safety
    result.trim_start_matches('/').to_string()
}

/// Resolve a path for writing. Does NOT require the file to exist yet.
/// Canonicalizes the workspace root, then validates the joined path stays within it.
pub(crate) fn resolve_write_path(workspace: &str, relative: &str) -> Result<PathBuf, String> {
    let ws = Path::new(workspace);
    let cleaned = strip_workspace_prefix(relative, workspace);
    resolve_child_path(ws, &cleaned, "resolve_write_path")
        .map_err(|e| format!("Access denied: '{}': {}", relative, e))
}

fn check_patterns(path: &Path, patterns: &[String]) -> Result<(), String> {
    let path_str = path.to_string_lossy();
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    for pattern in patterns {
        let (dir_part, file_pattern) = if let Some(slash) = pattern.rfind('/') {
            (&pattern[..slash], &pattern[slash + 1..])
        } else {
            ("", pattern.as_str())
        };

        if let Ok(g) = glob::Pattern::new(file_pattern) {
            if g.matches(&file_name) {
                if dir_part.is_empty() || dir_part == "**" {
                    return Err(format!(
                        "Access denied: '{}' matches denylist pattern '{}'",
                        path_str, pattern
                    ));
                }
                if path_str.contains(dir_part.trim_start_matches("**/")) {
                    return Err(format!(
                        "Access denied: '{}' matches denylist pattern '{}'",
                        path_str, pattern
                    ));
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn get_ws_patterns(workspace: &str, state: &Mutex<WorkspaceState>) -> Vec<String> {
    if let Ok(ws) = state.lock() {
        if let Some(config) = ws.workspaces.iter().find(|c| c.path == workspace) {
            return config.deny_patterns.clone();
        }
    }
    Vec::new()
}

pub(crate) fn check_denylist_ws(path: &Path, ws_patterns: &[String]) -> Result<(), String> {
    // Check built-in hardcoded patterns first (always enforced)
    check_patterns(
        path,
        &DENY_PATTERNS
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>(),
    )?;
    // Then check workspace-specific patterns
    check_patterns(path, ws_patterns)
}

#[tauri::command]
pub(crate) fn list_workspaces(
    state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<Vec<String>, String> {
    let ws = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut list: Vec<String> = ws.workspaces.iter().map(|c| c.path.clone()).collect();
    list.sort();
    Ok(list)
}

#[tauri::command]
pub(crate) fn add_workspace(
    path: String,
    state: tauri::State<'_, Mutex<WorkspaceState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Invalid path: {}", e))?;
    if !meta.is_dir() {
        return Err(format!("'{}' is not a directory", path));
    }
    if let Ok(mut ws) = state.lock() {
        if !ws.workspaces.iter().any(|c| c.path == path) {
            ws.workspaces.push(WorkspaceConfig {
                path,
                deny_patterns: Vec::new(),
            });
            save_workspaces(&app, &ws.workspaces);
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn remove_workspace(
    path: String,
    state: tauri::State<'_, Mutex<WorkspaceState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if let Ok(mut ws) = state.lock() {
        ws.workspaces.retain(|c| c.path != path);
        save_workspaces(&app, &ws.workspaces);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_workspace_denylist(
    path: String,
    state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<Vec<String>, String> {
    let ws = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let config = ws.workspaces.iter().find(|c| c.path == path);
    match config {
        Some(c) => Ok(c.deny_patterns.clone()),
        None => Ok(DENY_PATTERNS.iter().map(|s| s.to_string()).collect()),
    }
}

#[tauri::command]
pub(crate) fn set_workspace_denylist(
    path: String,
    patterns: Vec<String>,
    state: tauri::State<'_, Mutex<WorkspaceState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if let Ok(mut ws) = state.lock() {
        if let Some(config) = ws.workspaces.iter_mut().find(|c| c.path == path) {
            config.deny_patterns = patterns;
            save_workspaces(&app, &ws.workspaces);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
