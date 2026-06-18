import { useRef, useEffect, useCallback, useState, useMemo, type UIEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { useChatStore, type Message } from "../stores/chat";
import { MessageBubble } from "./MessageBubble";
import { ChevronDown, Navigation } from "lucide-react";
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
                    index={item.index}
                    onSteer={() => activeId && steerMessage(activeId, item.content, item.index)}
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
          className={`motion-status-in absolute bottom-4 h-9 w-9 rounded-full bg-surface-1/90 border border-hairline-strong text-text-3 flex items-center justify-center shadow-lg hover:bg-surface-2 hover:text-text-1 hover:-translate-y-0.5 transition-all z-10 ${
            edgeScroll ? "left-[430px] -translate-x-1/2" : "left-1/2 -translate-x-1/2"
          }`}
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={16} strokeWidth={2.5} />
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
        <div className="flex-1 h-px bg-white/5" aria-hidden="true" />
        <span
          className="shrink-0 px-2.5 py-0.5 rounded-full bg-white/5 border border-hairline text-[10.5px] font-medium uppercase tracking-wider text-text-3 tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
          title={formatLongDateTime(ts)}
        >
          {formatDateSeparator(ts)}
        </span>
        <div className="flex-1 h-px bg-white/5" aria-hidden="true" />
      </div>
    </div>
  );
}

function QueuedMessageBubble({ content, index, onSteer }: { content: string; index: number; onSteer: () => void }) {
  const position = index + 1;

  return (
    <div className="motion-reveal flex flex-col items-end px-6 py-1.5">
      <div className="soft-card max-w-[85%] sm:max-w-[70%] rounded-2xl rounded-br-md px-4 py-2.5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-text-3">
            Queued follow-up
          </span>
          {index > 0 && (
            <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-text-3 border border-hairline">
              #{position}
            </span>
          )}
        </div>
        <p className="text-[14px] leading-relaxed text-text-1 whitespace-pre-wrap break-words select-text">{content}</p>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onSteer}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-2.5 text-[11.5px] font-semibold text-accent transition-[background,border-color,color] hover:border-accent/35 hover:bg-accent/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            aria-label={`Steer now with queued follow-up ${position}`}
            title="Steer current response with this queued message"
          >
            <Navigation size={11} strokeWidth={2} aria-hidden="true" />
            Steer now
          </button>
        </div>
      </div>
    </div>
  );
}
