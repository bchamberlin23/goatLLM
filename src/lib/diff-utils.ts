/**
 * Minimal line-diff utility.
 * Computes added and removed lines between old and new text.
 * Returns a unified-diff-like structure for rendering.
 */

export interface DiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
}

/**
 * Simple LCS-based line diff. Returns a sequence of DiffLine
 * suitable for rendering a side-by-side or unified diff view.
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  let i = m;
  let j = n;
  let added = 0;
  let removed = 0;
  const reversed: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({
        type: "unchanged",
        content: oldLines[i - 1],
        oldLine: i,
        newLine: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({
        type: "added",
        content: newLines[j - 1],
        newLine: j,
      });
      added++;
      j--;
    } else {
      reversed.push({
        type: "removed",
        content: oldLines[i - 1],
        oldLine: i,
      });
      removed++;
      i--;
    }
  }

  return {
    lines: reversed.reverse(),
    added,
    removed,
  };
}

/**
 * Format a diff for display in an approval card.
 * Shows context around changes (3 lines before/after).
 */
export function formatDiffPreview(
  oldText: string,
  newText: string,
  contextLines = 3,
): string {
  const diff = computeDiff(oldText, newText);

  if (diff.added === 0 && diff.removed === 0) {
    return "(no changes)";
  }

  const output: string[] = [];
  let lastWasContext = false;
  let contextCount = 0;

  for (const line of diff.lines) {
    if (line.type === "unchanged") {
      contextCount++;
      if (contextCount <= contextLines) {
        output.push(` ${line.content}`);
        lastWasContext = true;
      } else if (lastWasContext) {
        if (!output[output.length - 1]?.startsWith("@@")) {
          output.push("...");
        }
        lastWasContext = false;
      }
    } else {
      contextCount = 0;
      const prefix = line.type === "added" ? "+" : "-";
      output.push(`${prefix}${line.content}`);
      lastWasContext = false;
    }
  }

  // Clean trailing ellipsis
  while (output.length > 0 && output[output.length - 1] === "...") {
    output.pop();
  }

  const header = `@@ -${oldText.split("\n").length} +${newText.split("\n").length} @@`;
  output.unshift(header);

  return output.join("\n");
}

/**
 * Parse unified git diff text into a DiffResult for display.
 */
export function parseUnifiedDiff(diffText: string): DiffResult {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const raw of diffText.split("\n")) {
    if (
      raw.startsWith("+++") ||
      raw.startsWith("---") ||
      raw.startsWith("@@") ||
      raw.startsWith("diff --git") ||
      raw.startsWith("index ")
    ) {
      continue;
    }
    if (raw.startsWith("+")) {
      lines.push({ type: "added", content: raw.slice(1) });
      added++;
    } else if (raw.startsWith("-")) {
      lines.push({ type: "removed", content: raw.slice(1) });
      removed++;
    } else if (raw.startsWith(" ")) {
      lines.push({ type: "unchanged", content: raw.slice(1) });
    } else if (raw.length > 0) {
      lines.push({ type: "unchanged", content: raw });
    }
  }

  return { lines, added, removed };
}
