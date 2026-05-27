/**
 * Internal helpers shared across the split tools modules.
 *
 * These were inlined in the original src/lib/tools.ts; lifted here so the
 * builtins/, approval, and (forthcoming) mcp + subagent modules can share
 * one set of workspace + tauri-invoke + temp-file utilities without
 * forming a circular dependency back through tools.ts.
 */
import { useChatStore } from "../../stores/chat";

export function getWorkspace(): string {
  const s = useChatStore.getState();
  const ws = s.designMode ? s.designWorkspacePath : s.workspacePath;
  if (!ws) throw new Error("No workspace selected");
  return ws;
}

/** Normalize a path to be relative to the workspace root. Strips the workspace
 * prefix if the model accidentally passes an absolute path, and removes leading slashes. */
export function normalizePath(path: string): string {
  const ws = getWorkspace().replace(/\/+$/, "");

  // Strip exact workspace prefix (with or without trailing slash)
  if (path === ws) return "";
  for (const prefix of [ws + "/", ws]) {
    if (path.startsWith(prefix)) {
      path = path.slice(prefix.length);
      break;
    }
  }

  // Strip workspace prefix without leading slashes
  const wsNoSlash = ws.replace(/^\/+/, "");
  if (path !== wsNoSlash) {
    for (const prefix of [wsNoSlash + "/", wsNoSlash]) {
      if (path.startsWith(prefix)) {
        path = path.slice(prefix.length);
        break;
      }
    }
  }

  // Belt and suspenders — check if the path accidentally embeds
  // the workspace deeper in (model hallucinated a full nested path).
  const needle = "/" + wsNoSlash + "/";
  const idx = path.indexOf(needle);
  if (idx >= 0) {
    path = path.slice(idx + needle.length);
  }

  path = path.replace(/^\/+/, "");
  return path;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

/** Cached path to the OS temp dir, resolved once via the Tauri backend. */
let cachedTempDir: string | null = null;
export async function getTempDir(): Promise<string> {
  if (cachedTempDir) return cachedTempDir;
  try {
    cachedTempDir = (await invoke<string>("os_temp_dir")).replace(/\/+$/, "");
  } catch {
    cachedTempDir = "/tmp";
  }
  return cachedTempDir;
}

/** Best-effort spillover. Returns the temp-file path on success, undefined on failure. */
export async function spillToTempFile(prefix: string, content: string): Promise<string | undefined> {
  try {
    const dir = await getTempDir();
    const path = `${dir}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    await invoke<string>("write_temp_file", { path, content });
    return path;
  } catch {
    return undefined;
  }
}
