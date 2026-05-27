import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Message, useChatStore, normalizeTitle, type ArtifactKind, type ToolCallEntry } from "../stores/chat";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { AttachmentChips, stripAttachmentMarkers } from "./AttachmentChips";
import { ArtifactCard, ArtifactPlaceholderCard } from "./ArtifactPanel";
import { splitContentByArtifacts, type ContentSegment } from "../lib/artifact-segments";
import { Shimmer, WorkingHeader } from "./ThinkingIndicator";
import { Copy, Check, Pin, PinOff, Hammer, ListChecks, Sparkles } from "lucide-react";
import { formatMessageTime, formatLongDateTime } from "../lib/datetime";
import { splitByQuestionForm } from "../lib/design/parser";
import { QuestionFormRenderer } from "./design/QuestionFormRenderer";
import { InlineToolCall } from "./InlineToolCall";
import { SubagentTranscriptView } from "./SubagentTranscript";
import { useThrottledContent } from "../hooks/useThrottledContent";
import "./MessageBubble.css";

function stripMarkdown(md: string): string {
  return md
    // fenced code blocks: keep contents, drop the fences
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    // inline code
    .replace(/`([^`]+)`/g, "$1")
    // images / links → keep label
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // bold + italic markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
    // headers, blockquotes, list markers
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // horizontal rules
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .trim();
}

interface MessageBubbleProps { message: Message; }

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isStreaming = !!message.isStreaming;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = useCallback(async () => {
    const text = isAssistant ? stripMarkdown(message.content) : message.content;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — silent */
    }
  }, [isAssistant, message.content]);

  const handleStartEdit = useCallback(() => {
    // Strip the inlined attachment marker blocks from the edit textarea so
    // the user only sees their actual prose. The chips above already show
    // what's attached; the markers get re-baked at send time.
    setEditValue(stripAttachmentMarkers(message.content));
    setEditing(true);
  }, [message.content]);
  const handleSaveEdit = useCallback(() => {
    const store = useChatStore.getState();
    // Preserve the original attachments through the resend cycle so editing
    // a question that referenced a PDF doesn't strip the PDF from context.
    // The send pipeline re-runs extractAndAppend, which is idempotent thanks
    // to the attachment cache (no re-OCR / re-extract on the same dataUrl).
    const attachments = message.attachments;
    store.editMessage(message.conversationId, message.id, editValue);
    store.removeMessagesAfter(message.conversationId, message.id);
    store.triggerResend(message.conversationId, editValue, attachments);
    setEditing(false);
  }, [message.conversationId, message.id, message.attachments, editValue]);
  const handleCancelEdit = useCallback(() => setEditing(false), []);
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
    if (e.key === "Escape") handleCancelEdit();
  }, [handleSaveEdit, handleCancelEdit]);

  useEffect(() => {
    if (editing) {
      const ta = textareaRef.current;
      if (ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; ta.focus(); }
    }
  }, [editing]);

  const handleRegenerate = useCallback(() => {
    const store = useChatStore.getState();
    const convMessages = store.messages[message.conversationId] ?? [];
    const idx = convMessages.findIndex((m) => m.id === message.id);
    if (idx <= 0) return;
    const prevMessage = convMessages[idx - 1];
    if (prevMessage.role !== "user") return;
    store.removeMessagesAfter(message.conversationId, prevMessage.id);
    store.triggerResend(message.conversationId, prevMessage.content, prevMessage.attachments);
  }, [message.conversationId, message.id]);

  const handleTogglePin = useCallback(() => {
    const store = useChatStore.getState();
    store.updateMessage(message.conversationId, message.id, { pinned: !message.pinned });
  }, [message.conversationId, message.id, message.pinned]);

  const hasToolCalls = !!(message.toolCalls && message.toolCalls.length > 0);
  const anyToolRunning = !!message.toolCalls?.some((t) => t.state === "running" || t.state === "pending_approval");
  const isWorking = isAssistant && isStreaming && (anyToolRunning || message.content.trim().length === 0);
  const startedAt = isAssistant ? message.createdAt : null;
  const agentMode = useChatStore((s) => s.agentMode);
  const showWorkingHeader = isAssistant && isStreaming && (hasToolCalls || agentMode);
  const headerRunning = isAssistant && isStreaming;

  return (
    <div className={`group px-6 py-1.5 w-full ${isUser ? "flex justify-end" : ""}`}>
      <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-stretch"} w-full max-w-[720px] mx-auto`}>
        <div className={`flex items-center gap-1.5 min-h-[16px] ${isUser ? "flex-row-reverse" : ""}`}>
          <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wider">
            {isUser ? "You" : "goatLLM"}
          </span>
          <span
            className="text-[10.5px] text-[#888888] tabular-nums"
            title={formatLongDateTime(message.createdAt)}
            aria-label={formatLongDateTime(message.createdAt)}
          >
            {formatMessageTime(message.createdAt)}
          </span>
          <div className={`flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? "flex-row-reverse" : ""}`}>
            {!isStreaming && message.content.trim().length > 0 && (
              <button
                className="w-6 h-6 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors"
                onClick={handleCopy}
                aria-label={copied ? "Copied to clipboard" : isUser ? "Copy your message" : "Copy assistant response"}
                title={copied ? "Copied" : "Copy"}
              >
                {copied ? (
                  <Check size={13} strokeWidth={2} className="text-[#34d399]" aria-hidden="true" />
                ) : (
                  <Copy size={13} strokeWidth={1.6} aria-hidden="true" />
                )}
              </button>
            )}
            {isUser && !isStreaming && (
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors" onClick={editing ? handleCancelEdit : handleStartEdit} aria-label={editing ? "Cancel edit" : "Edit message"} title={editing ? "Cancel" : "Edit"}>
                {editing ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="2" y1="2" x2="14" y2="14" /><line x1="14" y1="2" x2="2" y2="14" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 2l3 3-9 9H2v-3l9-9z" /></svg>
                )}
              </button>
            )}
            {isAssistant && !isStreaming && (
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors" onClick={handleRegenerate} aria-label="Regenerate response" title="Regenerate">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 4v4h4" /><path d="M15 12v-4h-4" /><path d="M13.5 6A6 6 0 002.2 8.8M2.5 10a6 6 0 0011.3-2.9" /></svg>
              </button>
            )}
            {!isStreaming && message.content.trim().length > 0 && (
              <button
                className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors ${message.pinned ? "text-[#f59e42] hover:bg-white/5" : "text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5"}`}
                onClick={handleTogglePin}
                aria-label={message.pinned ? "Unpin from context" : "Pin to context"}
                title={message.pinned ? "Pinned — survives auto-compaction" : "Pin to context"}
              >
                {message.pinned ? (
                  <Pin size={13} strokeWidth={2} aria-hidden="true" fill="currentColor" />
                ) : (
                  <PinOff size={13} strokeWidth={1.6} aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>

        {showWorkingHeader && <WorkingHeader startedAt={startedAt} running={headerRunning} label="Working" />}

        {isAssistant && isStreaming && (() => {
          const autoTriggerNames = useChatStore.getState().autoTriggerSkills;
          if (autoTriggerNames.size === 0) return null;
          return (
            <div className="flex items-center gap-1.5 mb-1.5">
              {[...autoTriggerNames].map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f59e42]/10 text-[11.5px] text-[#f59e42]"
                >
                  <Sparkles size={10} strokeWidth={1.75} />
                  {name}
                </span>
              ))}
            </div>
          );
        })()}

        {hasToolCalls && isAssistant ? (
          <ToolCallInterleavedBody
            message={message}
            isStreaming={isStreaming}
            messageId={message.id}
          />
        ) : null}
        {hasToolCalls && isAssistant && isStreaming && message.content.length === 0 && (
          <Shimmer text="Thinking" className="thinking-line" />
        )}
        {hasToolCalls && isAssistant && isStreaming && message.content.length > 0 && (
          <span className="streaming-cursor" />
        )}
        {hasToolCalls && isAssistant && !isStreaming && (
          <FallbackArtifactCards messageId={message.id} />
        )}

        {/* Plain assistant text (no tool calls) + user messages */}
        {(!hasToolCalls || !isAssistant) && (
          <div className={isUser ? "bg-[#2d2d2d] border border-white/5 rounded-2xl px-4 py-2 max-w-[85%]" : "w-full"}>
            {editing ? (
              <textarea
                ref={textareaRef}
                className="w-full min-w-[320px] bg-[#2c2c2e] border border-white/10 rounded-xl text-[14px] text-[#ececec] p-2.5 resize-none outline-none leading-relaxed"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={1}
              />
            ) : isUser ? (
              <UserMessageContent message={message} />
            ) : message.content.length === 0 && isWorking ? (
              <Shimmer text="Thinking" className="thinking-line" />
            ) : (
              <>
                <StreamingSegmentedText
                  content={message.content}
                  messageId={message.id}
                  isStreaming={isStreaming}
                />
                {isStreaming && message.content.length > 0 && (
                  <span className="streaming-cursor" />
                )}
              </>
            )}
          </div>
        )}
        {isAssistant && !isStreaming && (
          <PlanBuildCTA message={message} />
        )}
      </div>
    </div>
  );
});

// ── Tool-call interleaved body (memoized, throttled display) ───────────

function ToolCallInterleavedBody({
  message, isStreaming, messageId,
}: {
  message: Message;
  isStreaming: boolean;
  messageId: string;
}) {
  // Snapshot tool positions — stable ref while the tool list is the same,
  // so interleaving computation is memoized and doesn't run on every token.
  const tcSnapshot = useMemo(
    () =>
      (message.toolCalls ?? [])
        .map((t) => ({
          id: t.toolCallId,
          state: t.state,
          pos: t.contentAtInvocation ?? 0,
        }))
        .sort((a, b) => a.pos - b.pos),
    [message.toolCalls],
  );

  // Throttle markdown/segment re-parses to ~80ms during streaming.
  const displayContent = useThrottledContent(message.content, isStreaming);

  // Interleave: split text at each tool-call position. Recomputes only when
  // tcSnapshot changes (tool add/complete) or displayContent changes (which
  // is already throttled).
  const segments = useMemo(() => {
    type Segment = { type: "text"; text: string } | { type: "tool"; tc: ToolCallEntry };
    const result: Segment[] = [];
    let lastPos = 0;
    for (const snap of tcSnapshot) {
      if (snap.pos > lastPos && displayContent.length > 0) {
        const slice = displayContent.slice(lastPos, snap.pos).trim();
        if (slice) result.push({ type: "text", text: slice });
      }
      const full = message.toolCalls?.find((t) => t.toolCallId === snap.id);
      if (full) result.push({ type: "tool", tc: full });
      lastPos = Math.max(lastPos, snap.pos);
    }
    if (lastPos < displayContent.length) {
      const remaining = displayContent.slice(lastPos).trim();
      if (remaining) result.push({ type: "text", text: remaining });
    }
    return result;
  }, [tcSnapshot, displayContent, message.toolCalls]);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "tool") {
          if (
            seg.tc.toolName === "spawn_subagent" &&
            seg.tc.subagentTranscript &&
            seg.tc.state === "done"
          ) {
            return (
              <InlineToolCall key={seg.tc.toolCallId} tc={seg.tc}>
                <SubagentTranscriptView transcript={seg.tc.subagentTranscript} />
              </InlineToolCall>
            );
          }
          return <InlineToolCall key={seg.tc.toolCallId} tc={seg.tc} />;
        }
        if (isStreaming) {
          return (
            <div key={`text-${i}`} className="w-full">
              <SegmentedAssistantText
                content={seg.text}
                messageId={messageId}
                isStreaming={false}
              />
            </div>
          );
        }
        return (
          <div key={`text-${i}`} className="w-full">
            <SegmentedAssistantText
              content={seg.text}
              messageId={messageId}
              isStreaming={false}
            />
          </div>
        );
      })}
      {isStreaming && segments.length > 0 && (
        <span className="streaming-cursor" />
      )}
    </>
  );
}

// ── Streaming-aware SegmentedAssistantText wrapper ─────────────────────
//
// When streaming, the content is throttled via useThrottledContent so the
// heavy MarkdownRenderer AST rebuild (react-markdown + remark + rehype +
// KaTeX) runs ~12 times/second instead of 30-50 times/second.

function StreamingSegmentedText({
  content, messageId, isStreaming,
}: {
  content: string; messageId: string; isStreaming: boolean;
}) {
  const displayContent = useThrottledContent(content, isStreaming);
  return (
    <SegmentedAssistantText
      content={displayContent}
      messageId={messageId}
      isStreaming={isStreaming}
    />
  );
}

// ── User message content (with attachment chips and stripped markers) ──

function UserMessageContent({ message }: { message: Message }) {
  const cleaned = useMemo(() => stripAttachmentMarkers(message.content), [message.content]);
  const hasAttachments = !!message.attachments && message.attachments.length > 0;

  // Design-mode form submissions are opaque payloads like "[form answers — discovery]\nsurface: ...".
  // Render a subtle indicator instead of the raw text.
  const isFormSubmission = /^\[form[ :]/.test(cleaned);

  // Render LaTeX math the user typed/pasted (e.g. `$\int_0^1 x^2 dx$`,
  // `$$\sum_{i=1}^n i$$`). We sniff for paired `$` or `$$` delimiters before
  // routing through MarkdownRenderer so plain prose with stray `$` (prices,
  // shell prompts) keeps its whitespace-pre-wrap rendering. Triggers on
  // either delimited math or markdown that uses fenced code / headings
  // — students often paste from textbooks so we want both rendered.
  const hasMath = useMemo(() => {
    if (!cleaned) return false;
    // $$ ... $$ block math.
    if (/\$\$[^$]+\$\$/.test(cleaned)) return true;
    // $ ... $ inline math — require at least one balanced pair containing a
    // letter or backslash so we don't trigger on "$5" or shell prompts.
    if (/\$[^$\n]*[\\A-Za-z][^$\n]*\$/.test(cleaned)) return true;
    return false;
  }, [cleaned]);
  const hasMarkdown = useMemo(() => {
    if (!cleaned) return false;
    return /(```|^#{1,6}\s|^\s*[-*]\s+|\[[^\]]+\]\([^)]+\))/m.test(cleaned);
  }, [cleaned]);
  const useRichRender = hasMath || hasMarkdown;

  return (
    <div className="flex flex-col">
      {hasAttachments && <AttachmentChips attachments={message.attachments!} />}
      {isFormSubmission ? (
        <div className="flex items-center gap-1.5 text-[12px] text-[#888] italic">
          <ListChecks size={13} strokeWidth={1.6} className="text-[#666]" />
          Form submitted
        </div>
      ) : cleaned.length > 0 && (
        useRichRender ? (
          <div className="text-[14px] leading-relaxed text-[#ececec] select-text">
            <MarkdownRenderer content={cleaned} />
          </div>
        ) : (
          <div className="text-[14px] leading-relaxed text-[#ececec] whitespace-pre-wrap break-words select-text">{cleaned}</div>
        )
      )}
    </div>
  );
}

