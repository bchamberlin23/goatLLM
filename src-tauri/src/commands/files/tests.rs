use super::*;

#[test]
fn test_write_temp_file_allows_temp_path() {
    let path = std::env::temp_dir().join(format!("goatllm-write-temp-{}.txt", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let result = write_temp_file(path.to_string_lossy().to_string(), "ok".to_string());
    assert!(result.is_ok());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "ok");
    let _ = std::fs::remove_file(&path);
}

#[cfg(unix)]
#[test]
fn test_write_temp_file_rejects_parent_dir_escape() {
    let cwd = std::env::current_dir().unwrap();
    let filename = format!("goatllm-temp-escape-{}.txt", std::process::id());
    let target = cwd.join(&filename);
    let escaped = std::path::Path::new("/tmp")
        .join("..")
        .join(cwd.strip_prefix("/").unwrap())
        .join(&filename);

    let _ = std::fs::remove_file(&target);
    let result = write_temp_file(escaped.to_string_lossy().to_string(), "nope".to_string());

    assert!(result.is_err());
    assert!(!target.exists());
}

#[test]
fn test_resolve_child_path_allows_nested_relative_path() {
    let tmp = tempfile::tempdir().unwrap();
    let resolved = resolve_child_path(tmp.path(), "skills/impeccable/SKILL.md", "test").unwrap();
    assert!(resolved.starts_with(tmp.path().canonicalize().unwrap()));
    assert!(resolved.ends_with("skills/impeccable/SKILL.md"));
}

#[test]
fn test_resolve_child_path_rejects_parent_escape_before_parent_exists() {
    let tmp = tempfile::tempdir().unwrap();
    let outside = format!("goatllm-child-escape-{}", std::process::id());
    let result = resolve_child_path(tmp.path(), &format!("../{}/skill.md", outside), "test");
    assert!(result.is_err());
    assert!(!tmp.path().parent().unwrap().join(outside).exists());
}
