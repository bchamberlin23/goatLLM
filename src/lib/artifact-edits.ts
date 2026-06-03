/**
 * Selective artifact editing via inline edit markers.
 *
 * In chat mode the LLM has no tool access, so it can't call `edit_artifact`.
 * Instead it can emit a fenced artifact block whose body contains `<<<EDIT>>>`
 * markers.  The parser here detects that syntax and converts it into the same
 * `{ oldText, newText }[]` shape that `editArtifactByKindAndTitle` already
 * consumes — so the store can apply surgical replacements instead of a full
 * rewrite.
 *
 * Syntax:
 *
 *   <<<EDIT>>>
 *   <<<OLD>>>
 *   exact text to find
 *   <<<NEW>>>
 *   replacement text
 *   <<<END>>>
 *
 * Multiple edit blocks are allowed in a single fence.  Lines outside any
 * `<<<EDIT>>>…<<<END>>>` pair are ignored (the LLM sometimes adds prose
 * around the markers).
 */

// ─── Detection ────────────────────────────────────────────────────────────────

const EDIT_MARKER = "<<<EDIT>>>";

/**
 * Returns `true` when the fenced code body looks like an edit-mode artifact
 * rather than a full replacement.  Fast — just a substring check.
 */
export function isEditArtifact(code: string): boolean {
  return code.includes(EDIT_MARKER);
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

export interface EditBlock {
  oldText: string;
  newText: string;
}

/**
 * Extract all `<<<EDIT>>>…<<<END>>>` blocks from a fenced body.
 *
 * Each block must contain exactly one `<<<OLD>>>` and one `<<<NEW>>>` marker.
 * Malformed blocks (missing markers, wrong order) are silently skipped so a
 * partially-streamed fence doesn't blow up.
 */
export function parseEditBlocks(code: string): EditBlock[] {
  const edits: EditBlock[] = [];

  // Split into candidate blocks.  We look for regions bracketed by
  // <<<EDIT>>> … <<<END>>>.  Using a regex that tolerates optional
  // whitespace around the markers so the LLM's formatting quirks don't
  // break detection.
  const blockRegex = /<<<EDIT>>>[ \t]*\n?([\s\S]*?)<<<END>>>[ \t]*/g;
  let m: RegExpExecArray | null;

  while ((m = blockRegex.exec(code)) !== null) {
    const body = m[1];

    // Within the block, split on <<<OLD>>> and <<<NEW>>>.
    const oldIdx = body.indexOf("<<<OLD>>>");
    const newIdx = body.indexOf("<<<NEW>>>");
    if (oldIdx === -1 || newIdx === -1 || newIdx <= oldIdx) continue;

    const oldMarkerEnd = oldIdx + "<<<OLD>>>".length;
    const rawOld = body.slice(oldMarkerEnd, newIdx);
    const rawNew = body.slice(newIdx + "<<<NEW>>>".length);

    // Trim a single leading newline (the LLM almost always puts the content
    // on the next line after the marker) but preserve internal whitespace.
    const oldText = stripSurroundingNewline(rawOld);
    const newText = stripSurroundingNewline(rawNew);

    edits.push({ oldText, newText });
  }

  return edits;
}

/**
 * Strip at most one leading and one trailing newline.  Preserves all other
 * whitespace so indentation-sensitive edits work correctly.
 */
function stripSurroundingNewline(s: string): string {
  let result = s;
  if (result.startsWith("\n")) result = result.slice(1);
  if (result.endsWith("\n")) result = result.slice(0, -1);
  return result;
}

// ─── Application ──────────────────────────────────────────────────────────────

export interface ApplyResult {
  /** The patched code after all successful edits. */
  code: string;
  /** Number of edits successfully applied. */
  applied: number;
  /** oldText values that weren't found in the code. */
  failed: string[];
}

/**
 * Apply a sequence of edit blocks to `originalCode`.
 *
 * Each edit does a single `indexOf` match (not regex) — consistent with the
 * existing `editArtifactByKindAndTitle` store method.  Edits are applied
 * sequentially so later edits see the result of earlier ones.
 *
 * If `oldText` is empty the edit is skipped (safety: don't insert at index 0).
 */
export function applyEditBlocks(
  originalCode: string,
  edits: EditBlock[],
): ApplyResult {
  let code = originalCode;
  let applied = 0;
  const failed: string[] = [];

  for (const { oldText, newText } of edits) {
    if (!oldText) {
      failed.push("(empty oldText)");
      continue;
    }
    const idx = code.indexOf(oldText);
    if (idx === -1) {
      failed.push(oldText.slice(0, 80));
      continue;
    }
    code = code.slice(0, idx) + newText + code.slice(idx + oldText.length);
    applied++;
  }

  return { code, applied, failed };
}
