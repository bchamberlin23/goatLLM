use std::process::Command;

/// Check whether `jj` is available on the system PATH.
#[tauri::command]
pub fn is_jj_installed() -> Result<bool, String> {
    let output = Command::new("which")
        .arg("jj")
        .output()
        .map_err(|e| format!("Failed to check for jj: {}", e))?;
    Ok(output.status.success())
}

/// Check whether the given workspace is inside a jj repository.
#[tauri::command]
pub fn is_jj_repo(workspace: String) -> Result<bool, String> {
    let output = Command::new("jj")
        .args(["root"])
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to run jj root: {}", e))?;
    // jj root exits 0 when inside a jj repo, non-zero otherwise.
    Ok(output.status.success())
}

/// Create a new empty jj change as a descendant of the current working copy.
/// Returns the short change ID.
#[tauri::command]
pub fn jj_new(workspace: String, description: String) -> Result<String, String> {
    let output = Command::new("jj")
        .args(["new", "-m", &description])
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to run jj new: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let msg = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        return Err(format!("jj new failed: {}", msg));
    }

    // jj new outputs something like "Working copy now at: yxwxvxrl 823b2f37 (empty) (no description set)"
    // Extract the change ID (the short hex after the colon-space).
    let change_id = stdout
        .lines()
        .find_map(|line| {
            line.strip_prefix("Working copy now at: ")
                .or_else(|| line.strip_prefix("Created new commit "))
        })
        .and_then(|rest| {
            rest.split_whitespace().next().map(|s| s.to_string())
        })
        .unwrap_or_default();

    if change_id.is_empty() {
        // Fallback: try to parse from any output
        let trimmed = stdout.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.split_whitespace().next().unwrap_or("").to_string());
        }
        return Err("jj new succeeded but could not parse change ID".to_string());
    }

    Ok(change_id)
}

/// Update the description of a jj change (adds/updates the Claude-session-id trailer).
#[tauri::command]
pub fn jj_describe(workspace: String, change_id: String, description: String) -> Result<(), String> {
    let output = Command::new("jj")
        .args(["describe", "-m", &description, "-r", &change_id])
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to run jj describe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("jj describe failed: {}", stderr.trim()));
    }

    Ok(())
}

/// Squash the agent change into its parent (@-).
/// jj new created the change as a child of @, and @ was moved to the new change.
/// After agent edits happen on @, we want to squash @ into its parent so @ returns
/// to being the parent (the "user's working copy").
///
/// The flow is:
///   1. jj new → @ is at the fresh agent change, @- is the user's working copy
///   2. Agent edits files → those edits live on @
///   3. jj squash --into @- → squashes @ into @-, moving @ back to the result
///
/// We use --revision with the change_id to specify which change to squash,
/// targeting its parent.
#[tauri::command]
pub fn jj_squash(workspace: String, change_id: String) -> Result<(), String> {
    let output = Command::new("jj")
        .args(["squash", "--revision", &change_id])
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to run jj squash: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("jj squash failed: {}", stderr.trim()));
    }

    Ok(())
}

/// Abandon a change (used for cleanup on error).
#[tauri::command]
pub fn jj_abandon(workspace: String, change_id: String) -> Result<(), String> {
    let output = Command::new("jj")
        .args(["abandon", "-r", &change_id])
        .current_dir(&workspace)
        .output()
        .map_err(|e| format!("Failed to run jj abandon: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("jj abandon failed: {}", stderr.trim()));
    }

    Ok(())
}