// ── Assistant text → markdown + inline artifact cards ──
//
// The model authors artifacts as fenced code blocks (```docx … ```, etc.).
// Showing the raw fence to the user is noisy — the real artifact lives in the
// side panel — so we strip those fences out of the text and replace each one
// with an inline `ArtifactCard` (or a placeholder while the body is still
// streaming). Non-artifact code blocks pass through untouched.
//
// `DesignAwareText` is the design-mode wrapper: it splits the text on
// any `<question-form>` block and renders it as a native form. When the
// user isn't in design mode, this is just a passthrough to MarkdownRenderer.
// Strip internal critique output the model shouldn't surface.
// Matches "Self-check pass. Philosophy 5 / Hierarchy 5 / ..." and similar.
const CRITIQUE_FILTER = /^(?:Self[- ]check\s*(?:pass|fail|clear)?\.?\s*(?:Philosophy|Hierarchy|Execution|Specificity|Restraint)\s*\d\s*\/\s*\d.*)$/gim;
// Strip malformed JSON expression blocks that leak from model output
// (e.g. {"expression": "1+1"} from exec_eval tool call text leakage).
const JSON_EXPR_FILTER = /\{\s*"expression"\s*:\s*[^}]*\}/g;

function DesignAwareText({ text, messageId }: { text: string; messageId: string }) {
  const designMode = useChatStore((s) => s.designMode);
  const showCritique = useChatStore((s) => s.showDesignCritique);
  const conversationId = useChatStore((s) => s.activeId);
  const cleaned = useMemo(() => {
    if (!designMode) return text;
    let out = text.replace(JSON_EXPR_FILTER, "");
    if (!showCritique) out = out.replace(CRITIQUE_FILTER, "");
    return out.trim();
  }, [designMode, showCritique, text]);
  const segments = useMemo(
    () => (designMode ? splitByQuestionForm(cleaned) : null),
    [designMode, cleaned],
  );
  if (!segments) return <MarkdownRenderer content={text} />;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <MarkdownRenderer key={`fseg-${messageId}-${i}`} content={seg.text} />;
        }
        if (seg.form && conversationId) {
          return (
            <QuestionFormRenderer
              key={`fseg-${messageId}-${i}`}
              form={seg.form}
              conversationId={conversationId}
            />
          );
        }
        // Streaming-in-progress form — show a tiny placeholder card.
        return (
          <div
            key={`fseg-${messageId}-${i}`}
            className="my-3 rounded-xl border border-white/[0.08] bg-[#2a2a2c] px-4 py-3 text-[12px] text-[#a0a0a0] thinking-line"
          >
            Composing form…
          </div>
        );
      })}
    </>
  );
}

