import { useState, useCallback } from "react";
import { useChatStore } from "../../stores/chat";
import { Folder, ChevronDown, Check, Plus, X } from "lucide-react";

/**
 * Mirror of the Agent-mode WorkspacePicker, but reads/writes from a
 * separate designWorkspacePath + designWorkspaces store fields. Same
 * visual vocabulary — folder icon, chevron, dropdown with workspace rows.
 */
export function DesignWorkspacePicker() {
  const designWorkspacePath = useChatStore((s) => s.designWorkspacePath);
  const setDesignWorkspace = useChatStore((s) => s.setDesignWorkspace);
  const workspaces = useChatStore((s) => s.designWorkspaces);
  const addDesignWorkspace = useChatStore((s) => s.addDesignWorkspace);
  const removeDesignWorkspace = useChatStore((s) => s.removeDesignWorkspace);
  const [open_, setOpen_] = useState(false);
  const [adding, setAdding] = useState(false);

  const handleSelect = useCallback((path: string) => {
    setDesignWorkspace(path);
    // If there's an active conversation, move it to the newly selected
    // folder so it doesn't stay orphaned under null workspacePath.
    const convId = useChatStore.getState().activeId;
    if (convId) {
      useChatStore.getState().moveConversationToWorkspace(convId, path);
    }
    setOpen_(false);
  }, [setDesignWorkspace]);

  const handleNone = useCallback(() => {
    setDesignWorkspace(null);
    // Detach the active conversation from any workspace.
    const convId = useChatStore.getState().activeId;
    if (convId) {
      useChatStore.getState().moveConversationToWorkspace(convId, null);
    }
    setOpen_(false);
  }, [setDesignWorkspace]);

  const handleAdd = useCallback(async () => {
    setAdding(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, title: "Select design folder" });
      if (picked && typeof picked === "string") {
        addDesignWorkspace(picked);
        setDesignWorkspace(picked);
      }
    } catch { /* user cancelled */ }
    finally { setAdding(false); }
    setOpen_(false);
  }, [addDesignWorkspace, setDesignWorkspace]);

  const handleRemove = useCallback(async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeDesignWorkspace(path);
  }, [removeDesignWorkspace]);

  const displayName = designWorkspacePath
    ? designWorkspacePath.split("/").pop() || designWorkspacePath
    : null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen_((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors ${
          designWorkspacePath
            ? "text-[#b4b4b4] hover:text-[#ececec] hover:bg-white/5"
            : "text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5"
        }`}
        title={designWorkspacePath ?? "No design folder"}
      >
        <Folder size={12} strokeWidth={1.75} />
        <span className="max-w-[180px] truncate">{designWorkspacePath ? displayName : "No workspace"}</span>
        <ChevronDown size={10} strokeWidth={2} />
      </button>

      {open_ && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen_(false)} />
          <div className="absolute bottom-full left-0 mb-1.5 w-60 bg-[#2a2a2a] border border-white/10 rounded-xl p-1.5 shadow-xl z-20 animate-[dropdownIn_110ms_ease]">
            <button
              className="flex flex-col gap-0.5 w-full px-2.5 py-2 rounded-md text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors text-left"
              onClick={handleNone}
            >
              None (no folder)
            </button>
            {workspaces.length === 0 && (
              <div className="px-2.5 py-2 text-[12px] text-[#a0a0a0]">No design folders yet.</div>
            )}
            {workspaces.map((ws) => (
              <div
                key={ws}
                className={`flex items-center justify-between w-full px-2.5 py-2 rounded-md text-[13px] transition-colors text-left group/ws ${
                  ws === designWorkspacePath
                    ? "text-[#ececec] bg-white/5"
                    : "text-[#d5d5d5] hover:bg-white/5 hover:text-[#ececec]"
                }`}
              >
                <button
                  className="flex flex-col gap-0.5 min-w-0 flex-1 text-left"
                  onClick={() => handleSelect(ws)}
                >
                  <span className="truncate">{ws.split("/").pop()}</span>
                  <span className="text-[11px] text-[#a0a0a0] font-mono truncate">{ws}</span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  {ws === designWorkspacePath && <Check size={13} className="text-[#f59e42]" />}
                  <button
                    className="w-5 h-5 flex items-center justify-center rounded text-[#666] hover:text-[#f87171] hover:bg-red-500/10 opacity-0 group-hover/ws:opacity-100 transition-all"
                    onClick={(e) => handleRemove(ws, e)}
                    aria-label={`Remove ${ws.split("/").pop()}`}
                    title="Remove design folder"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
            <div className="h-px bg-white/5 mx-1 my-1" />
            <button
              className="flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-[13px] text-[#ececec] hover:bg-white/5 transition-colors font-medium"
              onClick={handleAdd}
              disabled={adding}
            >
              <Plus size={14} strokeWidth={2} />
              {adding ? "Opening dialog…" : "Add design folder…"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
