import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useChatStore, type Conversation } from "../stores/chat";
import type { Notebook } from "../lib/canvas";
import { downloadExport } from "../lib/export";
import {
  SquarePen,
  Search,
  Settings,
  Folder,
  FolderOpen,
  X,
  Plus,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  Pencil,
  ArrowRightLeft,
  Archive,
  FileDown,
  ExternalLink,
  Copy,
  NotebookPen,
  Notebook as NotebookIcon,
} from "lucide-react";

function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

interface ContextMenuState {
  x: number;
  y: number;
  conversationId: string;
}

interface ProjectMenuState {
  x: number;
  y: number;
  workspacePath: string;
}

interface SidebarProps {
  onOpenSettings: () => void;
}

interface WorkspaceCtx {
  workspaces: string[];
  refresh: () => Promise<void>;
}

interface ProjectSidebarProps extends SidebarProps {
  workspaceCtx: WorkspaceCtx;
}

// ── Agent Mode Sidebar (project-based) ──

/**
 * Reads the persisted workspace list from the Tauri backend. Exposes a
 * `refresh` callback so the UI can re-sync after add/remove without
 * reloading the whole window (which used to nuke in-flight chats and the
 * artifact panel).
 *
 * Lifted to the top-level Sidebar so workspaces survive mode switches
 * (Chat ↔ Agent ↔ Design). Without this, every mode change unmounts and
 * remounts AgentSidebar/DesignSidebar, resetting workspaces to [] for one
 * tick, which flashes the "No projects yet" empty state.
 */
function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<string[]>("list_workspaces");
      setWorkspaces(list);
    } catch { /* ignore — likely running outside Tauri */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { workspaces, refresh };
}

/** Design workspaces are kept in localStorage so they never mix with the
 *  Agent-side workspace pool. Same interface shape as useWorkspaces, same
 *  Tauri folder dialog for picking, different storage layer. */
function useDesignWorkspaces() {
  const workspaces = useChatStore((s) => s.designWorkspaces);
  const addDesignWorkspace = useChatStore((s) => s.addDesignWorkspace);
  const removeDesignWorkspace = useChatStore((s) => s.removeDesignWorkspace);
  return { workspaces, addDesignWorkspace, removeDesignWorkspace } as DesignWorkspaceCtx;
}

interface DesignWorkspaceCtx {
  workspaces: string[];
  addDesignWorkspace: (path: string) => void;
  removeDesignWorkspace: (path: string) => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const notebookMode = useChatStore((s) => s.notebookMode);

  // Agent workspaces use the Tauri backend; design workspaces use localStorage
  // so the two modes never cross-contaminate their folders.
  const agentCtx = useWorkspaces();
  const designCtx = useDesignWorkspaces();

  if (notebookMode) return <NotebookSidebar onOpenSettings={onOpenSettings} />;
  if (agentMode) return <AgentSidebar onOpenSettings={onOpenSettings} workspaceCtx={agentCtx} />;
  if (designMode) return <DesignSidebar onOpenSettings={onOpenSettings} designCtx={designCtx} />;
  return <ChatSidebar onOpenSettings={onOpenSettings} />;
}

