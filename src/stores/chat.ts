import { create } from "zustand";
import type { LlmConfig } from "../lib/llm";
import { heuristicTitle } from "../lib/llm";
import { getBuiltInProviders, getCuratedModels, getProviderBaseUrl, getProviderInfo, mergeDiscoveredModels, providerSupportsDiscovery } from "../lib/providers";
import type { ModelConfig, ProviderCompat, ThinkingBudgets, ThinkingLevelMap } from "../lib/providers";
import { getZenCredential, ZEN_FREE_PROVIDER_ID } from "../lib/zen-credentials";
import type { Skill } from "../lib/skills";
import type { ProjectCheckMemory, VerificationPolicy } from "../lib/agent-session";
import type { AgentBudgetControls, PathPermissionRule } from "../lib/agent-session";
import {
  sanitizeImageJobs,
  sanitizeModelComparisonRuns,
  sanitizeNotebookCells,
  sanitizeScheduledAgents,
} from "../lib/product-workspace";
import type { NotebookCell, SyncConfig, WatcherEventSummaryInput } from "../lib/product-workspace";
import {
  createBoard,
  createNotebook,
  sanitizeNotebooks,
  migrateLegacyBoard,
  type CanvasBoard,
  type Notebook,
} from "../lib/canvas";
import {
  loadAllFromDb,
  loadMessagesForConversation,
  persistConversation,
  persistMessage,
  persistCompactionEntry,
  deleteConversationFromDb,
  deleteMessageFromDb,
  searchMessages,
} from "../lib/db";
import {
  createDocumentWorkspace as createKnowledgeWorkspace,
  deletePersistedDocumentWorkspace,
  loadDocumentWorkspaces,
  persistDocumentWorkspaces,
  sanitizeDocumentWorkspaces,
  type DocumentWorkspace,
  type KnowledgeDocument,
} from "../lib/document-workspace";
import {
  appendScheduledRun,
  buildContinueScheduledRunPrompt,
  computeNextScheduledRun,
  createScheduledAgentRun,
  loadScheduledAgentState,
  persistScheduledAgentState,
  sanitizeScheduledAgentRuns,
  updateScheduledAgentAfterRun,
  type ScheduledAgentRun,
} from "../lib/scheduled-agents";
import {
  DEFAULT_MEMORY_EXTRACTION_SETTINGS,
  loadMemoryExtractionSettings,
  loadMemoryExtractionSettingsFromJournal,
  persistMemoryExtractionSettings,
  sanitizeMemoryExtractionSettings,
  type MemoryExtractionSettings,
} from "../lib/memory-extraction";
import {
  buildContinueMeetingPrompt,
  loadMeetingState,
  loadMeetingStateFromJournal,
  persistMeetingState,
  sanitizeMeetingSessions,
  sanitizeMeetingSettings,
  type MeetingSession,
  type MeetingSettings,
} from "../lib/meeting-assistant";
import { isEditArtifact, parseEditBlocks, applyEditBlocks } from "../lib/artifact-edits";
import type { TaskBoard } from "../lib/tools/todo";
import { contextWindowFromOllamaShow, normalizeProviderModels } from "../lib/model-detection";
import {
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionEntry,
  type CompactionSettings,
  type CompactionSummaryMetadata,
} from "../lib/compaction/types";

const PROVIDER_CONFIGS_KEY = "goatllm-provider-configs";
const MODEL_OVERRIDES_KEY = "goatllm-model-overrides";
const VERIFICATION_POLICY_KEY = "goatllm-verification-policy";
const PROJECT_CHECK_MEMORY_KEY = "goatllm-project-check-memory";
const PERMISSION_PROFILE_KEY = "goatllm-permission-profile";
const CHECKPOINT_NAMES_KEY = "goatllm-checkpoint-names";
const PATH_PERMISSION_RULES_KEY = "goatllm-path-permission-rules";
const AGENT_BUDGET_CONTROLS_KEY = "goatllm-agent-budget-controls";
const PRODUCT_WORKSPACE_STATE_KEY = "goatllm-product-workspace-state";
const USAGE_SETTINGS_KEY = "goatllm-usage-settings";
const VOICE_SETTINGS_KEY = "goatllm-voice-settings";
const SYNC_SETTINGS_KEY = "goatllm-sync-settings";
const IMAGE_GEN_SETTINGS_KEY = "goatllm-image-gen-settings";
const FEATURE_FLAGS_KEY = "goatllm-feature-flags";
const PLUS_MENU_VISIBILITY_KEY = "goatllm-plus-menu-visibility";
const NOTEBOOK_CELLS_KEY = "goatllm-notebook-cells";
const CANVAS_BOARD_KEY = "goatllm-canvas-board";
const NOTEBOOKS_KEY = "goatllm-notebooks";
const ACTIVE_NOTEBOOK_KEY = "goatllm-active-notebook";
const MODEL_COMPARISON_RUNS_KEY = "goatllm-model-comparison-runs";
const IMAGE_JOBS_KEY = "goatllm-image-jobs";
const SCHEDULED_AGENTS_KEY = "goatllm-scheduled-agents";
const WATCHER_EVENTS_KEY = "goatllm-watcher-events";
const RAG_SETTINGS_KEY = "goatllm-rag-settings";
const ACTIVE_DOCUMENT_WORKSPACE_KEY = "goatllm-active-document-workspace";
const BRANCH_TIPS_KEY = "goatllm-active-branch-tips";
const MESSAGE_QUEUE_KEY = "goatllm-message-queue";

const DEFAULT_VERIFICATION_POLICY: VerificationPolicy = {
  requireBuildForWeb: true,
  requireRustTests: true,
  customCommands: [],
};

const DEFAULT_PROJECT_CHECK_MEMORY: ProjectCheckMemory = {
  successfulCommands: [],
  flakyCommands: [],
  failedCommands: {},
};

const DEFAULT_AGENT_BUDGET_CONTROLS: AgentBudgetControls = {
  maxToolCalls: 24,
  maxSubagents: 3,
  maxMinutes: 20,
};

const DEFAULT_PRODUCT_WORKSPACE_STATE: ProductWorkspaceState = {
  workspacePanelOpen: false,
  workspacePanelTab: "usage",
};

const DEFAULT_USAGE_SETTINGS: UsageSettings = {
  monthlyBudgetUsd: 25,
  expensiveSessionUsd: 1,
  showInlineAlerts: true,
  priceOverrides: {},
  compactionSettings: DEFAULT_COMPACTION_SETTINGS,
};

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: true,
  handsFree: false,
  autoPlayAssistant: false,
  voiceURI: "",
  rate: 1,
  pitch: 1,
};

const DEFAULT_SYNC_SETTINGS: SyncConfig = {
  enabled: false,
  provider: "icloud",
  prefix: "goatllm",
  encryptionKeyHint: "",
  remoteLabel: "iCloud Drive",
};

const DEFAULT_IMAGE_GEN_SETTINGS: ImageGenSettings = {
  provider: "openai",
  model: "gpt-image-1.5",
  customEndpoint: "",
  size: "1024x1024",
};

const DEFAULT_FEATURE_FLAGS: ProductFeatureFlags = {
  costDashboard: true,
  modelComparison: true,
  browserMirror: true,
  // Notebook is a work in progress — off by default; enable in Advanced settings.
  notebookMode: false,
  imageGeneration: true,
  cloudSync: true,
  promptLibrary: true,
  scheduledAgents: true,
  ragMemory: true,
  filesystemWatcher: true,
  pursueGoal: true,
};

const DEFAULT_PLUS_MENU_VISIBILITY: PlusMenuVisibility = {
  chat: {
    upload: true,
    pursueGoal: false,
    image: false,
    plan: false,
    research: false,
    skills: false,
  },
  design: {
    upload: true,
    pursueGoal: false,
    image: false,
    plan: false,
    research: false,
    skills: false,
  },
  agent: {
    upload: true,
    pursueGoal: true,
    image: true,
    plan: true,
    research: false,
    skills: true,
  },
};

const DEFAULT_BROWSER_MIRROR: BrowserMirrorState = {
  visible: false,
  sessionId: null,
  url: "",
  title: "Browser",
  screenshotDataUrl: null,
  updatedAt: null,
  status: "idle",
};

const DEFAULT_RAG_SETTINGS: RagSettings = {
  projectMemory: true,
  conversationMemory: true,
  retrievalPreview: true,
  maxRetrievedMemories: 8,
  provenance: true,
};

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

