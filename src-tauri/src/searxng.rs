use serde::Serialize;
use std::fs;
use std::process::Command;
use uuid::Uuid;
use tauri::Emitter;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Debug, Serialize)]
pub struct SearxngStatus {
    pub docker_available: bool,
    pub docker_installed: bool,
    pub daemon_running: bool,
    pub container_exists: bool,
    pub container_running: bool,
    pub is_responding: bool,
    pub port: u16,
}

/// Resolve the docker command path.
fn get_docker_cmd() -> String {
    let probe = if cfg!(windows) { "where" } else { "which" };
    let on_path = Command::new(probe)
        .arg("docker")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if on_path {
        "docker".to_string()
    } else if cfg!(target_os = "macos") {
        let app_path = "/Applications/Docker.app/Contents/Resources/bin/docker";
        if std::path::Path::new(app_path).exists() {
            app_path.to_string()
        } else {
            "docker".to_string()
        }
    } else {
        "docker".to_string()
    }
}

/// Helper to check if docker is installed on PATH or in standard macOS location.
fn is_docker_available() -> bool {
    let probe = if cfg!(windows) { "where" } else { "which" };
    let on_path = Command::new(probe)
        .arg("docker")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if on_path {
        true
    } else if cfg!(target_os = "macos") {
        std::path::Path::new("/Applications/Docker.app").exists()
    } else {
        false
    }
}

/// Check if Docker daemon is running by calling docker info.
fn is_docker_daemon_running() -> bool {
    Command::new(get_docker_cmd())
        .arg("info")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check container status. Returns (exists, running)
fn check_container_status() -> (bool, bool) {
    if !is_docker_available() || !is_docker_daemon_running() {
        return (false, false);
    }
    
    let output = Command::new(get_docker_cmd())
        .args(["inspect", "--format", "{{.State.Running}}", "goatllm-searxng"])
        .output();
        
    match output {
        Ok(out) => {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if stdout == "true" {
                    (true, true)
                } else {
                    (true, false)
                }
            } else {
                (false, false)
            }
        }
        Err(_) => (false, false),
    }
}

