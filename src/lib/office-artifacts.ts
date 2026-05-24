/**
 * Office artifacts — Word, PowerPoint, Excel.
 *
 * The LLM authors each in a human-readable source format that round-trips
 * cleanly through the Monaco editor. We render a high-fidelity preview in
 * the iframe and, on download, package real .docx/.pptx/.xlsx blobs via
 * `docx`, `pptxgenjs`, and `xlsx` (SheetJS) — all browser-side, no native
 * Office runtime needed.
 *
 * Source formats
 * ──────────────
 * docx (Markdown):
 *   # Heading 1
 *   ## Heading 2
 *   Paragraph text. **bold** *italic* `code`.
 *   - bullet
 *   1. numbered
 *   | col | col |
 *   | --- | --- |
 *   | a   | b   |
 *
 * pptx (slide-spec — slides separated by `---` on its own line):
 *   # Slide title
 *   ## Optional subtitle
 *   - Bullet one
 *   - Bullet two
 *   Notes: anything after `Notes:` becomes speaker notes
 *   ---
 *   # Next slide
 *   ...
 *
 * xlsx (markdown tables; sheet headers prefixed with `## `):
 *   ## Sheet1
 *   | Quarter | Revenue | Cost  |
 *   | ------- | ------- | ----- |
 *   | Q1      | 12000   | 4500  |
 *   | Q2      | 15000   | 5100  |
 *   ## Sheet2
 *   | name | role |
 *   | ---- | ---- |
 *
 * Numbers are auto-detected; everything else stays text.
 */

import { marked } from "marked";

// ── Word (docx) ─────────────────────────────────────────────────────────

/**
 * Render Markdown to safe-ish HTML for the preview iframe. We trust our own
 * accent + surface tokens here because the iframe is sandboxed and only ever
 * receives content the model authored.
 */
export async function renderDocxPreview(markdown: string, title: string): Promise<string> {
  const html = await marked.parse(markdown, { gfm: true, breaks: false });
  return wrapDocPage(title, html);
}

