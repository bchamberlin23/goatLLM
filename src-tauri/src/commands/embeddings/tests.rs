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
fn test_cosine_handles_empty_or_zero() {
    assert_eq!(cosine(&[], &[]), 0.0);
    assert_eq!(cosine(&[1.0], &[]), 0.0);
    assert_eq!(cosine(&[0.0, 0.0], &[1.0, 1.0]), 0.0);
}
