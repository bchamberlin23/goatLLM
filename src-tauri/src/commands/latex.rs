use std::fs;
use tauri::Manager;

fn resolve_latex_engine(app: &tauri::AppHandle) -> Result<(String, &'static str), String> {
    use std::process::Command;

    // 1. tectonic on PATH
    if Command::new("tectonic").arg("--version").output().is_ok() {
        return Ok(("tectonic".to_string(), "tectonic"));
    }
    // 2. pdflatex on PATH
    if Command::new("pdflatex").arg("--version").output().is_ok() {
        return Ok(("pdflatex".to_string(), "pdflatex"));
    }

    // 3. Cached portable tectonic from a previous run
    let bin_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data dir: {}", e))?
        .join("bin");
    let cached = bin_dir.join("tectonic");
    if cached.exists() {
        return Ok((cached.to_string_lossy().to_string(), "tectonic"));
    }

    // 4. Download a portable tectonic binary. Pick the asset for this
    //    platform from the tectonic GitHub releases.
    let asset = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "tectonic-0.15.0-aarch64-apple-darwin.tar.gz",
        ("macos", "x86_64") => "tectonic-0.15.0-x86_64-apple-darwin.tar.gz",
        ("linux", "x86_64") => "tectonic-0.15.0-x86_64-unknown-linux-musl.tar.gz",
        ("linux", "aarch64") => "tectonic-0.15.0-aarch64-unknown-linux-musl.tar.gz",
        (os, arch) => {
            return Err(format!(
            "No portable LaTeX engine available for {} {}. Install tectonic or pdflatex manually.",
            os, arch,
        ))
        }
    };
    let url = format!(
        "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/{}",
        asset,
    );

    fs::create_dir_all(&bin_dir).map_err(|e| format!("Cannot create bin dir: {}", e))?;
    let archive_path = bin_dir.join(asset);

    // Use curl (present on macOS by default; common on Linux). Adding a
    // dedicated HTTP client crate would balloon the bundle for one feature.
    let curl_status = Command::new("curl")
        .args([
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "-o",
            archive_path.to_str().unwrap_or(""),
            &url,
        ])
        .status()
        .map_err(|e| format!("curl not available, cannot fetch tectonic: {}", e))?;
    if !curl_status.success() {
        return Err(format!("Failed to download LaTeX engine from {}", url));
    }

    // Extract the single `tectonic` binary from the tarball.
    let tar_status = Command::new("tar")
        .args([
            "-xzf",
            archive_path.to_str().unwrap_or(""),
            "-C",
            bin_dir.to_str().unwrap_or(""),
            "tectonic",
        ])
        .status()
        .map_err(|e| format!("tar not available, cannot extract tectonic: {}", e))?;
    if !tar_status.success() {
        return Err("Failed to extract LaTeX engine archive.".to_string());
    }
    let _ = fs::remove_file(&archive_path);

    // Mark executable on Unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&cached) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&cached, perms);
        }
    }

    if !cached.exists() {
        return Err("LaTeX engine download succeeded but binary not found in archive.".to_string());
    }
    Ok((cached.to_string_lossy().to_string(), "tectonic"))
}

#[tauri::command]
pub(crate) fn compile_latex(content: String, app: tauri::AppHandle) -> Result<String, String> {
    use std::process::Command;

    let dir = tempfile::tempdir().map_err(|e| format!("Cannot create temp dir: {}", e))?;
    let tex_path = dir.path().join("document.tex");

    fs::write(&tex_path, &content).map_err(|e| format!("Cannot write .tex file: {}", e))?;

    let (engine, kind) = resolve_latex_engine(&app)?;

    let result = if kind == "tectonic" {
        Command::new(&engine)
            .args([
                "-o",
                dir.path().to_str().unwrap_or("."),
                tex_path.to_str().unwrap_or("document.tex"),
            ])
            .current_dir(dir.path())
            .output()
            .map_err(|e| format!("Failed to run LaTeX engine ({}): {}", engine, e))?
    } else {
        Command::new(&engine)
            .args([
                "-interaction=nonstopmode",
                "-output-directory",
                dir.path().to_str().unwrap_or("."),
                tex_path.to_str().unwrap_or("document.tex"),
            ])
            .current_dir(dir.path())
            .output()
            .map_err(|e| format!("Failed to run LaTeX engine ({}): {}", engine, e))?
    };

    let pdf_path = dir.path().join("document.pdf");
    if !pdf_path.exists() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "LaTeX compilation failed. The document may have syntax errors.\n\n{}",
            stderr
                .lines()
                .filter(|l| l.starts_with('!'))
                .take(5)
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }

    let pdf_bytes = fs::read(&pdf_path).map_err(|e| format!("Cannot read compiled PDF: {}", e))?;

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&pdf_bytes);
    Ok(format!("data:application/pdf;base64,{}", b64))
}
