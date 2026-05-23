import { useState, useRef, useEffect } from "react";
import { useChatStore } from "../stores/chat";
import { PanelLeft, SquarePen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export function TopBar() {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const toggleSidebar = useChatStore((s) => s.toggleSidebar);
  const activeId = useChatStore((s) => s.activeId);
  const conversations = useChatStore((s) => s.conversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const activeConv = conversations.find((c) => c.id === activeId);
  const title = activeConv?.title || "New Conversation";
  const isTitlePending =
    !!activeConv?.isGeneratingTitle && activeConv.title === "New Conversation";

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  const handleNewChat = () => {
    const id = createConversation();
    setActiveConversation(id);
  };

  const handleRename = () => {
    setMenuOpen(false);
    setRenameValue(title);
    setRenaming(true);
  };

  const handleRenameSubmit = () => {
    if (activeId && renameValue.trim()) {
      renameConversation(activeId, renameValue.trim());
    }
    setRenaming(false);
  };

  const handleDelete = () => {
    setMenuOpen(false);
    if (activeId) deleteConversation(activeId);
  };

  return (
    <div
      className="h-[38px] shrink-0 flex items-center gap-1.5 relative z-10"
      style={{ paddingLeft: sidebarOpen ? 8 : 78 }}
      data-tauri-drag-region
    >
      {/* Sidebar toggle — always right after traffic lights */}
      <button
        onClick={toggleSidebar}
        className="p-1.5 rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] transition-colors"
        aria-label={sidebarOpen ? "Hide sidebar" : "Expand sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Expand sidebar"}
      >
        <PanelLeft size={16} strokeWidth={1.75} />
      </button>

      {/* New chat + title + menu — only when sidebar is collapsed */}
      {!sidebarOpen && (
        <>
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] transition-colors"
            aria-label="New chat"
            title="New chat"
          >
            <SquarePen size={16} strokeWidth={1.75} />
          </button>

          {activeId && (
            <>
              <span className="text-[13px] font-medium text-[#ececec] truncate max-w-[300px] select-none ml-1">
                {renaming ? (
                  ""
                ) : isTitlePending ? (
                  <span
                    aria-label="Generating title"
                    className="inline-flex items-center align-middle"
                  >
                    <span className="relative inline-block h-[12px] w-[140px] overflow-hidden rounded-[3px] bg-white/[0.06]">
                      <span
                        aria-hidden
                        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[title-shimmer_1.4s_ease-in-out_infinite]"
                      />
                    </span>
                  </span>
                ) : (
                  title
                )}
              </span>

              {renaming && (
                <input
                  ref={renameRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRenameSubmit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  className="text-[13px] font-medium text-[#ececec] bg-white/[0.06] border border-white/10 rounded-md px-2 py-0.5 outline-none focus:border-[#f59e42]/50 max-w-[240px]"
                />
              )}

              {!renaming && (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="p-1 rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] transition-colors"
                    aria-label="Chat options"
                    title="Chat options"
                  >
                    <MoreHorizontal size={16} strokeWidth={1.75} />
                  </button>

                  {menuOpen && (
                    <div className="absolute top-full left-0 mt-1 w-[160px] rounded-lg bg-[#2a2a2c] border border-white/[0.08] shadow-lg shadow-black/40 overflow-hidden animate-[fadeIn_100ms_ease] z-50">
                      <button
                        onClick={handleRename}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] text-[#d5d5d5] hover:bg-white/[0.06] transition-colors text-left"
                      >
                        <Pencil size={13} strokeWidth={1.75} className="text-[#a0a0a0]" />
                        Rename chat
                      </button>
                      <button
                        onClick={handleDelete}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] text-[#f87171] hover:bg-white/[0.06] transition-colors text-left"
                      >
                        <Trash2 size={13} strokeWidth={1.75} />
                        Delete chat
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="flex-1" data-tauri-drag-region />
    </div>
  );
}
