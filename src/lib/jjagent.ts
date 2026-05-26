import { invoke } from "./tools/_helpers";

export interface JjAgentSession {
  changeId: string;
  startedAt: number;
}

let availabilityCache: { available: boolean; checkedAt: number } | null = null;
const AVAILABILITY_TTL = 30_000;

/**
 * Check whether jjagent can operate in the given workspace.
 * Results are cached for 30 seconds to avoid redundant shell-outs on every
 * input-bar render cycle.
 */
export async function checkJjAgentAvailable(workspace: string): Promise<boolean> {
  const now = Date.now();
  if (availabilityCache && availabilityCache.checkedAt > now - AVAILABILITY_TTL) {
    return availabilityCache.available;
  }

  try {
    const installed = await invoke<boolean>("is_jj_installed");
    if (!installed) {
      availabilityCache = { available: false, checkedAt: now };
      return false;
    }
    const isRepo = await invoke<boolean>("is_jj_repo", { workspace });
    availabilityCache = { available: isRepo, checkedAt: now };
    return isRepo;
  } catch {
    availabilityCache = { available: false, checkedAt: now };
    return false;
  }
}

/**
 * Clear the availability cache so the next check hits the Tauri backend.
 * Call after the user toggles jjagent in settings or changes workspace.
 */
export function clearJjAvailabilityCache(): void {
  availabilityCache = null;
}

/**
 * Start a jjagent session — creates a new jj change for this turn's edits
 * to live in. Returns the session info or null if jj is unavailable.
 */
export async function startJjAgentSession(
  workspace: string,
  convId: string,
  turnIndex: number,
): Promise<JjAgentSession | null> {
  try {
    const available = await checkJjAgentAvailable(workspace);
    if (!available) return null;

    const description = `goatllm agent turn ${turnIndex}\n\nClaude-session-id: ${convId}-${turnIndex}`;
    const changeId = await invoke<string>("jj_new", { workspace, description });
    if (!changeId) return null;

    return { changeId, startedAt: Date.now() };
  } catch (e) {
    console.warn("jjagent: failed to start session:", e);
    return null;
  }
}

/**
 * End a jjagent session — updates the change description with a completion
 * marker and squashes the change back into its parent. Always succeeds
 * silently (errors are logged but never thrown — agent execution must not
 * be blocked by jj issues).
 */
export async function endJjAgentSession(
  workspace: string,
  session: JjAgentSession,
): Promise<void> {
  try {
    const elapsed = Math.round((Date.now() - session.startedAt) / 1000);
    await invoke("jj_describe", {
      workspace,
      changeId: session.changeId,
      description: `goatllm agent turn (completed in ${elapsed}s)\n\nClaude-session-id: (complete)`,
    });
  } catch (e) {
    console.warn("jjagent: failed to describe change before squash:", e);
  }

  try {
    await invoke("jj_squash", { workspace, changeId: session.changeId });
  } catch (e) {
    console.warn("jjagent: failed to squash change:", e);
  }
}