function AgentSidebar({ onOpenSettings, workspaceCtx }: ProjectSidebarProps) {
  const { workspaces, refresh: refreshWorkspaces } = workspaceCtx;
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);
  const activeId = useChatStore((s) => s.activeId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const setConversationArchived = useChatStore((s) => s.setConversationArchived);
  const moveConversationToWorkspace = useChatStore((s) => s.moveConversationToWorkspace);
  const setWorkspace = useChatStore((s) => s.setWorkspace);
  const workspacePath = useChatStore((s) => s.workspacePath);
  const streamingControllers = useChatStore((s) => s.streamingAbortControllers);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [chatMenu, setChatMenu] = useState<ContextMenuState | null>(null);
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-expand the active workspace so a returning user sees their chats.
  useEffect(() => {
    if (workspacePath) {
      setExpanded((prev) => (prev[workspacePath] ? prev : { ...prev, [workspacePath]: true }));
    }
  }, [workspacePath]);

  // Cmd+F focuses search like the chat sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleExpand = useCallback((ws: string) => {
    setExpanded((prev) => ({ ...prev, [ws]: !prev[ws] }));
  }, []);

  const handleNewChat = useCallback((ws: string) => {
    setWorkspace(ws);
    setActiveConversation(null);
  }, [setWorkspace, setActiveConversation]);

  const handleAddWorkspace = useCallback(async () => {
    setAdding(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const picked = await open({ directory: true, multiple: false, title: "Select project directory" });
      if (picked && typeof picked === "string") {
        await invoke("add_workspace", { path: picked });
        setWorkspace(picked);
        setExpanded((prev) => ({ ...prev, [picked]: true }));
        await refreshWorkspaces();
      }
    } catch { /* user cancelled or no permission */ }
    finally { setAdding(false); }
  }, [setWorkspace, refreshWorkspaces]);

  const handleRemoveWorkspace = useCallback(async (ws: string) => {
    const projectChats = conversations.filter((c) => c.mode === "agent" && c.workspacePath === ws);
    if (projectChats.length > 0) {
      const ok = window.confirm(
        `Remove "${ws.split("/").pop()}" from your projects?\n\n${projectChats.length} chat${projectChats.length === 1 ? "" : "s"} will move to "Personal" — they won't be deleted.`,
      );
      if (!ok) return;
      // Detach the chats so they don't disappear from the sidebar.
      for (const c of projectChats) moveConversationToWorkspace(c.id, null);
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("remove_workspace", { path: ws });
      if (workspacePath === ws) setWorkspace(null);
      await refreshWorkspaces();
    } catch (e) {
      console.warn("[AgentSidebar] remove_workspace failed:", e);
    }
    setProjectMenu(null);
  }, [conversations, moveConversationToWorkspace, refreshWorkspaces, setWorkspace, workspacePath]);

  const handleRevealWorkspace = useCallback(async (ws: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Best-effort reveal via shell. Falls back to copying the path.
      await invoke("plugin:shell|open", { path: ws });
    } catch {
      try { await navigator.clipboard.writeText(ws); } catch { /* */ }
    }
    setProjectMenu(null);
  }, []);

  const handleCopyPath = useCallback(async (ws: string) => {
    try { await navigator.clipboard.writeText(ws); } catch { /* */ }
    setProjectMenu(null);
  }, []);

  const trimmedQuery = searchInput.trim().toLowerCase();
  const hasQuery = trimmedQuery.length > 0;

  const matchesQuery = useCallback(
    (c: Conversation) => {
      if (!hasQuery) return true;
      if (c.title.toLowerCase().includes(trimmedQuery)) return true;
      if (c.lastMessagePreview?.toLowerCase().includes(trimmedQuery)) return true;
      return false;
    },
    [hasQuery, trimmedQuery],
  );

  const projectChatsByWs = useMemo(() => {
    const map: Record<string, Conversation[]> = {};
    for (const c of conversations) {
      if (!c.workspacePath) continue;
      if (c.mode !== "agent") continue;
      if (!matchesQuery(c)) continue;
      (map[c.workspacePath] ||= []).push(c);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    }
    return map;
  }, [conversations, matchesQuery]);

  // When the user is searching, auto-expand any project that has a hit so
  // matches aren't hidden behind a collapsed header.
  useEffect(() => {
    if (!hasQuery) return;
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const ws of Object.keys(projectChatsByWs)) {
        if (!next[ws]) { next[ws] = true; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [hasQuery, projectChatsByWs]);

  const totalChatsByWs = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of conversations) {
      if (c.mode === "agent" && c.workspacePath) map[c.workspacePath] = (map[c.workspacePath] ?? 0) + 1;
    }
    return map;
  }, [conversations]);

  const lastActivityByWs = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of conversations) {
      if (!c.workspacePath) continue;
      if (c.mode !== "agent") continue;
      if ((map[c.workspacePath] ?? 0) < c.lastMessageAt) map[c.workspacePath] = c.lastMessageAt;
    }
    return map;
  }, [conversations]);

  const handleChatContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const W = 220, H = 260;
    const x = Math.min(e.clientX, window.innerWidth - W - 8);
    const y = Math.min(e.clientY, window.innerHeight - H - 8);
    setChatMenu({ x, y, conversationId: id });
    setProjectMenu(null);
    setMoveMenuFor(null);
  }, []);

  const handleChatMenuClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 220, H = 260;
    const x = Math.min(rect.left, window.innerWidth - W - 8);
    const y = Math.min(rect.bottom + 4, window.innerHeight - H - 8);
    setChatMenu({ x, y, conversationId: id });
    setProjectMenu(null);
    setMoveMenuFor(null);
  }, []);

  const handleProjectContextMenu = useCallback((e: React.MouseEvent, ws: string) => {
    e.preventDefault();
    e.stopPropagation();
    const W = 220, H = 200;
    const x = Math.min(e.clientX, window.innerWidth - W - 8);
    const y = Math.min(e.clientY, window.innerHeight - H - 8);
    setProjectMenu({ x, y, workspacePath: ws });
    setChatMenu(null);
  }, []);

  const handleProjectMenuClick = useCallback((e: React.MouseEvent, ws: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 220, H = 200;
    const x = Math.min(rect.left, window.innerWidth - W - 8);
    const y = Math.min(rect.bottom + 4, window.innerHeight - H - 8);
    setProjectMenu({ x, y, workspacePath: ws });
    setChatMenu(null);
  }, []);

  const handleRenameStart = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    setRenaming({ id, value: conv.title });
    setChatMenu(null);
    setTimeout(() => renameRef.current?.select(), 0);
  }, [conversations]);

  const handleRenameCommit = useCallback(() => {
    if (!renaming) return;
    renameConversation(renaming.id, renaming.value);
    setRenaming(null);
  }, [renaming, renameConversation]);

  const handleExport = useCallback((id: string, format: "markdown" | "json") => {
    const conv = conversations.find((c) => c.id === id);
    const msgs = messages[id] ?? [];
    if (conv) downloadExport(conv, msgs, format);
    setChatMenu(null);
  }, [conversations, messages]);

  const handleDelete = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id);
    const ok = window.confirm(`Delete "${conv?.title ?? "this chat"}"? This can't be undone.`);
    if (!ok) return;
    deleteConversation(id);
    setChatMenu(null);
  }, [conversations, deleteConversation]);

  const closeMenus = useCallback(() => {
    setChatMenu(null);
    setProjectMenu(null);
    setMoveMenuFor(null);
  }, []);

  const renderChat = useCallback(
    (conv: Conversation, ws: string) => {
      const isActive = activeId === conv.id;
      const isStreaming = !!streamingControllers[conv.id];

      if (renaming?.id === conv.id) {
        return (
          <div key={conv.id} className="px-2 py-1">
            <input
              ref={renameRef}
              className="w-full bg-[#1f1f1f] border border-white/10 rounded-md text-[12px] text-[#ececec] px-2 py-1 outline-none"
              value={renaming.value}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onBlur={handleRenameCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameCommit();
                if (e.key === "Escape") setRenaming(null);
              }}
              autoFocus
            />
          </div>
        );
      }

      return (
        <div
          key={conv.id}
          className={`sidebar-action group/chat flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] cursor-pointer transition-all ${
            isActive
              ? "sidebar-action-active"
              : "text-[#b4b4b4] hover:text-[#ececec]"
          }`}
          onClick={() => { setWorkspace(ws); setActiveConversation(conv.id); }}
          onContextMenu={(e) => handleChatContextMenu(e, conv.id)}
        >
          {isStreaming && (
            <span className="shrink-0" aria-label="Generating">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="sidebar-theme-accent" />
              </svg>
            </span>
          )}
          <span className="truncate flex-1">
            {conv.isGeneratingTitle && conv.title === "New Conversation" ? (
              <span className="inline-block h-[10px] w-[80px] rounded-[3px] bg-white/[0.05] relative overflow-hidden">
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[title-shimmer_1.4s_ease-in-out_infinite]" />
              </span>
            ) : conv.title}
          </span>
          <span className="text-[10px] text-[#666] shrink-0 group-hover/chat:hidden tabular-nums">
            {formatTimestamp(conv.lastMessageAt)}
          </span>
          <button
            className="control-icon hidden group-hover/chat:flex w-5 h-5 items-center justify-center rounded"
            onClick={(e) => handleChatMenuClick(e, conv.id)}
            aria-label="Chat actions"
            title="More"
          >
            <MoreHorizontal size={12} strokeWidth={2} />
          </button>
        </div>
      );
    },
    [activeId, streamingControllers, renaming, handleRenameCommit, setWorkspace, setActiveConversation, handleChatContextMenu, handleChatMenuClick],
  );

  const totalProjectMatches = useMemo(
    () => Object.values(projectChatsByWs).reduce((acc, list) => acc + list.length, 0),
    [projectChatsByWs],
  );

  return (
    <>
      <aside
        className="sidebar-surface w-[244px] h-full flex flex-col relative shrink-0"
      >
        <div className="h-[46px] shrink-0" data-tauri-drag-region />

        {/* New chat — mirrors the chat-mode sidebar. Creates a new chat in
            whatever project is currently active so the user doesn't have to
            scroll down to find a per-project “+” button. */}
        <div className="flex flex-col gap-[1px] px-2">
          <button
            onClick={() => {
              if (workspacePath) {
                handleNewChat(workspacePath);
              } else {
                // No active project — just open the empty new-chat state.
                // The next message will land under “Personal” unless they
                // pick a project first.
                setActiveConversation(null);
              }
            }}
            className="sidebar-action group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[#ececec] transition-all"
            aria-label={workspacePath ? `New chat in ${workspacePath.split("/").pop()}` : "New chat"}
            title={workspacePath ? `New chat in ${workspacePath.split("/").pop()}` : "New chat"}
          >
            <SquarePen size={15} strokeWidth={1.75} className="text-[#c9c9c9] group-hover:text-[#ececec] transition-colors" aria-hidden="true" />
            <span className="text-[13px] flex-1 text-left">New chat</span>
            <span className="text-[10.5px] text-[#9a9a9a] font-medium tracking-wide">⌘N</span>
          </button>
        </div>

        {/* Search — same placement as chat mode (right under the New chat
            button) for consistency. */}
        <div className="px-2 mt-2">
          <div
            className="sidebar-search flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150"
          >
            <Search
              size={13}
              strokeWidth={1.75}
              className={`shrink-0 transition-colors ${searchFocused || hasQuery ? "text-[#ececec]" : "text-[#9a9a9a]"}`}
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="text"
              role="searchbox"
              aria-label="Search project chats"
              className="flex-1 bg-transparent text-[13px] text-[#ececec] placeholder:text-[#9a9a9a] outline-none border-0 min-w-0"
              placeholder="Search conversations…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (searchInput) setSearchInput("");
                  else searchRef.current?.blur();
                }
              }}
            />
            {hasQuery ? (
              <button
                className="control-icon p-0.5 rounded transition-colors"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
              >
                <X size={12} strokeWidth={2} />
              </button>
            ) : (
              <span className="text-[10px] text-[#a0a0a0] font-medium tracking-wide tabular-nums">⌘F</span>
            )}
          </div>
        </div>

        {/* Projects header */}
        <div className="flex items-center justify-between px-4 mt-3 pb-1">
          <span className="text-[10.5px] font-semibold text-[#8e8e8e] uppercase tracking-wider">Projects</span>
          <button
            onClick={handleAddWorkspace}
            disabled={adding}
            className="control-icon w-5 h-5 flex items-center justify-center rounded-md disabled:opacity-50 transition-colors"
            aria-label="Add project"
            title="Add project"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        </div>

        {/* Project list */}
        <div className="flex flex-col flex-1 overflow-y-auto px-2 min-h-0">
          {workspaces.length === 0 && !hasQuery && (
            <div className="flex flex-col items-center gap-3 py-10 px-3 text-center">
              <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center">
                <Folder size={15} strokeWidth={1.5} className="text-[#9a9a9a]" />
              </div>
              <p className="text-[12px] text-[#a0a0a0]">No projects yet</p>
              <button
                onClick={handleAddWorkspace}
                className="control-pill px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
              >
                Add a project
              </button>
            </div>
          )}

          {hasQuery && totalProjectMatches === 0 && (
            <p className="text-[11.5px] text-[#9a9a9a] px-2.5 py-3 leading-relaxed">
              No chats match <span className="text-[#ececec]">"{searchInput.trim()}"</span>
            </p>
          )}

          {workspaces.map((ws) => {
            const name = ws.split("/").pop() || ws;
            const isExpanded = expanded[ws] ?? false;
            const chats = projectChatsByWs[ws] ?? [];
            const total = totalChatsByWs[ws] ?? 0;
            const lastTs = lastActivityByWs[ws];
            const isActiveProject = workspacePath === ws;

            // While searching, hide projects with zero hits to keep focus.
            if (hasQuery && chats.length === 0) return null;

            return (
              <div key={ws} className="flex flex-col mb-1">
                {/* Project header */}
                <div
                  className={`group/proj flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-md cursor-pointer transition-colors ${
                    isActiveProject ? "sidebar-action-active" : "sidebar-action hover:text-[#ececec]"
                  }`}
                  onClick={() => setWorkspace(ws)}
                  onContextMenu={(e) => handleProjectContextMenu(e, ws)}
                  title={ws}
                >
                  <button
                    type="button"
                    className="control-icon -ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors"
                    onClick={(e) => { e.stopPropagation(); toggleExpand(ws); }}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`}
                    aria-expanded={isExpanded}
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronDown
                      size={11}
                      strokeWidth={2}
                      className={`text-[#888] transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                      aria-hidden="true"
                    />
                  </button>
                  {isExpanded ? (
                    <FolderOpen size={14} strokeWidth={1.5} className={`shrink-0 ${isActiveProject ? "sidebar-theme-accent" : "text-[#888]"}`} aria-hidden="true" />
                  ) : (
                    <Folder size={14} strokeWidth={1.5} className={`shrink-0 ${isActiveProject ? "sidebar-theme-accent" : "text-[#888]"}`} aria-hidden="true" />
                  )}
                  <span className={`text-[13px] truncate flex-1 ${isActiveProject ? "text-[#ececec] font-medium" : "text-[#d5d5d5]"}`}>
                    {name}
                  </span>
                  {total > 0 && (
                    <span
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[#888] font-mono tabular-nums group-hover/proj:hidden"
                      title={`${total} chat${total === 1 ? "" : "s"}${lastTs ? ` · last ${formatTimestamp(lastTs)}` : ""}`}
                    >
                      {total}
                    </span>
                  )}
                  <div className="hidden group-hover/proj:flex items-center gap-0.5 shrink-0">
                    <button
                      className="control-icon w-5 h-5 flex items-center justify-center rounded transition-colors"
                      onClick={(e) => { e.stopPropagation(); handleNewChat(ws); }}
                      aria-label={`New chat in ${name}`}
                      title="New chat"
                    >
                      <SquarePen size={12} strokeWidth={1.75} />
                    </button>
                    <button
                      className="control-icon w-5 h-5 flex items-center justify-center rounded transition-colors"
                      onClick={(e) => handleProjectMenuClick(e, ws)}
                      aria-label={`Project actions for ${name}`}
                      title="More"
                    >
                      <MoreHorizontal size={12} strokeWidth={2} />
                    </button>
                  </div>
                </div>

                {/* Chats under this project */}
                {isExpanded && (
                  <div className="flex flex-col ml-3 mt-0.5 border-l border-white/[0.04] pl-2">
                    {chats.length === 0 ? (
                      <button
                        className="sidebar-action flex items-center gap-2 px-2 py-1.5 text-[12px] text-[#a0a0a0] hover:text-[#ececec] rounded-md transition-colors"
                        onClick={() => handleNewChat(ws)}
                      >
                        <SquarePen size={11} strokeWidth={1.75} />
                        New chat
                      </button>
                    ) : (
                      chats.map((c) => renderChat(c, ws))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom settings */}
        <div className="px-2 pb-3 pt-2 border-t border-white/[0.04] mt-1">
          <button
            onClick={onOpenSettings}
            className="sidebar-action group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md w-full text-[#ececec] transition-all"
            aria-label="Open settings"
          >
            <Settings size={15} strokeWidth={1.75} className="text-[#c9c9c9] group-hover:text-[#ececec] group-hover:rotate-45 transition-all duration-300" />
            <span className="text-[13px]">Settings</span>
          </button>
        </div>
      </aside>

      {/* ── Context menus ── */}
      {(chatMenu || projectMenu) && (
        <div
          className="fixed inset-0 z-[100]"
          onClick={closeMenus}
          onContextMenu={(e) => { e.preventDefault(); closeMenus(); }}
        />
      )}

      {chatMenu && (() => {
        const conv = conversations.find((c) => c.id === chatMenu.conversationId);
        const currentWs = conv?.workspacePath ?? null;
        const moveOpen = moveMenuFor === chatMenu.conversationId;
        return (
          <div
            className="popover-surface fixed z-[101] min-w-[200px] rounded-xl p-1.5 animate-[contextMenuIn_110ms_ease]"
            style={{ left: chatMenu.x, top: chatMenu.y }}
          >
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleRenameStart(chatMenu.conversationId)}
            >
              <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
              Rename
            </button>

            {/* Move to project */}
            <div className="relative">
              <button
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
                onClick={() => setMoveMenuFor(moveOpen ? null : chatMenu.conversationId)}
              >
                <ArrowRightLeft size={13} strokeWidth={1.75} aria-hidden="true" />
                <span className="flex-1 text-left">Move to project…</span>
                <ChevronDown
                  size={11}
                  strokeWidth={2}
                  className={`text-[#888] transition-transform ${moveOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {moveOpen && (
                <div className="ml-3 mr-1 mb-1 mt-0.5 border-l border-white/5 pl-1.5 flex flex-col">
                  <button
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                      currentWs === null
                        ? "text-[#ececec] bg-white/[0.06]"
                        : "text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec]"
                    }`}
                    onClick={() => {
                      moveConversationToWorkspace(chatMenu.conversationId, null);
                      setChatMenu(null);
                      setMoveMenuFor(null);
                    }}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-white/[0.06] inline-flex items-center justify-center shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#888]" />
                    </span>
                    Personal (no project)
                  </button>
                  {workspaces.length === 0 && (
                    <p className="px-2.5 py-1.5 text-[11px] text-[#888]">No projects yet.</p>
                  )}
                  {workspaces.map((ws) => {
                    const isCurrent = currentWs === ws;
                    return (
                      <button
                        key={ws}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                          isCurrent
                            ? "text-[#ececec] bg-white/[0.06]"
                            : "text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec]"
                        }`}
                        onClick={() => {
                          moveConversationToWorkspace(chatMenu.conversationId, ws);
                          setWorkspace(ws);
                          setExpanded((prev) => ({ ...prev, [ws]: true }));
                          setChatMenu(null);
                          setMoveMenuFor(null);
                        }}
                      >
                        <Folder size={11} strokeWidth={1.75} className="shrink-0 text-[#888]" />
                        <span className="truncate">{ws.split("/").pop() || ws}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleExport(chatMenu.conversationId, "markdown")}
            >
              <FileDown size={13} strokeWidth={1.75} aria-hidden="true" />
              Export as Markdown
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleExport(chatMenu.conversationId, "json")}
            >
              <FileDown size={13} strokeWidth={1.75} aria-hidden="true" />
              Export as JSON
            </button>
            <div className="h-px bg-white/5 mx-1 my-1" />
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => {
                const conv = conversations.find((c) => c.id === chatMenu.conversationId);
                if (conv) setConversationArchived(chatMenu.conversationId, !conv.archived);
                setChatMenu(null);
              }}
            >
              <Archive size={13} strokeWidth={1.75} aria-hidden="true" />
              {conversations.find((c) => c.id === chatMenu.conversationId)?.archived ? "Unarchive" : "Archive"}
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-red-500/10 hover:text-[#f87171] transition-colors"
              onClick={() => handleDelete(chatMenu.conversationId)}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Delete chat
            </button>
          </div>
        );
      })()}

      {projectMenu && (() => {
        const ws = projectMenu.workspacePath;
        const total = totalChatsByWs[ws] ?? 0;
        return (
          <div
            className="popover-surface fixed z-[101] min-w-[210px] rounded-xl p-1.5 animate-[contextMenuIn_110ms_ease]"
            style={{ left: projectMenu.x, top: projectMenu.y }}
          >
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => { handleNewChat(ws); setProjectMenu(null); }}
            >
              <SquarePen size={13} strokeWidth={1.75} aria-hidden="true" />
              New chat here
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleRevealWorkspace(ws)}
            >
              <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
              Reveal in Finder
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleCopyPath(ws)}
            >
              <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
              Copy path
            </button>
            <div className="h-px bg-white/5 mx-1 my-1" />
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-red-500/10 hover:text-[#f87171] transition-colors"
              onClick={() => handleRemoveWorkspace(ws)}
              title={total > 0 ? "Chats will move to Personal" : undefined}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Remove project
              {total > 0 && (
                <span className="ml-auto text-[10px] text-[#888]">{total} chat{total === 1 ? "" : "s"}</span>
              )}
            </button>
          </div>
        );
      })()}
    </>
  );
}

function DesignSidebar({ onOpenSettings, designCtx }: SidebarProps & { designCtx: DesignWorkspaceCtx }) {
  const { workspaces, addDesignWorkspace, removeDesignWorkspace } = designCtx;
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);
  const activeId = useChatStore((s) => s.activeId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const setConversationArchived = useChatStore((s) => s.setConversationArchived);
  const moveConversationToWorkspace = useChatStore((s) => s.moveConversationToWorkspace);
  const setDesignWorkspace = useChatStore((s) => s.setDesignWorkspace);
  const designWorkspacePath = useChatStore((s) => s.designWorkspacePath);
  const streamingControllers = useChatStore((s) => s.streamingAbortControllers);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [chatMenu, setChatMenu] = useState<ContextMenuState | null>(null);
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-expand the active workspace so a returning user sees their designs.
  useEffect(() => {
    if (designWorkspacePath) {
      setExpanded((prev) => (prev[designWorkspacePath] ? prev : { ...prev, [designWorkspacePath]: true }));
    }
  }, [designWorkspacePath]);

  // Cmd+F focuses search like the chat sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleExpand = useCallback((ws: string) => {
    setExpanded((prev) => ({ ...prev, [ws]: !prev[ws] }));
  }, []);

  const handleNewChat = useCallback((ws: string) => {
    setDesignWorkspace(ws);
    setActiveConversation(null);
  }, [setDesignWorkspace, setActiveConversation]);

  const handleAddWorkspace = useCallback(async () => {
    setAdding(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, title: "Select design directory" });
      if (picked && typeof picked === "string") {
        addDesignWorkspace(picked);
        setDesignWorkspace(picked);
        setExpanded((prev) => ({ ...prev, [picked]: true }));
        // Move the active conversation into the new folder.
        const cid = useChatStore.getState().activeId;
        if (cid) useChatStore.getState().moveConversationToWorkspace(cid, picked);
      }
    } catch { /* user cancelled */ }
    finally { setAdding(false); }
  }, [addDesignWorkspace, setDesignWorkspace]);

  const handleRemoveWorkspace = useCallback(async (ws: string) => {
    const designChats = conversations.filter((c) => c.workspacePath === ws && c.mode === "design");
    if (designChats.length > 0) {
      const ok = window.confirm(
        `Remove "${ws.split("/").pop()}" from your designs?\n\n${designChats.length} design${designChats.length === 1 ? "" : "s"} will move to Personal — they won't be deleted.`,
      );
      if (!ok) return;
      for (const c of designChats) moveConversationToWorkspace(c.id, null);
    }
    removeDesignWorkspace(ws);
    setProjectMenu(null);
  }, [conversations, moveConversationToWorkspace, removeDesignWorkspace]);

  const handleRevealWorkspace = useCallback(async (ws: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Best-effort reveal via shell. Falls back to copying the path.
      await invoke("plugin:shell|open", { path: ws });
    } catch {
      try { await navigator.clipboard.writeText(ws); } catch { /* */ }
    }
    setProjectMenu(null);
  }, []);

  const handleCopyPath = useCallback(async (ws: string) => {
    try { await navigator.clipboard.writeText(ws); } catch { /* */ }
    setProjectMenu(null);
  }, []);

  const trimmedQuery = searchInput.trim().toLowerCase();
  const hasQuery = trimmedQuery.length > 0;

  const matchesQuery = useCallback(
    (c: Conversation) => {
      if (!hasQuery) return true;
      if (c.title.toLowerCase().includes(trimmedQuery)) return true;
      if (c.lastMessagePreview?.toLowerCase().includes(trimmedQuery)) return true;
      return false;
    },
    [hasQuery, trimmedQuery],
  );

  const projectChatsByWs = useMemo(() => {
    const map: Record<string, Conversation[]> = {};
    for (const c of conversations) {
      if (!c.workspacePath) continue;
      if (c.mode !== "design") continue;
      if (!matchesQuery(c)) continue;
      (map[c.workspacePath] ||= []).push(c);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    }
    return map;
  }, [conversations, matchesQuery]);

  // When the user is searching, auto-expand any project that has a hit so
  // matches aren't hidden behind a collapsed header.
  useEffect(() => {
    if (!hasQuery) return;
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const ws of Object.keys(projectChatsByWs)) {
        if (!next[ws]) { next[ws] = true; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [hasQuery, projectChatsByWs]);

  const totalChatsByWs = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of conversations) {
      if (c.workspacePath) map[c.workspacePath] = (map[c.workspacePath] ?? 0) + 1;
    }
    return map;
  }, [conversations]);

  const lastActivityByWs = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of conversations) {
      if (!c.workspacePath) continue;
      if ((map[c.workspacePath] ?? 0) < c.lastMessageAt) map[c.workspacePath] = c.lastMessageAt;
    }
    return map;
  }, [conversations]);

  const handleChatContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const W = 220, H = 260;
    const x = Math.min(e.clientX, window.innerWidth - W - 8);
    const y = Math.min(e.clientY, window.innerHeight - H - 8);
    setChatMenu({ x, y, conversationId: id });
    setProjectMenu(null);
    setMoveMenuFor(null);
  }, []);

  const handleChatMenuClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 220, H = 260;
    const x = Math.min(rect.left, window.innerWidth - W - 8);
    const y = Math.min(rect.bottom + 4, window.innerHeight - H - 8);
    setChatMenu({ x, y, conversationId: id });
    setProjectMenu(null);
    setMoveMenuFor(null);
  }, []);

  const handleProjectContextMenu = useCallback((e: React.MouseEvent, ws: string) => {
    e.preventDefault();
    e.stopPropagation();
    const W = 220, H = 200;
    const x = Math.min(e.clientX, window.innerWidth - W - 8);
    const y = Math.min(e.clientY, window.innerHeight - H - 8);
    setProjectMenu({ x, y, workspacePath: ws });
    setChatMenu(null);
  }, []);

  const handleProjectMenuClick = useCallback((e: React.MouseEvent, ws: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 220, H = 200;
    const x = Math.min(rect.left, window.innerWidth - W - 8);
    const y = Math.min(rect.bottom + 4, window.innerHeight - H - 8);
    setProjectMenu({ x, y, workspacePath: ws });
    setChatMenu(null);
  }, []);

  const handleRenameStart = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    setRenaming({ id, value: conv.title });
    setChatMenu(null);
    setTimeout(() => renameRef.current?.select(), 0);
  }, [conversations]);

  const handleRenameCommit = useCallback(() => {
    if (!renaming) return;
    renameConversation(renaming.id, renaming.value);
    setRenaming(null);
  }, [renaming, renameConversation]);

  const handleExport = useCallback((id: string, format: "markdown" | "json") => {
    const conv = conversations.find((c) => c.id === id);
    const msgs = messages[id] ?? [];
    if (conv) downloadExport(conv, msgs, format);
    setChatMenu(null);
  }, [conversations, messages]);

  const handleDelete = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id);
    const ok = window.confirm(`Delete "${conv?.title ?? "this chat"}"? This can't be undone.`);
    if (!ok) return;
    deleteConversation(id);
    setChatMenu(null);
  }, [conversations, deleteConversation]);

  const closeMenus = useCallback(() => {
    setChatMenu(null);
    setProjectMenu(null);
    setMoveMenuFor(null);
  }, []);

  const renderChat = useCallback(
    (conv: Conversation, ws: string) => {
      const isActive = activeId === conv.id;
      const isStreaming = !!streamingControllers[conv.id];

      if (renaming?.id === conv.id) {
        return (
          <div key={conv.id} className="px-2 py-1">
            <input
              ref={renameRef}
              className="w-full bg-[#1f1f1f] border border-white/10 rounded-md text-[12px] text-[#ececec] px-2 py-1 outline-none"
              value={renaming.value}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onBlur={handleRenameCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameCommit();
                if (e.key === "Escape") setRenaming(null);
              }}
              autoFocus
            />
          </div>
        );
      }

      return (
        <div
          key={conv.id}
          className={`sidebar-action group/chat flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] cursor-pointer transition-all ${
            isActive
              ? "sidebar-action-active"
              : "text-[#b4b4b4] hover:text-[#ececec]"
          }`}
          onClick={() => { setDesignWorkspace(ws); setActiveConversation(conv.id); }}
          onContextMenu={(e) => handleChatContextMenu(e, conv.id)}
        >
          {isStreaming && (
            <span className="shrink-0" aria-label="Generating">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="sidebar-theme-accent" />
              </svg>
            </span>
          )}
          <span className="truncate flex-1">
            {conv.isGeneratingTitle && conv.title === "New Conversation" ? (
              <span className="inline-block h-[10px] w-[80px] rounded-[3px] bg-white/[0.05] relative overflow-hidden">
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[title-shimmer_1.4s_ease-in-out_infinite]" />
              </span>
            ) : conv.title}
          </span>
          <span className="text-[10px] text-[#666] shrink-0 group-hover/chat:hidden tabular-nums">
            {formatTimestamp(conv.lastMessageAt)}
          </span>
          <button
            className="control-icon hidden group-hover/chat:flex w-5 h-5 items-center justify-center rounded transition-colors"
            onClick={(e) => handleChatMenuClick(e, conv.id)}
            aria-label="Chat actions"
            title="More"
          >
            <MoreHorizontal size={12} strokeWidth={2} />
          </button>
        </div>
      );
    },
    [activeId, streamingControllers, renaming, handleRenameCommit, setDesignWorkspace, setActiveConversation, handleChatContextMenu, handleChatMenuClick],
  );

  const totalProjectMatches = useMemo(
    () => Object.values(projectChatsByWs).reduce((acc, list) => acc + list.length, 0),
    [projectChatsByWs],
  );

  return (
    <>
      <aside
        className="sidebar-surface w-[244px] h-full flex flex-col relative shrink-0"
      >
        <div className="h-[46px] shrink-0" data-tauri-drag-region />

        {/* New design — mirrors the chat-mode sidebar. Creates a new design in
            whatever project is currently active so the user doesn't have to
            scroll down to find a per-project “+” button. */}
        <div className="flex flex-col gap-[1px] px-2">
          <button
            onClick={() => {
              if (designWorkspacePath) {
                handleNewChat(designWorkspacePath);
              } else {
                // No active project — just open the empty new-chat state.
                // The next message will land under “Personal” unless they
                // pick a project first.
                setActiveConversation(null);
              }
            }}
            className="sidebar-action group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[#ececec] transition-all"
            aria-label={designWorkspacePath ? `New design in ${designWorkspacePath.split("/").pop()}` : "New design"}
            title={designWorkspacePath ? `New design in ${designWorkspacePath.split("/").pop()}` : "New design"}
          >
            <SquarePen size={15} strokeWidth={1.75} className="text-[#c9c9c9] group-hover:text-[#ececec] transition-colors" aria-hidden="true" />
            <span className="text-[13px] flex-1 text-left">New design</span>
            <span className="text-[10.5px] text-[#9a9a9a] font-medium tracking-wide">⌘N</span>
          </button>
        </div>

        {/* Search — same placement as chat mode (right under the New design
            button) for consistency. */}
        <div className="px-2 mt-2">
          <div
            className="sidebar-search flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150"
          >
            <Search
              size={13}
              strokeWidth={1.75}
              className={`shrink-0 transition-colors ${searchFocused || hasQuery ? "text-[#ececec]" : "text-[#9a9a9a]"}`}
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="text"
              role="searchbox"
              aria-label="Search designs"
              className="flex-1 bg-transparent text-[13px] text-[#ececec] placeholder:text-[#9a9a9a] outline-none border-0 min-w-0"
              placeholder="Search conversations…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (searchInput) setSearchInput("");
                  else searchRef.current?.blur();
                }
              }}
            />
            {hasQuery ? (
              <button
                className="control-icon p-0.5 rounded transition-colors"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
              >
                <X size={12} strokeWidth={2} />
              </button>
            ) : (
              <span className="text-[10px] text-[#a0a0a0] font-medium tracking-wide tabular-nums">⌘F</span>
            )}
          </div>
        </div>

        {/* Designs header */}
        <div className="flex items-center justify-between px-4 mt-3 pb-1">
          <span className="text-[10.5px] font-semibold text-[#8e8e8e] uppercase tracking-wider">Designs</span>
          <button
            onClick={handleAddWorkspace}
            disabled={adding}
            className="control-icon w-5 h-5 flex items-center justify-center rounded-md disabled:opacity-50 transition-colors"
            aria-label="Add design workspace"
            title="Add design workspace"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        </div>

        {/* Project list */}
        <div className="flex flex-col flex-1 overflow-y-auto px-2 min-h-0">
          {workspaces.length === 0 && !hasQuery && (
            <div className="flex flex-col items-center gap-3 py-10 px-3 text-center">
              <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center">
                <Folder size={15} strokeWidth={1.5} className="text-[#9a9a9a]" />
              </div>
              <p className="text-[12px] text-[#a0a0a0]">No design folders yet</p>
              <button
                onClick={handleAddWorkspace}
                className="control-pill px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
              >
                Add a design folder
              </button>
            </div>
          )}

          {hasQuery && totalProjectMatches === 0 && (
            <p className="text-[11.5px] text-[#9a9a9a] px-2.5 py-3 leading-relaxed">
              No designs match <span className="text-[#ececec]">"{searchInput.trim()}"</span>
            </p>
          )}

          {workspaces.map((ws) => {
            const name = ws.split("/").pop() || ws;
            const isExpanded = expanded[ws] ?? false;
            const designs = projectChatsByWs[ws] ?? [];
            const total = totalChatsByWs[ws] ?? 0;
            const lastTs = lastActivityByWs[ws];
            const isActiveProject = designWorkspacePath === ws;

            // While searching, hide projects with zero hits to keep focus.
            if (hasQuery && designs.length === 0) return null;

            return (
              <div key={ws} className="flex flex-col mb-1">
                {/* Project header */}
                <div
                  className={`group/proj flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-md cursor-pointer transition-colors ${
                    isActiveProject ? "sidebar-action-active" : "sidebar-action hover:text-[#ececec]"
                  }`}
                  onClick={() => { setDesignWorkspace(ws); const cid = useChatStore.getState().activeId; if (cid) useChatStore.getState().moveConversationToWorkspace(cid, ws); }}
                  onContextMenu={(e) => handleProjectContextMenu(e, ws)}
                  title={ws}
                >
                  <button
                    type="button"
                    className="control-icon -ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors"
                    onClick={(e) => { e.stopPropagation(); toggleExpand(ws); }}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`}
                    aria-expanded={isExpanded}
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronDown
                      size={11}
                      strokeWidth={2}
                      className={`text-[#888] transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                      aria-hidden="true"
                    />
                  </button>
                  {isExpanded ? (
                    <FolderOpen size={14} strokeWidth={1.5} className={`shrink-0 ${isActiveProject ? "sidebar-theme-accent" : "text-[#888]"}`} aria-hidden="true" />
                  ) : (
                    <Folder size={14} strokeWidth={1.5} className={`shrink-0 ${isActiveProject ? "sidebar-theme-accent" : "text-[#888]"}`} aria-hidden="true" />
                  )}
                  <span className={`text-[13px] truncate flex-1 ${isActiveProject ? "text-[#ececec] font-medium" : "text-[#d5d5d5]"}`}>
                    {name}
                  </span>
                  {total > 0 && (
                    <span
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[#888] font-mono tabular-nums group-hover/proj:hidden"
                      title={`${total} design${total === 1 ? "" : "s"}${lastTs ? ` · last ${formatTimestamp(lastTs)}` : ""}`}
                    >
                      {total}
                    </span>
                  )}
                  <div className="hidden group-hover/proj:flex items-center gap-0.5 shrink-0">
                    <button
                      className="control-icon w-5 h-5 flex items-center justify-center rounded transition-colors"
                      onClick={(e) => { e.stopPropagation(); handleNewChat(ws); }}
                      aria-label={`New design in ${name}`}
                      title="New design"
                    >
                      <SquarePen size={12} strokeWidth={1.75} />
                    </button>
                    <button
                      className="control-icon w-5 h-5 flex items-center justify-center rounded transition-colors"
                      onClick={(e) => handleProjectMenuClick(e, ws)}
                      aria-label={`Project actions for ${name}`}
                      title="More"
                    >
                      <MoreHorizontal size={12} strokeWidth={2} />
                    </button>
                  </div>
                </div>

                {/* Designs under this project */}
                {isExpanded && (
                  <div className="flex flex-col ml-3 mt-0.5 border-l border-white/[0.04] pl-2">
                    {designs.length === 0 ? (
                      <button
                        className="sidebar-action flex items-center gap-2 px-2 py-1.5 text-[12px] text-[#a0a0a0] hover:text-[#ececec] rounded-md transition-colors"
                        onClick={() => handleNewChat(ws)}
                      >
                        <SquarePen size={11} strokeWidth={1.75} />
                        New design
                      </button>
                    ) : (
                      designs.map((c) => renderChat(c, ws))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom settings */}
        <div className="px-2 pb-3 pt-2 border-t border-white/[0.04] mt-1">
          <button
            onClick={onOpenSettings}
            className="sidebar-action group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md w-full text-[#ececec] transition-all"
            aria-label="Open settings"
          >
            <Settings size={15} strokeWidth={1.75} className="text-[#c9c9c9] group-hover:text-[#ececec] group-hover:rotate-45 transition-all duration-300" />
            <span className="text-[13px]">Settings</span>
          </button>
        </div>
      </aside>

      {/* ── Context menus ── */}
      {(chatMenu || projectMenu) && (
        <div
          className="fixed inset-0 z-[100]"
          onClick={closeMenus}
          onContextMenu={(e) => { e.preventDefault(); closeMenus(); }}
        />
      )}

      {chatMenu && (() => {
        const conv = conversations.find((c) => c.id === chatMenu.conversationId);
        const currentWs = conv?.workspacePath ?? null;
        const moveOpen = moveMenuFor === chatMenu.conversationId;
        return (
          <div
            className="popover-surface fixed z-[101] min-w-[200px] rounded-xl p-1.5 animate-[contextMenuIn_110ms_ease]"
            style={{ left: chatMenu.x, top: chatMenu.y }}
          >
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleRenameStart(chatMenu.conversationId)}
            >
              <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
              Rename
            </button>

            {/* Move to project */}
            <div className="relative">
              <button
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
                onClick={() => setMoveMenuFor(moveOpen ? null : chatMenu.conversationId)}
              >
                <ArrowRightLeft size={13} strokeWidth={1.75} aria-hidden="true" />
                <span className="flex-1 text-left">Move to design folder…</span>
                <ChevronDown
                  size={11}
                  strokeWidth={2}
                  className={`text-[#888] transition-transform ${moveOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {moveOpen && (
                <div className="ml-3 mr-1 mb-1 mt-0.5 border-l border-white/5 pl-1.5 flex flex-col">
                  <button
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                      currentWs === null
                        ? "text-[#ececec] bg-white/[0.06]"
                        : "text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec]"
                    }`}
                    onClick={() => {
                      moveConversationToWorkspace(chatMenu.conversationId, null);
                      setChatMenu(null);
                      setMoveMenuFor(null);
                    }}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-white/[0.06] inline-flex items-center justify-center shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#888]" />
                    </span>
                    Personal (no design folder)
                  </button>
                  {workspaces.length === 0 && (
                    <p className="px-2.5 py-1.5 text-[11px] text-[#888]">No design folders yet.</p>
                  )}
                  {workspaces.map((ws) => {
                    const isCurrent = currentWs === ws;
                    return (
                      <button
                        key={ws}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors ${
                          isCurrent
                            ? "text-[#ececec] bg-white/[0.06]"
                            : "text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec]"
                        }`}
                        onClick={() => {
                          moveConversationToWorkspace(chatMenu.conversationId, ws);
                          setDesignWorkspace(ws);
                          setExpanded((prev) => ({ ...prev, [ws]: true }));
                          setChatMenu(null);
                          setMoveMenuFor(null);
                        }}
                      >
                        <Folder size={11} strokeWidth={1.75} className="shrink-0 text-[#888]" />
                        <span className="truncate">{ws.split("/").pop() || ws}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleExport(chatMenu.conversationId, "markdown")}
            >
              <FileDown size={13} strokeWidth={1.75} aria-hidden="true" />
              Export as Markdown
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleExport(chatMenu.conversationId, "json")}
            >
              <FileDown size={13} strokeWidth={1.75} aria-hidden="true" />
              Export as JSON
            </button>
            <div className="h-px bg-white/5 mx-1 my-1" />
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => {
                const conv = conversations.find((c) => c.id === chatMenu.conversationId);
                if (conv) setConversationArchived(chatMenu.conversationId, !conv.archived);
                setChatMenu(null);
              }}
            >
              <Archive size={13} strokeWidth={1.75} aria-hidden="true" />
              {conversations.find((c) => c.id === chatMenu.conversationId)?.archived ? "Unarchive" : "Archive"}
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-red-500/10 hover:text-[#f87171] transition-colors"
              onClick={() => handleDelete(chatMenu.conversationId)}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Delete chat
            </button>
          </div>
        );
      })()}

      {projectMenu && (() => {
        const ws = projectMenu.workspacePath;
        const total = totalChatsByWs[ws] ?? 0;
        return (
          <div
            className="popover-surface fixed z-[101] min-w-[210px] rounded-xl p-1.5 animate-[contextMenuIn_110ms_ease]"
            style={{ left: projectMenu.x, top: projectMenu.y }}
          >
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => { handleNewChat(ws); setProjectMenu(null); }}
            >
              <SquarePen size={13} strokeWidth={1.75} aria-hidden="true" />
              New design here
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleRevealWorkspace(ws)}
            >
              <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
              Reveal in Finder
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleCopyPath(ws)}
            >
              <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
              Copy path
            </button>
            <div className="h-px bg-white/5 mx-1 my-1" />
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-red-500/10 hover:text-[#f87171] transition-colors"
              onClick={() => handleRemoveWorkspace(ws)}
              title={total > 0 ? "Designs will move to Personal" : undefined}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Remove project
              {total > 0 && (
                <span className="ml-auto text-[10px] text-[#888]">{total} chat{total === 1 ? "" : "s"}</span>
              )}
            </button>
          </div>
        );
      })()}
    </>
  );
}


// ── Chat Mode Sidebar ──

interface NotebookMenuState {
  x: number;
  y: number;
  notebookId: string;
}

function NotebookSidebar({ onOpenSettings }: SidebarProps) {
  const notebooks = useChatStore((s) => s.notebooks);
  const activeNotebookId = useChatStore((s) => s.activeNotebookId);
  const createNotebook = useChatStore((s) => s.createNotebook);
  const renameNotebook = useChatStore((s) => s.renameNotebook);
  const deleteNotebook = useChatStore((s) => s.deleteNotebook);
  const setActiveNotebook = useChatStore((s) => s.setActiveNotebook);

  const [contextMenu, setContextMenu] = useState<NotebookMenuState | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Most-recently-updated first so the notebook you're working in floats up.
  const sorted = useMemo(
    () => [...notebooks].sort((a, b) => b.updatedAt - a.updatedAt),
    [notebooks],
  );

  const handleNew = useCallback(() => {
    createNotebook();
  }, [createNotebook]);

  // ⌘N creates a notebook in this mode (mirrors New chat in ChatSidebar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createNotebook();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNotebook]);

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const menuW = 180;
    const menuH = 100;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setContextMenu({ x, y, notebookId: id });
  }, []);

  const handleMenuClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const menuW = 180;
    const menuH = 100;
    const x = Math.min(rect.left, window.innerWidth - menuW - 8);
    const y = Math.min(rect.bottom + 4, window.innerHeight - menuH - 8);
    setContextMenu({ x, y, notebookId: id });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleRenameStart = useCallback(
    (id: string) => {
      const nb = notebooks.find((n) => n.id === id);
      if (!nb) return;
      setRenaming({ id, value: nb.name });
      setContextMenu(null);
      setTimeout(() => renameInputRef.current?.select(), 0);
    },
    [notebooks],
  );

  const handleRenameCommit = useCallback(() => {
    if (!renaming) return;
    renameNotebook(renaming.id, renaming.value);
    setRenaming(null);
  }, [renaming, renameNotebook]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleRenameCommit();
      if (e.key === "Escape") setRenaming(null);
    },
    [handleRenameCommit],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteNotebook(id);
      setContextMenu(null);
    },
    [deleteNotebook],
  );

  const renderNotebookItem = (nb: Notebook) => {
    if (renaming?.id === nb.id) {
      return (
        <div key={nb.id} className="px-2 py-1">
          <input
            ref={renameInputRef}
            className="w-full bg-[#1f1f1f] border border-white/10 rounded-md text-[13px] text-[#ececec] px-2 py-1.5 outline-none"
            value={renaming.value}
            onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
            onBlur={handleRenameCommit}
            onKeyDown={handleRenameKeyDown}
            autoFocus
          />
        </div>
      );
    }

    const isActive = activeNotebookId === nb.id;
    const panelCount = nb.panels.length;

    return (
      <div
        key={nb.id}
        role="button"
        tabIndex={0}
        className={`sidebar-action group relative flex items-center justify-between w-full pl-6 pr-2 py-1.5 rounded-md text-[13px] transition-all duration-150 text-left cursor-pointer ${
          isActive ? "sidebar-action-active" : "text-[#d5d5d5] hover:text-[#ececec]"
        }`}
        onClick={() => setActiveNotebook(nb.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setActiveNotebook(nb.id);
          }
        }}
        onContextMenu={(e) => handleContextMenu(e, nb.id)}
      >
        {isActive && (
          <span
            aria-hidden
            className="sidebar-active-marker absolute left-2 top-1/2 -translate-y-1/2 h-3 w-[2px] rounded-full"
          />
        )}
        <span className="truncate flex-1">{nb.name}</span>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <span className="text-[11px] text-[#a0a0a0] group-hover:hidden tabular-nums">
            {panelCount === 0 ? formatTimestamp(nb.updatedAt) : `${panelCount} panel${panelCount === 1 ? "" : "s"}`}
          </span>
          <button
            className="control-icon hidden group-hover:flex p-1 rounded transition-colors"
            onClick={(e) => handleMenuClick(e, nb.id)}
            aria-label="Notebook actions"
          >
            <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <aside className="sidebar-surface w-[244px] h-full flex flex-col relative shrink-0">
        {/* Native macOS traffic lights overlay this top area */}
        <div className="h-[46px] shrink-0" data-tauri-drag-region />

        {/* New notebook */}
        <div className="flex flex-col gap-[1px] px-2">
          <button
            onClick={handleNew}
            className="sidebar-action group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[#ececec] transition-all"
            aria-label="New notebook"
          >
            <NotebookPen size={15} strokeWidth={1.75} className="text-[#c9c9c9] group-hover:text-[#ececec] transition-colors" aria-hidden="true" />
            <span className="text-[13px] flex-1 text-left">New notebook</span>
            <span className="text-[10.5px] text-[#9a9a9a] font-medium tracking-wide">⌘N</span>
          </button>
        </div>

        {/* Notebook list */}
        <div className="flex flex-col mt-3 px-2 overflow-y-auto flex-1 min-h-0">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 px-3 text-center">
              <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center">
                <NotebookIcon size={15} strokeWidth={1.5} className="text-[#9a9a9a]" />
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-[12.5px] text-[#a8a8a8] font-medium">No notebooks yet</p>
                <p className="text-[11px] text-[#a0a0a0] leading-relaxed">
                  Create one to start a board
                </p>
              </div>
              <button
                onClick={handleNew}
                className="control-pill mt-1 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
              >
                Create notebook
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="px-2.5 py-1">
                <span className="text-[10.5px] uppercase tracking-wider text-[#8e8e8e] font-semibold">Notebooks</span>
              </div>
              {sorted.map((nb) => renderNotebookItem(nb))}
            </div>
          )}
        </div>

        {/* Bottom settings */}
        <div className="px-2 pb-3 pt-2 border-t border-white/[0.04] mt-1">
          <button
            onClick={onOpenSettings}
            className="sidebar-action group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md w-full text-[#ececec] transition-all"
            aria-label="Open settings"
          >
            <Settings size={15} strokeWidth={1.75} className="text-[#c9c9c9] group-hover:text-[#ececec] group-hover:rotate-45 transition-all duration-300" aria-hidden="true" />
            <span className="text-[13px]">Settings</span>
          </button>
        </div>
      </aside>

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[100]"
            onClick={closeContextMenu}
            onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
          />
          <div
            className="popover-surface fixed z-[101] min-w-[160px] rounded-xl p-1.5 animate-[contextMenuIn_110ms_ease]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleRenameStart(contextMenu.notebookId)}
            >
              <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
              Rename
            </button>
            <div className="h-px bg-white/5 mx-1 my-1" />
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-red-500/10 hover:text-[#f87171] transition-colors"
              onClick={() => handleDelete(contextMenu.notebookId)}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Delete
            </button>
          </div>
        </>
      )}
    </>
  );
}

function ChatSidebar({ onOpenSettings }: SidebarProps) {
  const activeId = useChatStore((s) => s.activeId);
  const messages = useChatStore((s) => s.messages);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const allConversations = useChatStore((s) => s.conversations);
  // Hide conversations tagged for agent workspaces or design mode — those
  // live in AgentSidebar / DesignSidebar respectively.
  const conversations = allConversations.filter(
    (c) => !c.workspacePath && c.mode !== "design",
  );
  const searchQuery = useChatStore((s) => s.searchQuery);
  const streamingControllers = useChatStore((s) => s.streamingAbortControllers);


  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const messageSearchResults = useChatStore((s) => s.messageSearchResults);
  const messageSearchLoading = useChatStore((s) => s.messageSearchLoading);
  const performMessageSearch = useChatStore((s) => s.performMessageSearch);
  const clearMessageSearch = useChatStore((s) => s.clearMessageSearch);
  const setSearchQuery = useChatStore((s) => s.setSearchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);
  // Use the store's content-aware filter so substring matches across message
  // bodies score conversations alongside title/preview matches. Falls back to
  // simple title/preview filter if conversations.length differs (chat-mode
  // sidebar excludes workspace-tagged conversations from `conversations`).
  const conversationIds = useChatStore((s) => s.conversations.map((c) => c.id).join("|"));
  const allFiltered = useMemo(
    () => useChatStore.getState().getFilteredConversations(),
    [searchQuery, conversationIds],
  );
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const ids = new Set(conversations.map((c) => c.id));
    return allFiltered.filter((c) => ids.has(c.id));
  }, [allFiltered, conversations, searchQuery]);
  const trimmedQuery = searchInput.trim();
  const hasQuery = trimmedQuery.length > 0;

  const cmdKey = "⌘";

  // Live search: drives both conversation filter and message search.
  useEffect(() => {
    setSearchQuery(searchInput);
    const timer = setTimeout(() => {
      if (searchInput.trim()) {
        performMessageSearch(searchInput);
      } else {
        clearMessageSearch();
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchInput, setSearchQuery, performMessageSearch, clearMessageSearch]);

  // Cmd+F focuses the search bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleNewChat = useCallback(() => {
    // Just navigate to the empty "new chat" state. A real conversation is
    // created on first message send.
    setActiveConversation(null);
  }, [setActiveConversation]);

  const handleClearSearch = useCallback(() => {
    setSearchInput("");
    setSearchQuery("");
    clearMessageSearch();
    searchInputRef.current?.focus();
  }, [setSearchQuery, clearMessageSearch]);

  // Group conversations by date buckets for folder view. Archived
  // conversations live in their own collapsible section at the bottom so
  // long-tail chats don't crowd the sidebar.
  const activeFiltered = filteredConversations.filter((c) => !c.archived);
  const archivedFiltered = filteredConversations.filter((c) => c.archived);
  const today = activeFiltered.filter((c) => {
    const d = new Date(c.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const yesterday = activeFiltered.filter((c) => {
    const d = new Date(c.createdAt);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return d.toDateString() === y.toDateString();
  });
  const older = activeFiltered.filter(
    (c) => !today.includes(c) && !yesterday.includes(c)
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const menuW = 200;
    const menuH = 220;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setContextMenu({ x, y, conversationId: id });
  }, []);

  const handleMenuClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const menuW = 200;
    const menuH = 220;
    const x = Math.min(rect.left, window.innerWidth - menuW - 8);
    const y = Math.min(rect.bottom + 4, window.innerHeight - menuH - 8);
    setContextMenu({ x, y, conversationId: id });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleRenameStart = useCallback(
    (id: string) => {
      const conv = filteredConversations.find((c) => c.id === id);
      if (!conv) return;
      setRenaming({ id, value: conv.title });
      setContextMenu(null);
      setTimeout(() => renameInputRef.current?.select(), 0);
    },
    [filteredConversations]
  );

  const handleRenameCommit = useCallback(() => {
    if (!renaming) return;
    renameConversation(renaming.id, renaming.value);
    setRenaming(null);
  }, [renaming, renameConversation]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleRenameCommit();
      if (e.key === "Escape") setRenaming(null);
    },
    [handleRenameCommit]
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteConversation(id);
      setContextMenu(null);
    },
    [deleteConversation]
  );

  const handleExport = useCallback(
    (id: string, format: "markdown" | "json") => {
      const conv = filteredConversations.find((c) => c.id === id);
      const msgs = messages[id] ?? [];
      if (conv) downloadExport(conv, msgs, format);
      setContextMenu(null);
    },
    [filteredConversations, messages]
  );

  const renderConvItem = (conv: (typeof filteredConversations)[0], index: number) => {
    if (renaming?.id === conv.id) {
      return (
        <div key={conv.id} className="px-2 py-1">
          <input
            ref={renameInputRef}
            className="w-full bg-[#1f1f1f] border border-white/10 rounded-md text-[13px] text-[#ececec] px-2 py-1.5 outline-none"
            value={renaming.value}
            onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
            onBlur={handleRenameCommit}
            onKeyDown={handleRenameKeyDown}
            autoFocus
          />
        </div>
      );
    }

    const shortcut = index < 9 ? `⌘${index + 1}` : null;
    const isActive = activeId === conv.id;
    const isStreaming = !!streamingControllers[conv.id];

    return (
      <div
        key={conv.id}
        role="button"
        tabIndex={0}
        className={`sidebar-action group relative flex items-center justify-between w-full pl-6 pr-2 py-1 rounded-md text-[13px] transition-all duration-150 text-left cursor-pointer ${
          isActive
            ? "sidebar-action-active"
            : "text-[#d5d5d5] hover:text-[#ececec]"
        }`}
        onClick={() => setActiveConversation(conv.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setActiveConversation(conv.id);
          }
        }}
        onContextMenu={(e) => handleContextMenu(e, conv.id)}
      >
        {isActive && (
          <span
            aria-hidden
            className="sidebar-active-marker absolute left-2 top-1/2 -translate-y-1/2 h-3 w-[2px] rounded-full"
          />
        )}
        <span className="truncate flex-1">
          {conv.isGeneratingTitle && conv.title === "New Conversation" ? (
            <span
              aria-label="Generating title"
              className="inline-flex items-center gap-1.5 text-[#9a9a9a]"
            >
              <span className="relative inline-block h-[10px] w-[110px] overflow-hidden rounded-[3px] bg-white/[0.05]">
                <span
                  aria-hidden
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[title-shimmer_1.4s_ease-in-out_infinite]"
                />
              </span>
            </span>
          ) : (
            conv.title
          )}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {isStreaming && (
            <span
              className="shrink-0 inline-flex"
              aria-label="Generating"
              title="Generating response"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="animate-spin"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
                <path
                  d="M21 12a9 9 0 0 0-9-9"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="sidebar-theme-accent"
                />
              </svg>
            </span>
          )}
          {!isStreaming && (
            <span className="text-[11px] text-[#a0a0a0] group-hover:hidden">
              {shortcut ?? formatTimestamp(conv.lastMessageAt)}
            </span>
          )}
          <button
            className="control-icon hidden group-hover:flex p-1 rounded transition-colors"
            onClick={(e) => handleMenuClick(e, conv.id)}
            aria-label="Conversation actions"
          >
            <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  };

  const renderFolder = (name: string, items: typeof filteredConversations) => {
    if (items.length === 0) return null;
    return (
      <div key={name} className="flex flex-col mb-2">
        <div className="flex items-center gap-2 px-2.5 py-1 text-[12px] text-[#a8a8a8]">
          <Folder size={13} strokeWidth={1.75} className="text-[#a8a8a8]" />
          <span>{name}</span>
        </div>
        <div className="flex flex-col">
          {items.map((c, i) => renderConvItem(c, i))}
        </div>
      </div>
    );
  };

  return (
    <>
      <aside
        className="sidebar-surface w-[244px] h-full flex flex-col relative shrink-0"
      >
        {/* Native macOS traffic lights overlay this top area */}
        <div
          className="h-[46px] shrink-0"
          data-tauri-drag-region
        />

        {/* New chat */}
        <div className="flex flex-col gap-[1px] px-2">
          <button
            onClick={handleNewChat}
            className="sidebar-action group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[#ececec] transition-all"
            aria-label="New chat"
          >
            <SquarePen size={15} strokeWidth={1.75} className="text-[#c9c9c9] group-hover:text-[#ececec] transition-colors" aria-hidden="true" />
            <span className="text-[13px] flex-1 text-left">New chat</span>
            <span className="text-[10.5px] text-[#9a9a9a] font-medium tracking-wide">{cmdKey}N</span>
          </button>
        </div>

        {/* Live search bar */}
        <div className="px-2 mt-2">
          <div
            className="sidebar-search flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-150"
          >
            <Search size={13} strokeWidth={1.75} className={`shrink-0 transition-colors ${searchFocused || hasQuery ? "text-[#ececec]" : "text-[#9a9a9a]"}`} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              role="searchbox"
              aria-label="Search conversations and messages"
              className="flex-1 bg-transparent text-[13px] text-[#ececec] placeholder:text-[#9a9a9a] outline-none border-0 min-w-0"
              placeholder="Search conversations…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (searchInput) {
                    handleClearSearch();
                  } else {
                    searchInputRef.current?.blur();
                  }
                }
              }}
            />
            {hasQuery ? (
              <button
                className="control-icon p-0.5 rounded transition-colors"
                onClick={handleClearSearch}
                aria-label="Clear search"
                title="Clear"
              >
                <X size={12} strokeWidth={2} />
              </button>
            ) : (
              <span className="text-[10px] text-[#a0a0a0] font-medium tracking-wide tabular-nums">{cmdKey}F</span>
            )}
          </div>
        </div>

        {/* Conversations + inline message results */}
        <div className="flex flex-col mt-3 px-2 overflow-y-auto flex-1 min-h-0">
          {hasQuery ? (
            <>
              {/* Conversation matches */}
              {filteredConversations.length > 0 && (
                <div className="flex flex-col mb-2">
                  <div className="flex items-center justify-between px-2.5 py-1">
                    <span className="text-[10.5px] uppercase tracking-wider text-[#8e8e8e] font-semibold">Conversations</span>
                    <span className="text-[10.5px] text-[#a0a0a0]">{filteredConversations.length}</span>
                  </div>
                  <div className="flex flex-col">
                    {filteredConversations.map((c, i) => renderConvItem(c, i))}
                  </div>
                </div>
              )}

              {/* Message matches */}
              <div className="flex flex-col mb-2">
                <div className="flex items-center justify-between px-2.5 py-1">
                  <span className="text-[10.5px] uppercase tracking-wider text-[#8e8e8e] font-semibold">Messages</span>
                  {!messageSearchLoading && messageSearchResults.length > 0 && (
                    <span className="text-[10.5px] text-[#a0a0a0]">{messageSearchResults.length}</span>
                  )}
                </div>
                {messageSearchLoading ? (
                  <div className="flex items-center gap-2 px-2.5 py-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#9a9a9a] animate-[dot-pulse_1.5s_ease-in-out_infinite]" />
                    <span className="text-[12px] text-[#9a9a9a]">Searching messages…</span>
                  </div>
                ) : messageSearchResults.length > 0 ? (
                  <div className="flex flex-col">
                    {messageSearchResults.map((r) => (
                      <button
                        key={r.message_id}
                        className="flex flex-col gap-0.5 w-full px-2.5 py-2 text-left hover:bg-white/[0.05] rounded-md transition-colors"
                        onClick={() => setActiveConversation(r.conversation_id)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-medium text-[#d5d5d5] truncate">
                            {r.conversation_title}
                          </span>
                          <span className="text-[10px] text-[#a0a0a0] shrink-0">
                            {r.role === "user" ? "You" : r.role === "assistant" ? "Assistant" : r.role}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#888888] line-clamp-2 leading-snug">
                          {r.content_preview}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : filteredConversations.length === 0 ? (
                  <p className="text-[11.5px] text-[#9a9a9a] px-2.5 py-3 leading-relaxed">
                    No matches for <span className="text-[#ececec]">"{trimmedQuery}"</span>
                  </p>
                ) : (
                  <p className="text-[11.5px] text-[#9a9a9a] px-2.5 py-2 leading-relaxed">
                    No matching messages.
                  </p>
                )}
              </div>
            </>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 px-3 text-center">
              <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center">
                <SquarePen size={15} strokeWidth={1.5} className="text-[#9a9a9a]" />
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-[12.5px] text-[#a8a8a8] font-medium">
                  No conversations yet
                </p>
                <p className="text-[11px] text-[#a0a0a0] leading-relaxed">
                  Start a new chat to begin
                </p>
              </div>
              <button
                onClick={handleNewChat}
                className="control-pill mt-1 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
              >
                Start chatting
              </button>
            </div>
          ) : (
            <>
              {renderFolder("Today", today)}
              {renderFolder("Yesterday", yesterday)}
              {renderFolder("Older", older)}
              {archivedFiltered.length > 0 && (
                <details className="mt-2">
                  <summary className="px-2.5 py-1 text-[10.5px] uppercase tracking-wider text-[#7a7a7a] cursor-pointer hover:text-[#a0a0a0] select-none">
                    Archived ({archivedFiltered.length})
                  </summary>
                  <div className="mt-1">
                    {renderFolder("", archivedFiltered)}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        {/* Bottom settings */}
        <div className="px-2 pb-3 pt-2 border-t border-white/[0.04] mt-1">
          <button
            onClick={onOpenSettings}
            className="sidebar-action group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md w-full text-[#ececec] transition-all"
            aria-label="Open settings"
          >
            <Settings size={15} strokeWidth={1.75} className="text-[#c9c9c9] group-hover:text-[#ececec] group-hover:rotate-45 transition-all duration-300" aria-hidden="true" />
            <span className="text-[13px]">Settings</span>
          </button>
        </div>
      </aside>

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[100]"
            onClick={closeContextMenu}
            onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
          />
          <div
            className="popover-surface fixed z-[101] min-w-[180px] rounded-xl p-1.5 animate-[contextMenuIn_110ms_ease]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleRenameStart(contextMenu.conversationId)}
            >
              <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
              Rename
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleExport(contextMenu.conversationId, "markdown")}
            >
              <FileDown size={13} strokeWidth={1.75} aria-hidden="true" />
              Export as Markdown
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleExport(contextMenu.conversationId, "json")}
            >
              <FileDown size={13} strokeWidth={1.75} aria-hidden="true" />
              Export as JSON
            </button>
            <div className="h-px bg-white/5 mx-1 my-1" />
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-red-500/10 hover:text-[#f87171] transition-colors"
              onClick={() => handleDelete(contextMenu.conversationId)}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Delete
            </button>
          </div>
        </>
      )}
    </>
  );
}
