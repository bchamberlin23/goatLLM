use notify::{Config as NotifyConfig, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

pub(crate) struct WatcherRegistry {
    pub(crate) watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct WorkspaceWatchEvent {
    path: String,
    kind: String,
    at: i64,
    diagnostic: Option<String>,
}

#[tauri::command]
pub(crate) fn run_python(code: String) -> Result<String, String> {
    use std::process::Command;
    use std::time::Duration;

    let dir = tempfile::tempdir().map_err(|e| format!("Cannot create temp dir: {}", e))?;
    let py_path = dir.path().join("script.py");
    fs::write(&py_path, &code).map_err(|e| format!("Cannot write script: {}", e))?;

    let mut child = Command::new("python3")
        .arg(py_path.to_str().unwrap_or("script.py"))
        .current_dir(dir.path())
        .env("PYTHONPATH", dir.path().to_str().unwrap_or("."))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "python3 not found. Install Python 3: brew install python3. Error: {}",
                e
            )
        })?;

    let timeout = Duration::from_secs(30);
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().map_err(|e| e.to_string())?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let mut result = String::new();
                if !stdout.is_empty() {
                    result.push_str(&stdout);
                }
                if !stderr.is_empty() {
                    if !result.is_empty() {
                        result.push('\n');
                    }
                    result.push_str(&stderr);
                }
                if result.is_empty() {
                    result = format!("Exit code: {}", status.code().unwrap_or(-1));
                }
                return Ok(result);
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Python script timed out after 30s.".to_string());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("Command error: {}", e)),
        }
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn watch_kind(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Remove(_) => "remove",
        EventKind::Modify(_) => "modify",
        _ => "modify",
    }
}

#[tauri::command]
pub(crate) fn watch_workspace(
    workspace: String,
    app: tauri::AppHandle,
    registry: tauri::State<'_, WatcherRegistry>,
) -> Result<String, String> {
    let path = PathBuf::from(&workspace);
    if !path.is_dir() {
        return Err(format!("Workspace '{}' is not a directory", workspace));
    }

    let mut watchers = registry.watchers.lock().map_err(|e| e.to_string())?;
    if watchers.contains_key(&workspace) {
        return Ok(format!("Already watching {}", workspace));
    }

    let workspace_for_payload = workspace.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            let event = match result {
                Ok(event) => event,
                Err(error) => {
                    let _ = app.emit(
                        "workspace-watch-event",
                        WorkspaceWatchEvent {
                            path: workspace_for_payload.clone(),
                            kind: "modify".to_string(),
                            at: now_millis(),
                            diagnostic: Some(error.to_string()),
                        },
                    );
                    return;
                }
            };

            let kind = watch_kind(&event.kind).to_string();
            for path in event.paths {
                let path_string = path.to_string_lossy().to_string();
                if path_string.contains("/.git/") || path_string.contains("/node_modules/") {
                    continue;
                }
                let _ = app.emit(
                    "workspace-watch-event",
                    WorkspaceWatchEvent {
                        path: path_string,
                        kind: kind.clone(),
                        at: now_millis(),
                        diagnostic: None,
                    },
                );
            }
        },
        NotifyConfig::default(),
    )
    .map_err(|e| format!("Cannot create watcher: {}", e))?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|e| format!("Cannot watch '{}': {}", workspace, e))?;
    watchers.insert(workspace.clone(), watcher);
    Ok(format!("Watching {}", workspace))
}

#[tauri::command]
pub(crate) fn unwatch_workspace(
    workspace: String,
    registry: tauri::State<'_, WatcherRegistry>,
) -> Result<String, String> {
    let mut watchers = registry.watchers.lock().map_err(|e| e.to_string())?;
    if watchers.remove(&workspace).is_some() {
        Ok(format!("Stopped watching {}", workspace))
    } else {
        Ok(format!("No watcher registered for {}", workspace))
    }
}

