//! MCP stdio bridge.
//!
//! Rust-side lifecycle for stdio MCP servers:
//! - Spawn child with cwd = workspace root.
//! - Frame JSON-RPC 2.0 over child stdin/stdout (newline-delimited).
//! - Emit messages back to JS as Tauri events keyed by serverId.
//! - JS-to-child writes flow through a tokio mpsc channel.
//! - Lifecycle: SIGTERM on disconnect, SIGKILL after 5s.
//!
//! HTTP transports are handled entirely in JS via @modelcontextprotocol/sdk.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command as AsyncCommand};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{sleep, Duration};

/// Managed state for all active MCP stdio children.
pub struct McpProcesses {
    pub children: Mutex<HashMap<String, McpChildHandle>>,
}

pub struct McpChildHandle {
    /// Channel to send JSON-RPC messages to the bridge task (which writes to child stdin).
    writer_tx: mpsc::UnboundedSender<String>,
    /// Kill signal for the bridge task.
    kill_tx: oneshot::Sender<()>,
}

impl McpProcesses {
    pub fn new() -> Self {
        Self {
            children: Mutex::new(HashMap::new()),
        }
    }

    /// Get a writer sender for the given server.
    pub fn get_writer(&self, server_id: &str) -> Option<mpsc::UnboundedSender<String>> {
        let g = self.children.lock().unwrap();
        g.get(server_id).map(|h| h.writer_tx.clone())
    }

    /// Remove and clean up a child by id.
    pub fn remove(&self, server_id: &str) -> Option<mpsc::UnboundedSender<String>> {
        let mut g = self.children.lock().unwrap();
        if let Some(h) = g.remove(server_id) {
            let _ = h.kill_tx.send(());
            Some(h.writer_tx)
        } else {
            None
        }
    }
}

