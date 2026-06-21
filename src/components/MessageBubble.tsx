import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Message, useChatStore, normalizeTitle, type ArtifactKind, type ToolCallEntry } from "../stores/chat";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { AttachmentChips, stripAttachmentMarkers } from "./AttachmentChips";
import { ArtifactCard, ArtifactPlaceholderCard } from "./ArtifactPanel";
import { InlineWidget, InlineWidgetPlaceholder } from "./InlineWidget";
import { splitContentByArtifacts } from "../lib/artifact-segments";
import type { ContentSegment, InlineWidgetKind } from "../lib/artifact-segments";
import { stripLeakedToolJson } from "../lib/sanitize";
import { Shimmer, useElapsedLabel, WorkingHeader, formatDurationMs } from "./ThinkingIndicator";
import { ReviewChanges } from "./ReviewChanges";
import { Archive, Copy, Check, Pin, PinOff, Hammer, ListChecks, ChevronRight, ChevronLeft, GitFork, Navigation, Volume2, VolumeX, Sparkles } from "lucide-react";
import { formatMessageTime, formatLongDateTime } from "../lib/datetime";
import { splitByQuestionForm } from "../lib/design/parser";
import { QuestionFormRenderer } from "./design/QuestionFormRenderer";
import { InlineToolCall } from "./InlineToolCall";
import { SubagentTranscriptView } from "./SubagentTranscript";
import { AgentTurnRollbackButton, AgentTurnTimelineHeader } from "./AgentTurnTimeline";
import { useThrottledContent } from "../hooks/useThrottledContent";
import { requestSuggestedCheckApproval } from "../lib/tools/approval";
import { DeepResearchProgress } from "./DeepResearchProgress";
import { CitationsBar } from "./CitationsBar";
import { speakText, stopSpeaking } from "../lib/speech";
import {
  shouldExpandThinking,
  setThinkingPref,
  shouldExpandTrace,
  setTracePref,
} from "../lib/thinking-ui";
import { shouldShowToolCall } from "../lib/tool-visibility";
import "./MessageBubble.css";

const EMPTY_MESSAGES: Message[] = [];
const USER_MESSAGE_COLLAPSE_THRESHOLD = 1200;

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

function CompactionSummaryBubble({ message }: { message: Message }) {
  const hidden = message.compaction?.summarizedCount ?? 0;
  const tokens = message.compaction?.tokensBefore ?? 0;
  return (
    <div className="group relative w-full flex justify-start my-3">
      <div className="max-w-[720px] w-full rounded-lg border border-accent/20 bg-accent/[0.08] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Archive size={14} strokeWidth={1.75} className="text-accent shrink-0" aria-hidden="true" />
            <span className="text-[12.5px] font-semibold text-text-1">Context summary</span>
          </div>
          <div className="flex items-center gap-2 text-[10.5px] font-mono tabular-nums text-text-3 shrink-0">
            {hidden > 0 && <span>{hidden.toLocaleString()} msgs</span>}
            {tokens > 0 && <span>{tokens.toLocaleString()} tok</span>}
          </div>
        </div>
        <div className="mt-2 text-[12.5px] leading-relaxed text-text-2 compaction-summary-prose">
          <MarkdownRenderer content={message.content} />
        </div>
      </div>
    </div>
  );
}

/**
 * Expandable thinking/reasoning block. Shows a "Thinking · Xs" header that
 * toggles open to reveal the model's reasoning content. Follows DESIGN.md
 * tokens: sunken surface, tertiary text, hairline borders.
 */