function loadModelOverrides(): Record<string, ModelOverride> {
  try {
    const raw = localStorage.getItem(MODEL_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveModelOverrides(overrides: Record<string, ModelOverride>) {
  try {
    localStorage.setItem(MODEL_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // ignore quota errors
  }
}

function loadVerificationPolicy(): VerificationPolicy {
  try {
    const raw = localStorage.getItem(VERIFICATION_POLICY_KEY);
    return raw ? { ...DEFAULT_VERIFICATION_POLICY, ...JSON.parse(raw) } : DEFAULT_VERIFICATION_POLICY;
  } catch {
    return DEFAULT_VERIFICATION_POLICY;
  }
}

function saveVerificationPolicy(policy: VerificationPolicy) {
  try {
    localStorage.setItem(VERIFICATION_POLICY_KEY, JSON.stringify(policy));
  } catch {
    // ignore quota errors
  }
}

function loadProjectCheckMemory(): ProjectCheckMemory {
  try {
    const raw = localStorage.getItem(PROJECT_CHECK_MEMORY_KEY);
    return raw ? { ...DEFAULT_PROJECT_CHECK_MEMORY, ...JSON.parse(raw) } : DEFAULT_PROJECT_CHECK_MEMORY;
  } catch {
    return DEFAULT_PROJECT_CHECK_MEMORY;
  }
}

function saveProjectCheckMemory(memory: ProjectCheckMemory) {
  try {
    localStorage.setItem(PROJECT_CHECK_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // ignore quota errors
  }
}

function loadJsonSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function loadJsonValue<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function saveJsonSetting(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

function loadUsageSettings(): UsageSettings {
  const loaded = loadJsonSetting<UsageSettings>(USAGE_SETTINGS_KEY, DEFAULT_USAGE_SETTINGS);
  return {
    ...DEFAULT_USAGE_SETTINGS,
    ...loaded,
    priceOverrides: loaded.priceOverrides ?? {},
    compactionSettings: {
      ...DEFAULT_COMPACTION_SETTINGS,
      ...(loaded.compactionSettings ?? {}),
    },
  };
}

// Reset runtime-only "running" status on load (no stuck spinners). The actual
// rule lives in sanitizeNotebookCells. See CLAUDE.md "Persistence for New Features".
function loadNotebookCells(): NotebookCell[] {
  return sanitizeNotebookCells(loadJsonValue<NotebookCell[]>(NOTEBOOK_CELLS_KEY, []));
}

// Notebooks (a collection of named multi-panel boards + assistant threads).
// Sanitize on load so streaming chat messages and running code panels never
// restore mid-flight. On first run after the multi-notebook upgrade, fold any
// legacy single canvas board into one notebook so existing work survives, then
// drop the legacy key. See CLAUDE.md "Persistence for New Features".
function loadNotebooks(): Notebook[] {
  const rawNotebooks = localStorage.getItem(NOTEBOOKS_KEY);
  if (rawNotebooks === null) {
    // No notebooks key yet — attempt one-time migration from the legacy board.
    const legacy = loadJsonValue<CanvasBoard>(CANVAS_BOARD_KEY, createBoard());
    const migrated = migrateLegacyBoard(legacy, null);
    if (migrated.length > 0) {
      saveJsonSetting(NOTEBOOKS_KEY, migrated);
      try {
        localStorage.removeItem(CANVAS_BOARD_KEY);
      } catch {
        // ignore
      }
    }
    return migrated;
  }
  return sanitizeNotebooks(loadJsonValue<Notebook[]>(NOTEBOOKS_KEY, []));
}

// Pick the active notebook id on hydrate: the persisted one if it still exists,
// otherwise the most recently updated notebook (or null when there are none).
function resolveActiveNotebookId(notebooks: Notebook[]): string | null {
  const stored = loadJsonValue<string | null>(ACTIVE_NOTEBOOK_KEY, null);
  if (stored && notebooks.some((n) => n.id === stored)) return stored;
  if (notebooks.length === 0) return null;
  return [...notebooks].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
}

export type MessageRole = "user" | "assistant" | "system" | "tool" | "compactionSummary";

export interface Attachment {
  filename: string;
  mimeType: string;
  dataUrl: string; // base64 data URI for images, text/plain data URI for text files
  sizeBytes: number;
}

/** A source the assistant drew on for a chat-mode reply. Surfaced as a
 *  clickable "Sources" element under the message. Only the sources the model
 *  actually referenced inline (via a `[n]` marker matching the source number)
 *  are stored — availability alone never produces a citation.
 *
 *  Chat mode only. Agent/design turns expose their sources as tool-call pills
 *  instead, so they never populate this field. */
export interface Citation {
  /** 1-based number the model cites inline, e.g. `[1]`. Matches the order
   *  sources were registered this turn (documents first, then web results). */
  index: number;
  /** Where the source came from. */
  type: "web" | "document";
  /** Display label — page title for web, filename for a document. */
  title: string;
  /** Absolute URL for web sources. Undefined for documents. */
  url?: string;
  /** Short excerpt of the source content, shown under the title. */
  snippet?: string;
}

export interface ToolCallEntry {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  state: "running" | "done" | "error" | "pending_approval";
  /** For write/edit calls, the file state captured immediately before execution. */
  rollbackSnapshot?: {
    path: string;
    existed: boolean;
    content: string;
    capturedAt: number;
  };
  /** True when a tool ran under the subagent approval bypass. */
  approvalBypassed?: boolean;
  /** Danger classification for exec_command (set during onToolCall). */
  dangerLevel?: "safe" | "suspicious" | "destructive";
  /** Human-readable danger reason. */
  dangerReason?: string | null;
  /** Length of message content at the time this tool call was added. Used to
   * interleave tool calls with text in chronological order. */
  contentAtInvocation?: number;
  /** Full subagent conversation transcript for spawn_subagent tool calls.
   *  Rendered as a nested chat thread when the user expands the pill. */
  subagentTranscript?: import("../lib/llm-types").SubagentTranscriptEntry[];
}

export type DeepResearchPhase =
  | "planning"
  | "searching"
  | "reading"
  | "analyzing"
  | "writing"
  | "done"
  | "error"
  | "warning";

export interface DeepResearchEvent {
  id: string;
  phase: DeepResearchPhase;
  message: string;
  at: number;
}

export interface DeepResearchState {
  query: string;
  phase: DeepResearchPhase;
  startedAt: number;
  round?: number;
  queries?: number;
  sourceCount?: number;
  findingCount?: number;
  sources?: string[];
  findings?: any[];
  currentSource?: {
    title?: string;
    url: string;
  };
  events: DeepResearchEvent[];
  error?: string;
  planTitle?: string;
  planSteps?: string[];
  planApproved?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  isStreaming?: boolean;
  /** Thinking/reasoning content from the model (e.g. Claude extended
   *  thinking, DeepSeek R1). Stored separately from content so it can
   *  be rendered in a collapsible section. */
  thinkingContent?: string;
  /** Parent message id for tree-structured sessions. Enables branching:
   *  when the user edits a message and resends, the new message points
   *  to the original as its parent, creating a branch. null = root. */
  parentId?: string | null;
  /** True for assistant messages that were streaming when the app closed.
   *  Set during hydrate when we find an `isStreaming: true` row with no live
   *  abort controller. The UI shows a "Continue" affordance so the user can
   *  re-send the conversation from that point instead of leaving a stuck
   *  partial message. */
  interrupted?: boolean;
  attachments?: Attachment[];
  toolCalls?: ToolCallEntry[];
  /** Pinned messages survive context-manager compaction. */
  pinned?: boolean;
  /** Skills that were active when this message was sent (for user messages)
   *  or received (for assistant messages). Shown as badges in the UI. */
  activeSkillNames?: string[];
  /** Token usage stats from the LLM provider. */
  outputTokens?: number;
  inputTokens?: number;
  usage?: {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** Model used for this turn. Stored on assistant messages for usage/cost breakdowns. */
  modelId?: string;
  /** Streaming duration in milliseconds (from first token to onDone). */
  streamingDurationMs?: number;
  /** Wall-clock turn duration including tool execution (ms). */
  turnDurationMs?: number;
  /** Workspace-relative paths written/edited during this turn. */
  editedFiles?: string[];
  /** Result of restoring this turn's rollback checkpoint, if attempted. */
  rollbackResult?: {
    status: "done" | "error";
    files: string[];
    completedAt: number;
    error?: string;
  };
  /** True for user messages that were sent via "Steer" — i.e. they
   *  interrupted an in-flight turn to redirect it. Surfaced as a small badge
   *  so the thread makes clear the conversation was steered mid-stream. */
  steered?: boolean;
  /** Live Deep Research progress metadata. Final reports remain normal markdown content. */
  deepResearch?: DeepResearchState;
  /** Sources this assistant message cited inline (chat mode only). Populated
   *  in onDone from the turn's citation registry, filtered to the `[n]`
   *  markers that actually appear in the final content. */
  citations?: Citation[];
  /** Metadata for hydrate-time synthetic compaction summary messages. */
  compaction?: CompactionSummaryMetadata;
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
  /** Which mode this conversation was started in. Drives sidebar filtering
   *  so design conversations don't bleed into the chat list and vice
   *  versa. Older rows without a mode default to "chat". */
  mode?: "chat" | "agent" | "design";
  /** Workspace path this conversation belongs to (agent mode). */
  workspacePath?: string | null;
  /** Skills that are active for this conversation. Each SKILL.md content gets
   *  injected into the system prompt for every turn until the user toggles
   *  them off. */
  activeSkillNames?: string[];
  /** Archived conversations are hidden from the main sidebar and live in
   *  the collapsible "Archived" section at the bottom. Same data otherwise. */
  archived?: boolean;
  /** User-managed tag list. Stored as a JSON array on the row; surfaces as
   *  filter chips above the sidebar list and per-conversation context-menu
   *  manager. Lowercase, free-form. */
  tags?: string[];
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
  /** Maximum input tokens this model accepts. For local models this comes
   * from `/api/show` (Ollama) or the LM Studio `/v1/models` extras; for
   * cloud models it's pulled from the static catalog. */
  contextWindow: number;
  /** Whether this model can read images natively. Used at send time to
   *  warn or OCR-fallback when the user attaches images to a text-only
   *  model. Undefined means "unknown" — we treat that as text-only to
   *  avoid silently dropping images on a model that can't see. */
  vision?: boolean;
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  thinkingBudgets?: ThinkingBudgets;
}

/** Per-model overrides a user can set via the gear icon in the model
 *  picker dropdown. Keyed by the combined model id ("providerId:modelId").
 *  Persisted to localStorage alongside provider configs. */
export interface ModelOverride {
  /** Override the auto-detected context window (max input tokens). */
  contextWindow?: number;
  /** Override the provider-default max response/output tokens. */
  maxResponseTokens?: number;
  /** Reasoning/thinking effort: "off" | "minimal" | "low" | "medium" | "high" | "xhigh". */
  reasoningEffort?: string;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  compat?: ProviderCompat;
  models?: ModelConfig[];
  /** Allowlist of model IDs (provider-local, e.g. "kimi-k2.6") shown in the picker.
   * `undefined` means all available models for this provider are enabled (default).
   * An explicit array — including an empty one — overrides defaults. */
  enabledModels?: string[];
}

export type ProductWorkspaceTab =
  | "usage"
  | "compare"
  | "branches"
  | "browser"
  | "notebook"
  | "images"
  | "prompts"
  | "schedules"
  | "memory"
  | "sync"
  | "watcher";

export interface UsageSettings {
  monthlyBudgetUsd: number;
  expensiveSessionUsd: number;
  showInlineAlerts: boolean;
  priceOverrides: Record<string, { inputPerMillion: number; outputPerMillion: number }>;
  compactionSettings: CompactionSettings;
}

export interface VoiceSettings {
  enabled: boolean;
  handsFree: boolean;
  autoPlayAssistant: boolean;
  voiceURI: string;
  rate: number;
  pitch: number;
}

export interface ProductFeatureFlags {
  costDashboard: boolean;
  modelComparison: boolean;
  browserMirror: boolean;
  notebookMode: boolean;
  imageGeneration: boolean;
  cloudSync: boolean;
  promptLibrary: boolean;
  scheduledAgents: boolean;
  ragMemory: boolean;
  filesystemWatcher: boolean;
  pursueGoal: boolean;
}

export interface PlusMenuVisibility {
  chat: Record<string, boolean>;
  design: Record<string, boolean>;
  agent: Record<string, boolean>;
}

export interface QueuedMessage {
  content: string;
}

export interface BrowserMirrorState {
  visible: boolean;
  sessionId: string | null;
  url: string;
  title: string;
  screenshotDataUrl: string | null;
  updatedAt: number | null;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
}

export interface ModelComparisonResult {
  modelId: string;
  status: "queued" | "running" | "done" | "error";
  content: string;
  latencyMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface ModelComparisonRun {
  id: string;
  prompt: string;
  modelIds: string[];
  createdAt: number;
  results: ModelComparisonResult[];
}

export interface ImageGenerationJob {
  id: string;
  prompt: string;
  provider: "openai" | "flux" | "stable-diffusion" | "custom";
  status: "queued" | "running" | "done" | "error";
  createdAt: number;
  imageDataUrl?: string;
  artifactId?: string;
  error?: string;
}

export interface ImageGenSettings {
  provider: "openai" | "ollama" | "flux" | "stable-diffusion" | "custom";
  model: string;
  customEndpoint: string;
  size: string;
}

export interface ScheduledAgent {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  lastResult?: string;
  lastStatus?: "idle" | "running" | "done" | "error";
}

export interface RagSettings {
  projectMemory: boolean;
  conversationMemory: boolean;
  retrievalPreview: boolean;
  maxRetrievedMemories: number;
  provenance: boolean;
}

export interface ProductWorkspaceState {
  workspacePanelOpen: boolean;
  workspacePanelTab: ProductWorkspaceTab;
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

export type ArtifactKind = 
  | "html" 
  | "latex" 
  | "python" 
  | "docx" 
  | "pptx" 
  | "xlsx"
  | "deck"              // HTML-based presentation slides
  | "react-component"   // JSX component
  | "markdown-document" // Markdown rendered as HTML
  | "svg"               // SVG graphic
  | "diagram"           // Mermaid/diagram syntax
  | "code-snippet"      // Generic code display
  | "mini-app"          // Interactive HTML app
  | "image"             // Generated image as a data URL
  | "design-system";    // Design system documentation

export interface ArtifactVersion {
  code: string;
  title: string;
  createdAt: number;
  /** Who produced this version. "agent" = LLM message, "user" = Monaco edit
   *  or manual restore. */
  source: "agent" | "user";
  /** Message id that contained this code (agent versions only). */
  messageId?: string;
  /** When this version is a restoration of a prior version, points to the
   *  index it was restored from. */
  restoredFrom?: number;
  /** True while the agent is still streaming tokens into this version. The
   *  canvas pins itself to the code view while streaming and auto-flips to
   *  preview once this clears. */
  streaming?: boolean;
  /** Per-message fence index. Lets the streaming upsert distinguish the
   *  first fence in a message from a second one with the same heading. */
  fenceIndex?: number;
}

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  code: string;
  messageId: string;
  createdAt: number;
  /** Chronological history of code+title pairs. Last entry mirrors the
   *  top-level `code` and `title` — i.e. the current state. */
  versions: ArtifactVersion[];
  /** Which version is currently displayed. Undo/redo move this pointer.
   *  When the agent or user produces a new version, this snaps to the end
   *  (and any "future" branch from prior undos is dropped). */
  activeVersionIndex: number;
}

const ARTIFACT_LANG_MAP: Record<string, ArtifactKind> = {
  html: "html",
  latex: "latex",
  tex: "latex",
  python: "python",
  docx: "docx",
  word: "docx",
  pptx: "pptx",
  powerpoint: "pptx",
  slides: "pptx",
  xlsx: "xlsx",
  excel: "xlsx",
  spreadsheet: "xlsx",
  deck: "deck",
  presentation: "deck",
  "react-component": "react-component",
  react: "react-component",
  jsx: "react-component",
  tsx: "react-component",
  "markdown-document": "markdown-document",
  markdown: "markdown-document",
  md: "markdown-document",
  svg: "svg",
  diagram: "diagram",
  mermaid: "diagram",
  "code-snippet": "code-snippet",
  code: "code-snippet",
  snippet: "code-snippet",
  "mini-app": "mini-app",
  app: "mini-app",
  interactive: "mini-app",
  image: "image",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  "design-system": "design-system",
  design: "design-system",
};

const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  html: "HTML",
  latex: "LaTeX",
  python: "Python",
  docx: "Word",
  pptx: "Slides",
  xlsx: "Excel",
  deck: "Deck",
  "react-component": "React",
  "markdown-document": "Markdown",
  svg: "SVG",
  diagram: "Diagram",
  "code-snippet": "Code",
  "mini-app": "App",
  image: "Image",
  "design-system": "Design System",
};

/** Lowercase + collapse whitespace so "Resume Page" and "  resume  page  "
 *  match. Empty strings stay empty (we treat that as "no name given"). */
export function normalizeTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

interface ParsedArtifactBlock {
  kind: ArtifactKind;
  title: string;
  code: string;
}

/**
 * Pull artifact blocks out of an assistant message.
 *
 * Title resolution, in priority order:
 *   1. An explicit `### Title` (or `## Title`, `# Title`) markdown heading on
 *      the line immediately preceding the fence — model-controlled, the
 *      "official" way to address an artifact.
 *   2. The first non-empty comment-or-code line inside the block, sliced to
 *      60 chars — best effort for legacy / unlabeled messages.
 *   3. The kind label ("HTML", "LaTeX", "Python") — last resort fallback.
 *
 * Same (kind, normalized title) → updates an existing artifact in place.
 * Different titles → distinct artifacts, even when the kind matches.
 */
export function extractArtifactBlocks(
  content: string,
  options?: { enabledKinds?: ReadonlySet<ArtifactKind> },
): ParsedArtifactBlock[] {
  const enabled = options?.enabledKinds;
  const out: (ParsedArtifactBlock & { _idx?: number })[] = [];

  // ── Pass 1: markdown fenced code blocks ────────────────────────────
  // Capture optional preceding markdown heading on its own line, then the fence.
  // Heading group is optional and may have surrounding whitespace lines.
  const fenceRe = /(?:^|\n)(?:#{1,6}[ \t]+(.+?)[ \t]*\n+)?[ \t]*```(\w+)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(content)) !== null) {
    const heading = (m[1] ?? "").trim();
    const lang = (m[2] ?? "").toLowerCase();
    const code = (m[3] ?? "").trim();
    const kind = ARTIFACT_LANG_MAP[lang];
    if (!kind || code.length === 0) continue;
    if (enabled && !enabled.has(kind)) continue;

    let title = heading;
    if (!title) {
      const firstLine = code.split("\n")[0].slice(0, 60).trim();
      title = firstLine || ARTIFACT_KIND_LABEL[kind];
    } else if (title.length > 80) {
      title = title.slice(0, 80).trim();
    }

    // Track position so we can interleave with XML artifacts correctly.
    out.push({ kind, title, code, _idx: m.index });
  }

  // ── Pass 2: XML <artifact> tags (design-mode contract) ─────────────
  // Some models emit <artifact> </artifact> with the actual content after
  // the closing tag. We handle this by falling back to trailing text when
  // the inner content is empty/whitespace.
  const xmlRe = /<artifact\b([^>]*)>([\s\S]*?)<\/artifact>/gi;
  while ((m = xmlRe.exec(content)) !== null) {
    const attrs = m[1] ?? "";
    let code = (m[2] ?? "").trim();
    const matchEnd = m.index + m[0].length;

    // Fallback: if the artifact body is empty/whitespace, grab the text
    // after </artifact> up to the next <artifact or end of string.
    if (code.length === 0) {
      const after = content.slice(matchEnd);
      const nextArtifact = after.search(/<artifact\b/i);
      const trailing = (nextArtifact >= 0 ? after.slice(0, nextArtifact) : after).trim();
      if (trailing.length > 0) {
        code = trailing;
      } else {
        continue;
      }
    }

    const kindMatch = attrs.match(/\bkind\s*=\s*"([^"]+)"/i);
    const kindRaw = (kindMatch ? kindMatch[1] : "html").toLowerCase();
    const kind = ARTIFACT_LANG_MAP[kindRaw];
    if (!kind) continue;
    if (enabled && !enabled.has(kind)) continue;

    const titleMatch = attrs.match(/\btitle\s*=\s*"([^"]*)"/i);
    let title = titleMatch ? titleMatch[1].trim() : "";
    if (!title) {
      const firstLine = code.split("\n")[0].slice(0, 60).trim();
      title = firstLine || ARTIFACT_KIND_LABEL[kind];
    } else if (title.length > 80) {
      title = title.slice(0, 80).trim();
    }

    out.push({ kind, title, code, _idx: m.index });
  }

  // Sort by position in source so XML and fence artifacts interleave
  // in the order they appear in the stream.
  const sorted = out.sort((a, b) => (a._idx ?? 0) - (b._idx ?? 0));

  // Strip the internal _idx field before returning.
  return sorted.map(({ _idx: _, ...rest }) => rest) as ParsedArtifactBlock[];
}

export interface ChatStore {
  conversations: Conversation[];
  activeId: string | null;
  /** Bumps every time `setActiveConversation` is called, even when the new id matches
   * the current one. Lets InputBar re-focus the textarea on repeated New chat presses. */
  focusNonce: number;
  /** Bumped whenever the todo board changes so the sidebar widget re-renders. */
  todoBoardUpdated: number;
  /** Files dropped anywhere on the window — InputBar consumes and clears these. */
  pendingDroppedFiles: Attachment[];
  addPendingDroppedFiles: (files: Attachment[]) => void;
  clearPendingDroppedFiles: () => void;
  /** Per-conversation draft of the input bar — text + staged attachments —
   * so switching between chats (or visiting an existing one and coming back
   * to "new chat") preserves whatever the user was composing. The key is
   * either a conversation id or `NEW_CHAT_DRAFT_KEY` for the empty state. */
  drafts: Record<string, { content: string; attachments: Attachment[] }>;
  setDraftContent: (key: string, content: string) => void;
  setDraftAttachments: (key: string, attachments: Attachment[]) => void;
  appendDraftAttachments: (key: string, attachments: Attachment[]) => void;
  clearDraft: (key: string) => void;
  /** Bump focusNonce to re-focus the chat textarea. */
  focusInput: () => void;
  messages: Record<string, Message[]>;
  compactionEntries: Record<string, CompactionEntry[]>;
  selectedModelId: string | null;
  isStreaming: boolean;
  streamingConversationId: string | null;
  streamingAbortControllers: Record<string, AbortController>;
  searchQuery: string;
  scrollPositions: ScrollPositions;

  /** Per-provider user config (API keys, custom base URLs). Persisted. */
  providerConfigs: Record<string, ProviderConfig>;

  /** Per-model overrides set by the user via the gear icon in the
   *  model picker. Keyed by combined model id ("providerId:modelId").
   *  Persisted to localStorage. */
  modelOverrides: Record<string, ModelOverride>;

  /**
   * Models discovered from local provider `/models` endpoints (Ollama,
   * LM Studio). Non-persisted; refreshed on app start and when the user
   * edits a local provider's base URL. Keyed by providerId.
   */
  discoveredModels: Record<string, { id: string; name: string; contextWindow?: number; vision?: boolean }[]>;
  discoveryStatus: Record<string, "idle" | "loading" | "ok" | "error">;
  discoveryError: Record<string, string | null>;

  // Conversation actions
  createConversation: () => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setConversationArchived: (id: string, archived: boolean) => void;
  setConversationTags: (id: string, tags: string[]) => void;
  /** Reassign a conversation to a different workspace, or to none. Persists. */
  moveConversationToWorkspace: (id: string, workspacePath: string | null) => void;
  setTitleGenerating: (id: string, generating: boolean) => void;
  setSystemPrompt: (id: string, systemPrompt: string) => void;
  /** Set or clear the conversation-scoped active skills. */
  setConversationSkills: (id: string, skillNames: string[]) => void;
  /** Remember which model this conversation last used. */
  setConversationModel: (id: string, modelId: string | null) => void;
  setActiveConversation: (id: string | null) => void;

  /** Per-message branch management for tree-structured sessions. */
  /** Get the active branch (messages from root to current leaf). */
  getActiveBranch: (conversationId: string) => Message[];
  /** Fork: create a new branch from a specific message. Returns the new
   *  leaf message id. */
  forkBranch: (conversationId: string, fromMessageId: string) => string;
  /** Get all branch tips (leaf messages) for a conversation. */
  getBranchTips: (conversationId: string) => Message[];
  /** Navigate to a different branch tip. */
  navigateToBranch: (conversationId: string, tipMessageId: string) => void;

  // Message actions
  addMessage: (message: Omit<Message, "id" | "createdAt">) => Message;
  addCompactionEntry: (entry: CompactionEntry) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  appendToMessage: (conversationId: string, messageId: string, chunk: string) => void;
  appendToThinking: (conversationId: string, messageId: string, chunk: string) => void;
  editMessage: (conversationId: string, messageId: string, newContent: string) => void;
  removeMessagesAfter: (conversationId: string, messageId: string) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  addToolCallToMessage: (conversationId: string, messageId: string, tc: ToolCallEntry) => void;
  completeToolCall: (conversationId: string, messageId: string, toolCallId: string, output: unknown) => void;
  updateToolCallState: (conversationId: string, messageId: string, toolCallId: string, state: ToolCallEntry["state"]) => void;
  updateToolCall: (
    conversationId: string,
    messageId: string,
    toolCallId: string,
    updates: Partial<ToolCallEntry>,
  ) => void;
  /** Mark any tool calls still in "running" state on the given message as done. Used to recover when a stream ends without a tool-result chunk. */
  finalizeStuckToolCalls: (conversationId: string, messageId: string) => void;
  /** Attach a subagent transcript to a spawn_subagent tool call entry.
   *  Called by the spawn_subagent tool after the subagent loop finishes. */
  updateToolCallTranscript: (
    conversationId: string,
    messageId: string,
    toolCallId: string,
    transcript: import("../lib/llm-types").SubagentTranscriptEntry[],
  ) => void;

  // Provider actions
  configureProvider: (providerId: string, config: ProviderConfig) => void;
  removeProvider: (providerId: string) => void;
  setEnabledModels: (providerId: string, modelIds: string[]) => void;
  /** Hit a local provider's /models endpoint and cache the result. */
  discoverLocalModels: (providerId: string) => Promise<void>;
  /** Refresh every configured local provider in parallel. */
  discoverAllLocalModels: () => Promise<void>;
  /**
   * Hit a cloud provider's /v1/models endpoint and cache the result.
   * No-op for providers without `supportsDiscovery: true` in the
   * registry (e.g. Anthropic, OpenAI) and for providers without a
   * configured API key.
   */
  discoverCloudModels: (providerId: string) => Promise<void>;

  // Model selection & per-model overrides
  setSelectedModel: (modelId: string | null) => void;
  /** Set or update overrides for a single model (contextWindow,
   *  maxResponseTokens, reasoningEffort). Passing undefined for a key
   *  removes that override. Persisted to localStorage. */
  setModelOverride: (modelId: string, override: Partial<ModelOverride>) => void;

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
  /** Agent-mode message queue: messages sent while the LLM is working. */
  messageQueue: Record<string, QueuedMessage[]>;
  steerPayload: { conversationId: string; content: string; steered?: boolean } | null;
  triggerResend: (conversationId: string, content: string, attachments?: Attachment[]) => void;
  clearResend: () => void;
  enqueueMessage: (conversationId: string, content: string) => void;
  dequeueMessage: (conversationId: string) => { content: string } | undefined;
  steerMessage: (conversationId: string, content: string, queueIndex?: number) => void;
  setSteerPayload: (payload: { conversationId: string; content: string; steered?: boolean } | null) => void;
  /** Resume a partial assistant turn (uses existing thread + reasoning in context). */
  triggerContinue: (conversationId: string) => void;

  // Artifacts (non-persisted) — auto-detected code blocks rendered in side panel
  artifacts: Record<string, Artifact[]>;
  artifactPanelOpen: boolean;
  activeArtifactId: string | null;
  /** Per-conversation artifact panel state so switching chats remembers open/closed. */
  _artifactStatePerConv: Record<string, { panelOpen: boolean; activeId: string | null }>;
  setArtifactPanelOpen: (open: boolean) => void;
  setActiveArtifact: (id: string | null) => void;
  detectArtifacts: (conversationId: string, messageId: string, content: string) => void;
  /** Live-stream a partial artifact body into the canvas while tokens arrive.
   *  Upserts a single "streaming" version per (messageId, fenceIndex) so the
   *  Monaco editor reflects the model's typing in real time. */
  streamArtifactDelta: (
    conversationId: string,
    messageId: string,
    kind: ArtifactKind,
    title: string,
    fenceIndex: number,
    code: string,
  ) => void;
  /** Clear the streaming flag on any in-flight versions for this message.
   *  Called from onDone so the canvas auto-flips to preview. */
  finalizeStreamingArtifacts: (conversationId: string, messageId: string) => void;
  /** Edit the code of an existing artifact. Triggered by the Monaco editor. */
  updateArtifact: (conversationId: string, artifactId: string, code: string) => void;
  /** Find an artifact by (kind, normalized title) and apply text replacements.
   *  Returns the artifact id if found and edited, or null if no match.
   *  Used by the edit_artifact tool. */
  editArtifactByKindAndTitle: (
    conversationId: string,
    kind: ArtifactKind,
    title: string,
    edits: { oldText: string; newText: string }[],
  ) => { artifactId: string; newCode: string } | null;
  /** Move the version pointer back/forward. No-op at the ends. */
  undoArtifact: (conversationId: string, artifactId: string) => void;
  redoArtifact: (conversationId: string, artifactId: string) => void;
  /** Jump the version pointer to an arbitrary index. Used by the history menu. */
  restoreArtifactVersion: (conversationId: string, artifactId: string, versionIndex: number) => void;
  clearArtifacts: (conversationId: string) => void;
  /** Design mode: upsert artifact from a file write so the preview panel
   *  stays in sync with files on disk. */
  upsertDesignArtifact: (conversationId: string, title: string, code: string) => void;
  addImageArtifact: (conversationId: string, title: string, dataUrl: string, messageId?: string) => string;

  // Workspace file viewer (non-persisted) — opens a workspace file in the
  // artifact panel canvas. Set from the sidebar WorkspaceFileTree or the
  // in-panel WorkspaceFileBrowser. Mutually exclusive with attachments.
  workspaceFile: { path: string; name: string; content: string } | null;
  setWorkspaceFile: (f: { path: string; name: string; content: string } | null) => void;

  // Attachment viewer (non-persisted) — opens an attachment from a message bubble
  // in the same side panel slot as artifacts. Mutually exclusive with the
  // artifact panel; opening one closes the other.
  activeAttachment: Attachment | null;
  attachmentPanelOpen: boolean;
  setActiveAttachment: (a: Attachment | null) => void;

  // Subagent panel (non-persisted) — replaces the main chat view when a
  // subagent tool call is clicked. Shows the subagent's live transcript
  // in a full chat-like interface with a back arrow.
  subagentPanelOpen: boolean;
  /** The toolCallId of the spawn_subagent tool call being viewed. */
  activeSubagentToolCallId: string | null;
  openSubagentPanel: (toolCallId: string) => void;
  closeSubagentPanel: () => void;

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

  /** Design-mode workspace — separate pool so switching modes doesn't carry
   *  the agent's folder selection into design and vice versa. */
  designWorkspacePath: string | null;
  setDesignWorkspace: (path: string | null) => void;
  /** The full list of design workspace paths, shared across sidebar + picker. */
  designWorkspaces: string[];
  addDesignWorkspace: (path: string) => void;
  removeDesignWorkspace: (path: string) => void;

  // Mode (chat vs agent vs design)
  // The three are mutually exclusive — toggling any of agent/design off the
  // others. Chat is the implicit default when both are false.
  agentMode: boolean;
  setAgentMode: (enabled: boolean) => void;
  toggleAgentMode: () => void;

  // Design mode — third tab next to Chat and Agent. Swaps the empty-state
  // hero for a skill picker, the system prompt for the design stack
  // (DESIGN.md + SKILL.md + directives), and exposes the design system /
  // direction pills in the InputBar. See lib/design/.
  designMode: boolean;
  setDesignMode: (enabled: boolean) => void;
  toggleDesignMode: () => void;

  // Notebook mode — fourth tab next to Chat, Agent, and Design. Provides a
  // Jupyter-like interface with text, code, and AI cells for iterative
  // experimentation and documentation.
  notebookMode: boolean;
  setNotebookMode: (enabled: boolean) => void;
  toggleNotebookMode: () => void;

  // jjagent — isolate agent file edits into their own jj change per turn.
  // Toggleable via Settings. Requires jj to be installed and the workspace
  // to be a jj repo. When off (default), agent edits land in the working copy
  // as usual (no jj interaction). When on, each agent turn spawns a fresh jj
  // change that gets squashed back into the parent when the turn completes.
  jjagent: boolean;
  setJjAgent: (enabled: boolean) => void;
  // Runtime-only — the change ID for the current turn's jj isolation change.
  // Set when a turn starts (if jjagent is enabled + workspace is a jj repo),
  // cleared when the turn ends (squashed or on error). Not persisted.
  jjagentChangeId: string | null;
  setJjAgentChangeId: (id: string | null) => void;

  // Design-mode question-form submissions need to trigger a send from
  // outside the InputBar (the form renders inside MessageBubble). Setting
  // this asks the InputBar to consume the text on the next render.
  pendingFormSubmission: { conversationId: string; text: string } | null;
  setPendingFormSubmission: (payload: { conversationId: string; text: string } | null) => void;

  // Active design selections (design mode only). Persisted across reloads
  // and shared across conversations — the user picks a skill once and it
  // stays selected until they pick another.
  activeSkillId: string | null;
  setActiveSkill: (id: string | null) => void;
  activeDesignSystemId: string | null;
  setActiveDesignSystem: (id: string | null) => void;
  activeDirectionId: string | null;
  setActiveDirection: (id: string | null) => void;

  // Research mode — when on, agent uses a research-focused prompt and bigger
  // tool budget. Independent of agent vs chat mode.
  researchMode: boolean;
  setResearchMode: (enabled: boolean) => void;
  toggleResearchMode: () => void;

  // Product workspace panel and expansion features
  workspacePanelOpen: boolean;
  workspacePanelTab: ProductWorkspaceTab;
  openWorkspacePanel: (tab?: ProductWorkspaceTab) => void;
  closeWorkspacePanel: () => void;
  setWorkspacePanelTab: (tab: ProductWorkspaceTab) => void;
  usageSettings: UsageSettings;
  setUsageSettings: (settings: UsageSettings) => void;
  voiceSettings: VoiceSettings;
  setVoiceSettings: (settings: VoiceSettings) => void;
  meetingSessions: MeetingSession[];
  meetingSettings: MeetingSettings;
  setMeetingSettings: (settings: MeetingSettings) => void;
  setMeetingSessions: (sessions: MeetingSession[]) => void;
  updateMeetingSession: (sessionId: string, updates: Partial<MeetingSession>) => void;
  deleteMeetingSession: (sessionId: string) => void;
  continueMeetingSession: (sessionId: string) => string | null;
  syncSettings: SyncConfig;
  setSyncSettings: (settings: SyncConfig) => void;
  featureFlags: ProductFeatureFlags;
  setFeatureFlag: (key: keyof ProductFeatureFlags, enabled: boolean) => void;
  plusMenuVisibility: PlusMenuVisibility;
  setPlusMenuItemVisible: (mode: "chat" | "design" | "agent", key: string, visible: boolean) => void;
  browserMirror: BrowserMirrorState;
  setBrowserMirror: (state: Partial<BrowserMirrorState>) => void;
  modelComparisonRuns: ModelComparisonRun[];
  addModelComparisonRun: (run: ModelComparisonRun) => void;
  updateModelComparisonRun: (runId: string, updates: Partial<ModelComparisonRun>) => void;
  notebookCells: NotebookCell[];
  setNotebookCells: (cells: NotebookCell[]) => void;
  updateNotebookCell: (cellId: string, updates: Partial<NotebookCell>, persist?: boolean) => void;
  // Notebooks — a collection of named multi-panel document work areas, each
  // with its own side assistant thread. Replaces the single canvas board.
  notebooks: Notebook[];
  activeNotebookId: string | null;
  createNotebook: () => string;
  renameNotebook: (id: string, name: string) => void;
  deleteNotebook: (id: string) => void;
  setActiveNotebook: (id: string) => void;
  getActiveNotebook: () => Notebook | null;
  setActiveNotebookContents: (board: CanvasBoard, persist?: boolean) => void;
  imageJobs: ImageGenerationJob[];
  addImageJob: (job: ImageGenerationJob) => void;
  updateImageJob: (jobId: string, updates: Partial<ImageGenerationJob>) => void;
  imageGenSettings: ImageGenSettings;
  setImageGenSettings: (settings: ImageGenSettings) => void;
  scheduledAgents: ScheduledAgent[];
  setScheduledAgents: (agents: ScheduledAgent[]) => void;
  scheduledAgentRuns: ScheduledAgentRun[];
  setScheduledAgentRuns: (runs: ScheduledAgentRun[]) => void;
  runScheduledAgent: (agentId: string) => Promise<void>;
  continueScheduledRun: (runId: string) => string | null;
  watcherEvents: WatcherEventSummaryInput[];
  addWatcherEvent: (event: WatcherEventSummaryInput) => void;
  clearWatcherEvents: () => void;
  ragSettings: RagSettings;
  setRagSettings: (settings: RagSettings) => void;
  documentWorkspaces: DocumentWorkspace[];
  activeDocumentWorkspaceId: string | null;
  createDocumentWorkspace: (name?: string) => string;
  deleteDocumentWorkspace: (id: string) => void;
  setActiveDocumentWorkspace: (id: string | null) => void;
  renameDocumentWorkspace: (id: string, name: string) => void;
  upsertKnowledgeDocument: (workspaceId: string, document: KnowledgeDocument) => void;
  updateKnowledgeDocument: (workspaceId: string, documentId: string, updates: Partial<KnowledgeDocument>) => void;
  activeBranchTips: Record<string, string>;
  setActiveBranchTip: (conversationId: string, tipMessageId: string) => void;
  pursueGoalMode: boolean;
  setPursueGoalMode: (enabled: boolean) => void;

  // Plan mode — agent-only. When on, the model gets the read-only tool
  // subset and a planning preamble. The bubble surfaces a "Build" button
  // when the plan finishes streaming so the user can flip into write mode
  // and execute. Persisted across reloads, but always cleared if the user
  // leaves agent mode.
  planMode: boolean;
  setPlanMode: (enabled: boolean) => void;
  togglePlanMode: () => void;

  // Permission mode: manual = approve every write, auto = auto-approve file edits
  // but still gate shell commands, yolo = approve everything without prompting.
  permissionMode: "manual" | "auto" | "yolo";
  setPermissionMode: (mode: "manual" | "auto" | "yolo") => void;
  permissionProfile: "strict" | "default" | "fast";
  setPermissionProfile: (profile: "strict" | "default" | "fast") => void;
  verificationPolicy: VerificationPolicy;
  setVerificationPolicy: (policy: VerificationPolicy) => void;
  projectCheckMemory: ProjectCheckMemory;
  setProjectCheckMemory: (memory: ProjectCheckMemory) => void;
  checkpointNames: Record<string, string>;
  setCheckpointName: (messageId: string, name: string) => void;
  pathPermissionRules: PathPermissionRule[];
  setPathPermissionRules: (rules: PathPermissionRule[]) => void;
  agentBudgetControls: AgentBudgetControls;
  setAgentBudgetControls: (controls: AgentBudgetControls) => void;
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
  firecrawlApiKey: string;
  setFirecrawlApiKey: (key: string) => void;

  // Deep Research Config
  deepResearchMaxRounds: number;
  setDeepResearchMaxRounds: (rounds: number) => void;
  deepResearchMaxSearches: number;
  setDeepResearchMaxSearches: (searches: number) => void;

  // Free web search (deepcode-style endpoint, no API key needed)
  freeWebSearch: boolean;
  setFreeWebSearch: (enabled: boolean) => void;
  /** Stable per-install token sent as the `Token` header. Generated on first use. */
  freeWebSearchToken: string;

  // Search Backend & Memory Manager Settings
  searchBackend: "searxng" | "tavily";
  setSearchBackend: (backend: "searxng" | "tavily") => void;
  memoryEnabled: boolean;
  setMemoryEnabled: (enabled: boolean) => void;
  memoryExtractionSettings: MemoryExtractionSettings;
  setMemoryExtractionSettings: (settings: MemoryExtractionSettings) => void;
  searxngStatus: string | null;
  setSearxngStatus: (status: string | null) => void;
  workspaceHealthEnabled: boolean;
  setWorkspaceHealthEnabled: (enabled: boolean) => void;
  manualTasksEnabled: boolean;
  setManualTasksEnabled: (enabled: boolean) => void;
  updateManualTodoBoard: (conversationId: string, board: TaskBoard) => void;

  /** Per-turn web search call counter. Resets on each send. Caps the model at
   *  2 searches per turn to prevent runaway search loops. */
  webSearchCount: number;
  incrementWebSearchCount: () => void;
  resetWebSearchCount: () => void;

  /** Per-turn citation source registry (chat mode). Documents are seeded at
   *  send; web results append as the search tool runs. Each source gets a
   *  stable 1-based `index` the model cites inline. Resets on each send and is
   *  never persisted — it's transient turn state that onDone reads from. */
  citationSources: Citation[];
  resetCitationSources: () => void;
  /** Append sources, assigning each the next sequential index. Returns the
   *  registered citations (with indices) so callers can label tool output. */
  addCitationSources: (sources: Omit<Citation, "index">[]) => Citation[];

  /** Code execution in chat mode — when true, run_python and run_javascript
   *  surface as approved tools so a student can ask the model to compute
   *  something inline. Off by default; opt-in via Settings. */
  chatCodeExec: boolean;
  setChatCodeExec: (enabled: boolean) => void;

  // Artifact behavior toggles
  /** When true (default), HTML/Python/LaTeX/Office fences are detected and
   *  rendered in the side-panel canvas; the chat shows reference cards.
   *  When false, every fence stays inline in chat as a normal code block. */
  autoArtifacts: boolean;
  setAutoArtifacts: (enabled: boolean) => void;
  /** When true (default), the docx/pptx/xlsx artifact kinds are available
   *  to the model. When false, the office tooling is omitted from the
   *  system prompt and any office fences fall back to inline code blocks. */
  officeArtifacts: boolean;
  setOfficeArtifacts: (enabled: boolean) => void;

  /** When true (default), the model may author inline widgets — self-contained
   *  HTML/CSS/JS in a ```widget fence — that render live inside the reply as a
   *  sandboxed, auto-sizing frame (charts, diagrams, animations, interactive
   *  demos). When false, widget fences fall back to plain code blocks and the
   *  capability is omitted from the system prompt. Independent of the
   *  side-panel canvas (autoArtifacts). */
  advancedArtifacts: boolean;
  setAdvancedArtifacts: (enabled: boolean) => void;

  /** When true, the 5-dim critique scores are shown in design mode messages.
   *  When false (default), they are stripped from the UI. */
  showDesignCritique: boolean;
  setShowDesignCritique: (enabled: boolean) => void;

  glowBackgroundEnabled: boolean;
  setGlowBackgroundEnabled: (enabled: boolean) => void;
  glowBackgroundMode: "blocky" | "smooth" | "fluid" | "aurora" | "cyberpunk" | "nebula";
  setGlowBackgroundMode: (mode: "blocky" | "smooth" | "fluid" | "aurora" | "cyberpunk" | "nebula") => void;

  /** When true (default), a subtle click sound plays when an agent/design
   *  turn completes. When false, completion is silent. */
  completionSound: boolean;
  setCompletionSound: (enabled: boolean) => void;

  /** When true (default), subagents can be spawned in agent and design modes.
   *  When false, the spawn_subagent tool is disabled. Subagents are never
   *  available in plain chat mode regardless of this setting. */
  subagentsEnabled: boolean;
  setSubagentsEnabled: (enabled: boolean) => void;

  // ── Skills ──
  /** Extra skill directories configured by the user. Persisted. */
  skillPaths: string[];
  setSkillPaths: (paths: string[]) => void;
  addSkillPath: (path: string) => void;
  removeSkillPath: (path: string) => void;
  /** Set of disabled skill names (empty = all enabled). Persisted. */
  disabledSkills: Set<string>;
  setSkillEnabled: (name: string, enabled: boolean) => void;
  /** Set of auto-trigger skill names. The full SKILL.md body is injected
   *  into every system prompt so the model follows the skill instructions
   *  without needing to read the file itself. Persisted. */
  autoTriggerSkills: Set<string>;
  setAutoTriggerSkill: (name: string, enabled: boolean) => void;
  /** Discovered skill list (non-persisted). */
  discoveredSkills: Skill[];
  setDiscoveredSkills: (skills: Skill[]) => void;

  // Semantic index config
  ollamaUrl: string;
  setOllamaUrl: (url: string) => void;
  embeddingModel: string;
  setEmbeddingModel: (model: string) => void;

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
  getLlmConfigForModel: (modelId: string | null) => LlmConfig | null;
  getActiveLlmConfig: () => LlmConfig | null;
}

const generateId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Tracks the last time each in-flight streaming message was flushed to disk.
// Used by appendToMessage to throttle writes to ~750ms so partial content
// survives a crash without hammering SQLite on every token.
const streamingPersistTimestamps = new Map<string, number>();

// Monotonic timestamp source for new messages. `Date.now()` resolution is 1ms
// and on fast machines two messages added back-to-back (user prompt + empty
// assistant placeholder) routinely land in the same millisecond. When we sort
// by createdAt later, ties get broken by whatever order the merge happened to
// pick — which is how the assistant reply ends up above the user message.
// `nextCreatedAt()` guarantees strictly increasing values within a session.
let lastIssuedCreatedAt = 0;
function nextCreatedAt(): number {
  const now = Date.now();
  const ts = now > lastIssuedCreatedAt ? now : lastIssuedCreatedAt + 1;
  lastIssuedCreatedAt = ts;
  return ts;
}

// Role priority used to break ties in chronological sorts. Within a single
// turn a user message is always conceptually before its assistant reply.
const ROLE_ORDER: Record<string, number> = {
  system: 0,
  compactionSummary: 0.5,
  user: 1,
  assistant: 2,
  tool: 3,
};

export function compareMessages(a: { createdAt: number; role: string }, b: { createdAt: number; role: string }): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  const ra = ROLE_ORDER[a.role] ?? 99;
  const rb = ROLE_ORDER[b.role] ?? 99;
  return ra - rb;
}

const BUILTIN_PROVIDERS = getBuiltInProviders();

/** Side-channel from `getFilteredConversations` to the sidebar so we can
 *  render "matches in N messages" without re-running the substring scan.
 *  Keyed by conversation id; rebuilt on every call so stale entries are
 *  naturally pruned. */
export const bodyMatchCounts: Map<string, number> = new Map();

/**
 * Curated cloud model catalog, indexed by provider id. Built from the
 * unified registry in `src/lib/model-registry.ts` at module load so
 * every call site (`ProviderCard.tsx`, `getModels()` below, etc.) can
 * use the same Record shape they always have. For mutating or merging,
 * prefer the helpers in `../lib/providers`.
 *
 * Pi-ai uses the same approach: `models.generated.js` is the single
 * source of truth and everything else reads from it. This Record is
 * the goatllm-side equivalent of `pi-ai's getModels(provider)`.
 */
/**
 * Exported for back-compat with `ProviderCard.tsx` and any other
 * component that indexes the cloud catalog by provider id. New code
 * should prefer the typed helpers in `../lib/providers`.
 */
export const CLOUD_PROVIDER_MODELS: Record<string, ModelConfig[]> = (() => {
  const ids = [
    "openai",
    "anthropic",
    "deepseek",
    "mimo",
    "openrouter",
    "opencode-go",
    "groq",
  ];
  const out: Record<string, ModelConfig[]> = {};
  for (const id of ids) {
    out[id] = getCuratedModels(id);
  }
  return out;
})();

/**
 * Default base URLs for cloud providers. Local providers (Ollama,
 * LM Studio) live in `LOCAL_PROVIDERS` below with their own defaults.
 */
const CLOUD_PROVIDER_BASE_URLS: Record<string, string> = (() => {
  const ids = [
    "openai",
    "anthropic",
    "deepseek",
    "mimo",
    "openrouter",
    "opencode-go",
    "groq",
  ];
  const out: Record<string, string> = {};
  for (const id of ids) {
    const url = getProviderBaseUrl(id);
    if (url) out[id] = url;
  }
  return out;
})();

const NO_KEY_PROVIDERS = new Set(["ollama", "lmstudio"]);

/**
 * Sentinel key used in the drafts map for the "no active conversation yet"
 * state. Anything the user types or attaches before they've actually sent
 * a message lives here so visiting an existing chat and coming back to
 * "New chat" doesn't lose their work.
 */
export const NEW_CHAT_DRAFT_KEY = "__new_chat__";

/**
 * Local providers expose their model catalog over an OpenAI-compatible
 * `/models` endpoint, so we discover what's installed instead of hardcoding
 * a list. Without this, the picker shows phantom models the user doesn't
 * actually have pulled.
 */
export const LOCAL_PROVIDERS = [
  {
    id: "ollama",
    name: "Ollama",
    defaultBaseUrl: "http://localhost:11434/v1",
    docs: "ollama.com",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    defaultBaseUrl: "http://localhost:1234/v1",
    docs: "lmstudio.ai",
  },
] as const;

export const useChatStore = create<ChatStore>()((set, get) => ({
      conversations: [],
      activeId: null,
      focusNonce: 0,
      todoBoardUpdated: 0,
      pendingDroppedFiles: [],
      drafts: {},
      messages: {},
      compactionEntries: {},
      selectedModelId: null,
      isStreaming: false,
      streamingConversationId: null,
      streamingAbortControllers: {},
      searchQuery: "",
      scrollPositions: {},
      providerConfigs: loadProviderConfigs(),
      modelOverrides: loadModelOverrides(),
      discoveredModels: {},
      discoveryStatus: {},
      discoveryError: {},
      resendPayload: null,
      messageQueue: loadJsonValue<Record<string, QueuedMessage[]>>(MESSAGE_QUEUE_KEY, {}),
      steerPayload: null,
      artifacts: {},
      artifactPanelOpen: false,
      activeArtifactId: null,
      _artifactStatePerConv: {},
      workspaceFile: null,
      activeAttachment: null,
      attachmentPanelOpen: false,
      subagentPanelOpen: false,
      activeSubagentToolCallId: null,
      sidebarOpen: true,
      defaultSystemPrompt: "",
      workspacePath: null,
      designWorkspacePath: null,
      // Load design workspaces from localStorage on init.
      designWorkspaces: (() => {
        try {
          const raw = localStorage.getItem("goatllm-design-workspaces");
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })(),
      _hydrated: false,
      agentMode: false,
      designMode: false,
      notebookMode: false,
      jjagent: false,
      jjagentChangeId: null,
      pendingFormSubmission: null,
      activeSkillId: null,
      activeDesignSystemId: null,
      activeDirectionId: null,
      autoApprove: false,
      permissionMode: "manual",
      permissionProfile: "default",
      verificationPolicy: loadVerificationPolicy(),
      projectCheckMemory: loadProjectCheckMemory(),
      checkpointNames: (() => {
        try {
          const raw = localStorage.getItem(CHECKPOINT_NAMES_KEY);
          return raw ? JSON.parse(raw) : {};
        } catch {
          return {};
        }
      })(),
      pathPermissionRules: (() => {
        try {
          const raw = localStorage.getItem(PATH_PERMISSION_RULES_KEY);
          return raw ? JSON.parse(raw) : [
            { pattern: ".env", action: "ask" },
            { pattern: "src/**", action: "auto" },
          ];
        } catch {
          return [];
        }
      })(),
      agentBudgetControls: loadJsonSetting(AGENT_BUDGET_CONTROLS_KEY, DEFAULT_AGENT_BUDGET_CONTROLS),
      providerHealth: {},
      messageSearchResults: [],
      messageSearchLoading: false,
      tavilyApiKey: "",
      firecrawlApiKey: "",
      deepResearchMaxRounds: 4,
      deepResearchMaxSearches: 3,
      freeWebSearch: false,
      chatCodeExec: false,
      freeWebSearchToken: "",
      searchBackend: "searxng",
      memoryEnabled: true,
      memoryExtractionSettings: loadMemoryExtractionSettingsFromJournal(),
      searxngStatus: null,
      workspaceHealthEnabled: false,
      manualTasksEnabled: false,
      webSearchCount: 0,
      citationSources: [],
      autoArtifacts: true,
      officeArtifacts: true,
      advancedArtifacts: true,
      showDesignCritique: false,
      glowBackgroundEnabled: false,
      glowBackgroundMode: "blocky",
      completionSound: true,
      subagentsEnabled: true,
      // ── Skills ──
      skillPaths: [] as string[],
      disabledSkills: new Set<string>(),
      autoTriggerSkills: new Set<string>(),
      discoveredSkills: [] as Skill[],
      ollamaUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      researchMode: false,
      planMode: false,
      workspacePanelOpen: loadJsonSetting(PRODUCT_WORKSPACE_STATE_KEY, DEFAULT_PRODUCT_WORKSPACE_STATE).workspacePanelOpen,
      workspacePanelTab: loadJsonSetting(PRODUCT_WORKSPACE_STATE_KEY, DEFAULT_PRODUCT_WORKSPACE_STATE).workspacePanelTab,
      usageSettings: loadUsageSettings(),
      voiceSettings: loadJsonSetting(VOICE_SETTINGS_KEY, DEFAULT_VOICE_SETTINGS),
      meetingSessions: loadMeetingStateFromJournal().sessions,
      meetingSettings: loadMeetingStateFromJournal().settings,
      syncSettings: loadJsonSetting(SYNC_SETTINGS_KEY, DEFAULT_SYNC_SETTINGS),
      imageGenSettings: loadJsonSetting(IMAGE_GEN_SETTINGS_KEY, DEFAULT_IMAGE_GEN_SETTINGS),
      featureFlags: loadJsonSetting(FEATURE_FLAGS_KEY, DEFAULT_FEATURE_FLAGS),
      plusMenuVisibility: loadJsonSetting(PLUS_MENU_VISIBILITY_KEY, DEFAULT_PLUS_MENU_VISIBILITY),
      browserMirror: DEFAULT_BROWSER_MIRROR,
      modelComparisonRuns: sanitizeModelComparisonRuns(loadJsonValue<unknown>(MODEL_COMPARISON_RUNS_KEY, [])),
      notebookCells: loadNotebookCells(),
      notebooks: loadNotebooks(),
      activeNotebookId: resolveActiveNotebookId(loadNotebooks()),
      imageJobs: sanitizeImageJobs(loadJsonValue<unknown>(IMAGE_JOBS_KEY, [])),
      scheduledAgents: sanitizeScheduledAgents(loadJsonValue<unknown>(SCHEDULED_AGENTS_KEY, [])),
      scheduledAgentRuns: sanitizeScheduledAgentRuns([]),
      watcherEvents: loadJsonValue<WatcherEventSummaryInput[]>(WATCHER_EVENTS_KEY, []),
      ragSettings: loadJsonSetting(RAG_SETTINGS_KEY, DEFAULT_RAG_SETTINGS),
      documentWorkspaces: [] as DocumentWorkspace[],
      activeDocumentWorkspaceId: null,
      activeBranchTips: loadJsonValue<Record<string, string>>(BRANCH_TIPS_KEY, {}),
      pursueGoalMode: false,

      createConversation: () => {
        const id = generateId();
        const now = Date.now();
        const defaultPrompt = get().defaultSystemPrompt;
        // Only tag the conversation with a workspace when we're actually in
        // agent mode. Otherwise plain-chat conversations would inherit the
        // last-selected workspace path and start appearing under projects in
        // AgentSidebar.
        const isAgent = get().agentMode;
        const isDesign = get().designMode;
        const mode: Conversation["mode"] = isDesign ? "design" : isAgent ? "agent" : "chat";
        const wsPath = isDesign ? get().designWorkspacePath : isAgent ? get().workspacePath : null;
        const conversation: Conversation = {
          id,
          title: "New Conversation",
          lastMessagePreview: "",
          lastMessageAt: now,
          createdAt: now,
          modelId: get().selectedModelId,
          systemPrompt: defaultPrompt,
          mode,
          workspacePath: wsPath,
        };
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeId: id,
          messages: { ...state.messages, [id]: [] },
        }));
        // Journal write happens synchronously inside persistConversation;
        // SQLite mirror is queued. The conversation row is durable before
        // this call returns.
        persistConversation(conversation);
        return id;
      },

      deleteConversation: (id: string) => {
        const { conversations, activeId, messages, drafts, messageQueue, compactionEntries } = get();
        const remaining = conversations.filter((c) => c.id !== id);
        const newMessages = { ...messages };
        delete newMessages[id];
        const newDrafts = { ...drafts };
        delete newDrafts[id];
        const newQueue = { ...messageQueue };
        delete newQueue[id];
        const newCompactionEntries = { ...compactionEntries };
        delete newCompactionEntries[id];
        let newActiveId = activeId;
        if (activeId === id) {
          // Show the new-chat hero in the current mode instead of jumping
          // to a random conversation that might be in a different mode.
          newActiveId = null;
        }
        set({
          conversations: remaining,
          activeId: newActiveId,
          messages: newMessages,
          drafts: newDrafts,
          messageQueue: newQueue,
          compactionEntries: newCompactionEntries,
        });
        saveJsonSetting(MESSAGE_QUEUE_KEY, newQueue);
        deleteConversationFromDb(id);
        // Drop the in-memory attachment text cache for this conversation.
        try { localStorage.removeItem(`goatllm-todo-board-${id}`); } catch {}
        import("../lib/attachment-cache").then((m) => m.clearConversation(id)).catch(() => {});
        import("../lib/url-fetch").then((m) => m.clearUrlFetchCache(id)).catch(() => {});
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

      setConversationArchived: (id: string, archived: boolean) => {
        set((state) => {
          const updated = state.conversations.map((c) =>
            c.id === id ? { ...c, archived: archived || undefined } : c,
          );
          const changed = updated.find((c) => c.id === id);
          if (changed) persistConversation(changed);
          return { conversations: updated };
        });
      },

      setConversationTags: (id: string, tags: string[]) => {
        // Normalize: lowercase, dedupe, drop empty.
        const cleaned = Array.from(
          new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
        );
        set((state) => {
          const updated = state.conversations.map((c) =>
            c.id === id ? { ...c, tags: cleaned.length > 0 ? cleaned : undefined } : c,
          );
          const changed = updated.find((c) => c.id === id);
          if (changed) persistConversation(changed);
          return { conversations: updated };
        });
      },

      moveConversationToWorkspace: (id: string, workspacePath: string | null) => {
        set((state) => {
          const updated = state.conversations.map((c) =>
            c.id === id ? { ...c, workspacePath } : c,
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

      setConversationSkills: (id: string, skillNames: string[]) => {
        set((state) => {
          const updated = state.conversations.map((c) =>
            c.id === id ? { ...c, activeSkillNames: skillNames.length > 0 ? skillNames : undefined } : c
          );
          const changed = updated.find((c) => c.id === id);
          if (changed) persistConversation(changed);
          return { conversations: updated };
        });
      },

      setConversationModel: (id: string, modelId: string | null) => {
        set((state) => {
          const updated = state.conversations.map((c) =>
            c.id === id ? { ...c, modelId } : c,
          );
          const changed = updated.find((c) => c.id === id);
          if (changed) persistConversation(changed);
          return { conversations: updated };
        });
      },

      setActiveConversation: (id: string | null) => {
        // Save outgoing conversation's artifact panel state so we can restore it
        // when the user navigates back.
        const prev = get();
        const outgoing = prev.activeId;
        let nextArtifactState = prev._artifactStatePerConv;
        if (outgoing) {
          nextArtifactState = {
            ...nextArtifactState,
            [outgoing]: { panelOpen: prev.artifactPanelOpen, activeId: prev.activeArtifactId },
          };
        }

        // Restore incoming conversation's artifact state (default: closed)
        const restored = id ? nextArtifactState[id] : undefined;

        const incomingConv = id ? prev.conversations.find((c) => c.id === id) : undefined;
        const restoreModelId = incomingConv?.modelId ?? null;

        set((state) => ({
          activeId: id,
          ...(restoreModelId ? { selectedModelId: restoreModelId } : {}),
          focusNonce: state.focusNonce + 1,
          artifactPanelOpen: restored?.panelOpen ?? false,
          activeArtifactId: restored?.activeId ?? null,
          _artifactStatePerConv: nextArtifactState,
          // Attachment viewer is conversation-scoped — don't carry it across
          // chat switches or it lingers on top of the new conversation.
          activeAttachment: null,
          attachmentPanelOpen: false,
          // Design selections are conversation-scoped: navigating to a new
          // chat (id === null) wipes surface / system / direction back to
          // "none picked". When jumping to an existing conversation we
          // also reset — the per-conversation design state will be
          // re-bound when project-scoped state lands; for now picking a
          // surface is per-session.
          activeSkillId: id === null ? null : state.activeSkillId,
          activeDesignSystemId: id === null ? null : state.activeDesignSystemId,
          activeDirectionId: id === null ? null : state.activeDirectionId,
        }));
        try { localStorage.setItem("goatllm-active-conversation", id ?? ""); } catch {}
        if (restoreModelId) {
          try { localStorage.setItem("goatllm-selected-model", restoreModelId); } catch {}
        }

        // Safety net: if the in-memory store has no messages for this
        // conversation, hit the DB. Hydration can miss messages if it raced
        // with a streaming write, and we never want "click old chat → blank"
        // when the data is actually safe on disk.
        if (id) {
          const cached = get().messages[id];
          const isStreamingNow = id in get().streamingAbortControllers;
          // Don't clobber an in-flight stream's in-memory message buffer with
          // whatever's on disk — disk lags during streaming by design.
          if (!isStreamingNow && (!cached || cached.length === 0)) {
            loadMessagesForConversation(id)
              .then((msgs) => {
                if (msgs.length === 0) return;
                const stillActive = get().activeId === id;
                const stillEmpty = (get().messages[id] ?? []).length === 0;
                if (!stillActive || !stillEmpty) return;
                set((state) => ({
                  messages: { ...state.messages, [id]: msgs },
                }));
              })
              .catch((e) => console.warn("[store] on-demand message load failed:", e));
          }
        }

        // Replay todo board state from conversation history on switch so the
        // sidebar widget shows the correct tasks for the active conversation.
        if (id) {
          import("../lib/tools/todo").then((m) => {
            const msgs = get().messages[id];
            if (msgs && msgs.length > 0) {
              const toolCalls = msgs
                .filter((msg) => msg.role === "assistant" && msg.toolCalls?.length)
                .flatMap((msg) =>
                  msg.toolCalls!.map((tc) => ({
                    toolName: tc.toolName,
                    input: tc.input,
                    output: tc.output as string | undefined,
                  })),
                );
              const replayed = m.loadBoardFromHistory(id, toolCalls);
              if (replayed) {
                set((s) => ({ todoBoardUpdated: s.todoBoardUpdated + 1 }));
              }
            } else {
              m.clearBoard(id);
              set((s) => ({ todoBoardUpdated: s.todoBoardUpdated + 1 }));
            }
          }).catch(() => {});
        }
      },

      // ── Branch management ──

      getActiveBranch: (conversationId: string) => {
        const msgs = get().messages[conversationId] ?? [];
        if (msgs.length === 0) return [];

        const activeTipId = get().activeBranchTips[conversationId];
        if (activeTipId) {
          const byId = new Map(msgs.map((m) => [m.id, m]));
          const branch: Message[] = [];
          let current = byId.get(activeTipId);
          while (current) {
            branch.unshift(current);
            current = current.parentId ? byId.get(current.parentId) : undefined;
          }
          if (branch.length > 0) return branch;
        }

        // Build a map of parentId → children
        const childrenOf = new Map<string | null | undefined, Message[]>();
        for (const m of msgs) {
          const key = m.parentId ?? null;
          if (!childrenOf.has(key)) childrenOf.set(key, []);
          childrenOf.get(key)!.push(m);
        }

        // Walk from root following the most recent child at each step
        const branch: Message[] = [];
        let current: string | null | undefined = null;
        while (true) {
          const children: Message[] = childrenOf.get(current) ?? [];
          if (children.length === 0) break;
          // Pick the most recent child (last by createdAt)
          const sorted = children.sort((a: Message, b: Message) => a.createdAt - b.createdAt);
          const next: Message = sorted[sorted.length - 1];
          branch.push(next);
          current = next.id;
        }
        return branch;
      },

      forkBranch: (conversationId: string, fromMessageId: string) => {
        // Find the message to fork from
        const msgs = get().messages[conversationId] ?? [];
        const fromMsg = msgs.find((m) => m.id === fromMessageId);
        if (!fromMsg) return fromMessageId;

        // The next user message after this point will have parentId = fromMessageId
        // We don't create a new message here — the caller should add the new
        // user message with parentId set to fromMessageId.
        return fromMessageId;
      },

      getBranchTips: (conversationId: string) => {
        const msgs = get().messages[conversationId] ?? [];
        if (msgs.length === 0) return [];

        // A tip is a message that has no children
        const childIds = new Set(msgs.map((m) => m.parentId).filter(Boolean));
        return msgs.filter((m) => !childIds.has(m.id));
      },

      navigateToBranch: (conversationId: string, tipMessageId: string) => {
        get().setActiveBranchTip(conversationId, tipMessageId);
      },

      addMessage: (messageData: Omit<Message, "id" | "createdAt">) => {
        // Capture active skills from the conversation at message creation time
        const conv = get().conversations.find((c) => c.id === messageData.conversationId);
        const activeSkillNames = conv?.activeSkillNames;

        const message: Message = {
          ...messageData,
          id: generateId(),
          createdAt: nextCreatedAt(),
          // Only store skills if there are any (save space)
          activeSkillNames: activeSkillNames && activeSkillNames.length > 0 ? activeSkillNames : undefined,
        };
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
          // Both writes go into the same FIFO queue — conversation row
          // lands first, message row second, FK satisfied.
          const updatedConv = updatedConversations.find((c) => c.id === message.conversationId);
          if (updatedConv) persistConversation(updatedConv);
          persistMessage(message);
          return {
            messages: { ...state.messages, [message.conversationId]: updatedMessages },
            conversations: updatedConversations,
          };
        });
        return message;
      },

      addCompactionEntry: (entry) => {
        set((state) => {
          const current = state.compactionEntries[entry.conversationId] ?? [];
          const byId = new Map(current.map((existing) => [existing.id, existing]));
          byId.set(entry.id, entry);
          const nextEntries = Array.from(byId.values()).sort(
            (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
          );
          persistCompactionEntry(entry);
          return {
            compactionEntries: {
              ...state.compactionEntries,
              [entry.conversationId]: nextEntries,
            },
          };
        });
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
        // Throttled persistence: flush partial content every ~750ms so a
        // mid-stream crash, force-quit, or provider error after partial output
        // doesn't leave the message empty on disk forever.
        const now = Date.now();
        const last = streamingPersistTimestamps.get(messageId) ?? 0;
        if (now - last > 750) {
          streamingPersistTimestamps.set(messageId, now);
          const msg = get().messages[conversationId]?.find((m) => m.id === messageId);
          if (msg) persistMessage(msg);
        }
      },

      appendToThinking: (conversationId, messageId, chunk) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const updatedMessages = convMessages.map((m) =>
            m.id === messageId ? { ...m, thinkingContent: (m.thinkingContent ?? "") + chunk } : m
          );
          return { messages: { ...state.messages, [conversationId]: updatedMessages } };
        });
      },

      finalizeStreamingMessage: (conversationId, messageId) => {
        streamingPersistTimestamps.delete(messageId);
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

      deleteMessage: (conversationId, messageId) => {
        streamingPersistTimestamps.delete(messageId);
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const filtered = convMessages.filter((m) => m.id !== messageId);
          if (filtered.length === convMessages.length) return state;
          return {
            messages: { ...state.messages, [conversationId]: filtered },
          };
        });
        deleteMessageFromDb(messageId);
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

      updateToolCall: (conversationId, messageId, toolCallId, updates) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const updated = convMessages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  toolCalls: m.toolCalls?.map((tc) =>
                    tc.toolCallId === toolCallId
                      ? { ...tc, ...updates }
                      : tc,
                  ),
                }
              : m,
          );
          const changed = updated.find((m) => m.id === messageId);
          if (changed) persistMessage(changed);
          return {
            messages: { ...state.messages, [conversationId]: updated },
          };
        });
      },

      finalizeStuckToolCalls: (conversationId, messageId) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          let touched = false;
          const updated = convMessages.map((m) => {
            if (m.id !== messageId || !m.toolCalls?.length) return m;
            const toolCalls = m.toolCalls.map((tc) => {
              if (tc.state === "running" || tc.state === "pending_approval") {
                touched = true;
                return { ...tc, state: "done" as const };
              }
              return tc;
            });
            return touched ? { ...m, toolCalls } : m;
          });
          if (!touched) return {};
          const changed = updated.find((m) => m.id === messageId);
          if (changed) persistMessage(changed);
          return {
            messages: { ...state.messages, [conversationId]: updated },
          };
        });
      },

      updateToolCallTranscript: (conversationId, messageId, toolCallId, transcript) => {
        set((state) => {
          const convMessages = state.messages[conversationId] ?? [];
          const updated = convMessages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  toolCalls: m.toolCalls?.map((tc) =>
                    tc.toolCallId === toolCallId
                      ? { ...tc, subagentTranscript: transcript }
                      : tc,
                  ),
                }
              : m,
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

      enqueueMessage: (conversationId, content) =>
        set((state) => {
          const messageQueue = {
            ...state.messageQueue,
            [conversationId]: [...(state.messageQueue[conversationId] || []), { content }],
          };
          saveJsonSetting(MESSAGE_QUEUE_KEY, messageQueue);
          return { messageQueue };
        }),

      dequeueMessage: (conversationId) => {
        const queue = get().messageQueue[conversationId];
        if (!queue || queue.length === 0) return undefined;
        const [first, ...rest] = queue;
        set((state) => {
          const messageQueue = { ...state.messageQueue };
          if (rest.length > 0) messageQueue[conversationId] = rest;
          else delete messageQueue[conversationId];
          saveJsonSetting(MESSAGE_QUEUE_KEY, messageQueue);
          return { messageQueue };
        });
        return first;
      },

      steerMessage: (conversationId, content, queueIndex) => {
        const { cancelStreaming } = get();
        cancelStreaming();
        const queue = get().messageQueue[conversationId];
        if (queue) {
          const removeIndex =
            typeof queueIndex === "number" && queue[queueIndex]?.content === content
              ? queueIndex
              : queue.findIndex((q) => q.content === content);
          if (removeIndex >= 0) {
            const filtered = queue.filter((_, index) => index !== removeIndex);
            set((state) => {
              const messageQueue = { ...state.messageQueue };
              if (filtered.length > 0) messageQueue[conversationId] = filtered;
              else delete messageQueue[conversationId];
              saveJsonSetting(MESSAGE_QUEUE_KEY, messageQueue);
              return { messageQueue };
            });
          }
        }
        set({ steerPayload: { conversationId, content, steered: true } });
      },

      setSteerPayload: (payload) => set({ steerPayload: payload }),

      triggerContinue: (conversationId) => {
        const msgs = get().messages[conversationId] ?? [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.role === "assistant" && m.interrupted) {
            get().updateMessage(conversationId, m.id, { interrupted: false });
            break;
          }
        }
        set({
          steerPayload: {
            conversationId,
            content:
              "Continue your previous response exactly where it stopped. Do not repeat prior analysis or re-read attachments unless necessary.",
            steered: false,
          },
        });
      },

      addPendingDroppedFiles: (files) => {
        set((state) => ({ pendingDroppedFiles: [...state.pendingDroppedFiles, ...files] }));
      },

      clearPendingDroppedFiles: () => {
        set({ pendingDroppedFiles: [] });
      },

      setDraftContent: (key, content) => {
        set((state) => {
          const prev = state.drafts[key] ?? { content: "", attachments: [] };
          // Drop the entry entirely once the user has emptied it back out so
          // the drafts map stays small.
          if (!content && prev.attachments.length === 0) {
            if (!(key in state.drafts)) return state;
            const next = { ...state.drafts };
            delete next[key];
            return { drafts: next };
          }
          return { drafts: { ...state.drafts, [key]: { ...prev, content } } };
        });
      },

      setDraftAttachments: (key, attachments) => {
        set((state) => {
          const prev = state.drafts[key] ?? { content: "", attachments: [] };
          if (attachments.length === 0 && !prev.content) {
            if (!(key in state.drafts)) return state;
            const next = { ...state.drafts };
            delete next[key];
            return { drafts: next };
          }
          return { drafts: { ...state.drafts, [key]: { ...prev, attachments } } };
        });
      },

      appendDraftAttachments: (key, attachments) => {
        if (attachments.length === 0) return;
        set((state) => {
          const prev = state.drafts[key] ?? { content: "", attachments: [] };
          return {
            drafts: {
              ...state.drafts,
              [key]: { ...prev, attachments: [...prev.attachments, ...attachments] },
            },
          };
        });
      },

      clearDraft: (key) => {
        set((state) => {
          if (!(key in state.drafts)) return state;
          const next = { ...state.drafts };
          delete next[key];
          return { drafts: next };
        });
      },
      focusInput: () => {
        set((state) => ({ focusNonce: state.focusNonce + 1 }));
      },

      setArtifactPanelOpen: (open) => {
        set({ artifactPanelOpen: open });
      },

      setActiveArtifact: (id) => {
        set((state) => {
          let ownerConversationId: string | null = state.activeId;
          if (id) {
            const currentList = state.activeId ? state.artifacts[state.activeId] : undefined;
            const currentHasArtifact = currentList?.some((a) => a.id === id) ?? false;
            if (!currentHasArtifact) {
              for (const [conversationId, list] of Object.entries(state.artifacts)) {
                if (list.some((a) => a.id === id)) {
                  ownerConversationId = conversationId;
                  break;
                }
              }
            }
          }
          return {
            activeId: id ? ownerConversationId : state.activeId,
            activeArtifactId: id,
            artifactPanelOpen: !!id,
            workspacePanelOpen: id ? false : state.workspacePanelOpen,
            // Opening an artifact closes the attachment/workspace viewer.
            activeAttachment: id ? null : state.activeAttachment,
            attachmentPanelOpen: id ? false : state.attachmentPanelOpen,
            workspaceFile: id ? null : state.workspaceFile,
            subagentPanelOpen: id ? false : state.subagentPanelOpen,
            activeSubagentToolCallId: id ? null : state.activeSubagentToolCallId,
            sidebarOpen: id ? false : state.sidebarOpen,
          };
        });
      },

      setWorkspaceFile: (f) => {
        set({
          workspaceFile: f,
          // Opening a workspace file shows the artifact panel.
          artifactPanelOpen: !!f,
          workspacePanelOpen: f ? false : get().workspacePanelOpen,
          // Mutual exclusion: clear other panel state.
          activeArtifactId: f ? null : get().activeArtifactId,
          activeAttachment: f ? null : get().activeAttachment,
          attachmentPanelOpen: f ? false : get().attachmentPanelOpen,
          subagentPanelOpen: f ? false : get().subagentPanelOpen,
          activeSubagentToolCallId: f ? null : get().activeSubagentToolCallId,
          sidebarOpen: f ? false : get().sidebarOpen,
        });
      },

      setActiveAttachment: (a) => {
        set({
          activeAttachment: a,
          attachmentPanelOpen: !!a,
          workspacePanelOpen: a ? false : get().workspacePanelOpen,
          // Mutual exclusion with the artifact panel.
          activeArtifactId: a ? null : get().activeArtifactId,
          artifactPanelOpen: a ? false : get().artifactPanelOpen,
          workspaceFile: a ? null : get().workspaceFile,
          sidebarOpen: a ? false : get().sidebarOpen,
        });
      },

      openSubagentPanel: (toolCallId) => {
        set({
          subagentPanelOpen: true,
          activeSubagentToolCallId: toolCallId,
          artifactPanelOpen: false,
          attachmentPanelOpen: false,
          workspacePanelOpen: false,
          sidebarOpen: false,
        });
      },

      closeSubagentPanel: () => {
        set({
          subagentPanelOpen: false,
          activeSubagentToolCallId: null,
        });
      },

      updateArtifact: (conversationId, artifactId, code) => {
        set((state) => {
          const list = state.artifacts[conversationId];
          if (!list) return state;
          const next = list.map((a) => {
            if (a.id !== artifactId) return a;
            if (a.code === code) return a;

            const versions = a.versions ?? [];
            const idx = a.activeVersionIndex ?? versions.length - 1;
            // Branching-undo semantics: editing while mid-history drops the
            // "future" tail. Same model as VS Code, Figma, browsers.
            const trimmed = idx < versions.length - 1 ? versions.slice(0, idx + 1) : versions;

            const COALESCE_MS = 2000;
            const last = trimmed[trimmed.length - 1];
            if (last && last.source === "user" && Date.now() - last.createdAt < COALESCE_MS) {
              // Merge a stream of keystrokes into a single history entry so
              // typing 50 chars produces 1 version, not 50.
              const merged = { ...last, code, createdAt: Date.now() };
              const newVersions = [...trimmed.slice(0, -1), merged];
              return {
                ...a,
                code,
                versions: newVersions,
                activeVersionIndex: newVersions.length - 1,
              };
            }

            const newVersion: ArtifactVersion = {
              code,
              title: a.title,
              createdAt: Date.now(),
              source: "user",
            };
            const newVersions = [...trimmed, newVersion];
            return {
              ...a,
              code,
              versions: newVersions,
              activeVersionIndex: newVersions.length - 1,
            };
          });
          return { artifacts: { ...state.artifacts, [conversationId]: next } };
        });
      },

      editArtifactByKindAndTitle: (conversationId, kind, title, edits) => {
        let result: { artifactId: string; newCode: string } | null = null;
        set((state) => {
          const list = state.artifacts[conversationId];
          if (!list) return state;
          const want = normalizeTitle(title);
          const targetIdx = (() => {
            // Search from the end so the most recent match wins.
            for (let j = list.length - 1; j >= 0; j--) {
              if (list[j].kind === kind && normalizeTitle(list[j].title) === want) {
                return j;
              }
            }
            return -1;
          })();
          if (targetIdx < 0) return state;

          const target = list[targetIdx];
          let newCode = target.code;
          for (const { oldText, newText } of edits) {
            const idx = newCode.indexOf(oldText);
            if (idx === -1) continue; // skip non-matching edits silently
            newCode = newCode.slice(0, idx) + newText + newCode.slice(idx + oldText.length);
          }
          if (newCode === target.code) return state; // nothing changed

          const now = Date.now();
          const versions = target.versions ?? [];
          const activeIdx = target.activeVersionIndex ?? versions.length - 1;
          const trimmed = activeIdx < versions.length - 1 ? versions.slice(0, activeIdx + 1) : versions;
          const newVersion: ArtifactVersion = {
            code: newCode,
            title: target.title,
            createdAt: now,
            source: "agent",
          };
          const newVersions = [...trimmed, newVersion];
          const next = list.map((a, i) =>
            i === targetIdx
              ? { ...a, code: newCode, versions: newVersions, activeVersionIndex: newVersions.length - 1 }
              : a,
          );
          result = { artifactId: target.id, newCode };
          return { artifacts: { ...state.artifacts, [conversationId]: next } };
        });
        return result;
      },

      undoArtifact: (conversationId, artifactId) => {
        set((state) => {
          const list = state.artifacts[conversationId];
          if (!list) return state;
          const next = list.map((a) => {
            if (a.id !== artifactId) return a;
            const idx = a.activeVersionIndex ?? (a.versions?.length ?? 1) - 1;
            if (idx <= 0) return a;
            const v = a.versions[idx - 1];
            return { ...a, code: v.code, title: v.title, activeVersionIndex: idx - 1 };
          });
          return { artifacts: { ...state.artifacts, [conversationId]: next } };
        });
      },

      redoArtifact: (conversationId, artifactId) => {
        set((state) => {
          const list = state.artifacts[conversationId];
          if (!list) return state;
          const next = list.map((a) => {
            if (a.id !== artifactId) return a;
            const versions = a.versions ?? [];
            const idx = a.activeVersionIndex ?? versions.length - 1;
            if (idx >= versions.length - 1) return a;
            const v = versions[idx + 1];
            return { ...a, code: v.code, title: v.title, activeVersionIndex: idx + 1 };
          });
          return { artifacts: { ...state.artifacts, [conversationId]: next } };
        });
      },

      restoreArtifactVersion: (conversationId, artifactId, versionIndex) => {
        set((state) => {
          const list = state.artifacts[conversationId];
          if (!list) return state;
          const next = list.map((a) => {
            if (a.id !== artifactId) return a;
            const v = a.versions?.[versionIndex];
            if (!v) return a;
            return {
              ...a,
              code: v.code,
              title: v.title,
              activeVersionIndex: versionIndex,
            };
          });
          return { artifacts: { ...state.artifacts, [conversationId]: next } };
        });
      },

      detectArtifacts: (conversationId, messageId, content) => {
        const flags = get();
        // When the user has turned auto-artifacts off, leave the chat
        // bubble's code intact and never push anything into the canvas.
        if (!flags.autoArtifacts) return;
        const enabledKinds = new Set<ArtifactKind>([
          "html", "latex", "python",
          // Design mode artifact kinds
          "deck", "react-component", "markdown-document", "svg", 
          "diagram", "code-snippet", "mini-app", "design-system"
        ]);
        if (flags.officeArtifacts) {
          enabledKinds.add("docx");
          enabledKinds.add("pptx");
          enabledKinds.add("xlsx");
        }
        const blocks = extractArtifactBlocks(content, { enabledKinds });
        if (blocks.length === 0) return;

        set((state) => {
          const existing = state.artifacts[conversationId] ?? [];
          const next = [...existing];
          const updatedIds = new Set<string>();
          let activeId: string | null = null;

          for (let i = 0; i < blocks.length; i++) {
            const { kind, code, title } = blocks[i];

            // ── Edit-mode detection ───────────────────────────────────────
            // When the fence body contains <<<EDIT>>> markers, apply the
            // edits surgically to the existing artifact instead of doing a
            // full replacement.  Falls through to normal replacement if the
            // target artifact doesn't exist yet (can't edit what doesn't
            // exist) or if edit application produces no change.
            const editMode = isEditArtifact(code);

            const targetIdx = (() => {
              const want = normalizeTitle(title);
              for (let j = next.length - 1; j >= 0; j--) {
                if (
                  next[j].kind === kind &&
                  normalizeTitle(next[j].title) === want &&
                  !updatedIds.has(next[j].id)
                ) {
                  return j;
                }
              }
              return -1;
            })();

            const now = Date.now();

            if (editMode && targetIdx >= 0) {
              // ── Selective edit path ───────────────────────────────────
              const target = next[targetIdx];
              const edits = parseEditBlocks(code);

              const versions = target.versions ?? [];
              const activeIdx = target.activeVersionIndex ?? versions.length - 1;
              const last = versions[activeIdx];
              const isCurrentStream = last &&
                last.streaming &&
                last.messageId === messageId &&
                last.fenceIndex === i;

              // If it is currently streaming, its code has already been updated
              // to the incremental edit markers. We need the base version from
              // before streaming started.
              const baseCode = isCurrentStream && activeIdx > 0
                ? versions[activeIdx - 1].code
                : target.code;

              let finalPatchedCode = baseCode;
              let applySuccess = false;

              if (edits.length > 0) {
                const result = applyEditBlocks(baseCode, edits);
                if (result.applied > 0) {
                  finalPatchedCode = result.code;
                  applySuccess = true;
                }
              }

              if (applySuccess) {
                if (isCurrentStream) {
                  const promoted: ArtifactVersion = {
                    ...last,
                    code: finalPatchedCode,
                    title,
                    createdAt: now,
                    streaming: false,
                  };
                  const newVersions = [...versions.slice(0, activeIdx), promoted, ...versions.slice(activeIdx + 1)];
                  next[targetIdx] = {
                    ...target,
                    code: finalPatchedCode,
                    title,
                    messageId,
                    createdAt: now,
                    versions: newVersions,
                    activeVersionIndex: activeIdx,
                  };
                } else {
                  const trimmed = activeIdx < versions.length - 1 ? versions.slice(0, activeIdx + 1) : versions;
                  const newVersion: ArtifactVersion = {
                    code: finalPatchedCode,
                    title,
                    createdAt: now,
                    source: "agent",
                    messageId,
                    fenceIndex: i,
                  };
                  const newVersions = [...trimmed, newVersion];
                  next[targetIdx] = {
                    ...target,
                    code: finalPatchedCode,
                    title,
                    messageId,
                    createdAt: now,
                    versions: newVersions,
                    activeVersionIndex: newVersions.length - 1,
                  };
                }
              } else {
                // Edit failed to apply or parse. Revert the streaming version
                // (if present) so it doesn't display raw <<<EDIT>>> markers.
                if (isCurrentStream) {
                  const promoted: ArtifactVersion = {
                    ...last,
                    code: baseCode,
                    title,
                    createdAt: now,
                    streaming: false,
                  };
                  const newVersions = [...versions.slice(0, activeIdx), promoted, ...versions.slice(activeIdx + 1)];
                  next[targetIdx] = {
                    ...target,
                    code: baseCode,
                    title,
                    messageId,
                    createdAt: now,
                    versions: newVersions,
                    activeVersionIndex: activeIdx,
                  };
                }
              }
              updatedIds.add(target.id);
              if (activeId === null) activeId = target.id;
              continue; // edit mode processed — skip normal paths
            }

            if (targetIdx >= 0) {
              const target = next[targetIdx];
              const versions = target.versions ?? [];
              const activeIdx = target.activeVersionIndex ?? versions.length - 1;
              const last = versions[activeIdx];
              // If the live streaming version already corresponds to this
              // (messageId, fenceIndex), promote it in place — no new
              // version, no version-history spam.
              if (
                last &&
                last.streaming &&
                last.messageId === messageId &&
                last.fenceIndex === i
              ) {
                const promoted: ArtifactVersion = {
                  ...last,
                  code,
                  title,
                  createdAt: now,
                  streaming: false,
                };
                const newVersions = [...versions.slice(0, activeIdx), promoted, ...versions.slice(activeIdx + 1)];
                next[targetIdx] = {
                  ...target,
                  code,
                  title,
                  messageId,
                  createdAt: now,
                  versions: newVersions,
                  activeVersionIndex: activeIdx,
                };
              } else {
                // Standard path — append a fresh agent version.
                // Branching rule: agent edits after a user undo drop the
                // future. The user undid for a reason; the agent's new
                // version is the new "tip".
                const trimmed = activeIdx < versions.length - 1 ? versions.slice(0, activeIdx + 1) : versions;
                const newVersion: ArtifactVersion = {
                  code,
                  title,
                  createdAt: now,
                  source: "agent",
                  messageId,
                  fenceIndex: i,
                };
                const newVersions = [...trimmed, newVersion];
                next[targetIdx] = {
                  ...target,
                  code,
                  title,
                  messageId,
                  createdAt: now,
                  versions: newVersions,
                  activeVersionIndex: newVersions.length - 1,
                };
              }
              updatedIds.add(target.id);
              if (activeId === null) activeId = target.id;
            } else {
              // Edit-mode with no existing artifact to patch — skip rather
              // than creating a new artifact whose "code" is raw edit markers.
              if (editMode) continue;
              const id = `${messageId}-${i}`;
              const newVersion: ArtifactVersion = {
                code,
                title,
                createdAt: now,
                source: "agent",
                messageId,
                fenceIndex: i,
              };
              next.push({
                id,
                kind,
                title,
                code,
                messageId,
                createdAt: now,
                versions: [newVersion],
                activeVersionIndex: 0,
              });
              if (activeId === null) activeId = id;
            }
          }

          return {
            artifacts: { ...state.artifacts, [conversationId]: next },
            artifactPanelOpen: true,
            activeArtifactId: activeId ?? state.activeArtifactId,
            sidebarOpen: false,
          };
        });
      },

      streamArtifactDelta: (conversationId, messageId, kind, title, fenceIndex, code) => {
        const flags = get();
        if (!flags.autoArtifacts) return;
        if (!flags.officeArtifacts && (kind === "docx" || kind === "pptx" || kind === "xlsx")) return;
        set((state) => {
          const existing = state.artifacts[conversationId] ?? [];
          const next = [...existing];
          let activeId: string | null = state.activeArtifactId;

          // 1. Look for an existing streaming version keyed on
          //    (messageId, fenceIndex). That's the strongest match because
          //    titles can shift mid-stream.
          let targetIdx = -1;
          for (let j = next.length - 1; j >= 0; j--) {
            const versions = next[j].versions ?? [];
            const activeIdx = next[j].activeVersionIndex ?? versions.length - 1;
            const last = versions[activeIdx];
            if (
              last &&
              last.streaming &&
              last.messageId === messageId &&
              last.fenceIndex === fenceIndex
            ) {
              targetIdx = j;
              break;
            }
          }

          if (targetIdx >= 0) {
            const target = next[targetIdx];
            const versions = target.versions ?? [];
            const activeIdx = target.activeVersionIndex ?? versions.length - 1;
            const last = versions[activeIdx];
            // Skip the update entirely when nothing has changed —
            // saves a re-render per token for runs of un-buffered whitespace.
            if (last && last.code === code && last.title === title) return state;
            const merged: ArtifactVersion = {
              ...last,
              code,
              title: title || last.title,
              createdAt: Date.now(),
            };
            const newVersions = [...versions.slice(0, activeIdx), merged, ...versions.slice(activeIdx + 1)];
            next[targetIdx] = {
              ...target,
              code,
              title: title || target.title,
              versions: newVersions,
              activeVersionIndex: activeIdx,
            };
            return { artifacts: { ...state.artifacts, [conversationId]: next } };
          }

          // 2. No streaming version yet — try to attach to an
          //    existing artifact by (kind, normalized title) so an
          //    edit-in-place flows into the same canvas tab.
          const want = normalizeTitle(title);
          if (want) {
            for (let j = next.length - 1; j >= 0; j--) {
              if (next[j].kind === kind && normalizeTitle(next[j].title) === want) {
                targetIdx = j;
                break;
              }
            }
          }

          const now = Date.now();
          const streamingVersion: ArtifactVersion = {
            code,
            title,
            createdAt: now,
            source: "agent",
            messageId,
            fenceIndex,
            streaming: true,
          };

          if (targetIdx >= 0) {
            const target = next[targetIdx];
            const versions = target.versions ?? [];
            const activeIdx = target.activeVersionIndex ?? versions.length - 1;
            const trimmed = activeIdx < versions.length - 1 ? versions.slice(0, activeIdx + 1) : versions;
            const newVersions = [...trimmed, streamingVersion];
            next[targetIdx] = {
              ...target,
              code,
              title: title || target.title,
              messageId,
              createdAt: now,
              versions: newVersions,
              activeVersionIndex: newVersions.length - 1,
            };
            activeId = target.id;
          } else {
            const id = `${messageId}-${fenceIndex}`;
            next.push({
              id,
              kind,
              title,
              code,
              messageId,
              createdAt: now,
              versions: [streamingVersion],
              activeVersionIndex: 0,
            });
            activeId = id;
          }

          // Auto-open the canvas on the first delta so the user sees the
          // code being typed without having to click anything. Only flip
          // when nothing else is currently focused (don't yank an artifact
          // the user is already reading).
          const shouldFocus = state.activeArtifactId === null || state.activeArtifactId === activeId;
          return {
            artifacts: { ...state.artifacts, [conversationId]: next },
            artifactPanelOpen: shouldFocus ? true : state.artifactPanelOpen,
            activeArtifactId: shouldFocus ? activeId : state.activeArtifactId,
            sidebarOpen: shouldFocus ? false : state.sidebarOpen,
          };
        });
      },

      finalizeStreamingArtifacts: (conversationId, messageId) => {
        set((state) => {
          const list = state.artifacts[conversationId];
          if (!list) return state;
          let touched = false;
          const next = list.map((a) => {
            const versions = a.versions ?? [];
            const activeIdx = a.activeVersionIndex ?? versions.length - 1;
            const last = versions[activeIdx];
            if (!last || !last.streaming || last.messageId !== messageId) return a;
            touched = true;

            // ── Edit-mode resolution ─────────────────────────────────────
            // If the streaming version's code contains <<<EDIT>>> markers,
            // apply the edits against the prior version's code.  This is the
            // streaming counterpart of the edit path in detectArtifacts.
            let finalCode = last.code;
            if (isEditArtifact(last.code) && activeIdx > 0) {
              const baseVersion = versions[activeIdx - 1];
              if (baseVersion) {
                const edits = parseEditBlocks(last.code);
                if (edits.length > 0) {
                  const result = applyEditBlocks(baseVersion.code, edits);
                  if (result.applied > 0) {
                    finalCode = result.code;
                  } else {
                    finalCode = baseVersion.code;
                  }
                } else {
                  finalCode = baseVersion.code;
                }
              }
            }

            const cleared: ArtifactVersion = { ...last, code: finalCode, streaming: false };
            const newVersions = [...versions.slice(0, activeIdx), cleared, ...versions.slice(activeIdx + 1)];
            return { ...a, code: finalCode, versions: newVersions };
          });
          if (!touched) return {};
          return { artifacts: { ...state.artifacts, [conversationId]: next } };
        });
      },

      clearArtifacts: (conversationId) => {
        set((state) => {
          const next = { ...state.artifacts };
          delete next[conversationId];
          return { artifacts: next, activeArtifactId: null, artifactPanelOpen: false };
        });
      },

      upsertDesignArtifact: (conversationId, title, code) => {
        const normalizedTitle = normalizeTitle(title);
        set((state) => {
          const existing = state.artifacts[conversationId] ?? [];
          const idx = existing.findIndex(
            (a) => a.kind === "html" && normalizeTitle(a.title) === normalizedTitle,
          );
          const now = Date.now();
          if (idx >= 0) {
            const next = [...existing];
            const art = { ...next[idx] };
            const versions = [...(art.versions ?? [])];
            const activeIdx = art.activeVersionIndex ?? versions.length - 1;
            const last = versions[activeIdx];
            if (last && last.code === code) return {};
            const newVersion: ArtifactVersion = { code, title, createdAt: now, source: "agent" };
            versions.push(newVersion);
            art.versions = versions;
            art.activeVersionIndex = versions.length - 1;
            art.code = code;
            art.title = title;
            art.createdAt = now;
            next[idx] = art;
            return { artifacts: { ...state.artifacts, [conversationId]: next }, activeArtifactId: art.id };
          }
          const id = `design-html-${now}`;
          const newVersion: ArtifactVersion = { code, title, createdAt: now, source: "agent" };
          const art: Artifact = {
            id, kind: "html", title, code, messageId: "", createdAt: now,
            versions: [newVersion], activeVersionIndex: 0,
          };
          return {
            artifacts: { ...state.artifacts, [conversationId]: [...existing, art] },
            activeArtifactId: id,
            artifactPanelOpen: true,
          };
        });
      },

      addImageArtifact: (conversationId, title, dataUrl, messageId = "") => {
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        const version: ArtifactVersion = {
          code: dataUrl,
          title,
          createdAt: now,
          source: "agent",
          messageId,
        };
        const artifact: Artifact = {
          id,
          kind: "image",
          title,
          code: dataUrl,
          messageId,
          createdAt: now,
          versions: [version],
          activeVersionIndex: 0,
        };
        set((state) => ({
          artifacts: {
            ...state.artifacts,
            [conversationId]: [...(state.artifacts[conversationId] ?? []), artifact],
          },
          activeArtifactId: id,
          artifactPanelOpen: true,
          workspacePanelOpen: false,
          sidebarOpen: false,
        }));
        return id;
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

      setDesignWorkspace: (path) => {
        set({ designWorkspacePath: path });
        try { localStorage.setItem("goatllm-design-workspace-path", path ?? ""); } catch {}
      },

      addDesignWorkspace: (path) => {
        set((s) => {
          if (s.designWorkspaces.includes(path)) return {};
          const next = [...s.designWorkspaces, path];
          try { localStorage.setItem("goatllm-design-workspaces", JSON.stringify(next)); } catch {}
          return { designWorkspaces: next };
        });
      },

      removeDesignWorkspace: (path) => {
        set((s) => {
          const next = s.designWorkspaces.filter((w) => w !== path);
          try { localStorage.setItem("goatllm-design-workspaces", JSON.stringify(next)); } catch {}
          return {
            designWorkspaces: next,
            designWorkspacePath: s.designWorkspacePath === path ? null : s.designWorkspacePath,
          };
        });
      },

      setAgentMode: (enabled) => {
        set({ agentMode: enabled });
        try { localStorage.setItem("goatllm-agent-mode", String(enabled)); } catch {}
        // Plan mode is agent-only — leaving agent mode resets it.
        if (!enabled && get().planMode) {
          set({ planMode: false });
          try { localStorage.setItem("goatllm-plan-mode", "false"); } catch {}
        }
        // Mutual exclusion with design mode.
        if (enabled && get().designMode) {
          set({ designMode: false });
          try { localStorage.setItem("goatllm-design-mode", "false"); } catch {}
        }
        // Mutual exclusion with notebook mode.
        if (enabled && get().notebookMode) {
          set({ notebookMode: false });
          try { localStorage.setItem("goatllm-notebook-mode", "false"); } catch {}
        }
      },

      toggleAgentMode: () => {
        const next = !get().agentMode;
        set({ agentMode: next });
        try { localStorage.setItem("goatllm-agent-mode", String(next)); } catch {}
        // Same guarantee as setAgentMode.
        if (!next && get().planMode) {
          set({ planMode: false });
          try { localStorage.setItem("goatllm-plan-mode", "false"); } catch {}
        }
        if (next && get().designMode) {
          set({ designMode: false });
          try { localStorage.setItem("goatllm-design-mode", "false"); } catch {}
        }
        if (next && get().notebookMode) {
          set({ notebookMode: false });
          try { localStorage.setItem("goatllm-notebook-mode", "false"); } catch {}
        }
      },

      setDesignMode: (enabled) => {
        set({ designMode: enabled });
        try { localStorage.setItem("goatllm-design-mode", String(enabled)); } catch {}
        // Mutual exclusion with agent mode (and therefore plan mode).
        if (enabled && get().agentMode) {
          set({ agentMode: false, planMode: false });
          try {
            localStorage.setItem("goatllm-agent-mode", "false");
            localStorage.setItem("goatllm-plan-mode", "false");
          } catch {}
        }
        // Mutual exclusion with notebook mode.
        if (enabled && get().notebookMode) {
          set({ notebookMode: false });
          try { localStorage.setItem("goatllm-notebook-mode", "false"); } catch {}
        }
      },

      toggleDesignMode: () => {
        const next = !get().designMode;
        set({ designMode: next });
        try { localStorage.setItem("goatllm-design-mode", String(next)); } catch {}
        if (next && get().agentMode) {
          set({ agentMode: false, planMode: false });
          try {
            localStorage.setItem("goatllm-agent-mode", "false");
            localStorage.setItem("goatllm-plan-mode", "false");
          } catch {}
        }
        if (next && get().notebookMode) {
          set({ notebookMode: false });
          try { localStorage.setItem("goatllm-notebook-mode", "false"); } catch {}
        }
      },

      setNotebookMode: (enabled) => {
        set({ notebookMode: enabled });
        try { localStorage.setItem("goatllm-notebook-mode", String(enabled)); } catch {}
        // Mutual exclusion with agent mode (and therefore plan mode).
        if (enabled && get().agentMode) {
          set({ agentMode: false, planMode: false });
          try {
            localStorage.setItem("goatllm-agent-mode", "false");
            localStorage.setItem("goatllm-plan-mode", "false");
          } catch {}
        }
        // Mutual exclusion with design mode.
        if (enabled && get().designMode) {
          set({ designMode: false });
          try { localStorage.setItem("goatllm-design-mode", "false"); } catch {}
        }
      },

      toggleNotebookMode: () => {
        const next = !get().notebookMode;
        set({ notebookMode: next });
        try { localStorage.setItem("goatllm-notebook-mode", String(next)); } catch {}
        if (next && get().agentMode) {
          set({ agentMode: false, planMode: false });
          try {
            localStorage.setItem("goatllm-agent-mode", "false");
            localStorage.setItem("goatllm-plan-mode", "false");
          } catch {}
        }
        if (next && get().designMode) {
          set({ designMode: false });
          try { localStorage.setItem("goatllm-design-mode", "false"); } catch {}
        }
      },

      setJjAgent: (enabled) => {
        set({ jjagent: enabled });
        try { localStorage.setItem("goatllm-jjagent", String(enabled)); } catch {}
      },

      setJjAgentChangeId: (id) => set({ jjagentChangeId: id }),

      setPendingFormSubmission: (payload) => set({ pendingFormSubmission: payload }),

      setActiveSkill: (id) => {
        set({ activeSkillId: id });
        try { localStorage.setItem("goatllm-active-skill", id ?? ""); } catch {}
      },
      setActiveDesignSystem: (id) => {
        set({ activeDesignSystemId: id });
        try { localStorage.setItem("goatllm-active-design-system", id ?? ""); } catch {}
      },
      setActiveDirection: (id) => {
        set({ activeDirectionId: id });
        try { localStorage.setItem("goatllm-active-direction", id ?? ""); } catch {}
      },

      setResearchMode: (enabled) => {
        set({ researchMode: enabled });
        try { localStorage.setItem("goatllm-research-mode", String(enabled)); } catch {}
      },

      toggleResearchMode: () => {
        set((state) => {
          const next = !state.researchMode;
          try { localStorage.setItem("goatllm-research-mode", String(next)); } catch {}
          return { researchMode: next };
        });
      },

      openWorkspacePanel: (tab) => {
        const nextTab = tab ?? get().workspacePanelTab;
        set({
          workspacePanelOpen: true,
          workspacePanelTab: nextTab,
          artifactPanelOpen: false,
          attachmentPanelOpen: false,
          subagentPanelOpen: false,
          sidebarOpen: false,
        });
        saveJsonSetting(PRODUCT_WORKSPACE_STATE_KEY, {
          workspacePanelOpen: true,
          workspacePanelTab: nextTab,
        });
      },

      closeWorkspacePanel: () => {
        set({ workspacePanelOpen: false });
        saveJsonSetting(PRODUCT_WORKSPACE_STATE_KEY, {
          workspacePanelOpen: false,
          workspacePanelTab: get().workspacePanelTab,
        });
      },

      setWorkspacePanelTab: (tab) => {
        set({ workspacePanelTab: tab, workspacePanelOpen: true });
        saveJsonSetting(PRODUCT_WORKSPACE_STATE_KEY, {
          workspacePanelOpen: true,
          workspacePanelTab: tab,
        });
      },

      setUsageSettings: (settings) => {
        const safe: UsageSettings = {
          ...DEFAULT_USAGE_SETTINGS,
          ...settings,
          priceOverrides: settings.priceOverrides ?? {},
          compactionSettings: {
            ...DEFAULT_COMPACTION_SETTINGS,
            ...(settings.compactionSettings ?? {}),
          },
        };
        set({ usageSettings: safe });
        saveJsonSetting(USAGE_SETTINGS_KEY, safe);
      },

      setVoiceSettings: (settings) => {
        set({ voiceSettings: settings });
        saveJsonSetting(VOICE_SETTINGS_KEY, settings);
      },

      setMeetingSettings: (settings) => {
        const safe = sanitizeMeetingSettings(settings);
        set({ meetingSettings: safe });
        persistMeetingState(get().meetingSessions, safe);
      },

      setMeetingSessions: (sessions) => {
        const safe = sanitizeMeetingSessions(sessions);
        set({ meetingSessions: safe });
        persistMeetingState(safe, get().meetingSettings);
      },

      updateMeetingSession: (sessionId, updates) => {
        const next = sanitizeMeetingSessions(get().meetingSessions.map((session) =>
          session.id === sessionId ? { ...session, ...updates, updatedAt: Date.now() } : session,
        ));
        set({ meetingSessions: next });
        persistMeetingState(next, get().meetingSettings);
      },

      deleteMeetingSession: (sessionId) => {
        const next = get().meetingSessions.filter((session) => session.id !== sessionId);
        set({ meetingSessions: next });
        persistMeetingState(next, get().meetingSettings);
      },

      continueMeetingSession: (sessionId) => {
        const session = get().meetingSessions.find((item) => item.id === sessionId);
        if (!session) return null;
        const conversationId = get().createConversation();
        get().addMessage({
          conversationId,
          role: "user",
          content: buildContinueMeetingPrompt(session),
        });
        const next = sanitizeMeetingSessions(get().meetingSessions.map((item) =>
          item.id === sessionId ? { ...item, conversationId, updatedAt: Date.now() } : item,
        ));
        set({ meetingSessions: next });
        persistMeetingState(next, get().meetingSettings);
        return conversationId;
      },

      setSyncSettings: (settings) => {
        set({ syncSettings: settings });
        saveJsonSetting(SYNC_SETTINGS_KEY, settings);
      },

      setImageGenSettings: (settings) => {
        set({ imageGenSettings: settings });
        saveJsonSetting(IMAGE_GEN_SETTINGS_KEY, settings);
      },

      setFeatureFlag: (key, enabled) => {
        const next = { ...get().featureFlags, [key]: enabled };
        set({ featureFlags: next });
        saveJsonSetting(FEATURE_FLAGS_KEY, next);
        // Disabling the Notebook feature while you're in it would otherwise
        // strand you on a view with no way back (its toggle is hidden). Drop
        // back to chat mode.
        if (key === "notebookMode" && !enabled && get().notebookMode) {
          set({ notebookMode: false });
          try { localStorage.setItem("goatllm-notebook-mode", "false"); } catch {}
        }
      },

      setPlusMenuItemVisible: (mode, key, visible) => {
        const current = get().plusMenuVisibility;
        const next = {
          ...current,
          [mode]: {
            ...current[mode],
            [key]: visible,
          },
        };
        set({ plusMenuVisibility: next });
        saveJsonSetting(PLUS_MENU_VISIBILITY_KEY, next);
      },

      setBrowserMirror: (updates) => {
        set((state) => ({ browserMirror: { ...state.browserMirror, ...updates } }));
      },

      addModelComparisonRun: (run) => {
        const next = [run, ...get().modelComparisonRuns].slice(0, 20);
        set({ modelComparisonRuns: next });
        saveJsonSetting(MODEL_COMPARISON_RUNS_KEY, next);
      },

      updateModelComparisonRun: (runId, updates) => {
        const next = get().modelComparisonRuns.map((run) =>
          run.id === runId ? { ...run, ...updates } : run,
        );
        set({ modelComparisonRuns: next });
        saveJsonSetting(MODEL_COMPARISON_RUNS_KEY, next);
      },

      setNotebookCells: (cells) => {
        set({ notebookCells: cells });
        saveJsonSetting(NOTEBOOK_CELLS_KEY, cells);
      },

      createNotebook: () => {
        const nb = createNotebook();
        const next = [...get().notebooks, nb];
        set({ notebooks: next, activeNotebookId: nb.id });
        saveJsonSetting(NOTEBOOKS_KEY, next);
        saveJsonSetting(ACTIVE_NOTEBOOK_KEY, nb.id);
        return nb.id;
      },

      renameNotebook: (id, name) => {
        const clean = name.trim();
        const next = get().notebooks.map((nb) =>
          nb.id === id ? { ...nb, name: clean || nb.name, updatedAt: Date.now() } : nb,
        );
        set({ notebooks: next });
        saveJsonSetting(NOTEBOOKS_KEY, next);
      },

      deleteNotebook: (id) => {
        const next = get().notebooks.filter((nb) => nb.id !== id);
        let activeId = get().activeNotebookId;
        if (activeId === id) {
          // Fall back to the most recently updated remaining notebook, or none.
          activeId =
            next.length > 0
              ? [...next].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
              : null;
        }
        set({ notebooks: next, activeNotebookId: activeId });
        saveJsonSetting(NOTEBOOKS_KEY, next);
        saveJsonSetting(ACTIVE_NOTEBOOK_KEY, activeId);
      },

      setActiveNotebook: (id) => {
        set({ activeNotebookId: id });
        saveJsonSetting(ACTIVE_NOTEBOOK_KEY, id);
      },

      getActiveNotebook: () => {
        const { notebooks, activeNotebookId } = get();
        return notebooks.find((nb) => nb.id === activeNotebookId) ?? null;
      },

      setActiveNotebookContents: (board, persist = true) => {
        const { notebooks, activeNotebookId } = get();
        if (!activeNotebookId) return; // no-op: guards against streaming into a deleted notebook
        const next = notebooks.map((nb) =>
          nb.id === activeNotebookId
            ? { ...nb, panels: board.panels, chat: board.chat, updatedAt: Date.now() }
            : nb,
        );
        set({ notebooks: next });
        // Mid-stream updates pass persist=false to avoid writing the whole
        // collection on every token; sanitizeNotebooks settles partial state on
        // reload anyway.
        if (persist) saveJsonSetting(NOTEBOOKS_KEY, next);
      },

      updateNotebookCell: (cellId, updates, persist = true) => {
        const next = get().notebookCells.map((cell) =>
          cell.id === cellId ? { ...cell, ...updates, updatedAt: Date.now() } : cell,
        );
        set({ notebookCells: next });
        // Mid-stream token updates pass persist=false to avoid writing the whole
        // cells array to localStorage on every delta. The sanitizer discards any
        // partial "running" state on reload, so skipping the write is safe.
        if (persist) saveJsonSetting(NOTEBOOK_CELLS_KEY, next);
      },

      addImageJob: (job) => {
        const next = [job, ...get().imageJobs].slice(0, 50);
        set({ imageJobs: next });
        saveJsonSetting(IMAGE_JOBS_KEY, next);
      },

      updateImageJob: (jobId, updates) => {
        const next = get().imageJobs.map((job) =>
          job.id === jobId ? { ...job, ...updates } : job,
        );
        set({ imageJobs: next });
        saveJsonSetting(IMAGE_JOBS_KEY, next);
      },

      setScheduledAgents: (agents) => {
        set({ scheduledAgents: agents });
        persistScheduledAgentState(agents, get().scheduledAgentRuns);
      },

      setScheduledAgentRuns: (runs) => {
        const next = sanitizeScheduledAgentRuns(runs);
        set({ scheduledAgentRuns: next });
        persistScheduledAgentState(get().scheduledAgents, next);
      },

      runScheduledAgent: async (agentId) => {
        const agent = get().scheduledAgents.find((item) => item.id === agentId);
        if (!agent) return;
        const startedAt = Date.now();
        const run: ScheduledAgentRun = {
          ...createScheduledAgentRun(agent, startedAt),
          status: "running",
          startedAt,
          trace: ["Run started."],
        };
        let runs = appendScheduledRun(get().scheduledAgentRuns, run, 200);
        let agents = get().scheduledAgents.map((item) =>
          item.id === agent.id ? { ...item, lastStatus: "running" as const, lastRunAt: startedAt, lastResult: "Running..." } : item,
        );
        set({ scheduledAgents: agents, scheduledAgentRuns: runs });
        persistScheduledAgentState(agents, runs);

        try {
          const config = get().getActiveLlmConfig();
          if (!config) throw new Error("No model is selected.");
          const { generateText } = await import("ai");
          const { createModel } = await import("../lib/model-factory");
          const model = await createModel(config);
          const response = await generateText({
            model,
            system: "You are running a scheduled goatLLM agent. Complete the scheduled task directly, keep the result concise, and include any useful next actions.",
            prompt: agent.prompt,
            maxOutputTokens: config.maxResponseTokens ?? 2048,
            temperature: 0.4,
          });
          const completedAt = Date.now();
          const nextRunAt = computeNextScheduledRun(agent.schedule, new Date(completedAt)).getTime();
          const completedRun: ScheduledAgentRun = {
            ...run,
            status: "done",
            completedAt,
            result: response.text,
            trace: [...run.trace, "Model completed the run."],
          };
          runs = appendScheduledRun(runs, completedRun, 200);
          agents = agents.map((item) =>
            item.id === agent.id
              ? updateScheduledAgentAfterRun(item, {
                  status: "done",
                  result: response.text,
                  completedAt,
                  nextRunAt,
                })
              : item,
          );
          set({ scheduledAgents: agents, scheduledAgentRuns: runs });
          persistScheduledAgentState(agents, runs);
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(`${agent.name} completed`, { body: response.text.slice(0, 120) || "Scheduled run complete." });
          }
        } catch (e) {
          const completedAt = Date.now();
          const nextRunAt = (() => {
            try {
              return computeNextScheduledRun(agent.schedule, new Date(completedAt)).getTime();
            } catch {
              return completedAt + 60 * 60 * 1000;
            }
          })();
          const error = e instanceof Error ? e.message : String(e);
          const failedRun: ScheduledAgentRun = {
            ...run,
            status: "error",
            completedAt,
            error,
            trace: [...run.trace, `Run failed: ${error}`],
          };
          runs = appendScheduledRun(runs, failedRun, 200);
          agents = agents.map((item) =>
            item.id === agent.id
              ? updateScheduledAgentAfterRun(item, {
                  status: "error",
                  error,
                  completedAt,
                  nextRunAt,
                })
              : item,
          );
          set({ scheduledAgents: agents, scheduledAgentRuns: runs });
          persistScheduledAgentState(agents, runs);
        }
      },

      continueScheduledRun: (runId) => {
        const run = get().scheduledAgentRuns.find((item) => item.id === runId);
        if (!run) return null;
        const conversationId = get().createConversation();
        get().addMessage({
          conversationId,
          role: "user",
          content: buildContinueScheduledRunPrompt(run),
        });
        const runs = get().scheduledAgentRuns.map((item) =>
          item.id === runId ? { ...item, conversationId, readAt: Date.now() } : item,
        );
        set({ scheduledAgentRuns: runs });
        persistScheduledAgentState(get().scheduledAgents, runs);
        return conversationId;
      },

      addWatcherEvent: (event) => {
        const next = [event, ...get().watcherEvents].slice(0, 100);
        set({ watcherEvents: next });
        saveJsonSetting(WATCHER_EVENTS_KEY, next);
      },

      clearWatcherEvents: () => {
        set({ watcherEvents: [] });
        saveJsonSetting(WATCHER_EVENTS_KEY, []);
      },

      setRagSettings: (settings) => {
        set({ ragSettings: settings });
        saveJsonSetting(RAG_SETTINGS_KEY, settings);
      },

      createDocumentWorkspace: (name = "Knowledge workspace") => {
        const workspace = createKnowledgeWorkspace(name, get().workspacePath);
        const next = [workspace, ...get().documentWorkspaces];
        set({ documentWorkspaces: next, activeDocumentWorkspaceId: workspace.id });
        persistDocumentWorkspaces(next);
        saveJsonSetting(ACTIVE_DOCUMENT_WORKSPACE_KEY, workspace.id);
        return workspace.id;
      },

      deleteDocumentWorkspace: (id) => {
        const next = deletePersistedDocumentWorkspace(id, get().documentWorkspaces);
        const currentActive = get().activeDocumentWorkspaceId;
        const activeDocumentWorkspaceId =
          currentActive === id ? next[0]?.id ?? null : currentActive;
        set({ documentWorkspaces: next, activeDocumentWorkspaceId });
        saveJsonSetting(ACTIVE_DOCUMENT_WORKSPACE_KEY, activeDocumentWorkspaceId);
      },

      setActiveDocumentWorkspace: (id) => {
        set({ activeDocumentWorkspaceId: id });
        saveJsonSetting(ACTIVE_DOCUMENT_WORKSPACE_KEY, id);
      },

      renameDocumentWorkspace: (id, name) => {
        const clean = name.trim();
        if (!clean) return;
        const next = get().documentWorkspaces.map((workspace) =>
          workspace.id === id ? { ...workspace, name: clean, updatedAt: Date.now() } : workspace,
        );
        set({ documentWorkspaces: next });
        persistDocumentWorkspaces(next);
      },

      upsertKnowledgeDocument: (workspaceId, document) => {
        const next = get().documentWorkspaces.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          const existing = workspace.documents.some((doc) => doc.id === document.id);
          const documents = existing
            ? workspace.documents.map((doc) => (doc.id === document.id ? document : doc))
            : [document, ...workspace.documents];
          return { ...workspace, documents, updatedAt: Date.now() };
        });
        set({ documentWorkspaces: next });
        persistDocumentWorkspaces(next);
      },

      updateKnowledgeDocument: (workspaceId, documentId, updates) => {
        const next = get().documentWorkspaces.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          return {
            ...workspace,
            documents: workspace.documents.map((doc) =>
              doc.id === documentId ? { ...doc, ...updates, updatedAt: Date.now() } : doc,
            ),
            updatedAt: Date.now(),
          };
        });
        set({ documentWorkspaces: next });
        persistDocumentWorkspaces(next);
      },

      setActiveBranchTip: (conversationId, tipMessageId) => {
        const next = { ...get().activeBranchTips, [conversationId]: tipMessageId };
        set({ activeBranchTips: next });
        saveJsonSetting(BRANCH_TIPS_KEY, next);
      },

      setPursueGoalMode: (enabled) => {
        set({ pursueGoalMode: enabled });
        if (enabled && !get().agentMode) get().setAgentMode(true);
      },

      setPlanMode: (enabled) => {
        set({ planMode: enabled });
        try { localStorage.setItem("goatllm-plan-mode", String(enabled)); } catch {}
      },

      togglePlanMode: () => {
        set((state) => {
          const next = !state.planMode;
          try { localStorage.setItem("goatllm-plan-mode", String(next)); } catch {}
          return { planMode: next };
        });
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

      setPermissionProfile: (profile) => {
        const mode = profile === "strict" ? "manual" : profile === "fast" ? "yolo" : "auto";
        set({ permissionProfile: profile, permissionMode: mode, autoApprove: mode === "yolo" });
        try {
          localStorage.setItem(PERMISSION_PROFILE_KEY, profile);
          localStorage.setItem("goatllm-permission-mode", mode);
        } catch {}
      },

      setVerificationPolicy: (policy) => {
        set({ verificationPolicy: policy });
        saveVerificationPolicy(policy);
      },

      setProjectCheckMemory: (memory) => {
        set({ projectCheckMemory: memory });
        saveProjectCheckMemory(memory);
      },

      setCheckpointName: (messageId, name) => {
        const next = { ...get().checkpointNames, [messageId]: name };
        if (!name.trim()) delete next[messageId];
        set({ checkpointNames: next });
        saveJsonSetting(CHECKPOINT_NAMES_KEY, next);
      },

      setPathPermissionRules: (rules) => {
        set({ pathPermissionRules: rules });
        saveJsonSetting(PATH_PERMISSION_RULES_KEY, rules);
      },

      setAgentBudgetControls: (controls) => {
        set({ agentBudgetControls: controls });
        saveJsonSetting(AGENT_BUDGET_CONTROLS_KEY, controls);
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
      setFirecrawlApiKey: (key) => {
        set({ firecrawlApiKey: key });
        try { localStorage.setItem("goatllm-firecrawl-key", key); } catch {}
      },
      setDeepResearchMaxRounds: (rounds) => {
        set({ deepResearchMaxRounds: rounds });
        try { localStorage.setItem("goatllm-deep-research-max-rounds", String(rounds)); } catch {}
      },
      setDeepResearchMaxSearches: (searches) => {
        set({ deepResearchMaxSearches: searches });
        try { localStorage.setItem("goatllm-deep-research-max-searches", String(searches)); } catch {}
      },

      setFreeWebSearch: (enabled) => {
        set({ freeWebSearch: enabled });
        try { localStorage.setItem("goatllm-free-web-search", enabled ? "true" : "false"); } catch {}
      },
      setSearchBackend: (backend) => {
        set({ searchBackend: backend });
        try { localStorage.setItem("goatllm-search-backend", backend); } catch {}
      },
      setMemoryEnabled: (enabled) => {
        set({ memoryEnabled: enabled });
        try { localStorage.setItem("goatllm-memory-enabled", enabled ? "true" : "false"); } catch {}
      },
      setMemoryExtractionSettings: (settings) => {
        const safe = sanitizeMemoryExtractionSettings(settings);
        set({ memoryExtractionSettings: safe });
        persistMemoryExtractionSettings(safe);
      },
      setSearxngStatus: (status) => {
        set({ searxngStatus: status });
      },
      setWorkspaceHealthEnabled: (enabled) => {
        set({ workspaceHealthEnabled: enabled });
        try { localStorage.setItem("goatllm-workspace-health-enabled", enabled ? "true" : "false"); } catch {}
      },
      setManualTasksEnabled: (enabled) => {
        set({ manualTasksEnabled: enabled });
        try { localStorage.setItem("goatllm-manual-tasks-enabled", enabled ? "true" : "false"); } catch {}
      },
      updateManualTodoBoard: (conversationId, board) => {
        import("../lib/tools/todo").then((m) => {
          const inMemoryBoard = m.getBoardForConversation(conversationId);
          inMemoryBoard.tasks = board.tasks;
          inMemoryBoard.order = board.order;

          const serialized = m.serializeBoard(board);
          try {
            localStorage.setItem(`goatllm-todo-board-${conversationId}`, serialized);
          } catch {}

          set((state) => {
            const msgs = state.messages[conversationId] ?? [];
            const lastMsgIndex = [...msgs].reverse().findIndex(
              (msg) => msg.role === "assistant" && msg.toolCalls?.some((tc) => tc.toolName.startsWith("todo_"))
            );
            if (lastMsgIndex !== -1) {
              const actualIndex = msgs.length - 1 - lastMsgIndex;
              const msg = msgs[actualIndex];
              const updatedToolCalls = msg.toolCalls?.map((tc) => {
                if (tc.toolName.startsWith("todo_")) {
                  const updatedOutput = m.updateToolOutputWithBoard(tc.output as string ?? "", board);
                  return { ...tc, output: updatedOutput };
                }
                return tc;
              });
              const updatedMsg = { ...msg, toolCalls: updatedToolCalls };
              const updatedMsgs = [...msgs];
              updatedMsgs[actualIndex] = updatedMsg;

              persistMessage(updatedMsg);

              return {
                messages: { ...state.messages, [conversationId]: updatedMsgs },
                todoBoardUpdated: state.todoBoardUpdated + 1,
              };
            }

            return {
              todoBoardUpdated: state.todoBoardUpdated + 1,
            };
          });
        }).catch((e) => {
          console.error("Failed to update manual todo board:", e);
        });
      },
      incrementWebSearchCount: () => {
        set((s) => ({ webSearchCount: s.webSearchCount + 1 }));
      },
      resetWebSearchCount: () => {
        set({ webSearchCount: 0 });
      },
      resetCitationSources: () => {
        set({ citationSources: [] });
      },
      addCitationSources: (sources) => {
        if (sources.length === 0) return [];
        const existing = get().citationSources;
        const registered = sources.map((s, i) => ({
          ...s,
          index: existing.length + i + 1,
        }));
        set({ citationSources: [...existing, ...registered] });
        return registered;
      },
      setChatCodeExec: (enabled) => {
        set({ chatCodeExec: enabled });
        try { localStorage.setItem("goatllm-chat-code-exec", enabled ? "true" : "false"); } catch {}
      },

      setAutoArtifacts: (enabled) => {
        set({ autoArtifacts: enabled });
        try { localStorage.setItem("goatllm-auto-artifacts", enabled ? "true" : "false"); } catch {}
      },

      setOfficeArtifacts: (enabled) => {
        set({ officeArtifacts: enabled });
        try { localStorage.setItem("goatllm-office-artifacts", enabled ? "true" : "false"); } catch {}
      },

      setAdvancedArtifacts: (enabled) => {
        set({ advancedArtifacts: enabled });
        try { localStorage.setItem("goatllm-advanced-artifacts", enabled ? "true" : "false"); } catch {}
      },

      setShowDesignCritique: (enabled) => {
        set({ showDesignCritique: enabled });
        try { localStorage.setItem("goatllm-show-design-critique", enabled ? "true" : "false"); } catch {}
      },

      setGlowBackgroundEnabled: (enabled) => {
        set({ glowBackgroundEnabled: enabled });
        try { localStorage.setItem("goatllm-glow-bg-enabled", enabled ? "true" : "false"); } catch {}
      },

      setGlowBackgroundMode: (mode) => {
        set({ glowBackgroundMode: mode });
        try { localStorage.setItem("goatllm-glow-bg-mode", mode); } catch {}
      },

      setCompletionSound: (enabled) => {
        set({ completionSound: enabled });
        try { localStorage.setItem("goatllm-completion-sound", enabled ? "true" : "false"); } catch {}
      },

      setSubagentsEnabled: (enabled) => {
        set({ subagentsEnabled: enabled });
        try { localStorage.setItem("goatllm-subagents-enabled", enabled ? "true" : "false"); } catch {}
      },

      // ── Skills ──
      setSkillPaths: (paths) => {
        set({ skillPaths: paths });
        try { localStorage.setItem("goatllm-skill-paths", JSON.stringify(paths)); } catch {}
      },
      addSkillPath: (path) => {
        set((state) => {
          if (state.skillPaths.includes(path)) return state;
          const next = [...state.skillPaths, path];
          try { localStorage.setItem("goatllm-skill-paths", JSON.stringify(next)); } catch {}
          return { skillPaths: next };
        });
      },
      removeSkillPath: (path) => {
        set((state) => {
          const next = state.skillPaths.filter((p) => p !== path);
          try { localStorage.setItem("goatllm-skill-paths", JSON.stringify(next)); } catch {}
          return { skillPaths: next };
        });
      },
      setSkillEnabled: (name, enabled) => {
        set((state) => {
          const next = new Set(state.disabledSkills);
          if (enabled) {
            next.delete(name);
          } else {
            next.add(name);
          }
          try { localStorage.setItem("goatllm-disabled-skills", JSON.stringify([...next])); } catch {}
          return { disabledSkills: next };
        });
      },
      setAutoTriggerSkill: (name, enabled) => {
        set((state) => {
          const next = new Set(state.autoTriggerSkills);
          if (enabled) {
            next.add(name);
          } else {
            next.delete(name);
          }
          try { localStorage.setItem("goatllm-auto-trigger-skills", JSON.stringify([...next])); } catch {}
          return { autoTriggerSkills: next };
        });
      },
      setDiscoveredSkills: (skills) => {
        set({ discoveredSkills: skills });
      },

      setOllamaUrl: (url) => {
        set({ ollamaUrl: url });
        try { localStorage.setItem("goatllm-ollama-url", url); } catch {}
      },

      setEmbeddingModel: (model) => {
        set({ embeddingModel: model });
        try { localStorage.setItem("goatllm-embedding-model", model); } catch {}
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

      discoverLocalModels: async (providerId: string) => {
        const local = LOCAL_PROVIDERS.find((p) => p.id === providerId);
        if (!local) return;
        const cfg = get().providerConfigs[providerId];
        const baseUrl = cfg?.baseUrl?.trim() || local.defaultBaseUrl;

        set((state) => ({
          discoveryStatus: { ...state.discoveryStatus, [providerId]: "loading" },
          discoveryError: { ...state.discoveryError, [providerId]: null },
        }));

        try {
          const { initFetch } = await import("../lib/fetch-adapter");
          const customFetch = await initFetch();
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4000);
          const url = `${baseUrl.replace(/\/+$/, "")}/models`;
          const res = await customFetch(url, {
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
          });
          clearTimeout(timeout);

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json();
          const baseList = normalizeProviderModels(providerId, body);

          // Ollama doesn't include context_length on /v1/models. Fan out to
          // /api/show for each discovered tag and pull the real architecture
          // metadata. We do these in parallel and tolerate partial failures —
          // a missing field falls back to 0 ("unknown") rather than a
          // misleading default.
          let discovered = baseList;
          if (providerId === "ollama") {
            // The native Ollama API lives at the root, not under /v1.
            const apiRoot = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
            const enriched = await Promise.all(
              baseList.map(async (m) => {
                try {
                  const ctl = new AbortController();
                  const t = setTimeout(() => ctl.abort(), 3000);
                  const r = await customFetch(`${apiRoot}/api/show`, {
                    method: "POST",
                    signal: ctl.signal,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ model: m.id }),
                  });
                  clearTimeout(t);
                  if (!r.ok) return m;
                  const showBody = await r.json();
                  const ctx = contextWindowFromOllamaShow(showBody);
                  return ctx ? { ...m, contextWindow: ctx } : m;
                } catch {
                  return m;
                }
              }),
            );
            discovered = enriched;
          }

          set((state) => ({
            discoveredModels: { ...state.discoveredModels, [providerId]: discovered },
            discoveryStatus: { ...state.discoveryStatus, [providerId]: "ok" },
            discoveryError: { ...state.discoveryError, [providerId]: null },
          }));
        } catch (e) {
          const reason =
            e instanceof DOMException && e.name === "AbortError"
              ? `Couldn't reach ${baseUrl} (timed out). Is ${local.name} running?`
              : `Couldn't reach ${baseUrl}. Is ${local.name} running?`;
          set((state) => ({
            discoveredModels: { ...state.discoveredModels, [providerId]: [] },
            discoveryStatus: { ...state.discoveryStatus, [providerId]: "error" },
            discoveryError: { ...state.discoveryError, [providerId]: reason },
          }));
        }
      },

      discoverAllLocalModels: async () => {
        const { providerConfigs, discoverLocalModels } = get();
        const targets = LOCAL_PROVIDERS.filter((p) => providerConfigs[p.id] !== undefined);
        await Promise.allSettled(targets.map((p) => discoverLocalModels(p.id)));
      },

      /**
       * Hit a cloud provider's /v1/models endpoint and merge the result
       * with the curated catalog. Mirrors `discoverLocalModels` for
       * cloud providers that opted into discovery (OpenRouter, Groq,
       * OpenCode Go). The curated list wins on conflict — registry
       * metadata is the authoritative source for display name, vision
       * flag, and context window.
       *
       * Auth: most cloud /v1/models endpoints accept the API key as
       * either a Bearer token or an `Authorization: Bearer …` header.
       * The user must have already configured the key in Settings —
       * we don't try to scrape a public catalog anonymously because
       * providers like OpenRouter gate model metadata behind auth.
       */
      discoverCloudModels: async (providerId: string) => {
        if (!providerSupportsDiscovery(providerId)) return;
        const baseUrl = CLOUD_PROVIDER_BASE_URLS[providerId];
        if (!baseUrl) return;
        const cfg = get().providerConfigs[providerId];
        const apiKey = cfg?.apiKey?.trim();
        if (!apiKey) {
          set((state) => ({
            discoveryStatus: { ...state.discoveryStatus, [providerId]: "error" },
            discoveryError: {
              ...state.discoveryError,
              [providerId]: `Add an API key for ${providerId} before discovering models.`,
            },
          }));
          return;
        }

        set((state) => ({
          discoveryStatus: { ...state.discoveryStatus, [providerId]: "loading" },
          discoveryError: { ...state.discoveryError, [providerId]: null },
        }));

        try {
          const { initFetch } = await import("../lib/fetch-adapter");
          const customFetch = await initFetch();
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const url = `${baseUrl.replace(/\/+$/, "")}/models`;
          const res = await customFetch(url, {
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
          });
          clearTimeout(timeout);

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json();
          const discovered = normalizeProviderModels(providerId, body);

          set((state) => ({
            discoveredModels: { ...state.discoveredModels, [providerId]: discovered },
            discoveryStatus: { ...state.discoveryStatus, [providerId]: "ok" },
            discoveryError: { ...state.discoveryError, [providerId]: null },
          }));
        } catch (e) {
          const reason =
            e instanceof DOMException && e.name === "AbortError"
              ? `Couldn't reach ${baseUrl} (timed out).`
              : `Couldn't reach ${baseUrl}.`;
          set((state) => ({
            discoveredModels: { ...state.discoveredModels, [providerId]: [] },
            discoveryStatus: { ...state.discoveryStatus, [providerId]: "error" },
            discoveryError: { ...state.discoveryError, [providerId]: reason },
          }));
        }
      },

      setSelectedModel: (modelId) => {
        set({ selectedModelId: modelId });
        try { localStorage.setItem("goatllm-selected-model", modelId ?? ""); } catch {}
      },

      setModelOverride: (modelId, override) => {
        set((state) => {
          const current = state.modelOverrides[modelId] ?? {};
          const merged: ModelOverride = { ...current };
          if (override.contextWindow !== undefined) merged.contextWindow = override.contextWindow;
          else if ("contextWindow" in override) delete merged.contextWindow;
          if (override.maxResponseTokens !== undefined) merged.maxResponseTokens = override.maxResponseTokens;
          else if ("maxResponseTokens" in override) delete merged.maxResponseTokens;
          if (override.reasoningEffort !== undefined) merged.reasoningEffort = override.reasoningEffort;
          else if ("reasoningEffort" in override) delete merged.reasoningEffort;
          const next = { ...state.modelOverrides };
          if (Object.keys(merged).length > 0) next[modelId] = merged;
          else delete next[modelId];
          saveModelOverrides(next);
          return { modelOverrides: next };
        });
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
        // If the user has configured their own OpenCode Go key, that
        // supersedes the bundled free tier — we hide our built-in entry so
        // the picker shows their full paid catalog instead of two competing
        // OpenCode entries.
        const userHasOwnZenKey = !!providerConfigs["opencode-go"]?.apiKey;
        const visibleBuiltins = BUILTIN_PROVIDERS.filter(
          (bp) => !(bp.id === ZEN_FREE_PROVIDER_ID && userHasOwnZenKey),
        );
        const providers: Provider[] = visibleBuiltins.map((bp) => {
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
        // Add user-configured cloud providers. Display names come from
        // the registry so adding a provider to the catalog automatically
        // makes it render correctly here without a parallel knownNames
        // table to maintain.
        for (const [id, config] of Object.entries(providerConfigs)) {
          if (!BUILTIN_PROVIDERS.find((bp) => bp.id === id)) {
            const hasKey = !!config.apiKey || NO_KEY_PROVIDERS.has(id);
            const info = getProviderInfo(id);
            providers.push({
              id,
              name: info?.name ?? id.charAt(0).toUpperCase() + id.slice(1),
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
        const { providerConfigs, providerHealth, discoveredModels, modelOverrides } = get();
        const models: Model[] = [];
        const userHasOwnZenKey = !!providerConfigs["opencode-go"]?.apiKey;
        // Helper: apply user overrides to a model's contextWindow.
        const applyOverride = (modelId: string, ctx: number): number => {
          const ov = modelOverrides[modelId];
          if (ov?.contextWindow !== undefined) return ov.contextWindow;
          return ctx;
        };
        // Built-in models
        for (const bp of BUILTIN_PROVIDERS) {
          // Hide the bundled free tier when the user has configured their
          // own OpenCode Go key — their key supersedes the free credential.
          if (bp.id === ZEN_FREE_PROVIDER_ID && userHasOwnZenKey) continue;
          const health = providerHealth[bp.id];
          // Optimistic: assume online until first check fails
          const providerOnline = health ? health.online : true;
          for (const m of bp.models) {
            const combinedId = `${bp.id}:${m.id}`;
            models.push({
              id: combinedId,
              name: m.name,
              providerId: bp.id,
              isAvailable: providerOnline,
              contextWindow: applyOverride(combinedId, m.contextWindow),
              vision: m.vision,
              reasoning: m.reasoning,
              thinkingLevelMap: m.thinkingLevelMap,
              thinkingBudgets: m.thinkingBudgets,
            });
          }
        }
        // Cloud + local provider models from user config
        for (const [providerId, config] of Object.entries(providerConfigs)) {
          if (BUILTIN_PROVIDERS.find((bp) => bp.id === providerId)) continue;
          const isLocal = NO_KEY_PROVIDERS.has(providerId);
          // Local providers expose a real catalog at runtime; cloud providers
          // ship a curated static list. Don't mix them — a local server with
          // zero models pulled should show zero models in the picker.
          // Cloud providers with `supportsDiscovery: true` (OpenRouter, Groq,
          // OpenCode Go) augment the curated list with the result of their
          // /v1/models endpoint. The curated metadata wins on conflict;
          // discovered models are appended in provider order. Providers
          // that don't opt in (Anthropic, OpenAI, DeepSeek, MiMo) keep
          // the curated catalog only — discoveredModels is ignored for
          // them so a stale or bogus entry can't leak into the picker.
          const sourceModels = isLocal
            ? mergeDiscoveredModels(config.models ?? [], discoveredModels[providerId] ?? [])
            : providerSupportsDiscovery(providerId)
              ? mergeDiscoveredModels(
                  CLOUD_PROVIDER_MODELS[providerId] ?? [],
                  discoveredModels[providerId] ?? [],
                )
              : (CLOUD_PROVIDER_MODELS[providerId] ?? []);
          const allowlist = config.enabledModels;
          for (const m of sourceModels) {
            if (allowlist && !allowlist.includes(m.id)) continue;
            const ctx =
              "contextWindow" in m && typeof m.contextWindow === "number"
                ? m.contextWindow
                : // Local models without a discovered context length: leave
                  // the meter to fall back to its heuristic. 0 is a sentinel
                  // the ContextMeter treats as "unknown".
                  0;
            const vision =
              "vision" in m && typeof (m as { vision?: boolean }).vision === "boolean"
                ? (m as { vision?: boolean }).vision
                : undefined;
            const reasoning =
              "reasoning" in m && typeof (m as { reasoning?: boolean }).reasoning === "boolean"
                ? (m as { reasoning?: boolean }).reasoning
                : undefined;
            const combinedId = `${providerId}:${m.id}`;
            models.push({
              id: combinedId,
              name: m.name,
              providerId,
              isAvailable: !!config.apiKey || NO_KEY_PROVIDERS.has(providerId),
              contextWindow: applyOverride(combinedId, ctx),
              vision,
              reasoning,
              thinkingLevelMap: (m as ModelConfig).thinkingLevelMap,
              thinkingBudgets: (m as ModelConfig).thinkingBudgets,
            });
          }
        }
        return models;
      },

      getFilteredConversations: () => {
        const { conversations, searchQuery, messages } = get();
        if (!searchQuery.trim()) return conversations;
        const q = searchQuery.toLowerCase();
        // Search across title, preview, and full message content. We score
        // each conversation as the count of matching messages so the
        // sidebar can show "matches in N messages" — cheap because the
        // messages map is already in-memory.
        const matched: Array<{ conv: Conversation; score: number; bodyMatches: number }> = [];
        for (const c of conversations) {
          let score = 0;
          let bodyMatches = 0;
          if (c.title.toLowerCase().includes(q)) score += 100;
          if (c.lastMessagePreview.toLowerCase().includes(q)) score += 10;
          const msgs = messages[c.id] ?? [];
          for (const m of msgs) {
            if (m.content && m.content.toLowerCase().includes(q)) {
              score += 1;
              bodyMatches += 1;
            }
          }
          if (score > 0) matched.push({ conv: c, score, bodyMatches });
        }
        // Stash body-match counts on the conversation objects via WeakMap so
        // the sidebar can render the subtitle without re-running the search.
        const counts = bodyMatchCounts;
        counts.clear();
        for (const m of matched) counts.set(m.conv.id, m.bodyMatches);
        // Preserve original order (lastMessageAt desc) by sorting by score
        // descending then by original index.
        return matched
          .sort((a, b) => b.score - a.score || b.conv.lastMessageAt - a.conv.lastMessageAt)
          .map((m) => m.conv);
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
        const savedProfileRaw = localStorage.getItem(PERMISSION_PROFILE_KEY);
        const savedProfile: "strict" | "default" | "fast" =
          savedProfileRaw === "strict" || savedProfileRaw === "fast" ? savedProfileRaw : "default";
        // Artifact toggles: default on. Only an explicit "false" disables them.
        const autoArtifacts = localStorage.getItem("goatllm-auto-artifacts") !== "false";
        const officeArtifacts = localStorage.getItem("goatllm-office-artifacts") !== "false";
        const advancedArtifacts = localStorage.getItem("goatllm-advanced-artifacts") !== "false";
        const showDesignCritique = localStorage.getItem("goatllm-show-design-critique") === "true";
        const glowBackgroundEnabled = localStorage.getItem("goatllm-glow-bg-enabled") === "true";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
        const glowBackgroundMode = (localStorage.getItem("goatllm-glow-bg-mode") as any) || "blocky";
        const subagentsEnabled = localStorage.getItem("goatllm-subagents-enabled") !== "false";
        const completionSound = localStorage.getItem("goatllm-completion-sound") !== "false";
        try {
          const data = await loadAllFromDb();
          const providerConfigs = loadProviderConfigs();
          // Default new installs onto the bundled free tier so the first
          // chat just works — no Settings detour required.
          const savedModel =
            localStorage.getItem("goatllm-selected-model") ||
            `${ZEN_FREE_PROVIDER_ID}:deepseek-v4-flash-free`;
          const tavilyKey = localStorage.getItem("goatllm-tavily-key") || "";
          const firecrawlKey = localStorage.getItem("goatllm-firecrawl-key") || "";
          const freeWebSearch = localStorage.getItem("goatllm-free-web-search") === "true";
          const chatCodeExec = localStorage.getItem("goatllm-chat-code-exec") === "true";
          const deepResearchMaxRounds = parseInt(localStorage.getItem("goatllm-deep-research-max-rounds") || "4") || 4;
          const deepResearchMaxSearches = parseInt(localStorage.getItem("goatllm-deep-research-max-searches") || "3") || 3;
          let freeWebSearchToken = localStorage.getItem("goatllm-free-web-search-token") || "";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
          let searchBackend = localStorage.getItem("goatllm-search-backend") as any;
          if (searchBackend !== "searxng" && searchBackend !== "tavily") {
            searchBackend = "searxng";
          }
          const memoryEnabled = localStorage.getItem("goatllm-memory-enabled") !== "false";
          const workspaceHealthEnabled = localStorage.getItem("goatllm-workspace-health-enabled") === "true";
          const manualTasksEnabled = localStorage.getItem("goatllm-manual-tasks-enabled") === "true";
          if (!freeWebSearchToken) {
            try {
              freeWebSearchToken = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
              localStorage.setItem("goatllm-free-web-search-token", freeWebSearchToken);
            } catch { /* ignore */ }
          }
          // Re-detect artifacts from loaded messages so they survive restarts.
          // Also clear any orphaned isStreaming flags: if the app closed mid-
          // stream, the assistant message is still marked isStreaming on disk
          // but no abort controller exists for it. Mark these `interrupted`
          // so the UI can show a Continue button instead of a stuck spinner.
          // Similarly, clear isGeneratingTitle flags where the title model
          // never returned — an app close/crash during the ~2s title call
          // would leave the sidebar shimmering forever on reopen. We
          // generate a cheap heuristic title so the conversation doesn't
          // stay "New Conversation" permanently.
          for (const msgs of Object.values(data.messages)) {
            for (const m of msgs) {
              if (m.isStreaming) {
                m.isStreaming = false;
                (m as Message & { interrupted?: boolean }).interrupted = true;
              }
              // Finalize any tool calls stuck in running/pending_approval
              // so restored chats don't show stale shimmer pills or
              // broken ApprovalGate buttons.
              if (m.toolCalls?.length) {
                for (const tc of m.toolCalls) {
                  if (tc.state === "running" || tc.state === "pending_approval") {
                    tc.state = "done";
                  }
                }
              }
              // Clean up runtime deep research states on hydrate
              if (m.deepResearch && m.deepResearch.phase !== "done" && m.deepResearch.phase !== "error") {
                m.deepResearch = {
                  ...m.deepResearch,
                  phase: "error",
                  error: "Deep Research interrupted.",
                };
              }
            }
          }
          // Fix conversations whose title generation never completed.
          for (const conv of data.conversations) {
            if (conv.isGeneratingTitle && conv.title === "New Conversation") {
              conv.isGeneratingTitle = false;
              const firstUser = (data.messages[conv.id] ?? []).find((m) => m.role === "user");
              if (firstUser) {
                conv.title = heuristicTitle(firstUser.content);
              }
            }
          }
          // Match by (kind, normalized title) so renamed/multi artifacts of
          // the same kind stay distinct, and same-name updates collapse to a
          // single entry at the latest version.
          const restoredArtifacts: Record<string, Artifact[]> = {};
          for (const [convId, msgs] of Object.entries(data.messages)) {
            // Process in chronological order so later same-name blocks
            // overwrite earlier ones.
            const sorted = [...msgs].sort((a, b) => a.createdAt - b.createdAt);
            const list: Artifact[] = [];
            for (const msg of sorted) {
              if (msg.role !== "assistant" || !msg.content) continue;
              const blocks = extractArtifactBlocks(msg.content);
              const updatedThisMsg = new Set<string>();
              let blockIdx = 0;
              for (const { kind, title, code } of blocks) {
                const want = normalizeTitle(title);
                let target = -1;
                for (let j = list.length - 1; j >= 0; j--) {
                  if (
                    list[j].kind === kind &&
                    normalizeTitle(list[j].title) === want &&
                    !updatedThisMsg.has(list[j].id)
                  ) {
                    target = j;
                    break;
                  }
                }
                if (target >= 0) {
                  const t = list[target];
                  const versions = t.versions ?? [];
                  const newVersion: ArtifactVersion = {
                    code,
                    title,
                    createdAt: msg.createdAt,
                    source: "agent",
                    messageId: msg.id,
                  };
                  const newVersions = [...versions, newVersion];
                  list[target] = {
                    ...t,
                    code,
                    title,
                    messageId: msg.id,
                    createdAt: msg.createdAt,
                    versions: newVersions,
                    activeVersionIndex: newVersions.length - 1,
                  };
                  updatedThisMsg.add(t.id);
                } else {
                  const initialVersion: ArtifactVersion = {
                    code,
                    title,
                    createdAt: msg.createdAt,
                    source: "agent",
                    messageId: msg.id,
                  };
                  list.push({
                    id: `${msg.id}-${blockIdx}`,
                    kind,
                    title,
                    code,
                    messageId: msg.id,
                    createdAt: msg.createdAt,
                    versions: [initialVersion],
                    activeVersionIndex: 0,
                  });
                }
                blockIdx++;
              }
            }
            if (list.length > 0) restoredArtifacts[convId] = list;
          }

          const agentMode = localStorage.getItem("goatllm-agent-mode") === "true";
          const designMode = !agentMode && localStorage.getItem("goatllm-design-mode") === "true";
          const jjagent = localStorage.getItem("goatllm-jjagent") === "true";
          const activeSkillId = localStorage.getItem("goatllm-active-skill") || null;
          const activeDesignSystemId = localStorage.getItem("goatllm-active-design-system") || null;
          const activeDirectionId = localStorage.getItem("goatllm-active-direction") || null;
          const workspacePath = localStorage.getItem("goatllm-workspace-path") || null;
          const designWorkspacePath = localStorage.getItem("goatllm-design-workspace-path") || null;
          const defaultSystemPrompt = localStorage.getItem("goatllm-default-system-prompt") || "";
          const ollamaUrl = localStorage.getItem("goatllm-ollama-url") || "http://localhost:11434";
          const embeddingModel = localStorage.getItem("goatllm-embedding-model") || "nomic-embed-text";
          // Reset per-session state so old chats always open fresh.
          localStorage.removeItem("goatllm-research-mode");
          localStorage.removeItem("goatllm-plan-mode");
          const researchMode = false;
          const planMode = false;
          const activeId = localStorage.getItem("goatllm-active-conversation") || null;
          // Only restore activeId if that conversation actually exists in loaded data
          const validActiveId = activeId && data.conversations.some((c) => c.id === activeId) ? activeId : null;
          const conversationIds = new Set(data.conversations.map((c) => c.id));
          const savedMessageQueue = loadJsonValue<Record<string, QueuedMessage[]>>(MESSAGE_QUEUE_KEY, {});
          const messageQueue = Object.fromEntries(
            Object.entries(savedMessageQueue)
              .filter(([conversationId, queued]) => conversationIds.has(conversationId) && Array.isArray(queued))
              .map(([conversationId, queued]) => [
                conversationId,
                queued.filter((q) => q && typeof q.content === "string" && q.content.trim().length > 0),
              ])
              .filter(([, queued]) => queued.length > 0),
          ) as Record<string, QueuedMessage[]>;
          saveJsonSetting(MESSAGE_QUEUE_KEY, messageQueue);
          const documentWorkspaces = await loadDocumentWorkspaces();
          const scheduledAgentState = await loadScheduledAgentState(sanitizeScheduledAgents);
          const memoryExtractionSettings = await loadMemoryExtractionSettings();
          const meetingState = await loadMeetingState();
          const savedDocumentWorkspaceId = localStorage.getItem(ACTIVE_DOCUMENT_WORKSPACE_KEY);
          const activeDocumentWorkspaceId =
            savedDocumentWorkspaceId && documentWorkspaces.some((workspace) => workspace.id === savedDocumentWorkspaceId)
              ? savedDocumentWorkspaceId
              : documentWorkspaces[0]?.id ?? null;

          // Load skill state from localStorage
          let skillPaths: string[] = [];
          let disabledSkills: Set<string> = new Set();
          let autoTriggerSkills: Set<string> = new Set();
          try {
            const savedSkillPaths = localStorage.getItem("goatllm-skill-paths");
            if (savedSkillPaths) skillPaths = JSON.parse(savedSkillPaths);
            const savedDisabled = localStorage.getItem("goatllm-disabled-skills");
            if (savedDisabled) disabledSkills = new Set(JSON.parse(savedDisabled));
            const savedAutoTrigger = localStorage.getItem("goatllm-auto-trigger-skills");
            if (savedAutoTrigger) autoTriggerSkills = new Set(JSON.parse(savedAutoTrigger));
          } catch { /* ignore malformed JSON */ }

          set({
            conversations: data.conversations,
            messages: data.messages,
            compactionEntries: data.compactionEntries,
            providerConfigs,
            selectedModelId: savedModel,
            tavilyApiKey: tavilyKey,
            firecrawlApiKey: firecrawlKey,
            freeWebSearch,
            chatCodeExec,
            deepResearchMaxRounds,
            deepResearchMaxSearches,
            freeWebSearchToken,
            searchBackend,
            memoryEnabled,
            memoryExtractionSettings,
            searxngStatus: null,
            workspaceHealthEnabled,
            manualTasksEnabled,
            autoArtifacts,
            officeArtifacts,
            showDesignCritique,
            glowBackgroundEnabled,
            glowBackgroundMode,
            completionSound,
            subagentsEnabled,
            permissionMode: savedMode,
            permissionProfile: savedProfile,
            verificationPolicy: loadVerificationPolicy(),
            projectCheckMemory: loadProjectCheckMemory(),
            autoApprove: savedMode === "yolo",
            artifacts: restoredArtifacts,
            advancedArtifacts,
            agentMode,
            designMode,
            jjagent,
            activeSkillId,
            activeDesignSystemId,
            activeDirectionId,
            workspacePath,
            designWorkspacePath,
            defaultSystemPrompt,
            ollamaUrl,
            embeddingModel,
            researchMode,
            planMode,
            skillPaths,
            disabledSkills,
            autoTriggerSkills,
            activeId: validActiveId,
            messageQueue,
            workspacePanelOpen: loadJsonSetting(PRODUCT_WORKSPACE_STATE_KEY, DEFAULT_PRODUCT_WORKSPACE_STATE).workspacePanelOpen,
            workspacePanelTab: loadJsonSetting(PRODUCT_WORKSPACE_STATE_KEY, DEFAULT_PRODUCT_WORKSPACE_STATE).workspacePanelTab,
            usageSettings: loadUsageSettings(),
            voiceSettings: loadJsonSetting(VOICE_SETTINGS_KEY, DEFAULT_VOICE_SETTINGS),
            meetingSessions: meetingState.sessions,
            meetingSettings: meetingState.settings,
            syncSettings: loadJsonSetting(SYNC_SETTINGS_KEY, DEFAULT_SYNC_SETTINGS),
            imageGenSettings: loadJsonSetting(IMAGE_GEN_SETTINGS_KEY, DEFAULT_IMAGE_GEN_SETTINGS),
            featureFlags: loadJsonSetting(FEATURE_FLAGS_KEY, DEFAULT_FEATURE_FLAGS),
            plusMenuVisibility: loadJsonSetting(PLUS_MENU_VISIBILITY_KEY, DEFAULT_PLUS_MENU_VISIBILITY),
            modelComparisonRuns: sanitizeModelComparisonRuns(loadJsonValue<unknown>(MODEL_COMPARISON_RUNS_KEY, [])),
            notebookCells: loadNotebookCells(),
            notebooks: loadNotebooks(),
            activeNotebookId: resolveActiveNotebookId(loadNotebooks()),
            imageJobs: sanitizeImageJobs(loadJsonValue<unknown>(IMAGE_JOBS_KEY, [])),
            scheduledAgents: scheduledAgentState.agents,
            scheduledAgentRuns: scheduledAgentState.runs,
            watcherEvents: loadJsonValue<WatcherEventSummaryInput[]>(WATCHER_EVENTS_KEY, []),
            ragSettings: loadJsonSetting(RAG_SETTINGS_KEY, DEFAULT_RAG_SETTINGS),
            documentWorkspaces,
            activeDocumentWorkspaceId,
            activeBranchTips: loadJsonValue<Record<string, string>>(BRANCH_TIPS_KEY, {}),
            _hydrated: true,
          });

          // Replay todo boards from conversation history on app start.
          if (validActiveId && data.messages[validActiveId]) {
            import("../lib/tools/todo").then((m) => {
              const msgs = data.messages[validActiveId];
              const toolCalls = msgs
                .filter((msg) => msg.role === "assistant" && msg.toolCalls?.length)
                .flatMap((msg) =>
                  msg.toolCalls!.map((tc) => ({
                    toolName: tc.toolName,
                    input: tc.input,
                    output: tc.output as string | undefined,
                  })),
                );
              const replayed = m.loadBoardFromHistory(validActiveId, toolCalls);
              if (replayed) {
                useChatStore.setState((s) => ({
                  todoBoardUpdated: s.todoBoardUpdated + 1,
                }));
              }
            }).catch(() => {});
          }
        } catch (e) {
          console.warn("[store] Failed to hydrate from DB, using empty state:", e);
          const providerConfigs = loadProviderConfigs();
          const savedModel = localStorage.getItem("goatllm-selected-model") || null;
          const tavilyKey = localStorage.getItem("goatllm-tavily-key") || "";
          const firecrawlKey = localStorage.getItem("goatllm-firecrawl-key") || "";
          const freeWebSearch = localStorage.getItem("goatllm-free-web-search") === "true";
          const deepResearchMaxRounds = parseInt(localStorage.getItem("goatllm-deep-research-max-rounds") || "4") || 4;
          const deepResearchMaxSearches = parseInt(localStorage.getItem("goatllm-deep-research-max-searches") || "3") || 3;
          const chatCodeExec = localStorage.getItem("goatllm-chat-code-exec") === "true";
          let freeWebSearchToken = localStorage.getItem("goatllm-free-web-search-token") || "";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
          let searchBackend = localStorage.getItem("goatllm-search-backend") as any;
          if (searchBackend !== "searxng" && searchBackend !== "tavily") {
            searchBackend = "searxng";
          }
          const memoryEnabled = localStorage.getItem("goatllm-memory-enabled") !== "false";
          const workspaceHealthEnabled = localStorage.getItem("goatllm-workspace-health-enabled") === "true";
          const manualTasksEnabled = localStorage.getItem("goatllm-manual-tasks-enabled") === "true";
          if (!freeWebSearchToken) {
            try {
              freeWebSearchToken = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
              localStorage.setItem("goatllm-free-web-search-token", freeWebSearchToken);
            } catch { /* ignore */ }
          }
          // Reset per-session state so old chats always open fresh.
          localStorage.removeItem("goatllm-research-mode");
          localStorage.removeItem("goatllm-plan-mode");
          const agentMode = localStorage.getItem("goatllm-agent-mode") === "true";
          const designMode = !agentMode && localStorage.getItem("goatllm-design-mode") === "true";
          const activeSkillId = localStorage.getItem("goatllm-active-skill") || null;
          const activeDesignSystemId = localStorage.getItem("goatllm-active-design-system") || null;
          const activeDirectionId = localStorage.getItem("goatllm-active-direction") || null;
          const workspacePath = localStorage.getItem("goatllm-workspace-path") || null;
          const designWorkspacePath = localStorage.getItem("goatllm-design-workspace-path") || null;
          const defaultSystemPrompt = localStorage.getItem("goatllm-default-system-prompt") || "";
          const ollamaUrl = localStorage.getItem("goatllm-ollama-url") || "http://localhost:11434";
          const embeddingModel = localStorage.getItem("goatllm-embedding-model") || "nomic-embed-text";
          const documentWorkspaces = sanitizeDocumentWorkspaces(await loadDocumentWorkspaces().catch(() => []));
          const scheduledAgentState = await loadScheduledAgentState(sanitizeScheduledAgents).catch(() => ({
            agents: sanitizeScheduledAgents(loadJsonValue<unknown>(SCHEDULED_AGENTS_KEY, [])),
            runs: sanitizeScheduledAgentRuns([]),
          }));
          const memoryExtractionSettings = await loadMemoryExtractionSettings().catch(() => ({
            ...DEFAULT_MEMORY_EXTRACTION_SETTINGS,
          }));
          const meetingState = await loadMeetingState().catch(() => loadMeetingStateFromJournal());
          const savedDocumentWorkspaceId = localStorage.getItem(ACTIVE_DOCUMENT_WORKSPACE_KEY);
          const activeDocumentWorkspaceId =
            savedDocumentWorkspaceId && documentWorkspaces.some((workspace) => workspace.id === savedDocumentWorkspaceId)
              ? savedDocumentWorkspaceId
              : documentWorkspaces[0]?.id ?? null;
          set({
            providerConfigs,
            compactionEntries: {},
            selectedModelId: savedModel,
            tavilyApiKey: tavilyKey,
            firecrawlApiKey: firecrawlKey,
            freeWebSearch,
            deepResearchMaxRounds,
            deepResearchMaxSearches,
            chatCodeExec,
            freeWebSearchToken,
            searchBackend,
            memoryEnabled,
            memoryExtractionSettings,
            searxngStatus: null,
            workspaceHealthEnabled,
            manualTasksEnabled,
            autoArtifacts,
            officeArtifacts,
            showDesignCritique,
            glowBackgroundEnabled,
            glowBackgroundMode,
            completionSound,
            subagentsEnabled,
            permissionMode: savedMode,
            permissionProfile: savedProfile,
            verificationPolicy: loadVerificationPolicy(),
            projectCheckMemory: loadProjectCheckMemory(),
            agentMode,
            designMode,
            activeSkillId,
            activeDesignSystemId,
            activeDirectionId,
            workspacePath,
            designWorkspacePath,
            defaultSystemPrompt,
            ollamaUrl,
            embeddingModel,
            researchMode: false,
            planMode: false,
            advancedArtifacts,
            autoApprove: savedMode === "yolo",
            workspacePanelOpen: loadJsonSetting(PRODUCT_WORKSPACE_STATE_KEY, DEFAULT_PRODUCT_WORKSPACE_STATE).workspacePanelOpen,
            workspacePanelTab: loadJsonSetting(PRODUCT_WORKSPACE_STATE_KEY, DEFAULT_PRODUCT_WORKSPACE_STATE).workspacePanelTab,
            usageSettings: loadUsageSettings(),
            voiceSettings: loadJsonSetting(VOICE_SETTINGS_KEY, DEFAULT_VOICE_SETTINGS),
            meetingSessions: meetingState.sessions,
            meetingSettings: meetingState.settings,
            syncSettings: loadJsonSetting(SYNC_SETTINGS_KEY, DEFAULT_SYNC_SETTINGS),
            imageGenSettings: loadJsonSetting(IMAGE_GEN_SETTINGS_KEY, DEFAULT_IMAGE_GEN_SETTINGS),
            featureFlags: loadJsonSetting(FEATURE_FLAGS_KEY, DEFAULT_FEATURE_FLAGS),
            plusMenuVisibility: loadJsonSetting(PLUS_MENU_VISIBILITY_KEY, DEFAULT_PLUS_MENU_VISIBILITY),
            modelComparisonRuns: sanitizeModelComparisonRuns(loadJsonValue<unknown>(MODEL_COMPARISON_RUNS_KEY, [])),
            notebookCells: loadNotebookCells(),
            notebooks: loadNotebooks(),
            activeNotebookId: resolveActiveNotebookId(loadNotebooks()),
            imageJobs: sanitizeImageJobs(loadJsonValue<unknown>(IMAGE_JOBS_KEY, [])),
            scheduledAgents: scheduledAgentState.agents,
            scheduledAgentRuns: scheduledAgentState.runs,
            watcherEvents: loadJsonValue<WatcherEventSummaryInput[]>(WATCHER_EVENTS_KEY, []),
            ragSettings: loadJsonSetting(RAG_SETTINGS_KEY, DEFAULT_RAG_SETTINGS),
            documentWorkspaces,
            activeDocumentWorkspaceId,
            activeBranchTips: loadJsonValue<Record<string, string>>(BRANCH_TIPS_KEY, {}),
            _hydrated: true,
          });
        }
      },

      // ── Derived ──

      getLlmConfigForModel: (targetModelId): LlmConfig | null => {
        const { providerConfigs, modelOverrides } = get();
        if (!targetModelId) return null;

        const [providerId, ...modelIdParts] = targetModelId.split(":");
        const modelId = modelIdParts.join(":"); // handles model IDs with colons

        // Grab per-model overrides the user may have set via the gear icon.
        const overrides = modelOverrides[targetModelId];
        const selectedModel = get().getModels().find((m) => m.id === targetModelId);
        const providerCompat = providerConfigs[providerId]?.compat ?? getProviderInfo(providerId)?.compat;
        const reasoningMetadata = selectedModel
          ? {
              reasoning: selectedModel.reasoning,
              thinkingLevelMap: selectedModel.thinkingLevelMap,
              thinkingBudgets: selectedModel.thinkingBudgets,
              providerCompat,
            }
          : { providerCompat };

        // Built-in provider (e.g. OpenCode Go Free).
        // We resolve the bundled credential lazily so the decoded value
        // doesn't sit in module scope, and we treat the built-in as
        // OpenAI-compatible so it goes through the same streaming path as
        // user-configured opencode-go.
        const builtin = BUILTIN_PROVIDERS.find((bp) => bp.id === providerId);
        if (builtin) {
          const apiKey =
            providerId === ZEN_FREE_PROVIDER_ID ? getZenCredential() : null;
          return {
            provider: providerId as LlmConfig["provider"],
            modelId,
            apiKey,
            baseUrl: builtin.baseUrl,
            maxResponseTokens: overrides?.maxResponseTokens,
            reasoningEffort: overrides?.reasoningEffort,
            ...reasoningMetadata,
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
            maxResponseTokens: overrides?.maxResponseTokens,
            reasoningEffort: overrides?.reasoningEffort,
            ...reasoningMetadata,
          };
        }

        return null;
      },

      getActiveLlmConfig: (): LlmConfig | null => {
        return get().getLlmConfigForModel(get().selectedModelId);
      },
    }));
