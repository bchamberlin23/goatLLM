/**
 * Split assistant content into a sequence of text + artifact segments so the
 * bubble can render artifact fences as inline cards instead of dumping the
 * raw code at the user.
 *
 * The splitter is line-oriented: it scans top-to-bottom, opens an "in-fence"
 * state when it sees a ```<artifact-kind> line, and closes it on a bare
 * ``` line. Anything between fences keeps its original Markdown so headings,
 * paragraphs, lists, and non-artifact code blocks render normally.
 *
 * If the stream ends mid-fence (the model is still emitting tokens), we emit
 * an `artifact` segment with `complete: false` so the bubble can show a
 * "Writing…" placeholder until the closing fence arrives.
 */

import type { ArtifactKind } from "../stores/chat";

const ARTIFACT_LANG_MAP: Record<string, ArtifactKind> = {
  html: "html",
  latex: "latex",
  tex: "latex",
  python: "python",
  docx: "docx",
  word: "docx",
  pptx: "pptx",
  powerpoint: "pptx",
  slides: "pptx",
  xlsx: "xlsx",
  excel: "xlsx",
  spreadsheet: "xlsx",
  "markdown-document": "markdown-document",
  markdown: "markdown-document",
  md: "markdown-document",
};

/**
 * Inline widgets are a *different* surface from side-panel artifacts: their
 * body is rendered live, right in the flow of the reply, as a sandboxed
 * auto-sizing iframe — not a reference card that opens the canvas. A single
 * "widget" kind (self-contained HTML/CSS/JS) covers charts, diagrams,
 * animations, simulations, and small interactive demos. These fence tags are
 * deliberately distinct from the artifact tags so the two systems never
 * collide.
 */
export type InlineWidgetKind = "widget";

const WIDGET_LANG_MAP: Record<string, InlineWidgetKind> = {
  widget: "widget",
  "inline-html": "widget",
  inlinehtml: "widget",
  live: "widget",
  livehtml: "widget",
  "live-html": "widget",
  demo: "widget",
  viz: "widget",
  embed: "widget",
};

const EMPTY_WIDGET_KINDS: ReadonlySet<InlineWidgetKind> = new Set();

export type ContentSegment =
  | { type: "text"; text: string }
  | {
      type: "artifact";
      kind: ArtifactKind;
      /** Heading on the line immediately preceding the fence, if any. */
      title: string;
      /** True when we saw the closing ``` for this fence. */
      complete: boolean;
      /** Body collected so far. Defined for both complete and in-progress
       *  fences so the canvas can stream the partial code live. */
      code: string;
    }
  | {
      type: "inline-widget";
      widgetKind: InlineWidgetKind;
      /** Heading on the line immediately preceding the fence, if any. */
      title: string;
      /** True when we saw the closing ``` for this fence. */
      complete: boolean;
      /** Body collected so far. Only rendered live once `complete` is true —
       *  partial HTML would flash broken layouts mid-stream. */
      code: string;
    };

export interface SplitOptions {
  /** Which artifact kinds count as artifacts. Anything outside this set
   *  falls through to plain markdown so the fence renders inline as a
   *  regular code block. Defaults to all six kinds. */
  enabledKinds?: ReadonlySet<ArtifactKind>;
  /** Which inline-widget kinds render live in the chat flow. Defaults to an
   *  empty set, so widgets only activate when the caller opts in (the
   *  "Advanced inline artifacts" toggle). */
  inlineWidgetKinds?: ReadonlySet<InlineWidgetKind>;
}

const DEFAULT_KINDS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>([
  "html",
  "latex",
  "python",
  "docx",
  "pptx",
  "xlsx",
]);

export function splitContentByArtifacts(
  content: string,
  options?: SplitOptions,
): ContentSegment[] {
  const enabled = options?.enabledKinds ?? DEFAULT_KINDS;
  const widgetEnabled = options?.inlineWidgetKinds ?? EMPTY_WIDGET_KINDS;
  const segments: ContentSegment[] = [];
  const lines = content.split("\n");
  let textBuf: string[] = [];
  let inFence = false;
  let fenceKind: ArtifactKind | null = null;
  let fenceWidgetKind: InlineWidgetKind | null = null;
  let fenceTitle = "";

  const flushText = () => {
    if (textBuf.length === 0) return;
    const text = textBuf.join("\n").replace(/^\n+|\n+$/g, "");
    if (text.length > 0) segments.push({ type: "text", text });
    textBuf = [];
  };

  /**
   * Pop the trailing markdown heading off the text buffer (if any) and
   * return it as a string. The heading becomes the artifact's title and
   * shouldn't render as a leftover heading above the card.
   */
  const popTrailingHeading = (): string => {
    // Walk backward over blank lines.
    let j = textBuf.length - 1;
    while (j >= 0 && textBuf[j].trim() === "") j--;
    if (j < 0) return "";
    const last = textBuf[j];
    const m = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/.exec(last);
    if (!m) return "";
    // Drop the heading line and any trailing blank lines that came after it.
    textBuf = textBuf.slice(0, j);
    return m[1].trim();
  };

  let codeBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inFence) {
      const fenceOpen = /^[ \t]*```([\w-]+)[ \t]*$/.exec(line);
      if (fenceOpen) {
        const lang = fenceOpen[1].toLowerCase();
        const widgetKind = WIDGET_LANG_MAP[lang];
        const kind = ARTIFACT_LANG_MAP[lang];
        if (widgetKind && widgetEnabled.has(widgetKind)) {
          // Inline widget fence — rendered live in the chat flow. Swallow the
          // body so the raw code never reaches the markdown renderer.
          fenceTitle = popTrailingHeading();
          flushText();
          inFence = true;
          fenceWidgetKind = widgetKind;
          fenceKind = null;
          codeBuf = [];
          continue;
        }
        if (kind && enabled.has(kind)) {
          // It's an artifact fence — don't pass the raw code through to
          // the markdown renderer.
          fenceTitle = popTrailingHeading();
          flushText();
          inFence = true;
          fenceKind = kind;
          fenceWidgetKind = null;
          codeBuf = [];
          continue;
        }
      }
      textBuf.push(line);
    } else {
      // We're inside an artifact fence. Swallow code until the closing fence.
      const fenceClose = /^[ \t]*```[ \t]*$/.test(line);
      if (fenceClose) {
        segments.push(
          fenceWidgetKind
            ? {
                type: "inline-widget",
                widgetKind: fenceWidgetKind,
                title: fenceTitle,
                complete: true,
                code: codeBuf.join("\n"),
              }
            : {
                type: "artifact",
                kind: fenceKind!,
                title: fenceTitle,
                complete: true,
                code: codeBuf.join("\n"),
              },
        );
        inFence = false;
        fenceKind = null;
        fenceWidgetKind = null;
        fenceTitle = "";
        codeBuf = [];
      } else {
        // Capture the body so the canvas can stream it live. The chat
        // bubble still doesn't render this — the artifact panel does.
        codeBuf.push(line);
      }
    }
  }

  if (inFence) {
    // Stream still in progress — emit an incomplete card so the user sees
    // a "Writing…" placeholder instead of nothing, and expose the partial
    // body so the canvas can render it.
    segments.push(
      fenceWidgetKind
        ? {
            type: "inline-widget",
            widgetKind: fenceWidgetKind,
            title: fenceTitle,
            complete: false,
            code: codeBuf.join("\n"),
          }
        : {
            type: "artifact",
            kind: fenceKind!,
            title: fenceTitle,
            complete: false,
            code: codeBuf.join("\n"),
          },
    );
  } else {
    flushText();
  }

  return segments;
}
