import { useCallback, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import type { ToolSet } from "ai";
import { invoke } from "@tauri-apps/api/core";
import {
  NEW_CHAT_DRAFT_KEY,
  type Attachment,
  type ChatStore,
  type DeepResearchEvent,
  type DeepResearchState,
  type ToolCallEntry,
  type Message,
} from "../../../stores/chat";
import { streamChat, generateTitle, heuristicTitle, type LlmContentPart, type LlmMessage, type ToolCallInfo, type ToolResultInfo } from "../../../lib/llm";
import { OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID } from "../../../lib/openai-codex-subscription";
import { ALL_TOOLS, RESEARCH_TOOLS, CHAT_TOOLS, PLAN_TOOLS, isWriteTool } from "../../../lib/tools";
import { shouldAutoApprove } from "../../../lib/tools/approval";
import { classifyCommand } from "../../../lib/command-safety";
import { stripLeakedToolJson } from "../../../lib/sanitize";
import { buildAgentSystemPrompt, buildChatSystemPrompt } from "../../../lib/system-prompt";
import { buildDesignSystemPrompt } from "../../../lib/design/prompt";
import { splitContentByArtifacts } from "../../../lib/artifact-segments";
import { formatSkillsForPrompt } from "../../../lib/skills";
import { loadProjectContext } from "../../../lib/project-context";
import { logMessage, logToolCall, logToolResult, logError } from "../../../lib/event-log";
import {
  compactMessages,
  estimateContextTokens,
  shouldCompact,
  summarizeWithLlm,
} from "../../../lib/context-manager";
import { applyCompactionReplay } from "../../../lib/compaction/replay";
import { extractAndAppend } from "../../../lib/attachment-extract";
import { fetchNewUrlsFromProse } from "../../../lib/url-fetch";
import { log } from "../../../lib/logger";
import { isLikelyScannedPdf } from "../../../lib/attachment-cache";
import { providerSupportsNativePdf } from "../../../lib/native-pdf";
import { loadPromptTemplates, expandPromptTemplate, type PromptTemplate } from "../../../lib/prompt-templates";
import { readSkillFile } from "../../../lib/skills";
import { startJjAgentSession, endJjAgentSession } from "../../../lib/jjagent";
import { extractAndPersistTurnMemories } from "../../../lib/memory-extraction";
import type { ResearchProgress } from "../../../lib/deep-research";
import { useSpeechToText } from "../../../lib/speech";

let audioCtx: AudioContext | null = null;
function playCompletionSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Audio may be unavailable in tests or locked-down browser contexts.
  }
}

const promptTemplateCache = new Map<string, PromptTemplate[]>();

async function getPromptTemplates(workspace: string | null | undefined): Promise<PromptTemplate[]> {
  if (!workspace) return [];
  const cached = promptTemplateCache.get(workspace);
  if (cached) return cached;
  const fresh = await loadPromptTemplates(workspace).catch(() => [] as PromptTemplate[]);
  promptTemplateCache.set(workspace, fresh);
  return fresh;
}

async function getSkillBody(
  getStore: () => ChatStore,
  name: string,
): Promise<{ name: string; filePath: string; body: string } | null> {
  const skill = getStore().discoveredSkills.find((s) => s.name === name);
  if (!skill) return null;
  try {
    const body = await readSkillFile(skill.filePath);
    return { name: skill.name, filePath: skill.filePath, body };
  } catch {
    return null;
  }
}

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

