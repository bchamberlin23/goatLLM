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
