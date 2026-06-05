pub(crate) mod ocr_audio;
pub(crate) mod office;

use std::fs;
use std::sync::Mutex;

pub(crate) use ocr_audio::{
    audio_transcription_available, ocr_available, ocr_image, transcribe_audio,
};
pub(crate) use office::{extract_docx_text, extract_pptx_text, extract_xlsx_text};

use super::workspace::{check_denylist_ws, get_ws_patterns, resolve_path, WorkspaceState};

const MAX_PDF_BYTES: u64 = 50 * 1024 * 1024; // 50MB hard cap
const MAX_PDF_TEXT_OUTPUT: usize = 4_000_000; // 4MB extracted text cap (covers full textbooks)

/// Find the largest valid char boundary at or below `idx`. Slicing on a byte
/// index that lands inside a multibyte UTF-8 sequence panics; PDF text often
/// contains non-ASCII so we step back until we hit a char boundary.
pub(crate) fn floor_char_boundary(s: &str, idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }
    let mut i = idx;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Clean up `pdf-extract` output: it emits lots of stray spaces, form-feeds,
/// and broken column reflow which inflates apparent size 2-3x without adding
/// information. Squeezing whitespace before the cap means we keep more real
/// text per file when several PDFs share a budget.
fn normalize_pdf_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_space = false;
    let mut blank_run = 0usize;
    for raw_line in input.split('\n') {
        // Drop form-feeds, NULs, BOMs.
        let cleaned: String = raw_line
            .chars()
            .filter(|c| !matches!(c, '\u{0c}' | '\u{00}' | '\u{feff}'))
            .collect();
        let trimmed = cleaned.trim_end();
        if trimmed.trim().is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                out.push('\n');
            }
            last_was_space = true;
            continue;
        }
        blank_run = 0;
        // Collapse runs of internal whitespace within a line.
        for ch in trimmed.chars() {
            if ch.is_whitespace() {
                if !last_was_space {
                    out.push(' ');
                    last_was_space = true;
                }
            } else {
                out.push(ch);
                last_was_space = false;
            }
        }
        out.push('\n');
        last_was_space = true;
    }
    out.trim().to_string()
}

#[tauri::command]
pub(crate) fn read_pdf(
    workspace: String,
    path: String,
    ws_state: tauri::State<'_, Mutex<WorkspaceState>>,
) -> Result<String, String> {
    let resolved = resolve_path(&workspace, &path)?;
    let ws_patterns = get_ws_patterns(&workspace, &ws_state);
    check_denylist_ws(&resolved, &ws_patterns)?;

    let metadata = fs::metadata(&resolved).map_err(|e| format!("Cannot stat '{}': {}", path, e))?;
    if !metadata.is_file() {
        return Err(format!("'{}' is not a file", path));
    }
    if metadata.len() > MAX_PDF_BYTES {
        return Err(format!(
            "PDF '{}' is {} bytes; max supported is {} bytes (~50MB).",
            path,
            metadata.len(),
            MAX_PDF_BYTES
        ));
    }

    let bytes = fs::read(&resolved).map_err(|e| format!("Cannot read '{}': {}", path, e))?;

    // pdf-extract panics on some malformed PDFs. Catch the panic so we surface
    // a clean error instead of taking the renderer down.
    let extract_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pdf_extract::extract_text_from_mem(&bytes)
    }));

    let raw = match extract_result {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => return Err(format!("PDF parse failed: {}", e)),
        Err(_) => return Err("PDF parser crashed (file may be malformed or encrypted)".to_string()),
    };

    let text = normalize_pdf_text(&raw);
    let bytes_total = text.len();
    let truncated = bytes_total > MAX_PDF_TEXT_OUTPUT;
    let body = if truncated {
        let cut = floor_char_boundary(&text, MAX_PDF_TEXT_OUTPUT);
        format!(
            "{}\n\n… [{} more characters truncated; total extracted text was {} bytes]",
            &text[..cut],
            bytes_total - cut,
            bytes_total
        )
    } else {
        text
    };

    Ok(format!(
        "PDF: {}\nSize: {} bytes\nExtracted: {} bytes{}\n\n---\n\n{}",
        path,
        metadata.len(),
        bytes_total,
        if truncated { " (truncated)" } else { "" },
        body
    ))
}

/// Extract text from a base64-encoded PDF data URL or raw base64 string.
/// Used for inline PDF attachments in chat (no workspace required).
/// Same caps as read_pdf: 50MB input, 200KB extracted text.
#[tauri::command]
pub(crate) fn extract_pdf_text(data_url: String) -> Result<String, String> {
    use base64::Engine;

    // Accept either a `data:application/pdf;base64,...` URL or a bare base64 payload.
    let b64 = if let Some(idx) = data_url.find("base64,") {
        &data_url[idx + "base64,".len()..]
    } else {
        data_url.as_str()
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Invalid base64 PDF data: {}", e))?;

    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err(format!(
            "PDF is {} bytes; max supported is {} bytes (~50MB).",
            bytes.len(),
            MAX_PDF_BYTES
        ));
    }

    // pdf-extract panics on some malformed PDFs. Catch the panic so we surface
    // a clean error instead of taking the renderer down.
    let extract_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pdf_extract::extract_text_from_mem(&bytes)
    }));

    let raw = match extract_result {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => return Err(format!("PDF parse failed: {}", e)),
        Err(_) => return Err("PDF parser crashed (file may be malformed or encrypted)".to_string()),
    };

    let text = normalize_pdf_text(&raw);
    let bytes_total = text.len();
    let truncated = bytes_total > MAX_PDF_TEXT_OUTPUT;
    if truncated {
        let cut = floor_char_boundary(&text, MAX_PDF_TEXT_OUTPUT);
        Ok(format!(
            "{}\n\n… [{} more characters truncated; total extracted text was {} bytes]",
            &text[..cut],
            bytes_total - cut,
            bytes_total
        ))
    } else {
        Ok(text)
    }
}

pub(crate) const MAX_OFFICE_BYTES: u64 = 50 * 1024 * 1024; // 50MB hard cap
pub(crate) const MAX_OFFICE_TEXT_OUTPUT: usize = 4_000_000; // 4MB extracted text cap per file

pub(crate) fn decode_attachment_b64(
    data_url: &str,
    max_bytes: u64,
    label: &str,
) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let b64 = if let Some(idx) = data_url.find("base64,") {
        &data_url[idx + "base64,".len()..]
    } else {
        data_url
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Invalid base64 {} data: {}", label, e))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "{} is {} bytes; max supported is {} bytes (~50MB).",
            label,
            bytes.len(),
            max_bytes
        ));
    }
    Ok(bytes)
}

pub(crate) fn cap_text(text: String, cap: usize) -> String {
    let bytes_total = text.len();
    if bytes_total <= cap {
        text
    } else {
        let cut = floor_char_boundary(&text, cap);
        format!(
            "{}\n\n… [{} more characters truncated; total extracted text was {} bytes]",
            &text[..cut],
            bytes_total - cut,
            bytes_total
        )
    }
}

#[cfg(test)]
mod tests;