function SegmentedAssistantText({
  content,
  messageId,
  isStreaming,
}: {
  content: string;
  messageId: string;
  isStreaming: boolean;
}) {
  const activeId = useChatStore((s) => s.activeId);
  const artifacts = useChatStore((s) => (activeId ? s.artifacts[activeId] : undefined));
  const autoArtifacts = useChatStore((s) => s.autoArtifacts);
  const officeArtifacts = useChatStore((s) => s.officeArtifacts);

  const parts = useMemo(() => {
    // Hide the literal BUILD-PLAN-COMPLETE marker from the rendered text —
    // it's a control signal for the Build CTA, not user-facing copy.
    const stripped = content.replace(/\n*BUILD-PLAN-COMPLETE\s*\.?\s*$/m, "").replace(/\s+$/, "");
    if (!autoArtifacts) {
      // User opted out — keep every fence inline as a regular code block.
      return [{ type: "text" as const, text: stripped }];
    }
    const enabledKinds = new Set<ArtifactKind>([
      "html", "latex", "python",
      // Design mode artifact kinds
      "deck", "react-component", "markdown-document", "svg", 
      "diagram", "code-snippet", "mini-app", "design-system"
    ]);
    if (officeArtifacts) {
      enabledKinds.add("docx");
      enabledKinds.add("pptx");
      enabledKinds.add("xlsx");
    }
    return splitContentByArtifacts(stripped, { enabledKinds });
  }, [content, autoArtifacts, officeArtifacts]);

  // Build a lookup so the inline placeholder slots can resolve to a real
  // artifact once detection runs after the stream finishes. We match on
  // (kind + normalized title) which is exactly the key the detector uses.
  const findArtifact = (kind: ArtifactKind, title: string) => {
    if (!artifacts) return undefined;
    const want = normalizeTitle(title);
    if (!want) {
      return [...artifacts]
        .reverse()
        .find((a) => a.messageId === messageId && a.kind === kind);
    }
    return [...artifacts]
      .reverse()
      .find((a) => a.kind === kind && normalizeTitle(a.title) === want);
  };

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") {
          return <DesignAwareText key={`t-${i}`} text={p.text} messageId={messageId} />;
        }
        const real = findArtifact(p.kind, p.title);
        if (real) {
          return (
            <div key={`a-${i}`} className="my-2">
              <ArtifactCard artifact={real} />
            </div>
          );
        }
        // No artifact in the store yet — either still streaming, or the
        // closing fence is missing. Show the placeholder so the user has
        // something to look at.
        return (
          <div key={`a-${i}`} className="my-2">
            <ArtifactPlaceholderCard kind={p.kind} title={p.title} />
          </div>
        );
      })}
      {/* If the bubble is mid-stream and the last segment is an open fence,
          add a subtle "writing" hint below the placeholder. */}
      {isStreaming && parts.length > 0 && parts[parts.length - 1].type === "artifact" && (
        <div className="text-[11px] text-[#a0a0a0] mt-1 thinking-line">Writing…</div>
      )}
    </>
  );
}

