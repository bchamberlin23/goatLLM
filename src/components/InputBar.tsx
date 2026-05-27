import { useState, useRef, useCallback, useEffect, KeyboardEvent, ClipboardEvent } from "react";
import type { ToolSet } from "ai";
import { useChatStore, Attachment, NEW_CHAT_DRAFT_KEY, type ToolCallEntry } from "../stores/chat";
import { streamChat, generateTitle, heuristicTitle, LlmContentPart, type ToolCallInfo, type ToolResultInfo } from "../lib/llm";
import { ALL_TOOLS, RESEARCH_TOOLS, CHAT_TOOLS, PLAN_TOOLS, isWriteTool } from "../lib/tools";
import { classifyCommand } from "../lib/command-safety";
import { buildAgentSystemPrompt, buildChatSystemPrompt } from "../lib/system-prompt";
import { buildDesignSystemPrompt } from "../lib/design/prompt";
import { splitContentByArtifacts } from "../lib/artifact-segments";
import { formatSkillsForPrompt } from "../lib/skills";
import { loadProjectContext } from "../lib/project-context";
import { logMessage, logToolCall, logToolResult, logError } from "../lib/event-log";
import { compactMessages, summarizeWithLlm } from "../lib/context-manager";
import { extractAndAppend } from "../lib/attachment-extract";
import { fetchNewUrlsFromProse } from "../lib/url-fetch";
import { isLikelyScannedPdf } from "../lib/attachment-cache";
import { loadPromptTemplates, expandPromptTemplate, type PromptTemplate } from "../lib/prompt-templates";
import { readSkillFile } from "../lib/skills";
import { startJjAgentSession, endJjAgentSession } from "../lib/jjagent";
import { invoke } from "@tauri-apps/api/core";

/**
 * Per-conversation cache of high-quality LLM-generated summaries. We swap
 * the extractive summary for the LLM one once it lands. Lives in module
 * scope so it survives re-renders without polluting the persisted store.
 */
const llmSummaryCache = new Map<string, string>();
const llmSummaryInflight = new Set<string>();
const EMPTY_SKILLS: string[] = [];

/**
 * Per-workspace cache of slash-command prompt templates. Loaded once when
 * the workspace is set and refreshed on send if the cache is empty. Avoids
 * re-reading every message.
 */
const promptTemplateCache = new Map<string, PromptTemplate[]>();
async function getPromptTemplates(workspace: string | null | undefined): Promise<PromptTemplate[]> {
  if (!workspace) return [];
  const cached = promptTemplateCache.get(workspace);
  if (cached) return cached;
  const fresh = await loadPromptTemplates(workspace).catch(() => [] as PromptTemplate[]);
  promptTemplateCache.set(workspace, fresh);
  return fresh;
}

/**
 * Inline a skill's SKILL.md into the user message so the model has the full
 * instructions even when it can't use tools (chat mode) or when the skill
 * lives outside the workspace (which is always, since skills live in
 * `~/.goat/agent/skills/`). Pi handles this by progressive disclosure via
 * `read`; goatLLM does it by inlining at send time.
 *
 * Returns the expanded text, or empty string if the skill couldn't be found.
 */
/**
 * Read a skill's SKILL.md so it can be injected into the conversation
 * system prompt. Returns null if the skill isn't discovered or its file
 * can't be read.
 */
async function getSkillBody(name: string): Promise<{ name: string; filePath: string; body: string } | null> {
  const skill = useChatStore.getState().discoveredSkills.find((s) => s.name === name);
  if (!skill) return null;
  try {
    const body = await readSkillFile(skill.filePath);
    return { name: skill.name, filePath: skill.filePath, body };
  } catch {
    return null;
  }
}
import { ModelPicker } from "./ModelPicker";
import { AgentPill } from "./AgentPill";
import { DesignPills } from "./design/DesignPills";
import {
  Plus,
  Upload,
  FileText,
  FileAudio,
  Mic,
  ArrowUp,
  StopCircle,
  Square,
  Image as ImageIcon,
  FileCode,
  File,
  FileSpreadsheet,
  FileArchive,
  X,
  Check,
  Wand2,
  Sparkles,
  ListChecks,
  Telescope,
} from "lucide-react";
import { useSpeechToText } from "../lib/speech";

// ── File type icon helper ──

function getFileIcon(mimeType: string, filename = "") {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.startsWith("audio/") || /^(mp3|m4a|wav|flac|ogg|aac|webm)$/.test(ext)) return FileAudio;
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.endsWith("xml") || mimeType.endsWith("yaml") || mimeType === "application/javascript") return FileCode;
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("excel") || ext === "xlsx" || ext === "xls" || ext === "csv") return FileSpreadsheet;
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("gzip") || mimeType.includes("rar") || mimeType.includes("7z")) return FileArchive;
  if (
    mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("word") || mimeType.includes("presentation") ||
    ext === "pdf" || ext === "docx" || ext === "doc" || ext === "pptx" || ext === "ppt" || ext === "rtf" || ext === "ipynb"
  ) return FileText;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtColor(mimeType: string, filename = ""): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType.startsWith("image/")) return "#a78bfa"; // purple
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.includes("javascript")) return "#60a5fa"; // blue
  if (mimeType.includes("pdf") || ext === "pdf") return "#f87171"; // red
  if (mimeType.includes("word") || ext === "docx" || ext === "doc") return "#3b82f6"; // blue
  if (mimeType.includes("presentation") || ext === "pptx" || ext === "ppt") return "#fb923c"; // orange
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("excel") || ext === "xlsx" || ext === "xls" || ext === "csv") return "#34d399"; // green
  if (ext === "ipynb") return "#f59e0b"; // jupyter amber
  if (ext === "rtf") return "#94a3b8";
  if (mimeType.includes("zip") || mimeType.includes("tar")) return "#fbbf24"; // yellow
  return "#a0a0a0"; // gray
}

/** Convert a list of File objects to Attachment[] */
async function filesToAttachments(fileList: File[]): Promise<Attachment[]> {
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const results: Attachment[] = [];
  for (const file of fileList) {
    if (file.size > MAX_FILE_SIZE) continue;
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    results.push({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      dataUrl,
      sizeBytes: file.size,
    });
  }
  return results;
}