fn sync_config_string(config: &serde_json::Value, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn sync_blob_path(config: &serde_json::Value) -> Result<PathBuf, String> {
    let prefix = sync_config_string(config, "prefix").unwrap_or_else(|| "goatllm".to_string());
    let provider = sync_config_string(config, "provider").unwrap_or_else(|| "icloud".to_string());
    let file_name = "goatllm-sync.json";
    if provider == "icloud" {
        let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
        let root = home
            .join("Library")
            .join("Mobile Documents")
            .join("com~apple~CloudDocs")
            .join(prefix);
        return Ok(root.join(file_name));
    }
    if let Some(endpoint) = sync_config_string(config, "endpoint") {
        if let Some(local_path) = endpoint.strip_prefix("file://") {
            let bucket =
                sync_config_string(config, "bucket").unwrap_or_else(|| "goatllm".to_string());
            return Ok(PathBuf::from(local_path)
                .join(bucket)
                .join(prefix)
                .join(file_name));
        }
    }
    Err("S3 sync uses HTTP export/import when endpoint is not file://".to_string())
}

fn sync_http_url(config: &serde_json::Value) -> Result<String, String> {
    let endpoint = sync_config_string(config, "endpoint")
        .ok_or_else(|| "S3 endpoint is required".to_string())?;
    let bucket =
        sync_config_string(config, "bucket").ok_or_else(|| "S3 bucket is required".to_string())?;
    let prefix = sync_config_string(config, "prefix").unwrap_or_else(|| "goatllm".to_string());
    Ok(format!(
        "{}/{}/{}/goatllm-sync.json",
        endpoint.trim_end_matches('/'),
        bucket.trim_matches('/'),
        prefix.trim_matches('/'),
    ))
}

#[tauri::command]
pub(crate) fn sync_export_state(
    config: serde_json::Value,
    payload: String,
) -> Result<String, String> {
    let provider = sync_config_string(&config, "provider").unwrap_or_else(|| "icloud".to_string());
    if provider == "s3" {
        if sync_config_string(&config, "endpoint")
            .map(|endpoint| endpoint.starts_with("file://"))
            .unwrap_or(false)
        {
            let path = sync_blob_path(&config)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Cannot create sync dir: {}", e))?;
            }
            fs::write(&path, payload).map_err(|e| format!("Cannot write sync state: {}", e))?;
            return Ok(format!("Exported sync state to {}", path.display()));
        }
        let url = sync_http_url(&config)?;
        let response = reqwest::blocking::Client::new()
            .put(&url)
            .header("content-type", "application/json")
            .body(payload)
            .send()
            .map_err(|e| format!("S3 export failed: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("S3 export failed with {}", response.status()));
        }
        return Ok(format!("Exported sync state to {}", url));
    }

    let path = sync_blob_path(&config)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create sync dir: {}", e))?;
    }
    fs::write(&path, payload).map_err(|e| format!("Cannot write sync state: {}", e))?;
    Ok(format!("Exported sync state to {}", path.display()))
}

#[tauri::command]
pub(crate) fn sync_import_state(config: serde_json::Value) -> Result<String, String> {
    let provider = sync_config_string(&config, "provider").unwrap_or_else(|| "icloud".to_string());
    if provider == "s3" {
        if sync_config_string(&config, "endpoint")
            .map(|endpoint| endpoint.starts_with("file://"))
            .unwrap_or(false)
        {
            let path = sync_blob_path(&config)?;
            return fs::read_to_string(&path).map_err(|e| format!("Cannot read sync state: {}", e));
        }
        let url = sync_http_url(&config)?;
        let response = reqwest::blocking::Client::new()
            .get(&url)
            .send()
            .map_err(|e| format!("S3 import failed: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("S3 import failed with {}", response.status()));
        }
        return response
            .text()
            .map_err(|e| format!("Cannot read S3 response: {}", e));
    }
    let path = sync_blob_path(&config)?;
    fs::read_to_string(&path).map_err(|e| format!("Cannot read sync state: {}", e))
}
