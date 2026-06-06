import type { Citation } from "../stores/chat";

/**
 * Citation plumbing for chat mode.
 *
 * The model is given a numbered list of available sources (attached documents
 * up front, web-search results as they stream in) and asked to cite them
 * inline with bracketed numbers like `[1]` or `[2, 3]`. After the turn we scan
 * the final reply for those markers — only the numbers that actually appear
 * become citations. Availability of a source never produces a citation; the
 * model has to use it.
 */

/** Strip fenced and inline code so `arr[0]` / `list[2]` in code samples never
 *  get mistaken for citation markers. */
function stripCode(text: string): string {
  return text
    // Fenced code blocks (``` … ```), keep newlines for offset sanity.
    .replace(/```[\s\S]*?```/g, "")
    // Inline code (`…`).
    .replace(/`[^`]*`/g, "");
}

/**
 * Find every source number the model cited inline. Handles `[1]`, `[1, 2]`,
 * `[1][2]` and the footnote form `[^1]`. Ignores anything inside code.
 */
export function extractCitedIndices(text: string): Set<number> {
  const used = new Set<number>();
  if (!text) return used;
  const scan = stripCode(text);

  // Match bracketed groups of comma/space-separated numbers, with an optional
  // leading caret for the footnote style: [^1], [1], [1, 2], [1,2,3].
  const re = /\[\^?(\d+(?:\s*,\s*\d+)*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scan)) !== null) {
    for (const part of m[1].split(",")) {
      const n = parseInt(part.trim(), 10);
      if (Number.isFinite(n) && n > 0) used.add(n);
    }
  }
  return used;
}

/**
 * Given the turn's full source registry and the final reply text, return the
 * subset of sources the model actually cited, in ascending index order.
 */
export function selectUsedCitations(
  registry: Citation[],
  finalText: string,
): Citation[] {
  if (registry.length === 0) return [];
  const used = extractCitedIndices(finalText);
  if (used.size === 0) return [];
  return registry
    .filter((c) => used.has(c.index))
    .sort((a, b) => a.index - b.index);
}

/**
 * Build the `<citations>` system-prompt block for a chat turn. Lists the
 * document sources known at send time (web results get their numbers injected
 * into the search tool output as they arrive) and instructs the model on the
 * marker format. Returns "" when there's nothing to cite and web search is off.
 */
export function buildCitationInstructions(
  documentSources: Citation[],
  webSearchAvailable: boolean,
): string {
  if (documentSources.length === 0 && !webSearchAvailable) return "";

  const lines: string[] = [
    "<citations>",
    "When you state a fact drawn from a provided source — an attached document or a web search result — cite it inline with a bracketed number that matches the source, e.g. \"The release shipped in March [1].\" Put the marker right after the clause it supports. You may group numbers: [2, 3].",
  ];

  if (documentSources.length > 0) {
    lines.push("", "Document sources available this turn:");
    for (const s of documentSources) {
      lines.push(`[${s.index}] ${s.title}`);
    }
  }

  if (webSearchAvailable) {
    lines.push(
      "",
      'Each web_search result includes a "cite" value like [2] — use exactly that marker inline when you reference that result.',
    );
  }

  lines.push(
    "",
    "Only cite a source when you actually use information from it. Never invent source numbers, and never cite a number that wasn't provided.",
    "</citations>",
  );

  return lines.join("\n");
}
