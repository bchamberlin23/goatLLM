/**
 * Attachment cache — full extracted text of every file the user attaches,
 * keyed by conversation + filename, kept in memory for the session.
 *
 * Why this exists: a 600-page book is too big to inline into a single
 * message even on a 200K-token model. Instead of hard-capping the body,
 * we cache the full text here and expose `read_attachment` /
 * `search_attachment` tools so the model can fetch the parts it needs on
 * demand. The user message still inlines a smart preview so the model
 * always knows the document exists and roughly what's in it.
 *
 * In-memory only by design: the underlying `Attachment.dataUrl` is already
 * persisted in the messages table, so re-extraction on app restart costs
 * a couple seconds per attachment but doesn't lose data. Persisting the
 * raw extracted text would balloon the SQLite DB for marginal benefit.
 */
import type { Attachment } from "../stores/chat";

export interface AttachmentImageAsset {
  /** Stable model-visible id, e.g. `worksheet_p03_img02`. */
  id: string;
  /** Original attachment filename this asset came from. */
  sourceFilename: string;
  /** Derived asset filename for display/download surfaces. */
  filename: string;
  page: number;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface CachedAttachment {
  conversationId: string;
  filename: string;
  /** Pretty label for the inline header — "PDF", "Word", "Slides", etc. */
  kindLabel: string;
  /** Full extracted text, post-normalization. Never truncated. */
  fullText: string;
  /** Cheap line index for offset-based reads. */
  totalLines: number;
  /** Convenience: total chars in fullText. */
  totalChars: number;
  /** Sniffed outline (markdown headings, slide titles, sheet names, page
   *  markers) so we can show a navigable preview without reading the body. */
  outline: string[];
  /** True when the source file is a PDF that yielded suspiciously little
   *  text (likely a scanned/image-only document). The send pipeline uses
   *  this to route through provider-native PDF parts (Anthropic) or to
   *  surface a clear "please use a vision model" note elsewhere. */
  scannedPdf?: boolean;
  /** Visual assets extracted from a source document. For PDFs these are
   *  image XObjects referenced from the Markdown body with
   *  `attachment-image://<pdf>/<asset-id>` URLs. */
  visualAssets?: AttachmentImageAsset[];
}

const cache = new Map<string, CachedAttachment>();

function key(conversationId: string, filename: string): string {
  return `${conversationId}\u0000${filename}`;
}

export function putAttachmentText(
  conversationId: string,
  filename: string,
  kindLabel: string,
  fullText: string,
  options?: { scannedPdf?: boolean; visualAssets?: AttachmentImageAsset[] },
): CachedAttachment {
  const totalLines = fullText.split("\n").length;
  const outline = sniffOutline(fullText, kindLabel);
  const entry: CachedAttachment = {
    conversationId,
    filename,
    kindLabel,
    fullText,
    totalLines,
    totalChars: fullText.length,
    outline,
    scannedPdf: options?.scannedPdf,
    visualAssets: options?.visualAssets,
  };
  cache.set(key(conversationId, filename), entry);
  return entry;
}

/** True when the cached attachment looks like a scanned PDF (PDF kind, very
 *  little extracted text). Used by the send pipeline to route the file
 *  through provider-native PDF parts on Anthropic, where server-side OCR
 *  handles it. */
export function isLikelyScannedPdf(conversationId: string, filename: string): boolean {
  const entry = cache.get(key(conversationId, filename));
  return !!entry?.scannedPdf;
}

export function getAttachmentText(
  conversationId: string,
  filename: string,
): CachedAttachment | undefined {
  return cache.get(key(conversationId, filename));
}

export function listAttachments(conversationId: string): CachedAttachment[] {
  const out: CachedAttachment[] = [];
  for (const v of cache.values()) {
    if (v.conversationId === conversationId) out.push(v);
  }
  return out;
}

export function listAttachmentImages(
  conversationId: string,
  filename?: string,
): AttachmentImageAsset[] {
  const out: AttachmentImageAsset[] = [];
  for (const entry of cache.values()) {
    if (entry.conversationId !== conversationId) continue;
    if (filename && entry.filename !== filename) continue;
    out.push(...(entry.visualAssets ?? []));
  }
  return out;
}

export function getAttachmentImage(
  conversationId: string,
  filename: string,
  imageId: string,
): AttachmentImageAsset | undefined {
  return getAttachmentText(conversationId, filename)?.visualAssets?.find(
    (asset) => asset.id === imageId,
  );
}

export function hasAttachments(conversationId: string): boolean {
  for (const v of cache.values()) {
    if (v.conversationId === conversationId) return true;
  }
  return false;
}

export function formatAttachmentImageReference(asset: AttachmentImageAsset): string {
  const dimensions =
    asset.width && asset.height ? `, ${asset.width}x${asset.height}` : "";
  const label = `${asset.id} — page ${asset.page}${dimensions}`;
  const source = encodeURIComponent(asset.sourceFilename);
  const id = encodeURIComponent(asset.id);
  return `![${label}](attachment-image://${source}/${id})`;
}

/** Drop everything for a conversation (e.g. on delete). */
export function clearConversation(conversationId: string): void {
  for (const k of [...cache.keys()]) {
    if (cache.get(k)?.conversationId === conversationId) cache.delete(k);
  }
}

/** Read a slice of an attachment's text by line offset + line count.
 *  1-indexed offsets feel more natural to humans (and models). */
export function readSlice(
  entry: CachedAttachment,
  offset: number,
  limit: number,
): { content: string; startLine: number; endLine: number; truncated: boolean } {
  const lines = entry.fullText.split("\n");
  const start = Math.max(1, Math.floor(offset || 1));
  const lim = Math.max(1, Math.min(2_000, Math.floor(limit || 200)));
  const startIdx = start - 1;
  const endIdx = Math.min(lines.length, startIdx + lim);
  const slice = lines.slice(startIdx, endIdx).join("\n");
  return {
    content: slice,
    startLine: start,
    endLine: endIdx,
    truncated: endIdx < lines.length,
  };
}

/** Search for `query` in the attachment's text. Case-insensitive substring
 *  match by default; supports a leading `/.../` form for regex. Returns up
 *  to `maxResults` matches with surrounding context lines. */
export function searchAttachment(
  entry: CachedAttachment,
  query: string,
  options?: { maxResults?: number; contextLines?: number; caseSensitive?: boolean },
): Array<{ line: number; content: string; context: string[] }> {
  const maxResults = Math.max(1, Math.min(50, options?.maxResults ?? 10));
  const contextLines = Math.max(0, Math.min(5, options?.contextLines ?? 2));
  const lines = entry.fullText.split("\n");

  let matcher: (line: string) => boolean;
  const regexMatch = /^\/(.+)\/([gimsu]*)$/.exec(query);
  if (regexMatch) {
    try {
      const re = new RegExp(regexMatch[1], regexMatch[2] || "i");
      matcher = (l) => re.test(l);
    } catch {
      // Fall through to substring match if regex is invalid.
      const needle = query.toLowerCase();
      matcher = options?.caseSensitive
        ? (l) => l.includes(query)
        : (l) => l.toLowerCase().includes(needle);
    }
  } else {
    const needle = query.toLowerCase();
    matcher = options?.caseSensitive
      ? (l) => l.includes(query)
      : (l) => l.toLowerCase().includes(needle);
  }

  const results: Array<{ line: number; content: string; context: string[] }> = [];
  for (let i = 0; i < lines.length && results.length < maxResults; i++) {
    if (!matcher(lines[i])) continue;
    const ctxStart = Math.max(0, i - contextLines);
    const ctxEnd = Math.min(lines.length, i + contextLines + 1);
    results.push({
      line: i + 1,
      content: lines[i],
      context: lines.slice(ctxStart, ctxEnd),
    });
  }
  return results;
}

/** Pull a navigable outline from the extracted text. Looks for
 *  - markdown headings (`#`, `##`, etc.)
 *  - PPTX slide markers (`--- Slide N ---`)
 *  - XLSX sheet markers (`--- Sheet: ... ---`)
 *  - all-caps short lines (book chapter titles)
 *  Capped at 60 entries so the preview stays readable. */
function sniffOutline(text: string, _kindLabel: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  const limit = 60;
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;

    // PPTX slide / XLSX sheet markers we emit ourselves.
    if (/^---\s*(Slide \d+|Sheet:.*)\s*---$/.test(t)) {
      out.push(`L${i + 1}: ${t.replace(/^---\s*|\s*---$/g, "")}`);
      continue;
    }

    // Markdown headings.
    const mdHeading = /^(#{1,6})\s+(.+)$/.exec(t);
    if (mdHeading) {
      out.push(`L${i + 1}: ${mdHeading[1]} ${mdHeading[2].slice(0, 80)}`);
      continue;
    }

    // All-caps short lines are usually chapter titles in extracted PDFs.
    if (
      t.length >= 4 &&
      t.length <= 80 &&
      t === t.toUpperCase() &&
      /[A-Z]/.test(t) &&
      /[A-Z\s\d.,:;'"\-–—]+/.test(t) &&
      t.split(/\s+/).length <= 12
    ) {
      // Skip rows that are mostly numbers/punctuation (likely table rows).
      const letterCount = (t.match(/[A-Z]/g) ?? []).length;
      if (letterCount >= 3) {
        out.push(`L${i + 1}: ${t}`);
      }
    }
  }
  return out;
}

/** Build the inline preview that goes into the user message when the full
 *  text is too big to inline. Includes the outline + a short head + a short
 *  tail so the model has shape. */
export function buildPreview(entry: CachedAttachment, headChars = 4000, tailChars = 1500): string {
  const parts: string[] = [];
  parts.push(
    `Document: "${entry.filename}" (${entry.totalChars.toLocaleString()} chars / ${entry.totalLines.toLocaleString()} lines).`,
    `Full text is too long to inline; use \`read_attachment\` or \`search_attachment\` to navigate.`,
  );
  if (entry.outline.length > 0) {
    parts.push(``, `Outline:`, ...entry.outline.map((l) => `  ${l}`));
  }
  if (entry.fullText.length > headChars + tailChars + 200) {
    parts.push(``, `--- Beginning (lines 1\u2013${headChars / 80 | 0}) ---`);
    parts.push(entry.fullText.slice(0, headChars));
    parts.push(``, `\u2026 [middle elided \u2014 use read_attachment(filename, offset, limit) or search_attachment(filename, query) to access] \u2026`, ``);
    parts.push(`--- End ---`);
    parts.push(entry.fullText.slice(-tailChars));
  } else {
    parts.push(``, entry.fullText);
  }
  return parts.join("\n");
}

/** Quote-quality helper: keep a string under `max` chars without splitting
 *  in the middle of a word when possible. */
export function snipForResult(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max;
  while (cut > max - 200 && cut < text.length && !/\s/.test(text[cut])) cut--;
  if (cut <= 0) cut = max;
  return text.slice(0, cut) + `\n\n\u2026 [${text.length - cut} more chars; call read_attachment with a higher offset to continue]`;
}

// Test-only helper.
export function _resetForTests(): void {
  cache.clear();
}
// Suppress unused-import warning in builds where Attachment type isn't directly referenced.
export type { Attachment };
