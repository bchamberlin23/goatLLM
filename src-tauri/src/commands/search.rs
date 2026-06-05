use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use super::workspace::{check_denylist_ws, get_ws_patterns, WorkspaceState};

#[derive(Debug, Serialize)]
pub(crate) struct SearchMatch {
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

pub(crate) fn normalize_for_fuzzy_match(s: &str) -> String {
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
pub(crate) fn search_content(
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

pub(crate) fn search_content_impl(
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

#[cfg(test)]
mod tests;
