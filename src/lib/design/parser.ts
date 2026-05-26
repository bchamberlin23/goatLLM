/**
 * Question-form parser. The design-mode system prompt tells the model to
 * emit `<question-form id="discovery">…</question-form>` instead of an
 * artifact on the first turn. We intercept that segment in the streaming
 * body and render native form controls inside the message bubble.
 *
 * The grammar is intentionally tiny so we can parse it without a real DOM
 * parser. Real model output is messy — prose before/after tags, single
 * quotes, nested HTML, incomplete streaming forms. We handle all of those.
 * When we can't parse, we fall back to plain text rather than showing a
 * half-broken UI.
 */

export interface ParsedField {
  name: string;
  label: string;
  type: "radio" | "checkbox" | "text" | "textarea";
  options: { value: string; label: string }[];
}

export interface ParsedQuestionForm {
  id: string;
  fields: ParsedField[];
}

export interface QuestionFormSegment {
  type: "question-form";
  raw: string;
  form: ParsedQuestionForm | null; // null when the closing tag hasn't streamed in yet
}

export interface TextSegment {
  type: "text";
  text: string;
}

export type FormSegment = TextSegment | QuestionFormSegment;

const FORM_OPEN = /<question-form\b[^>]*>/i;
const FORM_CLOSE = /<\/question-form>/i;

/**
 * Split a streaming assistant message into text + question-form segments.
 * Open-but-not-closed forms still produce a segment (with `form: null`)
 * so the renderer can show a "writing form…" placeholder.
 */
export function splitByQuestionForm(content: string): FormSegment[] {
  const out: FormSegment[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const remaining = content.slice(cursor);
    const openMatch = remaining.match(FORM_OPEN);
    if (!openMatch || openMatch.index === undefined) {
      if (cursor < content.length) {
        out.push({ type: "text", text: content.slice(cursor) });
      }
      break;
    }
    const openIdx = cursor + openMatch.index;
    if (openIdx > cursor) {
      out.push({ type: "text", text: content.slice(cursor, openIdx) });
    }
    const afterOpen = openIdx + openMatch[0].length;
    const closeMatch = content.slice(afterOpen).match(FORM_CLOSE);
    if (!closeMatch || closeMatch.index === undefined) {
      // Open without close — emit a streaming-in-progress segment and stop.
      out.push({
        type: "question-form",
        raw: content.slice(openIdx),
        form: null,
      });
      break;
    }
    const closeIdx = afterOpen + closeMatch.index;
    const closeEnd = closeIdx + closeMatch[0].length;
    const raw = content.slice(openIdx, closeEnd);
    out.push({
      type: "question-form",
      raw,
      form: parseQuestionForm(raw),
    });
    cursor = closeEnd;
  }
  return out;
}

/**
 * Parse a complete `<question-form>…</question-form>` block into a typed
 * tree. Returns null when the body is malformed enough that we can't get
 * a usable form out of it (in which case the renderer falls back to plain
 * text — better to show the model's words than a half-broken UI).
 */
export function parseQuestionForm(raw: string): ParsedQuestionForm | null {
  const openMatch = raw.match(FORM_OPEN);
  const closeMatch = raw.match(FORM_CLOSE);
  if (!openMatch || !closeMatch) {
    // Incomplete — only the opening tag streamed in yet. Not parseable.
    return null;
  }

  // Strip form tags to get inner content. Be lenient: if the model wrapped
  // the form in a markdown code fence, strip it before parsing.
  let inner = raw.slice(
    (openMatch.index ?? 0) + openMatch[0].length,
    closeMatch.index,
  );

  // If the inner content starts/ends with markdown fences, peel them.
  const fencePeel = inner.match(/^```\w*\n?([\s\S]*?)\n?```$/);
  if (fencePeel) inner = fencePeel[1] ?? inner;

  // Extract id — tolerate double-quoted, single-quoted, and unquoted.
  const idMatch =
    openMatch[0].match(/\bid\s*=\s*"([^"]+)"/i) ??
    openMatch[0].match(/\bid\s*=\s*'([^']+)'/i) ??
    openMatch[0].match(/\bid\s*=\s*([^\s>]+)/i);
  const id = idMatch ? idMatch[1] : "discovery";

  const fields: ParsedField[] = [];
  // Tolerate self-closing fields (text / textarea) and explicit-close fields
  // (radio / checkbox with <option> children).
  const fieldRegex =
    /<field\b([^>]*)(?:\/>|>([\s\S]*?)<\/field>)/gi;
  let m: RegExpExecArray | null;
  while ((m = fieldRegex.exec(inner)) !== null) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const name = attrAt(attrs, "name");
    const label = attrAt(attrs, "label") ?? name ?? "";
    const typeRaw = (attrAt(attrs, "type") ?? "text").toLowerCase();
    const type: ParsedField["type"] =
      typeRaw === "radio" || typeRaw === "checkbox" || typeRaw === "textarea"
        ? typeRaw
        : "text";
    if (!name) continue;
    const options: ParsedField["options"] = [];
    if (type === "radio" || type === "checkbox") {
      const optRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
      let om: RegExpExecArray | null;
      while ((om = optRegex.exec(body)) !== null) {
        const value = attrAt(om[1] ?? "", "value");
        const optLabel = (om[2] ?? "").trim();
        if (!value) continue;
        options.push({ value, label: optLabel || value });
      }
    }
    fields.push({ name, label, type, options });
  }

  if (fields.length === 0) return null;
  return { id, fields };
}

function attrAt(attrs: string, name: string): string | undefined {
  // Try double-quoted first, then single-quoted, then unquoted.
  const dq = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = attrs.match(dq);
  if (m) return m[1];

  const sq = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i");
  const sm = attrs.match(sq);
  if (sm) return sm[1];

  // Unquoted — grab until next whitespace or >.
  const uq = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i");
  const um = attrs.match(uq);
  return um ? um[1] : undefined;
}

/**
 * Format submitted form values as the structured user follow-up message
 * the design system prompt expects to see (see DISCOVERY_DIRECTIVES).
 */
export function formatFormSubmission(
  formId: string,
  values: Record<string, string | string[]>,
): string {
  const lines: string[] = [`[form: ${formId}]`];
  let filled = false;
  for (const [k, v] of Object.entries(values)) {
    const display = Array.isArray(v) ? v.join(", ") : v;
    if (display) filled = true;
    lines.push(`${k}: ${display || "(skipped)"}`);
  }
  if (!filled) {
    lines.push("");
    lines.push("[All fields left blank — the user trusts your judgment. Pick sensible defaults, state your assumptions in one line, then proceed directly to the artifact.]");
  }
  return lines.join("\n");
}
