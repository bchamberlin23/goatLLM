export interface ParsedField {
  id: string;
  label: string;
  type: "radio" | "checkbox" | "select" | "text" | "textarea" | "direction-cards";
  options: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  maxSelections?: number;
  cards?: unknown[];
}

export interface ParsedQuestionForm {
  id: string;
  title?: string;
  description?: string;
  fields: ParsedField[];
}

export interface QuestionFormSegment {
  type: "question-form";
  raw: string;
  form: ParsedQuestionForm | null;
}

export interface TextSegment {
  type: "text";
  text: string;
}

export type FormSegment = TextSegment | QuestionFormSegment;

const FORM_OPEN = /<question-form\b[^>]*>/i;
const FORM_CLOSE = /<\/question-form>/i;

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

export function parseQuestionForm(raw: string): ParsedQuestionForm | null {
  const openMatch = raw.match(FORM_OPEN);
  const closeMatch = raw.match(FORM_CLOSE);
  if (!openMatch || !closeMatch) return null;

  let inner = raw.slice(
    (openMatch.index ?? 0) + openMatch[0].length,
    closeMatch.index,
  );

  const fencePeel = inner.match(/^```\w*\n?([\s\S]*?)\n?```$/);
  if (fencePeel) inner = fencePeel[1] ?? inner;

  const idMatch =
    openMatch[0].match(/\bid\s*=\s*"([^"]+)"/i) ??
    openMatch[0].match(/\bid\s*=\s*'([^']+)'/i) ??
    openMatch[0].match(/\bid\s*=\s*([^\s>]+)/i);
  const id = idMatch ? idMatch[1] : "discovery";

  const titleMatch =
    openMatch[0].match(/\btitle\s*=\s*"([^"]+)"/i) ??
    openMatch[0].match(/\btitle\s*=\s*'([^']+)'/i);
  const title = titleMatch ? titleMatch[1] : undefined;

  const jsonForm = tryParseJsonBody(inner);
  if (jsonForm) {
    const jsonTitle = jsonForm.title;
    const { title: _omit, ...rest } = jsonForm;
    return { id, title: title ?? jsonTitle, ...rest };
  }

  const xmlForm = tryParseXmlBody(inner);
  if (xmlForm) {
    return { id, title, ...xmlForm };
  }

  return null;
}

function tryParseJsonBody(inner: string): Omit<ParsedQuestionForm, "id"> | null {
  const trimmed = inner.trim();
  if (!trimmed.startsWith("{")) return null;

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const questions = json.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const fields: ParsedField[] = [];
  for (const q of questions) {
    if (typeof q !== "object" || q === null) continue;
    const qObj = q as Record<string, unknown>;
    const fieldId = typeof qObj.id === "string" ? qObj.id : "";
    if (!fieldId) continue;

    const label = typeof qObj.label === "string" ? qObj.label : fieldId;
    const typeRaw = typeof qObj.type === "string" ? qObj.type.toLowerCase() : "text";
    const type = normalizeType(typeRaw);

    const options: ParsedField["options"] = [];
    if (Array.isArray(qObj.options)) {
      for (const opt of qObj.options) {
        if (typeof opt === "string") {
          options.push({ value: opt, label: opt });
        } else if (typeof opt === "object" && opt !== null) {
          const oObj = opt as Record<string, unknown>;
          const value = typeof oObj.value === "string" ? oObj.value : String(oObj.label ?? "");
          const optLabel = typeof oObj.label === "string" ? oObj.label : value;
          if (value) options.push({ value, label: optLabel });
        }
      }
    }

    const field: ParsedField = { id: fieldId, label, type, options };

    if (qObj.required === true) field.required = true;
    if (typeof qObj.placeholder === "string") field.placeholder = qObj.placeholder;
    if (typeof qObj.maxSelections === "number") field.maxSelections = qObj.maxSelections;
    if (Array.isArray(qObj.cards)) field.cards = qObj.cards;

    fields.push(field);
  }

  if (fields.length === 0) return null;

  const description = typeof json.description === "string" ? json.description : undefined;
  const title = typeof json.title === "string" ? json.title : undefined;
  return { description, title, fields };
}

function tryParseXmlBody(inner: string): Omit<ParsedQuestionForm, "id" | "title"> | null {
  const fields: ParsedField[] = [];
  const fieldRegex = /<field\b([^>]*)(?:\/>|>([\s\S]*?)<\/field>)/gi;
  let m: RegExpExecArray | null;
  while ((m = fieldRegex.exec(inner)) !== null) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const name = attrAt(attrs, "name");
    const label = attrAt(attrs, "label") ?? name ?? "";
    const typeRaw = (attrAt(attrs, "type") ?? "text").toLowerCase();
    const type = normalizeType(typeRaw);
    if (!name) continue;
    const options: ParsedField["options"] = [];
    if (type === "radio" || type === "checkbox" || type === "select" || type === "direction-cards") {
      const optRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
      let om: RegExpExecArray | null;
      while ((om = optRegex.exec(body)) !== null) {
        const value = attrAt(om[1] ?? "", "value");
        const optLabel = (om[2] ?? "").trim();
        if (!value) continue;
        options.push({ value, label: optLabel || value });
      }
    }
    fields.push({ id: name, label, type, options });
  }

  if (fields.length === 0) return null;
  return { fields };
}

function normalizeType(typeRaw: string): ParsedField["type"] {
  if (typeRaw === "radio" || typeRaw === "checkbox" || typeRaw === "select" || typeRaw === "textarea" || typeRaw === "direction-cards") {
    return typeRaw;
  }
  return "text";
}

function attrAt(attrs: string, name: string): string | undefined {
  const dq = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = attrs.match(dq);
  if (m) return m[1];

  const sq = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i");
  const sm = attrs.match(sq);
  if (sm) return sm[1];

  const uq = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i");
  const um = attrs.match(uq);
  return um ? um[1] : undefined;
}

export function formatFormSubmission(
  formId: string,
  values: Record<string, string | string[]>,
): string {
  const lines: string[] = [`[form answers — ${formId}]`];
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
