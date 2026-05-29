import { useRef, useEffect, useCallback, useState, useMemo, type UIEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { useChatStore, type Message } from "../stores/chat";
import { MessageBubble } from "./MessageBubble";
import { ChevronDown, Send } from "lucide-react";
import { formatDateSeparator, formatLongDateTime, sameDay } from "../lib/datetime";

const EMPTY_MESSAGES: Message[] = [];

function isToday(ts: number): boolean {
  return sameDay(ts, Date.now());
}

type VirtualListItem =
  | {
      kind: "message";
      id: string;
      message: Message;
      showSeparator: boolean;
    }
  | {
      kind: "queued";
      id: string;
      content: string;
      index: number;
    }
  | {
      kind: "footer";
      id: "footer";
    };

export function MessageList({ edgeScroll = false }: { edgeScroll?: boolean }) {
  const activeId = useChatStore((s) => s.activeId);
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);
  const saveScrollPosition = useChatStore((s) => s.saveScrollPosition);
  const messages = useChatStore(
    useShallow((s) => (s.activeId ? s.messages[s.activeId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES)),
  );
  const messageQueue = useChatStore((s) => s.messageQueue);
  const steerMessage = useChatStore((s) => s.steerMessage);
  const queuedMessages = activeId ? (messageQueue[activeId] ?? []) : [];

  const listRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollPosRef = useRef(0);

  // Sticky = "follow the bottom". Toggled off by user scrolling up,
  // re-enabled by user scrolling down to the bottom or pressing the
  // down-arrow button.
  const stickyRef = useRef(true);
  const rafPendingRef = useRef<number | null>(null);
  const activeIdRef = useRef(activeId);
  // Track scroll direction to distinguish user input from auto-scroll.
  const lastScrollTopRef = useRef(0);

  const listItems = useMemo<VirtualListItem[]>(() => {
    const items: VirtualListItem[] = messages.map((message, i) => {
      const prev = i > 0 ? messages[i - 1] : null;
      const isDayChange = !prev || !sameDay(prev.createdAt, message.createdAt);
      const showSeparator = isDayChange && !(prev === null && isToday(message.createdAt));
      return {
        kind: "message",
        id: message.id,
        message,
        showSeparator,
      };
    });

    for (let i = 0; i < queuedMessages.length; i++) {
      items.push({
        kind: "queued",
        id: `queue-${i}`,
        content: queuedMessages[i].content,
        index: i,
      });
    }

    items.push({ kind: "footer", id: "footer" });
    return items;
  }, [messages, queuedMessages]);

  const virtualizer = useVirtualizer({
    count: listItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => {
      const item = listItems[index];
      if (item.kind === "footer") return 16;
      if (item.kind === "queued") return 120;
      return item.showSeparator ? 180 : 140;
    },
    overscan: 4,
    getItemKey: (index) => listItems[index]?.id ?? index,
  });

  const flushScrollPosition = useCallback(
    (conversationId: string | null, position = scrollPosRef.current) => {
      if (!conversationId) return;
      saveScrollPosition(conversationId, position);
    },
    [saveScrollPosition],
  );

  // Kill any queued RAF when component unmounts; flush scroll position once.
  useEffect(() => {
    return () => {
      if (rafPendingRef.current !== null) cancelAnimationFrame(rafPendingRef.current);
      flushScrollPosition(activeIdRef.current);
    };
  }, [flushScrollPosition]);

  const userMsgCount = useMemo(
    () => messages.reduce((n, m) => n + (m.role === "user" ? 1 : 0), 0),
    [messages],
  );

  const lastMessage = messages[messages.length - 1];
  const contentSignal = isStreaming && lastMessage
    ? `${lastMessage.id}:${lastMessage.content.length}:${lastMessage.thinkingContent?.length ?? 0}:${lastMessage.toolCalls?.length ?? 0}`
    : `${messages.length}:${listItems.length}`;

  const doScrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (rafPendingRef.current !== null) return;
    rafPendingRef.current = requestAnimationFrame(() => {
      rafPendingRef.current = null;
      if (!stickyRef.current) return;
      const currentEl = listRef.current;
      if (!currentEl) return;
      const dist = currentEl.scrollHeight - currentEl.scrollTop - currentEl.clientHeight;
      if (dist > 200) return;
      lastScrollTopRef.current = currentEl.scrollTop;
      if (listItems.length > 0) {
        virtualizer.scrollToIndex(listItems.length - 1, { align: "end", behavior: "auto" });
      } else {
        currentEl.scrollTo({ top: currentEl.scrollHeight, behavior: "auto" });
      }
    });
  }, [listItems.length, virtualizer]);

  const scrollToBottom = useCallback(() => {
    stickyRef.current = true;
    if (rafPendingRef.current !== null) {
      cancelAnimationFrame(rafPendingRef.current);
      rafPendingRef.current = null;
    }
    const el = listRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;
    if (listItems.length > 0) {
      virtualizer.scrollToIndex(listItems.length - 1, { align: "end", behavior: "smooth" });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    setShowScrollBtn(false);
  }, [listItems.length, virtualizer]);

  const lastUserCountRef = useRef(userMsgCount);
  useEffect(() => {
    if (userMsgCount > lastUserCountRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      });
    }
    lastUserCountRef.current = userMsgCount;
  }, [userMsgCount, scrollToBottom]);

  const streamStartedRef = useRef(false);
  useEffect(() => {
    if (isStreaming && !streamStartedRef.current) {
      streamStartedRef.current = true;
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
    if (!isStreaming) {
      streamStartedRef.current = false;
    }
  }, [isStreaming, scrollToBottom]);

  useEffect(() => {
    if (!stickyRef.current) return;
    doScrollToBottom();
  }, [contentSignal, doScrollToBottom]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!stickyRef.current) return;
      doScrollToBottom();
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [doScrollToBottom]);

  useEffect(() => {
    const prev = activeIdRef.current;
    if (prev === activeId) return;
    flushScrollPosition(prev);
    activeIdRef.current = activeId;
    lastUserCountRef.current = userMsgCount;
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el || !activeId) return;
      const savedPos = useChatStore.getState().scrollPositions[activeId];
      if (savedPos !== undefined) {
        el.scrollTop = savedPos;
        scrollPosRef.current = savedPos;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        stickyRef.current = distFromBottom < 80;
      } else {
        stickyRef.current = true;
        doScrollToBottom();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const st = el.scrollTop;
    const prev = lastScrollTopRef.current;
    lastScrollTopRef.current = st;
    scrollPosRef.current = st;

    const distFromBottom = el.scrollHeight - st - el.clientHeight;
    const scrollingUp = st < prev;

    if (scrollingUp) {
      stickyRef.current = false;
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
    } else if (distFromBottom < 40 && !scrollingUp && st > prev) {
      stickyRef.current = true;
    }

    setShowScrollBtn(distFromBottom > 80 && el.scrollHeight > el.clientHeight + 200);
  }, []);

  if (messages.length === 0) return null;

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col">
      <div
        ref={listRef}
        className="h-full overflow-y-auto"
        style={{
          overscrollBehavior: "contain",
          scrollbarGutter: "stable",
          transform: "translateZ(0)",
          willChange: "transform",
          overflowAnchor: "none",
          overflowX: "hidden",
        }}
        onScroll={handleScroll}
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
      >
        <div
          className={edgeScroll ? "relative w-full max-w-[860px]" : undefined}
          style={{
            height: virtualizer.getTotalSize() + 28,
            width: edgeScroll ? undefined : "100%",
            paddingTop: 16,
            ...(edgeScroll ? {} : { position: "relative" as const }),
          }}
        >
          {virtualItems.map((virtualRow) => {
            const item = listItems[virtualRow.index];
            if (!item) return null;

            return (
              <div
                key={item.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.kind === "message" && (
                  <>
                    {item.showSeparator && <DateSeparator ts={item.message.createdAt} />}
                    <MessageBubble message={item.message} />
                  </>
                )}
                {item.kind === "queued" && (
                  <QueuedMessageBubble
                    content={item.content}
                    onSteer={() => activeId && steerMessage(activeId, item.content)}
                  />
                )}
                {item.kind === "footer" && <div className="h-3" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
      {showScrollBtn && (
        <button
          className={`absolute bottom-4 h-8 px-3 rounded-full bg-[#2a2a2c] border border-white/10 text-[#b4b4b4] flex items-center gap-1.5 shadow-md hover:bg-white/10 hover:text-[#ececec] hover:-translate-y-0.5 transition-all z-10 animate-[fadeInUp_150ms_ease] ${
            edgeScroll ? "left-[430px] -translate-x-1/2" : "left-1/2 -translate-x-1/2"
          }`}
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={14} strokeWidth={2} />
          {isStreaming && <span className="text-[11px] font-medium">New messages</span>}
        </button>
      )}
    </div>
  );
}

/**
 * Quiet day divider rendered between messages whose calendar dates differ.
 */
function DateSeparator({ ts }: { ts: number }) {
  return (
    <div
      className="flex items-center gap-3 px-6 py-2 select-none"
      role="separator"
      aria-label={formatLongDateTime(ts)}
    >
      <div className="flex items-center gap-3 w-full max-w-[720px] mx-auto">
        <div className="flex-1 h-px bg-white/[0.06]" aria-hidden="true" />
        <span
          className="shrink-0 px-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.05] text-[10.5px] font-medium uppercase tracking-wider text-[#a0a0a0] tabular-nums"
          title={formatLongDateTime(ts)}
        >
          {formatDateSeparator(ts)}
        </span>
        <div className="flex-1 h-px bg-white/[0.06]" aria-hidden="true" />
      </div>
    </div>
  );
}

function QueuedMessageBubble({ content, onSteer }: { content: string; onSteer: () => void }) {
  return (
    <div className="flex flex-col items-end px-6 py-1.5">
      <div className="max-w-[70%] bg-[#f59e42]/5 border border-[#f59e42]/15 rounded-2xl rounded-br-md px-4 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#f59e42]/60">
            Queued
          </span>
        </div>
        <p className="text-[14px] text-[#d5d5d5] whitespace-pre-wrap">{content}</p>
        <button
          onClick={onSteer}
          className="flex items-center gap-1 mt-2 px-2 py-1 rounded-md bg-[#f59e42] text-[#1a1a1c] text-[11px] font-medium hover:bg-[#f0903a] transition-colors"
        >
          <Send size={11} />
          Steer
        </button>
      </div>
    </div>
  );
}