async fn kill_child(mut child: Child) {
    if let Err(e) = child.start_kill() {
        eprintln!(
            "SIGTERM failed for MCP child {}: {}",
            child.id().unwrap_or(0),
            e
        );
    }
    let five_sec = sleep(Duration::from_secs(5));
    tokio::pin!(five_sec);
    tokio::select! {
        _ = &mut five_sec => {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        result = child.wait() => {
            let _ = result;
        }
    }
}

/// Spawn an MCP stdio server and start the JSON-RPC bridge.
#[tauri::command]
pub async fn mcp_stdio_spawn(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpProcesses>,
    server_id: String,
    command: String,
    args: Vec<String>,
    workspace: Option<String>,
) -> Result<(), String> {
    {
        let g = state.children.lock().unwrap();
        if g.contains_key(&server_id) {
            return Err(format!("MCP server '{}' is already running", server_id));
        }
    }

    let mut cmd = AsyncCommand::new(&command);
    cmd.args(&args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stdin(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::inherit());

    if let Some(ref ws) = workspace {
        cmd.current_dir(ws);
    }

    // Scrub environment — pass only safe vars.
    cmd.env_clear();
    for (key, val) in std::env::vars() {
        let upper = key.to_uppercase();
        if upper == "PATH"
            || upper == "HOME"
            || upper == "USER"
            || upper == "LANG"
            || upper == "LC_ALL"
            || upper == "TMPDIR"
            || upper == "TMP"
            || upper == "TEMP"
            || upper.starts_with("SSL_")
            || upper.starts_with("NODE_")
            || upper.starts_with("PYTHON")
        {
            cmd.env(key, val);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", command, e))?;

    let stdin = child.stdin.take().ok_or("Cannot capture stdin")?;
    let stdout = child.stdout.take().ok_or("Cannot capture stdout")?;

    let (kill_tx, kill_rx) = oneshot::channel();
    let (writer_tx, writer_rx) = mpsc::unbounded_channel::<String>();

    {
        let mut g = state.children.lock().unwrap();
        g.insert(
            server_id.clone(),
            McpChildHandle {
                writer_tx: writer_tx.clone(),
                kill_tx,
            },
        );
    }

    let app_clone = app.clone();
    let sid = server_id.clone();

    tokio::spawn(async move {
        let result = mcp_bridge(app_clone, sid.clone(), stdin, stdout, kill_rx, writer_rx).await;
        if let Err(e) = &result {
            eprintln!("MCP bridge task error for {}: {}", sid, e);
        }
        // Reap the child after the bridge exits.
        kill_child(child).await;
    });

    Ok(())
}

/// Bridge: read JSON-RPC from child stdout → emit to JS.
///        read JSON-RPC from JS (via channel) → write to child stdin.
async fn mcp_bridge(
    app: tauri::AppHandle,
    server_id: String,
    mut stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    mut kill_rx: oneshot::Receiver<()>,
    mut writer_rx: mpsc::UnboundedReceiver<String>,
) -> Result<(), String> {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    loop {
        tokio::select! {
            _ = &mut kill_rx => {
                break;
            }
            // Read from child stdout → emit to JS
            result = lines.next_line() => {
                match result {
                    Ok(Some(line)) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() { continue; }
                        match serde_json::from_str::<Value>(trimmed) {
                            Ok(msg) => {
                                let _ = app.emit(&format!("mcp-stdio-message:{}", server_id), serde_json::json!({
                                    "serverId": server_id,
                                    "message": msg,
                                }));
                            }
                            Err(e) => {
                                let _ = app.emit(&format!("mcp-stdio-error:{}", server_id), serde_json::json!({
                                    "serverId": server_id,
                                    "error": format!("Invalid JSON-RPC from child: {}", e),
                                }));
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        let _ = app.emit(&format!("mcp-stdio-error:{}", server_id), serde_json::json!({
                            "serverId": server_id,
                            "error": format!("I/O error: {}", e),
                        }));
                        break;
                    }
                }
            }
            // Read from JS channel → write to child stdin
            msg = writer_rx.recv() => {
                match msg {
                    Some(msg) => {
                        if let Err(e) = stdin.write_all(msg.as_bytes()).await {
                            let _ = app.emit(&format!("mcp-stdio-error:{}", server_id), serde_json::json!({
                                "serverId": server_id,
                                "error": format!("Write to child stdin failed: {}", e),
                            }));
                            break;
                        }
                        if let Err(e) = stdin.write_all(b"\n").await {
                            let _ = app.emit(&format!("mcp-stdio-error:{}", server_id), serde_json::json!({
                                "serverId": server_id,
                                "error": format!("Write to child stdin failed: {}", e),
                            }));
                            break;
                        }
                        let _ = stdin.flush().await;
                    }
                    None => break,
                }
            }
        }
    }

    let _ = app.emit(
        &format!("mcp-stdio-close:{}", server_id),
        serde_json::json!({ "serverId": server_id }),
    );

    Ok(())
}

/// Send a JSON-RPC message to the MCP child's stdin via the channel.
#[tauri::command]
pub async fn mcp_stdio_send(
    state: tauri::State<'_, McpProcesses>,
    server_id: String,
    message: Value,
) -> Result<(), String> {
    let msg_str = serde_json::to_string(&message)
        .map_err(|e| format!("Failed to serialize message: {}", e))?;

    let tx = state
        .get_writer(&server_id)
        .ok_or_else(|| format!("MCP server '{}' not found", server_id))?;

    tx.send(msg_str)
        .map_err(|e| format!("Failed to send to MCP child: {}", e))
}

/// Disconnect an MCP server.
#[tauri::command]
pub async fn mcp_stdio_disconnect(
    state: tauri::State<'_, McpProcesses>,
    server_id: String,
) -> Result<(), String> {
    if state.remove(&server_id).is_some() {
        Ok(())
    } else {
        Err(format!("MCP server '{}' not found", server_id))
    }
}
