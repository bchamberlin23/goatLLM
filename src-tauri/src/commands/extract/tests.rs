use super::pdf_images::{extract_pdf_images_from_bytes, mime_type_for_filters, pdf_asset_id};
use super::*;

#[test]
fn test_floor_char_boundary_handles_multibyte_text() {
    let text = "hello नमस्ते";
    let mid_codepoint = "hello न".len() - 1;
    let cut = floor_char_boundary(text, mid_codepoint);
    assert!(text.is_char_boundary(cut));
    assert_eq!(&text[..cut], "hello ");
}

#[test]
fn test_cap_text_does_not_split_utf8() {
    let capped = cap_text("नमस्ते world".to_string(), 5);
    assert!(capped.starts_with("न"));
    assert!(capped.contains("more characters truncated"));
}

#[test]
fn test_pdf_asset_id_sanitizes_filename_and_uses_page_and_index() {
    assert_eq!(
        pdf_asset_id("Physics HW #1.pdf", 3, 12),
        "physics_hw_1_p03_img12"
    );
}

#[test]
fn test_pdf_image_mime_type_for_supported_filters() {
    assert_eq!(
        mime_type_for_filters(&["DCTDecode".to_string()]),
        Some("image/jpeg")
    );
    assert_eq!(
        mime_type_for_filters(&["JPXDecode".to_string()]),
        Some("image/jp2")
    );
    assert_eq!(mime_type_for_filters(&["FlateDecode".to_string()]), None);
}

#[test]
fn test_extract_pdf_images_from_bytes_returns_embedded_jpeg_asset() {
    use lopdf::{dictionary, Document, Object, Stream};

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let page_id = doc.new_object_id();
    let image_id = doc.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => 1,
            "Height" => 1,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
            "Filter" => "DCTDecode",
        },
        b"jpeg-bytes".to_vec(),
    ));
    let content_id = doc.add_object(Stream::new(
        dictionary! {},
        b"q 1 0 0 1 0 0 cm /Im1 Do Q".to_vec(),
    ));
    doc.objects.insert(
        page_id,
        Object::Dictionary(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
            "Resources" => dictionary! {
                "XObject" => dictionary! {
                    "Im1" => image_id,
                },
            },
            "Contents" => content_id,
        }),
    );
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }),
    );
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();

    let value =
        serde_json::to_value(extract_pdf_images_from_bytes(&bytes, "worksheet.pdf").unwrap())
            .unwrap();

    assert_eq!(value["pageCount"], 1);
    assert_eq!(value["assets"].as_array().unwrap().len(), 1);
    assert_eq!(value["assets"][0]["id"], "worksheet_p01_img01");
    assert_eq!(value["assets"][0]["mimeType"], "image/jpeg");
    assert!(value["assets"][0]["dataUrl"]
        .as_str()
        .unwrap()
        .starts_with("data:image/jpeg;base64,"));
}
