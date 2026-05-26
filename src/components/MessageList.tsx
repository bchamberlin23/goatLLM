import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useChatStore } from "../stores/chat";
import { MessageBubble } from "./MessageBubble";
import { ChevronDown, Send } from "lucide-react";
import { formatDateSeparator, formatLongDateTime, sameDay } from "../lib/datetime";

function isToday(ts: number): boolean {
  return sameDay(ts, Date.now());
}

export function MessageList() {
  const activeId = useChatStore((s) => s.activeId);
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);
  const saveScrollPosition = useChatStore((s) => s.saveScrollPosition);
  const scrollPositions = useChatStore((s) => s.scrollPositions);
  const msgMap = useChatStore((s) => s.messages);
  const messages = activeId ? (msgMap[activeId] ?? []) : [];
  const messageQueue = useChatStore((s) => s.messageQueue);
  const steerMessage = useChatStore((s) => s.steerMessage);
  const queuedMessages = activeId ? (messageQueue[activeId] ?? []) : [];

  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Sticky = "follow the bottom". Toggled off by user scrolling up,
  // re-enabled by sending a message or pressing the down-arrow button.
  const stickyRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const rafPendingRef = useRef<number | null>(null);
  const activeIdRef = useRef(activeId);

  // Kill any queued RAF when component unmounts.
  useEffect(() => () => {
    if (rafPendingRef.current) cancelAnimationFrame(rafPendingRef.current);
  }, []);

  // Count of user messages and total content length — primitive deps that grow
  // monotonically as the conversation evolves.
  const userMsgCount = useMemo(
    () => messages.reduce((n, m) => n + (m.role === "user" ? 1 : 0), 0),
    [messages],
  );
  const contentSignal = useMemo(() => {
    let n = messages.length * 4096;
    for (const m of messages) {
      n += m.content.length;
      if (m.toolCalls) n += m.toolCalls.length;
    }
    return n;
  }, [messages]);

  // Smooth, coalesced scroll-to-bottom. Uses a single rAF guard so multiple
  // triggers inside one frame only schedule one scroll. During active streaming
  // we use `behavior: "auto"` for instant tracking; manual clicks use smooth.
  const doScrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // Coalesce: if a scroll is already scheduled for this frame, bail —
    // the pending rAF will pick up the latest scrollHeight.
    if (rafPendingRef.current !== null) return;
    rafPendingRef.current = requestAnimationFrame(() => {
      rafPendingRef.current = null;
      if (!stickyRef.current) return;
      const currentEl = listRef.current;
      if (!currentEl) return;
      // Bail if the user scrolled up since this rAF was queued —
      // guard with ground-truth scroll position, not just the flag.
      const dist = currentEl.scrollHeight - currentEl.scrollTop - currentEl.clientHeight;
      if (dist > 160) return;
      programmaticScrollRef.current = true;
      currentEl.scrollTo({ top: currentEl.scrollHeight, behavior: "auto" });
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    });
  }, []);

  // ── Send: when the user message count grows, that's a fresh send. Pin. ──
  const lastUserCountRef = useRef(userMsgCount);
  useEffect(() => {
    if (userMsgCount > lastUserCountRef.current) {
      stickyRef.current = true;
      doScrollToBottom();
      setShowScrollBtn(false);
    }
    lastUserCountRef.current = userMsgCount;
  }, [userMsgCount, doScrollToBottom]);

  // ── Stream: while sticky, keep snapping to bottom on every content tick. ──
  useEffect(() => {
    if (!stickyRef.current) return;
    doScrollToBottom();
  }, [contentSignal, doScrollToBottom]);

  // ── Layout shifts (artifact / attachment panel toggle, window resize). ──
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!stickyRef.current) return;
      const el = listRef.current;
      if (!el) return;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (dist > 160) return;
      doScrollToBottom();
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [doScrollToBottom]);

  // ── Conversation switch: restore saved position or jump to bottom. ──
  useEffect(() => {
    const prev = activeIdRef.current;
    if (prev === activeId) return;
    if (prev && listRef.current) saveScrollPosition(prev, listRef.current.scrollTop);
    activeIdRef.current = activeId;
    // Reset send tracker so the first observed user message in the new chat
    // doesn't trigger a phantom snap.
    lastUserCountRef.current = userMsgCount;
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el || !activeId) return;
      const savedPos = scrollPositions[activeId];
      if (savedPos !== undefined) {
        programmaticScrollRef.current = true;
        el.scrollTop = savedPos;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        stickyRef.current = distFromBottom < 80;
        requestAnimationFrame(() => { programmaticScrollRef.current = false; });
      } else {
        stickyRef.current = true;
        doScrollToBottom();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // ── User scroll: break or restore stickiness based on position. ──
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < 80;

    // Always break stickiness when scrolling up — the user's intent to
    // disengage must win. Only guard re-enabling stickiness against
    // programmatic scrolls (which would look like a user scrolling to bottom).
    if (!nearBottom) {
      stickyRef.current = false;
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
    } else if (!programmaticScrollRef.current) {
      stickyRef.current = true;
    }
    setShowScrollBtn(!nearBottom && el.scrollHeight > el.clientHeight + 200);
    const id = activeIdRef.current;
    if (id) saveScrollPosition(id, el.scrollTop);
  }, [saveScrollPosition]);

  const scrollToBottom = useCallback(() => {
    stickyRef.current = true;
    // Flush any pending auto-scroll before doing a manual smooth one.
    if (rafPendingRef.current !== null) {
      cancelAnimationFrame(rafPendingRef.current);
      rafPendingRef.current = null;
    }
    const el = listRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
    setShowScrollBtn(false);
  }, []);

  if (messages.length === 0) return null;

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col">
      <div
        ref={listRef}
        className="h-full overflow-y-auto"
        style={{ overscrollBehavior: "contain", scrollbarGutter: "stable", scrollBehavior: "smooth", contain: "layout style" }}
        onScroll={handleScroll}
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
      >
        <div className="h-4" />
        {messages.map((message, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const isDayChange = !prev || !sameDay(prev.createdAt, message.createdAt);
          const showSeparator = isDayChange && !(prev === null && isToday(message.createdAt));
          return (
            <div key={message.id}>
              {showSeparator && <DateSeparator ts={message.createdAt} />}
              <MessageBubble message={message} />
            </div>
          );
        })}
        {queuedMessages.map((q, i) => (
          <QueuedMessageBubble
            key={`queue-${i}`}
            content={q.content}
            onSteer={() => activeId && steerMessage(activeId, q.content)}
          />
        ))}
        <div className="h-3" />
        <div ref={bottomRef} aria-hidden="true" />
      </div>
      {showScrollBtn && (
        <button
          className="absolute bottom-4 left-1/2 -translate-x-1/2 h-8 px-3 rounded-full bg-[#2a2a2c] border border-white/10 text-[#b4b4b4] flex items-center gap-1.5 shadow-md hover:bg-white/10 hover:text-[#ececec] hover:-translate-y-0.5 transition-all z-10 animate-[fadeInUp_150ms_ease]"
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