export function InputBar({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
  const activeId = useChatStore((s) => s.activeId);
  const focusNonce = useChatStore((s) => s.focusNonce);
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const addToolCallToMessage = useChatStore((s) => s.addToolCallToMessage);
  const completeToolCall = useChatStore((s) => s.completeToolCall);
  const updateToolCallState = useChatStore((s) => s.updateToolCallState);
  const finalizeStuckToolCalls = useChatStore((s) => s.finalizeStuckToolCalls);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const appendToMessage = useChatStore((s) => s.appendToMessage);
  const appendToThinking = useChatStore((s) => s.appendToThinking);
  const createConversation = useChatStore((s) => s.createConversation);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const getActiveMessages = useChatStore((s) => s.getActiveMessages);
  const getActiveLlmConfig = useChatStore((s) => s.getActiveLlmConfig);
  const getModels = useChatStore((s) => s.getModels);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const setTitleGenerating = useChatStore((s) => s.setTitleGenerating);
  const conversations = useChatStore((s) => s.conversations);
  const cancelStreaming = useChatStore((s) => s.cancelStreaming);
  const detectArtifacts = useChatStore((s) => s.detectArtifacts);
  const streamArtifactDelta = useChatStore((s) => s.streamArtifactDelta);
  const finalizeStreamingArtifacts = useChatStore((s) => s.finalizeStreamingArtifacts);
  const resendPayload = useChatStore((s) => s.resendPayload);
  const clearResend = useChatStore((s) => s.clearResend);
  const enqueueMessage = useChatStore((s) => s.enqueueMessage);
  const dequeueMessage = useChatStore((s) => s.dequeueMessage);
  const steerPayload = useChatStore((s) => s.steerPayload);
  const setSteerPayload = useChatStore((s) => s.setSteerPayload);
  // Reactive subscriptions for the skills picker so it updates when the
  // skill list refreshes mid-session (e.g. after the seed completes or the
  // user adds a custom skill path in Settings).
  const discoveredSkills = useChatStore((s) => s.discoveredSkills);
  const disabledSkills = useChatStore((s) => s.disabledSkills);
  const setConversationSkills = useChatStore((s) => s.setConversationSkills);
  // Pi/Claude skills assume tool access; gate them to agent mode. Skills
  // marked `chat` or `both` show up in either mode.
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const skillsForCurrentMode = discoveredSkills.filter((s) => {
    if (s.mode === "both") return true;
    return agentMode ? s.mode === "agent" : s.mode === "chat";
  });
  // Per-conversation active skills: lives on the conversation row so it
  // survives reloads and switches with the chat.
  const activeSkillNames = useChatStore((s) => {
    if (!s.activeId) return EMPTY_SKILLS;
    return s.conversations.find((c) => c.id === s.activeId)?.activeSkillNames ?? EMPTY_SKILLS;
  });

  // Plan mode — agent-only. When on, the agent runs read-only tools to
  // produce a build plan. The MessageBubble surfaces a Build button when
  // the plan finishes streaming so the user can flip into write mode.
  const planMode = useChatStore((s) => s.planMode);
  const setPlanMode = useChatStore((s) => s.setPlanMode);
  // Research mode lives in the + menu now (used to be a top-bar toggle).
  // It's one-shot — the toggle resets after the first send (see handleSend).
  const researchMode = useChatStore((s) => s.researchMode);
  const toggleResearchMode = useChatStore((s) => s.toggleResearchMode);
  const tavilyApiKey = useChatStore((s) => s.tavilyApiKey);
  const freeWebSearch = useChatStore((s) => s.freeWebSearch);

  const [error, setError] = useState<string | null>(null);
  // Per-conversation draft (text + staged attachments). Keyed by activeId, or
  // a sentinel for the "no active conversation" state so visiting an old
  // chat and bouncing back to New chat doesn't blow away what the user was
  // already composing.
  const draftKey = activeId ?? NEW_CHAT_DRAFT_KEY;
  const draft = useChatStore((s) => s.drafts[draftKey]);
  const value = draft?.content ?? "";
  const files = draft?.attachments ?? [];
  const setDraftContent = useChatStore((s) => s.setDraftContent);
  const setDraftAttachments = useChatStore((s) => s.setDraftAttachments);
  const appendDraftAttachments = useChatStore((s) => s.appendDraftAttachments);
  const clearDraft = useChatStore((s) => s.clearDraft);
  const setValue = useCallback(
    (next: string | ((cur: string) => string)) => {
      const k = useChatStore.getState().activeId ?? NEW_CHAT_DRAFT_KEY;
      const cur = useChatStore.getState().drafts[k]?.content ?? "";
      const resolved = typeof next === "function" ? next(cur) : next;
      setDraftContent(k, resolved);
    },
    [setDraftContent],
  );
  const setFiles = useCallback(
    (next: Attachment[] | ((cur: Attachment[]) => Attachment[])) => {
      const k = useChatStore.getState().activeId ?? NEW_CHAT_DRAFT_KEY;
      const cur = useChatStore.getState().drafts[k]?.attachments ?? [];
      const resolved = typeof next === "function" ? next(cur) : next;
      setDraftAttachments(k, resolved);
    },
    [setDraftAttachments],
  );
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [pendingSkills, setPendingSkills] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Forward ref for handleSend so effects can call into it without
  // breaking the dependency array. Assigned just below the callback def.
  const handleSendRef = useRef<((overrides?: { content?: string; attachments?: Attachment[] }) => void) | null>(null);
  // Tracks the last artifact scan timestamp so we can throttle the full-content
  // splitContentByArtifacts regex to ~80ms during streaming.
  const artifactScanRef = useRef({ lastScan: 0 });

  // Auto-dismiss the error notice. Cancellations briefly flash then disappear;
  // real errors stick around longer in case the user wants to read them.
  useEffect(() => {
    if (!error) return;
    const isCancellation = /cancel|abort|stopped|interrupt/i.test(error);
    const ms = isCancellation ? 1500 : 6000;
    const t = setTimeout(() => setError(null), ms);
    return () => clearTimeout(t);
  }, [error]);

  // Consume files dropped anywhere on the window (via ChatView)
  const pendingDroppedFiles = useChatStore((s) => s.pendingDroppedFiles);
  const clearPendingDroppedFiles = useChatStore((s) => s.clearPendingDroppedFiles);

  // Consume design-mode question-form submissions. The form lives inside
  // the assistant message bubble; submitting it sets a pending payload
  // that we read and dispatch as a regular send.
  const pendingFormSubmission = useChatStore((s) => s.pendingFormSubmission);
  const setPendingFormSubmission = useChatStore((s) => s.setPendingFormSubmission);

  useEffect(() => {
    if (!pendingFormSubmission) return;
    if (pendingFormSubmission.conversationId !== activeId) return;
    const text = pendingFormSubmission.text;
    setPendingFormSubmission(null);
    // Persist the form submission as a user message so the model sees the
    // answers and so the turn counter increments (isFirstTurn → false).
    addMessage({
      conversationId: activeId,
      role: "user",
      content: text,
    });
    // Defer one tick so the state-clearing reaches the form before send.
    setTimeout(() => {
      handleSendRef.current?.({ content: text });
    }, 0);
  }, [pendingFormSubmission, activeId, setPendingFormSubmission, addMessage]);

  useEffect(() => {
    if (pendingDroppedFiles.length > 0) {
      const k = useChatStore.getState().activeId ?? NEW_CHAT_DRAFT_KEY;
      appendDraftAttachments(k, pendingDroppedFiles);
      clearPendingDroppedFiles();
      textareaRef.current?.focus();
    }
  }, [pendingDroppedFiles, clearPendingDroppedFiles, appendDraftAttachments]);

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

  const handleAttach = useCallback(() => fileInputRef.current?.click(), []);

  const handleFilesChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    const newAttachments = await filesToAttachments(Array.from(selectedFiles));
    if (newAttachments.length < (selectedFiles?.length ?? 0)) {
      setError("One or more files exceeded the 50MB limit.");
    }
    setFiles((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Paste support ──

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }

    if (pastedFiles.length === 0) return;

    // Prevent the default paste behavior for files (don't insert text)
    e.preventDefault();

    const newAttachments = await filesToAttachments(pastedFiles);
    if (newAttachments.length < pastedFiles.length) {
      setError("One or more pasted files exceeded the 50MB limit.");
    }
    setFiles((prev) => [...prev, ...newAttachments]);
  }, []);

  const handleSend = useCallback(async (overrides?: { content?: string; attachments?: Attachment[] }) => {
    const rawTrimmed = (overrides?.content ?? value).trim();
    const currentFiles = overrides?.attachments ?? files;
    const isResend = !!overrides;
    if (!rawTrimmed && currentFiles.length === 0) return;

    // Agent mode: enqueue instead of blocking while streaming
    if (isStreaming) {
      const k = useChatStore.getState().activeId ?? NEW_CHAT_DRAFT_KEY;
      if (useChatStore.getState().agentMode && rawTrimmed && activeId) {
        enqueueMessage(activeId, rawTrimmed);
        clearDraft(k);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        return;
      }
      // Non-agent mode: block
      return;
    }

    const llmConfig = getActiveLlmConfig();
    if (!llmConfig) {
      setError("No model selected. Pick a model from the dropdown above.");
      return;
    }
    const models = getModels();
    const selectedModel = models.find((m) => m.id === selectedModelId);
    if (!selectedModel) { setError("Selected model not found."); return; }
    if (!llmConfig.apiKey && selectedModel.providerId !== "ollama" && selectedModel.providerId !== "lmstudio") {
      setError(`No API key configured for ${selectedModel.providerId}. Add one in Settings.`);
      return;
    }

    setError(null);
    let convId = activeId;
    const startingDraftKey = convId ?? NEW_CHAT_DRAFT_KEY;
    if (!convId) {
      convId = createConversation();
      if (pendingSkills.length > 0) {
        setConversationSkills(convId, pendingSkills);
        setPendingSkills([]);
      }
    }

    // Slash command: /skill:name [optional message].
    // Switches the conversation's active skill (persists across sends) and
    // strips the command prefix from the message. If only `/skill:name` is
    // sent with no body, the next turn carries the skill instructions in
    // the system prompt and a tiny note as the user message.
    const ws = useChatStore.getState().workspacePath;
    let trimmed = rawTrimmed;
    const skillCmd = trimmed.match(/^\/skill:([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/);
    if (skillCmd) {
      const reqName = skillCmd[1];
      const matched = useChatStore.getState().discoveredSkills.find((s) => s.name === reqName);
      if (matched) {
        const fits =
          matched.mode === "both" ||
          (useChatStore.getState().agentMode ? matched.mode === "agent" : matched.mode === "chat");
        if (!fits) {
          setError(
            `Skill "${reqName}" is ${matched.mode}-mode only. ${
              matched.mode === "agent" ? "Switch on Agent mode to use it." : "Switch off Agent mode to use it."
            }`,
          );
          return;
        }
        setConversationSkills(convId!, [reqName]);
        trimmed = (skillCmd[2] ?? "").trim();
        if (!trimmed) trimmed = `Apply the "${reqName}" skill from now on.`;
      }
    }

    // Prompt-template expansion (e.g. /review, /ship). Skipped when the
    // line is a /skill: command — those are handled above.
    if (trimmed.startsWith("/") && !trimmed.startsWith("/skill:") && ws) {
      const tpls = await getPromptTemplates(ws);
      if (tpls.length > 0) {
        const expanded = expandPromptTemplate(trimmed, tpls);
        if (expanded !== trimmed) trimmed = expanded;
      }
    }

    if (!isResend) {
      clearDraft(startingDraftKey);
      // If a brand-new conversation was just created from the "new chat"
      // draft, also clear the conversation-keyed slot in case anything
      // raced into it.
      if (startingDraftKey !== convId) clearDraft(convId!);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }

    let displayContent = trimmed;
    // OCR fallback: when the active model isn't vision-capable, the AI SDK
    // strips image parts on send (or providers reject them). Offer the user
    // a way to read whiteboard photos / homework photos anyway by OCR-ing
    // images server-side and inlining the text alongside the original
    // attachment chips. Best-effort — if Tesseract isn't installed we keep
    // the existing behavior and surface the install hint inline.
    const activeModelObj = getModels().find((m) => m.id === selectedModelId);
    const modelIsVision = !!activeModelObj?.vision;
    const imageAttachments = currentFiles.filter((f) => f.mimeType.startsWith("image/"));
    if (!modelIsVision && imageAttachments.length > 0) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const tesseractAvailable = await invoke<boolean>("ocr_available").catch(() => false);
        if (tesseractAvailable) {
          const { putAttachmentText } = await import("../lib/attachment-cache");
          for (const img of imageAttachments) {
            try {
              const ocrText = await invoke<string>("ocr_image", { dataUrl: img.dataUrl });
              if (ocrText.trim()) {
                displayContent += (displayContent ? "\n\n" : "") +
                  `[Image OCR: ${img.filename}]\n${ocrText.trim()}`;
                if (convId) {
                  putAttachmentText(convId, img.filename, "Image OCR", ocrText.trim());
                }
              }
            } catch (e) {
              const reason = e instanceof Error ? e.message : String(e);
              displayContent += (displayContent ? "\n\n" : "") +
                `[Image: ${img.filename}] (OCR failed: ${reason}; switch to a vision model to read this image directly.)`;
            }
          }
        } else {
          // No tesseract; surface a single hint rather than a per-image one
          // so the chat doesn't spam the user.
          displayContent += (displayContent ? "\n\n" : "") +
            `[Heads up] You attached ${imageAttachments.length} image${imageAttachments.length === 1 ? "" : "s"} but "${activeModelObj?.name ?? selectedModelId}" is text-only. Switch to a vision model (e.g. Claude, GPT-4o, Gemini) to read images directly, or install Tesseract (\`brew install tesseract\`) to enable OCR.`;
        }
      } catch {
        // Tauri bridge unavailable (browser-mode dev?) — ignore silently;
        // the AI SDK will drop the image and the model will respond as best
        // it can.
      }
    }
    displayContent = await extractAndAppend(displayContent, currentFiles, convId);

    // Auto-fetch URLs and YouTube links the user typed in their message.
    // Each unique URL gets its readable text inlined as `[Web: ...]` or
    // `[YouTube: ...]` and cached so subsequent turns can navigate it via
    // read_attachment. Fetched once per conversation per URL.
    if (convId) {
      try {
        const fetched = await fetchNewUrlsFromProse(trimmed, convId);
        if (fetched.length > 0) {
          const { putAttachmentText } = await import("../lib/attachment-cache");
          for (const f of fetched) {
            const cacheKey = f.label === "YouTube" ? `${f.title} (${f.url})` : f.url;
            putAttachmentText(convId, cacheKey, f.label, f.body);
            displayContent += (displayContent ? "\n\n" : "") +
              `[${f.label}: ${f.title}]\n${f.url}\n\n${f.body}`;
          }
        }
      } catch {
        // URL auto-fetch is a nice-to-have; never block sending if it fails.
      }
    }

    if (!isResend) {
      // Auto-pin messages that carry non-trivial attachments. Without this,
      // a 30KB PDF extraction can fall out of the recency budget on the next
      // turn and the model loses the body — the summary only keeps the first
      // 200 chars of the user prose. Pinning survives compaction.
      const hasHeavyAttachment =
        currentFiles.length > 0 &&
        currentFiles.some((f) => f.sizeBytes > 4 * 1024 || /\.(pdf|docx|pptx|xlsx|ipynb|rtf)$/i.test(f.filename));
      addMessage({
        conversationId: convId,
        role: "user",
        content: displayContent,
        attachments: currentFiles.length > 0 ? currentFiles : undefined,
        pinned: hasHeavyAttachment || undefined,
      });
      logMessage(convId!, "user", displayContent, "");
      // Mark the conversation as "title pending" the moment the user sends so
      // the sidebar can show a shimmer instead of the placeholder "New chat".
      const convForTitle = useChatStore.getState().conversations.find((c) => c.id === convId);
      if (convForTitle && convForTitle.title === "New Conversation") {
        setTitleGenerating(convId!, true);
        // Kick off title generation in parallel with the LLM stream so the
        // sidebar shows a real title within a second or two instead of waiting
        // for the full assistant reply to finish.
        const titleConfig = getActiveLlmConfig();
        const userExcerpt = displayContent.slice(0, 600);
        const applyEarlyTitle = (title: string) => {
          // The user (or a later auto-title pass) may have already renamed
          // this conversation while we were waiting on the title model — only
          // overwrite if it's still the placeholder.
          const latest = useChatStore.getState().conversations.find((c) => c.id === convId);
          if (!latest || latest.title !== "New Conversation") {
            setTitleGenerating(convId!, false);
            return;
          }
          const safe = title.trim();
          if (safe) renameConversation(convId!, safe);
          else setTitleGenerating(convId!, false);
        };
        if (titleConfig) {
          generateTitle(userExcerpt, titleConfig)
            .then((title) => applyEarlyTitle(title || heuristicTitle(displayContent)))
            .catch(() => applyEarlyTitle(heuristicTitle(displayContent)));
        } else {
          applyEarlyTitle(heuristicTitle(displayContent));
        }
      }
    }

    const history = getActiveMessages();
    const currentWorkspace = useChatStore.getState().workspacePath;
    const designWorkspace = useChatStore.getState().designWorkspacePath;
    const isAgentMode = useChatStore.getState().agentMode;
    const isDesignMode = useChatStore.getState().designMode;
    const isPlanMode = isAgentMode && useChatStore.getState().planMode;
    // Research mode is one-shot: we snapshot the toggle at send time and
    // immediately flip it off so the indicator resets in the UI. Anything
    // downstream in this turn (tool selection, system prompt, max rounds)
    // uses the captured value so the request the user just sent still
    // gets the research treatment.
    const isResearchMode = useChatStore.getState().researchMode;
    if (isResearchMode) {
      useChatStore.getState().setResearchMode(false);
    }
    const hasTavilyKey = !!useChatStore.getState().tavilyApiKey;
    const hasFreeWebSearch = useChatStore.getState().freeWebSearch;
    const hasWebSearch = hasTavilyKey || hasFreeWebSearch;
    // Cached attachments unlock the read_attachment / search_attachment tools
    // even in plain chat with no web backend, so the model can navigate a
    // 600-page book the user uploaded.
    const { hasAttachments } = await import("../lib/attachment-cache");
    const hasAttachmentCache = !!convId && hasAttachments(convId);
    const { ATTACHMENT_TOOLS, CODE_EXEC_TOOLS } = await import("../lib/tools");
    const chatCodeExec = useChatStore.getState().chatCodeExec;
    // Agent mode → full workspace tool set, OR read-only plan subset when
    // plan mode is on. Design mode with a workspace → full tools so the
    // design agent can read/write/edit files and run commands.
    // Chat + research → web tools (+ attachment tools).
    // Plain chat with web backend → web_search + attachment tools.
    // Plain chat without web → attachment tools only when there's something
    // cached to navigate. Code-exec tools are mixed in for chat mode when the
    // user has opted in via Settings (off by default).
    let activeTools: ToolSet | undefined =
      isAgentMode && currentWorkspace
        ? (isPlanMode ? PLAN_TOOLS : ALL_TOOLS)
        : isDesignMode && designWorkspace
          ? ALL_TOOLS
          : isResearchMode
            ? RESEARCH_TOOLS
            : hasWebSearch
              ? CHAT_TOOLS
              : hasAttachmentCache
                ? ATTACHMENT_TOOLS
                : undefined;
    if (!isAgentMode && !isDesignMode && chatCodeExec) {
      activeTools = { ...(activeTools ?? {}), ...CODE_EXEC_TOOLS } as ToolSet;
    }

    // Apply context compaction for long conversations
    // Budget: agent mode runs lots of tool turns so we keep it tighter.
    // Chat mode often gets full PDFs / lecture decks pasted in via attachment
    // extraction — give it room so a single paper doesn't trigger compaction
    // and lose the body. Sized for the lowest model the user targets (200K
    // context): 180K tokens leaves headroom for system prompt + reply.
    const maxTokens = (isAgentMode || (isDesignMode && designWorkspace)) ? 40_000 : 180_000;
    const compaction = compactMessages(history, maxTokens, { stripTools: !activeTools });
    const { compacted, summarizedCount, truncatedCount, toolsInlinedCount, droppedMessages } = compaction;

    // Swap the extractive summary placeholder for a cached LLM summary if
    // we have one for this conversation.
    let compactedMessages = compaction.messages;
    const cached = llmSummaryCache.get(convId!);
    if (cached && compaction.summaryMessageIndex !== undefined && compaction.summaryMessageIndex >= 0) {
      compactedMessages = compactedMessages.map((m, i) =>
        i === compaction.summaryMessageIndex ? { ...m, content: cached } : m,
      );
    }

    // Kick off an LLM summary in the background so the next turn picks it up.
    if (
      droppedMessages &&
      droppedMessages.length >= 4 &&
      !llmSummaryInflight.has(convId!) &&
      llmConfig
    ) {
      llmSummaryInflight.add(convId!);
      summarizeWithLlm(droppedMessages, llmConfig)
        .then((summary) => {
          if (summary && summary.length > 40) llmSummaryCache.set(convId!, summary);
        })
        .catch(() => { /* graceful fallback already applied inside summarizeWithLlm */ })
        .finally(() => llmSummaryInflight.delete(convId!));
    }

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
        // Re-attach native binary parts from the original message if present.
        // - Images go through every vision-capable provider.
        // - Scanned/empty-text PDFs go as native file parts to Anthropic
        //   (server-side OCR + layout); on other providers they fall back
        //   to the inlined `(no extractable text)` note plus a hint.
        const origMsg = history.find((h) => h.role === "user" && h.content === m.content);
        const imgs = origMsg?.attachments?.filter((a) => a.mimeType.startsWith("image/")) ?? [];
        const scannedPdfs =
          llmConfig.provider === "anthropic"
            ? (origMsg?.attachments?.filter((a) =>
                (a.mimeType === "application/pdf" || /\.pdf$/i.test(a.filename)) &&
                isLikelyScannedPdf(convId!, a.filename),
              ) ?? [])
            : [];
        if (imgs.length > 0 || scannedPdfs.length > 0) {
          const parts: LlmContentPart[] = [];
          for (const img of imgs) parts.push({ type: "image", image: img.dataUrl, mimeType: img.mimeType });
          for (const pdf of scannedPdfs) parts.push({ type: "file", data: pdf.dataUrl, mimeType: "application/pdf" });
          if (m.content.trim()) parts.unshift({ type: "text", text: m.content as string });
          return { role: "user" as const, content: parts };
        }
      }
      return { role: m.role as "user" | "assistant" | "system", content: m.content };
    });

    const ac = new AbortController();
    useChatStore.getState().resetWebSearchCount();
    startStreaming(convId!, ac);

    const assistantMsg = addMessage({ conversationId: convId, role: "assistant", content: "", isStreaming: true });
    logMessage(convId!, "assistant", "", assistantMsg.id);

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
    const userPrompt = conv?.systemPrompt || "";

    // Auto-load project-context files (GOAT.md / CLAUDE.md / AGENTS.md) so
    // the agent picks up project conventions on every turn. Cheap because
    // these are small and the read tool itself caches at the FS layer.
    const projectContextFiles = isAgentMode && currentWorkspace
      ? await loadProjectContext(currentWorkspace).catch(() => [])
      : (isDesignMode && designWorkspace)
        ? await loadProjectContext(designWorkspace).catch(() => [])
        : [];

    // If skills are bound to this conversation, fetch each SKILL.md so they
    // can be injected into the system prompt for this turn (and every turn
    // until the user toggles them off). This is the goatLLM equivalent of
    // pi's progressive-disclosure /skill mechanism.
    //
    // Skip injection when the bound skill's mode doesn't match the current
    // mode — e.g. an agent-only skill (filesystem editing) bound while in
    // chat mode silently drops out instead of giving the model bad advice.
    const activeSkillNamesForConv = useChatStore.getState().conversations.find((c) => c.id === convId)?.activeSkillNames ?? [];
    const activeSkillDatas: { name: string; filePath: string; body: string }[] = [];
    for (const sn of activeSkillNamesForConv) {
      const obj = useChatStore.getState().discoveredSkills.find((s) => s.name === sn) ?? null;
      if (!obj) continue;
      const matches = obj.mode === "both" ||
        (isAgentMode ? obj.mode === "agent" : obj.mode === "chat");
      if (!matches) continue;
      try {
        const body = await getSkillBody(sn);
        if (body) activeSkillDatas.push(body);
      } catch { /* skip */ }
    }
    const activeSkillBlock = activeSkillDatas.length > 0
      ? `\n<active_skills>\n${activeSkillDatas.map((s) => `<skill name="${s.name}" location="${s.filePath}">\n${s.body}\n</skill>`).join("\n")}\nThese skills are active for the rest of this conversation. Apply their instructions to every reply.\n</active_skills>\n`
      : "";

    // Auto-trigger skills: their full SKILL.md body is injected into every
    // system prompt so the model follows the instructions automatically
    // without needing to read the file itself.
    const autoTriggerNames = useChatStore.getState().autoTriggerSkills;
    const autoTriggerDatas: { name: string; filePath: string; body: string }[] = [];
    for (const sn of autoTriggerNames) {
      const obj = useChatStore.getState().discoveredSkills.find((s) => s.name === sn) ?? null;
      if (!obj) continue;
      const matches = obj.mode === "both" ||
        (isAgentMode ? obj.mode === "agent" : obj.mode === "chat");
      if (!matches) continue;
      // Skip if already in active skills (don't inject twice)
      if (activeSkillNamesForConv.includes(sn)) continue;
      try {
        const body = await getSkillBody(sn);
        if (body) autoTriggerDatas.push(body);
      } catch { /* skip */ }
    }
    const autoTriggerBlock = autoTriggerDatas.length > 0
      ? `\n<auto_trigger_skills>\n${autoTriggerDatas.map((s) => `<skill name="${s.name}" location="${s.filePath}">\n${s.body}\n</skill>`).join("\n")}\nThese skills auto-load every turn. Follow their instructions without re-reading them.\n</auto_trigger_skills>\n`
      : "";

    const systemPrompt = isDesignMode
      ? (() => {
          const s = useChatStore.getState();
          // First turn = the assistant message we just appended is the
          // first assistant turn for this conversation. Anything after the
          // discovery form coming back counts as a follow-up.
          const turns = (s.messages[convId!] ?? []).filter((m) => m.role === "user").length;
          return buildDesignSystemPrompt({
            skillId: s.activeSkillId,
            systemId: s.activeDesignSystemId,
            directionId: s.activeDirectionId,
            isFirstTurn: turns <= 1,
            userPrompt,
            hasWorkspace: !!designWorkspace,
            craftSections: ["typography", "color", "anti-ai-slop"],
          });
        })()
      : isAgentMode
      ? (() => {
          // Only include enabled skills that apply to agent mode.
          // Auto-trigger skills are excluded from available_skills —
          // their full body is injected directly so the model follows
          // them without needing to read the file.
          const allSkills = useChatStore.getState().discoveredSkills;
          const disabled = useChatStore.getState().disabledSkills;
          const autoTrigger = useChatStore.getState().autoTriggerSkills;
          const enabledSkills = allSkills.filter(
            (s) => !disabled.has(s.name) && !autoTrigger.has(s.name) && (s.mode === "agent" || s.mode === "both"),
          );
          const skillsBlock = enabledSkills.length > 0 ? formatSkillsForPrompt(enabledSkills) : "";

          const dynamicPrompt = buildAgentSystemPrompt({
            tools: activeTools ?? {},
            workspacePath: currentWorkspace,
            researchMode: isResearchMode,
            planMode: useChatStore.getState().planMode,
            projectContextFiles,
          });
          const prefix = userPrompt ? `${dynamicPrompt}\n\n<user_system_prompt>\n${userPrompt}\n</user_system_prompt>` : dynamicPrompt;
          let out = prefix;
          if (skillsBlock) out += `\n${skillsBlock}`;
          if (autoTriggerBlock) out += autoTriggerBlock;
          if (activeSkillBlock) out += activeSkillBlock;
          return out;
        })()
      : (() => {
          // Chat mode: only chat-compatible skills, drop agent-only ones.
          // Auto-trigger skills are excluded from available_skills —
          // their full body is injected directly.
          const allSkills = useChatStore.getState().discoveredSkills;
          const disabled = useChatStore.getState().disabledSkills;
          const autoTrigger = useChatStore.getState().autoTriggerSkills;
          const enabledSkills = allSkills.filter(
            (s) => !disabled.has(s.name) && !autoTrigger.has(s.name) && (s.mode === "chat" || s.mode === "both"),
          );
          const skillsBlock = enabledSkills.length > 0 ? formatSkillsForPrompt(enabledSkills) : "";
          const autoArtifacts = useChatStore.getState().autoArtifacts;
          const officeArtifacts = useChatStore.getState().officeArtifacts;
          const base = buildChatSystemPrompt(userPrompt, isResearchMode, hasWebSearch && !isResearchMode, {
            autoArtifacts,
            officeArtifacts,
          });
          let out = base;
          if (skillsBlock) out += `\n${skillsBlock}`;
          if (autoTriggerBlock) out += autoTriggerBlock;
          if (activeSkillBlock) out += activeSkillBlock;
          return out;
        })();

    const handleToolCall = (tc: ToolCallInfo) => {
      const writeTool = isWriteTool(tc.toolName);
      // Capture how much text content exists at this point for chronological interleaving
      const currentContent = useChatStore.getState().messages[convId!]?.find((m) => m.id === assistantMsg.id)?.content || "";
      const entry: ToolCallEntry = {
        toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input,
        state: writeTool && !isDesignMode ? "pending_approval" : "running",
        contentAtInvocation: currentContent.length,
      };
      // Suppress web_search pills beyond the hard cap — the tool returns an
      // error to the model but the user never sees a doomed search attempt.
      // Research mode is exempt from the cap (it has its own budget via stepCountIs).
      if (tc.toolName === "web_search" && !isResearchMode && useChatStore.getState().webSearchCount >= 2) {
        return;
      }
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

    const handleToolResult = async (tr: ToolResultInfo) => {
      completeToolCall(convId!, assistantMsg.id, tr.toolCallId, tr.output);
      logToolResult(convId!, tr.toolCallId, tr.toolName, tr.output);

      // Design mode: when an HTML file is written/edited, sync it as an
      // artifact so the preview panel shows it live.
      if (
        isDesignMode &&
        designWorkspace &&
        (tr.toolName === "write_file" || tr.toolName === "edit_file")
      ) {
        const input = tr.input as { path?: string } | undefined;
        const filePath =
          typeof input?.path === "string" ? input.path : "";
        if (filePath.endsWith(".html") || filePath.endsWith(".htm")) {
          try {
            const content = await invoke<string>("read_file", {
              workspace: designWorkspace,
              path: filePath,
            });
            const title =
              filePath
                .replace(/\.html?$/, "")
                .split("/")
                .pop() || filePath;
            useChatStore
              .getState()
              .upsertDesignArtifact(convId!, title, content);
          } catch {
            /* file read failed, skip */
          }
        }
      }
    };

    // Start jjagent isolation change if enabled and workspace is a jj repo.
    const jjagentEnabled = useChatStore.getState().jjagent;
    const jjWs = isDesignMode ? designWorkspace : currentWorkspace;
    if (jjagentEnabled && jjWs && (isAgentMode || isDesignMode)) {
      const historyMsgs = useChatStore.getState().messages[convId!];
      const turnIndex = (historyMsgs ?? []).filter((m) => m.role === "user").length;
      const session = await startJjAgentSession(jjWs, convId!, turnIndex);
      if (session) {
        useChatStore.getState().setJjAgentChangeId(session.changeId);
      }
    }

    const endJjAgentSessionIfNeeded = () => {
      const changeId = useChatStore.getState().jjagentChangeId;
      const s = useChatStore.getState();
      const ws = s.designMode ? s.designWorkspacePath : s.workspacePath;
      if (changeId && ws) {
        endJjAgentSession(ws, { changeId, startedAt: Date.now() });
        s.setJjAgentChangeId(null);
      }
    };

    await streamChat(llmMessages, systemPrompt, llmConfig, {
      onToken: (chunk) => {
        appendToMessage(convId!, assistantMsg.id, chunk);
        // Pipe any partial artifact bodies into the canvas for live code
        // preview. The artifact-fence regex scan is throttled to ~80ms so
        // it doesn't burn CPU on every token. Fence open/close lines (which
        // contain ```   ) trigger an immediate scan so the artifact panel
        // opens/closes at the right moment.
        const artifactScanNow = artifactScanRef.current.lastScan === 0 ||
          /```/.test(chunk) ||
          performance.now() - artifactScanRef.current.lastScan > 80;
        if (artifactScanNow) {
          artifactScanRef.current.lastScan = performance.now();
          const live = useChatStore.getState().messages[convId!]?.find((m) => m.id === assistantMsg.id);
          const content = live?.content || "";
          if (content.length > 0) {
            const segments = splitContentByArtifacts(content);
            let fenceIndex = 0;
            for (const seg of segments) {
              if (seg.type !== "artifact") continue;
              if (seg.code.length > 0) {
                streamArtifactDelta(
                  convId!,
                  assistantMsg.id,
                  seg.kind,
                  seg.title,
                  fenceIndex,
                  seg.code,
                );
              }
              fenceIndex++;
            }
          }
        }
      },
      onThinking: (chunk) => {
        appendToThinking(convId!, assistantMsg.id, chunk);
      },
      onToolCall: handleToolCall,
      onToolResult: handleToolResult,
      onDone: (fullText) => {
        // Any tool call still flagged "running" never got its result chunk
        // (stream ended early, abort, partial response, etc.) — flip it to
        // done so the UI stops shimmering "Reading…" forever.
        finalizeStuckToolCalls(convId!, assistantMsg.id);
        const currentMsg = useChatStore.getState().messages[convId!]?.find((m) => m.id === assistantMsg.id);
        const currentContent = currentMsg?.content || "";
        const finalContent = fullText || currentContent;
        const hasToolActivity = (currentMsg?.toolCalls?.length ?? 0) > 0;

        // Stopped before the model produced anything — drop the empty bubble
        // entirely so the chat looks like the turn never started.
        if (!finalContent.trim() && !hasToolActivity) {
          deleteMessage(convId!, assistantMsg.id);
          stopStreaming(convId!);
          endJjAgentSessionIfNeeded();
          return;
        }

        updateMessage(convId!, assistantMsg.id, { content: finalContent, isStreaming: false });
        stopStreaming(convId!);
        // Auto-detect artifacts in completed messages
        if (finalContent.trim()) {
          detectArtifacts(convId!, assistantMsg.id, finalContent);
        }
        // Any remaining streaming flags from this message clear here so
        // the canvas auto-flips from code to preview view.
        finalizeStreamingArtifacts(convId!, assistantMsg.id);
        // Title generation is kicked off when the user sends (see above), so
        // by the time we get here the conversation has usually been renamed
        // already. We just clear the shimmer flag if it somehow lingered.
        const latestConv = useChatStore.getState().conversations.find((c) => c.id === convId);
        if (latestConv && latestConv.isGeneratingTitle && latestConv.title !== "New Conversation") {
          setTitleGenerating(convId!, false);
        }
        // Squash jjagent change back into parent now that the turn is complete.
        endJjAgentSessionIfNeeded();
        // Auto-dispatch next queued message
        const next = dequeueMessage(convId!);
        if (next) {
          setSteerPayload({ conversationId: convId!, content: next.content });
        }
      },
      onError: (err) => {
        // If the user aborted, don't surface an error — onDone has already
        // handled cleanup (or we'll do it here as a safety net).
        if (ac.signal.aborted) {
          finalizeStuckToolCalls(convId!, assistantMsg.id);
          finalizeStreamingArtifacts(convId!, assistantMsg.id);
          const currentMsg = useChatStore.getState().messages[convId!]?.find((m) => m.id === assistantMsg.id);
          const currentContent = currentMsg?.content || "";
          const hasToolActivity = (currentMsg?.toolCalls?.length ?? 0) > 0;
          if (!currentContent.trim() && !hasToolActivity) {
            deleteMessage(convId!, assistantMsg.id);
          } else {
            updateMessage(convId!, assistantMsg.id, { content: currentContent, isStreaming: false });
          }
          stopStreaming(convId!);
          endJjAgentSessionIfNeeded();
          return;
        }
        finalizeStuckToolCalls(convId!, assistantMsg.id);
        finalizeStreamingArtifacts(convId!, assistantMsg.id);
        endJjAgentSessionIfNeeded();
        // Context-overflow gets dedicated UX: instead of a raw error string,
        // we surface a friendly banner with quick-action buttons. The model
        // dropdown still shows everything, but we steer the user toward
        // longer-context options and one-click history trimming.
        const isOverflow =
          (err as Error & { code?: string }).code === "context_overflow";
        if (isOverflow) {
          updateMessage(convId!, assistantMsg.id, {
            content: `⚠ Context overflow\n\nThis turn exceeded "${selectedModel?.name ?? selectedModelId}"'s context window. Try switching to a longer-context model from the picker, or trim earlier messages by deleting older turns.\n\n${err.message.split("\n")[0]}`,
            isStreaming: false,
          });
        } else {
          updateMessage(convId!, assistantMsg.id, { content: `Error: ${err.message}`, isStreaming: false });
        }
        stopStreaming(convId!);
        logError(convId!, err.message, "streaming");
        setError(isOverflow ? "Context window exceeded — see banner above." : err.message);
        endJjAgentSessionIfNeeded();
      },
    }, { abortSignal: ac.signal, tools: activeTools, maxToolRounds: isResearchMode ? 30 : isDesignMode ? 25 : undefined });
  }, [value, files, isStreaming, activeId, selectedModelId,
    addMessage, startStreaming, stopStreaming, appendToMessage, appendToThinking, updateMessage,
    createConversation, getActiveMessages, getActiveLlmConfig, getModels,
    renameConversation, setTitleGenerating, conversations,
    addToolCallToMessage, completeToolCall, updateToolCallState, finalizeStuckToolCalls,
    detectArtifacts, streamArtifactDelta, finalizeStreamingArtifacts,
    enqueueMessage, dequeueMessage, setSteerPayload, clearDraft]);

  // Keep the ref pointed at the latest handleSend so the question-form
  // effect (which fires from outside this component) doesn't see a stale
  // closure.
  handleSendRef.current = handleSend;

  useEffect(() => {
    if (!resendPayload) return;
    if (resendPayload.conversationId !== activeId) { clearResend(); return; }
    clearResend();
    handleSend({ content: resendPayload.content, attachments: resendPayload.attachments });
  }, [resendPayload, activeId, clearResend, handleSend]);

  useEffect(() => {
    if (!steerPayload) return;
    if (steerPayload.conversationId !== activeId) { setSteerPayload(null); return; }
    setSteerPayload(null);
    handleSend({ content: steerPayload.content });
  }, [steerPayload, activeId, setSteerPayload, handleSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const canSend = (value.trim().length > 0 || files.length > 0) && !noModelsAvailable && !!selectedModelId;

  const handleToggleMic = useCallback(() => {
    if (speech.listening) {
      speech.stop();
    } else {
      speech.start();
    }
  }, [speech]);

  return (
    <div className="w-full max-w-[720px]">
      <div
        className="relative w-full rounded-[24px] bg-[#2d2d2d] border border-white/5 p-5 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)] transition-all duration-200 focus-within:border-white/15 focus-within:shadow-[0_18px_50px_-14px_rgba(0,0,0,0.7),0_0_0_4px_rgba(245,158,66,0.06)] focus-within:-translate-y-px"
      >
        {error && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-[12.5px] text-[#a0a0a0] animate-[fadeIn_180ms_ease]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#a0a0a0]/60 shrink-0" aria-hidden="true" />
            <span className="flex-1 leading-relaxed">{error}</span>
            <button onClick={() => setError(null)} className="p-1 rounded text-[#888] hover:text-[#ececec] hover:bg-white/[0.06] transition-colors" aria-label="Dismiss">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="1" y1="1" x2="11" y2="11" /><line x1="11" y1="1" x2="1" y2="11" />
              </svg>
            </button>
          </div>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {files.map((f, i) => {
              const isImage = f.mimeType.startsWith("image/");
              const Icon = getFileIcon(f.mimeType, f.filename);
              const color = getFileExtColor(f.mimeType, f.filename);

              return (
                <div
                  key={i}
                  className="group/file relative flex items-center gap-2.5 px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-xl hover:bg-white/[0.07] hover:border-white/[0.1] transition-all max-w-[220px]"
                >
                  {/* Thumbnail or icon */}
                  {isImage ? (
                    <img
                      src={f.dataUrl}
                      alt={f.filename}
                      className="w-9 h-9 rounded-lg object-cover shrink-0 border border-white/10"
                    />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${color}12`, border: `1px solid ${color}25` }}
                    >
                      <Icon size={16} strokeWidth={1.75} style={{ color }} />
                    </div>
                  )}

                  {/* File info */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[12px] font-medium text-[#d5d5d5] truncate leading-tight">
                      {f.filename}
                    </span>
                    <span className="text-[10.5px] text-[#888] leading-tight mt-0.5">
                      {formatFileSize(f.sizeBytes)}
                    </span>
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={() => handleRemoveFile(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#3a3a3c] border border-white/10 flex items-center justify-center text-[#a0a0a0] hover:text-[#f87171] hover:bg-[#4a2020] hover:border-red-500/30 opacity-0 group-hover/file:opacity-100 transition-all shadow-sm"
                    aria-label={`Remove ${f.filename}`}
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

          {/* Active skill chips */}
          {(activeId ? activeSkillNames : pendingSkills).length > 0 && (
            <div className="mb-2 flex items-center gap-1.5 flex-wrap">
              {(activeId ? activeSkillNames : pendingSkills).map((sn) => (
                <span
                  key={sn}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f59e42]/10 text-[12px] text-[#f59e42] border border-[#f59e42]/20"
                >
                  <Sparkles size={11} strokeWidth={2} />
                  {sn}
                  <button
                    onClick={() => {
                      if (activeId) {
                        const next = activeSkillNames.filter((n) => n !== sn);
                        setConversationSkills(activeId, next);
                      } else {
                        setPendingSkills((prev) => prev.filter((n) => n !== sn));
                      }
                    }}
                    className="ml-0.5 p-0.5 rounded-sm hover:bg-[#f59e42]/20 transition-colors"
                    aria-label={`Remove ${sn} skill`}
                  >
                    <X size={10} strokeWidth={2} />
                  </button>
                </span>
              ))}
            </div>
          )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          aria-label="Message input"
          placeholder={speech.listening ? "Listening…" : isStreaming ? (agentMode ? "Agent is working — type to queue…" : "Type your next message…") : noModelsAvailable ? "Add a provider in Settings to begin" : designMode ? "Design anything" : agentMode ? "Do anything" : "Ask anything"}
          className="w-full min-h-[40px] max-h-[180px] bg-transparent text-[16px] text-[#ececec] placeholder:text-[#a0a0a0] resize-none focus:outline-none leading-relaxed"
        />

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
                  <div className="absolute bottom-full left-0 mb-2 w-52 bg-[#2a2a2a] border border-white/10 rounded-xl p-1.5 shadow-xl z-20 origin-bottom-left animate-[dropdownIn_110ms_ease-out]">
                    {[
                      { icon: Upload, label: "Upload file", onClick: () => { setShowPlusMenu(false); handleAttach(); } },
                      ...(agentMode
                        ? [{
                            icon: ListChecks,
                            label: planMode ? "Plan mode — on" : "Plan mode",
                            description: planMode
                              ? "Read-only investigation. Toggle off to write."
                              : "Read-only investigation, then a Build button.",
                            active: planMode,
                            onClick: () => { setShowPlusMenu(false); setPlanMode(!planMode); },
                          }]
                        : []),
                      // Research mode — sits right above Skills so the
                      // “modes” cluster together. One-shot in chat mode (the
                      // toggle resets on send); persistent until off in
                      // agent mode. Hidden when there's no search backend
                      // available in chat mode so we don't show a dead
                      // option.
                      ...((agentMode || tavilyApiKey || freeWebSearch)
                        ? [{
                            icon: Telescope,
                            label: researchMode ? "Research — on" : "Research",
                            description: researchMode
                              ? "Applies to your next message, then resets."
                              : agentMode
                                ? "Multi-step web research with citations."
                                : "Web-augmented answer with citations.",
                            active: researchMode,
                            onClick: () => { setShowPlusMenu(false); toggleResearchMode(); },
                          }]
                        : []),
                      ...(skillsForCurrentMode.length > 0
                        ? [{ icon: Wand2, label: "Choose skills", onClick: () => { setShowPlusMenu(false); setPendingSkills(activeId ? activeSkillNames : pendingSkills); setShowSkillPicker((s) => !s); } }]
                        : []),
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        onClick={opt.onClick}
                        className={`flex items-start gap-2.5 w-full px-2.5 py-2 rounded-md text-[13px] transition-colors duration-[120ms] text-left ${
                          ("active" in opt && opt.active)
                            ? "bg-[#f59e42]/10 text-[#f59e42]"
                            : "text-[#d5d5d5] hover:bg-white/5"
                        }`}
                      >
                        <opt.icon
                          size={14}
                          strokeWidth={1.75}
                          className={`shrink-0 mt-0.5 ${("active" in opt && opt.active) ? "text-[#f59e42]" : "text-[#c9c9c9]"}`}
                        />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="truncate">{opt.label}</span>
                          {"description" in opt && opt.description && (
                            <span className="text-[11px] text-[#a0a0a0] truncate leading-tight mt-0.5">
                              {opt.description}
                            </span>
                          )}
                        </div>
                        {("active" in opt && opt.active) && (
                          <span aria-hidden className="shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full bg-[#f59e42]" />
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Skill picker popover */}
              {showSkillPicker && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowSkillPicker(false)}
                  />
                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#2a2a2a] border border-white/10 rounded-xl p-1.5 shadow-xl z-20 origin-bottom-left animate-[dropdownIn_110ms_ease-out]">
                    <div className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wider uppercase text-[#888888]">
                      Choose skills
                    </div>
                    {skillsForCurrentMode
                      .filter((s) => !disabledSkills.has(s.name))
                      .map((skill) => {
                        const selected = pendingSkills.includes(skill.name);
                        return (
                          <button
                            key={skill.name}
                            onClick={() => {
                              setPendingSkills((prev) =>
                                selected ? prev.filter((n) => n !== skill.name) : [...prev, skill.name]
                              );
                            }}
                            className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-[13px] transition-colors duration-[120ms] text-left ${
                              selected
                                ? "bg-[#f59e42]/10 text-[#f59e42]"
                                : "text-[#d5d5d5] hover:bg-white/5"
                            }`}
                          >
                            {selected ? (
                              <Check size={14} strokeWidth={2} className="text-[#f59e42] shrink-0" />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded-sm border border-white/20 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{skill.name}</div>
                              <div className="text-[11px] text-[#a0a0a0] truncate leading-tight mt-0.5">
                                {skill.description.slice(0, 80)}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    {skillsForCurrentMode.length === 0 && (
                      <div className="px-2.5 py-3 text-[13px] text-[#a0a0a0]">
                        {discoveredSkills.length > 0
                          ? `No skills available in ${agentMode ? "agent" : "chat"} mode. Switch modes to see other skills.`
                          : "No skills discovered. Add skills in Settings."}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (activeId) {
                          setConversationSkills(activeId, pendingSkills);
                        }
                        setShowSkillPicker(false);
                      }}
                      className="flex items-center justify-center gap-1.5 w-full mt-1.5 px-3 py-1.5 rounded-lg bg-[#f59e42]/15 hover:bg-[#f59e42]/25 text-[#f59e42] text-[13px] font-medium transition-colors"
                    >
                      <Check size={14} strokeWidth={2.5} />
                      Done
                    </button>
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

            {designMode ? (!activeId && <DesignPills />) : <AgentPill />}
            {agentMode && planMode && (
              <button
                type="button"
                onClick={() => setPlanMode(false)}
                title="Plan mode — read-only investigation. Click to turn off."
                className="flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-[#f59e42]/10 hover:bg-[#f59e42]/15 border border-[#f59e42]/30 text-[12px] font-medium text-[#f59e42] transition-colors shrink-0"
              >
                <ListChecks size={12} strokeWidth={2} aria-hidden="true" />
                <span>Plan</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 text-[13px]">
            <ModelPicker onOpenSettings={onOpenSettings} />

            {(() => {
              const hasInput = value.trim().length > 0;
              const showStop = isStreaming && !hasInput;
              const disabled = !isStreaming && !canSend;
              return (
                <button
                  onClick={showStop ? cancelStreaming : () => handleSend()}
                  disabled={disabled}
                  aria-label={showStop ? "Stop generating" : "Send message"}
                  className={`ml-1 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
                    showStop
                      ? "bg-[#ececec] hover:bg-white scale-100"
                      : disabled
                        ? "bg-[#3a3a3a] cursor-not-allowed scale-95 opacity-70"
                        : "bg-[#f59e42] hover:bg-[#f0903a] shadow-[0_4px_14px_-4px_rgba(245,158,66,0.55)] hover:shadow-[0_6px_18px_-4px_rgba(245,158,66,0.7)] hover:scale-[1.04] active:scale-95"
                  }`}
                >
                  {showStop ? (
                    <Square size={11} strokeWidth={2.5} className="text-[#2d2d2d]" aria-hidden="true" />
                  ) : (
                    <ArrowUp size={16} strokeWidth={2.4} className={disabled ? "text-[#a0a0a0]" : "text-[#1a1a1c]"} aria-hidden="true" />
                  )}
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
