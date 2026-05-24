/**
 * Structured truncation for tool outputs.
 *
 * Ported from pi-coding-agent's `core/tools/truncate.ts`. Truncation is bounded
 * by two independent limits — whichever is hit first wins:
 *   - Line limit (default 2000)
 *   - Byte limit (default 50KB)
 *
 * The result includes enough metadata that the agent can tell how much was
 * dropped and why. Never returns partial lines except in the tail-truncation
 * edge case where a single trailing line exceeds the byte budget.
 */

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const GREP_MAX_LINE_LENGTH = 500;

export interface TruncationOptions {
  /** Maximum number of lines (default 2000). */
  maxLines?: number;
  /** Maximum number of bytes (default 50 KB). */
  maxBytes?: number;
}

export interface TruncationResult {
  /** The truncated content. */
  content: string;
  /** Whether truncation occurred. */
  truncated: boolean;
  /** Which limit was hit first, or null if not truncated. */
  truncatedBy: "lines" | "bytes" | null;
  /** Total number of lines in the original content. */
  totalLines: number;
  /** Total number of bytes in the original content (utf-8). */
  totalBytes: number;
  /** Number of complete lines kept in the output. */
  outputLines: number;
  /** Number of bytes in the output (utf-8). */
  outputBytes: number;
  /** Whether the last kept line was partial (only possible with truncateTail). */
  lastLinePartial: boolean;
  /** Whether the first line alone exceeded the byte limit (head truncation). */
  firstLineExceedsLimit: boolean;
  /** The maxLines applied. */
  maxLines: number;
  /** The maxBytes applied. */
  maxBytes: number;
}

const encoder = new TextEncoder();

function byteLen(s: string): number {
  return encoder.encode(s).length;
}

/** Format a byte count as a short human-readable size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function splitLinesPreserving(content: string): string[] {
  // Split on \n while preserving the newline character with the line that
  // precedes it, so byte accounting is exact and we can reassemble verbatim.
  if (content.length === 0) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      out.push(content.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < content.length) out.push(content.slice(start));
  return out;
}

/**
 * Keep the head of the content (good for file reads, where you want the
 * beginning). Never returns partial lines: if the first line alone is bigger
 * than maxBytes we return empty content with `firstLineExceedsLimit=true`.
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalBytes = byteLen(content);
  const lines = splitLinesPreserving(content);
  const totalLines = lines.length;

  // Fast path: nothing to do.
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }

  let kept = "";
  let keptBytes = 0;
  let outputLines = 0;
  let truncatedBy: "lines" | "bytes" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineBytes = byteLen(line);

    if (i >= maxLines) {
      truncatedBy = "lines";
      break;
    }
    if (keptBytes + lineBytes > maxBytes) {
      // First line alone too big.
      if (outputLines === 0) {
        return {
          content: "",
          truncated: true,
          truncatedBy: "bytes",
          totalLines,
          totalBytes,
          outputLines: 0,
          outputBytes: 0,
          lastLinePartial: false,
          firstLineExceedsLimit: true,
          maxLines,
          maxBytes,
        };
      }
      truncatedBy = "bytes";
      break;
    }

    kept += line;
    keptBytes += lineBytes;
    outputLines++;
  }

  return {
    content: kept,
    truncated: outputLines < totalLines,
    truncatedBy: outputLines < totalLines ? truncatedBy ?? "lines" : null,
    totalLines,
    totalBytes,
    outputLines,
    outputBytes: keptBytes,
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
}

/**
 * Keep the tail of the content (good for command output, where errors and
 * exit codes live at the bottom). May return a partial first line if the
 * final line alone exceeds the byte budget.
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalBytes = byteLen(content);
  const lines = splitLinesPreserving(content);
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }

  // Walk from the back accumulating lines until we hit either limit.
  const buf: string[] = [];
  let keptBytes = 0;
  let outputLines = 0;
  let truncatedBy: "lines" | "bytes" | null = null;
  let lastLinePartial = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const lineBytes = byteLen(line);

    if (outputLines >= maxLines) {
      truncatedBy = "lines";
      break;
    }
    if (keptBytes + lineBytes > maxBytes) {
      // Partial-line edge case — only when we have nothing yet AND the
      // very last line of the file is itself bigger than maxBytes.
      if (outputLines === 0) {
        const partial = line.slice(line.length - maxBytes);
        buf.unshift(partial);
        keptBytes = byteLen(partial);
        outputLines = 1;
        lastLinePartial = true;
        truncatedBy = "bytes";
      } else {
        truncatedBy = "bytes";
      }
      break;
    }

    buf.unshift(line);
    keptBytes += lineBytes;
    outputLines++;
  }

  return {
    content: buf.join(""),
    truncated: outputLines < totalLines || lastLinePartial,
    truncatedBy: truncatedBy ?? "lines",
    totalLines,
    totalBytes,
    outputLines,
    outputBytes: keptBytes,
    lastLinePartial,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
}

/** Truncate a single line to at most `maxChars` characters. Used for grep matches. */
export function truncateLine(line: string, maxChars: number = GREP_MAX_LINE_LENGTH): { text: string; wasTruncated: boolean } {
  if (line.length <= maxChars) return { text: line, wasTruncated: false };
  return { text: line.slice(0, maxChars) + " [truncated]", wasTruncated: true };
}

/**
 * Build a short footer describing what was dropped, suitable for appending
 * to a tool result. Returns "" if nothing was truncated.
 */
export function truncationFooter(r: TruncationResult, opts?: { fullOutputPath?: string }): string {
  if (!r.truncated) return "";
  const parts: string[] = [];
  if (r.firstLineExceedsLimit) {
    parts.push(`first line exceeded ${formatSize(r.maxBytes)} — output omitted`);
  } else {
    const reason = r.truncatedBy === "bytes" ? `${formatSize(r.maxBytes)} byte limit` : `${r.maxLines} line limit`;
    parts.push(`truncated by ${reason}`);
    parts.push(`kept ${r.outputLines}/${r.totalLines} lines, ${formatSize(r.outputBytes)}/${formatSize(r.totalBytes)}`);
  }
  if (opts?.fullOutputPath) parts.push(`full output: ${opts.fullOutputPath}`);
  return `\n\n[${parts.join(" — ")}]`;
}
