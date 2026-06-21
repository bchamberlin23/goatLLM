use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use super::escape_sql_like_query;
use super::extract::floor_char_boundary;

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct DbConversation {
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
pub(crate) struct DbMessage {
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
    model_id: Option<String>,
    citations: Option<String>,
    usage_json: Option<String>,
    estimated_context_tokens: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct DbCompactionEntry {
    id: String,
    conversation_id: String,
    first_kept_id: String,
    summary: String,
    read_files: String,
    modified_files: String,
    tokens_before: i64,
    source: String,
    is_split_turn: i64,
    turn_prefix: Option<String>,
    prompt_version: String,
    created_at: i64,
    mode: String,
    model_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AllData {
    conversations: Vec<DbConversation>,
    messages: Vec<DbMessage>,
    compaction_entries: Vec<DbCompactionEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveConversationRequest {
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
pub(crate) struct SaveMessageRequest {
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
    model_id: Option<String>,
    citations: Option<String>,
    usage_json: Option<String>,
    estimated_context_tokens: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveCompactionEntryRequest {
    id: String,
    conversation_id: String,
    first_kept_id: String,
    summary: String,
    read_files: String,
    modified_files: String,
    tokens_before: i64,
    source: String,
    is_split_turn: bool,
    turn_prefix: Option<String>,
    prompt_version: String,
    created_at: i64,
    mode: String,
    model_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct MessageSearchResult {
    message_id: String,
    conversation_id: String,
    conversation_title: String,
    role: String,
    content_preview: String,
    created_at: i64,
}

pub(crate) struct DbState {
    pub(crate) db: Mutex<rusqlite::Connection>,
}

#[tauri::command]
pub(crate) fn load_all_data(state: tauri::State<'_, DbState>) -> Result<AllData, String> {
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
        .prepare("SELECT id, conversation_id, role, content, tool_calls, attachments, created_at, pinned, thinking_content, turn_duration_ms, edited_files, model_id, citations, usage_json, estimated_context_tokens FROM messages ORDER BY created_at ASC")
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
                model_id: row.get(11)?,
                citations: row.get(12)?,
                usage_json: row.get(13)?,
                estimated_context_tokens: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut compaction_stmt = db
        .prepare("SELECT id, conversation_id, first_kept_id, summary, read_files, modified_files, tokens_before, source, is_split_turn, turn_prefix, prompt_version, created_at, mode, model_id FROM compaction_entries ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let compaction_entries: Vec<DbCompactionEntry> = compaction_stmt
        .query_map([], |row| {
            Ok(DbCompactionEntry {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                first_kept_id: row.get(2)?,
                summary: row.get(3)?,
                read_files: row.get(4)?,
                modified_files: row.get(5)?,
                tokens_before: row.get(6)?,
                source: row.get(7)?,
                is_split_turn: row.get(8)?,
                turn_prefix: row.get(9)?,
                prompt_version: row.get(10)?,
                created_at: row.get(11)?,
                mode: row.get(12)?,
                model_id: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(AllData {
        conversations,
        messages,
        compaction_entries,
    })
}

#[tauri::command]
pub(crate) fn save_conversation(
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
pub(crate) fn save_message(
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
        "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls, attachments, created_at, pinned, thinking_content, turn_duration_ms, edited_files, model_id, citations, usage_json, estimated_context_tokens) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
            payload.edited_files,
            payload.model_id,
            payload.citations,
            payload.usage_json,
            payload.estimated_context_tokens
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn save_compaction_entry(
    payload: SaveCompactionEntryRequest,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let split_int: i64 = if payload.is_split_turn { 1 } else { 0 };
    db.execute(
        "INSERT OR REPLACE INTO compaction_entries (id, conversation_id, first_kept_id, summary, read_files, modified_files, tokens_before, source, is_split_turn, turn_prefix, prompt_version, created_at, mode, model_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            payload.id,
            payload.conversation_id,
            payload.first_kept_id,
            payload.summary,
            payload.read_files,
            payload.modified_files,
            payload.tokens_before,
            payload.source,
            split_int,
            payload.turn_prefix,
            payload.prompt_version,
            payload.created_at,
            payload.mode,
            payload.model_id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Load all messages for a single conversation. Used as a safety net when the
/// in-memory store has an empty list for a conversation that does have rows on
/// disk (e.g. after a restart or when the renderer was reloaded mid-stream).
#[tauri::command]
pub(crate) fn load_messages_for_conversation(
    conversation_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<DbMessage>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut stmt = db
        .prepare(
            "SELECT id, conversation_id, role, content, tool_calls, attachments, created_at, pinned, thinking_content, turn_duration_ms, edited_files, model_id, citations, usage_json, estimated_context_tokens \
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
                model_id: row.get(11)?,
                citations: row.get(12)?,
                usage_json: row.get(13)?,
                estimated_context_tokens: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(messages)
}

#[tauri::command]
pub(crate) fn load_compaction_entries(
    conversation_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<DbCompactionEntry>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut stmt = db
        .prepare(
            "SELECT id, conversation_id, first_kept_id, summary, read_files, modified_files, tokens_before, source, is_split_turn, turn_prefix, prompt_version, created_at, mode, model_id \
             FROM compaction_entries WHERE conversation_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let entries: Vec<DbCompactionEntry> = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok(DbCompactionEntry {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                first_kept_id: row.get(2)?,
                summary: row.get(3)?,
                read_files: row.get(4)?,
                modified_files: row.get(5)?,
                tokens_before: row.get(6)?,
                source: row.get(7)?,
                is_split_turn: row.get(8)?,
                turn_prefix: row.get(9)?,
                prompt_version: row.get(10)?,
                created_at: row.get(11)?,
                mode: row.get(12)?,
                model_id: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

#[tauri::command]
pub(crate) fn delete_conversation_db(
    id: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
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
pub(crate) fn delete_message_db(
    id: String,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.execute("DELETE FROM messages WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn search_messages(
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
pub(crate) fn log_event(
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
pub(crate) fn get_events(
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
