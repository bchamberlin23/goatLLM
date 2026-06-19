/**
 * Attachment extraction — turns chat-attached files into model-readable text.
 *
 * Browsers report inconsistent MIME types (Word docs may come as
 * `application/octet-stream`, .md as `""`, etc.) so every classifier here
 * checks the file extension as a fallback. Extraction itself is dispatched
 * per kind: text-like files are read in JS, binary office formats are
 * round-tripped through Tauri commands that wrap the corresponding Rust
 * crates (pdf-extract, zip+quick-xml, calamine).
 *
 * Used by InputBar.handleSend so a student can upload notes, slides,
 * spreadsheets, or PDFs and have the assistant actually read them.
 */
import type { Attachment } from "../stores/chat";
import {
  formatAttachmentImageReference,
  type AttachmentImageAsset,
} from "./attachment-cache";

export type AttachmentKind =
  | "image"
  | "text"
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "ipynb"
  | "rtf"
  | "audio"
  | "other";

/** Extensions we treat as "plain text" even if the MIME is wrong/empty.
 *  Covers the common study + dev surface: notes, configs, code, data. */
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "rst", "tex", "log", "csv", "tsv", "json", "jsonl",
  "ndjson", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
  "html", "htm", "css", "scss", "sass", "less",
  "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "py", "pyi", "rb", "go", "rs", "java", "kt", "kts", "scala", "swift",
  "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "m", "mm",
  "cs", "fs", "fsx", "vb", "php", "pl", "lua", "r", "jl", "dart", "ex",
  "exs", "erl", "hs", "ml", "clj", "cljs", "edn",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "sql", "graphql", "gql", "proto",
  "vue", "svelte", "astro",
  "gitignore", "dockerfile", "makefile", "cmake",
]);

/** Files we extract via a Rust Tauri command (binary formats).
 *  The mapping is encoded directly in `extractAttachment`'s switch — this list
 *  is for human reference. */
// pdf  → extract_pdf_text
// docx → extract_docx_text
// pptx → extract_pptx_text
// xlsx → extract_xlsx_text

function getExt(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i < 0) return "";
  return filename.slice(i + 1).toLowerCase();
}

/** Pretty label for a file type. Used in the inlined `[Foo: name]` header so
 *  the model has a hint about what it's reading. */
function kindLabel(kind: AttachmentKind): string {
  switch (kind) {
    case "image": return "Image";
    case "text": return "File";
    case "pdf": return "PDF";
    case "docx": return "Word";
    case "pptx": return "Slides";
    case "xlsx": return "Spreadsheet";
    case "ipynb": return "Notebook";
    case "rtf": return "RTF";
    case "audio": return "Audio";
    case "other": return "Attached";
  }
}

/** Classify an attachment so the send pipeline knows how to extract it.
 *  Falls back to extension when MIME is missing or generic
 *  (`application/octet-stream`). */
export function classify(att: Attachment): AttachmentKind {
  const mime = (att.mimeType || "").toLowerCase();
  const ext = getExt(att.filename);

  if (mime.startsWith("image/")) return "image";

  // Office formats first — their MIME, when present, is unambiguous.
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) return "docx";
  if (
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "pptx"
  ) return "pptx";
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xlsx"
  ) return "xlsx";

  if (ext === "ipynb") return "ipynb";
  if (ext === "rtf" || mime === "application/rtf" || mime === "text/rtf") return "rtf";

  // Audio files — covers the common containers a student might upload from
  // a phone or screen recorder. The transcription path is gated on whisper
  // being installed; otherwise these fall back to the unsupported-binary note.
  if (mime.startsWith("audio/") || /\.(mp3|m4a|wav|flac|ogg|webm|mp4|aac)$/i.test(att.filename)) return "audio";

  // Generic text dispatch: real text/* MIME, or known text-like extension.
  if (mime.startsWith("text/")) return "text";
  if (mime === "application/json" || mime === "application/javascript") return "text";
  if (mime.endsWith("+xml") || mime.endsWith("/xml")) return "text";
  if (mime.endsWith("+yaml") || mime.endsWith("/yaml")) return "text";
  if (TEXT_EXTENSIONS.has(ext)) return "text";

  return "other";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read a data URL as text, decoding base64 ourselves so encodings other
 *  than UTF-8 (latin1, utf-16) don't corrupt characters. */
