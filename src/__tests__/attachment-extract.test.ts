/**
 * Tests for the attachment classifier and marker stripper.
 *
 * Mocks the Tauri invoke bridge so the binary extractors don't actually
 * run — we just verify dispatch and the inline-marker contract that the
 * UI's stripAttachmentMarkers depends on for the chat bubble fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { classify, extractAttachment, extractAndAppend } from "../lib/attachment-extract";
import { stripAttachmentMarkers } from "../components/AttachmentChips";
import type { Attachment } from "../stores/chat";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: { dataUrl: string }) => {
    // Echo a stable string per command so tests can assert dispatch.
    if (cmd === "extract_pdf_text") return "PDF body";
    if (cmd === "extract_docx_text") return "Word body";
    if (cmd === "extract_pptx_text") return "Slide body";
    if (cmd === "extract_xlsx_text") return "Sheet body";
    throw new Error(`unexpected cmd ${cmd} for ${args.dataUrl.slice(0, 20)}`);
  }),
}));

function mk(filename: string, mimeType: string, body = "hello"): Attachment {
  const dataUrl = `data:${mimeType || "application/octet-stream"};base64,${btoa(body)}`;
  return { filename, mimeType, dataUrl, sizeBytes: body.length };
}

describe("classify()", () => {
  it("recognizes pdf by mime", () => {
    expect(classify(mk("a.pdf", "application/pdf"))).toBe("pdf");
  });
  it("recognizes pdf by extension when mime is missing", () => {
    expect(classify(mk("a.pdf", ""))).toBe("pdf");
  });
  it("recognizes docx by extension when mime is octet-stream", () => {
    expect(classify(mk("notes.docx", "application/octet-stream"))).toBe("docx");
  });
  it("recognizes pptx and xlsx by extension", () => {
    expect(classify(mk("deck.pptx", ""))).toBe("pptx");
    expect(classify(mk("grades.xlsx", ""))).toBe("xlsx");
  });
  it("recognizes ipynb and rtf", () => {
    expect(classify(mk("hw.ipynb", ""))).toBe("ipynb");
    expect(classify(mk("essay.rtf", ""))).toBe("rtf");
  });
  it("recognizes plaintext-like extensions when mime is wrong", () => {
    expect(classify(mk("README.md", ""))).toBe("text");
    expect(classify(mk("notes.txt", "application/octet-stream"))).toBe("text");
    expect(classify(mk("data.csv", ""))).toBe("text");
    expect(classify(mk("script.py", ""))).toBe("text");
  });
  it("falls back to other for unknown binaries", () => {
    expect(classify(mk("blob.bin", "application/octet-stream"))).toBe("other");
  });
  it("recognizes audio by mime and extension", () => {
    expect(classify(mk("lecture.mp3", "audio/mpeg"))).toBe("audio");
    expect(classify(mk("lecture.m4a", ""))).toBe("audio");
    expect(classify(mk("voice.wav", "audio/wav"))).toBe("audio");
    expect(classify(mk("recording.flac", ""))).toBe("audio");
  });
});

describe("extractAttachment()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inlines plain text under a [File: ...] header", async () => {
    const r = await extractAttachment(mk("notes.txt", "text/plain", "study hard"));
    expect(r.kind).toBe("text");
    expect(r.inlinedText).toContain("[File: notes.txt]");
    expect(r.inlinedText).toContain("study hard");
  });

  it("dispatches docx through extract_docx_text", async () => {
    const r = await extractAttachment(mk("essay.docx", ""));
    expect(r.kind).toBe("docx");
    expect(r.inlinedText).toContain("[Word: essay.docx");
    expect(r.inlinedText).toContain("Word body");
  });

  it("dispatches xlsx through extract_xlsx_text", async () => {
    const r = await extractAttachment(mk("grades.xlsx", ""));
    expect(r.inlinedText).toContain("[Spreadsheet: grades.xlsx");
    expect(r.inlinedText).toContain("Sheet body");
  });

  it("emits empty body for images (multimodal path)", async () => {
    const r = await extractAttachment(mk("photo.png", "image/png"));
    expect(r.kind).toBe("image");
    expect(r.inlinedText).toBe("");
  });

  it("converts ipynb to a structured transcript", async () => {
    const nb = JSON.stringify({
      cells: [
        { cell_type: "markdown", source: ["# Title"] },
        { cell_type: "code", source: "print(1)\n", outputs: [{ output_type: "stream", text: ["1\n"] }] },
      ],
    });
    const r = await extractAttachment(mk("hw.ipynb", "application/json", nb));
    expect(r.kind).toBe("ipynb");
    expect(r.inlinedText).toContain("Markdown cell 1");
    expect(r.inlinedText).toContain("# Title");
    expect(r.inlinedText).toContain("Code cell 2");
    expect(r.inlinedText).toContain("Output:");
  });

  it("flags scanned PDFs (extracted text < 500 chars) for native-PDF routing", async () => {
    const mod = await import("@tauri-apps/api/core");
    (mod.invoke as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => "page 1\n  \n3");
    const r = await extractAttachment(mk("scan.pdf", "application/pdf"));
    expect(r.kind).toBe("pdf");
    expect(r.scannedPdf).toBe(true);
    expect(r.inlinedText).toMatch(/scanned\/image-based/);
  });

  it("does not flag PDFs with normal extracted text as scanned", async () => {
    const mod = await import("@tauri-apps/api/core");
    const big = "Lorem ipsum dolor sit amet. ".repeat(50); // ~1.4KB
    (mod.invoke as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => big);
    const r = await extractAttachment(mk("paper.pdf", "application/pdf"));
    expect(r.scannedPdf).toBeFalsy();
    expect(r.inlinedText).toContain("Lorem ipsum");
  });
});

describe("stripAttachmentMarkers()", () => {
  it("removes File markers and preserves user prose", () => {
    const content = "summarize this\n\n[File: notes.txt]\nlecture content here";
    expect(stripAttachmentMarkers(content)).toBe("summarize this");
  });

  it("removes PDF, Word, Slides, Spreadsheet markers", () => {
    const content =
      "compare these\n\n[PDF: paper.pdf (12.3 KB)]\nbody1\n\n[Word: doc.docx (1 KB)]\nbody2\n\n[Slides: deck.pptx (1 KB)]\nbody3\n\n[Spreadsheet: grades.xlsx (1 KB)]\nbody4";
    expect(stripAttachmentMarkers(content)).toBe("compare these");
  });

  it("removes Notebook and RTF markers", () => {
    const content = "hi\n\n[Notebook: hw.ipynb]\ncells\n\n[RTF: essay.rtf]\nbody";
    expect(stripAttachmentMarkers(content)).toBe("hi");
  });

  it("removes one-liner Attached markers", () => {
    expect(stripAttachmentMarkers("here\n[Attached: weird.bin (5 KB)]")).toBe("here");
  });

  it("returns empty when prose is just markers", () => {
    expect(stripAttachmentMarkers("[File: a.txt]\nbody")).toBe("");
  });
});

describe("extractAndAppend() multi-attachment budget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the inlined body for a single small PDF intact", async () => {
    const out = await extractAndAppend("summarize", [mk("a.pdf", "application/pdf")]);
    expect(out).toContain("[PDF: a.pdf");
    expect(out).toContain("PDF body");
    expect(out).not.toContain("omitted to fit context");
  });
});