/// Check if SearXNG is responding on the local port.
fn is_searxng_responding() -> bool {
    let url = "http://127.0.0.1:8080/";
    // Probe with a quick curl call
    let output = Command::new("curl")
        .args(["-sS", "--max-time", "1.5", "-o", "/dev/null", "-w", "%{http_code}", url])
        .output();
        
    match output {
        Ok(out) => {
            if out.status.success() {
                let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
                code == "200" || code == "302"
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

#[tauri::command]
pub fn searxng_status() -> Result<SearxngStatus, String> {
    let installed = is_docker_available();
    let daemon = if installed { is_docker_daemon_running() } else { false };
    let (exists, running) = if daemon { check_container_status() } else { (false, false) };
    let responding = if running { is_searxng_responding() } else { false };
    
    Ok(SearxngStatus {
        docker_available: installed && daemon,
        docker_installed: installed,
        daemon_running: daemon,
        container_exists: exists,
        container_running: running,
        is_responding: responding,
        port: 8080,
    })
}

#[tauri::command]
pub fn searxng_start() -> Result<String, String> {
    if !is_docker_available() {
        return Err("Docker is not available. Please install Docker Desktop and make sure the daemon is running.".to_string());
    }

    // Ensure settings folder and file exist
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    let config_dir = home.join(".goat").join("searxng");
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config folder: {}", e))?;
        
    let settings_file = config_dir.join("settings.yml");
    if !settings_file.exists() {
        let secret = Uuid::new_v4().to_string();
        let settings_yaml = format!(
            "use_default_settings: true\n\nserver:\n  secret_key: \"{}\"\n\nsearch:\n  formats:\n    - html\n    - json\n",
            secret
        );
        fs::write(&settings_file, settings_yaml)
            .map_err(|e| format!("Failed to write SearXNG settings file: {}", e))?;
    }
    
    let (exists, running) = check_container_status();
    if running {
        return Ok("SearXNG is already running.".to_string());
    }
    
    let settings_path_str = settings_file.to_string_lossy().to_string();
    
    if exists {
        // Just start the existing stopped container
        let output = Command::new(get_docker_cmd())
            .args(["start", "goatllm-searxng"])
            .output()
            .map_err(|e| format!("Failed to run docker start command: {}", e))?;
            
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("Docker start failed: {}", err));
        }
    } else {
        // Run a new container
        let vol_mount = format!("{}:/etc/searxng/settings.yml:ro", settings_path_str);
        
        let output = Command::new(get_docker_cmd())
            .args([
                "run",
                "-d",
                "--name",
                "goatllm-searxng",
                "-p",
                "127.0.0.1:8080:8080",
                "-v",
                &vol_mount,
                "--restart",
                "unless-stopped",
                "docker.io/searxng/searxng:2026.5.31-7159b8aed",
            ])
            .output()
            .map_err(|e| format!("Failed to run docker run command: {}", e))?;
            
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("Docker run failed: {}", err));
        }
    }
    
    // Wait up to 5 seconds for it to start responding
    for _ in 0..10 {
        if is_searxng_responding() {
            return Ok("SearXNG started successfully.".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    
    Ok("SearXNG container spawned but is taking a moment to respond. It should be ready shortly.".to_string())
}

#[tauri::command]
pub fn searxng_stop() -> Result<String, String> {
    if !is_docker_available() {
        return Err("Docker is not available.".to_string());
    }
    
    let (exists, running) = check_container_status();
    if !exists {
        return Ok("SearXNG container does not exist.".to_string());
    }
    if !running {
        return Ok("SearXNG is already stopped.".to_string());
    }
    
    let output = Command::new(get_docker_cmd())
        .args(["stop", "goatllm-searxng"])
        .output()
        .map_err(|e| format!("Failed to run docker stop command: {}", e))?;
        
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Docker stop failed: {}", err));
    }
    
    Ok("SearXNG stopped successfully.".to_string())
}

#[tauri::command]
pub async fn searxng_install_docker(app: tauri::AppHandle) -> Result<String, String> {
    if cfg!(target_os = "macos") {
        // 1. Check if Docker Desktop already exists on disk
        if std::path::Path::new("/Applications/Docker.app").exists() {
            let _ = app.emit("docker-install-progress", "Docker Desktop is already installed at /Applications/Docker.app.");
            let _ = app.emit("docker-install-progress", "Launching Docker Desktop...");
            
            let launch = tokio::process::Command::new("open")
                .args(["-a", "Docker"])
                .output()
                .await
                .map_err(|e| format!("Failed to launch Docker: {}", e))?;
                
            if !launch.status.success() {
                let err = String::from_utf8_lossy(&launch.stderr).trim().to_string();
                return Err(format!(
                    "Docker Desktop is installed but could not be launched automatically. Please open Docker Desktop from your Applications folder.\nError details: {}",
                    err
                ));
            }
            
            return Ok("Docker Desktop is already installed and has been launched. Please wait a few moments for the Docker daemon to start, then try starting SearXNG again.".to_string());
        }

        let brew_check = tokio::process::Command::new("which")
            .arg("brew")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);
            
        if !brew_check {
            return Err("Homebrew (brew) is not installed. Please install Homebrew or install Docker Desktop manually from https://www.docker.com/products/docker-desktop/".to_string());
        }
        
        let mut child = tokio::process::Command::new("brew")
            .args(["install", "--cask", "docker"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn brew command: {}", e))?;
            
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open stderr")?;
        
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        
        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    let _ = app_clone.emit("docker-install-progress", trimmed);
                }
            }
        });
        
        // Accumulate stderr lines so we can report detailed errors if the cask install fails
        use std::sync::{Arc, Mutex};
        let stderr_log = Arc::new(Mutex::new(Vec::new()));
        let stderr_log_clone = stderr_log.clone();
        
        let app_clone_err = app.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                let trimmed = line.trim().to_string();
                if !trimmed.is_empty() {
                    let _ = app_clone_err.emit("docker-install-progress", &trimmed);
                    if let Ok(mut log) = stderr_log_clone.lock() {
                        log.push(trimmed);
                    }
                }
            }
        });
        
        let status = child.wait().await
            .map_err(|e| format!("Failed to wait for brew command: {}", e))?;
            
        if !status.success() {
            let error_details = if let Ok(log) = stderr_log.lock() {
                if log.is_empty() {
                    "No error output captured.".to_string()
                } else {
                    log.join("\n")
                }
            } else {
                "Failed to lock error log buffer.".to_string()
            };
            return Err(format!("Homebrew install failed. Details:\n{}", error_details));
        }
        
        let _ = app.emit("docker-install-progress", "Launching Docker Desktop application...");
        
        let launch = tokio::process::Command::new("open")
            .args(["-a", "Docker"])
            .output()
            .await
            .map_err(|e| format!("Failed to launch Docker: {}", e))?;
            
        if !launch.status.success() {
            return Ok("Docker was installed successfully but could not be launched automatically. Please open Docker Desktop from your Applications folder.".to_string());
        }
        
        Ok("Docker Desktop was successfully installed and launched. Please wait a few moments for the Docker daemon to start, then try starting SearXNG again.".to_string())
    } else {
        Err("Automatic Docker installation is only supported on macOS. Please install Docker for your operating system manually.".to_string())
    }
}

#[tauri::command]
pub async fn searxng_start_docker_daemon() -> Result<String, String> {
    if cfg!(target_os = "macos") {
        let launch = tokio::process::Command::new("open")
            .args(["-a", "Docker"])
            .output()
            .await
            .map_err(|e| format!("Failed to launch Docker: {}", e))?;
            
        if !launch.status.success() {
            let err = String::from_utf8_lossy(&launch.stderr).trim().to_string();
            return Err(format!("Failed to open Docker Desktop: {}", err));
        }
        Ok("Docker Desktop launched successfully. Please wait a few moments for the daemon to initialize.".to_string())
    } else if cfg!(target_os = "linux") {
        let output = tokio::process::Command::new("sudo")
            .args(["systemctl", "start", "docker"])
            .output()
            .await
            .map_err(|e| format!("Failed to run systemctl command: {}", e))?;
            
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("Failed to start Docker service: {}", err));
        }
        Ok("Docker service started successfully.".to_string())
    } else {
        Err("Starting Docker automatically is not supported on this platform. Please launch Docker Desktop manually.".to_string())
    }
}
