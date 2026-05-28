// Strips raw tool-call JSON fragments that some models leak into their visible
// text output. Symptoms the user sees: `{summary`, `{"filename": ...`, or a
// whole `{"query": "..."}` blob appearing inline in the chat. This happens when
// a provider (often local / OpenAI-compatible models) emits tool arguments as
// plain `text-delta` chunks instead of a structured tool-call, or prepends a
// JSON preamble before the real answer.
//
// We only strip JSON objects whose FIRST key is a known tool-argument name, and
// only OUTSIDE fenced code blocks, so legitimate prose and code samples are
// left untouched. Unterminated fragments (a stream cut mid-JSON) are stripped
// to the end of the surrounding text region so partial `{"filename":"rep…`
// never lingers on screen.

// First-key names that identify a leaked tool-argument object.
const TOOL_ARG_KEYS = new Set([
  "summary",
  "filename",
  "file_path",
  "path",
  "query",
  "pattern",
  "expression",
  "content",
  "old_text",
  "new_text",
  "old_string",
  "new_string",
  "title",
  "kind",
  "command",
  "cmd",
  "url",
  "selector",
  "edits",
  "todos",
  "thought",
  "max_matches",
]);

/**
 * Scan a fence-free text region and remove leaked tool-argument JSON objects.
 */
function stripJsonFromRegion(region: string): string {
  let out = "";
  let i = 0;
  const n = region.length;

  while (i < n) {
    const ch = region[i];
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }

    // Peek: is this `{` followed by optional whitespace and a known key?
    let j = i + 1;
    while (j < n && /\s/.test(region[j])) j++;
    const keyMatch = /^"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/.exec(region.slice(j, j + 64));
    if (!keyMatch || !TOOL_ARG_KEYS.has(keyMatch[1])) {
      out += ch;
      i++;
      continue;
    }

    // It's a leaked tool-arg object. Scan to its matching close brace,
    // respecting string literals so braces inside strings don't confuse us.
    let depth = 0;
    let k = i;
    let inString = false;
    let closed = false;
    for (; k < n; k++) {
      const c = region[k];
      if (inString) {
        if (c === "\\") {
          k++; // skip escaped char
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          closed = true;
          break;
        }
      }
    }

    if (closed) {
      // Drop the whole object [i..k]. Also swallow a trailing newline left
      // dangling so we don't leave a blank line behind.
      i = k + 1;
      if (region[i] === "\n") i++;
    } else {
      // Unterminated (stream cut mid-object) — drop to end of region.
      i = n;
    }
  }

  return out;
}

/**
 * Remove leaked tool-argument JSON from assistant text, preserving fenced
 * code blocks verbatim. Safe to call on partial streaming content.
 */
export function stripLeakedToolJson(text: string): string {
  if (!text || text.indexOf("{") === -1) return text;

  // Split on fenced code blocks (```...```), keeping the fences. Even indices
  // are prose regions we sanitize; odd indices are code we leave alone.
  const parts = text.split(/(```[\s\S]*?```|```[\s\S]*$)/g);
  let changed = false;
  const rebuilt = parts.map((part, idx) => {
    if (idx % 2 === 1) return part; // fenced code — leave as-is
    const cleaned = stripJsonFromRegion(part);
    if (cleaned !== part) changed = true;
    return cleaned;
  });
  return changed ? rebuilt.join("") : text;
}
