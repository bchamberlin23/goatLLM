import { useState, useEffect, useCallback } from "react";
import { useChatStore } from "../stores/chat";
import { open } from "@tauri-apps/plugin-dialog";
import { Folder, ChevronDown, Check, Plus, X } from "lucide-react";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<string[]>("list_workspaces");
      setWorkspaces(list);
    } catch (e) {
      setError(String(e));
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { workspaces, loading, error, refresh };
}

export function WorkspacePicker() {
  const workspacePath = useChatStore((s) => s.workspacePath);
  const setWorkspace = useChatStore((s) => s.setWorkspace);
  const { workspaces, loading, error, refresh } = useWorkspaces();
  const [open_, setOpen_] = useState(false);
  const [adding, setAdding] = useState(false);

  const handleSelect = useCallback((path: string) => {
    setWorkspace(path);
    setOpen_(false);
  }, [setWorkspace]);

  const handleNone = useCallback(() => {
    setWorkspace(null);
    setOpen_(false);
  }, [setWorkspace]);

  const handleAdd = useCallback(async () => {
    setAdding(true);
    try {
      const picked = await open({ directory: true, multiple: false, title: "Select workspace directory" });
      if (picked && typeof picked === "string") {
        await invoke("add_workspace", { path: picked });
        setWorkspace(picked);
        refresh();
      }
    } catch (e) {
      console.warn("Failed to add workspace:", e);
    } finally {
      setAdding(false);
    }
    setOpen_(false);
  }, [refresh, setWorkspace]);

  const handleRemove = useCallback(async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("remove_workspace", { path });
      if (workspacePath === path) setWorkspace(null);
      refresh();
    } catch (err) {
      console.warn("Failed to remove workspace:", err);
    }
  }, [workspacePath, setWorkspace, refresh]);

  const displayName = workspacePath
    ? workspacePath.split("/").pop() || workspacePath
    : null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen_((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors ${
          workspacePath
            ? "text-text-2 hover:text-text-1 hover:bg-white/5"
            : "text-text-3 hover:text-text-1 hover:bg-white/5"
        }`}
        title={workspacePath ?? "No workspace"}
      >
        <Folder size={12} strokeWidth={1.75} />
        <span className="max-w-[180px] truncate">{workspacePath ? displayName : "No workspace"}</span>
        <ChevronDown size={10} strokeWidth={2} />
      </button>

      {open_ && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen_(false)} />
          <div className="motion-popover-in absolute bottom-full left-0 mb-1.5 w-60 popover-surface rounded-xl p-1.5 z-20">
            <button
              className="motion-row flex flex-col gap-0.5 w-full px-2.5 py-2 rounded-md text-[13px] text-text-2 hover:bg-white/5 hover:text-text-1 transition-colors text-left"
              onClick={handleNone}
            >
              None (chat only)
            </button>
            {loading && !error && (
              <div className="px-2.5 py-2 text-[12px] text-text-3">Loading workspaces…</div>
            )}
            {error && (
              <div className="flex items-center justify-between px-2.5 py-2">
                <span className="text-[12px] text-error">Failed to load</span>
                <button onClick={refresh} className="text-[12px] text-text-1 hover:underline">Retry</button>
              </div>
            )}
            {workspaces.map((ws) => (
              <div
                key={ws}
                className={`motion-row flex items-center justify-between w-full px-2.5 py-2 rounded-md text-[13px] transition-colors text-left group/ws ${
                  ws === workspacePath
                    ? "text-text-1 bg-white/5"
                    : "text-text-2 hover:bg-white/5 hover:text-text-1"
                }`}
              >
                <button
                  className="flex flex-col gap-0.5 min-w-0 flex-1 text-left"
                  onClick={() => handleSelect(ws)}
                >
                  <span className="truncate">{ws.split("/").pop()}</span>
                  <span className="text-[11px] text-text-3 font-mono truncate">{ws}</span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  {ws === workspacePath && <Check size={13} className="motion-pop-in text-accent" />}
                  <button
                    className="w-5 h-5 flex items-center justify-center rounded text-text-4 hover:text-error hover:bg-red-500/10 opacity-0 group-hover/ws:opacity-100 transition-all"
                    onClick={(e) => handleRemove(ws, e)}
                    aria-label={`Remove ${ws.split("/").pop()}`}
                    title="Remove workspace"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
            <div className="h-px bg-white/5 mx-1 my-1" />
            <button
              className="motion-row flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-[13px] text-text-1 hover:bg-white/5 transition-colors font-medium"
              onClick={handleAdd}
              disabled={adding}
            >
              <Plus size={14} strokeWidth={2} />
              {adding ? "Opening dialog…" : "Add workspace…"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