async function dataUrlToText(dataUrl: string): Promise<string> {
  // Branch on whether it's base64-encoded. Browsers encode binary as base64
  // and small text as URI-encoded — handle both.
  const match = /^data:([^;,]+)?(;charset=([^;,]+))?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    const resp = await fetch(dataUrl);
    return resp.text();
  }
  const isBase64 = !!match[4];
  const payload = match[5];
  if (!isBase64) {
    try {
      return decodeURIComponent(payload);
    } catch {
      return payload;
    }
  }
  // base64 → bytes → utf-8 string. TextDecoder handles BOMs gracefully.
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function notebookText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join("") : String(value ?? "");
}

/** Notebook → plain text. Keeps cell ordering, marks code vs markdown,
 *  drops base64 image outputs so a 5MB plot doesn't poison the prompt. */
function ipynbToText(raw: string): string {
  let nb: unknown;
  try {
    nb = JSON.parse(raw);
  } catch {
    return raw; // not valid JSON — let the model see the bytes.
  }
  const parts: string[] = [];
  const cells = isRecord(nb) && Array.isArray(nb.cells) ? nb.cells : [];
  for (let i = 0; i < cells.length; i++) {
    const cell = isRecord(cells[i]) ? cells[i] : {};
    const cellType = String(cell.cell_type || "code");
    const src = notebookText(cell.source);
    if (cellType === "markdown") {
      parts.push(`### Markdown cell ${i + 1}\n${src.trim()}`);
    } else if (cellType === "code") {
      parts.push(`### Code cell ${i + 1}\n\`\`\`\n${src}\n\`\`\``);
      const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
      const textOutputs: string[] = [];
      for (const rawOutput of outputs) {
        const output = isRecord(rawOutput) ? rawOutput : {};
        if (output.output_type === "stream" && typeof output.text !== "undefined") {
          textOutputs.push(notebookText(output.text));
        } else if (isRecord(output.data)) {
          const td = output.data["text/plain"];
          if (typeof td !== "undefined") {
            textOutputs.push(notebookText(td));
          }
        } else if (output.output_type === "error" && Array.isArray(output.traceback)) {
          textOutputs.push(output.traceback.map(String).join("\n"));
        }
      }
      if (textOutputs.length > 0) {
        parts.push(`Output:\n${textOutputs.join("\n").trim()}`);
      }
    } else {
      parts.push(`### ${cellType} cell ${i + 1}\n${src.trim()}`);
    }
  }
  return parts.join("\n\n");
}

/** Extremely loose RTF → text. Strips control words, group braces, and hex
 *  escapes. Good enough for chat context; not a faithful renderer. */
function rtfToText(raw: string): string {
  // Drop \\* groups (font/color tables, pict data, etc.).
  let s = raw.replace(/\{\\\*[^{}]*\}/g, "");
  // Strip remaining control words like \par, \b, \fs24.
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, " ");
  // \\'hh hex-escape → byte (best-effort latin1).
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  // Drop literal braces and stray backslashes.
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\\([^a-zA-Z])/g, "$1");
  // Newlines: \par tokens were already replaced with spaces — re-paragraph on
  // double-space sequences and trim.
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Total character budget for inlined binary-attachment bodies. Sized to
 *  fit comfortably inside a 200K-token context window (the lowest the user
 *  targets), leaving room for system prompt, conversation history, and the
 *  assistant's reply.
 *
 *  When the total exceeds this, we don't truncate — we cache the full text
 *  and inline a navigable preview (outline + head + tail) instead. The
 *  model then uses `read_attachment` / `search_attachment` to pull whatever
 *  sections it actually needs. That way a 600-page book stays usable
 *  without dumping 1.5MB of text into a single message. */
const TOTAL_BINARY_BUDGET = 700_000;
/** Threshold for preview mode: if a single attachment's body is larger
 *  than this, we always preview-and-cache it even if everything else is
 *  small. Models read better with a clean outline + tools than with one
 *  giant 500KB block. */
const PER_FILE_PREVIEW_THRESHOLD = 200_000;

/** Truncate `text` to roughly `maxChars` chars on a word boundary, appending
 *  a clear marker so the model knows the body was clipped and can use the
 *  read_attachment tool to fetch more. */
