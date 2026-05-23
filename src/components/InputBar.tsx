import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { useChatStore, Attachment, type ToolCallEntry } from "../stores/chat";
import { streamChat, generateTitle, heuristicTitle, LlmContentPart, type ToolCallInfo, type ToolResultInfo } from "../lib/llm";
import { ALL_TOOLS, isWriteTool } from "../lib/tools";
import { classifyCommand } from "../lib/command-safety";
import { buildAgentSystemPrompt, buildChatSystemPrompt, getGoatLLMToolInfo } from "../lib/system-prompt";
import { logMessage, logToolCall, logToolResult, logError } from "../lib/event-log";
import { compactMessages } from "../lib/context-manager";
import { ModelPicker } from "./ModelPicker";
import { AgentPill } from "./AgentPill";
import {
  Plus,
  Upload,
  FileText,
  Link2,
  Camera,
  Mic,
  ArrowUp,
  StopCircle,
  Square,
} from "lucide-react";
import { useSpeechToText } from "../lib/speech";

export function InputBar() {
  const activeId = useChatStore((s) => s.activeId);
  const focusNonce = useChatStore((s) => s.focusNonce);
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const addToolCallToMessage = useChatStore((s) => s.addToolCallToMessage);
  const completeToolCall = useChatStore((s) => s.completeToolCall);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const appendToMessage = useChatStore((s) => s.appendToMessage);
  const createConversation = useChatStore((s) => s.createConversation);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const getActiveMessages = useChatStore((s) => s.getActiveMessages);
  const getActiveLlmConfig = useChatStore((s) => s.getActiveLlmConfig);
  const getModels = useChatStore((s) => s.getModels);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const setTitleGenerating = useChatStore((s) => s.setTitleGenerating);
  const conversations = useChatStore((s) => s.conversations);
  const cancelStreaming = useChatStore((s) => s.cancelStreaming);
  const setContinueConversation = useChatStore((s) => s.setContinueConversation);
  const continueConversationId = useChatStore((s) => s.continueConversationId);
  const detectArtifacts = useChatStore((s) => s.detectArtifacts);
  const resendPayload = useChatStore((s) => s.resendPayload);
  const clearResend = useChatStore((s) => s.clearResend);

  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const speech = useSpeechToText({
    onTranscription: (text) => {
      setValue((cur) => (cur.trim() ? cur + " " + text : text));
    },
    onError: (msg) => {
      setError(msg);
    },
  });

  // If speech recognition isn't supported, hide the mic button entirely
  const showMic = speech.supported;

  const noModelsAvailable = getModels().filter((m) => m.isAvailable).length === 0;

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, []);

  useEffect(() => { adjustHeight(); }, [value, adjustHeight]);
  useEffect(() => { textareaRef.current?.focus(); }, [activeId, focusNonce]);

  // Auto-dismiss "Continue generating" the moment the user starts typing — they're
  // clearly moving on, no need to leave it hanging until they click X.
  useEffect(() => {
    if (!activeId) return;
    if (value.length === 0) return;
    if (continueConversationId !== activeId) return;
    setContinueConversation(null);
  }, [value, activeId, continueConversationId, setContinueConversation]);

  const handleAttach = useCallback(() => fileInputRef.current?.click(), []);

  const handleFilesChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(selectedFiles)) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`File "${file.name}" exceeds 50MB limit.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      newAttachments.push({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl,
        sizeBytes: file.size,
      });
    }
    setFiles((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(async (overrides?: { content?: string; attachments?: Attachment[] }) => {
    const trimmed = (overrides?.content ?? value).trim();
    const currentFiles = overrides?.attachments ?? files;
    const isResend = !!overrides;
    if ((!trimmed && currentFiles.length === 0) || isStreaming) return;

    const llmConfig = getActiveLlmConfig();
    if (!llmConfig) {
      setError("No model selected. Pick a model from the dropdown above.");
      return;
    }
    const models = getModels();
    const selectedModel = models.find((m) => m.id === selectedModelId);
    if (!selectedModel) { setError("Selected model not found."); return; }
    if (!llmConfig.apiKey) {
      setError(`No API key configured for ${selectedModel.providerId}. Add one in Settings.`);
      return;
    }

    setError(null);
    let convId = activeId;
    if (!convId) convId = createConversation();

    if (!isResend) {
      setValue("");
      setFiles([]);
      setContinueConversation(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }

    let displayContent = trimmed;
    const textFiles = currentFiles.filter((f) => f.mimeType.startsWith("text/") || f.mimeType === "application/json" || f.mimeType.endsWith("xml") || f.mimeType.endsWith("yaml") || f.mimeType === "application/javascript");
    const imageFiles = currentFiles.filter((f) => f.mimeType.startsWith("image/"));
    const otherFiles = currentFiles.filter((f) => !textFiles.includes(f) && !imageFiles.includes(f));

    for (const tf of textFiles) {
      try {
        const resp = await fetch(tf.dataUrl);
        const text = await resp.text();
        displayContent += (displayContent ? "\n\n" : "") + `[File: ${tf.filename}]\n${text}`;
      } catch { /* skip */ }
    }
    for (const of of otherFiles) {
      displayContent += (displayContent ? "\n" : "") + `[Attached: ${of.filename} (${(of.sizeBytes / 1024).toFixed(1)} KB)]`;
    }

    if (!isResend) {
      addMessage({ conversationId: convId, role: "user", content: displayContent, attachments: currentFiles.length > 0 ? currentFiles : undefined });
      logMessage(convId!, "user", displayContent, "");
      // Mark the conversation as "title pending" the moment the user sends so
      // the sidebar can show a shimmer instead of the placeholder "New chat".
      const convForTitle = useChatStore.getState().conversations.find((c) => c.id === convId);
      if (convForTitle && convForTitle.title === "New Conversation") {
        setTitleGenerating(convId!, true);
      }
    }

    const history = getActiveMessages();
    const currentWorkspace = useChatStore.getState().workspacePath;
    const isAgentMode = useChatStore.getState().agentMode;
    const activeTools = isAgentMode && currentWorkspace ? ALL_TOOLS : undefined;

    // Apply context compaction for long conversations
    const maxTokens = isAgentMode ? 8000 : 12000;
    const { messages: compactedMessages, compacted, summarizedCount, truncatedCount, toolsInlinedCount } =
      compactMessages(history, maxTokens, { stripTools: !activeTools });

    if (compacted && (summarizedCount > 0 || truncatedCount > 0)) {
      if (summarizedCount > 0) {
        console.log(`[context] Summarized ${summarizedCount} earlier messages.`);
      }
      if (truncatedCount > 0) {
        console.log(`[context] Truncated ${truncatedCount} oversized tool outputs.`);
      }
      if (toolsInlinedCount > 0) {
        console.log(`[context] Inlined tool results from ${toolsInlinedCount} messages for non-tool model.`);
      }
    }

    const llmMessages = compactedMessages.map((m) => {
      if (m.role === "user" && typeof m.content === "string") {
        // Re-attach images from the original message if present
        const origMsg = history.find((h) => h.role === "user" && h.content === m.content);
        const imgs = origMsg?.attachments?.filter((a) => a.mimeType.startsWith("image/")) ?? [];
        if (imgs.length > 0) {
          const parts: LlmContentPart[] = [];
          for (const img of imgs) parts.push({ type: "image", image: img.dataUrl, mimeType: img.mimeType });
          if (m.content.trim()) parts.unshift({ type: "text", text: m.content as string });
          return { role: "user" as const, content: parts };
        }
      }
      return { role: m.role as "user" | "assistant" | "system", content: m.content };
    });

    const ac = new AbortController();
    startStreaming(convId!, ac);

    const assistantMsg = addMessage({ conversationId: convId, role: "assistant", content: "", isStreaming: true });
    logMessage(convId!, "assistant", "", assistantMsg.id);

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
    const userPrompt = conv?.systemPrompt || "";

    const systemPrompt = isAgentMode
      ? (() => {
          const dynamicPrompt = buildAgentSystemPrompt({ tools: getGoatLLMToolInfo(), workspacePath: currentWorkspace });
          return userPrompt ? `${dynamicPrompt}\n\n<user_system_prompt>\n${userPrompt}\n</user_system_prompt>` : dynamicPrompt;
        })()
      : buildChatSystemPrompt(userPrompt);

    const handleToolCall = (tc: ToolCallInfo) => {
      const writeTool = isWriteTool(tc.toolName);
      const entry: ToolCallEntry = {
        toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input,
        state: writeTool ? "pending_approval" : "running",
      };
      if (tc.toolName === "exec_command" || tc.toolName === "bash") {
        const input = tc.input as { command?: string } | undefined;
        if (input?.command) {
          const classification = classifyCommand(input.command);
          if (classification.level !== "safe") {
            entry.dangerLevel = classification.level;
            entry.dangerReason = classification.reason;
          }
        }
      }
      addToolCallToMessage(convId!, assistantMsg.id, entry);
      logToolCall(convId!, tc.toolCallId, tc.toolName, tc.input);
    };

    const handleToolResult = (tr: ToolResultInfo) => {
      completeToolCall(convId!, assistantMsg.id, tr.toolCallId, tr.output);
      logToolResult(convId!, tr.toolCallId, tr.toolName, tr.output);
    };

    await streamChat(llmMessages, systemPrompt, llmConfig, {
      onToken: (chunk) => appendToMessage(convId!, assistantMsg.id, chunk),
      onToolCall: handleToolCall,
      onToolResult: handleToolResult,
      onDone: (fullText) => {
        const currentContent = useChatStore.getState().messages[convId!]?.find((m) => m.id === assistantMsg.id)?.content || "";
        updateMessage(convId!, assistantMsg.id, { content: fullText || currentContent, isStreaming: false });
        stopStreaming(convId!);
        // If stream was interrupted with partial content, show Continue button
        if (!fullText && currentContent.trim()) {
          setContinueConversation(convId!);
        }
        // Auto-detect artifacts in completed messages
        const finalContent = fullText || currentContent;
        if (finalContent.trim()) {
          detectArtifacts(convId!, assistantMsg.id, finalContent);
        }
        // Always read the latest conversation from the store — the closure-
        // captured `conversations` array can be stale by the time onDone fires.
        const latestConv = useChatStore.getState().conversations.find((c) => c.id === convId);
        if (latestConv && latestConv.title === "New Conversation") {
          const config = getActiveLlmConfig();
          const reply = (fullText || currentContent || "").trim();
          const userExcerpt = displayContent.slice(0, 600);

          const applyTitle = (title: string) => {
            const safe = title.trim();
            if (safe) renameConversation(convId!, safe);
            else setTitleGenerating(convId!, false);
          };

          if (config) {
            generateTitle(userExcerpt, config, reply)
              .then((title) => applyTitle(title || heuristicTitle(displayContent)))
              .catch(() => applyTitle(heuristicTitle(displayContent)));
          } else {
            // No model configured — still don't leave it as "New Conversation".
            applyTitle(heuristicTitle(displayContent));
          }
        }
      },
      onError: (err) => {
        updateMessage(convId!, assistantMsg.id, { content: `Error: ${err.message}`, isStreaming: false });
        stopStreaming(convId!);
        logError(convId!, err.message, "streaming");
        setError(err.message);
      },
    }, { abortSignal: ac.signal, tools: activeTools });
  }, [value, files, isStreaming, activeId, selectedModelId,
    addMessage, startStreaming, stopStreaming, appendToMessage, updateMessage,
    createConversation, getActiveMessages, getActiveLlmConfig, getModels,
    renameConversation, setTitleGenerating, conversations,
    addToolCallToMessage, completeToolCall]);

  useEffect(() => {
    if (!resendPayload) return;
    if (resendPayload.conversationId !== activeId) { clearResend(); return; }
    clearResend();
    handleSend({ content: resendPayload.content, attachments: resendPayload.attachments });
  }, [resendPayload, activeId, clearResend, handleSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const showContinue = !!activeId && continueConversationId === activeId && !isStreaming;

  const handleContinue = useCallback(() => {
    if (!activeId) return;
    setContinueConversation(null);
    // Re-send with empty user message — the model will see the partial response and continue
    handleSend({ content: "continue" });
  }, [activeId, handleSend, setContinueConversation]);

  const canSend = (value.trim().length > 0 || files.length > 0) && !isStreaming && !showContinue;

  const handleToggleMic = useCallback(() => {
    if (speech.listening) {
      speech.stop();
    } else {
      speech.start();
    }
  }, [speech]);

  return (
    <div className="w-full max-w-[720px]">
      <div className="relative w-full rounded-[24px] bg-[#2d2d2d] border border-white/5 p-5 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)] transition-all duration-200 focus-within:border-white/15 focus-within:shadow-[0_18px_50px_-14px_rgba(0,0,0,0.7),0_0_0_4px_rgba(245,158,66,0.06)] focus-within:-translate-y-px">
        {error && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[13px] text-[#f87171]">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="p-1 rounded hover:bg-red-500/10" aria-label="Dismiss error">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="1" y1="1" x2="11" y2="11" /><line x1="11" y1="1" x2="1" y2="11" />
              </svg>
            </button>
          </div>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 border border-white/5 rounded-md text-[12px] text-[#b4b4b4] max-w-[240px]">
                <span className="truncate">{f.filename}</span>
                <button onClick={() => handleRemoveFile(i)} className="p-0.5 rounded hover:text-[#f87171] text-[#a0a0a0]" aria-label={`Remove ${f.filename}`}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <line x1="1" y1="1" x2="11" y2="11" /><line x1="11" y1="1" x2="1" y2="11" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label="Message input"
          placeholder={speech.listening ? "Listening…" : isStreaming ? "Type your next message…" : noModelsAvailable ? "Add a provider in Settings to begin" : "Do anything"}
          className="w-full min-h-[40px] max-h-[180px] bg-transparent text-[16px] text-[#ececec] placeholder:text-[#a0a0a0] resize-none focus:outline-none leading-relaxed"
        />

        {showContinue && (
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleContinue}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#f59e42]/10 border border-[#f59e42]/20 text-[#f59e42] text-[12.5px] font-medium hover:bg-[#f59e42]/20 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="4,2 14,8 4,14" />
              </svg>
              Continue generating
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center gap-3">
            {/* + menu */}
            <div className="relative">
              <button
                onClick={() => setShowPlusMenu((s) => !s)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#c9c9c9]"
                aria-label="Attach or add"
                aria-expanded={showPlusMenu}
              >
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              {showPlusMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowPlusMenu(false)} />
                  <div className="absolute bottom-full left-0 mb-2 w-52 bg-[#2a2a2a] border border-white/10 rounded-xl p-1.5 shadow-xl z-20">
                    {[
                      { icon: Upload, label: "Upload file", onClick: () => { setShowPlusMenu(false); handleAttach(); } },
                      { icon: FileText, label: "Paste from clipboard", onClick: () => setShowPlusMenu(false) },
                      { icon: Link2, label: "Add URL", onClick: () => setShowPlusMenu(false) },
                      { icon: Camera, label: "Screenshot", onClick: () => setShowPlusMenu(false) },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        onClick={opt.onClick}
                        className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-[13px] text-[#d5d5d5] hover:bg-white/5"
                      >
                        <opt.icon size={14} strokeWidth={1.75} className="text-[#c9c9c9]" />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFilesChange}
              multiple
              tabIndex={-1}
            />

            {/* Mic button */}
            {showMic && (
            <button
              onClick={handleToggleMic}
              className={`p-1.5 rounded-md hover:bg-white/5 transition-colors ${
                speech.listening
                  ? "text-[#f59e42] bg-white/5"
                  : "text-[#888888]"
              }`}
              aria-label={speech.listening ? "Stop dictation" : "Start dictation"}
              aria-pressed={speech.listening}
              title={speech.listening ? "Stop listening" : "Dictate"}
            >
              {speech.listening ? (
                <StopCircle size={15} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Mic size={15} strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
            )}

            <AgentPill />
          </div>

          <div className="flex items-center gap-1 text-[13px]">
            <ModelPicker />

            <button
              onClick={isStreaming ? cancelStreaming : () => handleSend()}
              disabled={!canSend && !isStreaming}
              aria-label={isStreaming ? "Stop generating" : "Send message"}
              className={`ml-1 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
                isStreaming
                  ? "bg-[#ececec] hover:bg-white scale-100"
                  : !canSend
                    ? "bg-[#3a3a3a] cursor-not-allowed scale-95 opacity-70"
                    : "bg-[#f59e42] hover:bg-[#f0903a] shadow-[0_4px_14px_-4px_rgba(245,158,66,0.55)] hover:shadow-[0_6px_18px_-4px_rgba(245,158,66,0.7)] hover:scale-[1.04] active:scale-95"
              }`}
            >
              {isStreaming ? (
                <Square size={11} strokeWidth={2.5} className="text-[#2d2d2d]" aria-hidden="true" />
              ) : (
                <ArrowUp size={16} strokeWidth={2.4} className={canSend ? "text-[#1a1a1c]" : "text-[#a0a0a0]"} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
