//! Ollama detection + lifecycle.
//!
//! Goals:
//!  - Detect a system-installed Ollama, even when our GUI process didn't
//!    inherit a useful `PATH` (the common case on macOS — Tauri apps
//!    launched from Finder have a minimal PATH and `which ollama` misses
//!    `/usr/local/bin` and `/opt/homebrew/bin`).
//!  - Probe hardware (RAM, GPU, arch) so we can recommend models that fit.
//!  - Optionally spawn `ollama serve` as a managed child when the user wants
//!    the app to start the daemon for them.
//!
//! Install is the user's responsibility — we surface a one-line setup script
//! per OS in the renderer. Auto-installing Ollama from inside the app is a
//! support nightmare (codesigning, Gatekeeper, sudo prompts) and the
//! upstream installers already do the right thing.
//!
//! Pull/list/delete still flow through Ollama's own HTTP API from the
//! frontend.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

/// Tracks the managed `ollama serve` child. Optional because Ollama may also
/// be running externally (the official macOS app and the Linux systemd unit
/// both auto-start the daemon) — in that case we leave it alone.
pub struct OllamaProcess {
    pub child: Mutex<Option<Child>>,
}

impl OllamaProcess {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct OllamaSystemInfo {
    pub os: &'static str,
    pub arch: &'static str,
    /// Total system RAM in bytes. Used for model recommendations — a 14GB
    /// model on an 8GB machine will swap and hang.
    pub ram_bytes: u64,
    /// CPU brand string when we can resolve it (e.g. "Apple M3 Pro").
    pub cpu_brand: Option<String>,
    /// Number of logical CPUs.
    pub cpu_threads: usize,
    /// True if we detect a GPU likely to be used by Ollama for acceleration.
    /// Apple Silicon → always true (Metal). NVIDIA on linux/windows → true
    /// when `nvidia-smi` works.
    pub has_gpu: bool,
    /// Best-effort GPU name. None when no GPU detected or detection failed.
    pub gpu_name: Option<String>,
    /// Approximate VRAM in bytes, or None if we couldn't read it. On Apple
    /// Silicon this mirrors RAM (unified memory).
    pub vram_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct OllamaStatus {
    /// True if the daemon answered `/api/tags` within the timeout. This is
    /// the most reliable signal — if the API is up, Ollama works regardless
    /// of where the binary lives.
    pub running: bool,
    /// True if our own managed child is alive (we spawned `ollama serve`).
    pub managed: bool,
    /// Path to a discovered Ollama binary, when present. Resolved from PATH
    /// first, then a list of standard install locations per-OS so we still
    /// find it when our process didn't inherit the user's shell PATH.
    pub system_binary_path: Option<String>,
    /// Reported version (e.g. "0.24.0") when the daemon is up.
    pub version: Option<String>,
}

/// Resolve `ollama` on PATH, falling back to standard install locations.
///
/// Why the fallback list matters: a Tauri app launched from Finder on macOS
/// has PATH=`/usr/bin:/bin:/usr/sbin:/sbin`. The official install scripts
/// drop the binary in `/usr/local/bin` or `/opt/homebrew/bin`, neither of
/// which is on that PATH. Without the fallback we'd report "not installed"
/// to a user who literally just ran the setup command we showed them.
fn system_binary() -> Option<String> {
    // 1. PATH lookup — covers shells, terminals, and most Linux desktops.
    let probe = if cfg!(windows) { "where" } else { "which" };
    if let Ok(output) = Command::new(probe).arg("ollama").output() {
        if output.status.success() {
            let out = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = out.lines().next() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && PathBuf::from(trimmed).exists() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    // 2. Standard install locations the upstream installers use. First hit
    //    wins. Order matters — prefer the symlinks the installer drops in
    //    PATH-like locations, fall back to the bundle's internal binary.
    standard_install_paths()
        .into_iter()
        .find(|candidate| PathBuf::from(candidate).exists())
}

/// Paths the upstream Ollama installers write to. Kept in priority order.
fn standard_install_paths() -> Vec<String> {
    match std::env::consts::OS {
        "macos" => vec![
            "/usr/local/bin/ollama".to_string(),
            "/opt/homebrew/bin/ollama".to_string(),
            "/Applications/Ollama.app/Contents/Resources/ollama".to_string(),
            "/Applications/Ollama.app/Contents/MacOS/Ollama".to_string(),
        ],
        "linux" => vec![
            "/usr/local/bin/ollama".to_string(),
            "/usr/bin/ollama".to_string(),
            "/opt/ollama/bin/ollama".to_string(),
        ],
        "windows" => {
            let mut v = Vec::new();
            // The Windows installer drops a per-user copy under LocalAppData
            // and adds it to PATH. We check both so a freshly-launched app
            // (which may not have picked up the new PATH yet) still finds
            // the binary.
            if let Ok(local) = std::env::var("LOCALAPPDATA") {
                v.push(format!("{}\\Programs\\Ollama\\ollama.exe", local));
                v.push(format!("{}\\Programs\\Ollama\\ollama app.exe", local));
            }
            if let Ok(pf) = std::env::var("ProgramFiles") {
                v.push(format!("{}\\Ollama\\ollama.exe", pf));
            }
            v.push("C:\\Program Files\\Ollama\\ollama.exe".to_string());
            v
        }
        _ => Vec::new(),
    }
}

fn ollama_url() -> String {
    std::env::var("OLLAMA_HOST")
        .ok()
        .filter(|s| !s.is_empty())
        .map(|h| {
            if h.starts_with("http://") || h.starts_with("https://") {
                h
            } else {
                format!("http://{}", h)
            }
        })
        .unwrap_or_else(|| "http://127.0.0.1:11434".to_string())
}

/// Hit `/api/version` on the local daemon. Short timeout so we can call this
/// frequently without blocking the UI.
fn probe_version(timeout: Duration) -> Option<String> {
    let url = format!("{}/api/version", ollama_url());
    // We avoid pulling reqwest just for this — curl with a hard timeout does
    // the job. `--max-time` is in seconds, fractional accepted.
    let secs = (timeout.as_millis() as f64) / 1000.0;
    let output = Command::new("curl")
        .args([
            "-sS",
            "--max-time",
            &format!("{:.2}", secs),
            "-o",
            "-",
            &url,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let body = String::from_utf8_lossy(&output.stdout);
    // {"version":"0.24.0"}
    let v = body
        .split("\"version\"")
        .nth(1)?
        .split('"')
        .nth(1)?
        .to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

#[tauri::command]
pub fn ollama_system_info() -> OllamaSystemInfo {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let (ram_bytes, cpu_brand, cpu_threads) = probe_cpu_and_ram();
    let (has_gpu, gpu_name, vram_bytes) = probe_gpu(ram_bytes);

    OllamaSystemInfo {
        os,
        arch,
        ram_bytes,
        cpu_brand,
        cpu_threads,
        has_gpu,
        gpu_name,
        vram_bytes,
    }
}

fn probe_cpu_and_ram() -> (u64, Option<String>, usize) {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    let (ram, brand) = match std::env::consts::OS {
        "macos" => {
            let mem = Command::new("sysctl")
                .args(["-n", "hw.memsize"])
                .output()
                .ok()
                .and_then(|o| {
                    String::from_utf8_lossy(&o.stdout)
                        .trim()
                        .parse::<u64>()
                        .ok()
                })
                .unwrap_or(0);
            let brand = Command::new("sysctl")
                .args(["-n", "machdep.cpu.brand_string"])
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty());
            (mem, brand)
        }
        "linux" => {
            let mut mem = 0u64;
            if let Ok(s) = fs::read_to_string("/proc/meminfo") {
                for line in s.lines() {
                    if let Some(rest) = line.strip_prefix("MemTotal:") {
                        let kb: u64 = rest
                            .split_whitespace()
                            .next()
                            .unwrap_or("0")
                            .parse()
                            .unwrap_or(0);
                        mem = kb * 1024;
                        break;
                    }
                }
            }
            let mut brand: Option<String> = None;
            if let Ok(s) = fs::read_to_string("/proc/cpuinfo") {
                for line in s.lines() {
                    if let Some(rest) = line.strip_prefix("model name") {
                        if let Some(idx) = rest.find(':') {
                            brand = Some(rest[idx + 1..].trim().to_string());
                            break;
                        }
                    }
                }
            }
            (mem, brand)
        }
        "windows" => {
            // wmic is deprecated but still available. Output is multi-line
            // with `TotalPhysicalMemory=...` and `Name=...`.
            let mem = Command::new("wmic")
                .args(["computersystem", "get", "TotalPhysicalMemory", "/value"])
                .output()
                .ok()
                .and_then(|o| {
                    let body = String::from_utf8_lossy(&o.stdout);
                    body.lines()
                        .find_map(|l| l.trim().strip_prefix("TotalPhysicalMemory="))
                        .and_then(|v| v.trim().parse::<u64>().ok())
                })
                .unwrap_or(0);
            let brand = Command::new("wmic")
                .args(["cpu", "get", "Name", "/value"])
                .output()
                .ok()
                .and_then(|o| {
                    let body = String::from_utf8_lossy(&o.stdout);
                    body.lines()
                        .find_map(|l| l.trim().strip_prefix("Name="))
                        .map(|v| v.trim().to_string())
                });
            (mem, brand)
        }
        _ => (0, None),
    };
    (ram, brand, threads)
}

fn probe_gpu(ram_bytes: u64) -> (bool, Option<String>, Option<u64>) {
    // Apple Silicon: GPU is unified-memory Metal. RAM doubles as VRAM.
    if std::env::consts::OS == "macos" && std::env::consts::ARCH == "aarch64" {
        let chip = Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Apple Silicon".to_string());
        return (true, Some(format!("{} (Metal)", chip)), Some(ram_bytes));
    }

    // ── NVIDIA GPU ──
    if let Some((name, vram)) = probe_nvidia_gpu() {
        return (true, Some(name), Some(vram));
    }

    // ── AMD GPU ──
    if let Some((name, vram)) = probe_amd_gpu() {
        return (true, Some(name), Some(vram));
    }

    // Integrated graphics / no detectable GPU: fall back to CPU-only inference.
    (false, None, None)
}

/// Probe NVIDIA GPUs via `nvidia-smi`. Returns (name, vram_bytes) on success.
fn probe_nvidia_gpu() -> Option<(String, u64)> {
    let out = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let body = String::from_utf8_lossy(&out.stdout);
    let line = body.lines().next()?;
    let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
    if parts.len() < 2 {
        return None;
    }
    let mb = parts[1].parse::<u64>().ok()?;
    let vram = mb * 1024 * 1024;
    Some((parts[0].to_string(), vram))
}

/// Probe AMD GPUs (ROCm / DirectML).
///
/// Linux: walks `/sys/class/drm/card*/device/` looking for vendor `0x1002`
/// and reads `mem_info_vram_total` (bytes, available on amdgpu driver with
/// kernel ≥ 4.6).
///
/// Windows: queries `wmic win32_videocontroller` for AdapterRAM on devices
/// whose name contains "AMD" or "Radeon".
fn probe_amd_gpu() -> Option<(String, u64)> {
    match std::env::consts::OS {
        "linux" => probe_amd_linux(),
        "windows" => probe_amd_windows(),
        _ => None,
    }
}

fn probe_amd_linux() -> Option<(String, u64)> {
    let drm = fs::read_dir("/sys/class/drm").ok()?;
    for entry in drm.flatten() {
        let dev = entry.path().join("device");
        let vendor = fs::read_to_string(dev.join("vendor")).ok()?;
        if vendor.trim() != "0x1002" {
            continue;
        }
        let name = fs::read_to_string(dev.join("product_name"))
            .ok()
            .map(|s| s.trim().to_string())?;
        let vram = fs::read_to_string(dev.join("mem_info_vram_total"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())?;
        if vram > 0 {
            return Some((name, vram));
        }
    }
    None
}

fn probe_amd_windows() -> Option<(String, u64)> {
    // wmic outputs columns: AdapterRAM  Name
    // followed by rows:    4293918720  AMD Radeon RX 7900 XTX
    let out = Command::new("wmic")
        .args(["path", "win32_videocontroller", "get", "Name,AdapterRAM"])
        .output()
        .ok()?;
    let body = String::from_utf8_lossy(&out.stdout);
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("AdapterRAM") || line.starts_with("Name") {
            continue;
        }
        let lower = line.to_lowercase();
        if !lower.contains("amd") && !lower.contains("radeon") {
            continue;
        }
        // Line format: "<bytes>  <name …>" — split on first whitespace.
        if let Some(idx) = line.find(char::is_whitespace) {
            let ram_str = line[..idx].trim();
            let name = line[idx..].trim();
            if let Ok(vram) = ram_str.parse::<u64>() {
                if vram > 0 {
                    return Some((name.to_string(), vram));
                }
            }
        }
    }
    None
}

#[tauri::command]
pub fn ollama_status(state: tauri::State<'_, OllamaProcess>) -> Result<OllamaStatus, String> {
    // Probe before binary lookup so we report "running" even if our
    // detection of the on-disk binary fails for any reason — `running` is
    // the only signal that actually matters for using the app.
    let version = probe_version(Duration::from_millis(600));
    let running = version.is_some();

    let system_path = system_binary();

    let managed = state
        .child
        .lock()
        .ok()
        .map(|g| g.as_ref().is_some())
        .unwrap_or(false);

    Ok(OllamaStatus {
        running,
        managed,
        system_binary_path: system_path,
        version,
    })
}

#[tauri::command]
pub fn ollama_start(state: tauri::State<'_, OllamaProcess>) -> Result<String, String> {
    // If already running externally (the official installers leave a daemon
    // running on login), leave it alone — pulls and chats work either way.
    if probe_version(Duration::from_millis(600)).is_some() {
        return Ok("Ollama is already running.".to_string());
    }

    let bin = system_binary().ok_or_else(|| {
        "Ollama isn't installed yet. Run the setup command in Settings, then click Recheck."
            .to_string()
    })?;

    // Don't double-spawn. We treat the existing child as the source of
    // truth; if it died, we'll respawn.
    {
        let mut g = state
            .child
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(c) = g.as_mut() {
            match c.try_wait() {
                Ok(Some(_)) => {
                    // Exited; clear and respawn.
                    *g = None;
                }
                Ok(None) => return Ok("Ollama is starting up.".to_string()),
                Err(_) => {
                    *g = None;
                }
            }
        }
    }

    let mut cmd = Command::new(&bin);
    cmd.arg("serve");
    cmd.stdout(Stdio::null()).stderr(Stdio::null());

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Ollama: {}", e))?;
    {
        let mut g = state
            .child
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *g = Some(child);
    }

    // Wait briefly for the server to come up so the renderer doesn't have to
    // poll. We give it 8s — first launch can take a moment as Ollama warms
    // up its KV cache.
    let deadline = std::time::Instant::now() + Duration::from_secs(8);
    while std::time::Instant::now() < deadline {
        if probe_version(Duration::from_millis(400)).is_some() {
            return Ok(format!("Ollama started ({}).", bin));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Ok(format!(
        "Ollama spawned but didn't answer in 8s — it may still be coming up. Binary: {}",
        bin
    ))
}

#[tauri::command]
pub fn ollama_stop(state: tauri::State<'_, OllamaProcess>) -> Result<String, String> {
    let mut g = state
        .child
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    if let Some(mut c) = g.take() {
        let _ = c.kill();
        let _ = c.wait();
        Ok("Ollama stopped.".to_string())
    } else {
        // The user is probably running the official background daemon.
        // We can't kill it from here — direct them at the right tool.
        Ok("Ollama wasn't started by this app. Use the Ollama menubar icon (macOS) or `systemctl stop ollama` (Linux) to stop the system daemon.".to_string())
    }
}
