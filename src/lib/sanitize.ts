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
  "name",
  "id",
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
  "offset",
  "limit",
  "max_results",
  "context_lines",
]);

/** Match a tool-arg key at the start of a JSON object (quoted or unquoted). */
const TOOL_KEY_RE = /^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*:/;

/**
 * True when `{` at `i` is followed only by whitespace / quote / a partial
 * known-key prefix and the region ends before `:` — a streaming tail fragment
 * like `{ name` or `{summary` that should not flash on screen.
 */
function isStreamingTailFragment(region: string, i: number): boolean {
  let j = i + 1;
  const n = region.length;
  while (j < n && /\s/.test(region[j])) j++;
  if (j >= n) return true;
  if (region[j] === '"') {
    const close = region.indexOf('"', j + 1);
    if (close === -1) {
      const partial = region.slice(j + 1);
      return [...TOOL_ARG_KEYS].some(
        (k) => k.startsWith(partial) || partial.startsWith(k),
      );
    }
    const key = region.slice(j + 1, close);
    if (!TOOL_ARG_KEYS.has(key)) return false;
    j = close + 1;
    while (j < n && /\s/.test(region[j])) j++;
    return j >= n || region[j] !== ":";
  }
  const rest = region.slice(j);
  const colon = rest.search(/[:{}\[\]"\\]/);
  const token = (colon === -1 ? rest : rest.slice(0, colon)).trim();
  if (!token) return true;
  return [...TOOL_ARG_KEYS].some(
    (k) => k.startsWith(token) || token.startsWith(k),
  );
}

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
    const keyMatch = TOOL_KEY_RE.exec(region.slice(j, j + 64));
    if (!keyMatch || !TOOL_ARG_KEYS.has(keyMatch[1])) {
      if (isStreamingTailFragment(region, i)) {
        i = n;
        continue;
      }
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
/** Bare tool-call syntax some models leak as visible text. */
const LEAKED_TOOL_CALL_RE =
  /\b(?:read_attachment|search_attachment|web_search|load_skill)\s*(?:\{\s*\}|\(\s*\))/gi;
const LEAKED_TOOL_CALL_OPEN_RE =
  /\b(?:read_attachment|search_attachment|web_search|load_skill)\s*(?:\{\s*|\(\s*)/gi;
/** Bare snake_case tool names (avoid matching English words like "done"). */
const LEAKED_TOOL_NAME_RE =
  /\b(?:read_attachment|search_attachment|web_search|load_skill)\b/gi;

function stripLeakedToolInvocations(region: string): string {
  return region
    .replace(LEAKED_TOOL_CALL_RE, "")
    .replace(LEAKED_TOOL_CALL_OPEN_RE, "")
    .replace(LEAKED_TOOL_NAME_RE, "");
}

export function stripLeakedToolJson(text: string): string {
  if (!text) return text;
  const hasJson = text.indexOf("{") !== -1;
  const hasToolLeak =
    LEAKED_TOOL_CALL_RE.test(text) ||
    LEAKED_TOOL_CALL_OPEN_RE.test(text) ||
    LEAKED_TOOL_NAME_RE.test(text);
  LEAKED_TOOL_CALL_RE.lastIndex = 0;
  LEAKED_TOOL_CALL_OPEN_RE.lastIndex = 0;
  LEAKED_TOOL_NAME_RE.lastIndex = 0;
  if (!hasJson && !hasToolLeak) return text;

  // Split on fenced code blocks (```...```), keeping the fences. Even indices
  // are prose regions we sanitize; odd indices are code we leave alone.
  const parts = text.split(/(```[\s\S]*?```|```[\s\S]*$)/g);
  let changed = false;
  const rebuilt = parts.map((part, idx) => {
    if (idx % 2 === 1) return part; // fenced code — leave as-is
    let cleaned = hasJson ? stripJsonFromRegion(part) : part;
    const noTools = stripLeakedToolInvocations(cleaned);
    if (noTools !== cleaned) {
      cleaned = noTools;
      changed = true;
    }
    if (hasJson && cleaned !== part) changed = true;
    return cleaned;
  });
  return changed ? rebuilt.join("") : text;
}