// ── Inline artifact cards (fallback) ──
//
// Some artifacts may have been detected from a message that didn't preserve
// its fences in the visible content (legacy messages, or content that got
// trimmed). Anything not already placed inline by the segmenter falls back
// to a row of cards under the bubble.
function FallbackArtifactCards({ messageId }: { messageId: string }) {
  const activeId = useChatStore((s) => s.activeId);
  const artifacts = useChatStore((s) => (activeId ? s.artifacts[activeId] : undefined));
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] : undefined));
  const messageArtifacts = artifacts?.filter((a) => a.messageId === messageId) ?? [];

  if (messageArtifacts.length === 0) return null;

  // Look at the message text — if every artifact is referenced by an inline
  // fence, the segmenter already drew them. Skip the duplicate cards.
  const message = messages?.find((m) => m.id === messageId);
  if (message) {
    const inlineParts = splitContentByArtifacts(message.content);
    const inlineKeys = new Set(
      inlineParts
        .filter((p): p is Extract<ContentSegment, { type: "artifact" }> => p.type === "artifact")
        .map((p) => `${p.kind}|${normalizeTitle(p.title)}`),
    );
    const unplaced = messageArtifacts.filter(
      (a) => !inlineKeys.has(`${a.kind}|${normalizeTitle(a.title)}`),
    );
    if (unplaced.length === 0) return null;
    return (
      <div className="flex flex-col gap-1.5 mt-3">
        {unplaced.map((a) => (
          <ArtifactCard key={a.id} artifact={a} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 mt-3">
      {messageArtifacts.map((a) => (
        <ArtifactCard key={a.id} artifact={a} />
      ))}
    </div>
  );
}

// ── Plan-mode “Build” call-to-action ──
//
// When the agent finishes a plan-mode reply, it ends the message with the
// literal `BUILD-PLAN-COMPLETE` marker. We strip that marker from the
// rendered text (handled in stripMarkdown for the copy button only — see
// below) and surface a CTA banner with a Build button. Click flips the
// store off plan mode and replays the user's last prompt so the agent
// continues with write tools available, fully aware of the plan above.
function PlanBuildCTA({ message }: { message: Message }) {
  const activeId = useChatStore((s) => s.activeId);
  const planMode = useChatStore((s) => s.planMode);
  const setPlanMode = useChatStore((s) => s.setPlanMode);
  const triggerResend = useChatStore((s) => s.triggerResend);
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] : undefined));
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);
  // Local consumed flag for instant feedback. Once the user clicks Build
  // (or otherwise dismisses), we hide the CTA immediately rather than
  // waiting for the resend round-trip to update the message list.
  const [consumed, setConsumed] = useState(false);

  // Trigger purely on the marker so the CTA still shows up if the user
  // toggles plan mode off between turns. Tolerates whitespace/punctuation
  // after the marker so a stray period or trailing newline doesn't hide it.
  const looksLikePlan = /BUILD-PLAN-COMPLETE\s*\.?\s*$/.test(message.content.trim());
  if (!looksLikePlan) return null;

  // Only show the CTA on the latest assistant message in the conversation.
  // Once any further message lands — the build resend, a manual follow-up,
  // anything — the plan is no longer the live tail and the button stops
  // making sense. This makes the CTA single-shot by construction.
  if (messages && messages.length > 0) {
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx !== -1 && idx !== messages.length - 1) return null;
  }

  if (consumed) return null;

  const handleBuild = () => {
    if (!activeId || isStreaming || !messages) return;
    // Find the last user message to replay. Plan-mode only ever sits
    // between a single user prompt and a single assistant plan, so this
    // is unambiguous.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setConsumed(true);
    setPlanMode(false);
    // Append a small directive so the model knows this turn executes the
    // plan rather than re-plans. Keep the original attachments.
    const directive = lastUser.content.trim()
      ? `${lastUser.content}\n\nProceed and build the plan above.`
      : "Proceed and build the plan above.";
    triggerResend(activeId, directive, lastUser.attachments);
  };

  return (
    <div className="mt-4 rounded-2xl border border-[#f59e42]/30 bg-gradient-to-b from-[#f59e42]/[0.06] to-transparent p-4 flex items-start gap-3">
      <div className="shrink-0 w-9 h-9 rounded-xl bg-[#f59e42]/15 flex items-center justify-center">
        <ListChecks size={16} strokeWidth={1.75} className="text-[#f59e42]" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[#ececec] leading-tight">
          Plan ready{planMode ? " — read-only investigation done" : ""}
        </div>
        <div className="text-[11.5px] text-[#a0a0a0] mt-0.5 leading-snug">
          Review the steps above. Build executes the plan with full write tools.
        </div>
      </div>
      <button
        onClick={handleBuild}
        disabled={isStreaming}
        className="shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-[#f59e42] text-[#1a1a1c] text-[13px] font-semibold hover:bg-[#f0903a] active:bg-[#e88a32] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Build the plan"
        title="Switch to write mode and execute the plan"
      >
        <Hammer size={14} strokeWidth={2} aria-hidden="true" />
        Build
      </button>
    </div>
  );
}
