use super::workspace::resolve_path;

#[tauri::command]
pub(crate) fn diff_file(workspace: String, path: String) -> Result<String, String> {
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
pub(crate) fn git_branch(
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
        _ => Err(format!(
            "Unknown git_branch action: '{}'. Use list, current, create, or switch.",
            action
        )),
    }
}

#[tauri::command]
pub(crate) fn git_commit(
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
pub(crate) fn git_push(
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
pub(crate) fn git_log(
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
pub(crate) fn git_blame(
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
pub(crate) fn git_status(workspace: String) -> Result<String, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
