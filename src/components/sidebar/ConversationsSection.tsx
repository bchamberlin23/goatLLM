import { useMemo, useRef, type MouseEvent } from "react";
import { Folder, SquarePen } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Conversation, MessageSearchResult } from "../../stores/chat";
import { RenameInput } from "./RenameInput";
import { TreeItem, formatTimestamp } from "./TreeItem";
import { useContextMenuStore } from "./stores/ui-store";

type Row =
  | { type: "header"; id: string; label: string; count?: number; toggleKey?: string; expanded?: boolean }
  | { type: "conversation"; id: string; conversation: Conversation; index: number }
  | { type: "message"; id: string; result: MessageSearchResult }
  | { type: "empty"; id: string; text: string }
  | { type: "loading"; id: string };

interface ConversationsSectionProps {
  conversations: Conversation[];
  activeId: string | null;
  streamingControllers: Record<string, AbortController>;
  searchQuery: string;
  messageSearchResults: MessageSearchResult[];
  messageSearchLoading: boolean;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onNewChat: () => void;
}

function menuPoint(event: { clientX: number; clientY: number }, width: number, height: number) {
  return {
    x: Math.min(event.clientX, window.innerWidth - width - 8),
    y: Math.min(event.clientY, window.innerHeight - height - 8),
  };
}

function menuFromButton(event: MouseEvent<HTMLElement>, width: number, height: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(rect.left, window.innerWidth - width - 8),
    y: Math.min(rect.bottom + 4, window.innerHeight - height - 8),
  };
}

function sameDay(left: number, right: Date) {
  return new Date(left).toDateString() === right.toDateString();
}