function truncateBody(text: string, maxChars: number, label: string, filename: string): string {
  if (text.length <= maxChars) return text;
  let cut = maxChars;
  while (cut > maxChars - 200 && cut < text.length && !/\s/.test(text[cut])) cut--;
  if (cut <= 0) cut = maxChars;
  const removed = text.length - cut;
  return `${text.slice(0, cut)}\n\n… [${removed} more characters of ${label} "${filename}" omitted. Call read_attachment(filename: "${filename}", offset: <line>, limit: <count>) or search_attachment(filename: "${filename}", query: "...") to fetch the rest.]`;
}

export interface ExtractedAttachment {
  /** What the model sees. Empty string means the attachment had no text and
   *  should be omitted (e.g. images go through the multimodal path). */
  inlinedText: string;
  /** Brief one-line note for the user-facing chat bubble fallback when no
   *  body is available (e.g. unsupported binary). */
  note?: string;
  kind: AttachmentKind;
  /** Raw extracted body without the `[Kind: name]` header. Used by
   *  `extractAndAppend` to cache full text for tool-based access and to
   *  rebuild a preview when the body is too large to inline. Empty for
   *  images and unsupported binaries. */
  rawBody?: string;
  /** Pretty kind label — "PDF", "Word", etc. */
  label?: string;
  /** True when this looks like a scanned/image-only PDF (post-extract text
   *  was empty/near-empty). The send pipeline routes these through native
   *  PDF parts on Anthropic; other providers see the inline note. */
  scannedPdf?: boolean;
  /** Visual assets extracted from a document. For PDFs these are image
   *  XObjects referenced from the Markdown body and cached for vision models. */
  visualAssets?: AttachmentImageAsset[];
}

interface PdfImageExtraction {
  pageCount: number;
  assets: AttachmentImageAsset[];
}

function normalizePdfAssets(
  filename: string,
  extraction: PdfImageExtraction | null | undefined,
): AttachmentImageAsset[] {
  return (extraction?.assets ?? []).map((asset) => ({
    ...asset,
    sourceFilename: asset.sourceFilename || filename,
  }));
}

function appendPdfVisualReferences(body: string, assets: AttachmentImageAsset[]): string {
  if (assets.length === 0) return body;
  const refs = assets.map(formatAttachmentImageReference).join("\n");
  const heading = assets.length === 1 ? "Extracted PDF image" : "Extracted PDF images";
  return `${body.trim()}\n\n### ${heading}\n${refs}`.trim();
}

/** Extract one attachment to a `[Kind: name]\n<body>` block ready to inline
 *  in the user message. Errors degrade to a clean note instead of throwing. */
