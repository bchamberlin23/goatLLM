import { useState, useRef, useCallback, useEffect } from "react";
import { useChatStore } from "../stores/chat";
import { downloadExport } from "../lib/export";
import {
  SquarePen,
  Search,
  Settings,
  Folder,
  X,
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

interface SidebarProps {
  onOpenSettings: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const activeId = useChatStore((s) => s.activeId);
  const messages = useChatStore((s) => s.messages);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const getFilteredConversations = useChatStore((s) => s.getFilteredConversations);
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
  const filteredConversations = getFilteredConversations();
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

  // Group conversations by date buckets for folder view
  const today = filteredConversations.filter((c) => {
    const d = new Date(c.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const yesterday = filteredConversations.filter((c) => {
    const d = new Date(c.createdAt);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return d.toDateString() === y.toDateString();
  });
  const older = filteredConversations.filter(
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
        className={`group relative flex items-center justify-between w-full pl-6 pr-2 py-1 rounded-md text-[13px] transition-all duration-150 text-left cursor-pointer ${
          isActive
            ? "bg-white/[0.09] text-white"
            : "text-[#d5d5d5] hover:bg-white/[0.05] hover:text-[#ececec]"
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
            className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-[2px] rounded-full bg-[#f59e42]"
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
                  stroke="#f59e42"
                  strokeWidth="3"
                  strokeLinecap="round"
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
            className="hidden group-hover:flex p-1 rounded hover:bg-white/10 text-[#888888] hover:text-[#ececec]"
            onClick={(e) => handleMenuClick(e, conv.id)}
            aria-label="Conversation actions"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="8" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="13" cy="8" r="1.4" />
            </svg>
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
        className="w-[244px] h-full flex flex-col relative shrink-0 border-r border-black/40"
        style={{
          background:
            "linear-gradient(180deg, #2f2f31 0%, #2b2b2d 38%, #28282a 100%)",
          boxShadow: "inset -1px 0 0 rgba(255,255,255,0.03)",
        }}
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
            className="group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[#ececec] hover:bg-white/[0.06] active:bg-white/[0.09] transition-colors"
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
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all duration-150 ${
              searchFocused
                ? "bg-white/[0.07] border-white/10 shadow-[0_0_0_3px_rgba(245,158,66,0.08)]"
                : "bg-white/[0.04] border-white/5 hover:bg-white/[0.06]"
            }`}
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
                className="text-[#9a9a9a] hover:text-[#ececec] p-0.5 transition-colors"
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
                className="mt-1 px-3 py-1.5 rounded-md bg-white/[0.06] text-[#ececec] text-[12.5px] font-medium hover:bg-white/[0.1] transition-colors border border-white/[0.04]"
              >
                Start chatting
              </button>
            </div>
          ) : (
            <>
              {renderFolder("Today", today)}
              {renderFolder("Yesterday", yesterday)}
              {renderFolder("Older", older)}
            </>
          )}
        </div>

        {/* Bottom settings */}
        <div className="px-2 pb-3 pt-2 border-t border-white/[0.04] mt-1">
          <button
            onClick={onOpenSettings}
            className="group flex items-center gap-2.5 px-2.5 py-[7px] rounded-md w-full hover:bg-white/[0.06] active:bg-white/[0.09] text-[#ececec] transition-colors"
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
            className="fixed z-[101] min-w-[180px] bg-[#2a2a2c] border border-white/10 rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.55)] p-1.5 animate-[contextMenuIn_110ms_ease]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleRenameStart(contextMenu.conversationId)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M11 2L14 5L5 14H2V11L11 2z" />
              </svg>
              Rename
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleExport(contextMenu.conversationId, "markdown")}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 11v3H2v-3" /><path d="M5 5l3-3 3 3" /><path d="M8 2v10" />
              </svg>
              Export as Markdown
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
              onClick={() => handleExport(contextMenu.conversationId, "json")}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 11v3H2v-3" /><path d="M5 5l3-3 3 3" /><path d="M8 2v10" />
              </svg>
              Export as JSON
            </button>
            <div className="h-px bg-white/5 mx-1 my-1" />
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] text-[#b4b4b4] hover:bg-red-500/10 hover:text-[#f87171] transition-colors"
              onClick={() => handleDelete(contextMenu.conversationId)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 4 4 4 14 4" /><path d="M5 4V2h6v2" /><path d="M5 7v6M8 7v6M11 7v6" /><path d="M3 4l1 10h8l1-10" />
              </svg>
              Delete
            </button>
          </div>
        </>
      )}
    </>
  );
}