export function ConversationsSection({
  conversations,
  activeId,
  streamingControllers,
  searchQuery,
  messageSearchResults,
  messageSearchLoading,
  onSelectConversation,
  onRenameConversation,
  onNewChat,
}: ConversationsSectionProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const expanded = useContextMenuStore((state) => state.expanded);
  const toggleExpanded = useContextMenuStore((state) => state.toggleExpanded);
  const openConversationMenu = useContextMenuStore((state) => state.openConversationMenu);
  const renaming = useContextMenuStore((state) => state.renaming);
  const updateRenameValue = useContextMenuStore((state) => state.updateRenameValue);
  const cancelRenaming = useContextMenuStore((state) => state.cancelRenaming);

  const rows = useMemo<Row[]>(() => {
    const query = searchQuery.trim();
    if (query) {
      const next: Row[] = [];
      if (conversations.length > 0) {
        next.push({ type: "header", id: "search-conversations", label: "Conversations", count: conversations.length });
        conversations.forEach((conversation, index) => next.push({ type: "conversation", id: conversation.id, conversation, index }));
      }
      next.push({ type: "header", id: "search-messages", label: "Messages", count: messageSearchLoading ? undefined : messageSearchResults.length });
      if (messageSearchLoading) next.push({ type: "loading", id: "message-loading" });
      else if (messageSearchResults.length > 0) {
        messageSearchResults.forEach((result) => next.push({ type: "message", id: result.message_id, result }));
      } else if (conversations.length === 0) {
        next.push({ type: "empty", id: "no-matches", text: `No matches for "${query}"` });
      } else {
        next.push({ type: "empty", id: "no-message-matches", text: "No matching messages." });
      }
      return next;
    }

    const active = conversations.filter((conversation) => !conversation.archived);
    const archived = conversations.filter((conversation) => conversation.archived);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const groups = [
      { label: "Today", items: active.filter((conversation) => sameDay(conversation.createdAt, today)) },
      { label: "Yesterday", items: active.filter((conversation) => sameDay(conversation.createdAt, yesterday)) },
    ];
    const groupedIds = new Set(groups.flatMap((group) => group.items.map((conversation) => conversation.id)));
    groups.push({ label: "Older", items: active.filter((conversation) => !groupedIds.has(conversation.id)) });

    const next: Row[] = [];
    for (const group of groups) {
      if (group.items.length === 0) continue;
      next.push({ type: "header", id: group.label, label: group.label });
      group.items.forEach((conversation, index) => next.push({ type: "conversation", id: conversation.id, conversation, index }));
    }
    if (archived.length > 0) {
      const key = "chat:archived";
      const isOpen = expanded[key] ?? false;
      next.push({ type: "header", id: key, label: `Archived (${archived.length})`, toggleKey: key, expanded: isOpen });
      if (isOpen) archived.forEach((conversation, index) => next.push({ type: "conversation", id: conversation.id, conversation, index }));
    }
    return next;
  }, [conversations, expanded, messageSearchLoading, messageSearchResults, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 8,
    initialRect: { width: 244, height: 640 },
  });
  const measuredRows = rowVirtualizer.getVirtualItems();
  const virtualRows = measuredRows.length > 0
    ? measuredRows
    : rows.slice(0, Math.min(rows.length, 20)).map((_, index) => ({
        index,
        key: rows[index].id,
        size: 32,
        start: index * 32,
        end: (index + 1) * 32,
        lane: 0,
      }));

  const commitRename = () => {
    if (!renaming || renaming.type !== "conversation") return;
    onRenameConversation(renaming.id, renaming.value);
    cancelRenaming();
  };

  const openMenu = (event: MouseEvent<HTMLElement>, conversationId: string, fromButton = false) => {
    event.preventDefault();
    event.stopPropagation();
    openConversationMenu({
      type: "conversation",
      conversationId,
      scope: "chat",
      ...(fromButton ? menuFromButton(event, 200, 220) : menuPoint(event, 200, 220)),
    });
  };

  const renderRow = (row: Row) => {
    if (row.type === "header") {
      return (
        <button
          className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-text-3 transition-colors hover:text-text-1"
          onClick={() => row.toggleKey && toggleExpanded(row.toggleKey)}
        >
          <Folder size={13} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />
          <span className="flex-1 truncate">{row.label}</span>
          {typeof row.count === "number" && <span className="tabular-nums text-[10.5px]">{row.count}</span>}
        </button>
      );
    }

    if (row.type === "conversation") {
      const conversation = row.conversation;
      if (renaming?.type === "conversation" && renaming.id === conversation.id) {
        return (
          <RenameInput
            value={renaming.value}
            onChange={updateRenameValue}
            onCommit={commitRename}
            onCancel={cancelRenaming}
          />
        );
      }
      const shortcut = row.index < 9 ? `⌘${row.index + 1}` : formatTimestamp(conversation.lastMessageAt);
      return (
        <TreeItem
          title={conversation.title}
          active={activeId === conversation.id}
          metadata={shortcut}
          isStreaming={!!streamingControllers[conversation.id]}
          isGeneratingTitle={conversation.isGeneratingTitle}
          menuLabel="Conversation actions"
          onClick={() => onSelectConversation(conversation.id)}
          onContextMenu={(event) => openMenu(event, conversation.id)}
          onMenuClick={(event) => openMenu(event, conversation.id, true)}
        />
      );
    }

    if (row.type === "message") {
      return (
        <button className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left transition-colors hover:bg-white/[0.05]" onClick={() => onSelectConversation(row.result.conversation_id)}>
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#d5d5d5]">{row.result.conversation_title}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-text-4">{row.result.content_preview}</span>
        </button>
      );
    }

    if (row.type === "loading") {
      return (
        <div className="flex h-8 items-center gap-2 px-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-text-3 animate-[dot-pulse_1.5s_ease-in-out_infinite]" />
          <span className="text-[12px] text-text-3">Searching messages...</span>
        </div>
      );
    }

    return <p className="h-8 truncate px-2.5 py-2 text-[11.5px] text-text-3">{row.text}</p>;
  };

  if (rows.length === 0) {
    return (
      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
        <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04]">
            <SquarePen size={15} strokeWidth={1.5} className="text-text-3" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-[12.5px] font-medium text-text-3">No conversations yet</p>
            <p className="text-[11px] leading-relaxed text-text-3">Start a new chat to begin</p>
          </div>
          <button onClick={onNewChat} className="control-pill mt-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors">
            Start chatting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
      <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={row.id}
              className="absolute left-0 top-0 w-full"
              style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderRow(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
