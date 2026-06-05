use super::*;
use std::io::Write;
use std::path::Path;
use tempfile::Builder;

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
    let hits = search_content_impl(ws, "foo".to_string(), None, Some(1), Some(true), &[]).unwrap();
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

    let hits = search_content_impl(ws, "SECRET_TOKEN".to_string(), None, None, None, &[]).unwrap();

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].file, "visible.txt");
}
