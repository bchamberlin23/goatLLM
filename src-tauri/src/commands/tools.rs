use serde::Deserialize;
use std::fs;
use std::sync::Mutex;

use super::search::normalize_for_fuzzy_match;
use super::workspace::{check_denylist_ws, get_ws_patterns, resolve_path, WorkspaceState};

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

#[tauri::command]
pub(crate) fn exec_command(
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