function loadPendingSkills(): string[] {
  try {
    const saved = localStorage.getItem("goatllm-pending-skills");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export interface SendOverrides {
  content?: string;
  attachments?: Attachment[];
  fromQueue?: boolean;
  steered?: boolean;
}

interface UseComposerOptions {
  getStore: () => ChatStore;
  activeId: string | null;
  selectedModelId: string | null;
  isStreaming: boolean;
  voiceSettings: ChatStore["voiceSettings"];
}

export function useComposer({ getStore, activeId, selectedModelId, isStreaming, voiceSettings }: UseComposerOptions) {
  const currentDraftKey = useCallback(() => getStore().activeId ?? NEW_CHAT_DRAFT_KEY, [getStore]);
  const initialDraftKey = currentDraftKey();
  const initialDraft = getStore().drafts[initialDraftKey];
  const [draftKey, setDraftKey] = useState(initialDraftKey);
  const [value, setValueState] = useState(initialDraft?.content ?? "");
  const [files, setFilesState] = useState<Attachment[]>(initialDraft?.attachments ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pendingSkills, setPendingSkillsState] = useState<string[]>(loadPendingSkills);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<((overrides?: SendOverrides) => void) | null>(null);
  const artifactScanRef = useRef({ lastScan: 0, rafPending: false });

  const persistPendingSkills = useCallback((next: string[]) => {
    try {
      if (next.length > 0) localStorage.setItem("goatllm-pending-skills", JSON.stringify(next));
      else localStorage.removeItem("goatllm-pending-skills");
    } catch {
      // Ignore localStorage quota/security failures.
    }
  }, []);

  const setPendingSkills = useCallback((next: string[] | ((current: string[]) => string[])) => {
    setPendingSkillsState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      persistPendingSkills(resolved);
      return resolved;
    });
  }, [persistPendingSkills]);

  const loadDraft = useCallback((key: string) => {
    const draft = getStore().drafts[key];
    setDraftKey(key);
    setValueState(draft?.content ?? "");
    setFilesState(draft?.attachments ?? []);
  }, [getStore]);

  const setValue = useCallback((next: string | ((current: string) => string)) => {
    const key = currentDraftKey();
    setDraftKey(key);
    setValueState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      getStore().setDraftContent(key, resolved);
      return resolved;
    });
  }, [currentDraftKey, getStore]);

  const setFiles = useCallback((next: Attachment[] | ((current: Attachment[]) => Attachment[])) => {
    const key = currentDraftKey();
    setDraftKey(key);
    setFilesState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      getStore().setDraftAttachments(key, resolved);
      return resolved;
    });
  }, [currentDraftKey, getStore]);

  const appendFiles = useCallback((attachments: Attachment[]) => {
    if (attachments.length === 0) return;
    const key = currentDraftKey();
    getStore().appendDraftAttachments(key, attachments);
    setDraftKey(key);
    setFilesState(getStore().drafts[key]?.attachments ?? attachments);
  }, [currentDraftKey, getStore]);

  const clear = useCallback((key = currentDraftKey()) => {
    getStore().clearDraft(key);
    if (key === draftKey || key === currentDraftKey()) {
      setValueState("");
      setFilesState([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  }, [currentDraftKey, draftKey, getStore]);

  const focus = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const handleAttach = useCallback(() => fileInputRef.current?.click(), []);

  const handleFilesChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    const newAttachments = await filesToAttachments(Array.from(selectedFiles));
    if (newAttachments.length < selectedFiles.length) {
      setError("One or more files exceeded the 50MB limit.");
    }
    setFiles((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [setFiles]);

  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, [setFiles]);

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
    e.preventDefault();

    const newAttachments = await filesToAttachments(pastedFiles);
    if (newAttachments.length < pastedFiles.length) {
      setError("One or more pasted files exceeded the 50MB limit.");
    }
    setFiles((prev) => [...prev, ...newAttachments]);
  }, [setFiles]);

  const recallPreviousUserMessage = useCallback(() => {
    const id = getStore().activeId;
    if (!id) return;
    const previous = [...(getStore().messages[id] ?? [])]
      .reverse()
      .find((message) => message.role === "user" && typeof message.content === "string" && message.content.trim());
    if (!previous) return;
    setValue(previous.content);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [getStore, setValue]);

  const speech = useSpeechToText({
    onTranscription: (text) => {
      if (voiceSettings.enabled && voiceSettings.handsFree && text.trim()) {
        setValue("");
        setTimeout(() => sendRef.current?.({ content: text.trim() }), 0);
      } else {
        setValue((cur) => (cur.trim() ? cur + " " + text : text));
      }
    },
    onError: (msg) => {
      setError(msg);
    },
  });

  const handleToggleMic = useCallback(() => {
    if (speech.listening) speech.stop();
    else speech.start();
  }, [speech]);

  const send = useCallback(async (overrides?: { content?: string; attachments?: Attachment[]; fromQueue?: boolean; steered?: boolean }) => {
    const {
      addMessage,
      addCompactionEntry,
      startStreaming,
      stopStreaming,
      appendToMessage,
      appendToThinking,
      updateMessage,
      deleteMessage,
      createConversation,
      getActiveMessages,
      getActiveLlmConfig,
      getModels,
      renameConversation,
      setTitleGenerating,
      addToolCallToMessage,
      completeToolCall,
      finalizeStuckToolCalls,
      detectArtifacts,
      streamArtifactDelta,
      finalizeStreamingArtifacts,
      enqueueMessage,
      dequeueMessage,
      setSteerPayload,
      clearDraft,
      setConversationSkills,
    } = getStore();
    const rawTrimmed = (overrides?.content ?? value).trim();
    const currentFiles = overrides?.attachments ?? files;
    // A queued/steered dispatch is a genuine new user turn (must be added to
    // the thread + sent), unlike an edit/regenerate resend whose message is
    // already in history.
    const isQueuedDispatch = overrides?.fromQueue === true;
    const isResend = !!overrides && !isQueuedDispatch;
    if (!rawTrimmed && currentFiles.length === 0) return;

    // While a turn is streaming, queue the new message instead of blocking.
    // Works in every mode now (chat, agent, design) — the user can line up a
    // follow-up or steer the in-flight turn.
    if (isStreaming) {
      const k = getStore().activeId ?? NEW_CHAT_DRAFT_KEY;
      if (rawTrimmed && activeId) {
        enqueueMessage(activeId, rawTrimmed);
        clearDraft(k);
        setValue("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        return;
      }
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
    if (
      !llmConfig.apiKey &&
      selectedModel.providerId !== "ollama" &&
      selectedModel.providerId !== "lmstudio" &&
      selectedModel.providerId !== OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID
    ) {
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
        try { localStorage.removeItem("goatllm-pending-skills"); } catch {}
      }
    }
    if (selectedModelId) {
      getStore().setConversationModel(convId, selectedModelId);
    }

    // Slash command: /skill:name [optional message].
    // Switches the conversation's active skill (persists across sends) and
    // strips the command prefix from the message. If only `/skill:name` is
    // sent with no body, the next turn carries the skill instructions in
    // the system prompt and a tiny note as the user message.
    const ws = getStore().workspacePath;
    let trimmed = rawTrimmed;
    const skillCmd = trimmed.match(/^\/skill:([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/);
    if (skillCmd) {
      const reqName = skillCmd[1];
      const matched = getStore().discoveredSkills.find((s) => s.name === reqName);
      if (matched) {
        const fits =
          matched.mode === "both" ||
          (getStore().agentMode ? matched.mode === "agent" : matched.mode === "chat");
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

    if (!isResend && getStore().pursueGoalMode) {
      const goal = trimmed;
      getStore().setPursueGoalMode(false);
      getStore().setPlanMode(false);
      trimmed =
        `Pursue Goal:\n\n${goal}\n\n` +
        `Work autonomously until the goal is genuinely handled. Start by making a concise plan, then inspect the project, browser, files, tools, and runtime state as needed. Execute the work, iterate on failures, verify with the strongest available checks, and end with a final result that explains what changed and what was validated.`;
    }

    // Bash inline execution: !command runs and sends output to LLM,
    // !!command runs but does NOT send output (just shows in chat).
    // Only available in agent or design mode with a workspace.
    const bashWorkspace = getStore().agentMode
      ? getStore().workspacePath
      : getStore().designMode
        ? getStore().designWorkspacePath
        : null;
    if (bashWorkspace && (trimmed.startsWith("!") || trimmed.startsWith("!!"))) {
      const sendToLlm = trimmed.startsWith("!!");
      const cmd = sendToLlm ? trimmed.slice(2).trim() : trimmed.slice(1).trim();
      if (cmd) {
        try {
          const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
          const result = await tauriInvoke<{ stdout: string; stderr: string; code: number }>("exec_command", {
            workspace: bashWorkspace,
            command: cmd,
          });
          const output = [
            result.stdout?.trim(),
            result.stderr?.trim(),
            result.code !== 0 ? `[exit code: ${result.code}]` : "",
          ].filter(Boolean).join("\n");
          if (sendToLlm) {
            // !!command: run only, don't send to LLM — show output in chat
            addMessage({
              conversationId: convId,
              role: "user",
              content: `!${cmd}`,
            });
            addMessage({
              conversationId: convId,
              role: "assistant",
              content: `Command output:\n\n\`\`\`\n${output || "(no output)"}\n\`\`\``,
            });
            clearDraft(startingDraftKey);
            if (textareaRef.current) textareaRef.current.style.height = "auto";
            setValue("");
            setFiles([]);
            return;
          } else {
            // !command: run and send output to LLM
            trimmed = `${trimmed}\n\nCommand output:\n\`\`\`\n${output || "(no output)"}\n\`\`\``;
          }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          trimmed = `${trimmed}\n\n[Command failed: ${err}]`;
        }
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
          const { putAttachmentText } = await import("../../../lib/attachment-cache");
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
    displayContent = await extractAndAppend(displayContent, currentFiles, convId ?? undefined);

    // Auto-fetch URLs and YouTube links the user typed in their message.
    // Each unique URL gets its readable text inlined as `[Web: ...]` or
    // `[YouTube: ...]` and cached so subsequent turns can navigate it via
    // read_attachment. Fetched once per conversation per URL.
    if (convId) {
      try {
        const fetched = await fetchNewUrlsFromProse(trimmed, convId);
        if (fetched.length > 0) {
          const { putAttachmentText } = await import("../../../lib/attachment-cache");
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

    const sourceUserContent = displayContent;
    let sourceUserMessageId: string | undefined;
    if (!isResend) {
      // Auto-pin messages that carry non-trivial attachments. Without this,
      // a 30KB PDF extraction can fall out of the recency budget on the next
      // turn and the model loses the body — the summary only keeps the first
      // 200 chars of the user prose. Pinning survives compaction.
      const hasHeavyAttachment =
        currentFiles.length > 0 &&
        currentFiles.some((f) => f.sizeBytes > 4 * 1024 || /\.(pdf|docx|pptx|xlsx|ipynb|rtf)$/i.test(f.filename));
      const userMessage = addMessage({
        conversationId: convId,
        role: "user",
        content: displayContent,
        attachments: currentFiles.length > 0 ? currentFiles : undefined,
        pinned: hasHeavyAttachment || undefined,
        steered: overrides?.steered || undefined,
      });
      sourceUserMessageId = userMessage.id;
      logMessage(convId!, "user", displayContent, "");
      // Mark the conversation as "title pending" the moment the user sends so
      // the sidebar can show a shimmer instead of the placeholder "New chat".
      const convForTitle = getStore().conversations.find((c) => c.id === convId);
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
          const latest = getStore().conversations.find((c) => c.id === convId);
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
    const currentWorkspace = getStore().workspacePath;
    let designWorkspace = getStore().designWorkspacePath;
    const isAgentMode = getStore().agentMode;
    const isDesignMode = getStore().designMode;

    // Design mode with no project folder yet → auto-provision one under
    // ~/.goat/designs/<slug> so the design agent actually writes files to disk
    // (the artifact is the live preview; the files are the deliverable). Without
    // a workspace the model can only emit in-memory artifacts and never touches
    // the filesystem — which is the "it doesn't create files" gap.
    if (isDesignMode && !designWorkspace && convId) {
      try {
        const home = await invoke<string>("home_dir");
        const conv = getStore().conversations.find((c) => c.id === convId);
        const slug =
          (conv?.title || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || `design-${convId.slice(0, 8)}`;
        const folder = `${home}/.goat/designs/${slug}`;
        try { await invoke("create_dir_abs", { path: folder }); } catch { /* lazy-create on first write */ }
        getStore().addDesignWorkspace(folder);
        getStore().setDesignWorkspace(folder);
        getStore().moveConversationToWorkspace?.(convId, folder);
        designWorkspace = folder;
      } catch { /* home dir unavailable — fall back to artifact-only mode */ }
    }
    const isPlanMode = isAgentMode && getStore().planMode;
    // Deep Research mode is one-shot: we snapshot the toggle at send time and
    // immediately flip it off so the indicator resets in the UI. Anything
    // downstream in this turn (tool selection, system prompt, max rounds)
    // uses the captured value so the request the user just sent still
    // gets the research treatment.
    const isResearchMode = getStore().researchMode;
    if (isResearchMode) {
      getStore().setResearchMode(false);
    }
    const currentBackend = getStore().searchBackend;
    const hasWebSearch = currentBackend === "tavily" ? !!getStore().tavilyApiKey : true;
    // Cached attachments unlock the read_attachment / search_attachment tools
    // even in plain chat with no web backend, so the model can navigate a
    // 600-page book the user uploaded.
    const { hasAttachments } = await import("../../../lib/attachment-cache");
    const hasAttachmentCache = !!convId && hasAttachments(convId);
    const { ATTACHMENT_TOOLS, CODE_EXEC_TOOLS } = await import("../../../lib/tools");
    const chatCodeExec = getStore().chatCodeExec;
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
    // Expose load_skill in chat/research mode whenever the model has skills it
    // can pull on demand (pi-style progressive disclosure). Agent/design mode
    // already get it via ALL_TOOLS. We only attach it if at least one enabled,
    // model-invocable skill applies to the current mode — otherwise there's
    // nothing to load and the tool would just be noise.
    if (!isAgentMode && !isDesignMode) {
      const s = getStore();
      const hasModelSkills = s.discoveredSkills.some(
        (sk) =>
          !sk.disableModelInvocation &&
          !s.disabledSkills.has(sk.name) &&
          (sk.mode === "chat" || sk.mode === "both"),
      );
      if (hasModelSkills) {
        const { SKILL_TOOLS } = await import("../../../lib/tools");
        activeTools = { ...(activeTools ?? {}), ...SKILL_TOOLS } as ToolSet;
      }
    }

    const latestCompactionEntry = getStore().compactionEntries[convId!]?.[0] ?? null;
    const replayed = applyCompactionReplay(history, latestCompactionEntry);
    let compactedMessages: LlmMessage[] = replayed.llmMessages
      .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
      .map((message) => ({
        role: message.role as "user" | "assistant" | "system",
        content: message.content,
      }));

    const compactionSettings = getStore().usageSettings.compactionSettings;
    const contextEstimate = estimateContextTokens(history);
    const contextWindow = selectedModel.contextWindow;
    const shouldRunCompaction = shouldCompact(
      contextEstimate.tokens,
      contextWindow,
      compactionSettings,
    );
    const maxTokensAfterReserve = Math.max(1, contextWindow - compactionSettings.reserveTokens);
    const compaction = shouldRunCompaction
      ? compactMessages(history, maxTokensAfterReserve, {
          stripTools: !activeTools,
          previousEntry: latestCompactionEntry,
          previousSummary: latestCompactionEntry?.summary,
          conversationId: convId!,
          source: "auto",
          mode: isDesignMode ? "design" : isAgentMode ? "agent" : "chat",
          modelId: selectedModelId ?? undefined,
          tokensBefore: contextEstimate.tokens,
          keepRecentTokens: compactionSettings.keepRecentTokens,
        })
      : null;
    const compacted = compaction?.compacted ?? replayed.hiddenCount > 0;
    const summarizedCount = compaction?.summarizedCount ?? 0;
    const truncatedCount = compaction?.truncatedCount ?? 0;
    const toolsInlinedCount = compaction?.toolsInlinedCount ?? 0;

    if (compaction?.compactionEntry) {
      const entry = compaction.compactionEntry;
      addCompactionEntry(entry);
      compactedMessages = compaction.messages;

      const firstKeptIndex = history.findIndex((message) => message.id === entry.firstKeptId);
      const sourceMessages = firstKeptIndex > 0
        ? history.slice(0, firstKeptIndex).filter((message) => message.role !== "system")
        : [];
      if (sourceMessages.length >= 4 && llmConfig && entry.source !== "mid-loop") {
        void summarizeWithLlm(
          sourceMessages,
          llmConfig,
          undefined,
          undefined,
          latestCompactionEntry?.summary,
          { readFiles: entry.readFiles, modifiedFiles: entry.modifiedFiles },
        )
          .then((summary) => {
            if (!summary || summary.length <= 40) return;
            addCompactionEntry({
              ...entry,
              summary,
              promptVersion: latestCompactionEntry ? "update" : "initial",
            });
          })
          .catch(() => { /* graceful fallback already applied inside summarizeWithLlm */ });
      }
    }

    if (compacted && (summarizedCount > 0 || truncatedCount > 0)) {
      if (summarizedCount > 0) {
        log.info(`Summarized ${summarizedCount} earlier messages.`, { tag: "context", data: { summarizedCount } });
      }
      if (truncatedCount > 0) {
        log.info(`Truncated ${truncatedCount} oversized tool outputs.`, { tag: "context", data: { truncatedCount } });
      }
      if (toolsInlinedCount > 0) {
        log.info(`Inlined tool results from ${toolsInlinedCount} messages for non-tool model.`, { tag: "context", data: { toolsInlinedCount } });
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
        const nativePdf =
          modelIsVision && providerSupportsNativePdf(llmConfig.provider);
        const scannedPdfs = nativePdf
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
    getStore().resetWebSearchCount();
    startStreaming(convId!, ac);

    const assistantMsg = addMessage({ conversationId: convId, role: "assistant", content: "", isStreaming: true });
    logMessage(convId!, "assistant", "", assistantMsg.id);
    const streamStartTime = performance.now();

    if (isResearchMode) {
      try {
        const { runDeepResearch, planResolvers } = await import("../../../lib/deep-research");
        let eventCounter = 0;
        const events: DeepResearchEvent[] = [];
        const startedAt = Date.now();
        const phaseMessage = (progress: ResearchProgress) => {
          if (progress.message) return progress.message;
          if (progress.phase === "planning") return "Planning strategy";
          if (progress.phase === "searching") {
            return progress.query_preview
              ? `Searching for "${progress.query_preview}"`
              : `Searching web${progress.round ? `, round ${progress.round}` : ""}`;
          }
          if (progress.phase === "reading") {
            if (progress.current_source?.title || progress.title) {
              return `Reading ${progress.current_source?.title || progress.title}`;
            }
            if (progress.new_sources) return `Extracted findings from ${progress.new_sources} sources`;
            return "Reading sources";
          }
          if (progress.phase === "analyzing") return "Analyzing findings";
          if (progress.phase === "writing") return "Writing report";
          if (progress.phase === "done") return "Deep Research complete";
          if (progress.phase === "error") return "Deep Research stopped";
          return "Deep Research update";
        };
        const updateLog = (progress: ResearchProgress) => {
          const message = phaseMessage(progress);
          if (events.length === 0 || events[events.length - 1].message !== message) {
            events.push({
              id: `${assistantMsg.id}-research-${eventCounter++}`,
              phase: progress.phase,
              message,
              at: Date.now(),
            });
          }

          const deepResearch: DeepResearchState = {
            query: trimmed,
            phase: progress.phase,
            startedAt,
            round: progress.round,
            queries: progress.queries,
            sourceCount: progress.total_sources,
            findingCount: progress.total_findings,
            sources: progress.sources,
            findings: progress.findings,
            currentSource: progress.current_source ?? (progress.url ? { url: progress.url, title: progress.title } : undefined),
            events: events.slice(-8),
            error: progress.phase === "error" ? progress.message : undefined,
          };

          const updates: Partial<Message> = { deepResearch };
          if (progress.phase !== "done" && progress.phase !== "error") {
            updates.content = "";
          }
          updateMessage(convId!, assistantMsg.id, updates);
        };

        const store = getStore();
        const deepResearchMaxRounds = store.deepResearchMaxRounds;
        const deepResearchMaxSearches = store.deepResearchMaxSearches;

        const finalReport = await runDeepResearch(
          trimmed,
          llmConfig,
          updateLog,
          ac.signal,
          deepResearchMaxRounds,
          undefined,
          {
            maxUrlsPerRound: deepResearchMaxSearches,
            onPlanReady: ({ title, steps }) => {
              return new Promise<string[]>((resolve) => {
                planResolvers.set(assistantMsg.id, resolve);
                updateMessage(convId!, assistantMsg.id, {
                  deepResearch: {
                    query: trimmed,
                    phase: "planning",
                    startedAt,
                    events: events.slice(-8),
                    planTitle: title,
                    planSteps: steps,
                    planApproved: false,
                  }
                });
              });
            },
            getLatestPlan: () => {
              const latestMsg = getStore().messages[convId!]?.find((m) => m.id === assistantMsg.id);
              return {
                title: latestMsg?.deepResearch?.planTitle || trimmed,
                steps: latestMsg?.deepResearch?.planSteps || [],
              };
            }
          }
        );

        const wordCount = finalReport.split(/\s+/).length;
        updateMessage(convId!, assistantMsg.id, {
          content: finalReport,
          isStreaming: false,
          streamingDurationMs: performance.now() - streamStartTime,
          turnDurationMs: performance.now() - streamStartTime,
          modelId: selectedModelId ?? undefined,
          outputTokens: Math.round(wordCount * 1.33),
        });

        stopStreaming(convId!);
        if (finalReport.trim()) {
          detectArtifacts(convId!, assistantMsg.id, finalReport);
        }
        finalizeStreamingArtifacts(convId!, assistantMsg.id);

        const latestConv = getStore().conversations.find((c) => c.id === convId);
        if (latestConv && latestConv.isGeneratingTitle && latestConv.title !== "New Conversation") {
          setTitleGenerating(convId!, false);
        }

        if (getStore().completionSound) {
          playCompletionSound();
        }
        const currentActiveId = getStore().activeId;
        const next = currentActiveId === convId ? dequeueMessage(convId!) : undefined;
        if (next) {
          setSteerPayload({ conversationId: convId!, content: next.content, steered: false });
        }
      } catch (err) {
        const currentMsg = getStore().messages[convId!]?.find((m) => m.id === assistantMsg.id);
        const currentDr = currentMsg?.deepResearch;
        if (ac.signal.aborted) {
          updateMessage(convId!, assistantMsg.id, {
            content: "Deep Research aborted.",
            deepResearch: currentDr ? {
              ...currentDr,
              phase: "error",
              error: "Deep Research aborted.",
            } : undefined,
            isStreaming: false,
            interrupted: true,
          });
          stopStreaming(convId!);
          return;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        updateMessage(convId!, assistantMsg.id, {
          content: `Deep Research Error: ${errMsg}`,
          deepResearch: currentDr ? {
            ...currentDr,
            phase: "error",
            error: errMsg,
          } : undefined,
          isStreaming: false,
        });
        logError(convId!, errMsg, "deep-research");
        setError(errMsg);
        stopStreaming(convId!);
      }
      return;
    }

    const editedFilesThisTurn = new Set<string>();
    let capturedInputTokens: number | undefined;
    let capturedOutputTokens: number | undefined;
    let capturedGenerationMs: number | undefined;
    let capturedUsage: Message["usage"] | undefined;

    const conv = getStore().conversations.find((c) => c.id === convId);
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
    const activeSkillNamesForConv = getStore().conversations.find((c) => c.id === convId)?.activeSkillNames ?? [];
    const activeSkillDatas: { name: string; filePath: string; body: string }[] = [];
    for (const sn of activeSkillNamesForConv) {
      const obj = getStore().discoveredSkills.find((s) => s.name === sn) ?? null;
      if (!obj) continue;
      const matches = obj.mode === "both" ||
        (isAgentMode ? obj.mode === "agent" : obj.mode === "chat");
      if (!matches) continue;
      try {
        const body = await getSkillBody(getStore, sn);
        if (body) activeSkillDatas.push(body);
      } catch { /* skip */ }
    }
    const activeSkillBlock = activeSkillDatas.length > 0
      ? `\n<active_skills>\n${activeSkillDatas.map((s) => `<skill name="${s.name}" location="${s.filePath}">\n${s.body}\n</skill>`).join("\n")}\nThese skills are active for the rest of this conversation. Apply their instructions to every reply.\n</active_skills>\n`
      : "";

    // Auto-trigger skills: their full SKILL.md body is injected into every
    // system prompt so the model follows the instructions automatically
    // without needing to read the file itself.
    const autoTriggerNames = getStore().autoTriggerSkills;
    const autoTriggerDatas: { name: string; filePath: string; body: string }[] = [];
    for (const sn of autoTriggerNames) {
      const obj = getStore().discoveredSkills.find((s) => s.name === sn) ?? null;
      if (!obj) continue;
      const matches = obj.mode === "both" ||
        (isAgentMode ? obj.mode === "agent" : obj.mode === "chat");
      if (!matches) continue;
      // Skip if already in active skills (don't inject twice)
      if (activeSkillNamesForConv.includes(sn)) continue;
      try {
        const body = await getSkillBody(getStore, sn);
        if (body) autoTriggerDatas.push(body);
      } catch { /* skip */ }
    }
    const autoTriggerBlock = autoTriggerDatas.length > 0
      ? `\n<auto_trigger_skills>\n${autoTriggerDatas.map((s) => `<skill name="${s.name}" location="${s.filePath}">\n${s.body}\n</skill>`).join("\n")}\nThese skills auto-load every turn. Follow their instructions without re-reading them.\n</auto_trigger_skills>\n`
      : "";

    const systemPrompt = isDesignMode
      ? (() => {
          const s = getStore();
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
          const allSkills = getStore().discoveredSkills;
          const disabled = getStore().disabledSkills;
          const autoTrigger = getStore().autoTriggerSkills;
          const enabledSkills = allSkills.filter(
            (s) => !disabled.has(s.name) && !autoTrigger.has(s.name) && (s.mode === "agent" || s.mode === "both"),
          );
          const skillsBlock = enabledSkills.length > 0 ? formatSkillsForPrompt(enabledSkills) : "";

          const dynamicPrompt = buildAgentSystemPrompt({
            tools: activeTools ?? {},
            workspacePath: currentWorkspace,
            researchMode: isResearchMode,
            planMode: getStore().planMode,
            projectContextFiles,
            existingArtifacts: (getStore().artifacts[convId!] ?? []).map((a) => ({ kind: a.kind, title: a.title })),
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
          const allSkills = getStore().discoveredSkills;
          const disabled = getStore().disabledSkills;
          const autoTrigger = getStore().autoTriggerSkills;
          const enabledSkills = allSkills.filter(
            (s) => !disabled.has(s.name) && !autoTrigger.has(s.name) && (s.mode === "chat" || s.mode === "both"),
          );
          const skillsBlock = enabledSkills.length > 0 ? formatSkillsForPrompt(enabledSkills) : "";
          const autoArtifacts = getStore().autoArtifacts;
          const officeArtifacts = getStore().officeArtifacts;
          const advancedArtifacts = getStore().advancedArtifacts;
          const base = buildChatSystemPrompt(userPrompt, isResearchMode, hasWebSearch && !isResearchMode, {
            autoArtifacts,
            officeArtifacts,
            advancedArtifacts,
            existingArtifacts: (getStore().artifacts[convId!] ?? []).map((a) => ({ kind: a.kind, title: a.title })),
          });
          let out = base;
          if (skillsBlock) out += `\n${skillsBlock}`;
          if (autoTriggerBlock) out += autoTriggerBlock;
          if (activeSkillBlock) out += activeSkillBlock;
          return out;
        })();

    const handleToolCall = (tc: ToolCallInfo) => {
      // The `done` tool is an internal completion signal — its summary
      // becomes the closing message content, not a visible tool pill.
      if (tc.toolName === "done") return;

      const writeTool = isWriteTool(tc.toolName);
      const permissionMode = getStore().permissionMode;
      const autoApproved =
        isDesignMode || shouldAutoApprove(tc.toolName, permissionMode);
      // Capture how much text content exists at this point for chronological interleaving
      const currentContent = getStore().messages[convId!]?.find((m) => m.id === assistantMsg.id)?.content || "";
      const entry: ToolCallEntry = {
        toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input,
        state: writeTool && !autoApproved ? "pending_approval" : "running",
        contentAtInvocation: currentContent.length,
      };
      // Suppress web_search pills beyond the hard cap — the tool returns an
      // error to the model but the user never sees a doomed search attempt.
      // Deep Research mode is exempt from the cap (it has its own budget via stepCountIs).
      if (tc.toolName === "web_search" && !isResearchMode && getStore().webSearchCount >= 2) {
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

      if (
        (tr.toolName === "write_file" || tr.toolName === "edit_file") &&
        typeof tr.output === "string" &&
        !tr.output.startsWith("Error") &&
        !tr.output.startsWith("❌") &&
        !/failed:/i.test(tr.output)
      ) {
        const input = tr.input as { path?: string } | undefined;
        const filePath =
          typeof input?.path === "string" ? input.path.trim() : "";
        if (filePath) {
          editedFilesThisTurn.add(filePath);
          const live = getStore()
            .messages[convId!]
            ?.find((m) => m.id === assistantMsg.id);
          const prev = live?.editedFiles ?? [];
          if (!prev.includes(filePath)) {
            updateMessage(convId!, assistantMsg.id, {
              editedFiles: [...prev, filePath],
            });
          }
        }
      }

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
            getStore()
              .upsertDesignArtifact(convId!, title, content);
          } catch {
            /* file read failed, skip */
          }
        }
      }
    };

    // Start jjagent isolation change if enabled and workspace is a jj repo.
    const jjagentEnabled = getStore().jjagent;
    const jjWs = isDesignMode ? designWorkspace : currentWorkspace;
    if (jjagentEnabled && jjWs && (isAgentMode || isDesignMode)) {
      const historyMsgs = getStore().messages[convId!];
      const turnIndex = (historyMsgs ?? []).filter((m) => m.role === "user").length;
      const session = await startJjAgentSession(jjWs, convId!, turnIndex);
      if (session) {
        getStore().setJjAgentChangeId(session.changeId);
      }
    }

    const endJjAgentSessionIfNeeded = () => {
      const changeId = getStore().jjagentChangeId;
      const s = getStore();
      const ws = s.designMode ? s.designWorkspacePath : s.workspacePath;
      if (changeId && ws) {
        endJjAgentSession(ws, { changeId, startedAt: Date.now() });
        s.setJjAgentChangeId(null);
      }
    };

    // Hybrid memory search & prompt injection
    let finalSystemPrompt = systemPrompt;
    const isMemoryEnabled = getStore().memoryEnabled;
    if (isMemoryEnabled && trimmed) {
      try {
        const { searchMemories, incrementMemoryUses } = await import("../../../lib/memory");
        const memories = await searchMemories(trimmed);
        if (memories && memories.length > 0) {
          const formattedMemories = memories
            .map((m) => `- [Category: ${m.category}] ${m.text}`)
            .join("\n");
          finalSystemPrompt += `\n<memories>\n${formattedMemories}\nThese are your long-term memories relevant to this prompt. Use them if helpful.\n</memories>\n`;
          
          // Increment uses for injected memories
          for (const m of memories) {
            await incrementMemoryUses(m.id).catch(() => {});
          }
        }
      } catch (e) {
        console.warn("Failed to search/inject memories:", e);
      }
    }

    await streamChat(llmMessages, finalSystemPrompt, llmConfig, {
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
        if (artifactScanNow && !artifactScanRef.current.rafPending) {
          artifactScanRef.current.rafPending = true;
          requestAnimationFrame(() => {
            artifactScanRef.current.rafPending = false;
            artifactScanRef.current.lastScan = performance.now();
            const live = getStore().messages[convId!]?.find((m) => m.id === assistantMsg.id);
            const content = live?.content || "";
            if (content.length === 0) return;
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
          });
        }
      },
      onThinking: (chunk) => {
        appendToThinking(convId!, assistantMsg.id, chunk);
      },
      onToolCall: handleToolCall,
      onToolResult: handleToolResult,
      onUsage: (usage) => {
        capturedUsage = {
          totalTokens: usage.totalTokens,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
        };
        capturedInputTokens = usage.inputTokens;
        capturedOutputTokens = usage.outputTokens;
        if (usage.generationMs) capturedGenerationMs = usage.generationMs;
      },
      onDone: (fullText, summary) => {
        const streamDurationMs = performance.now() - streamStartTime;
        // Any tool call still flagged "running" never got its result chunk
        // (stream ended early, abort, partial response, etc.) — flip it to
        // done so the UI stops shimmering "Reading…" forever.
        finalizeStuckToolCalls(convId!, assistantMsg.id);
        const currentMsg = getStore().messages[convId!]?.find((m) => m.id === assistantMsg.id);
        const currentContent = currentMsg?.content || "";
        const finalContent = fullText || currentContent;
        const hasToolActivity = (currentMsg?.toolCalls?.length ?? 0) > 0;

        // Strip ephemeral status lines ("Reading…", "Writing the HTML…")
        // from the final message. These are live progress indicators during
        // streaming — once the turn is done, they're noise.
        const statusStripped = hasToolActivity
          ? finalContent
              .split("\n")
              .filter((line) => {
                const t = line.trim();
                if (!t) return false;
                // Match short status lines ending with ellipsis
                if (/^[A-Z][a-z].*…$/.test(t) && t.length < 60) return false;
                // Match common status patterns
                if (/^(Reading|Writing|Editing|Planning|Searching|Checking|Running|Fetching|Creating|Updating|Building|Analyzing)\b/i.test(t) && t.length < 80) return false;
                return true;
              })
              .join("\n")
              .trim()
          : finalContent;
        // Strip any leaked tool-call JSON ({summary, {"filename"...}) before
        // persisting so it never lands in storage, copy, or reload.
        const cleanedContent = stripLeakedToolJson(statusStripped);
        // If the model only put its answer in the `done` tool args (or leaked
        // JSON that got stripped), fall back to the done summary.
        const displayContent =
          cleanedContent.trim() || (summary?.trim() ?? "");

        // Stopped before the model produced anything — drop the empty bubble
        // entirely so the chat looks like the turn never started. BUT if the
        // model had already streamed reasoning ("thinking"), keep the bubble so
        // those thoughts survive the stop — nothing the user saw should vanish.
        const hasThinking = (currentMsg?.thinkingContent?.trim().length ?? 0) > 0;
        if (!displayContent.trim() && !hasToolActivity && !hasThinking) {
          deleteMessage(convId!, assistantMsg.id);
          stopStreaming(convId!);
          endJjAgentSessionIfNeeded();
          return;
        }

        const outputTokens = capturedOutputTokens ?? (displayContent.length / 4); // fallback: ~4 chars/token
        // Use generationMs from the agent loop when available — it excludes
        // tool execution time (bash, file reads, etc.) so t/s is accurate.
        // Falls back to wall-clock streamDurationMs for simple single-call paths.
        const displayDurationMs = capturedGenerationMs ?? streamDurationMs;
        const editedFiles =
          editedFilesThisTurn.size > 0
            ? Array.from(editedFilesThisTurn)
            : getStore()
                .messages[convId!]
                ?.find((m) => m.id === assistantMsg.id)?.editedFiles;
        updateMessage(convId!, assistantMsg.id, {
          content: displayContent,
          isStreaming: false,
          streamingDurationMs: displayDurationMs,
          turnDurationMs: streamDurationMs,
          inputTokens: capturedInputTokens,
          outputTokens,
          usage: capturedUsage,
          modelId: selectedModelId ?? undefined,
          editedFiles:
            editedFiles && editedFiles.length > 0 ? editedFiles : undefined,
        });
        stopStreaming(convId!);
        // Auto-detect artifacts in completed messages
        if (displayContent.trim()) {
          detectArtifacts(convId!, assistantMsg.id, displayContent);
        }
        // Any remaining streaming flags from this message clear here so
        // the canvas auto-flips from code to preview view.
        finalizeStreamingArtifacts(convId!, assistantMsg.id);
        const extractionSettings = getStore().memoryExtractionSettings;
        if (getStore().memoryEnabled && extractionSettings.enabled) {
          void extractAndPersistTurnMemories({
            userText: sourceUserContent,
            assistantText: displayContent,
            workspacePath: currentWorkspace,
            settings: extractionSettings,
            conversationId: convId!,
            sourceMessageIds: [sourceUserMessageId, assistantMsg.id].filter((id): id is string => !!id),
          }).catch((e) => console.warn("Failed to extract memories:", e));
        }
        // Title generation is kicked off when the user sends (see above), so
        // by the time we get here the conversation has usually been renamed
        // already. We just clear the shimmer flag if it somehow lingered.
        const latestConv = getStore().conversations.find((c) => c.id === convId);
        if (latestConv && latestConv.isGeneratingTitle && latestConv.title !== "New Conversation") {
          setTitleGenerating(convId!, false);
        }
        // Squash jjagent change back into parent now that the turn is complete.
        endJjAgentSessionIfNeeded();
        // Play completion sound in agent/design mode if enabled.
        if ((isAgentMode || isDesignMode) && getStore().completionSound) {
          playCompletionSound();
        }
        // Auto-dispatch next queued message (a normal follow-up, not a steer).
        const currentActiveId = getStore().activeId;
        const next = currentActiveId === convId ? dequeueMessage(convId!) : undefined;
        if (next) {
          setSteerPayload({ conversationId: convId!, content: next.content, steered: false });
        }
      },
      onError: (err) => {
        // If the user aborted, don't surface an error — onDone has already
        // handled cleanup (or we'll do it here as a safety net).
        if (ac.signal.aborted) {
          finalizeStuckToolCalls(convId!, assistantMsg.id);
          finalizeStreamingArtifacts(convId!, assistantMsg.id);
          const currentMsg = getStore().messages[convId!]?.find((m) => m.id === assistantMsg.id);
          const currentContent = currentMsg?.content || "";
          const hasToolActivity = (currentMsg?.toolCalls?.length ?? 0) > 0;
          const hasThinking = (currentMsg?.thinkingContent?.trim().length ?? 0) > 0;
          if (!currentContent.trim() && !hasToolActivity && !hasThinking) {
            deleteMessage(convId!, assistantMsg.id);
          } else {
            updateMessage(convId!, assistantMsg.id, {
              content: currentContent,
              isStreaming: false,
              interrupted: true,
            });
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
        const errMsg =
          err?.message?.trim() || "Something went wrong during the response.";
        if (isOverflow) {
          updateMessage(convId!, assistantMsg.id, {
            content: `⚠ Context overflow\n\nThis turn exceeded "${selectedModel?.name ?? selectedModelId}"'s context window. Try switching to a longer-context model from the picker, or trim earlier messages by deleting older turns.\n\n${errMsg.split("\n")[0]}`,
            isStreaming: false,
          });
          logError(convId!, errMsg, "streaming");
          setError("Context window exceeded — see banner above.");
        } else {
          updateMessage(convId!, assistantMsg.id, {
            content: `Error: ${errMsg}`,
            isStreaming: false,
          });
          logError(convId!, errMsg, "streaming");
          setError(errMsg);
        }
        stopStreaming(convId!);
        endJjAgentSessionIfNeeded();
      },
    }, {
      abortSignal: ac.signal,
      tools: activeTools,
      maxToolRounds: isResearchMode ? 30 : isDesignMode ? 75 : undefined,
      subagentsEnabled: (isAgentMode || isDesignMode) && getStore().subagentsEnabled,
      // Session ID for prompt cache affinity — derived from conversation ID
      // so the same conversation gets consistent cache routing.
      sessionId: convId ? `goatllm-${convId}` : undefined,
      cacheRetention: "long",
    });
  }, [
    activeId,
    files,
    getStore,
    isStreaming,
    pendingSkills,
    selectedModelId,
    setFiles,
    setPendingSkills,
    setValue,
    value,
  ]);

  sendRef.current = send;

  return {
    value,
    files,
    error,
    pendingSkills,
    textareaRef,
    fileInputRef,
    speech,
    showMic: speech.supported,
    setError,
    setValue,
    setFiles,
    setPendingSkills,
    loadDraft,
    appendFiles,
    clear,
    focus,
    handleAttach,
    handleFilesChange,
    handleRemoveFile,
    handlePaste,
    handleToggleMic,
    recallPreviousUserMessage,
    send,
    sendRef,
  };
}