function wrapDocPage(title: string, bodyHtml: string): string {
  // Letter-page styling so it visually reads as a Word doc rather than a
  // generic web page. White surface, generous margins, Geist body.
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #2a2a2c; }
  body {
    font-family: 'Geist', system-ui, sans-serif;
    color: #1a1a1c;
    padding: 32px 16px 48px;
  }
  .page {
    max-width: 816px; /* US letter @ 96dpi */
    margin: 0 auto;
    background: #fff;
    padding: 72px 96px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    border-radius: 4px;
    line-height: 1.55;
    font-size: 14.5px;
  }
  .page h1 { font-size: 26px; margin: 0 0 12px; font-weight: 700; letter-spacing: -0.01em; }
  .page h2 { font-size: 20px; margin: 24px 0 8px; font-weight: 600; }
  .page h3 { font-size: 16px; margin: 20px 0 6px; font-weight: 600; }
  .page p  { margin: 0 0 12px; }
  .page ul, .page ol { margin: 0 0 12px; padding-left: 24px; }
  .page li { margin: 0 0 4px; }
  .page code { font-family: 'JetBrains Mono', ui-monospace, monospace; background: #f3f3f3; padding: 1px 5px; border-radius: 3px; font-size: 12.5px; }
  .page pre  { background: #f6f6f6; padding: 12px 14px; border-radius: 6px; overflow-x: auto; }
  .page pre code { background: transparent; padding: 0; }
  .page blockquote { border-left: 3px solid #f59e42; padding: 4px 14px; margin: 0 0 12px; color: #444; }
  .page table { border-collapse: collapse; width: 100%; margin: 0 0 16px; font-size: 13.5px; }
  .page th, .page td { border: 1px solid #e3e3e3; padding: 8px 10px; text-align: left; }
  .page th { background: #f7f7f7; font-weight: 600; }
  .page a { color: #b8651b; text-decoration: underline; }
  .page hr { border: none; border-top: 1px solid #e3e3e3; margin: 24px 0; }
</style></head><body><div class="page">${bodyHtml}</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Shared inline-emphasis parser ──
//
// Word, PowerPoint, and Excel all need to handle **bold**, *italic*, `code`
// in the same way. The only thing that differs is what each format does with
// the resulting segments — docx builds TextRuns, pptxgenjs builds text-run
// objects, the previews emit <strong>/<em>/<code>, and Excel cells just want
// the plain text.

export interface InlineSeg {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export function parseInline(text: string): InlineSeg[] {
  const out: InlineSeg[] = [];
  // Order matters: try **bold** / __bold__ before *italic* / _italic_ so
  // they don't get swallowed by the single-marker form.
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined || m[3] !== undefined) {
      out.push({ text: (m[2] ?? m[3] ?? ""), bold: true });
    } else if (m[4] !== undefined || m[5] !== undefined) {
      out.push({ text: (m[4] ?? m[5] ?? ""), italic: true });
    } else if (m[6] !== undefined) {
      out.push({ text: m[6], code: true });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

/** Render inline segments to HTML for the previews. */
export function inlineToHtml(text: string): string {
  return parseInline(text)
    .map((s) => {
      const safe = escapeHtml(s.text);
      if (s.code) return `<code>${safe}</code>`;
      if (s.bold) return `<strong>${safe}</strong>`;
      if (s.italic) return `<em>${safe}</em>`;
      return safe;
    })
    .join("");
}

/** Strip emphasis markers entirely — used for places that can't render rich
 *  text (Excel cells, slide titles in the export). */
export function inlineToPlain(text: string): string {
  return parseInline(text)
    .map((s) => s.text)
    .join("");
}

/**
 * Build a real .docx blob from Markdown source. Maps headings, paragraphs,
 * lists, basic inline emphasis, and tables. Anything fancier (images,
 * footnotes) is intentionally out of scope for v1.
 */
export async function exportDocxBlob(markdown: string, title: string): Promise<Blob> {
  const docx = await import("docx");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    AlignmentType,
    WidthType,
  } = docx;

  type InlineSeg = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

  // Inline-emphasis parsing reuses the shared helper so docx, pptx, xlsx
  // all interpret **bold** / *italic* / `code` the same way.

  function runs(text: string) {
    return parseInline(text).map(
      (s: InlineSeg) =>
        new TextRun({
          text: s.text,
          bold: s.bold,
          italics: s.italic,
          font: s.code ? "JetBrains Mono" : undefined,
        }),
    );
  }

  const lines = markdown.split("\n");
  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines (between blocks).
    if (trimmed === "") { i++; continue; }

    // Heading.
    const h = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const headingMap = [
        HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
      ];
      children.push(new Paragraph({
        heading: headingMap[level - 1],
        children: runs(text),
      }));
      i++;
      continue;
    }

    // Table — at least two pipe-rows where row 2 is the alignment row.
    if (trimmed.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-+/.test(lines[i + 1].trim())) {
      const rows: string[][] = [];
      const headerCells = splitTableRow(trimmed);
      rows.push(headerCells);
      i += 2; // skip separator
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[i].trim()));
        i++;
      }
      const tableRows = rows.map((r, rIdx) =>
        new TableRow({
          children: r.map((cell) =>
            new TableCell({
              children: [new Paragraph({
                alignment: AlignmentType.LEFT,
                children: rIdx === 0
                  ? [new TextRun({ text: cell, bold: true })]
                  : runs(cell),
              })],
            }),
          ),
        }),
      );
      children.push(new Table({
        rows: tableRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
      continue;
    }

    // Lists (bullet or numbered).
    if (/^([-*+]|\d+\.)\s+/.test(trimmed)) {
      while (i < lines.length) {
        const t = lines[i].trim();
        const bullet = /^[-*+]\s+(.*)$/.exec(t);
        const number = /^\d+\.\s+(.*)$/.exec(t);
        if (!bullet && !number) break;
        const body = (bullet?.[1] ?? number?.[1]) ?? "";
        children.push(new Paragraph({
          children: runs(body),
          ...(bullet
            ? { bullet: { level: 0 } }
            : { numbering: { reference: "default-numbering", level: 0 } }),
        }));
        i++;
      }
      continue;
    }

    // Plain paragraph — collect adjacent non-blank lines.
    const buf: string[] = [trimmed];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|[-*+]\s|\d+\.\s|\|)/.test(lines[i].trim())) {
      buf.push(lines[i].trim());
      i++;
    }
    children.push(new Paragraph({ children: runs(buf.join(" ")) }));
  }

  // Empty docs would crash the packer.
  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun("")] }));
  }

  const doc = new Document({
    creator: "goatLLM",
    title,
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [{
          level: 0,
          format: "decimal",
          text: "%1.",
          alignment: AlignmentType.START,
        }],
      }],
    },
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

