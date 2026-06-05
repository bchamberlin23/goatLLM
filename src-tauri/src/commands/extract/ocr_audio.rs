use std::fs;

use super::{cap_text, decode_attachment_b64, MAX_OFFICE_BYTES, MAX_OFFICE_TEXT_OUTPUT};

// ── OCR ──────────────────────────────────────────────────────────────

/// Detect whether `tesseract` is available on PATH. The frontend uses this
/// to decide whether to offer OCR fallback for image attachments on
/// non-vision models. Read-only — no side effects, never errors.
#[tauri::command]
pub(crate) fn ocr_available() -> bool {
    use std::process::Command;
    Command::new("tesseract")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run Tesseract OCR on a base64-encoded image and return the extracted
/// text. Used as the text-only-model fallback when the user attaches a
/// photo of homework/whiteboard but the active model can't see images.
///
/// Tesseract isn't bundled with goatLLM — the user installs it themselves
/// (`brew install tesseract` / `apt install tesseract-ocr`). We probe via
/// `ocr_available` before offering the option, so the UX never promises
/// OCR on a system that can't deliver it.
#[tauri::command]
pub(crate) fn ocr_image(data_url: String) -> Result<String, String> {
    use std::io::Write;
    use std::process::Command;
    use std::time::Duration;

    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "image")?;

    // Write to a temp file in a temp dir; tesseract reads from disk.
    let dir = tempfile::tempdir().map_err(|e| format!("Cannot create temp dir: {}", e))?;
    let img_path = dir.path().join("input.png");
    {
        let mut f =
            fs::File::create(&img_path).map_err(|e| format!("Cannot write image: {}", e))?;
        f.write_all(&bytes)
            .map_err(|e| format!("Cannot write image: {}", e))?;
    }

    let out_stem = dir.path().join("out");
    let mut child = Command::new("tesseract")
        .arg(img_path.to_str().unwrap_or("input.png"))
        .arg(out_stem.to_str().unwrap_or("out"))
        .arg("-l")
        .arg("eng") // baseline; users can install more lang packs themselves
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "OCR not available. Install Tesseract (`brew install tesseract` on macOS, `apt install tesseract-ocr` on Linux) and retry.".to_string()
            } else {
                format!("Cannot launch tesseract: {}", e)
            }
        })?;

    // 30s timeout: more than enough for any single image, prevents a hung
    // process from freezing the UI thread.
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let mut err = String::new();
                    if let Some(mut s) = child.stderr.take() {
                        use std::io::Read;
                        let _ = s.read_to_string(&mut err);
                    }
                    return Err(format!("tesseract failed: {}", err.trim()));
                }
                break;
            }
            Ok(None) => {
                if start.elapsed() > Duration::from_secs(30) {
                    let _ = child.kill();
                    return Err("OCR timed out after 30s".to_string());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("tesseract wait failed: {}", e)),
        }
    }

    let txt_path = dir.path().join("out.txt");
    let text =
        fs::read_to_string(&txt_path).map_err(|e| format!("Cannot read OCR output: {}", e))?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("OCR produced no text — image may be too low-resolution or contain no recognizable characters.".to_string());
    }
    Ok(cap_text(trimmed, MAX_OFFICE_TEXT_OUTPUT))
}

// ── Audio transcription ─────────────────────────────────────────────────────

/// Probe whether a whisper-compatible CLI is on PATH. We accept any of
/// these binaries because all three exist in the wild:
///  - `whisper` (OpenAI Python whisper, when pip-installed)
///  - `whisper-cpp` (most common Homebrew/Linux package name)
///  - `whisper.cpp` (occasional alias)
fn whisper_binary() -> Option<&'static str> {
    use std::process::Command;
    ["whisper-cpp", "whisper.cpp", "whisper"]
        .into_iter()
        .find(|candidate| {
            Command::new(candidate)
                .arg("--help")
                .output()
                .map(|o| o.status.success() || !o.stderr.is_empty())
                .unwrap_or(false)
        })
}

#[tauri::command]
pub(crate) fn audio_transcription_available() -> bool {
    whisper_binary().is_some()
}

/// Transcribe an audio attachment via a locally-installed whisper variant.
/// Same UX promise as OCR: probe `audio_transcription_available` first;
/// only call this when it returns true. The frontend never silently
/// promises transcription on a system that can't deliver.
///
/// We accept any common audio container the user might attach
/// (mp3, m4a, wav, flac, ogg, webm). Whisper handles each via ffmpeg.
/// Capped at 50MB input — a 50MB m4a is roughly an hour of speech.
#[tauri::command]
pub(crate) fn transcribe_audio(data_url: String, filename: String) -> Result<String, String> {
    use std::io::Write;
    use std::process::Command;
    use std::time::Duration;

    let bin = whisper_binary().ok_or_else(|| {
        "Audio transcription not available. Install whisper-cpp (`brew install whisper-cpp` on macOS) or pip install openai-whisper, then retry.".to_string()
    })?;

    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "audio")?;
    let dir = tempfile::tempdir().map_err(|e| format!("Cannot create temp dir: {}", e))?;
    // Preserve the original extension so whisper picks the right decoder.
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp3");
    let audio_path = dir.path().join(format!("input.{}", ext));
    {
        let mut f =
            fs::File::create(&audio_path).map_err(|e| format!("Cannot write audio: {}", e))?;
        f.write_all(&bytes)
            .map_err(|e| format!("Cannot write audio: {}", e))?;
    }

    // The two whisper variants take very different flags. Probe by binary
    // name; both end up writing a `<stem>.txt` next to the input.
    let stem = audio_path.with_extension("");
    let stem_str = stem.to_str().unwrap_or("input");
    let mut cmd = Command::new(bin);
    if bin == "whisper-cpp" || bin == "whisper.cpp" {
        cmd.arg("-f")
            .arg(audio_path.to_str().unwrap_or(""))
            .arg("-otxt")
            .arg("-of")
            .arg(stem_str);
    } else {
        // openai-whisper Python package CLI.
        cmd.arg(audio_path.to_str().unwrap_or(""))
            .arg("--output_format")
            .arg("txt")
            .arg("--output_dir")
            .arg(dir.path().to_str().unwrap_or(""));
    }

    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Cannot launch whisper: {}", e))?;

    // Generous 10-minute cap for an hour of audio on a fast machine.
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let mut err = String::new();
                    if let Some(mut s) = child.stderr.take() {
                        use std::io::Read;
                        let _ = s.read_to_string(&mut err);
                    }
                    return Err(format!("whisper failed: {}", err.trim()));
                }
                break;
            }
            Ok(None) => {
                if start.elapsed() > Duration::from_secs(600) {
                    let _ = child.kill();
                    return Err("Audio transcription timed out after 10 minutes".to_string());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(format!("whisper wait failed: {}", e)),
        }
    }

    // Both variants drop a `.txt` next to the input stem.
    let txt_path = std::path::PathBuf::from(format!("{}.txt", stem_str));
    let text =
        fs::read_to_string(&txt_path).map_err(|e| format!("Cannot read transcript: {}", e))?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("Transcript was empty (audio may be silent or unintelligible).".to_string());
    }
    Ok(cap_text(trimmed, MAX_OFFICE_TEXT_OUTPUT))
}
