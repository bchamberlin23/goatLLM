/**
 * Slash-command prompt templates.
 *
 * Inspired by pi-coding-agent's `core/prompt-templates.ts`. A user types
 * `/review` (or `/review src/foo.ts "hot path"`) in the chat box and we
 * expand the template into a full prompt before sending to the LLM.
 *
 * Templates live in:
 *   - <workspace>/.goat/prompts/*.md
 *   - <workspace>/.pi/prompts/*.md         (cross-harness compat)
 *   - <workspace>/.claude/commands/*.md    (cross-harness compat)
 *
 * Format:
 * ```markdown
 * ---
 * description: Review staged changes
 * argument-hint: "<path>"
 * ---
 * Review the changes in $1. Focus on bugs and missing tests.
 * ```
 *
 * Argument substitution mirrors pi:
 *   - $1, $2, ... positional args
 *   - $@ or $ARGUMENTS for all args joined
 *   - ${@:N} for args from N onward (1-indexed)
 *   - ${@:N:L} for L args starting at N
 */

export interface PromptTemplate {
  /** Command name (filename without extension). */
  name: string;
  /** One-line description shown in the autocomplete dropdown. */
  description: string;
  /** Hint shown next to the description (e.g. "<path>"). */
  argumentHint?: string;
  /** Body of the template, before argument substitution. */
  content: string;
  /** Source file path (for diagnostics). */
  filePath: string;
}

/**
 * Parse command arguments respecting bash-style quoted strings. Supports
 * both single and double quotes. Returns an array of decoded args.
 *
 * Examples:
 *   `foo "bar baz" qux`           -> ["foo", "bar baz", "qux"]
 *   `'one two' three`             -> ["one two", "three"]
 *   `simple`                      -> ["simple"]
 */
export function parseCommandArgs(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * Substitute `$1`, `$2`, `$@`, `$ARGUMENTS`, `${@:N}`, and `${@:N:L}` in
 * `content` against the provided args.
 *
 * Argument values are NOT recursively substituted (so an arg containing
 * `$1` won't be expanded again).
 */
export function substituteArgs(content: string, args: string[]): string {
  // ${@:N:L} or ${@:N}
  let result = content.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_match, nStr, lStr) => {
    const n = Math.max(1, parseInt(nStr, 10));
    const slice = args.slice(n - 1, lStr ? n - 1 + parseInt(lStr, 10) : undefined);
    return slice.join(" ");
  });
  // $@ or $ARGUMENTS
  result = result.replace(/\$ARGUMENTS\b/g, args.join(" "));
  result = result.replace(/\$@/g, args.join(" "));
  // $1 .. $9 (and beyond, greedy)
  result = result.replace(/\$(\d+)/g, (_match, n) => {
    const idx = parseInt(n, 10) - 1;
    return idx >= 0 && idx < args.length ? args[idx] : "";
  });
  return result;
}

/** Parse `--- frontmatter ---` block off the top of a markdown string. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    // Strip wrapping quotes if present.
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[kv[1].toLowerCase()] = v;
  }
  return { meta, body: (m[2] ?? "").replace(/^\n+/, "") };
}

/**
 * Build a PromptTemplate from a file's name and raw content. Pure for testability.
 */
export function parsePromptTemplate(name: string, filePath: string, raw: string): PromptTemplate {
  const { meta, body } = parseFrontmatter(raw);
  const firstLine = body.split(/\n/).find((l) => l.trim().length > 0) ?? "";
  return {
    name,
    description: meta.description ?? firstLine.slice(0, 120),
    argumentHint: meta["argument-hint"] || undefined,
    content: body,
    filePath,
  };
}

/**
 * If `text` starts with a slash command and the name matches a template,
 * return the expanded text. Otherwise return the original text.
 */
export function expandPromptTemplate(text: string, templates: PromptTemplate[]): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return text;
  const m = trimmed.match(/^\/([A-Za-z0-9_:.-]+)(?:\s+([\s\S]*))?$/);
  if (!m) return text;
  const [, name, rest] = m;
  const tpl = templates.find((t) => t.name === name);
  if (!tpl) return text;
  const args = rest ? parseCommandArgs(rest) : [];
  return substituteArgs(tpl.content, args);
}

// ── Loading from disk ──

const TEMPLATE_DIRS = [".goat/prompts", ".pi/prompts", ".claude/commands"] as const;

interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

/**
 * Discover prompt templates under the given workspace. Silently skips
 * directories that don't exist. Templates from earlier dirs win on name
 * collisions (TEMPLATE_DIRS order is intentional: native first).
 */
export async function loadPromptTemplates(workspace: string): Promise<PromptTemplate[]> {
  const seen = new Map<string, PromptTemplate>();
  for (const dir of TEMPLATE_DIRS) {
    let entries: DirEntry[] = [];
    try {
      entries = await invoke<DirEntry[]>("list_dir", { workspace, path: dir });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.is_dir) continue;
      if (!entry.name.endsWith(".md")) continue;
      const name = entry.name.replace(/\.md$/, "");
      if (seen.has(name)) continue;
      try {
        const raw = await invoke<string>("read_file", {
          workspace,
          path: `${dir}/${entry.name}`,
          offset: null,
          limit: null,
        });
        seen.set(name, parsePromptTemplate(name, `${dir}/${entry.name}`, raw));
      } catch {
        // unreadable — skip
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
