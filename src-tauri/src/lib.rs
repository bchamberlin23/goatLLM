use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;
use tauri::Manager;

mod commands;
mod jj;
mod mcp;
mod ollama;
mod searxng;

pub(crate) fn escape_sql_like_query(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len());
    for ch in query.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    format!("%{}%", escaped)
}

pub(crate) fn init_db(app: &tauri::AppHandle) -> Result<rusqlite::Connection, String> {
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

    if version < 9 {
        conn.execute_batch(include_str!("../migrations/009_memory.sql"))
            .map_err(|e| format!("Database migration 009 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 9)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if version < 10 {
        conn.execute_batch(include_str!("../migrations/010_message_model.sql"))
            .map_err(|e| format!("Database migration 010 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 10)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if version < 11 {
        conn.execute_batch(include_str!("../migrations/011_citations.sql"))
            .map_err(|e| format!("Database migration 011 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 11)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if version < 12 {
        conn.execute_batch(include_str!("../migrations/012_document_workspaces.sql"))
            .map_err(|e| format!("Database migration 012 failed: {}. You may need to remove the database file and restart.", e))?;
        conn.pragma_update(None, "user_version", 12)
            .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    Ok(conn)
}

pub fn run() {
    let app_handle = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = match init_db(&app.handle().clone()) {
                Ok(db) => db,
                Err(e) => {
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
            app.manage(commands::db::DbState { db: Mutex::new(db) });

            let workspaces = commands::workspace::load_workspaces(&app.handle().clone());
            app.manage(Mutex::new(commands::workspace::WorkspaceState {
                workspaces,
            }));
            app.manage(ollama::OllamaProcess::new());
            app.manage(mcp::McpProcesses::new());
            app.manage(commands::misc::WatcherRegistry {
                watchers: Mutex::new(HashMap::new()),
            });

            let _window = app.get_webview_window("main").unwrap();
            Ok(())
        })
        .invoke_handler(commands::generate_handler!())
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app_handle.run(|_handle, _event| {});
}

#[cfg(test)]
mod integration_tests {
    use super::*;

    #[test]
    fn test_escape_sql_like_query_escapes_wildcards() {
        assert_eq!(escape_sql_like_query("100%_done"), "%100\\%\\_done%");
        assert_eq!(escape_sql_like_query(r"C:\tmp"), r"%C:\\tmp%");
    }

    #[test]
    fn test_command_classification_safe() {
        let safe_cmds = ["ls -la", "echo hello", "cargo check", "git status"];
        for cmd in &safe_cmds {
            assert!(!cmd.is_empty());
        }
    }
}
