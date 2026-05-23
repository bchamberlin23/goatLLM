import { create } from "zustand";
import type { LlmConfig } from "../lib/llm";
import { getBuiltInProviders } from "../lib/providers";
import {
  loadAllFromDb,
  persistConversation,
  persistMessage,
  deleteConversationFromDb,
  deleteMessageFromDb,
  searchMessages,
} from "../lib/db";

const PROVIDER_CONFIGS_KEY = "goatllm-provider-configs";

function loadProviderConfigs(): Record<string, ProviderConfig> {
  try {
    const raw = localStorage.getItem(PROVIDER_CONFIGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProviderConfigs(configs: Record<string, ProviderConfig>) {
  try {
    localStorage.setItem(PROVIDER_CONFIGS_KEY, JSON.stringify(configs));
  } catch {
    // ignore quota errors
  }
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Attachment {
  filename: string;
  mimeType: string;
  dataUrl: string; // base64 data URI for images, text/plain data URI for text files
  sizeBytes: number;
}

export interface ToolCallEntry {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  state: "running" | "done" | "error" | "pending_approval";
  /** Danger classification for exec_command (set during onToolCall). */
  dangerLevel?: "safe" | "suspicious" | "destructive";
  /** Human-readable danger reason. */
  dangerReason?: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  isStreaming?: boolean;
  attachments?: Attachment[];
  toolCalls?: ToolCallEntry[];
}

export interface Conversation {
  id: string;
  title: string;
  /** True while we're waiting on a generated title. UI shows a shimmer instead
   * of the placeholder so the user never stares at "New chat". */
  isGeneratingTitle?: boolean;
  lastMessagePreview: string;
  lastMessageAt: number;
  createdAt: number;
  modelId: string | null;
  systemPrompt: string;
}

export interface Provider {
  id: string;
  name: string;
  isOnline: boolean;
  isBuiltIn: boolean;
  baseUrl: string;
  /** Whether the provider has been health-checked yet. */
  healthChecked: boolean;
}

export interface Model {
  id: string;
  name: string;
  providerId: string;
  isAvailable: boolean;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  /** Allowlist of model IDs (provider-local, e.g. "kimi-k2.6") shown in the picker.
   * `undefined` means all available models for this provider are enabled (default).
   * An explicit array — including an empty one — overrides defaults. */
  enabledModels?: string[];
}

interface ScrollPositions {
  [conversationId: string]: number;
}

export interface MessageSearchResult {
  message_id: string;
  conversation_id: string;
  conversation_title: string;
  role: string;
  content_preview: string;
  created_at: number;
}

export type ArtifactKind = "html" | "latex" | "python";

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  code: string;
  messageId: string;
  createdAt: number;
}

interface ChatStore {
  conversations: Conversation[];
  activeId: string | null;
  /** Bumps every time `setActiveConversation` is called, even when the new id matches
   * the current one. Lets InputBar re-focus the textarea on repeated New chat presses. */
  focusNonce: number;
  messages: Record<string, Message[]>;
  selectedModelId: string | null;
  isStreaming: boolean;
  streamingConversationId: string | null;
  streamingAbortControllers: Record<string, AbortController>;
  searchQuery: string;
  scrollPositions: ScrollPositions;

  /** Per-provider user config (API keys, custom base URLs). Persisted. */
  providerConfigs: Record<string, ProviderConfig>;

  // Conversation actions
  createConversation: () => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setTitleGenerating: (id: string, generating: boolean) => void;
  setSystemPrompt: (id: string, systemPrompt: string) => void;
  setActiveConversation: (id: string | null) => void;

  // Message actions
  addMessage: (message: Omit<Message, "id" | "createdAt">) => Message;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  appendToMessage: (conversationId: string, messageId: string, chunk: string) => void;
  editMessage: (conversationId: string, messageId: string, newContent: string) => void;
  removeMessagesAfter: (conversationId: string, messageId: string) => void;
  addToolCallToMessage: (conversationId: string, messageId: string, tc: ToolCallEntry) => void;
  completeToolCall: (conversationId: string, messageId: string, toolCallId: string, output: unknown) => void;
  updateToolCallState: (conversationId: string, messageId: string, toolCallId: string, state: ToolCallEntry["state"]) => void;

  // Provider actions
  configureProvider: (providerId: string, config: ProviderConfig) => void;
  removeProvider: (providerId: string) => void;
  setEnabledModels: (providerId: string, modelIds: string[]) => void;

  // Model selection
  setSelectedModel: (modelId: string | null) => void;

  // UI actions
  setSearchQuery: (query: string) => void;
  // Streaming (per-conversation)
  setStreaming: (isStreaming: boolean) => void;
  startStreaming: (conversationId: string, ac: AbortController) => void;
  stopStreaming: (conversationId: string) => void;
  cancelStreaming: () => void;
  isConversationStreaming: (conversationId: string) => boolean;
  saveScrollPosition: (conversationId: string, position: number) => void;

  // Regenerate (non-persisted)
  resendPayload: { conversationId: string; content: string; attachments?: Attachment[] } | null;
  triggerResend: (conversationId: string, content: string, attachments?: Attachment[]) => void;
  clearResend: () => void;

  // Continue (non-persisted) — show "Continue" button after stream interruption
  continueConversationId: string | null;
  setContinueConversation: (id: string | null) => void;

  // Artifacts (non-persisted) — auto-detected code blocks rendered in side panel
  artifacts: Record<string, Artifact[]>;
  artifactPanelOpen: boolean;
  activeArtifactId: string | null;
  setArtifactPanelOpen: (open: boolean) => void;
  setActiveArtifact: (id: string | null) => void;
  detectArtifacts: (conversationId: string, messageId: string, content: string) => void;
  clearArtifacts: (conversationId: string) => void;

  // Sidebar (non-persisted)
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Default system prompt for new conversations
  defaultSystemPrompt: string;
  setDefaultSystemPrompt: (prompt: string) => void;

  // Workspace (non-persisted)
  workspacePath: string | null;
  setWorkspace: (path: string | null) => void;

  // Mode (chat vs agent)
  agentMode: boolean;
  setAgentMode: (enabled: boolean) => void;
  toggleAgentMode: () => void;

  // Permission mode: manual = approve every write, auto = auto-approve file edits
  // but still gate shell commands, yolo = approve everything without prompting.
  permissionMode: "manual" | "auto" | "yolo";
  setPermissionMode: (mode: "manual" | "auto" | "yolo") => void;
  // Legacy boolean kept for backward compat with older event log entries; mirrors
  // permissionMode === "yolo".
  autoApprove: boolean;
  setAutoApprove: (enabled: boolean) => void;
  toggleAutoApprove: () => void;

  // Provider health
  providerHealth: Record<string, { online: boolean; checkedAt: number }>;
  checkProviderHealth: (providerId: string, baseUrl: string) => Promise<void>;
  checkAllProvidersHealth: () => Promise<void>;

  // Message search
  messageSearchResults: MessageSearchResult[];
  messageSearchLoading: boolean;
  performMessageSearch: (query: string) => Promise<void>;
  clearMessageSearch: () => void;

  // Tool API keys
  tavilyApiKey: string;
  setTavilyApiKey: (key: string) => void;

  // Persistence
  _hydrated: boolean;
  hydrate: () => Promise<void>;
  finalizeStreamingMessage: (conversationId: string, messageId: string) => void;

  // Derived
  getProviders: () => Provider[];
  getModels: () => Model[];
  getFilteredConversations: () => Conversation[];
  getActiveConversation: () => Conversation | null;
  getActiveMessages: () => Message[];
  getActiveLlmConfig: () => LlmConfig | null;
}

const generateId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const BUILTIN_PROVIDERS = getBuiltInProviders();

export const CLOUD_PROVIDER_MODELS: Record<string, { id: string; name: string }[]> = {
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4.1", name: "GPT-4.1" },
  ],
  // anthropic: removed — API is not OpenAI-compatible, needs @ai-sdk/anthropic adapter
  "opencode-go": [
    { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash (Free)" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
    { id: "minimax-m2.5", name: "MiniMax M2.5" },
    { id: "minimax-m2.7", name: "MiniMax M2.7" },
    { id: "qwen3.5-plus", name: "Qwen 3.5 Plus" },
    { id: "qwen3.6-plus", name: "Qwen 3.6 Plus" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
    { id: "gemma2-9b-it", name: "Gemma 2 9B" },
  ],
};

const CLOUD_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  "opencode-go": "https://opencode.ai/zen/go/v1",
  groq: "https://api.groq.com/openai/v1",
};

export const useChatStore = create<ChatStore>()((set, get) => ({
      conversations: [],
      activeId: null,
      focusNonce: 0,
      messages: {},
      selectedModelId: null,
      isStreaming: false,
      streamingConversationId: null,
      streamingAbortControllers: {},
      searchQuery: "",
      scrollPositions: {},
      providerConfigs: {},
      resendPayload: null,
      continueConversationId: null,
      artifacts: {},
      artifactPanelOpen: false,
      activeArtifactId: null,
      sidebarOpen: true,
      defaultSystemPrompt: "",
      workspacePath: null,
      _hydrated: false,
      agentMode: false,
      autoApprove: false,
      permissionMode: "manual",
      providerHealth: {},
      messageSearchResults: [],
      messageSearchLoading: false,
      tavilyApiKey: "",

      createConversation: () => {
        const id = generateId();
        const now = Date.now();
        const defaultPrompt = get().defaultSystemPrompt;
        const conversation: Conversation = {
          id,
          title: "New Conversation",
          lastMessagePreview: "",
          lastMessageAt: now,
          createdAt: now,
          modelId: get().selectedModelId,
          systemPrompt: defaultPrompt,
        };
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeId: id,
          messages: { ...state.messages, [id]: [] },
        }));
        // Await so the conversation row exists before any message INSERT hits FK constraint
        persistConversation(conversation).catch((e) => console.error("[store] createConversation persist failed:", e));
        return id;
      },

      deleteConversation: (id: string) => {
        const { conversations, activeId, messages } = get();
        const remaining = conversations.filter((c) => c.id !== id);
        const newMessages = { ...messages };
        delete newMessages[id];
        let newActiveId = activeId;
        if (activeId === id) {
          newActiveId = remaining.length > 0 ? remaining[0].id : null;
        }
        set({ conversations: remaining, activeId: newActiveId, messages: newMessages });
        deleteConversationFromDb(id);
      },

      renameConversation: (id: string, title: string) => {
        set((state) => {
          const updated = state.conversations.map((c) =>
            c.id === id
              ? {
                  ...c,
                  title: title.trim() || c.title || "Untitled",
                  isGeneratingTitle: false,
                }
              : c
          );
          const changed = updated.find((c) => c.id === id);
          if (changed) persistConversation(changed);
          return { conversations: updated };
        });
      },

      setTitleGenerating: (id: string, generating: boolean) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, isGeneratingTitle: generating } : c
          ),
        }));
      },

      setSystemPrompt: (id: string, systemPrompt: string) => {
        set((state) => {
          const updated = state.conversations.map((c) =>
            c.id === id ? { ...c, systemPrompt } : c
          );
          const changed = updated.find((c) => c.id === id);
          if (changed) persistConversation(changed);
          return { conversations: updated };
        });
      },

      setActiveConversation: (id: string | null) => {
        // Bump focusNonce every call so InputBar re-runs its focus effect even when
        // the user re-selects the conversation that's already active (e.g. clicks
        // New chat twice while sitting on the empty new-chat state).
        set((state) => ({ activeId: id, focusNonce: state.focusNonce + 1 }));
        try { localStorage.setItem("goatllm-active-conversation", id ?? ""); } catch {}
      },

      addMessage: (messageData: Omit<Message, "id" | "createdAt">) => {
        const message: Message = { ...messageData, id: generateId(), createdAt: Date.now() };
        set((state) => {
          const convMessages = state.messages[message.conversationId] ?? [];
          const updatedMessages = [...convMessages, message];
          const preview = message.content.slice(0, 80) + (message.content.length > 80 ? "…" : "");
          // Title stays "New Conversation" until generateTitle replaces it with
          // an LLM-summarized title once the first assistant turn finishes.
          const updatedConversations = state.conversations.map((c) =>
            c.id === message.conversationId
              ? {
                  ...c,
                  lastMessagePreview: preview,
                  lastMessageAt: message.createdAt,
                }
              : c
          );
          // Persist conversation first (ensures FK target exists), then message
          const updatedConv = updatedConversations.find((c) => c.id === message.conversationId);
          if (updatedConv) {
            persistConversation(updatedConv)
              .then(() => persistMessage(message))
              .catch((e) => console.error("[store] addMessage persist failed:", e));
          } else {
            persistMessage(message).catch((e) => console.error("[store] addMessage persist failed:", e));
          }
          return {
            messages: { ...state.messages, [message.conversationId]: updatedMessages },
            conversations: updatedConversations,
          };
        });
        return message;
      },

      updateMessage: (conversationId, messageId, updates) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const updated = convMessages.map((m) =>
            m.id === messageId ? { ...m, ...updates } : m
          );
          const changed = updated.find((m) => m.id === messageId);
          if (changed) persistMessage(changed);
          return {
            messages: { ...state.messages, [conversationId]: updated },
          };
        });
      },

      appendToMessage: (conversationId, messageId, chunk) => {
        // No DB write during streaming — finalizeStreamingMessage handles it
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const updatedMessages = convMessages.map((m) =>
            m.id === messageId ? { ...m, content: m.content + chunk } : m
          );
          const updatedMsg = updatedMessages.find((m) => m.id === messageId);
          const preview = updatedMsg
            ? updatedMsg.content.slice(0, 80) + (updatedMsg.content.length > 80 ? "…" : "")
            : state.conversations.find((c) => c.id === conversationId)?.lastMessagePreview ?? "";
          return {
            messages: { ...state.messages, [conversationId]: updatedMessages },
            conversations: state.conversations.map((c) =>
              c.id === conversationId ? { ...c, lastMessagePreview: preview } : c
            ),
          };
        });
      },

      finalizeStreamingMessage: (conversationId, messageId) => {
        const { messages } = get();
        const convMessages = messages[conversationId] ?? [];
        const msg = convMessages.find((m) => m.id === messageId);
        if (msg) persistMessage(msg);
      },

      editMessage: (conversationId, messageId, newContent) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const updated = convMessages.map((m) =>
            m.id === messageId ? { ...m, content: newContent } : m
          );
          const changed = updated.find((m) => m.id === messageId);
          if (changed) persistMessage(changed);
          return {
            messages: { ...state.messages, [conversationId]: updated },
          };
        });
      },

      removeMessagesAfter: (conversationId, messageId) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const idx = convMessages.findIndex((m) => m.id === messageId);
          if (idx === -1) return state;
          // Delete removed messages from DB
          const removed = convMessages.slice(idx + 1);
          for (const rm of removed) deleteMessageFromDb(rm.id);
          const trimmed = convMessages.slice(0, idx + 1);
          return {
            messages: { ...state.messages, [conversationId]: trimmed },
          };
        });
      },

      addToolCallToMessage: (conversationId, messageId, tc) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const updated = convMessages.map((m) =>
            m.id === messageId
              ? { ...m, toolCalls: [...(m.toolCalls ?? []), tc] }
              : m
          );
          const changed = updated.find((m) => m.id === messageId);
          if (changed) persistMessage(changed);
          return {
            messages: { ...state.messages, [conversationId]: updated },
          };
        });
      },

      completeToolCall: (conversationId, messageId, toolCallId, output) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const updated = convMessages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  toolCalls: m.toolCalls?.map((tc) =>
                    tc.toolCallId === toolCallId
                      ? { ...tc, output, state: "done" as const }
                      : tc
                  ),
                }
              : m
          );
          const changed = updated.find((m) => m.id === messageId);
          if (changed) persistMessage(changed);
          return {
            messages: { ...state.messages, [conversationId]: updated },
          };
        });
      },

      updateToolCallState: (conversationId, messageId, toolCallId, newState) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const updated = convMessages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  toolCalls: m.toolCalls?.map((tc) =>
                    tc.toolCallId === toolCallId
                      ? { ...tc, state: newState }
                      : tc
                  ),
                }
              : m
          );
          const changed = updated.find((m) => m.id === messageId);
          if (changed) persistMessage(changed);
          return {
            messages: { ...state.messages, [conversationId]: updated },
          };
        });
      },

      triggerResend: (conversationId, content, attachments) => {
        set({ resendPayload: { conversationId, content, attachments } });
      },

      clearResend: () => {
        set({ resendPayload: null });
      },

      setContinueConversation: (id) => {
        set({ continueConversationId: id });
      },

      setArtifactPanelOpen: (open) => {
        set({ artifactPanelOpen: open });
      },

      setActiveArtifact: (id) => {
        set({ activeArtifactId: id, artifactPanelOpen: !!id, sidebarOpen: id ? false : get().sidebarOpen });
      },

      detectArtifacts: (conversationId, messageId, content) => {
        const artifacts: Artifact[] = [];
        const langMap: Record<string, ArtifactKind> = { html: "html", latex: "latex", tex: "latex", python: "python" };
        const titleMap: Record<ArtifactKind, string> = { html: "HTML", latex: "LaTeX", python: "Python" };

        // Extract fenced code blocks: ```lang\ncode\n```
        const fenceRe = /```(\w+)\n([\s\S]*?)```/g;
        let match;
        while ((match = fenceRe.exec(content)) !== null) {
          const lang = match[1].toLowerCase();
          const code = match[2].trim();
          const kind = langMap[lang];
          if (kind && code.length > 0) {
            const id = `${messageId}-${artifacts.length}`;
            const firstLine = code.split("\n")[0].slice(0, 60);
            artifacts.push({
              id,
              kind,
              title: firstLine || titleMap[kind],
              code,
              messageId,
              createdAt: Date.now(),
            });
          }
        }

        if (artifacts.length > 0) {
          set((state) => ({
            artifacts: { ...state.artifacts, [conversationId]: [...(state.artifacts[conversationId] ?? []), ...artifacts] },
            artifactPanelOpen: true,
            activeArtifactId: artifacts[0].id,
          }));
        }
      },

      clearArtifacts: (conversationId) => {
        set((state) => {
          const next = { ...state.artifacts };
          delete next[conversationId];
          return { artifacts: next, activeArtifactId: null, artifactPanelOpen: false };
        });
      },

      setSidebarOpen: (open) => {
        set({ sidebarOpen: open });
      },

      toggleSidebar: () => {
        set((s) => ({ sidebarOpen: !s.sidebarOpen }));
      },

      setDefaultSystemPrompt: (prompt) => {
        set({ defaultSystemPrompt: prompt });
        try { localStorage.setItem("goatllm-default-system-prompt", prompt); } catch {}
      },

      setWorkspace: (path) => {
        set({ workspacePath: path });
        try { localStorage.setItem("goatllm-workspace-path", path ?? ""); } catch {}
      },

      setAgentMode: (enabled) => {
        set({ agentMode: enabled });
        try { localStorage.setItem("goatllm-agent-mode", String(enabled)); } catch {}
      },

      toggleAgentMode: () => {
        set((state) => ({ agentMode: !state.agentMode }));
      },

      setAutoApprove: (enabled) => {
        set({ autoApprove: enabled, permissionMode: enabled ? "yolo" : "manual" });
      },

      toggleAutoApprove: () => {
        set((state) => {
          const next = !state.autoApprove;
          return { autoApprove: next, permissionMode: next ? "yolo" : "manual" };
        });
      },

      setPermissionMode: (mode) => {
        set({ permissionMode: mode, autoApprove: mode === "yolo" });
        try { localStorage.setItem("goatllm-permission-mode", mode); } catch {}
      },

      // ── Provider health checks ──

      checkProviderHealth: async (providerId, baseUrl) => {
        const now = Date.now();
        try {
          const { initFetch } = await import("../lib/fetch-adapter");
          const customFetch = await initFetch();

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);

          await customFetch(`${baseUrl}/models`, {
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
          });
          clearTimeout(timeout);

          // Any response (even 401/403) means the server is reachable
          set((state) => ({
            providerHealth: {
              ...state.providerHealth,
              [providerId]: { online: true, checkedAt: now },
            },
          }));
        } catch {
          set((state) => ({
            providerHealth: {
              ...state.providerHealth,
              [providerId]: { online: false, checkedAt: now },
            },
          }));
        }
      },

      checkAllProvidersHealth: async () => {
        const { getProviders } = get();
        const providers = getProviders();
        const checks = providers
          .filter((p) => p.isBuiltIn && p.baseUrl)
          .map((p) => get().checkProviderHealth(p.id, p.baseUrl));
        await Promise.allSettled(checks);
      },

      performMessageSearch: async (query) => {
        if (!query.trim()) {
          set({ messageSearchResults: [], messageSearchLoading: false });
          return;
        }
        set({ messageSearchLoading: true });
        try {
          const results = await searchMessages(query);
          set({ messageSearchResults: results, messageSearchLoading: false });
        } catch {
          set({ messageSearchResults: [], messageSearchLoading: false });
        }
      },

      clearMessageSearch: () => {
        set({ messageSearchResults: [], messageSearchLoading: false });
      },

      setTavilyApiKey: (key) => {
        set({ tavilyApiKey: key });
        try { localStorage.setItem("goatllm-tavily-key", key); } catch {}
      },

      configureProvider: (providerId, config) => {
        set((state) => {
          const newConfigs = { ...state.providerConfigs, [providerId]: config };
          saveProviderConfigs(newConfigs);
          return { providerConfigs: newConfigs };
        });
      },

      removeProvider: (providerId) => {
        set((state) => {
          const newConfigs = { ...state.providerConfigs };
          delete newConfigs[providerId];
          saveProviderConfigs(newConfigs);
          return { providerConfigs: newConfigs };
        });
      },

      setEnabledModels: (providerId, modelIds) => {
        set((state) => {
          const existing = state.providerConfigs[providerId];
          if (!existing) return {};
          const newConfigs = {
            ...state.providerConfigs,
            [providerId]: { ...existing, enabledModels: [...modelIds] },
          };
          saveProviderConfigs(newConfigs);
          return { providerConfigs: newConfigs };
        });
      },

      setSelectedModel: (modelId) => {
        set({ selectedModelId: modelId });
        try { localStorage.setItem("goatllm-selected-model", modelId ?? ""); } catch {}
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      setStreaming: (isStreaming) => {
        set({ isStreaming });
      },

      startStreaming: (conversationId, ac) => {
        set((state) => ({
          streamingConversationId: conversationId,
          streamingAbortControllers: { ...state.streamingAbortControllers, [conversationId]: ac },
        }));
      },

      stopStreaming: (conversationId) => {
        set((state) => {
          const controllers = { ...state.streamingAbortControllers };
          delete controllers[conversationId];
          const remaining = Object.keys(controllers);
          return {
            streamingConversationId: remaining.length > 0 ? remaining[0] : null,
            streamingAbortControllers: controllers,
          };
        });
      },

      cancelStreaming: () => {
        const { activeId, streamingAbortControllers } = get();
        if (!activeId) return;
        const ac = streamingAbortControllers[activeId];
        if (ac) {
          ac.abort();
          set((state) => {
            const controllers = { ...state.streamingAbortControllers };
            delete controllers[activeId];
            return {
              streamingConversationId: null,
              streamingAbortControllers: controllers,
            };
          });
        }
      },

      isConversationStreaming: (conversationId) => {
        return conversationId in get().streamingAbortControllers;
      },

      saveScrollPosition: (conversationId, position) => {
        set((state) => ({
          scrollPositions: { ...state.scrollPositions, [conversationId]: position },
        }));
      },

      getProviders: () => {
        const { providerConfigs, providerHealth } = get();
        const providers: Provider[] = BUILTIN_PROVIDERS.map((bp) => {
          const health = providerHealth[bp.id];
          const checked = health !== undefined;
          return {
            id: bp.id,
            name: bp.name,
            // Optimistic: assume online until first check fails
            isOnline: health ? health.online : true,
            healthChecked: checked,
            isBuiltIn: true,
            baseUrl: bp.baseUrl,
          };
        });
        // Add user-configured cloud providers
        const knownNames: Record<string, string> = {
          openai: "OpenAI",
          "opencode-go": "OpenCode Go",
          groq: "Groq",
        };
        for (const [id, config] of Object.entries(providerConfigs)) {
          if (!BUILTIN_PROVIDERS.find((bp) => bp.id === id)) {
            const hasKey = !!config.apiKey;
            providers.push({
              id,
              name: knownNames[id] ?? id.charAt(0).toUpperCase() + id.slice(1),
              isOnline: hasKey,
              healthChecked: true,
              isBuiltIn: false,
              baseUrl: config.baseUrl ?? CLOUD_PROVIDER_BASE_URLS[id] ?? "",
            });
          }
        }
        return providers;
      },

      getModels: () => {
        const { providerConfigs, providerHealth } = get();
        const models: Model[] = [];
        // Built-in models
        for (const bp of BUILTIN_PROVIDERS) {
          const health = providerHealth[bp.id];
          // Optimistic: assume online until first check fails
          const providerOnline = health ? health.online : true;
          for (const m of bp.models) {
            models.push({
              id: `${bp.id}:${m.id}`,
              name: m.name,
              providerId: bp.id,
              isAvailable: providerOnline,
            });
          }
        }
        // Cloud provider models from user config
        for (const [providerId, config] of Object.entries(providerConfigs)) {
          if (!BUILTIN_PROVIDERS.find((bp) => bp.id === providerId)) {
            const cloudModels = CLOUD_PROVIDER_MODELS[providerId] ?? [];
            const allowlist = config.enabledModels;
            for (const m of cloudModels) {
              if (allowlist && !allowlist.includes(m.id)) continue;
              models.push({
                id: `${providerId}:${m.id}`,
                name: m.name,
                providerId,
                isAvailable: !!config.apiKey,
              });
            }
          }
        }
        return models;
      },

      getFilteredConversations: () => {
        const { conversations, searchQuery } = get();
        if (!searchQuery.trim()) return conversations;
        const q = searchQuery.toLowerCase();
        return conversations.filter(
          (c) => c.title.toLowerCase().includes(q) || c.lastMessagePreview.toLowerCase().includes(q)
        );
      },

      getActiveConversation: () => {
        const { conversations, activeId } = get();
        return conversations.find((c) => c.id === activeId) ?? null;
      },

      getActiveMessages: () => {
        const { messages, activeId } = get();
        if (!activeId) return [];
        return messages[activeId] ?? [];
      },

      // ── Hydration ──

      hydrate: async () => {
        if (get()._hydrated) return;
        const savedModeRaw = localStorage.getItem("goatllm-permission-mode");
        const savedMode: "manual" | "auto" | "yolo" =
          savedModeRaw === "auto" || savedModeRaw === "yolo" ? savedModeRaw : "manual";
        try {
          const data = await loadAllFromDb();
          const providerConfigs = loadProviderConfigs();
          const savedModel = localStorage.getItem("goatllm-selected-model") || null;
          const tavilyKey = localStorage.getItem("goatllm-tavily-key") || "";
          // Re-detect artifacts from loaded messages so they survive restarts
          const restoredArtifacts: Record<string, Artifact[]> = {};
          for (const [convId, msgs] of Object.entries(data.messages)) {
            for (const msg of msgs) {
              if (msg.role !== "assistant" || !msg.content) continue;
              const langMap: Record<string, ArtifactKind> = { html: "html", latex: "latex", tex: "latex", python: "python" };
              const fenceRe = /```(\w+)\n([\s\S]*?)```/g;
              let match;
              while ((match = fenceRe.exec(msg.content)) !== null) {
                const lang = match[1].toLowerCase();
                const code = match[2].trim();
                const kind = langMap[lang];
                if (kind && code.length > 0) {
                  const count = restoredArtifacts[convId]?.length ?? 0;
                  const id = `${msg.id}-${count}`;
                  if (!restoredArtifacts[convId]) restoredArtifacts[convId] = [];
                  restoredArtifacts[convId].push({
                    id, kind,
                    title: code.split("\n")[0].slice(0, 60) || kind,
                    code,
                    messageId: msg.id,
                    createdAt: msg.createdAt,
                  });
                }
              }
            }
          }

          const agentMode = localStorage.getItem("goatllm-agent-mode") === "true";
          const workspacePath = localStorage.getItem("goatllm-workspace-path") || null;
          const defaultSystemPrompt = localStorage.getItem("goatllm-default-system-prompt") || "";
          const activeId = localStorage.getItem("goatllm-active-conversation") || null;
          // Only restore activeId if that conversation actually exists in loaded data
          const validActiveId = activeId && data.conversations.some((c) => c.id === activeId) ? activeId : null;

          set({
            conversations: data.conversations,
            messages: data.messages,
            providerConfigs,
            selectedModelId: savedModel,
            tavilyApiKey: tavilyKey,
            permissionMode: savedMode,
            autoApprove: savedMode === "yolo",
            artifacts: restoredArtifacts,
            agentMode,
            workspacePath,
            defaultSystemPrompt,
            activeId: validActiveId,
            _hydrated: true,
          });
        } catch (e) {
          console.warn("[store] Failed to hydrate from DB, using empty state:", e);
          const providerConfigs = loadProviderConfigs();
          const savedModel = localStorage.getItem("goatllm-selected-model") || null;
          const tavilyKey = localStorage.getItem("goatllm-tavily-key") || "";
          const agentMode = localStorage.getItem("goatllm-agent-mode") === "true";
          const workspacePath = localStorage.getItem("goatllm-workspace-path") || null;
          const defaultSystemPrompt = localStorage.getItem("goatllm-default-system-prompt") || "";
          set({
            providerConfigs,
            selectedModelId: savedModel,
            tavilyApiKey: tavilyKey,
            permissionMode: savedMode,
            agentMode,
            workspacePath,
            defaultSystemPrompt,
            autoApprove: savedMode === "yolo",
            _hydrated: true,
          });
        }
      },

      // ── Derived ──

      getActiveLlmConfig: (): LlmConfig | null => {
        const { selectedModelId, providerConfigs } = get();
        if (!selectedModelId) return null;

        const [providerId, ...modelIdParts] = selectedModelId.split(":");
        const modelId = modelIdParts.join(":"); // handles model IDs with colons

        // Built-in local provider
        const builtin = BUILTIN_PROVIDERS.find((bp) => bp.id === providerId);
        if (builtin) {
          return {
            provider: providerId as LlmConfig["provider"],
            modelId,
            apiKey: null,
            baseUrl: builtin.baseUrl,
          };
        }

        // User-configured cloud provider
        const config = providerConfigs[providerId];
        if (config) {
          let baseUrl = config.baseUrl || CLOUD_PROVIDER_BASE_URLS[providerId];
          if (providerId === "opencode-go" && modelId.endsWith("-free")) {
            baseUrl = baseUrl.replace("/go/v1", "/v1").replace("/go/", "/");
          }
          return {
            provider: providerId as LlmConfig["provider"],
            modelId,
            apiKey: config.apiKey,
            baseUrl,
          };
        }

        return null;
      },
    }));
