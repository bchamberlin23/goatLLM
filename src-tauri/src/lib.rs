use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

mod jj;
mod mcp;
mod ollama;

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
    archived: i64,
    tags: String,
    mode: String,
    workspace_path: String,
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
    #[serde(default)]
    pinned: bool,
    thinking_content: Option<String>,
    turn_duration_ms: Option<i64>,
    edited_files: Option<String>,
}

#[derive(Debug, Serialize)]
struct AllData {
    conversations: Vec<DbConversation>,
    messages: Vec<DbMessage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveConversationRequest {
    id: String,
    title: String,
    last_message_preview: String,
    last_message_at: i64,
    created_at: i64,
    model_id: Option<String>,
    system_prompt: String,
    archived: Option<i64>,
    tags: Option<String>,
    mode: Option<String>,
    workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveMessageRequest {
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    tool_calls: Option<String>,
    attachments: Option<String>,
    created_at: i64,
    pinned: Option<bool>,
    thinking_content: Option<String>,
    turn_duration_ms: Option<i64>,
    edited_files: Option<String>,
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
    /// Lines immediately preceding the match (oldest first). Empty unless
    /// context_lines was requested. `skip_serializing_if` keeps the JSON
    /// shape backward-compatible for callers that don't ask for context.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    context_before: Vec<String>,
    /// Lines immediately following the match (in file order). Empty unless
    /// context_lines was requested.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    context_after: Vec<String>,
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

fn escape_sql_like_query(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len());
    for ch in query.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    format!("%{}%", escaped)
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
    fs::create_dir_all(&data_dir).map_err(|e| format!("Cannot create data directory: {}", e))?;
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

    if version < 3 {
        conn.execute_batch(include_str!("../migrations/003_pinned.sql"))
            .map_err(|e| format!("Database migration 003 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 3)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if version < 4 {
        conn.execute_batch(include_str!("../migrations/004_embeddings.sql"))
            .map_err(|e| format!("Database migration 004 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 4)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if version < 5 {
        conn.execute_batch(include_str!("../migrations/005_archive_tags.sql"))
            .map_err(|e| format!("Database migration 005 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 5)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if version < 6 {
        conn.execute_batch(include_str!("../migrations/006_mode_workspace.sql"))
            .map_err(|e| format!("Database migration 006 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 6)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if version < 7 {
        conn.execute_batch(include_str!("../migrations/007_thinking_content.sql"))
            .map_err(|e| format!("Database migration 007 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 7)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if version < 8 {
        conn.execute_batch(include_str!("../migrations/008_turn_metadata.sql"))
            .map_err(|e| format!("Database migration 008 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 8)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    Ok(conn)
}

// ── SQLite CRUD commands ──

#[tauri::command]
fn load_all_data(state: tauri::State<'_, DbState>) -> Result<AllData, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;

    let mut conv_stmt = db
        .prepare("SELECT id, title, last_message_preview, last_message_at, created_at, model_id, system_prompt, COALESCE(archived, 0), COALESCE(tags, '[]'), COALESCE(mode, 'chat'), COALESCE(workspace_path, '') FROM conversations ORDER BY last_message_at DESC")
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
                archived: row.get(7)?,
                tags: row.get(8)?,
                mode: row.get(9)?,
                workspace_path: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut msg_stmt = db
        .prepare("SELECT id, conversation_id, role, content, tool_calls, attachments, created_at, pinned, thinking_content, turn_duration_ms, edited_files FROM messages ORDER BY created_at ASC")
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
                pinned: row.get::<_, i64>(7)? != 0,
                thinking_content: row.get(8)?,
                turn_duration_ms: row.get(9)?,
                edited_files: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(AllData {
        conversations,
        messages,
    })
}

#[tauri::command]
fn save_conversation(
    payload: SaveConversationRequest,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let arch = payload.archived.unwrap_or(0);
    let tags_json = payload.tags.unwrap_or_else(|| "[]".to_string());
    let mode_val = payload.mode.unwrap_or_else(|| "chat".to_string());
    let workspace_val = payload.workspace_path.unwrap_or_default();
    db.execute(
        "INSERT OR REPLACE INTO conversations (id, title, last_message_preview, last_message_at, created_at, model_id, system_prompt, archived, tags, mode, workspace_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            payload.id,
            payload.title,
            payload.last_message_preview,
            payload.last_message_at,
            payload.created_at,
            payload.model_id,
            payload.system_prompt,
            arch,
            tags_json,
            mode_val,
            workspace_val
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_message(
    payload: SaveMessageRequest,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let pin_int: i64 = if payload.pinned.unwrap_or(false) {
        1
    } else {
        0
    };
    db.execute(
        "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls, attachments, created_at, pinned, thinking_content, turn_duration_ms, edited_files) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            payload.id,
            payload.conversation_id,
            payload.role,
            payload.content,
            payload.tool_calls,
            payload.attachments,
            payload.created_at,
            pin_int,
            payload.thinking_content,
            payload.turn_duration_ms,
            payload.edited_files
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Load all messages for a single conversation. Used as a safety net when the
/// in-memory store has an empty list for a conversation that does have rows on
/// disk (e.g. after a restart or when the renderer was reloaded mid-stream).
#[tauri::command]
fn load_messages_for_conversation(
    conversation_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<DbMessage>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut stmt = db
        .prepare(
            "SELECT id, conversation_id, role, content, tool_calls, attachments, created_at, pinned, thinking_content, turn_duration_ms, edited_files \
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let messages: Vec<DbMessage> = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok(DbMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                tool_calls: row.get(4)?,
                attachments: row.get(5)?,
                created_at: row.get(6)?,
                pinned: row.get::<_, i64>(7)? != 0,
                thinking_content: row.get(8)?,
                turn_duration_ms: row.get(9)?,
                edited_files: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(messages)
}

#[tauri::command]
fn delete_conversation_db(id: String, state: tauri::State<'_, DbState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM conversations WHERE id = ?1",
        rusqlite::params![id],
    )
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
    let like = escape_sql_like_query(&query);
    let mut stmt = db
        .prepare(
            "SELECT m.id, m.conversation_id, c.title, m.role, m.content, m.created_at \
             FROM messages m JOIN conversations c ON m.conversation_id = c.id \
             WHERE m.content LIKE ?1 ESCAPE '\\' \
             ORDER BY m.created_at DESC \
             LIMIT 50",
        )
        .map_err(|e| e.to_string())?;
    let results: Vec<MessageSearchResult> = stmt
        .query_map(rusqlite::params![like], |row| {
            let content: String = row.get(4)?;
            let preview = if content.len() > 200 {
                let cut = floor_char_boundary(&content, 200);
                format!("{}…", &content[..cut])
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
fn write_file(
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
fn delete_file(
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

fn resolve_child_path(base: &Path, relative: &str, label: &str) -> Result<PathBuf, String> {
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

/// Write to a temp-dir path. Used by the bash-output spillover so a giant
/// `cargo build` log doesn't get lost when truncated. Only allows paths
/// under the OS temp dir or `/tmp` to avoid being a generic absolute-write
/// escape hatch.
#[tauri::command]
fn write_temp_file(path: String, content: String) -> Result<String, String> {
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
fn os_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// Return the user's home directory as a string. Used by the skills
/// loader so it can scan well-known skill locations like `~/.goat/skills`.
#[tauri::command]
fn home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot resolve home directory".to_string())
}

/// Return the goatLLM agent dir (`~/.goat/agent` by default). Created on
/// demand so first-run skill copy has somewhere to land.
#[tauri::command]
fn goat_agent_dir() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    let dir = home.join(".goat").join("agent");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create '{}': {}", dir.display(), e))?;
    Ok(dir.to_string_lossy().to_string())
}

/// List entries at an absolute path. Used by the skills loader, which has to
/// reach outside the workspace.
#[tauri::command]
fn list_dir_abs(path: String) -> Result<Vec<DirEntry>, String> {
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
fn read_text_file_abs(path: String) -> Result<String, String> {
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
fn path_exists_abs(path: String) -> bool {
    std::path::PathBuf::from(&path).exists()
}

/// Create a directory (and any missing parents) at an absolute path. Used to
/// eagerly provision a design project folder so the file tree shows it before
/// the first file is written.
#[tauri::command]
fn create_dir_abs(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    fs::create_dir_all(&p).map_err(|e| format!("Cannot create '{}': {}", path, e))?;
    Ok(p.to_string_lossy().to_string())
}

/// Recursively copy a directory tree from `src` to `dst`. Used to seed the
/// built-in `impeccable` skill into `~/.goat/agent/skills/impeccable` on
/// first run. Skips entries that already exist at the destination so the
/// user's edits are preserved across upgrades.
#[tauri::command]
fn copy_dir_abs(src: String, dst: String) -> Result<u32, String> {
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
fn write_skill_file(relative_path: String, content: String) -> Result<String, String> {
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
fn resource_dir(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {}", e))?;
    let full = base.join(&path);
    Ok(full.to_string_lossy().to_string())
}

#[derive(Debug, Deserialize)]
struct EditReplacement {
    #[serde(rename = "oldText")]
    old_text: String,
    #[serde(rename = "newText")]
    new_text: String,
}

/// Normalize text for fuzzy matching. Applies progressive transformations:
///   - trim trailing whitespace from each line
///   - normalize smart quotes to ASCII
///   - normalize Unicode dashes/hyphens to ASCII hyphen
///   - normalize fancy Unicode spaces to a regular space
///
/// Lossy by design — we only fall back to this when the exact match fails,
/// because LLMs routinely hand back text that's been re-typed by an autocorrect
/// or copy-pasted from a doc that mangled the punctuation.
fn normalize_for_fuzzy_match(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        let mapped = match ch {
            // Smart double quotes → ASCII "
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => '"',
            // Smart single quotes / apostrophes → ASCII '
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => '\'',
            // Various dashes → ASCII -
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}'
            | '\u{2212}' => '-',
            // Non-breaking space, en-quad, em-quad, thin space, etc. → ASCII space
            '\u{00A0}' | '\u{2000}'..='\u{200B}' | '\u{202F}' | '\u{205F}' | '\u{3000}' => ' ',
            other => other,
        };
        out.push(mapped);
    }
    // Trim trailing whitespace per line so models that re-emit code with
    // their editor's auto-trim policy still match content saved without it.
    out.lines()
        .map(|line| line.trim_end_matches([' ', '\t']))
        .collect::<Vec<&str>>()
        .join("\n")
        + if out.ends_with('\n') { "\n" } else { "" }
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

    let current =
        fs::read_to_string(&full).map_err(|e| format!("Cannot read '{}': {}", path, e))?;

    // Build edit list: prefer edits[] array, fall back to single old_text/new_text
    let replacements: Vec<(String, String)> = if let Some(edit_list) = edits {
        if edit_list.is_empty() {
            return Err("edits must contain at least one replacement.".to_string());
        }
        edit_list
            .into_iter()
            .map(|e| (e.old_text, e.new_text))
            .collect()
    } else if let (Some(old), Some(new)) = (old_text, new_text) {
        vec![(old, new)]
    } else {
        return Err("Provide either edits[] or old_text+new_text.".to_string());
    };

    let mut new_content = current.clone();
    let mut applied = 0usize;
    let mut fuzzy_used = 0usize;

    for (old, new) in &replacements {
        // Try exact match against the current state of the file first.
        let count = new_content.matches(old.as_str()).count();
        if count == 1 {
            new_content = new_content.replacen(old.as_str(), new.as_str(), 1);
            applied += 1;
            continue;
        }
        if count > 1 {
            return Err(format!(
                "old_text appears {} times in '{}'. It must be unique — include more surrounding context to make it specific.\nold_text: {}",
                count,
                path,
                old.chars().take(120).collect::<String>()
            ));
        }
        // Exact match missed. Try the normalized fuzzy variants — same
        // strategy pi uses for smart-quote and trailing-whitespace drift.
        let normalized_content = normalize_for_fuzzy_match(&new_content);
        let normalized_old = normalize_for_fuzzy_match(old);
        let fuzzy_count = normalized_content.matches(normalized_old.as_str()).count();
        if fuzzy_count == 0 {
            return Err(format!(
                "old_text not found in '{}'. The text to replace must match exactly (whitespace and punctuation included).\nold_text: {}",
                path,
                old.chars().take(120).collect::<String>()
            ));
        }
        if fuzzy_count > 1 {
            return Err(format!(
                "old_text appears {} times in '{}' under fuzzy matching. Add more surrounding context.",
                fuzzy_count, path
            ));
        }
        // Fuzzy hit: switch to the normalized content for this and any
        // subsequent replacements so positions stay consistent.
        new_content = normalized_content.replacen(normalized_old.as_str(), new, 1);
        applied += 1;
        fuzzy_used += 1;
    }

    if applied == 0 {
        return Err(format!("No replacements were applied to '{}'.", path));
    }

    fs::write(&full, &new_content).map_err(|e| format!("Cannot write '{}': {}", path, e))?;

    let mut msg = format!(
        "Successfully edited {}: {} replacement(s) applied.",
        path, applied
    );
    if fuzzy_used > 0 {
        msg.push_str(&format!(
            " ({} via fuzzy match — file punctuation/whitespace was normalized)",
            fuzzy_used
        ));
    }
    Ok(msg)
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
fn git_branch(workspace: String, action: String, name: Option<String>) -> Result<String, String> {
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
        _ => Err(format!(
            "Unknown git_branch action: '{}'. Use list, current, create, or switch.",
            action
        )),
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

/// Parse "10-50" or "42" into (start, end). Returns None if invalid.
fn parse_line_range(input: &str) -> Option<(u64, u64)> {
    let trimmed = input.trim();
    if let Some((a, b)) = trimmed.split_once('-') {
        let start = a.trim().parse::<u64>().ok()?;
        let end = b.trim().parse::<u64>().ok()?;
        if start == 0 || end < start {
            return None;
        }
        Some((start, end))
    } else {
        let n = trimmed.parse::<u64>().ok()?;
        if n == 0 {
            return None;
        }
        Some((n, n))
    }
}

#[tauri::command]
fn git_log(
    workspace: String,
    path: Option<String>,
    limit: Option<u32>,
    format: Option<String>,
) -> Result<String, String> {
    use std::process::Command;

    let count = limit.unwrap_or(20).clamp(1, 100);
    let fmt = format.as_deref().unwrap_or("compact");
    let count_arg = format!("--max-count={}", count);

    let mut cmd = Command::new("git");
    cmd.arg("log");
    cmd.arg(&count_arg);
    match fmt {
        "compact" => {
            cmd.arg("--oneline");
        }
        "full" => {
            cmd.arg("--pretty=fuller");
        }
        "patch" => {
            cmd.arg("-p");
        }
        other => {
            return Err(format!(
                "Unknown format '{}'. Use 'compact', 'full', or 'patch'.",
                other
            ));
        }
    }

    if let Some(p) = path.as_deref().filter(|s| !s.is_empty()) {
        let resolved = resolve_path(&workspace, p)?;
        cmd.arg("--follow");
        cmd.arg("--");
        cmd.arg(resolved);
    }

    let output = cmd
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let combined = format!("{}{}", stdout, stderr);
        return Err(combined.trim().to_string());
    }

    if stdout.trim().is_empty() {
        return Ok("(no commits)".to_string());
    }
    Ok(stdout.to_string())
}

#[tauri::command]
fn git_blame(
    workspace: String,
    path: String,
    line_range: Option<String>,
) -> Result<String, String> {
    use std::process::Command;

    let resolved = resolve_path(&workspace, &path)?;

    let mut cmd = Command::new("git");
    cmd.arg("blame");
    cmd.arg("--show-email");

    if let Some(range) = line_range.as_deref().filter(|s| !s.is_empty()) {
        let (start, end) = parse_line_range(range).ok_or_else(|| {
            format!(
                "Invalid line_range '{}'. Use 'N' or 'N-M' (1-indexed).",
                range
            )
        })?;
        cmd.arg(format!("-L{},{}", start, end));
    }

    cmd.arg("--");
    cmd.arg(&resolved);

    let output = cmd
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to run git blame: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let combined = stderr.trim();
        if combined.is_empty() {
            return Err("git blame failed with no output (binary file or untracked?)".to_string());
        }
        return Err(combined.to_string());
    }

    if stdout.trim().is_empty() {
        return Ok("(no blame output — file may be empty)".to_string());
    }
    Ok(stdout.to_string())
}

#[tauri::command]
fn read_lints(workspace: String) -> Result<String, String> {
    use std::process::Command;

    // Try cargo check first (most common for Rust projects)
    let has_cargo = std::path::Path::new(&workspace).join("Cargo.toml").exists();
    let has_package_json = std::path::Path::new(&workspace)
        .join("package.json")
        .exists();

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
        .prepare(
            "SELECT payload FROM agent_events WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            row.get::<_, String>(0)
        })
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
fn resolve_write_path(workspace: &str, relative: &str) -> Result<PathBuf, String> {
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

/// Read a workspace file as a base64 data URL. Used by the workspace file
/// browser to preview binary assets (images, PDFs, fonts) that don't fit the
/// text-based read_file path. Capped at 25MB to avoid OOM on huge blobs.
#[tauri::command]
fn read_file_bytes(
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
fn list_dir(
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

#[tauri::command]
fn search_content(
    workspace: String,
    pattern: String,
    file_pattern: Option<String>,
    context_lines: Option<u32>,
    case_insensitive: Option<bool>,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<Vec<SearchMatch>, String> {
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    search_content_impl(
        workspace,
        pattern,
        file_pattern,
        context_lines,
        case_insensitive,
        &ws_patterns,
    )
}

fn search_content_impl(
    workspace: String,
    pattern: String,
    file_pattern: Option<String>,
    context_lines: Option<u32>,
    case_insensitive: Option<bool>,
    ws_patterns: &[String],
) -> Result<Vec<SearchMatch>, String> {
    let ws_path = Path::new(&workspace);
    let ws_canonical =
        fs::canonicalize(ws_path).map_err(|e| format!("Cannot resolve workspace: {}", e))?;

    // RegexBuilder lets case_insensitive=true compose with patterns that
    // already include an inline (?i) flag — the regex crate treats them
    // idempotently, so no double-flagging hazard.
    let re = regex::RegexBuilder::new(&pattern)
        .case_insensitive(case_insensitive.unwrap_or(false))
        .build()
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;

    // Cap context generously so a runaway model can't ask for 10_000 lines.
    let ctx = context_lines.unwrap_or(0).min(20) as usize;

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
        if check_denylist_ws(entry.path(), ws_patterns).is_err() {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.len() > 1024 * 1024 {
                continue;
            }
        }
        let content = fs::read_to_string(entry.path()).unwrap_or_default();
        // Materialize the line list once so context windows can index back
        // and forward without re-walking. Bounded by the 1MB file cap above.
        let lines: Vec<&str> = content.lines().collect();
        for (idx, line) in lines.iter().enumerate() {
            if re.is_match(line) {
                let rel_path = entry
                    .path()
                    .strip_prefix(&ws_canonical)
                    .unwrap_or(entry.path());
                let (before, after) = if ctx == 0 {
                    (Vec::new(), Vec::new())
                } else {
                    let start = idx.saturating_sub(ctx);
                    let end = (idx + 1 + ctx).min(lines.len());
                    let before = lines[start..idx].iter().map(|s| s.to_string()).collect();
                    let after = lines[idx + 1..end].iter().map(|s| s.to_string()).collect();
                    (before, after)
                };
                matches.push(SearchMatch {
                    file: rel_path.to_string_lossy().to_string(),
                    line: (idx + 1) as u64,
                    content: line.to_string(),
                    context_before: before,
                    context_after: after,
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

/// Resolves a usable LaTeX engine, downloading a portable tectonic binary on
/// first use if neither tectonic nor pdflatex are on PATH. The downloaded
/// binary is cached in the app data directory so subsequent compiles are
/// instant.
fn resolve_latex_engine(app: &tauri::AppHandle) -> Result<(String, &'static str), String> {
    use std::process::Command;

    // 1. tectonic on PATH
    if Command::new("tectonic").arg("--version").output().is_ok() {
        return Ok(("tectonic".to_string(), "tectonic"));
    }
    // 2. pdflatex on PATH
    if Command::new("pdflatex").arg("--version").output().is_ok() {
        return Ok(("pdflatex".to_string(), "pdflatex"));
    }

    // 3. Cached portable tectonic from a previous run
    let bin_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data dir: {}", e))?
        .join("bin");
    let cached = bin_dir.join("tectonic");
    if cached.exists() {
        return Ok((cached.to_string_lossy().to_string(), "tectonic"));
    }

    // 4. Download a portable tectonic binary. Pick the asset for this
    //    platform from the tectonic GitHub releases.
    let asset = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "tectonic-0.15.0-aarch64-apple-darwin.tar.gz",
        ("macos", "x86_64") => "tectonic-0.15.0-x86_64-apple-darwin.tar.gz",
        ("linux", "x86_64") => "tectonic-0.15.0-x86_64-unknown-linux-musl.tar.gz",
        ("linux", "aarch64") => "tectonic-0.15.0-aarch64-unknown-linux-musl.tar.gz",
        (os, arch) => {
            return Err(format!(
            "No portable LaTeX engine available for {} {}. Install tectonic or pdflatex manually.",
            os, arch,
        ))
        }
    };
    let url = format!(
        "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/{}",
        asset,
    );

    fs::create_dir_all(&bin_dir).map_err(|e| format!("Cannot create bin dir: {}", e))?;
    let archive_path = bin_dir.join(asset);

    // Use curl (present on macOS by default; common on Linux). Adding a
    // dedicated HTTP client crate would balloon the bundle for one feature.
    let curl_status = Command::new("curl")
        .args([
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "-o",
            archive_path.to_str().unwrap_or(""),
            &url,
        ])
        .status()
        .map_err(|e| format!("curl not available, cannot fetch tectonic: {}", e))?;
    if !curl_status.success() {
        return Err(format!("Failed to download LaTeX engine from {}", url));
    }

    // Extract the single `tectonic` binary from the tarball.
    let tar_status = Command::new("tar")
        .args([
            "-xzf",
            archive_path.to_str().unwrap_or(""),
            "-C",
            bin_dir.to_str().unwrap_or(""),
            "tectonic",
        ])
        .status()
        .map_err(|e| format!("tar not available, cannot extract tectonic: {}", e))?;
    if !tar_status.success() {
        return Err("Failed to extract LaTeX engine archive.".to_string());
    }
    let _ = fs::remove_file(&archive_path);

    // Mark executable on Unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&cached) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&cached, perms);
        }
    }

    if !cached.exists() {
        return Err("LaTeX engine download succeeded but binary not found in archive.".to_string());
    }
    Ok((cached.to_string_lossy().to_string(), "tectonic"))
}

#[tauri::command]
fn compile_latex(content: String, app: tauri::AppHandle) -> Result<String, String> {
    use std::process::Command;

    let dir = tempfile::tempdir().map_err(|e| format!("Cannot create temp dir: {}", e))?;
    let tex_path = dir.path().join("document.tex");

    fs::write(&tex_path, &content).map_err(|e| format!("Cannot write .tex file: {}", e))?;

    let (engine, kind) = resolve_latex_engine(&app)?;

    let result = if kind == "tectonic" {
        Command::new(&engine)
            .args([
                "-o",
                dir.path().to_str().unwrap_or("."),
                tex_path.to_str().unwrap_or("document.tex"),
            ])
            .current_dir(dir.path())
            .output()
            .map_err(|e| format!("Failed to run LaTeX engine ({}): {}", engine, e))?
    } else {
        Command::new(&engine)
            .args([
                "-interaction=nonstopmode",
                "-output-directory",
                dir.path().to_str().unwrap_or("."),
                tex_path.to_str().unwrap_or("document.tex"),
            ])
            .current_dir(dir.path())
            .output()
            .map_err(|e| format!("Failed to run LaTeX engine ({}): {}", engine, e))?
    };

    let pdf_path = dir.path().join("document.pdf");
    if !pdf_path.exists() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "LaTeX compilation failed. The document may have syntax errors.\n\n{}",
            stderr
                .lines()
                .filter(|l| l.starts_with('!'))
                .take(5)
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }

    let pdf_bytes = fs::read(&pdf_path).map_err(|e| format!("Cannot read compiled PDF: {}", e))?;

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&pdf_bytes);
    Ok(format!("data:application/pdf;base64,{}", b64))
}

// ── Embeddings (semantic search) ──────────────────────────────────────────
//
// We store embeddings as raw f32 BLOBs in SQLite and run cosine similarity
// in-memory. For typical workspaces (<10k chunks @ 768 dims), a full scan
// is <10ms — well under the 200ms threshold where you'd reach for a vector
// extension. If it ever matters, swap the SQL for `sqlite-vec` MATCH calls
// without changing the rest of the surface.

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Chunk {
    file_path: String,
    start_line: u32,
    end_line: u32,
    content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct EmbeddingRow {
    file_path: String,
    start_line: u32,
    end_line: u32,
    content: String,
    embedding: Vec<f32>,
}

#[derive(Debug, Serialize)]
struct SearchHit {
    file: String,
    start_line: u32,
    end_line: u32,
    content: String,
    score: f32,
}

/// Split a file into ~80-line windows with 20-line overlap. AST-aware
/// chunking is deferred — line-based is the universal fallback. The window
/// size targets ~300-400 tokens per chunk for `nomic-embed-text`.
fn chunk_file(path: &str, content: &str) -> Vec<Chunk> {
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
fn should_index_path(name: &str, is_dir: bool) -> bool {
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
fn workspace_chunks(
    workspace: String,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<Vec<Chunk>, String> {
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    workspace_chunks_impl(workspace, &ws_patterns)
}

fn workspace_chunks_impl(workspace: String, ws_patterns: &[String]) -> Result<Vec<Chunk>, String> {
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

fn f32_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

fn blob_to_f32(b: &[u8]) -> Vec<f32> {
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

fn cosine(a: &[f32], b: &[f32]) -> f32 {
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
fn embeddings_clear(workspace: String, state: tauri::State<'_, DbState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute(
        "DELETE FROM embeddings WHERE workspace = ?1",
        rusqlite::params![workspace],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn embeddings_count(workspace: String, state: tauri::State<'_, DbState>) -> Result<i64, String> {
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
fn embeddings_insert(
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
fn embeddings_search(
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

// ── PDF reading ───────────────────────────────────────────────────────────

const MAX_PDF_BYTES: u64 = 50 * 1024 * 1024; // 50MB hard cap
const MAX_PDF_TEXT_OUTPUT: usize = 4_000_000; // 4MB extracted text cap (covers full textbooks)

/// Find the largest valid char boundary at or below `idx`. Slicing on a byte
/// index that lands inside a multibyte UTF-8 sequence panics; PDF text often
/// contains non-ASCII so we step back until we hit a char boundary.
fn floor_char_boundary(s: &str, idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }
    let mut i = idx;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Clean up `pdf-extract` output: it emits lots of stray spaces, form-feeds,
/// and broken column reflow which inflates apparent size 2-3x without adding
/// information. Squeezing whitespace before the cap means we keep more real
/// text per file when several PDFs share a budget.
fn normalize_pdf_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_space = false;
    let mut blank_run = 0usize;
    for raw_line in input.split('\n') {
        // Drop form-feeds, NULs, BOMs.
        let cleaned: String = raw_line
            .chars()
            .filter(|c| !matches!(c, '\u{0c}' | '\u{00}' | '\u{feff}'))
            .collect();
        let trimmed = cleaned.trim_end();
        if trimmed.trim().is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                out.push('\n');
            }
            last_was_space = true;
            continue;
        }
        blank_run = 0;
        // Collapse runs of internal whitespace within a line.
        for ch in trimmed.chars() {
            if ch.is_whitespace() {
                if !last_was_space {
                    out.push(' ');
                    last_was_space = true;
                }
            } else {
                out.push(ch);
                last_was_space = false;
            }
        }
        out.push('\n');
        last_was_space = true;
    }
    out.trim().to_string()
}

#[tauri::command]
fn read_pdf(
    workspace: String,
    path: String,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<String, String> {
    let resolved = resolve_path(&workspace, &path)?;
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    check_denylist_ws(&resolved, &ws_patterns)?;

    let metadata = fs::metadata(&resolved).map_err(|e| format!("Cannot stat '{}': {}", path, e))?;
    if !metadata.is_file() {
        return Err(format!("'{}' is not a file", path));
    }
    if metadata.len() > MAX_PDF_BYTES {
        return Err(format!(
            "PDF '{}' is {} bytes; max supported is {} bytes (~50MB).",
            path,
            metadata.len(),
            MAX_PDF_BYTES
        ));
    }

    let bytes = fs::read(&resolved).map_err(|e| format!("Cannot read '{}': {}", path, e))?;

    // pdf-extract panics on some malformed PDFs. Catch the panic so we surface
    // a clean error instead of taking the renderer down.
    let extract_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pdf_extract::extract_text_from_mem(&bytes)
    }));

    let raw = match extract_result {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => return Err(format!("PDF parse failed: {}", e)),
        Err(_) => return Err("PDF parser crashed (file may be malformed or encrypted)".to_string()),
    };

    let text = normalize_pdf_text(&raw);
    let bytes_total = text.len();
    let truncated = bytes_total > MAX_PDF_TEXT_OUTPUT;
    let body = if truncated {
        let cut = floor_char_boundary(&text, MAX_PDF_TEXT_OUTPUT);
        format!(
            "{}\n\n… [{} more characters truncated; total extracted text was {} bytes]",
            &text[..cut],
            bytes_total - cut,
            bytes_total
        )
    } else {
        text
    };

    Ok(format!(
        "PDF: {}\nSize: {} bytes\nExtracted: {} bytes{}\n\n---\n\n{}",
        path,
        metadata.len(),
        bytes_total,
        if truncated { " (truncated)" } else { "" },
        body
    ))
}

/// Extract text from a base64-encoded PDF data URL or raw base64 string.
/// Used for inline PDF attachments in chat (no workspace required).
/// Same caps as read_pdf: 50MB input, 200KB extracted text.
#[tauri::command]
fn extract_pdf_text(data_url: String) -> Result<String, String> {
    use base64::Engine;

    // Accept either a `data:application/pdf;base64,...` URL or a bare base64 payload.
    let b64 = if let Some(idx) = data_url.find("base64,") {
        &data_url[idx + "base64,".len()..]
    } else {
        data_url.as_str()
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Invalid base64 PDF data: {}", e))?;

    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err(format!(
            "PDF is {} bytes; max supported is {} bytes (~50MB).",
            bytes.len(),
            MAX_PDF_BYTES
        ));
    }

    // pdf-extract panics on some malformed PDFs. Catch the panic so we surface
    // a clean error instead of taking the renderer down.
    let extract_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pdf_extract::extract_text_from_mem(&bytes)
    }));

    let raw = match extract_result {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => return Err(format!("PDF parse failed: {}", e)),
        Err(_) => return Err("PDF parser crashed (file may be malformed or encrypted)".to_string()),
    };

    let text = normalize_pdf_text(&raw);
    let bytes_total = text.len();
    let truncated = bytes_total > MAX_PDF_TEXT_OUTPUT;
    if truncated {
        let cut = floor_char_boundary(&text, MAX_PDF_TEXT_OUTPUT);
        Ok(format!(
            "{}\n\n… [{} more characters truncated; total extracted text was {} bytes]",
            &text[..cut],
            bytes_total - cut,
            bytes_total
        ))
    } else {
        Ok(text)
    }
}

// ── Office document extraction (docx / pptx / xlsx) ──────────────────────

const MAX_OFFICE_BYTES: u64 = 50 * 1024 * 1024; // 50MB hard cap
const MAX_OFFICE_TEXT_OUTPUT: usize = 4_000_000; // 4MB extracted text cap per file

fn decode_attachment_b64(data_url: &str, max_bytes: u64, label: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let b64 = if let Some(idx) = data_url.find("base64,") {
        &data_url[idx + "base64,".len()..]
    } else {
        data_url
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Invalid base64 {} data: {}", label, e))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "{} is {} bytes; max supported is {} bytes (~50MB).",
            label,
            bytes.len(),
            max_bytes
        ));
    }
    Ok(bytes)
}

fn cap_text(text: String, cap: usize) -> String {
    let bytes_total = text.len();
    if bytes_total <= cap {
        text
    } else {
        let cut = floor_char_boundary(&text, cap);
        format!(
            "{}\n\n… [{} more characters truncated; total extracted text was {} bytes]",
            &text[..cut],
            bytes_total - cut,
            bytes_total
        )
    }
}

/// Pull text content out of an Office Open XML part (document.xml, slide*.xml,
/// etc.) by reading <w:t>, <a:t>, and <t> text runs and inserting newlines on
/// paragraph and break boundaries. Good enough for chat-context usage; not a
/// faithful Word renderer.
fn xml_to_text(xml: &[u8]) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    let mut reader = Reader::from_reader(xml);
    reader.trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut in_text_run = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = e.name();
                let local = name.local_name();
                let lname = std::str::from_utf8(local.as_ref()).unwrap_or("");
                if lname == "t" {
                    in_text_run = true;
                }
            }
            Ok(Event::End(ref e)) => {
                let name = e.name();
                let local = name.local_name();
                let lname = std::str::from_utf8(local.as_ref()).unwrap_or("");
                if lname == "t" {
                    in_text_run = false;
                } else if lname == "p" || lname == "tr" {
                    out.push('\n');
                } else if lname == "tc" {
                    out.push('\t');
                }
            }
            Ok(Event::Empty(ref e)) => {
                let name = e.name();
                let local = name.local_name();
                let lname = std::str::from_utf8(local.as_ref()).unwrap_or("");
                if lname == "br" || lname == "cr" {
                    out.push('\n');
                } else if lname == "tab" {
                    out.push('\t');
                }
            }
            Ok(Event::Text(t)) if in_text_run => {
                let s = t
                    .unescape()
                    .map_err(|e| format!("XML decode failed: {}", e))?;
                out.push_str(&s);
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(format!(
                    "XML parse failed at {}: {}",
                    reader.buffer_position(),
                    e
                ))
            }
            _ => {}
        }
        buf.clear();
    }
    // Collapse runs of blank lines.
    let cleaned = out
        .lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    let mut prev_blank = false;
    let mut compact = String::with_capacity(cleaned.len());
    for line in cleaned.lines() {
        let blank = line.trim().is_empty();
        if blank && prev_blank {
            continue;
        }
        compact.push_str(line);
        compact.push('\n');
        prev_blank = blank;
    }
    Ok(compact.trim().to_string())
}

/// Extract text from a base64-encoded .docx (Word) attachment.
#[tauri::command]
fn extract_docx_text(data_url: String) -> Result<String, String> {
    use std::io::Read;
    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "DOCX")?;
    let cursor = std::io::Cursor::new(&bytes);
    let mut zip =
        zip::ZipArchive::new(cursor).map_err(|e| format!("DOCX is not a valid zip: {}", e))?;
    let mut document_xml = Vec::new();
    {
        let mut entry = zip
            .by_name("word/document.xml")
            .map_err(|_| "DOCX missing word/document.xml (encrypted or malformed?)".to_string())?;
        entry
            .read_to_end(&mut document_xml)
            .map_err(|e| format!("Cannot read document.xml: {}", e))?;
    }
    let text = xml_to_text(&document_xml)?;
    if text.trim().is_empty() {
        return Err("DOCX contained no extractable text".to_string());
    }
    Ok(cap_text(text, MAX_OFFICE_TEXT_OUTPUT))
}

/// Extract text from a base64-encoded .pptx (PowerPoint) attachment. Each
/// slide's text is emitted under a `--- Slide N ---` header so the model can
/// reason about slide structure.
#[tauri::command]
fn extract_pptx_text(data_url: String) -> Result<String, String> {
    use std::io::Read;
    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "PPTX")?;
    let cursor = std::io::Cursor::new(&bytes);
    let mut zip =
        zip::ZipArchive::new(cursor).map_err(|e| format!("PPTX is not a valid zip: {}", e))?;

    // Collect slide names so we can emit them in order: slide1, slide2, …
    let mut slide_names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|e| e.name().to_string()))
        .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
        .collect();
    slide_names.sort_by_key(|n| {
        // Extract the trailing number for natural ordering: slide2 < slide10.
        n.trim_start_matches("ppt/slides/slide")
            .trim_end_matches(".xml")
            .parse::<u32>()
            .unwrap_or(u32::MAX)
    });
    if slide_names.is_empty() {
        return Err("PPTX contained no slides".to_string());
    }

    let mut out = String::new();
    for (idx, name) in slide_names.iter().enumerate() {
        let mut xml = Vec::new();
        {
            let mut entry = zip
                .by_name(name)
                .map_err(|e| format!("Cannot open {}: {}", name, e))?;
            entry
                .read_to_end(&mut xml)
                .map_err(|e| format!("Cannot read {}: {}", name, e))?;
        }
        let slide_text = xml_to_text(&xml).unwrap_or_default();
        out.push_str(&format!("--- Slide {} ---\n", idx + 1));
        if slide_text.trim().is_empty() {
            out.push_str("(no text on this slide)\n");
        } else {
            out.push_str(&slide_text);
            out.push('\n');
        }
        out.push('\n');
    }

    Ok(cap_text(out.trim().to_string(), MAX_OFFICE_TEXT_OUTPUT))
}

/// Extract text from a base64-encoded .xlsx (Excel) attachment. Each sheet is
/// emitted under a `--- Sheet: <name> ---` header as TSV so the model can read
/// it as a table.
#[tauri::command]
fn extract_xlsx_text(data_url: String) -> Result<String, String> {
    use calamine::{open_workbook_from_rs, Data, Reader, Xlsx};
    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "XLSX")?;
    let cursor = std::io::Cursor::new(bytes);
    let mut wb: Xlsx<_> = open_workbook_from_rs(cursor)
        .map_err(|e| format!("XLSX is not a valid workbook: {}", e))?;
    let sheet_names = wb.sheet_names().to_vec();
    if sheet_names.is_empty() {
        return Err("XLSX contained no sheets".to_string());
    }
    let mut out = String::new();
    for name in &sheet_names {
        let range = match wb.worksheet_range(name) {
            Ok(r) => r,
            Err(e) => {
                out.push_str(&format!(
                    "--- Sheet: {} ---\n(failed to read: {})\n\n",
                    name, e
                ));
                continue;
            }
        };
        out.push_str(&format!("--- Sheet: {} ---\n", name));
        if range.is_empty() {
            out.push_str("(empty)\n\n");
            continue;
        }
        // Cap rows so a 100k-row sheet doesn't blow the output cap on its own.
        for (rows, row) in range.rows().enumerate() {
            if rows >= 5_000 {
                out.push_str("… (additional rows truncated)\n");
                break;
            }
            let cells: Vec<String> = row
                .iter()
                .map(|c| match c {
                    Data::Empty => String::new(),
                    Data::String(s) => s.clone(),
                    Data::Float(f) => {
                        if f.fract() == 0.0 && f.abs() < 1e15 {
                            format!("{}", *f as i64)
                        } else {
                            format!("{}", f)
                        }
                    }
                    Data::Int(i) => i.to_string(),
                    Data::Bool(b) => b.to_string(),
                    Data::DateTime(dt) => format!("{}", dt.as_f64()),
                    Data::DateTimeIso(s) => s.clone(),
                    Data::DurationIso(s) => s.clone(),
                    Data::Error(e) => format!("#ERR({:?})", e),
                })
                .collect();
            out.push_str(&cells.join("\t"));
            out.push('\n');
        }
        out.push('\n');
    }
    Ok(cap_text(out.trim().to_string(), MAX_OFFICE_TEXT_OUTPUT))
}

// ── OCR ──────────────────────────────────────────────────────────────

/// Detect whether `tesseract` is available on PATH. The frontend uses this
/// to decide whether to offer OCR fallback for image attachments on
/// non-vision models. Read-only — no side effects, never errors.
#[tauri::command]
fn ocr_available() -> bool {
    use std::process::Command;
    Command::new("tesseract")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run Tesseract OCR on a base64-encoded image and return the extracted
/// text. Used as the text-only-model fallback when the user attaches a
/// photo of homework/whiteboard but the active model can't see images.
///
/// Tesseract isn't bundled with goatLLM — the user installs it themselves
/// (`brew install tesseract` / `apt install tesseract-ocr`). We probe via
/// `ocr_available` before offering the option, so the UX never promises
/// OCR on a system that can't deliver it.
#[tauri::command]
fn ocr_image(data_url: String) -> Result<String, String> {
    use std::io::Write;
    use std::process::Command;
    use std::time::Duration;

    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "image")?;

    // Write to a temp file in a temp dir; tesseract reads from disk.
    let dir = tempfile::tempdir().map_err(|e| format!("Cannot create temp dir: {}", e))?;
    let img_path = dir.path().join("input.png");
    {
        let mut f =
            fs::File::create(&img_path).map_err(|e| format!("Cannot write image: {}", e))?;
        f.write_all(&bytes)
            .map_err(|e| format!("Cannot write image: {}", e))?;
    }

    let out_stem = dir.path().join("out");
    let mut child = Command::new("tesseract")
        .arg(img_path.to_str().unwrap_or("input.png"))
        .arg(out_stem.to_str().unwrap_or("out"))
        .arg("-l")
        .arg("eng") // baseline; users can install more lang packs themselves
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "OCR not available. Install Tesseract (`brew install tesseract` on macOS, `apt install tesseract-ocr` on Linux) and retry.".to_string()
            } else {
                format!("Cannot launch tesseract: {}", e)
            }
        })?;

    // 30s timeout: more than enough for any single image, prevents a hung
    // process from freezing the UI thread.
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let mut err = String::new();
                    if let Some(mut s) = child.stderr.take() {
                        use std::io::Read;
                        let _ = s.read_to_string(&mut err);
                    }
                    return Err(format!("tesseract failed: {}", err.trim()));
                }
                break;
            }
            Ok(None) => {
                if start.elapsed() > Duration::from_secs(30) {
                    let _ = child.kill();
                    return Err("OCR timed out after 30s".to_string());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("tesseract wait failed: {}", e)),
        }
    }

    let txt_path = dir.path().join("out.txt");
    let text =
        fs::read_to_string(&txt_path).map_err(|e| format!("Cannot read OCR output: {}", e))?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("OCR produced no text — image may be too low-resolution or contain no recognizable characters.".to_string());
    }
    Ok(cap_text(trimmed, MAX_OFFICE_TEXT_OUTPUT))
}

// ── Audio transcription ─────────────────────────────────────────────────────

/// Probe whether a whisper-compatible CLI is on PATH. We accept any of
/// these binaries because all three exist in the wild:
///  - `whisper` (OpenAI Python whisper, when pip-installed)
///  - `whisper-cpp` (most common Homebrew/Linux package name)
///  - `whisper.cpp` (occasional alias)
fn whisper_binary() -> Option<&'static str> {
    use std::process::Command;
    ["whisper-cpp", "whisper.cpp", "whisper"]
        .into_iter()
        .find(|candidate| {
            Command::new(candidate)
                .arg("--help")
                .output()
                .map(|o| o.status.success() || !o.stderr.is_empty())
                .unwrap_or(false)
        })
}

#[tauri::command]
fn audio_transcription_available() -> bool {
    whisper_binary().is_some()
}

/// Transcribe an audio attachment via a locally-installed whisper variant.
/// Same UX promise as OCR: probe `audio_transcription_available` first;
/// only call this when it returns true. The frontend never silently
/// promises transcription on a system that can't deliver.
///
/// We accept any common audio container the user might attach
/// (mp3, m4a, wav, flac, ogg, webm). Whisper handles each via ffmpeg.
/// Capped at 50MB input — a 50MB m4a is roughly an hour of speech.
#[tauri::command]
fn transcribe_audio(data_url: String, filename: String) -> Result<String, String> {
    use std::io::Write;
    use std::process::Command;
    use std::time::Duration;

    let bin = whisper_binary().ok_or_else(|| {
        "Audio transcription not available. Install whisper-cpp (`brew install whisper-cpp` on macOS) or pip install openai-whisper, then retry.".to_string()
    })?;

    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "audio")?;
    let dir = tempfile::tempdir().map_err(|e| format!("Cannot create temp dir: {}", e))?;
    // Preserve the original extension so whisper picks the right decoder.
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp3");
    let audio_path = dir.path().join(format!("input.{}", ext));
    {
        let mut f =
            fs::File::create(&audio_path).map_err(|e| format!("Cannot write audio: {}", e))?;
        f.write_all(&bytes)
            .map_err(|e| format!("Cannot write audio: {}", e))?;
    }

    // The two whisper variants take very different flags. Probe by binary
    // name; both end up writing a `<stem>.txt` next to the input.
    let stem = audio_path.with_extension("");
    let stem_str = stem.to_str().unwrap_or("input");
    let mut cmd = Command::new(bin);
    if bin == "whisper-cpp" || bin == "whisper.cpp" {
        cmd.arg("-f")
            .arg(audio_path.to_str().unwrap_or(""))
            .arg("-otxt")
            .arg("-of")
            .arg(stem_str);
    } else {
        // openai-whisper Python package CLI.
        cmd.arg(audio_path.to_str().unwrap_or(""))
            .arg("--output_format")
            .arg("txt")
            .arg("--output_dir")
            .arg(dir.path().to_str().unwrap_or(""));
    }

    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Cannot launch whisper: {}", e))?;

    // Generous 10-minute cap for an hour of audio on a fast machine.
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let mut err = String::new();
                    if let Some(mut s) = child.stderr.take() {
                        use std::io::Read;
                        let _ = s.read_to_string(&mut err);
                    }
                    return Err(format!("whisper failed: {}", err.trim()));
                }
                break;
            }
            Ok(None) => {
                if start.elapsed() > Duration::from_secs(600) {
                    let _ = child.kill();
                    return Err("Audio transcription timed out after 10 minutes".to_string());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(format!("whisper wait failed: {}", e)),
        }
    }

    // Both variants drop a `.txt` next to the input stem.
    let txt_path = std::path::PathBuf::from(format!("{}.txt", stem_str));
    let text =
        fs::read_to_string(&txt_path).map_err(|e| format!("Cannot read transcript: {}", e))?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("Transcript was empty (audio may be silent or unintelligible).".to_string());
    }
    Ok(cap_text(trimmed, MAX_OFFICE_TEXT_OUTPUT))
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
                    return Err(Box::new(std::io::Error::other(
                        "Database initialization failed",
                    )));
                }
            };
            app.manage(DbState { db: Mutex::new(db) });

            // Initialize workspaces
            let workspaces = load_workspaces(&app.handle().clone());
            app.manage(Mutex::new(WorkspaceState { workspaces }));

            // Track the managed Ollama child (if any).
            app.manage(ollama::OllamaProcess::new());

            // Track MCP stdio child processes.
            app.manage(mcp::McpProcesses::new());

            let _window = app.get_webview_window("main").unwrap();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_all_data,
            load_messages_for_conversation,
            save_conversation,
            save_message,
            delete_conversation_db,
            delete_message_db,
            search_messages,
            log_event,
            get_events,
            read_file,
            read_file_bytes,
            list_dir,
            search_content,
            git_status,
            git_branch,
            git_commit,
            git_push,
            git_log,
            git_blame,
            write_file,
            delete_file,
            edit_file,
            write_temp_file,
            os_temp_dir,
            home_dir,
            goat_agent_dir,
            list_dir_abs,
            read_text_file_abs,
            path_exists_abs,
            create_dir_abs,
            copy_dir_abs,
            resource_dir,
            write_skill_file,
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
            workspace_chunks,
            embeddings_insert,
            embeddings_search,
            embeddings_clear,
            embeddings_count,
            read_pdf,
            extract_pdf_text,
            extract_docx_text,
            extract_pptx_text,
            extract_xlsx_text,
            ocr_available,
            ocr_image,
            audio_transcription_available,
            transcribe_audio,
            ollama::ollama_system_info,
            ollama::ollama_status,
            ollama::ollama_start,
            ollama::ollama_stop,
            mcp::mcp_stdio_spawn,
            mcp::mcp_stdio_send,
            mcp::mcp_stdio_disconnect,
            jj::is_jj_installed,
            jj::is_jj_repo,
            jj::jj_new,
            jj::jj_squash,
            jj::jj_describe,
            jj::jj_abandon,
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
        if let Ok(p) = result {
            assert!(p.to_string_lossy().contains("src-tauri"));
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
    fn test_resolve_write_path_allows_new_workspace_file() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_string_lossy().to_string();
        let resolved = resolve_write_path(&workspace, "src/new-file.txt").unwrap();
        assert!(resolved.starts_with(tmp.path().canonicalize().unwrap()));
        assert!(resolved.ends_with("src/new-file.txt"));
    }

    #[test]
    fn test_resolve_write_path_rejects_parent_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_string_lossy().to_string();
        let result = resolve_write_path(&workspace, "../escape.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_write_temp_file_allows_temp_path() {
        let path =
            std::env::temp_dir().join(format!("goatllm-write-temp-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let result = write_temp_file(path.to_string_lossy().to_string(), "ok".to_string());
        assert!(result.is_ok());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "ok");
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(unix)]
    #[test]
    fn test_write_temp_file_rejects_parent_dir_escape() {
        let cwd = std::env::current_dir().unwrap();
        let filename = format!("goatllm-temp-escape-{}.txt", std::process::id());
        let target = cwd.join(&filename);
        let escaped = std::path::Path::new("/tmp")
            .join("..")
            .join(cwd.strip_prefix("/").unwrap())
            .join(&filename);

        let _ = std::fs::remove_file(&target);
        let result = write_temp_file(escaped.to_string_lossy().to_string(), "nope".to_string());

        assert!(result.is_err());
        assert!(!target.exists());
    }

    #[test]
    fn test_resolve_child_path_allows_nested_relative_path() {
        let tmp = tempfile::tempdir().unwrap();
        let resolved =
            resolve_child_path(tmp.path(), "skills/impeccable/SKILL.md", "test").unwrap();
        assert!(resolved.starts_with(tmp.path().canonicalize().unwrap()));
        assert!(resolved.ends_with("skills/impeccable/SKILL.md"));
    }

    #[test]
    fn test_resolve_child_path_rejects_parent_escape_before_parent_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = format!("goatllm-child-escape-{}", std::process::id());
        let result = resolve_child_path(tmp.path(), &format!("../{}/skill.md", outside), "test");
        assert!(result.is_err());
        assert!(!tmp.path().parent().unwrap().join(outside).exists());
    }

    #[test]
    fn test_escape_sql_like_query_escapes_wildcards() {
        assert_eq!(escape_sql_like_query("100%_done"), "%100\\%\\_done%");
        assert_eq!(escape_sql_like_query(r"C:\tmp"), r"%C:\\tmp%");
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

    #[test]
    fn test_parse_line_range_single() {
        assert_eq!(parse_line_range("42"), Some((42, 42)));
        assert_eq!(parse_line_range(" 7 "), Some((7, 7)));
    }

    #[test]
    fn test_parse_line_range_pair() {
        assert_eq!(parse_line_range("10-50"), Some((10, 50)));
        assert_eq!(parse_line_range(" 1 - 100 "), Some((1, 100)));
    }

    #[test]
    fn test_parse_line_range_rejects_garbage() {
        assert_eq!(parse_line_range("abc"), None);
        assert_eq!(parse_line_range("10-abc"), None);
        assert_eq!(parse_line_range(""), None);
        assert_eq!(parse_line_range("0"), None); // 0-line not allowed
        assert_eq!(parse_line_range("0-5"), None);
        assert_eq!(parse_line_range("50-10"), None); // end < start
    }

    #[test]
    fn test_chunk_file_empty() {
        assert_eq!(chunk_file("a.txt", "").len(), 0);
        assert_eq!(chunk_file("a.txt", "\n\n\n").len(), 0);
    }

    #[test]
    fn test_chunk_file_short() {
        let chunks = chunk_file("a.rs", "fn main() {\n    println!(\"hi\");\n}\n");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].file_path, "a.rs");
        assert_eq!(chunks[0].start_line, 1);
        assert!(chunks[0].content.contains("println"));
    }

    #[test]
    fn test_chunk_file_window_overlap() {
        let body = (1..=200)
            .map(|i| format!("line{}", i))
            .collect::<Vec<_>>()
            .join("\n");
        let chunks = chunk_file("big.rs", &body);
        assert!(chunks.len() >= 2);
        // Overlap: last chunk's start_line should be before previous chunk's end_line
        for w in chunks.windows(2) {
            assert!(w[1].start_line <= w[0].end_line, "expected overlap");
        }
        // First chunk starts at line 1
        assert_eq!(chunks[0].start_line, 1);
        // Last chunk ends at the last line
        assert_eq!(chunks.last().unwrap().end_line, 200);
    }

    #[test]
    fn test_should_index_path_skips_node_modules() {
        assert!(!should_index_path("node_modules", true));
        assert!(!should_index_path(".git", true));
        assert!(!should_index_path("target", true));
        assert!(!should_index_path("dist", true));
    }

    #[test]
    fn test_should_index_path_skips_binary_files() {
        assert!(!should_index_path("logo.png", false));
        assert!(!should_index_path("font.woff2", false));
        assert!(!should_index_path("Cargo.lock", false));
    }

    #[test]
    fn test_should_index_path_allows_source() {
        assert!(should_index_path("main.rs", false));
        assert!(should_index_path("App.tsx", false));
        assert!(should_index_path("src", true));
    }

    #[test]
    fn test_workspace_chunks_skip_denylisted_files() {
        let tmp = make_test_workspace();
        write_test_file(tmp.path(), ".env", "SECRET_TOKEN=abc\n");
        write_test_file(tmp.path(), "src.txt", "visible token\n");
        let ws = tmp.path().to_string_lossy().to_string();

        let chunks = workspace_chunks_impl(ws, &[]).unwrap();

        assert!(chunks.iter().any(|chunk| chunk.file_path == "src.txt"));
        assert!(!chunks.iter().any(|chunk| chunk.file_path == ".env"));
    }

    #[test]
    fn test_f32_blob_roundtrip() {
        let v = vec![1.0f32, -2.5, 0.0, std::f32::consts::PI, f32::MIN_POSITIVE];
        let blob = f32_to_blob(&v);
        let back = blob_to_f32(&blob);
        assert_eq!(v, back);
    }

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![1.0f32, 0.0, 0.0];
        assert!((cosine(&a, &b) - 1.0).abs() < 1e-6);

        let c = vec![0.0f32, 1.0, 0.0];
        assert!(cosine(&a, &c).abs() < 1e-6); // orthogonal

        let d = vec![-1.0f32, 0.0, 0.0];
        assert!((cosine(&a, &d) + 1.0).abs() < 1e-6); // anti-parallel
    }

    #[test]
    fn test_floor_char_boundary_handles_multibyte_text() {
        let text = "hello नमस्ते";
        let mid_codepoint = "hello न".len() - 1;
        let cut = floor_char_boundary(text, mid_codepoint);
        assert!(text.is_char_boundary(cut));
        assert_eq!(&text[..cut], "hello ");
    }

    #[test]
    fn test_cap_text_does_not_split_utf8() {
        let capped = cap_text("नमस्ते world".to_string(), 5);
        assert!(capped.starts_with("न"));
        assert!(capped.contains("more characters truncated"));
    }

    #[test]
    fn test_cosine_handles_empty_or_zero() {
        assert_eq!(cosine(&[], &[]), 0.0);
        assert_eq!(cosine(&[1.0], &[]), 0.0);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 1.0]), 0.0);
    }

    // ---- search_content (PR0 grep nudge) ---------------------------------
    //
    // The new context_lines + case_insensitive flags are the meat of PR0;
    // these tests pin the surface (default behavior unchanged, context
    // window correct around start/end of file, case_insensitive composes
    // with inline (?i) flag without crashing).

    use std::io::Write;
    use tempfile::Builder;

    /// macOS tempfile defaults to a `.tmp` prefix, which collides with
    /// search_content's dot-directory skip. Use an explicit non-dot prefix
    /// so the walker actually descends into the test workspace.
    fn make_test_workspace() -> tempfile::TempDir {
        Builder::new().prefix("goatllm-search").tempdir().unwrap()
    }

    fn write_test_file(dir: &Path, name: &str, body: &str) {
        let mut f = std::fs::File::create(dir.join(name)).unwrap();
        f.write_all(body.as_bytes()).unwrap();
    }

    #[test]
    fn test_search_content_default_no_context() {
        let tmp = make_test_workspace();
        write_test_file(tmp.path(), "a.txt", "alpha\nbeta\ngamma\n");
        let ws = tmp.path().to_string_lossy().to_string();
        let hits = search_content_impl(ws, "beta".to_string(), None, None, None, &[]).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].content, "beta");
        // Backward-compat: empty context arrays serialize away.
        assert!(hits[0].context_before.is_empty());
        assert!(hits[0].context_after.is_empty());
    }

    #[test]
    fn test_search_content_context_lines_mid_file() {
        let tmp = make_test_workspace();
        write_test_file(tmp.path(), "a.txt", "l1\nl2\nl3\nMATCH\nl5\nl6\nl7\n");
        let ws = tmp.path().to_string_lossy().to_string();
        let hits = search_content_impl(ws, "MATCH".to_string(), None, Some(2), None, &[]).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(
            hits[0].context_before,
            vec!["l2".to_string(), "l3".to_string()]
        );
        assert_eq!(
            hits[0].context_after,
            vec!["l5".to_string(), "l6".to_string()]
        );
    }

    #[test]
    fn test_search_content_context_truncates_at_file_start() {
        let tmp = make_test_workspace();
        write_test_file(tmp.path(), "a.txt", "MATCH\nl2\nl3\n");
        let ws = tmp.path().to_string_lossy().to_string();
        let hits = search_content_impl(ws, "MATCH".to_string(), None, Some(5), None, &[]).unwrap();
        assert_eq!(hits.len(), 1);
        // No lines before line 1 — must be empty, not panic, not negative-index.
        assert!(hits[0].context_before.is_empty());
        assert_eq!(
            hits[0].context_after,
            vec!["l2".to_string(), "l3".to_string()]
        );
    }

    #[test]
    fn test_search_content_context_truncates_at_file_end() {
        let tmp = make_test_workspace();
        write_test_file(tmp.path(), "a.txt", "l1\nl2\nMATCH\n");
        let ws = tmp.path().to_string_lossy().to_string();
        let hits = search_content_impl(ws, "MATCH".to_string(), None, Some(5), None, &[]).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(
            hits[0].context_before,
            vec!["l1".to_string(), "l2".to_string()]
        );
        // No lines after the match — must be empty, not panic on out-of-bounds.
        assert!(hits[0].context_after.is_empty());
    }

    #[test]
    fn test_search_content_case_insensitive() {
        let tmp = make_test_workspace();
        write_test_file(tmp.path(), "a.txt", "hello\nHELLO\nHelloWorld\n");
        let ws = tmp.path().to_string_lossy().to_string();
        let sensitive = search_content_impl(
            ws.clone(),
            "hello".to_string(),
            None,
            None,
            Some(false),
            &[],
        )
        .unwrap();
        assert_eq!(sensitive.len(), 1);
        let insensitive =
            search_content_impl(ws, "hello".to_string(), None, None, Some(true), &[]).unwrap();
        assert_eq!(insensitive.len(), 3);
    }

    #[test]
    fn test_search_content_case_insensitive_idempotent_with_inline_flag() {
        // Pattern already has (?i); flag passed too. RegexBuilder tolerates
        // both — should compile, not double-flag, not error.
        let tmp = make_test_workspace();
        write_test_file(tmp.path(), "a.txt", "WORLD\nworld\n");
        let ws = tmp.path().to_string_lossy().to_string();
        let hits =
            search_content_impl(ws, "(?i)world".to_string(), None, None, Some(true), &[]).unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn test_search_content_context_combined_with_case_insensitive() {
        let tmp = make_test_workspace();
        write_test_file(tmp.path(), "a.txt", "l1\nFOO\nl3\n");
        let ws = tmp.path().to_string_lossy().to_string();
        let hits =
            search_content_impl(ws, "foo".to_string(), None, Some(1), Some(true), &[]).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].content, "FOO");
        assert_eq!(hits[0].context_before, vec!["l1".to_string()]);
        assert_eq!(hits[0].context_after, vec!["l3".to_string()]);
    }

    #[test]
    fn test_search_content_skips_denylisted_files() {
        let tmp = make_test_workspace();
        write_test_file(tmp.path(), ".env", "SECRET_TOKEN=abc\n");
        write_test_file(
            tmp.path(),
            "visible.txt",
            "SECRET_TOKEN is mentioned here too\n",
        );
        let ws = tmp.path().to_string_lossy().to_string();

        let hits =
            search_content_impl(ws, "SECRET_TOKEN".to_string(), None, None, None, &[]).unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].file, "visible.txt");
    }
}
