import { useState, useRef, useEffect, useMemo } from "react";
import { useChatStore } from "../stores/chat";
import { SquarePen, MoreHorizontal, Pencil, Trash2, FileCode, FileText, Image, Paperclip, Code, Terminal } from "lucide-react";
import { WorkspaceFileTree } from "./WorkspaceFileTree";
import { ContextMeter } from "./ContextMeter";

export function TopBar() {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const activeId = useChatStore((s) => s.activeId);
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const conversations = useChatStore((s) => s.conversations);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [editingSystemPrompt, setEditingSystemPrompt] = useState(false);
  const [systemPromptValue, setSystemPromptValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const systemPromptRef = useRef<HTMLTextAreaElement>(null);
  const setSystemPrompt = useChatStore((s) => s.setSystemPrompt);

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
    // Match the sidebar's behavior — just navigate to the empty new-chat
    // state. The actual conversation row is created on first message send.
    // Creating it eagerly here was producing stray "New Conversation" rows
    // every time the user clicked the top-bar plus.
    setActiveConversation(null);
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

  const handleEditSystemPrompt = () => {
    setMenuOpen(false);
    if (activeId) {
      setSystemPromptValue(activeConv?.systemPrompt || "");
      setEditingSystemPrompt(true);
      requestAnimationFrame(() => systemPromptRef.current?.focus());
    }
  };

  const handleSystemPromptSubmit = () => {
    if (activeId) {
      setSystemPrompt(activeId, systemPromptValue.trim());
    }
    setEditingSystemPrompt(false);
  };

  return (
    <div
      className="h-[38px] shrink-0 flex items-center gap-1.5 relative z-10"
      style={{ paddingLeft: sidebarOpen ? 8 : 110, paddingRight: 12 }}
      data-tauri-drag-region
    >
      {/* Context window meter — on the left, next to the sidebar border */}
      {activeId && <ContextMeter />}

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
              <span className="text-[13px] font-medium text-[#ececec] truncate max-w-[300px] ml-1">
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
                    <div className="absolute top-full left-0 mt-1 w-[180px] rounded-lg bg-[#2a2a2c] border border-white/[0.08] shadow-lg shadow-black/40 overflow-hidden animate-[fadeIn_100ms_ease] z-50">
                      <button
                        onClick={handleRename}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] text-[#d5d5d5] hover:bg-white/[0.06] transition-colors text-left"
                      >
                        <Pencil size={13} strokeWidth={1.75} className="text-[#a0a0a0]" />
                        Rename chat
                      </button>
                      <button
                        onClick={handleEditSystemPrompt}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] text-[#d5d5d5] hover:bg-white/[0.06] transition-colors text-left"
                      >
                        <Terminal size={13} strokeWidth={1.75} className="text-[#a0a0a0]" />
                        System prompt
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

      {/* Right-side assets menu (artifacts + uploaded files) */}
      {(activeId || agentMode || designMode) && <ChatAssetsMenu />}

      {/* System prompt editor modal */}
      {editingSystemPrompt && activeId && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm animate-[fadeIn_150ms_ease]"
          onClick={() => setEditingSystemPrompt(false)}
        >
          <div
            className="w-[500px] max-w-[90vw] bg-[#2a2a2c] border border-white/10 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.6)] overflow-hidden animate-[contextMenuIn_180ms_ease]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h3 className="text-[15px] font-semibold text-[#ececec]">System prompt</h3>
              <button
                onClick={() => setEditingSystemPrompt(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors"
              >
                ×
              </button>
            </div>
            <div className="p-5">
              <p className="text-[12.5px] text-[#a0a0a0] mb-3">
                Custom instructions for this conversation. Leave empty to use the default. Appended to the built-in system prompt.
              </p>
              <textarea
                ref={systemPromptRef}
                value={systemPromptValue}
                onChange={(e) => setSystemPromptValue(e.target.value)}
                placeholder="e.g., Be concise. Focus on security implications."
                rows={4}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-[13px] text-[#ececec] placeholder:text-[#6a6a6a] resize-none outline-none focus:border-[#f59e42]/50 focus:ring-1 focus:ring-[#f59e42]/25"
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setEditingSystemPrompt(false)}
                  className="px-4 py-2 rounded-lg text-[12.5px] text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSystemPromptSubmit}
                  className="px-4 py-2 rounded-lg text-[12.5px] font-medium bg-[#f59e42] text-black hover:bg-[#f0903a] transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 3-dot assets menu (top-right) ──

function ChatAssetsMenu() {
  const activeId = useChatStore((s) => s.activeId);
  const artifacts = useChatStore((s) => (activeId ? s.artifacts[activeId] : undefined));
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] : undefined));
  const setActiveArtifact = useChatStore((s) => s.setActiveArtifact);
  const setActiveAttachment = useChatStore((s) => s.setActiveAttachment);
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const workspacePath = useChatStore((s) => s.workspacePath);
  const designWorkspacePath = useChatStore((s) => s.designWorkspacePath);

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Gather all attachments from user messages in this chat
  const attachments = useMemo(() => {
    if (!messages) return [];
    const result: { filename: string; mimeType: string; dataUrl: string; messageId: string }[] = [];
    for (const msg of messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          result.push({ ...att, messageId: msg.id });
        }
      }
    }
    return result;
  }, [messages]);

  const hasContent = (artifacts && artifacts.length > 0) || attachments.length > 0 || (agentMode && !!workspacePath) || (designMode && !!designWorkspacePath);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`relative p-1.5 mt-[3px] rounded-md transition-colors ${
          hasContent
            ? "text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06]"
            : "text-[#666] hover:text-[#a0a0a0] hover:bg-white/[0.04]"
        }`}
        aria-label="Chat assets"
        title="Artifacts & files"
      >
        <MoreHorizontal size={16} strokeWidth={1.75} />
        {hasContent && (
          <span className="absolute top-1 right-1 w-[5px] h-[5px] rounded-full bg-[#f59e42]" />
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-[300px] max-h-[420px] overflow-y-auto rounded-xl bg-[#2a2a2c] border border-white/[0.08] shadow-lg shadow-black/40 z-50 animate-[fadeIn_100ms_ease]">
          {/* Workspace file tree (agent mode) — shows files the agent created/modified */}
          {agentMode && (
            <>
              <WorkspaceFileTree onOpenFile={(a) => { setActiveAttachment(a); setOpen(false); }} />
              {(artifacts && artifacts.length > 0 || attachments.length > 0) && (
                <div className="h-px bg-white/5 mx-2" />
              )}
            </>
          )}

          {/* Design workspace file tree */}
          {designMode && designWorkspacePath && (
            <>
              <WorkspaceFileTree onOpenFile={(a) => { setActiveAttachment(a); setOpen(false); }} />
              {(artifacts && artifacts.length > 0 || attachments.length > 0) && (
                <div className="h-px bg-white/5 mx-2" />
              )}
            </>
          )}

          {/* Artifacts section */}
          {artifacts && artifacts.length > 0 && (
            <div className="p-1.5">
              <div className="px-2.5 py-1.5 text-[10.5px] uppercase tracking-wider text-[#8e8e8e] font-semibold">
                Artifacts
              </div>
              {artifacts.map((art) => {
                const Icon = art.kind === "html" ? FileCode : art.kind === "python" ? Code : FileText;
                return (
                  <button
                    key={art.id}
                    onClick={() => { setActiveArtifact(art.id); setOpen(false); }}
                    className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left hover:bg-white/[0.06] transition-colors"
                  >
                    <Icon size={13} strokeWidth={1.75} className="text-[#a0a0a0] shrink-0" />
                    <span className="text-[12.5px] text-[#d5d5d5] truncate flex-1">{art.title}</span>
                    <span className="text-[10px] text-[#888] bg-white/5 px-1.5 py-0.5 rounded shrink-0">
                      {art.kind === "html" ? "HTML" : art.kind === "python" ? "Python" : "LaTeX"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Divider */}
          {artifacts && artifacts.length > 0 && attachments.length > 0 && (
            <div className="h-px bg-white/5 mx-2" />
          )}

          {/* Files section (user-uploaded attachments) */}
          {attachments.length > 0 && (
            <div className="p-1.5">
              <div className="px-2.5 py-1.5 text-[10.5px] uppercase tracking-wider text-[#8e8e8e] font-semibold">
                Attached files
              </div>
              {attachments.map((att, i) => {
                const isImage = att.mimeType.startsWith("image/");
                const Icon = isImage ? Image : Paperclip;
                return (
                  <div
                    key={`${att.messageId}-${i}`}
                    className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg hover:bg-white/[0.06] transition-colors"
                  >
                    {isImage ? (
                      <img
                        src={att.dataUrl}
                        alt={att.filename}
                        className="w-6 h-6 rounded object-cover shrink-0 border border-white/10"
                      />
                    ) : (
                      <Icon size={13} strokeWidth={1.75} className="text-[#a0a0a0] shrink-0" />
                    )}
                    <span className="text-[12.5px] text-[#d5d5d5] truncate flex-1">{att.filename}</span>
                    <span className="text-[10px] text-[#888] shrink-0">
                      {att.mimeType.split("/")[1]?.toUpperCase() ?? "FILE"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {!hasContent && (
            <div className="flex flex-col items-center gap-2 py-6 px-4 text-center">
              <Paperclip size={16} strokeWidth={1.5} className="text-[#666]" />
              <p className="text-[12px] text-[#888]">No artifacts or files in this chat yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
