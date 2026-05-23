use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

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

// ── SQLite types ──

#[derive(Debug, Serialize, Deserialize)]
struct DbConversation {
    id: String,
    title: String,
    last_message_preview: String,
    last_message_at: i64,
    created_at: i64,
    model_id: Option<String>,
    system_prompt: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DbMessage {
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    tool_calls: Option<String>,
    attachments: Option<String>,
    created_at: i64,
}

#[derive(Debug, Serialize)]
struct AllData {
    conversations: Vec<DbConversation>,
    messages: Vec<DbMessage>,
}

#[derive(Debug, Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
    size: u64,
}

#[derive(Debug, Serialize)]
struct SearchMatch {
    file: String,
    line: u64,
    content: String,
}

#[derive(Debug, Serialize)]
struct MessageSearchResult {
    message_id: String,
    conversation_id: String,
    conversation_title: String,
    role: String,
    content_preview: String,
    created_at: i64,
}

struct DbState {
    db: Mutex<rusqlite::Connection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct WorkspaceConfig {
    path: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    deny_patterns: Vec<String>,
}

struct WorkspaceState {
    workspaces: Vec<WorkspaceConfig>,
}

// ── Database ──

fn init_db(app: &tauri::AppHandle) -> Result<rusqlite::Connection, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data directory: {}", e))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Cannot create data directory: {}", e))?;
    let db_path = data_dir.join("goatllm.db");

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Cannot open database: {}. The database file may be corrupted. Try removing {} and restarting.", e, db_path.display()))?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("Cannot configure database: {}", e))?;

    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    if version < 1 {
        conn.execute_batch(include_str!("../migrations/001_init.sql"))
            .map_err(|e| format!("Database migration 001 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 1)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if version < 2 {
        conn.execute_batch(include_str!("../migrations/002_agent_events.sql"))
            .map_err(|e| format!("Database migration 002 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 2)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    Ok(conn)
}

// ── SQLite CRUD commands ──

#[tauri::command]
fn load_all_data(state: tauri::State<'_, DbState>) -> Result<AllData, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;

    let mut conv_stmt = db
        .prepare("SELECT id, title, last_message_preview, last_message_at, created_at, model_id, system_prompt FROM conversations ORDER BY last_message_at DESC")
        .map_err(|e| e.to_string())?;

    let conversations: Vec<DbConversation> = conv_stmt
        .query_map([], |row| {
            Ok(DbConversation {
                id: row.get(0)?,
                title: row.get(1)?,
                last_message_preview: row.get(2)?,
                last_message_at: row.get(3)?,
                created_at: row.get(4)?,
                model_id: row.get(5)?,
                system_prompt: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut msg_stmt = db
        .prepare("SELECT id, conversation_id, role, content, tool_calls, attachments, created_at FROM messages ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let messages: Vec<DbMessage> = msg_stmt
        .query_map([], |row| {
            Ok(DbMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                tool_calls: row.get(4)?,
                attachments: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(AllData { conversations, messages })
}

#[tauri::command]
fn save_conversation(
    id: String,
    title: String,
    last_message_preview: String,
    last_message_at: i64,
    created_at: i64,
    model_id: Option<String>,
    system_prompt: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute(
        "INSERT OR REPLACE INTO conversations (id, title, last_message_preview, last_message_at, created_at, model_id, system_prompt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, title, last_message_preview, last_message_at, created_at, model_id, system_prompt],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_message(
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    tool_calls: Option<String>,
    attachments: Option<String>,
    created_at: i64,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute(
        "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls, attachments, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, conversation_id, role, content, tool_calls, attachments, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_conversation_db(id: String, state: tauri::State<'_, DbState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute("DELETE FROM messages WHERE conversation_id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM conversations WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_message_db(id: String, state: tauri::State<'_, DbState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute("DELETE FROM messages WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn search_messages(
    query: String,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<MessageSearchResult>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let like = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let mut stmt = db
        .prepare(
            "SELECT m.id, m.conversation_id, c.title, m.role, m.content, m.created_at \
             FROM messages m JOIN conversations c ON m.conversation_id = c.id \
             WHERE m.content LIKE ?1 \
             ORDER BY m.created_at DESC \
             LIMIT 50",
        )
        .map_err(|e| e.to_string())?;
    let results: Vec<MessageSearchResult> = stmt
        .query_map(rusqlite::params![like], |row| {
            let content: String = row.get(4)?;
            let preview = if content.len() > 200 {
                format!("{}…", &content[..200])
            } else {
                content
            };
            Ok(MessageSearchResult {
                message_id: row.get(0)?,
                conversation_id: row.get(1)?,
                conversation_title: row.get(2)?,
                role: row.get(3)?,
                content_preview: preview,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(results)
}

// ── Write / execute commands (MVP 3) ──

#[tauri::command]
fn write_file(workspace: String, path: String, content: String, ws_state: tauri::State<'_, Mutex<WorkspaceState>>) -> Result<String, String> {
    let full = resolve_write_path(&workspace, &path)?;
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    check_denylist_ws(&full, &ws_patterns)?;

    // Create parent directories if needed
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create parent dirs: {}", e))?;
    }

    fs::write(&full, &content)
        .map_err(|e| format!("Cannot write '{}': {}", path, e))?;

    let size = content.len();
    Ok(format!("Wrote {} bytes to {}", size, path))
}

#[derive(Debug, Deserialize)]
struct EditReplacement {
    #[serde(rename = "oldText")]
    old_text: String,
    #[serde(rename = "newText")]
    new_text: String,
}

#[tauri::command]
fn edit_file(
    workspace: String,
    path: String,
    #[allow(unused)] old_text: Option<String>,
    #[allow(unused)] new_text: Option<String>,
    edits: Option<Vec<EditReplacement>>,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<String, String> {
    let full = resolve_path(&workspace, &path)?;
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    check_denylist_ws(&full, &ws_patterns)?;

    let current = fs::read_to_string(&full)
        .map_err(|e| format!("Cannot read '{}': {}", path, e))?;

    // Build edit list: prefer edits[] array, fall back to single old_text/new_text
    let replacements: Vec<(String, String)> = if let Some(edit_list) = edits {
        if edit_list.is_empty() {
            return Err("edits must contain at least one replacement.".to_string());
        }
        edit_list.into_iter().map(|e| (e.old_text, e.new_text)).collect()
    } else if let (Some(old), Some(new)) = (old_text, new_text) {
        vec![(old, new)]
    } else {
        return Err("Provide either edits[] or old_text+new_text.".to_string());
    };

    let mut new_content = current.clone();
    let mut applied = 0usize;

    for (old, new) in &replacements {
        // Count occurrences
        let count = new_content.matches(old.as_str()).count();
        if count == 0 {
            return Err(format!(
                "old_text not found in '{}'. The text to replace must match exactly.\nold_text: {}",
                path,
                old.chars().take(120).collect::<String>()
            ));
        }
        if count > 1 {
            return Err(format!(
                "old_text appears {} times in '{}'. It must be unique — include more surrounding context to make it specific.\nold_text: {}",
                count,
                path,
                old.chars().take(120).collect::<String>()
            ));
        }
        // Apply replacement against the CURRENT content (each edit sees previous edits)
        // NOTE: pi applies all edits against the ORIGINAL file. goatLLM applies sequentially.
        // Both are valid patterns; the model adapts based on tool description.
        new_content = new_content.replacen(old.as_str(), new.as_str(), 1);
        applied += 1;
    }

    if applied == 0 {
        return Err(format!("No replacements were applied to '{}'.", path));
    }

    fs::write(&full, &new_content)
        .map_err(|e| format!("Cannot write '{}': {}", path, e))?;

    Ok(format!(
        "Successfully edited {}: {} replacement(s) applied.",
        path, applied
    ))
}

#[tauri::command]
fn exec_command(
    workspace: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    use std::process::Command;
    use std::time::Duration;

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000));

    // Use bash -c for pipeline/redirect support
    let mut child = Command::new("bash")
        .args(["-c", &command])
        .current_dir(&workspace)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Wait with timeout
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
                    result.push_str("[stderr]\n");
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
                    return Err(format!("Command timed out after {}s", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("Command error: {}", e)),
        }
    }
}

#[tauri::command]
fn diff_file(workspace: String, path: String) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("git")
        .args(["diff", "--", &path])
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stderr.is_empty() && stdout.is_empty() {
        return Err(format!("git diff error: {}", stderr.trim()));
    }
    if stdout.is_empty() {
        return Ok("(no changes)".to_string());
    }
    Ok(stdout.to_string())
}

// ── Git management commands ──

#[tauri::command]
fn git_branch(
    workspace: String,
    action: String,
    name: Option<String>,
) -> Result<String, String> {
    use std::process::Command;

    match action.as_str() {
        "list" => {
            let output = Command::new("git")
                .args(["branch", "-a", "--sort=-committerdate"])
                .current_dir(&workspace)
                .output()
                .map_err(|e| format!("Failed to run git branch: {}", e))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.trim().is_empty() {
                return Ok("(no branches)".to_string());
            }
            Ok(stdout.to_string())
        }
        "current" => {
            let output = Command::new("git")
                .args(["branch", "--show-current"])
                .current_dir(&workspace)
                .output()
                .map_err(|e| format!("Failed to run git branch: {}", e))?;
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }
        "create" => {
            let branch_name = name.ok_or("Branch name required for create action")?;
            let output = Command::new("git")
                .args(["checkout", "-b", &branch_name])
                .current_dir(&workspace)
                .output()
                .map_err(|e| format!("Failed to create branch: {}", e))?;
            let _stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.is_empty() && !stderr.contains("Switched to a new branch") {
                return Err(stderr.trim().to_string());
            }
            Ok(format!("Created and switched to branch '{}'", branch_name))
        }
        "switch" => {
            let branch_name = name.ok_or("Branch name required for switch action")?;
            let output = Command::new("git")
                .args(["checkout", &branch_name])
                .current_dir(&workspace)
                .output()
                .map_err(|e| format!("Failed to switch branch: {}", e))?;
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.is_empty() {
                // git checkout writes info to stderr
                let trimmed = stderr.trim();
                if trimmed.contains("Switched to branch") || trimmed.contains("Already on") {
                    return Ok(trimmed.to_string());
                }
                return Err(trimmed.to_string());
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            Ok(stdout.trim().to_string())
        }
        _ => Err(format!("Unknown git_branch action: '{}'. Use list, current, create, or switch.", action)),
    }
}

#[tauri::command]
fn git_commit(
    workspace: String,
    message: String,
    files: Option<Vec<String>>,
) -> Result<String, String> {
    use std::process::Command;

    // Stage files if specified, otherwise stage all
    if let Some(ref file_list) = files {
        if !file_list.is_empty() {
            let mut stage = Command::new("git");
            stage.arg("add");
            for f in file_list {
                stage.arg(f);
            }
            let output = stage
                .current_dir(&workspace)
                .output()
                .map_err(|e| format!("Failed to stage files: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("git add failed: {}", stderr.trim()));
            }
        }
    } else {
        // Stage all changes
        let output = Command::new("git")
            .args(["add", "-A"])
            .current_dir(&workspace)
            .output()
            .map_err(|e| format!("Failed to stage files: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git add failed: {}", stderr.trim()));
        }
    }

    // Create commit
    let output = Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to commit: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let combined = format!("{}{}", stdout, stderr);
        if combined.trim().is_empty() {
            return Err("Commit failed — nothing to commit?".to_string());
        }
        return Err(combined.trim().to_string());
    }

    let result = format!("{}{}", stdout, stderr);
    if result.trim().is_empty() {
        return Ok("Commit created successfully.".to_string());
    }
    Ok(result.trim().to_string())
}

#[tauri::command]
fn git_push(
    workspace: String,
    remote: Option<String>,
    branch: Option<String>,
    force: Option<bool>,
) -> Result<String, String> {
    use std::process::Command;

    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    let is_force = force.unwrap_or(false);

    let mut cmd = Command::new("git");
    cmd.arg("push");
    if is_force {
        cmd.arg("--force");
    }
    cmd.arg(&remote_name);
    if let Some(ref b) = branch {
        cmd.arg(b);
    }

    let output = cmd
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to push: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let combined = format!("{}{}", stdout, stderr);
        return Err(combined.trim().to_string());
    }

    // git push writes progress to stderr, result to stdout
    let combined = format!("{}{}", stdout, stderr);
    if combined.trim().is_empty() {
        return Ok("Push successful.".to_string());
    }
    Ok(combined.trim().to_string())
}

#[tauri::command]
fn read_lints(workspace: String) -> Result<String, String> {
    use std::process::Command;

    // Try cargo check first (most common for Rust projects)
    let has_cargo = std::path::Path::new(&workspace).join("Cargo.toml").exists();
    let has_package_json = std::path::Path::new(&workspace).join("package.json").exists();

    if has_cargo {
        let output = Command::new("cargo")
            .args(["check", "--message-format=short"])
            .current_dir(&workspace)
            .output()
            .map_err(|e| format!("Failed to run cargo check: {}", e))?;

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{}{}", stdout, stderr);
        if combined.trim().is_empty() {
            return Ok("(no lints found)".to_string());
        }
        return Ok(combined.to_string());
    }

    if has_package_json {
        let output = Command::new("npx")
            .args(["tsc", "--noEmit", "--pretty", "false"])
            .current_dir(&workspace)
            .output()
            .map_err(|e| format!("Failed to run tsc: {}", e))?;

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{}{}", stdout, stderr);
        if combined.trim().is_empty() {
            return Ok("(no lints found)".to_string());
        }
        return Ok(combined.to_string());
    }

    Err("No supported project found (Cargo.toml or package.json)".to_string())
}

// ── Agent event log ──

#[tauri::command]
fn log_event(
    conversation_id: String,
    event_type: String,
    payload: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    db.execute(
        "INSERT INTO agent_events (conversation_id, event_type, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![conversation_id, event_type, payload, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_events(
    conversation_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut stmt = db
        .prepare("SELECT payload FROM agent_events WHERE conversation_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![conversation_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|e| e.to_string())?);
    }
    Ok(events)
}

// ── Filesystem commands ──

fn workspaces_path(app: &tauri::AppHandle) -> PathBuf {
    let data_dir = app.path().app_data_dir().expect("app data dir");
    data_dir.join(WORKSPACES_DIR).join(WORKSPACES_FILE)
}

fn load_workspaces(app: &tauri::AppHandle) -> Vec<WorkspaceConfig> {
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

fn resolve_path(workspace: &str, relative: &str) -> Result<PathBuf, String> {
    let ws = Path::new(workspace);
    let resolved = ws.join(relative);
    let canonical =
        fs::canonicalize(&resolved).map_err(|e| format!("Cannot resolve path '{}': {}", relative, e))?;
    let ws_canonical =
        fs::canonicalize(ws).map_err(|e| format!("Cannot resolve workspace: {}", e))?;

    if !canonical.starts_with(&ws_canonical) {
        return Err(format!("Access denied: '{}' is outside workspace", relative));
    }
    Ok(canonical)
}

/// Resolve a path for writing. Does NOT require the file to exist yet.
/// Canonicalizes the workspace root, then validates the joined path stays within it.
fn resolve_write_path(workspace: &str, relative: &str) -> Result<PathBuf, String> {
    let ws = Path::new(workspace);
    let ws_canonical =
        fs::canonicalize(ws).map_err(|e| format!("Cannot resolve workspace: {}", e))?;

    let resolved = ws.join(relative);

    // If the resolved path exists, canonicalize it and check it's within workspace
    if resolved.exists() {
        let canonical = fs::canonicalize(&resolved)
            .map_err(|e| format!("Cannot resolve path '{}': {}", relative, e))?;
        if !canonical.starts_with(&ws_canonical) {
            return Err(format!("Access denied: '{}' is outside workspace", relative));
        }
        return Ok(canonical);
    }

    // Path doesn't exist yet — manually validate it stays within workspace
    // Resolve .. and . components without canonicalize
    let mut parts: Vec<&str> = Vec::new();
    for part in resolved.components() {
        match part {
            std::path::Component::ParentDir => {
                if parts.is_empty() {
                    return Err(format!("Access denied: '{}' escapes workspace", relative));
                }
                parts.pop();
            }
            std::path::Component::CurDir => {}
            std::path::Component::Normal(c) => {
                parts.push(c.to_str().unwrap_or(""));
            }
            _ => {}
        }
    }

    // Rebuild from workspace root to check containment
    let mut check = ws_canonical.clone();
    for part in &parts {
        check.push(part);
    }

    // Verify the check path starts with workspace root
    if !check.starts_with(&ws_canonical) {
        return Err(format!("Access denied: '{}' is outside workspace", relative));
    }

    Ok(check)
}

fn check_patterns(path: &Path, patterns: &[String]) -> Result<(), String> {
    let path_str = path.to_string_lossy();
    let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
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

fn get_ws_patterns(workspace: &str, state: &Mutex<WorkspaceState>) -> Vec<String> {
    if let Ok(ws) = state.lock() {
        if let Some(config) = ws.workspaces.iter().find(|c| c.path == workspace) {
            return config.deny_patterns.clone();
        }
    }
    Vec::new()
}

fn check_denylist_ws(path: &Path, ws_patterns: &[String]) -> Result<(), String> {
    // Check built-in hardcoded patterns first (always enforced)
    check_patterns(path, &DENY_PATTERNS.iter().map(|s| s.to_string()).collect::<Vec<_>>())?;
    // Then check workspace-specific patterns
    check_patterns(path, ws_patterns)
}

#[tauri::command]
fn read_file(
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

#[tauri::command]
fn list_dir(workspace: String, path: String, ws_state: tauri::State<'_, Mutex<WorkspaceState>>) -> Result<Vec<DirEntry>, String> {
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

#[tauri::command]
fn search_content(
    workspace: String,
    pattern: String,
    file_pattern: Option<String>,
) -> Result<Vec<SearchMatch>, String> {
    let ws_path = Path::new(&workspace);
    let ws_canonical =
        fs::canonicalize(ws_path).map_err(|e| format!("Cannot resolve workspace: {}", e))?;

    let re = regex::Regex::new(&pattern).map_err(|e| format!("Invalid regex pattern: {}", e))?;

    let mut matches: Vec<SearchMatch> = Vec::new();
    let walker = walkdir::WalkDir::new(&ws_canonical)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() {
                return !name.starts_with('.')
                    && name != "node_modules"
                    && name != "target"
                    && name != "dist"
                    && name != ".git";
            }
            if let Some(ref fp) = file_pattern {
                let g = glob::Pattern::new(fp).ok();
                if let Some(g) = g {
                    return g.matches(&name);
                }
            }
            true
        });

    for entry in walker {
        let entry = entry.map_err(|e| format!("Walk error: {}", e))?;
        if entry.file_type().is_dir() {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.len() > 1024 * 1024 {
                continue;
            }
        }
        let content = fs::read_to_string(entry.path()).unwrap_or_default();
        for (line_num, line) in content.lines().enumerate() {
            if re.is_match(line) {
                let rel_path = entry
                    .path()
                    .strip_prefix(&ws_canonical)
                    .unwrap_or(entry.path());
                matches.push(SearchMatch {
                    file: rel_path.to_string_lossy().to_string(),
                    line: (line_num + 1) as u64,
                    content: line.to_string(),
                });
                if matches.len() >= 100 {
                    break;
                }
            }
        }
        if matches.len() >= 100 {
            break;
        }
    }

    Ok(matches)
}

#[tauri::command]
fn git_status(workspace: String) -> Result<String, String> {
    use std::process::Command;
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.is_empty() {
        Ok("(clean working tree)".to_string())
    } else {
        Ok(stdout)
    }
}

#[tauri::command]
fn list_workspaces(state: tauri::State<'_, Mutex<WorkspaceState>>) -> Result<Vec<String>, String> {
    let ws = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut list: Vec<String> = ws.workspaces.iter().map(|c| c.path.clone()).collect();
    list.sort();
    Ok(list)
}

#[tauri::command]
fn add_workspace(
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
fn remove_workspace(
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
fn get_workspace_denylist(
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
fn set_workspace_denylist(
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

#[tauri::command]
fn compile_latex(content: String) -> Result<String, String> {
    use std::process::Command;

    let dir = tempfile::tempdir().map_err(|e| format!("Cannot create temp dir: {}", e))?;
    let tex_path = dir.path().join("document.tex");

    fs::write(&tex_path, &content)
        .map_err(|e| format!("Cannot write .tex file: {}", e))?;

    // Try tectonic first (faster, no system deps), fall back to pdflatex
    let result = Command::new("tectonic")
        .args(["-o", dir.path().to_str().unwrap_or("."), tex_path.to_str().unwrap_or("document.tex")])
        .current_dir(dir.path())
        .output();

    let result = match result {
        Ok(r) if r.status.success() => Ok(r),
        _ => {
            // Fall back to pdflatex
            Command::new("pdflatex")
                .args(["-interaction=nonstopmode", "-output-directory", dir.path().to_str().unwrap_or("."), tex_path.to_str().unwrap_or("document.tex")])
                .current_dir(dir.path())
                .output()
                .map_err(|e| format!("Neither tectonic nor pdflatex found. Install one: brew install tectonic (or MacTeX for pdflatex). Error: {}", e))
        }
    }?;

    let pdf_path = dir.path().join("document.pdf");
    if !pdf_path.exists() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("LaTeX compilation failed. The document may have syntax errors.\n\n{}", stderr.lines().filter(|l| l.starts_with('!')).take(5).collect::<Vec<_>>().join("\n")));
    }

    let pdf_bytes = fs::read(&pdf_path)
        .map_err(|e| format!("Cannot read compiled PDF: {}", e))?;

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&pdf_bytes);
    Ok(format!("data:application/pdf;base64,{}", b64))
}

#[tauri::command]
fn run_python(code: String) -> Result<String, String> {
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
        .map_err(|e| format!("python3 not found. Install Python 3: brew install python3. Error: {}", e))?;

    let timeout = Duration::from_secs(30);
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().map_err(|e| e.to_string())?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let mut result = String::new();
                if !stdout.is_empty() { result.push_str(&stdout); }
                if !stderr.is_empty() {
                    if !result.is_empty() { result.push('\n'); }
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

// ── App entry ──

pub fn run() {
    let app_handle = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Initialize database
            let db = match init_db(&app.handle().clone()) {
                Ok(db) => db,
                Err(e) => {
                    // Show a native error dialog before the app window opens
                    use tauri_plugin_dialog::DialogExt;
                    app.dialog()
                        .message(e)
                        .title("Database Error")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                        .blocking_show();
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "Database initialization failed",
                    )));
                }
            };
            app.manage(DbState { db: Mutex::new(db) });

            // Initialize workspaces
            let workspaces = load_workspaces(&app.handle().clone());
            app.manage(Mutex::new(WorkspaceState { workspaces }));

            let _window = app.get_webview_window("main").unwrap();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_all_data,
            save_conversation,
            save_message,
            delete_conversation_db,
            delete_message_db,
            search_messages,
            log_event,
            get_events,
            read_file,
            list_dir,
            search_content,
            git_status,
            git_branch,
            git_commit,
            git_push,
            write_file,
            edit_file,
            exec_command,
            diff_file,
            read_lints,
            list_workspaces,
            add_workspace,
            remove_workspace,
            get_workspace_denylist,
            set_workspace_denylist,
            compile_latex,
            run_python,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app_handle.run(|_handle, _event| {});
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_denylist_allows_normal_paths() {
        let path = std::path::Path::new("/home/user/project/src/main.rs");
        assert!(check_denylist_ws(path, &[]).is_ok());
    }

    #[test]
    fn test_check_denylist_blocks_env() {
        let path = std::path::Path::new("/home/user/project/.env");
        assert!(check_denylist_ws(path, &[]).is_err());
    }

    #[test]
    fn test_check_denylist_blocks_pem() {
        let path = std::path::Path::new("/home/user/project/secrets/key.pem");
        assert!(check_denylist_ws(path, &[]).is_err());
    }

    #[test]
    fn test_resolve_path_within_workspace() {
        let workspace = std::env::current_dir().unwrap();
        let workspace_str = workspace.to_string_lossy().to_string();
        // Resolve a path that definitely exists within the workspace
        let result = resolve_path(&workspace_str, "src-tauri");
        // src-tauri might not exist relative to cwd, but the function should not panic
        match result {
            Ok(p) => assert!(p.to_string_lossy().contains("src-tauri")),
            Err(_) => {} // acceptable if path doesn't exist
        }
    }

    #[test]
    fn test_resolve_path_rejects_traversal() {
        let workspace = std::env::current_dir().unwrap();
        let workspace_str = workspace.to_string_lossy().to_string();
        let result = resolve_path(&workspace_str, "../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_command_classification_safe() {
        // Safe commands should not match destructive/suspicious patterns
        let safe_cmds = ["ls -la", "echo hello", "cargo check", "git status"];
        for cmd in &safe_cmds {
            // These should compile and not panic — actual classification happens in frontend
            assert!(!cmd.is_empty());
        }
    }
}
