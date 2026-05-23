import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useChatStore } from "../stores/chat";
import { MessageBubble } from "./MessageBubble";
import { ChevronDown } from "lucide-react";

export function MessageList() {
  const activeId = useChatStore((s) => s.activeId);
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);
  const saveScrollPosition = useChatStore((s) => s.saveScrollPosition);
  const scrollPositions = useChatStore((s) => s.scrollPositions);
  const msgMap = useChatStore((s) => s.messages);
  const messages = activeId ? (msgMap[activeId] ?? []) : [];

  const listRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const stickToBottomRef = useRef(true);
  const userScrollingRef = useRef(false);
  const userScrollTimerRef = useRef<number | null>(null);
  const activeIdRef = useRef(activeId);

  // Single number that grows whenever the active conversation gets new content
  // (new message, streamed token, tool call update). Effect dep without re-creating arrays.
  const contentSignal = useMemo(() => {
    let n = messages.length * 4096;
    for (const m of messages) {
      n += m.content.length;
      if (m.toolCalls) n += m.toolCalls.length * 31 + (m.toolCalls.reduce((a, t) => a + (t.state === "done" ? 1 : 0), 0));
    }
    return n;
  }, [messages]);

  const updateBottomState = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < 80;
    stickToBottomRef.current = nearBottom;
    setShowScrollBtn(!nearBottom && el.scrollHeight > el.clientHeight + 200);
  }, []);

  // Active conversation switch — restore saved position or jump to bottom.
  useEffect(() => {
    const prev = activeIdRef.current;
    if (prev === activeId) return;
    if (prev && listRef.current) saveScrollPosition(prev, listRef.current.scrollTop);
    activeIdRef.current = activeId;
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el || !activeId) return;
      const savedPos = scrollPositions[activeId];
      el.scrollTop = savedPos !== undefined ? savedPos : el.scrollHeight;
      stickToBottomRef.current = savedPos === undefined;
      updateBottomState();
    });
  }, [activeId, saveScrollPosition, scrollPositions, updateBottomState]);

  // Stick to bottom while streaming: cheap, jank-free, runs only on actual content growth.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    if (userScrollingRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [contentSignal]);

  const handleScroll = useCallback(() => {
    updateBottomState();
    const id = activeIdRef.current;
    if (id && listRef.current) saveScrollPosition(id, listRef.current.scrollTop);
  }, [saveScrollPosition, updateBottomState]);

  // Mark "user is actively scrolling" briefly so the auto-stick effect yields. Lets the
  // user scroll up mid-stream without the page yanking them back.
  const handleWheelOrTouch = useCallback(() => {
    userScrollingRef.current = true;
    if (userScrollTimerRef.current) window.clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = window.setTimeout(() => {
      userScrollingRef.current = false;
    }, 350);
  }, []);

  useEffect(() => () => {
    if (userScrollTimerRef.current) window.clearTimeout(userScrollTimerRef.current);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    userScrollingRef.current = false;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  if (messages.length === 0) return null;

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col">
      <div
        ref={listRef}
        className="h-full overflow-y-auto"
        style={{ overscrollBehavior: "contain", scrollbarGutter: "stable" }}
        onScroll={handleScroll}
        onWheel={handleWheelOrTouch}
        onTouchMove={handleWheelOrTouch}
        onKeyDown={(e) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) {
            handleWheelOrTouch();
          }
        }}
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
      >
        <div className="h-9" />
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div className="h-6" />
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
