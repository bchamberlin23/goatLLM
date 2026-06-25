use serde::Deserialize;
use std::fs;
use std::sync::Mutex;

use super::search::normalize_for_fuzzy_match;
use super::workspace::{check_denylist_ws, get_ws_patterns, resolve_path, WorkspaceState};

const EXEC_STREAM_TAIL_BYTES: usize = 32 * 1024;

#[derive(Debug, Deserialize)]
pub(crate) struct EditReplacement {
    #[serde(rename = "oldText")]
    old_text: String,
    #[serde(rename = "newText")]
    new_text: String,
}

#[tauri::command]
pub(crate) fn edit_file(
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

#[derive(Debug)]
struct StreamTail {
    tail: Vec<u8>,
    total_bytes: usize,
    truncated: bool,
    cap_bytes: usize,
}

impl StreamTail {
    fn new(cap_bytes: usize) -> Self {
        Self {
            tail: Vec::new(),
            total_bytes: 0,
            truncated: false,
            cap_bytes,
        }
    }

    fn push(&mut self, chunk: &[u8]) {
        self.total_bytes += chunk.len();
        self.tail.extend_from_slice(chunk);
        if self.tail.len() > self.cap_bytes {
            let excess = self.tail.len() - self.cap_bytes;
            self.tail.drain(0..excess);
            self.truncated = true;
        }
    }

    fn is_empty(&self) -> bool {
        self.total_bytes == 0
    }

    fn render(&self, label: &str) -> String {
        let mut out = String::new();
        if self.truncated {
            out.push_str(&format!(
                "[{} truncated before IPC: kept last {} of {} bytes]\n",
                label,
                self.tail.len(),
                self.total_bytes
            ));
        }
        out.push_str(&String::from_utf8_lossy(&self.tail));
        out
    }
}

async fn read_stream_tail<R>(mut reader: R) -> Result<StreamTail, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;

    let mut capture = StreamTail::new(EXEC_STREAM_TAIL_BYTES);
    let mut buf = [0_u8; 8192];
    loop {
        let n = reader
            .read(&mut buf)
            .await
            .map_err(|e| format!("Failed to read command output: {}", e))?;
        if n == 0 {
            break;
        }
        capture.push(&buf[..n]);
    }
    Ok(capture)
}

fn render_command_output(
    status: std::process::ExitStatus,
    stdout: StreamTail,
    stderr: StreamTail,
) -> String {
    let mut result = String::new();
    if !stdout.is_empty() {
        result.push_str(&stdout.render("stdout"));
    }
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("[stderr]\n");
        result.push_str(&stderr.render("stderr"));
    }
    if result.is_empty() {
        result = format!("Exit code: {}", status.code().unwrap_or(-1));
    }
    result
}

async fn exec_command_inner(
    workspace: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    use std::process::Stdio;
    use std::time::Duration;
    use tokio::process::Command;

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000));

    let mut child = Command::new("bash")
        .args(["-c", &command])
        .current_dir(&workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let stdout = child.stdout.take().ok_or("Cannot capture stdout")?;
    let stderr = child.stderr.take().ok_or("Cannot capture stderr")?;
    let stdout_task = tokio::spawn(read_stream_tail(stdout));
    let stderr_task = tokio::spawn(read_stream_tail(stderr));

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => return Err(format!("Command error: {}", e)),
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!("Command timed out after {}s", timeout.as_secs()));
        }
    };

    let stdout = stdout_task
        .await
        .map_err(|e| format!("Command stdout task failed: {}", e))??;
    let stderr = stderr_task
        .await
        .map_err(|e| format!("Command stderr task failed: {}", e))??;

    Ok(render_command_output(status, stdout, stderr))
}

#[tauri::command]
pub(crate) async fn exec_command(
    workspace: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    exec_command_inner(workspace, command, timeout_ms).await
}

#[tauri::command]
pub(crate) fn read_lints(workspace: String) -> Result<String, String> {
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

#[cfg(test)]
mod tests {
    use super::exec_command_inner;

    #[tokio::test]
    async fn exec_command_drains_noisy_output_while_waiting_for_exit() {
        let workspace = std::env::temp_dir().to_string_lossy().to_string();
        let result = exec_command_inner(
            workspace,
            "python3 -c 'import sys; sys.stdout.write(\"x\" * 200000)'".to_string(),
            Some(1_000),
        )
        .await;

        assert!(
            result.is_ok(),
            "noisy command should complete instead of blocking on a full stdout pipe: {:?}",
            result
        );
    }
}
