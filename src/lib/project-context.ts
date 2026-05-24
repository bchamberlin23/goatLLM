/**
 * Load project-context files from the workspace root.
 *
 * Pi's pattern: a small set of well-known filenames (`CLAUDE.md`, `AGENTS.md`,
 * etc.) get auto-injected into the system prompt so the agent picks up
 * project conventions without burning a tool call. goatLLM follows the same
 * pattern, with `GOAT.md` as the native primary and the others as
 * cross-harness compatibility entries.
 */
import type { ProjectContextFile } from "./system-prompt";

/** Filenames we look for, in priority order (first match wins per name). */
export const PROJECT_CONTEXT_FILES = [
  "GOAT.md",
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".windsurfrules",
] as const;

/** Hard cap so a runaway 5MB AGENTS.md doesn't blow up the system prompt. */
export const MAX_CONTEXT_FILE_BYTES = 64 * 1024;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

/**
 * Read project-context files from the workspace root. Silently skips files
 * that don't exist or can't be read; we never want a missing GOAT.md to
 * break agent mode.
 */
export async function loadProjectContext(workspace: string): Promise<ProjectContextFile[]> {
  const out: ProjectContextFile[] = [];
  for (const name of PROJECT_CONTEXT_FILES) {
    try {
      const content = await invoke<string>("read_file", {
        workspace,
        path: name,
        offset: null,
        limit: null,
      });
      if (typeof content !== "string" || content.length === 0) continue;
      const trimmed =
        content.length > MAX_CONTEXT_FILE_BYTES
          ? content.slice(0, MAX_CONTEXT_FILE_BYTES) +
            `\n\n[truncated — file is ${content.length} bytes, only first ${MAX_CONTEXT_FILE_BYTES} included]`
          : content;
      out.push({ path: name, content: trimmed });
    } catch {
      // file missing / unreadable — skip silently
    }
  }
  return out;
}
