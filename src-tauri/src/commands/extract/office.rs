use super::{cap_text, decode_attachment_b64, MAX_OFFICE_BYTES, MAX_OFFICE_TEXT_OUTPUT};

/// Pull text content out of an Office Open XML part (document.xml, slide*.xml,
/// etc.) by reading <w:t>, <a:t>, and <t> text runs and inserting newlines on
/// paragraph and break boundaries. Good enough for chat-context usage; not a
/// faithful Word renderer.
fn xml_to_text(xml: &[u8]) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    let mut reader = Reader::from_reader(xml);
    reader.trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut in_text_run = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = e.name();
                let local = name.local_name();
                let lname = std::str::from_utf8(local.as_ref()).unwrap_or("");
                if lname == "t" {
                    in_text_run = true;
                }
            }
            Ok(Event::End(ref e)) => {
                let name = e.name();
                let local = name.local_name();
                let lname = std::str::from_utf8(local.as_ref()).unwrap_or("");
                if lname == "t" {
                    in_text_run = false;
                } else if lname == "p" || lname == "tr" {
                    out.push('\n');
                } else if lname == "tc" {
                    out.push('\t');
                }
            }
            Ok(Event::Empty(ref e)) => {
                let name = e.name();
                let local = name.local_name();
                let lname = std::str::from_utf8(local.as_ref()).unwrap_or("");
                if lname == "br" || lname == "cr" {
                    out.push('\n');
                } else if lname == "tab" {
                    out.push('\t');
                }
            }
            Ok(Event::Text(t)) if in_text_run => {
                let s = t
                    .unescape()
                    .map_err(|e| format!("XML decode failed: {}", e))?;
                out.push_str(&s);
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(format!(
                    "XML parse failed at {}: {}",
                    reader.buffer_position(),
                    e
                ))
            }
            _ => {}
        }
        buf.clear();
    }
    // Collapse runs of blank lines.
    let cleaned = out
        .lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    let mut prev_blank = false;
    let mut compact = String::with_capacity(cleaned.len());
    for line in cleaned.lines() {
        let blank = line.trim().is_empty();
        if blank && prev_blank {
            continue;
        }
        compact.push_str(line);
        compact.push('\n');
        prev_blank = blank;
    }
    Ok(compact.trim().to_string())
}

/// Extract text from a base64-encoded .docx (Word) attachment.
#[tauri::command]
pub(crate) fn extract_docx_text(data_url: String) -> Result<String, String> {
    use std::io::Read;
    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "DOCX")?;
    let cursor = std::io::Cursor::new(&bytes);
    let mut zip =
        zip::ZipArchive::new(cursor).map_err(|e| format!("DOCX is not a valid zip: {}", e))?;
    let mut document_xml = Vec::new();
    {
        let mut entry = zip
            .by_name("word/document.xml")
            .map_err(|_| "DOCX missing word/document.xml (encrypted or malformed?)".to_string())?;
        entry
            .read_to_end(&mut document_xml)
            .map_err(|e| format!("Cannot read document.xml: {}", e))?;
    }
    let text = xml_to_text(&document_xml)?;
    if text.trim().is_empty() {
        return Err("DOCX contained no extractable text".to_string());
    }
    Ok(cap_text(text, MAX_OFFICE_TEXT_OUTPUT))
}