export async function extractAttachment(att: Attachment): Promise<ExtractedAttachment> {
  const kind = classify(att);
  const sizeStr = formatSize(att.sizeBytes);
  const header = (label: string) => `[${label}: ${att.filename} (${sizeStr})]`;

  // Images go through the multimodal content-parts path; nothing to inline.
  if (kind === "image") return { kind, inlinedText: "" };

  if (kind === "text") {
    try {
      const text = await dataUrlToText(att.dataUrl);
      return { kind, label: "File", rawBody: text, inlinedText: `[File: ${att.filename}]\n${text}` };
    } catch (e) {
      return {
        kind,
        inlinedText: `${header("File")} (could not decode: ${(e as Error).message ?? e})`,
      };
    }
  }

  if (kind === "ipynb") {
    try {
      const raw = await dataUrlToText(att.dataUrl);
      const body = ipynbToText(raw);
      return { kind, label: "Notebook", rawBody: body, inlinedText: `[Notebook: ${att.filename}]\n${body}` };
    } catch (e) {
      return {
        kind,
        inlinedText: `${header("Notebook")} (could not decode: ${(e as Error).message ?? e})`,
      };
    }
  }

  if (kind === "rtf") {
    try {
      const raw = await dataUrlToText(att.dataUrl);
      const body = rtfToText(raw);
      return {
        kind,
        label: "RTF",
        rawBody: body,
        inlinedText: `[RTF: ${att.filename}]\n${body || "(no extractable text)"}`,
      };
    } catch (e) {
      return {
        kind,
        inlinedText: `${header("RTF")} (could not decode: ${(e as Error).message ?? e})`,
      };
    }
  }

  if (kind === "audio") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const available = await invoke<boolean>("audio_transcription_available").catch(() => false);
      if (!available) {
        return {
          kind,
          label: "Audio",
          rawBody: "",
          inlinedText: `[Audio: ${att.filename} (${sizeStr})] (transcription not available — install whisper-cpp via \`brew install whisper-cpp\` or pip install openai-whisper to enable.)`,
        };
      }
      const transcript = await invoke<string>("transcribe_audio", {
        dataUrl: att.dataUrl,
        filename: att.filename,
      });
      const trimmed = transcript.trim();
      return {
        kind,
        label: "Audio",
        rawBody: trimmed,
        inlinedText: `[Audio: ${att.filename} (${sizeStr})]\n${trimmed || "(transcription was empty)"}`,
      };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return {
        kind,
        label: "Audio",
        inlinedText: `[Audio: ${att.filename}] (transcription failed: ${reason})`,
      };
    }
  }

  if (kind === "pdf" || kind === "docx" || kind === "pptx" || kind === "xlsx") {
    const cmd =
      kind === "pdf" ? "extract_pdf_text"
      : kind === "docx" ? "extract_docx_text"
      : kind === "pptx" ? "extract_pptx_text"
      : "extract_xlsx_text";
    const label = kindLabel(kind);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const text = await invoke<string>(cmd, { dataUrl: att.dataUrl });
      const trimmed = text.trim();
      const visualAssets =
        kind === "pdf"
          ? normalizePdfAssets(
              att.filename,
              await invoke<PdfImageExtraction>("extract_pdf_images", {
                dataUrl: att.dataUrl,
                filename: att.filename,
              }).catch(() => ({ pageCount: 0, assets: [] })),
            )
          : [];
      // A PDF that yields almost no text after a successful parse is almost
      // certainly a scan. Threshold matches what `pdf-extract` typically
      // emits even on scanned pages (page numbers, margins, signatures —
      // <500 chars on anything more than a cover page).
      const looksScanned = kind === "pdf" && trimmed.length < 500;
      const scannedNote =
        "(this PDF appears to be scanned/image-based and yielded little extractable text. Vision models with native PDF support — Claude, GPT-4o, Gemini — receive the file directly; otherwise use read_attachment/search_attachment on the extracted preview or switch to a vision model.)";
      const fallback = kind === "pdf" ? scannedNote : "(no extractable text)";
      const body =
        looksScanned && trimmed.length > 0
          ? `${scannedNote}\n\n${trimmed}`
          : trimmed || fallback;
      const rawBody = appendPdfVisualReferences(body, visualAssets);
      return {
        kind,
        label,
        rawBody,
        scannedPdf: looksScanned,
        visualAssets,
        inlinedText: `[${label}: ${att.filename} (${sizeStr})]\n${rawBody}`,
      };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return {
        kind,
        inlinedText: `[${label}: ${att.filename}] (extraction failed: ${reason})`,
      };
    }
  }

  // Unknown binary — note it, no body.
  return {
    kind: "other",
    inlinedText: `[Attached: ${att.filename} (${sizeStr})]`,
  };
}

/** Extract every attachment, cache the full extracted text per
 *  conversation, and inline either the full body (when small) or a
 *  navigable preview (when too large for one message). The model uses
 *  `read_attachment` / `search_attachment` to pull the rest on demand.
 *
 *  This is the right answer to "the user uploaded a 600-page book":
 *  hard-capping bytes loses content the model needs; offering tools lets
 *  the model fetch exactly the chapter, page range, or matched line it
 *  actually has to read. */
