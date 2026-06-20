use base64::Engine;
use serde::Serialize;

use super::{decode_attachment_b64, MAX_PDF_BYTES};

const MAX_PDF_IMAGE_ASSETS: usize = 24;
const MAX_PDF_IMAGE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfVisualAsset {
    id: String,
    source_filename: String,
    filename: String,
    page: u32,
    mime_type: String,
    data_url: String,
    width: Option<i64>,
    height: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfImageExtraction {
    page_count: usize,
    assets: Vec<PdfVisualAsset>,
}

pub(crate) fn pdf_asset_id(filename: &str, page: u32, index: usize) -> String {
    let stem = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("pdf");
    let mut out = String::with_capacity(stem.len() + 16);
    let mut last_was_sep = false;
    for ch in stem.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_was_sep = false;
        } else if !last_was_sep && !out.is_empty() {
            out.push('_');
            last_was_sep = true;
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("pdf");
    }
    format!("{}_p{:02}_img{:02}", out, page, index)
}

pub(crate) fn mime_type_for_filters(filters: &[String]) -> Option<&'static str> {
    filters.iter().find_map(|filter| match filter.as_str() {
        "DCTDecode" => Some("image/jpeg"),
        "JPXDecode" => Some("image/jp2"),
        _ => None,
    })
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/jp2" => "jp2",
        _ => "bin",
    }
}

#[tauri::command]
pub(crate) fn extract_pdf_images(
    data_url: String,
    filename: String,
) -> Result<PdfImageExtraction, String> {
    let bytes = decode_attachment_b64(&data_url, MAX_PDF_BYTES, "PDF")?;
    extract_pdf_images_from_bytes(&bytes, &filename)
}

pub(crate) fn extract_pdf_images_from_bytes(
    bytes: &[u8],
    filename: &str,
) -> Result<PdfImageExtraction, String> {
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err(format!(
            "PDF is {} bytes; max supported is {} bytes (~50MB).",
            bytes.len(),
            MAX_PDF_BYTES
        ));
    }
    let doc =
        lopdf::Document::load_mem(&bytes).map_err(|e| format!("PDF image parse failed: {}", e))?;
    let pages = doc.get_pages();
    let page_count = pages.len();
    let mut assets = Vec::new();

    for (page, page_id) in pages {
        let page_images = match doc.get_page_images(page_id) {
            Ok(images) => images,
            Err(_) => continue,
        };
        let mut page_index = 0usize;
        for image in page_images {
            if assets.len() >= MAX_PDF_IMAGE_ASSETS {
                break;
            }
            if image.content.is_empty() || image.content.len() > MAX_PDF_IMAGE_BYTES {
                continue;
            }
            let filters = image.filters.clone().unwrap_or_default();
            let Some(mime_type) = mime_type_for_filters(&filters) else {
                continue;
            };
            page_index += 1;
            let id = pdf_asset_id(filename, page, page_index);
            let ext = extension_for_mime(mime_type);
            let encoded = base64::engine::general_purpose::STANDARD.encode(image.content);
            assets.push(PdfVisualAsset {
                id: id.clone(),
                source_filename: filename.to_string(),
                filename: format!("{}.{}", id, ext),
                page,
                mime_type: mime_type.to_string(),
                data_url: format!("data:{};base64,{}", mime_type, encoded),
                width: Some(image.width),
                height: Some(image.height),
            });
        }
        if assets.len() >= MAX_PDF_IMAGE_ASSETS {
            break;
        }
    }

    Ok(PdfImageExtraction { page_count, assets })
}