function splitTableRow(line: string): string[] {
  // Strip leading/trailing pipe, then split. Escape \| as a literal pipe.
  const inner = line.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

// ── PowerPoint (pptx) ───────────────────────────────────────────────────

export interface SlideSpec {
  title: string;
  subtitle?: string;
  bullets: string[];
  paragraphs: string[];
  notes?: string;
}

/**
 * Parse the slide-spec source. Slides are separated by a `---` divider on
 * its own line. Inside a slide:
 *   #  → title
 *   ## → subtitle
 *   -  → bullet
 *   Notes: …  → speaker notes (rest of the line + any continuation lines
 *               until the next bullet/heading)
 * Anything else is a paragraph.
 */
export function parsePptxSource(source: string): SlideSpec[] {
  const slides: SlideSpec[] = [];
  const blocks = source.split(/^\s*---+\s*$/m);

  for (const raw of blocks) {
    const lines = raw.split("\n");
    const slide: SlideSpec = { title: "", bullets: [], paragraphs: [] };
    let inNotes = false;
    const notes: string[] = [];

    for (const line of lines) {
      const t = line.trim();
      if (t === "") { inNotes = false; continue; }

      if (t.startsWith("Notes:")) {
        inNotes = true;
        const rest = t.slice(6).trim();
        if (rest) notes.push(rest);
        continue;
      }
      if (inNotes) { notes.push(t); continue; }

      const h1 = /^#\s+(.+)$/.exec(t);
      const h2 = /^##\s+(.+)$/.exec(t);
      const bullet = /^[-*+]\s+(.+)$/.exec(t);

      if (h1) slide.title = h1[1];
      else if (h2) slide.subtitle = h2[1];
      else if (bullet) slide.bullets.push(bullet[1]);
      else slide.paragraphs.push(t);
    }

    if (notes.length) slide.notes = notes.join("\n");

    // Skip empty leading/trailing blocks created by a leading or trailing ---.
    if (slide.title || slide.bullets.length || slide.paragraphs.length || slide.subtitle) {
      slides.push(slide);
    }
  }

  if (slides.length === 0) {
    slides.push({ title: "Untitled", bullets: [], paragraphs: [] });
  }

  return slides;
}

export function renderPptxPreview(source: string, _title: string): string {
  const slides = parsePptxSource(source);

  // 16:9 slide cards stacked vertically — IDE-adjacent feel, the same look
  // you get from a slide deck reviewer.
  const slideCards = slides
    .map((s, idx) => {
      const bullets = s.bullets.map((b) => `<li>${inlineToHtml(b)}</li>`).join("");
      const paragraphs = s.paragraphs.map((p) => `<p>${inlineToHtml(p)}</p>`).join("");
      const notes = s.notes
        ? `<div class="notes"><span class="notes-label">Notes</span>${inlineToHtml(s.notes).replace(/\n/g, "<br>")}</div>`
        : "";
      return `<div class="slide-frame">
  <div class="slide-num">${idx + 1} / ${slides.length}</div>
  <div class="slide" role="group" aria-label="Slide ${idx + 1}">
    ${s.title ? `<h1>${inlineToHtml(s.title)}</h1>` : ""}
    ${s.subtitle ? `<h2>${inlineToHtml(s.subtitle)}</h2>` : ""}
    <div class="body">
      ${bullets ? `<ul>${bullets}</ul>` : ""}
      ${paragraphs}
    </div>
    <div class="footer">${idx + 1}</div>
  </div>
  ${notes}
</div>`;
    })
    .join("\n");

  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #1a1a1c; }
  body {
    font-family: 'Geist', system-ui, sans-serif;
    padding: 24px 16px 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
  }
  .slide-frame { display: flex; flex-direction: column; gap: 8px; width: min(960px, 100%); }
  .slide-num { font-size: 11px; color: #888; letter-spacing: 0.04em; text-transform: uppercase; font-variant-numeric: tabular-nums; }
  .slide {
    aspect-ratio: 16 / 9;
    background: linear-gradient(180deg, #ffffff 0%, #fafafa 100%);
    color: #1a1a1c;
    border-radius: 8px;
    padding: 56px 64px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.45);
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
  .slide::before {
    /* Single warm accent, matching the goatLLM design system. */
    content: "";
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 4px;
    background: #f59e42;
  }
  .slide h1 { font-size: 36px; margin: 0 0 8px; font-weight: 700; letter-spacing: -0.015em; }
  .slide h2 { font-size: 20px; margin: 0 0 24px; font-weight: 500; color: #555; }
  .slide .body { font-size: 18px; line-height: 1.55; flex: 1; }
  .slide ul { margin: 0; padding-left: 22px; }
  .slide li { margin: 0 0 8px; }
  .slide p  { margin: 0 0 10px; }
  .slide .footer { position: absolute; bottom: 16px; right: 24px; font-size: 11px; color: #999; font-variant-numeric: tabular-nums; }
  .notes {
    width: min(960px, 100%);
    background: #2a2a2c;
    color: #d5d5d5;
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 13px;
    line-height: 1.5;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .notes-label { display: block; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #f59e42; font-weight: 600; margin-bottom: 4px; }
</style></head><body>
${slideCards}
</body></html>`;
}

export async function exportPptxBlob(source: string, title: string): Promise<Blob> {
  const mod = await import("pptxgenjs");
  // pptxgenjs ships an ESM `default` export that is the constructor class.
  // Some bundlers double-wrap it; handle both shapes.
  type PptxCtor = new () => {
    layout: string;
    title: string;
    addSlide: () => {
      addShape: (...args: unknown[]) => unknown;
      addText: (...args: unknown[]) => unknown;
      addNotes: (text: string) => unknown;
    };
    write: (opts: { outputType: "blob" }) => Promise<Blob | string>;
  };
  const ctor = ((mod as unknown as { default?: PptxCtor }).default ?? (mod as unknown as PptxCtor)) as PptxCtor;
  const pres = new ctor();

  pres.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 inches, modern 16:9.
  pres.title = title;

  const slides = parsePptxSource(source);

  for (const s of slides) {
    const slide = pres.addSlide();

    // Top accent bar.
    slide.addShape("rect", {
      x: 0, y: 0, w: "100%", h: 0.06,
      fill: { color: "F59E42" },
      line: { type: "none" },
    });

    if (s.title) {
      slide.addText(inlineToPlain(s.title), {
        x: 0.55, y: 0.45, w: "92%", h: 0.9,
        fontFace: "Geist", fontSize: 32, bold: true, color: "1A1A1C",
      });
    }
    if (s.subtitle) {
      slide.addText(inlineToPlain(s.subtitle), {
        x: 0.55, y: 1.32, w: "92%", h: 0.5,
        fontFace: "Geist", fontSize: 18, color: "555555",
      });
    }

    const bodyY = s.subtitle ? 1.95 : 1.5;
    // Build a flat runs[] array so **bold** / *italic* / `code` survive into
    // the actual .pptx file. Each line becomes a sequence of runs followed
    // by a paragraph-terminating run with breakLine (and bullet on the
    // first run when the line was bulleted in the source).
    type Run = { text: string; options: Record<string, unknown> };
    const lines: { kind: "bullet" | "para"; text: string }[] = [
      ...s.bullets.map((b) => ({ kind: "bullet" as const, text: b })),
      ...s.paragraphs.map((p) => ({ kind: "para" as const, text: p })),
    ];

    if (lines.length > 0) {
      const runs: Run[] = [];
      lines.forEach((line, lineIdx) => {
        const segs = parseInline(line.text);
        segs.forEach((seg, segIdx) => {
          const isFirstOfLine = segIdx === 0;
          const isLastOfLine = segIdx === segs.length - 1;
          const isLastLine = lineIdx === lines.length - 1;
          runs.push({
            text: seg.text,
            options: {
              ...(isFirstOfLine && line.kind === "bullet" ? { bullet: true } : {}),
              ...(isLastOfLine && !isLastLine ? { breakLine: true } : {}),
              ...(seg.bold ? { bold: true } : {}),
              ...(seg.italic ? { italic: true } : {}),
              ...(seg.code ? { fontFace: "JetBrains Mono" } : {}),
            },
          });
        });
      });
      slide.addText(runs, {
        x: 0.55, y: bodyY, w: "92%", h: 5,
        fontFace: "Geist", fontSize: 16, color: "1A1A1C",
        paraSpaceAfter: 6,
      });
    }

    if (s.notes) slide.addNotes(inlineToPlain(s.notes));
  }

  const out = await pres.write({ outputType: "blob" });
  // Older pptxgenjs typings return string | Blob. We force blob via outputType.
  return out as Blob;
}

// ── Excel (xlsx) ────────────────────────────────────────────────────────

export interface SheetSpec {
  name: string;
  rows: (string | number)[][]; // includes header
}

/**
 * Parse one or more markdown tables, optionally each preceded by a `## SheetName`
 * header. If the source has only one table and no `##`, we use "Sheet1".
 */
export function parseXlsxSource(source: string): SheetSpec[] {
  const lines = source.split("\n");
  const sheets: SheetSpec[] = [];
  let currentName = "Sheet1";
  let currentRows: (string | number)[][] = [];

  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    const sheetHeader = /^##\s+(.+)$/.exec(t);
    if (sheetHeader) {
      if (currentRows.length) sheets.push({ name: currentName, rows: currentRows });
      currentName = sheetHeader[1].slice(0, 31); // Excel max sheet-name length
      currentRows = [];
      i++;
      continue;
    }

    // Table block: header row, separator, data rows.
    if (t.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-+/.test(lines[i + 1].trim())) {
      const header = splitTableRow(t);
      currentRows.push(header);
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = splitTableRow(lines[i].trim()).map(coerceNumber);
        currentRows.push(row);
        i++;
      }
      continue;
    }

    i++;
  }
  if (currentRows.length) sheets.push({ name: currentName, rows: currentRows });
  if (sheets.length === 0) sheets.push({ name: "Sheet1", rows: [["(empty)"]] });
  return sheets;
}

function coerceNumber(cell: string): string | number {
  if (cell === "") return cell;
  // Tolerate thousands separators and trailing % signs.
  const stripped = cell.replace(/,/g, "").replace(/%$/, "");
  if (/^-?\d+(\.\d+)?$/.test(stripped)) {
    const n = Number(stripped);
    if (Number.isFinite(n)) return n;
  }
  return cell;
}

export function renderXlsxPreview(source: string, _title: string): string {
  const sheets = parseXlsxSource(source);

  const tabs = sheets
    .map(
      (s, i) =>
        `<button class="tab" data-i="${i}"${i === 0 ? ' aria-current="page"' : ""}>${escapeHtml(s.name)}</button>`,
    )
    .join("");

  const sheetTables = sheets
    .map((s, i) => {
      const cols = s.rows[0]?.length ?? 0;
      const colHeaders = Array.from({ length: cols }, (_, ci) => {
        // A, B, C, … Z, AA, AB.
        let n = ci;
        let label = "";
        while (true) {
          label = String.fromCharCode(65 + (n % 26)) + label;
          n = Math.floor(n / 26) - 1;
          if (n < 0) break;
        }
        return `<th class="colhead">${label}</th>`;
      }).join("");

      const body = s.rows
        .map((row, rIdx) => {
          const cells = row
            .map((c) => {
              const isNum = typeof c === "number";
              return `<td${isNum ? ' class="num"' : ""}>${escapeHtml(String(c))}</td>`;
            })
            .join("");
          return `<tr><th class="rowhead">${rIdx + 1}</th>${cells}</tr>`;
        })
        .join("");

      return `<table class="sheet" data-i="${i}" style="display:${i === 0 ? "table" : "none"}">
  <thead><tr><th class="corner"></th>${colHeaders}</tr></thead>
  <tbody>${body}</tbody>
</table>`;
    })
    .join("\n");

  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #f3f3f3; height: 100%; }
  body { font-family: 'Geist', system-ui, sans-serif; color: #1a1a1c; display: flex; flex-direction: column; height: 100%; }
  .grid-area { flex: 1; overflow: auto; }
  table.sheet { border-collapse: collapse; font-size: 12.5px; }
  table.sheet th, table.sheet td {
    border: 1px solid #d4d4d4;
    padding: 4px 8px;
    min-width: 80px;
    height: 22px;
    box-sizing: border-box;
    text-align: left;
    vertical-align: top;
  }
  table.sheet td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono', ui-monospace, monospace; }
  table.sheet th.colhead, table.sheet th.rowhead, table.sheet th.corner {
    background: #ececec; color: #555; font-weight: 500; font-size: 11px; text-align: center;
    position: sticky;
  }
  table.sheet th.colhead { top: 0; z-index: 2; }
  table.sheet th.rowhead { left: 0; min-width: 36px; z-index: 1; }
  table.sheet th.corner  { left: 0; top: 0; min-width: 36px; z-index: 3; }
  /* First data row (header) gets bold styling. */
  table.sheet tbody tr:first-child td { font-weight: 600; background: #fafafa; }
  .tabs { display: flex; gap: 0; border-top: 1px solid #d4d4d4; background: #ececec; padding: 4px 8px 0; flex-wrap: wrap; }
  .tab {
    appearance: none; border: 1px solid #d4d4d4; border-bottom: none;
    background: #f3f3f3; color: #555; padding: 6px 14px; font: inherit; font-size: 12px;
    border-top-left-radius: 4px; border-top-right-radius: 4px; cursor: pointer;
    margin-right: 2px;
  }
  .tab[aria-current="page"] { background: #fff; color: #1a1a1c; font-weight: 600; }
</style></head><body>
<div class="grid-area">${sheetTables}</div>
<div class="tabs">${tabs}</div>
<script>
(function(){
  const tabs = document.querySelectorAll('.tab');
  const sheets = document.querySelectorAll('table.sheet');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.removeAttribute('aria-current'));
    t.setAttribute('aria-current', 'page');
    const i = t.dataset.i;
    sheets.forEach(s => s.style.display = s.dataset.i === i ? 'table' : 'none');
  }));
})();
</script>
</body></html>`;
}

export async function exportXlsxBlob(source: string, _title: string): Promise<Blob> {
  const XLSX = await import("xlsx");
  const sheets = parseXlsxSource(source);
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    // Estimate column widths from longest cell per column. Cap so a single
    // long cell can't push a column off-screen.
    if (s.rows[0]) {
      const widths = s.rows[0].map((_, ci) => {
        let max = 8;
        for (const row of s.rows) {
          const cell = row[ci];
          if (cell == null) continue;
          const len = String(cell).length;
          if (len > max) max = len;
        }
        return { wch: Math.min(max + 2, 48) };
      });
      ws["!cols"] = widths;
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const arr = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([arr], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ── Generic helpers used by the panel ─────────────────────────────────────

export function officeFilename(kind: "docx" | "pptx" | "xlsx", title: string): string {
  const base =
    (title || "artifact")
      .toLowerCase()
      .replace(/[^\w\s.-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "artifact";
  return `${base}.${kind}`;
}

export function officeMimeType(kind: "docx" | "pptx" | "xlsx"): string {
  switch (kind) {
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
}
