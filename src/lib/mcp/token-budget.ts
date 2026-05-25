/**
 * Token budget estimation for MCP tools.
 *
 * Cheap heuristic: chars / 4 (roughly aligned with typical English text
 * tokenization in most models). Labeled as approximate per D21=B —
 * codex flagged precision-numbers as fake confidence.
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Format a token estimate for display in Settings UI.
 * Always returns "≈ N tokens (rough)" to make the approximation explicit.
 */
export function formatTokenEstimate(tokens: number): string {
  return `≈ ${tokens} tokens (rough)`;
}

/**
 * Estimate total token cost of a tool's rendered prompt entry.
 * Takes the tool name + description and returns an approximate count.
 */
export function estimateToolTokens(
  name: string,
  description?: string,
): number {
  const rendered = `- ${name}: ${description ?? "(no description)"}`;
  return estimateTokens(rendered);
}