function ThinkingBlock({ messageId, content, elapsed, running }: {
  messageId: string;
  content?: string;
  elapsed: string;
  running: boolean;
}) {
  const hasContent = !!content && content.trim().length > 0;
  const [expanded, setExpanded] = useState(() =>
    shouldExpandThinking(messageId, running),
  );

  useEffect(() => {
    setExpanded(shouldExpandThinking(messageId, running));
  }, [messageId, running]);

  const toggle = useCallback(() => {
    if (!hasContent) return;
    setExpanded((v) => {
      const next = !v;
      setThinkingPref(messageId, next);
      return next;
    });
  }, [hasContent, messageId]);

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={toggle}
        className={`flex items-center gap-1.5 w-full text-left group/think ${hasContent ? "cursor-pointer" : "cursor-default"}`}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse thinking" : "Expand thinking"}
      >
        {hasContent && (
          <ChevronRight
            size={12}
            strokeWidth={2}
            className={`text-text-4 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            aria-hidden
          />
        )}
        {running ? (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
            </span>
            <Shimmer text={`Thinking · ${elapsed}`} className="text-[13px] font-medium" />
          </div>
        ) : elapsed !== "0s" ? (
          <span className="text-[12px] font-medium text-text-4">
            Thought for {elapsed}
          </span>
        ) : (
          <span className="text-[12px] font-medium text-text-4">
            Thoughts
          </span>
        )}
      </button>
      {expanded && hasContent && (
        <div
          className="mt-1.5 ml-4 max-h-[420px] overflow-y-auto rounded-lg bg-sunken/90 border border-hairline px-4 py-3 text-[12.5px] leading-relaxed text-text-2 break-words animate-[fadeIn_180ms_ease] thinking-prose shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
          style={{ scrollbarGutter: "stable" }}
        >
          <MarkdownRenderer content={content!} />
        </div>
      )}
    </div>
  );
}

// ── Skill badge ─────────────────────────────────────────────────────────────
// Two variants:
//   static    — post-message badge; Sparkles icon + muted tone
//   streaming — shown while auto-trigger skills are active; pulsing dot

function SkillBadge({ name, variant }: { name: string; variant: "static" | "streaming" }) {
  if (variant === "streaming") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent/[0.08] border border-accent/20 text-[11.5px] text-accent">
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent" />
        </span>
        {name}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-text-3 border border-hairline">
      <Sparkles size={9} strokeWidth={1.75} className="text-accent/60 shrink-0" aria-hidden="true" />
      {name}
    </span>
  );
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "compactionSummary") {
    return <CompactionSummaryBubble message={message} />;
  }

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isStreaming = !!message.isStreaming;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoPlayedRef = useRef(false);
  const voiceSettings = useChatStore((s) => s.voiceSettings);

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

  const handleContinue = useCallback(() => {
    useChatStore.getState().triggerContinue(message.conversationId);
  }, [message.conversationId]);

  const handleSpeak = useCallback(() => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    const utterance = speakText(stripMarkdown(message.content), voiceSettings);
    if (!utterance) return;
    setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
  }, [message.content, speaking, voiceSettings]);

  useEffect(() => {
    if (!isAssistant || isStreaming || autoPlayedRef.current) return;
    if (!voiceSettings.enabled || !voiceSettings.autoPlayAssistant) return;
    if (!message.content.trim()) return;
    if (Date.now() - message.createdAt > 15_000) return;
    autoPlayedRef.current = true;
    const utterance = speakText(stripMarkdown(message.content), voiceSettings);
    if (!utterance) return;
    setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
  }, [isAssistant, isStreaming, message.content, message.createdAt, voiceSettings]);

  const handleFork = useCallback(() => {
    const store = useChatStore.getState();
    const allMessages = store.messages[message.conversationId] ?? [];
    const currentIdx = allMessages.findIndex((m) => m.id === message.id);
    if (currentIdx < 0) return;

    // Get messages up to and including this one
    const messagesToFork = allMessages.slice(0, currentIdx + 1);
    const oldConv = store.conversations.find((c) => c.id === message.conversationId);

    // Create new conversation
    const newConvId = store.createConversation();
    if (!newConvId) return;

    // Copy conversation settings
    if (oldConv) {
      store.setSystemPrompt(newConvId, oldConv.systemPrompt);
      if (oldConv.workspacePath) {
        // This is a workspace conversation - we'd need to handle this
      }
    }

    // Copy messages to new conversation
    for (const msg of messagesToFork) {
      store.addMessage({
        conversationId: newConvId,
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
        attachments: msg.attachments,
        pinned: msg.pinned,
        toolCalls: msg.toolCalls,
      });
    }

    // Navigate to the new conversation
    store.setActiveConversation(newConvId);
  }, [message.conversationId, message.id]);

  // Branch navigation: find siblings (messages with same parent)
  const allMessages = useChatStore((s) => s.messages[message.conversationId] ?? EMPTY_MESSAGES);
  const branchInfo = useMemo(() => {
    if (!message.parentId) return null;
    
    // Find all messages with the same parent (siblings)
    const siblings = allMessages.filter((m) => m.parentId === message.parentId);
    if (siblings.length <= 1) return null;
    
    const currentIndex = siblings.findIndex((m) => m.id === message.id);
    return {
      siblings,
      currentIndex,
      total: siblings.length,
    };
  }, [allMessages, message.id, message.parentId]);

  const handlePrevBranch = useCallback(() => {
    if (!branchInfo || branchInfo.currentIndex <= 0) return;
    const prevSibling = branchInfo.siblings[branchInfo.currentIndex - 1];
    useChatStore.getState().navigateToBranch(message.conversationId, prevSibling.id);
  }, [branchInfo, message.conversationId]);

  const handleNextBranch = useCallback(() => {
    if (!branchInfo || branchInfo.currentIndex >= branchInfo.total - 1) return;
    const nextSibling = branchInfo.siblings[branchInfo.currentIndex + 1];
    useChatStore.getState().navigateToBranch(message.conversationId, nextSibling.id);
  }, [branchInfo, message.conversationId]);

  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const renderMode = designMode ? "design" : agentMode ? "agent" : "chat";
  const visibleToolCalls = message.toolCalls?.filter((t) => shouldShowToolCall(t, renderMode)) ?? [];
  const hasToolCalls = visibleToolCalls.length > 0;
  const anyToolRunning = visibleToolCalls.some((t) => t.state === "running" || t.state === "pending_approval");
  const isWorking = isAssistant && isStreaming && (anyToolRunning || message.content.trim().length === 0);
  const startedAt = isAssistant ? message.createdAt : null;
  const thinkingElapsed = useElapsedLabel(isWorking ? startedAt : null, isWorking);
  const hasDeepResearchProgress = isAssistant && !!message.deepResearch;

  return (
    <div className={`group px-6 py-1.5 w-full ${isUser ? "flex justify-end" : ""}`}>
      <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-stretch"} w-full max-w-[720px] mx-auto`}>
        <div className={`flex items-center gap-1.5 min-h-[16px] ${isUser ? "flex-row-reverse" : ""}`}>
          <span className="text-[11px] font-medium text-text-3 uppercase tracking-wider">
            {isUser ? "You" : "goatLLM"}
          </span>
          <span
            className="text-[10.5px] text-text-4 tabular-nums"
            title={formatLongDateTime(message.createdAt)}
            aria-label={formatLongDateTime(message.createdAt)}
          >
            {formatMessageTime(message.createdAt)}
          </span>
          {branchInfo && (
            <div className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handlePrevBranch}
                disabled={branchInfo.currentIndex === 0}
                className="p-0.5 rounded hover:bg-white/5 text-text-4 hover:text-text-1 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous branch"
                aria-label="Previous branch"
              >
                <ChevronLeft size={12} strokeWidth={2} />
              </button>
              <span className="text-[10px] text-text-4 tabular-nums px-1">
                {branchInfo.currentIndex + 1}/{branchInfo.total}
              </span>
              <button
                onClick={handleNextBranch}
                disabled={branchInfo.currentIndex === branchInfo.total - 1}
                className="p-0.5 rounded hover:bg-white/5 text-text-4 hover:text-text-1 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next branch"
                aria-label="Next branch"
              >
                <ChevronRight size={12} strokeWidth={2} />
              </button>
            </div>
          )}
          {isUser && message.steered && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent border border-accent/20"
              title="This message steered the conversation mid-response"
            >
              <Navigation size={9} strokeWidth={2} />
              Steered
            </span>
          )}
        </div>

        {/* Active skills badges — post-message (static) */}
        {message.activeSkillNames && message.activeSkillNames.length > 0 && (
          <div className={`flex items-center gap-1 flex-wrap ${isUser ? "justify-end" : ""}`}>
            {message.activeSkillNames.map((skillName) => (
              <SkillBadge key={skillName} name={skillName} variant="static" />
            ))}
          </div>
        )}

        {/* Thinking block — plain turns only; tool turns embed thinking in AgentTurnView */}
        {isAssistant && !hasToolCalls && !hasDeepResearchProgress && (message.thinkingContent && message.thinkingContent.trim().length > 0 || (isStreaming && message.content.length === 0)) && (
          <ThinkingBlock
            messageId={message.id}
            content={message.thinkingContent}
            elapsed={thinkingElapsed}
            running={isStreaming && message.content.length === 0}
          />
        )}

        {hasDeepResearchProgress && message.deepResearch && (
          <DeepResearchProgress message={message} state={message.deepResearch} />
        )}

        {/* Auto-trigger skill badges — streaming only */}
        {isAssistant && isStreaming && (() => {
          const autoTriggerNames = useChatStore.getState().autoTriggerSkills;
          if (autoTriggerNames.size === 0) return null;
          return (
            <div className="flex items-center gap-1.5 mb-1.5">
              {[...autoTriggerNames].map((name) => (
                <SkillBadge key={name} name={name} variant="streaming" />
              ))}
            </div>
          );
        })()}

        {hasToolCalls && isAssistant ? (
          <AgentTurnView
            message={message}
            isStreaming={isStreaming}
            messageId={message.id}
            mode={renderMode}
          />
        ) : null}
        {hasToolCalls && isAssistant && !isStreaming && (
          <FallbackArtifactCards messageId={message.id} />
        )}

        {/* Plain assistant text (no tool calls) + user messages */}
        {(!hasToolCalls || !isAssistant) && (
          <div className={isUser ? "liquid-surface rounded-2xl rounded-br-md px-4 py-2 max-w-[85%]" : "w-full overflow-hidden min-w-0"}>
            {editing ? (
              <textarea
                ref={textareaRef}
                className="w-full min-w-[320px] bg-surface-2/85 border border-white/10 rounded-xl text-[14px] text-text-1 p-2.5 resize-none outline-none leading-relaxed focus:border-accent/45 focus:ring-2 focus:ring-accent/10"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={1}
              />
            ) : isUser ? (
              <UserMessageContent message={message} />
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
        {isAssistant && message.interrupted && (
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[12px] text-text-3">Response stopped early.</span>
            <button
              type="button"
              className="primary-action px-2.5 py-1 rounded-md text-[12px] font-medium"
              onClick={handleContinue}
            >
              Continue
            </button>
          </div>
        )}
        {/* Action buttons + streaming stats — one row; buttons on hover, stats pinned right */}
        {!isStreaming && (() => {
          const showStats = isAssistant
            && message.streamingDurationMs
            && message.streamingDurationMs > 500;
          const tps = showStats
            ? (message.outputTokens ?? 0) / (message.streamingDurationMs! / 1000)
            : 0;
          return (
            <div className={`flex items-center w-full min-h-[24px] ${isUser ? "justify-end" : showStats ? "justify-between" : ""}`}>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                {message.content.trim().length > 0 && (
                  <button
                    className="control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors"
                    onClick={handleCopy}
                    aria-label={copied ? "Copied to clipboard" : isUser ? "Copy your message" : "Copy assistant response"}
                    title={copied ? "Copied" : "Copy"}
                  >
                    {copied ? (
                      <Check size={13} strokeWidth={2} className="text-success" aria-hidden="true" />
                    ) : (
                      <Copy size={13} strokeWidth={1.6} aria-hidden="true" />
                    )}
                  </button>
                )}
                {isUser && (
                  <button className="control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors" onClick={editing ? handleCancelEdit : handleStartEdit} aria-label={editing ? "Cancel edit" : "Edit message"} title={editing ? "Cancel" : "Edit"}>
                    {editing ? (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="2" y1="2" x2="14" y2="14" /><line x1="14" y1="2" x2="2" y2="14" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 2l3 3-9 9H2v-3l9-9z" /></svg>
                    )}
                  </button>
                )}
                {isAssistant && (
                  <button className="control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors" onClick={handleRegenerate} aria-label="Regenerate response" title="Regenerate">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 4v4h4" /><path d="M15 12v-4h-4" /><path d="M13.5 6A6 6 0 002.2 8.8M2.5 10a6 6 0 0011.3-2.9" /></svg>
                  </button>
                )}
                {isAssistant && message.content.trim().length > 0 && voiceSettings.enabled && (
                  <button
                    className={`control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors ${speaking ? "text-accent border-accent/25 bg-accent/10" : ""}`}
                    onClick={handleSpeak}
                    aria-label={speaking ? "Stop response playback" : "Play response"}
                    title={speaking ? "Stop playback" : "Play response"}
                  >
                    {speaking ? (
                      <VolumeX size={13} strokeWidth={1.8} aria-hidden="true" />
                    ) : (
                      <Volume2 size={13} strokeWidth={1.8} aria-hidden="true" />
                    )}
                  </button>
                )}
                {message.content.trim().length > 0 && (
                  <button
                    className={`control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors ${message.pinned ? "text-accent border-accent/25 bg-accent/10" : ""}`}
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
                {!isUser && (
                  <button
                    className="control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors"
                    onClick={handleFork}
                    aria-label="Fork conversation from here"
                    title="Fork — create new conversation from this point"
                  >
                    <GitFork size={13} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                )}
              </div>
              {showStats && (
                <div className="flex items-center gap-2 text-[10.5px] text-text-3 tabular-nums shrink-0">
                  {message.outputTokens != null && message.outputTokens > 0 && (
                    <span>{message.outputTokens} tokens</span>
                  )}
                  {tps > 0 && (
                    <span>{tps.toFixed(1)} t/s</span>
                  )}
                  <span>{(message.streamingDurationMs! / 1000).toFixed(1)}s</span>
                </div>
              )}
            </div>
          );
        })()}
        {isAssistant && !isStreaming && renderMode === "chat" && message.citations && message.citations.length > 0 && (
          <CitationsBar citations={message.citations} />
        )}
        {isAssistant && !isStreaming && (
          <PlanBuildCTA message={message} />
        )}
      </div>
    </div>
  );
});

// ── Agent turn: collapsed trace + summary + review changes ───────────

type InterleavedSegment =
  | { type: "text"; text: string }
  | { type: "tool"; tc: ToolCallEntry };

function buildInterleavedSegments(
  message: Message,
  displayContent: string,
  mode: "chat" | "agent" | "design",
): InterleavedSegment[] {
  const tcSnapshot = (message.toolCalls ?? [])
    .filter((t) => shouldShowToolCall(t, mode))
    .map((t) => ({
      id: t.toolCallId,
      pos: t.contentAtInvocation ?? 0,
    }))
    .sort((a, b) => a.pos - b.pos);

  const result: InterleavedSegment[] = [];
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
}

function splitTraceAndSummary(segments: InterleavedSegment[]): {
  traceSegments: InterleavedSegment[];
  summaryText: string;
} {
  let lastTextIdx = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].type === "text") {
      lastTextIdx = i;
      break;
    }
  }
  if (lastTextIdx < 0) {
    return { traceSegments: segments, summaryText: "" };
  }
  const last = segments[lastTextIdx];
  const summaryText = last.type === "text" ? last.text : "";
  return {
    traceSegments: [
      ...segments.slice(0, lastTextIdx),
      ...segments.slice(lastTextIdx + 1),
    ],
    summaryText,
  };
}

function TraceSegmentList({
  segments,
  messageId,
  isStreaming,
}: {
  segments: InterleavedSegment[];
  messageId: string;
  isStreaming: boolean;
}) {
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

function AgentTurnView({
  message,
  isStreaming,
  messageId,
  mode,
}: {
  message: Message;
  isStreaming: boolean;
  messageId: string;
  mode: "chat" | "agent" | "design";
}) {
  const displayContent = useThrottledContent(message.content, isStreaming);
  const segments = useMemo(
    () => buildInterleavedSegments(message, displayContent, mode),
    [message, displayContent, mode],
  );
  const { traceSegments, summaryText } = useMemo(
    () => (isStreaming ? { traceSegments: segments, summaryText: "" } : splitTraceAndSummary(segments)),
    [segments, isStreaming],
  );

  const [traceExpanded, setTraceExpanded] = useState(() =>
    shouldExpandTrace(messageId, isStreaming),
  );
  useEffect(() => {
    setTraceExpanded(shouldExpandTrace(messageId, isStreaming));
  }, [messageId, isStreaming]);

  const hasThinking =
    !!message.thinkingContent && message.thinkingContent.trim().length > 0;
  const thinkingRunning = isStreaming && message.content.length === 0;
  const thinkingElapsed = useElapsedLabel(
    thinkingRunning ? message.createdAt : null,
    thinkingRunning,
  );

  const durationMs =
    message.turnDurationMs ?? message.streamingDurationMs ?? 0;
  const workedLabel = formatDurationMs(durationMs);
  const handleRunSuggestedCheck = useCallback((command: string) => {
    requestSuggestedCheckApproval({
      conversationId: message.conversationId,
      messageId: message.id,
      command,
    });
  }, [message.conversationId, message.id]);

  if (isStreaming) {
    return (
      <>
        <WorkingHeader
          startedAt={message.createdAt}
          running
          label="Working"
        />
        {hasThinking && (
          <ThinkingBlock
            messageId={messageId}
            content={message.thinkingContent}
            elapsed={thinkingElapsed}
            running={thinkingRunning}
          />
        )}
        <TraceSegmentList
          segments={segments}
          messageId={messageId}
          isStreaming
        />
      </>
    );
  }

  const summary =
    summaryText.trim() ||
    (segments.length === 0 ? displayContent.trim() : "");

  return (
    <>
      <div className="my-1.5">
        <AgentTurnTimelineHeader
          message={message}
          durationLabel={workedLabel}
          expanded={traceExpanded}
          onToggle={() => {
            setTraceExpanded((v) => {
              const next = !v;
              setTracePref(messageId, next);
              return next;
            });
          }}
          onRunSuggestedCheck={handleRunSuggestedCheck}
        />
        <AgentTurnRollbackButton message={message} />
        {traceExpanded && (
          <div className="mt-2 ml-4 flex flex-col gap-1 border-l border-hairline pl-3">
            {hasThinking && (
              <ThinkingBlock
                messageId={messageId}
                content={message.thinkingContent}
                elapsed={thinkingElapsed}
                running={false}
              />
            )}
            <TraceSegmentList
              segments={traceSegments}
              messageId={messageId}
              isStreaming={false}
            />
          </div>
        )}
      </div>
      {summary.length > 0 && (
        <div className="w-full mt-2">
          <SegmentedAssistantText
            content={summary}
            messageId={messageId}
            isStreaming={false}
          />
        </div>
      )}
      <ReviewChanges message={message} />
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
  const [expanded, setExpanded] = useState(false);

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
  const isCollapsible = !isFormSubmission && cleaned.length > USER_MESSAGE_COLLAPSE_THRESHOLD;

  useEffect(() => {
    setExpanded(false);
  }, [message.id, cleaned]);

  return (
    <div className="flex flex-col gap-1.5">
      {hasAttachments && <AttachmentChips attachments={message.attachments!} />}
      {isFormSubmission ? (
        <div className="flex items-center gap-1.5 text-[12px] text-text-4 italic">
          <ListChecks size={13} strokeWidth={1.6} className="text-text-4" />
          Form submitted
        </div>
      ) : (
        cleaned.length > 0 && (
          <>
            <div
              data-testid="user-message-content"
              className={isCollapsible && !expanded ? "max-h-48 overflow-hidden" : undefined}
            >
              {useRichRender ? (
                <div className="text-[14px] leading-relaxed text-text-1 select-text">
                  <MarkdownRenderer content={cleaned} />
                </div>
              ) : (
                <div className="text-[14px] leading-relaxed text-text-1 whitespace-pre-wrap break-words select-text">
                  {cleaned}
                </div>
              )}
            </div>
            {isCollapsible && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex self-start items-center gap-1 text-[12px] font-medium text-text-2 hover:text-text-1 focus-visible:text-text-1 transition-colors"
                aria-expanded={expanded}
                aria-label={expanded ? "Collapse message" : "Expand message"}
              >
                <ChevronRight
                  size={13}
                  strokeWidth={1.75}
                  className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </>
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

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashCount++;
  return slashCount % 2 === 1;
}

function findUnmatchedMarker(text: string, marker: string): number {
  let openIndex = -1;
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf(marker, cursor);
    if (index === -1) break;
    if (!isEscaped(text, index)) {
      openIndex = openIndex === -1 ? index : -1;
    }
    cursor = index + marker.length;
  }
  return openIndex;
}

function findUnmatchedInlineCode(text: string): number {
  let openIndex = -1;
  const runs = /`+/g;
  let match: RegExpExecArray | null;
  while ((match = runs.exec(text))) {
    if (match[0].length >= 3 || isEscaped(text, match.index)) continue;
    openIndex = openIndex === -1 ? match.index : -1;
  }
  return openIndex;
}

function findIncompleteLink(text: string): number {
  const destination = /!?\[[^\]\n]+\]\([^)\n]*$/.exec(text);
  if (destination?.index != null) return destination.index;
  const label = /!?\[[^\]\n]*$/.exec(text);
  if (label?.index != null) return label.index;
  return -1;
}

function findIncompleteTable(text: string): number {
  const paragraphStart = Math.max(text.lastIndexOf("\n\n"), text.lastIndexOf("\r\n\r\n")) + 2;
  const paragraph = text.slice(Math.max(0, paragraphStart));
  const lines = paragraph.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return -1;
  const looksLikeTable = lines.some((line) => {
    const pipeCount = (line.match(/\|/g) ?? []).length;
    return pipeCount >= 2 || /^\s*\|/.test(line) || /\|\s*$/.test(line);
  });
  if (!looksLikeTable) return -1;
  const hasSeparator = lines.some((line) =>
    /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line),
  );
  return hasSeparator ? -1 : Math.max(0, paragraphStart);
}

function findUnclosedDelimitedRange(text: string, open: string, close: string): number {
  let cursor = 0;
  while (cursor < text.length) {
    const openIndex = text.indexOf(open, cursor);
    if (openIndex === -1) return -1;
    if (isEscaped(text, openIndex)) {
      cursor = openIndex + open.length;
      continue;
    }
    let closeIndex = text.indexOf(close, openIndex + open.length);
    while (closeIndex !== -1 && isEscaped(text, closeIndex)) {
      closeIndex = text.indexOf(close, closeIndex + close.length);
    }
    if (closeIndex === -1) return openIndex;
    cursor = closeIndex + close.length;
  }
  return -1;
}

function findIncompleteDollarMath(text: string): number {
  let openIndex = -1;
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf("$$", cursor);
    if (index === -1) break;
    if (!isEscaped(text, index)) openIndex = openIndex === -1 ? index : -1;
    cursor = index + 2;
  }
  if (openIndex !== -1) return openIndex;

  cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf("$", cursor);
    if (index === -1) break;
    if (text[index + 1] === "$" || text[index - 1] === "$" || isEscaped(text, index)) {
      cursor = index + 1;
      continue;
    }
    openIndex = openIndex === -1 ? index : -1;
    cursor = index + 1;
  }
  return openIndex;
}

function findIncompleteLatexCommand(text: string): number {
  const command = /\\[A-Za-z]+(?:\*?)?(?:\{[^}\n]*)*$/.exec(text);
  if (command?.index == null) return -1;
  const tail = text.slice(command.index);
  const opens = (tail.match(/\{/g) ?? []).length;
  const closes = (tail.match(/\}/g) ?? []).length;
  return opens > closes ? command.index : -1;
}

function findIncompleteMath(text: string): number {
  const indices = [
    findUnclosedDelimitedRange(text, "\\(", "\\)"),
    findUnclosedDelimitedRange(text, "\\[", "\\]"),
    findIncompleteDollarMath(text),
    findIncompleteLatexCommand(text),
  ].filter((index) => index >= 0);
  return indices.length > 0 ? Math.min(...indices) : -1;
}

function stableStreamingMarkdown(text: string): string {
  if (!text) return text;
  const holdIndices = [
    findUnmatchedInlineCode(text),
    findUnmatchedMarker(text, "**"),
    findUnmatchedMarker(text, "__"),
    findIncompleteLink(text),
    findIncompleteTable(text),
    findIncompleteMath(text),
  ].filter((index) => index >= 0);
  if (holdIndices.length === 0) return text;
  const holdIndex = Math.min(...holdIndices);
  return text.slice(0, holdIndex).replace(/[ \t]+$/g, "").replace(/\n{3,}$/g, "\n\n");
}

function DesignAwareText({
  text,
  messageId,
  isStreaming = false,
}: {
  text: string;
  messageId: string;
  isStreaming?: boolean;
}) {
  const designMode = useChatStore((s) => s.designMode);
  const showCritique = useChatStore((s) => s.showDesignCritique);
  const conversationId = useChatStore((s) => s.activeId);
  // Strip leaked tool-call JSON in every mode — `{summary`, `{"filename"...}`
  // must never surface in the chat.
  const deLeaked = useMemo(() => stripLeakedToolJson(text), [text]);
  const cleaned = useMemo(() => {
    if (!designMode) return deLeaked;
    let out = deLeaked.replace(JSON_EXPR_FILTER, "");
    if (!showCritique) out = out.replace(CRITIQUE_FILTER, "");
    return out.trim();
  }, [designMode, showCritique, deLeaked]);
  const displayText = useMemo(
    () => (isStreaming ? stableStreamingMarkdown(cleaned) : cleaned),
    [cleaned, isStreaming],
  );
  const segments = useMemo(
    () => (designMode ? splitByQuestionForm(displayText) : null),
    [designMode, displayText],
  );
  if (!segments) return <MarkdownRenderer content={displayText} isStreaming={isStreaming} />;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return (
            <MarkdownRenderer
              key={`fseg-${messageId}-${i}`}
              content={seg.text}
              isStreaming={isStreaming}
            />
          );
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
            className="soft-card my-3 rounded-xl px-4 py-3 text-[12px] text-text-3 thinking-line"
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
  const advancedArtifacts = useChatStore((s) => s.advancedArtifacts);

  const parts = useMemo(() => {
    // Hide the literal BUILD-PLAN-COMPLETE marker from the rendered text —
    // it's a control signal for the Build CTA, not user-facing copy.
    const stripped = content.replace(/\n*BUILD-PLAN-COMPLETE\s*\.?\s*$/m, "").replace(/\s+$/, "");
    // Inline widgets are an independent surface from the side-panel canvas, so
    // they're gated by their own toggle and split out regardless of autoArtifacts.
    const inlineWidgetKinds = advancedArtifacts
      ? new Set<InlineWidgetKind>(["widget"])
      : undefined;
    if (!autoArtifacts) {
      // User opted out of the canvas — keep every artifact fence inline as a
      // regular code block, but still render live widgets when enabled.
      if (!inlineWidgetKinds) {
        return [{ type: "text" as const, text: stripped }];
      }
      return splitContentByArtifacts(stripped, {
        enabledKinds: new Set<ArtifactKind>(),
        inlineWidgetKinds,
      });
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
    return splitContentByArtifacts(stripped, { enabledKinds, inlineWidgetKinds });
  }, [content, autoArtifacts, officeArtifacts, advancedArtifacts]);

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
          return (
            <DesignAwareText
              key={`t-${i}`}
              text={p.text}
              messageId={messageId}
              isStreaming={isStreaming}
            />
          );
        }
        if (p.type === "artifact") {
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
        }
        // Live inline widget — sandboxed, auto-sizing render in the reply
        // flow. Hold partial HTML behind a placeholder so layout doesn't flash.
        if (!p.complete) {
          return <InlineWidgetPlaceholder key={`w-${i}`} title={p.title} />;
        }
        return <InlineWidget key={`w-${i}`} code={p.code} title={p.title} />;
      })}
      {/* If the bubble is mid-stream and the last segment is an open fence,
          add a subtle "writing" hint below the placeholder. */}
      {isStreaming && parts.length > 0 && parts[parts.length - 1].type === "artifact" && (
        <div className="text-[11px] text-text-3 mt-1 thinking-line">Writing…</div>
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
    <div className="mt-4 rounded-2xl border border-accent/30 bg-accent/[0.055] p-4 flex items-start gap-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="shrink-0 w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
        <ListChecks size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text-1 leading-tight">
          Plan ready{planMode ? " — read-only investigation done" : ""}
        </div>
        <div className="text-[11.5px] text-text-3 mt-0.5 leading-snug">
          Review the steps above. Build executes the plan with full write tools.
        </div>
      </div>
      <button
        onClick={handleBuild}
        disabled={isStreaming}
        className="shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-accent text-bg text-[13px] font-semibold hover:bg-accent-hover active:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Build the plan"
        title="Switch to write mode and execute the plan"
      >
        <Hammer size={14} strokeWidth={2} aria-hidden="true" />
        Build
      </button>
    </div>
  );
}