export async function extractAndAppend(
  prose: string,
  attachments: Attachment[],
  conversationId?: string,
): Promise<string> {
  if (attachments.length === 0) return prose;

  // Run all extractors in parallel — 9 PDFs serialised is noticeably slow.
  const blocks = await Promise.all(attachments.map(extractAttachment));

  // Cache the full extracted text for every attachment that produced one.
  // The cache survives across turns within a conversation so subsequent
  // tool calls can navigate the document without re-extracting.
  if (conversationId) {
    const { putAttachmentText } = await import("./attachment-cache");
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const att = attachments[i];
      if (b.rawBody !== undefined) {
        // Cache even empty bodies for scanned PDFs so the send pipeline can
        // detect them by filename and route through native PDF parts.
        putAttachmentText(
          conversationId,
          att.filename,
          b.label ?? "File",
          b.rawBody,
          { scannedPdf: b.scannedPdf, visualAssets: b.visualAssets },
        );
      }
    }
  }

  type Slot = {
    block: ExtractedAttachment;
    att: Attachment;
    header: string;
    body: string;
    /** True if this slot will be replaced by a preview when budget pressure
     *  hits. Images and unknown binaries don't count. */
    countsAgainstBudget: boolean;
    /** True if the body itself is so large we should always preview it,
     *  even when other attachments are tiny. */
    forcePreview: boolean;
  };
  const slots: Slot[] = blocks.map((b, i) => {
    const att = attachments[i];
    if (!b.inlinedText) {
      return { block: b, att, header: "", body: "", countsAgainstBudget: false, forcePreview: false };
    }
    const m = /^(\[[^\]]+\])\n?/.exec(b.inlinedText);
    const header = m ? m[0].replace(/\n$/, "") : "";
    const body = b.rawBody ?? (m ? b.inlinedText.slice(m[0].length) : b.inlinedText);
    return {
      block: b,
      att,
      header,
      body,
      countsAgainstBudget: b.kind !== "other" && b.kind !== "image" && body.length > 0,
      forcePreview: body.length > PER_FILE_PREVIEW_THRESHOLD,
    };
  });

  // Decide which slots go to preview mode. Start with anything over the
  // single-file threshold; if the remaining inlined total still exceeds
  // the budget, demote the largest remaining slots until it fits.
  const previewMode = new Set<number>();
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].forcePreview) previewMode.add(i);
  }
  const recomputeTotal = () =>
    slots.reduce((s, slot, i) => s + (previewMode.has(i) ? 0 : slot.body.length), 0);

  let total = recomputeTotal();
  if (total > TOTAL_BINARY_BUDGET) {
    // Demote in descending body-size order until under budget.
    const order = slots
      .map((s, i) => ({ i, size: s.body.length, eligible: s.countsAgainstBudget }))
      .filter((x) => x.eligible && !previewMode.has(x.i))
      .sort((a, b) => b.size - a.size);
    for (const { i } of order) {
      if (total <= TOTAL_BINARY_BUDGET) break;
      previewMode.add(i);
      total = recomputeTotal();
    }
  }

  // If even after demoting everything we'd still be over budget (huge text
  // file pasted in?), do a final word-boundary truncation on what remains.
  // This is the last-resort fallback — normal binary docs hit preview mode
  // long before this fires.
  if (total > TOTAL_BINARY_BUDGET) {
    const inlineSlots = slots.filter((_s, i) => !previewMode.has(i) && _s.countsAgainstBudget);
    const totalInline = inlineSlots.reduce((s, x) => s + x.body.length, 0);
    if (totalInline > 0) {
      const scale = TOTAL_BINARY_BUDGET / totalInline;
      for (const slot of inlineSlots) {
        const cap = Math.floor(slot.body.length * scale);
        slot.body = truncateBody(slot.body, cap, kindLabel(slot.block.kind), slot.att.filename);
      }
    }
  }

  // Build the preview text for any demoted slot using the cache helper so
  // the preview includes outline + head + tail + tool hint.
  const { getAttachmentText, buildPreview } = await import("./attachment-cache");

  let out = prose;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot.block.inlinedText) continue;

    let piece: string;
    if (previewMode.has(i) && conversationId) {
      const cached = getAttachmentText(conversationId, slot.att.filename);
      if (cached) {
        const sizeStr = formatSize(slot.att.sizeBytes);
        const label = slot.block.label ?? "File";
        piece = `[${label}: ${slot.att.filename} (${sizeStr})]\n${buildPreview(cached)}`;
      } else {
        // Cache write failed for some reason — fall back to truncated body.
        piece = `${slot.header}\n${truncateBody(slot.body, PER_FILE_PREVIEW_THRESHOLD, kindLabel(slot.block.kind), slot.att.filename)}`;
      }
    } else {
      piece = slot.body ? `${slot.header}\n${slot.body}` : slot.block.inlinedText;
    }
    out += (out ? "\n\n" : "") + piece;
  }
  return out;
}