/// Extract text from a base64-encoded .pptx (PowerPoint) attachment. Each
/// slide's text is emitted under a `--- Slide N ---` header so the model can
/// reason about slide structure.
#[tauri::command]
pub(crate) fn extract_pptx_text(data_url: String) -> Result<String, String> {
    use std::io::Read;
    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "PPTX")?;
    let cursor = std::io::Cursor::new(&bytes);
    let mut zip =
        zip::ZipArchive::new(cursor).map_err(|e| format!("PPTX is not a valid zip: {}", e))?;

    // Collect slide names so we can emit them in order: slide1, slide2, …
    let mut slide_names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|e| e.name().to_string()))
        .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
        .collect();
    slide_names.sort_by_key(|n| {
        // Extract the trailing number for natural ordering: slide2 < slide10.
        n.trim_start_matches("ppt/slides/slide")
            .trim_end_matches(".xml")
            .parse::<u32>()
            .unwrap_or(u32::MAX)
    });
    if slide_names.is_empty() {
        return Err("PPTX contained no slides".to_string());
    }

    let mut out = String::new();
    for (idx, name) in slide_names.iter().enumerate() {
        let mut xml = Vec::new();
        {
            let mut entry = zip
                .by_name(name)
                .map_err(|e| format!("Cannot open {}: {}", name, e))?;
            entry
                .read_to_end(&mut xml)
                .map_err(|e| format!("Cannot read {}: {}", name, e))?;
        }
        let slide_text = xml_to_text(&xml).unwrap_or_default();
        out.push_str(&format!("--- Slide {} ---\n", idx + 1));
        if slide_text.trim().is_empty() {
            out.push_str("(no text on this slide)\n");
        } else {
            out.push_str(&slide_text);
            out.push('\n');
        }
        out.push('\n');
    }

    Ok(cap_text(out.trim().to_string(), MAX_OFFICE_TEXT_OUTPUT))
}

/// Extract text from a base64-encoded .xlsx (Excel) attachment. Each sheet is
/// emitted under a `--- Sheet: <name> ---` header as TSV so the model can read
/// it as a table.
#[tauri::command]
pub(crate) fn extract_xlsx_text(data_url: String) -> Result<String, String> {
    use calamine::{open_workbook_from_rs, Data, Reader, Xlsx};
    let bytes = decode_attachment_b64(&data_url, MAX_OFFICE_BYTES, "XLSX")?;
    let cursor = std::io::Cursor::new(bytes);
    let mut wb: Xlsx<_> = open_workbook_from_rs(cursor)
        .map_err(|e| format!("XLSX is not a valid workbook: {}", e))?;
    let sheet_names = wb.sheet_names().to_vec();
    if sheet_names.is_empty() {
        return Err("XLSX contained no sheets".to_string());
    }
    let mut out = String::new();
    for name in &sheet_names {
        let range = match wb.worksheet_range(name) {
            Ok(r) => r,
            Err(e) => {
                out.push_str(&format!(
                    "--- Sheet: {} ---\n(failed to read: {})\n\n",
                    name, e
                ));
                continue;
            }
        };
        out.push_str(&format!("--- Sheet: {} ---\n", name));
        if range.is_empty() {
            out.push_str("(empty)\n\n");
            continue;
        }
        // Cap rows so a 100k-row sheet doesn't blow the output cap on its own.
        for (rows, row) in range.rows().enumerate() {
            if rows >= 5_000 {
                out.push_str("… (additional rows truncated)\n");
                break;
            }
            let cells: Vec<String> = row
                .iter()
                .map(|c| match c {
                    Data::Empty => String::new(),
                    Data::String(s) => s.clone(),
                    Data::Float(f) => {
                        if f.fract() == 0.0 && f.abs() < 1e15 {
                            format!("{}", *f as i64)
                        } else {
                            format!("{}", f)
                        }
                    }
                    Data::Int(i) => i.to_string(),
                    Data::Bool(b) => b.to_string(),
                    Data::DateTime(dt) => format!("{}", dt.as_f64()),
                    Data::DateTimeIso(s) => s.clone(),
                    Data::DurationIso(s) => s.clone(),
                    Data::Error(e) => format!("#ERR({:?})", e),
                })
                .collect();
            out.push_str(&cells.join("\t"));
            out.push('\n');
        }
        out.push('\n');
    }
    Ok(cap_text(out.trim().to_string(), MAX_OFFICE_TEXT_OUTPUT))
}
