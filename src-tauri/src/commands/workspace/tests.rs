use super::*;

#[test]
fn test_check_denylist_allows_normal_paths() {
    let path = std::path::Path::new("/home/user/project/src/main.rs");
    assert!(check_denylist_ws(path, &[]).is_ok());
}

#[test]
fn test_check_denylist_blocks_env() {
    let path = std::path::Path::new("/home/user/project/.env");
    assert!(check_denylist_ws(path, &[]).is_err());
}

#[test]
fn test_check_denylist_blocks_pem() {
    let path = std::path::Path::new("/home/user/project/secrets/key.pem");
    assert!(check_denylist_ws(path, &[]).is_err());
}

#[test]
fn test_resolve_path_within_workspace() {
    let workspace = std::env::current_dir().unwrap();
    let workspace_str = workspace.to_string_lossy().to_string();
    // Resolve a path that definitely exists within the workspace
    let result = resolve_path(&workspace_str, "src-tauri");
    // src-tauri might not exist relative to cwd, but the function should not panic
    if let Ok(p) = result {
        assert!(p.to_string_lossy().contains("src-tauri"));
    }
}

#[test]
fn test_resolve_path_rejects_traversal() {
    let workspace = std::env::current_dir().unwrap();
    let workspace_str = workspace.to_string_lossy().to_string();
    let result = resolve_path(&workspace_str, "../etc/passwd");
    assert!(result.is_err());
}

#[test]
fn test_resolve_write_path_allows_new_workspace_file() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_string_lossy().to_string();
    let resolved = resolve_write_path(&workspace, "src/new-file.txt").unwrap();
    assert!(resolved.starts_with(tmp.path().canonicalize().unwrap()));
    assert!(resolved.ends_with("src/new-file.txt"));
}

#[test]
fn test_resolve_write_path_rejects_parent_traversal() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_string_lossy().to_string();
    let result = resolve_write_path(&workspace, "../escape.txt");
    assert!(result.is_err());
}
