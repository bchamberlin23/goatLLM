import type { Message } from "../stores/chat";

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface UsageAlert {
  kind: "expensive-session" | "budget-warning" | "budget-exceeded";
  message: string;
  amountUsd: number;
}

export interface UsageBreakdownRow {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  messages: number;
  latencyMs: number;
}

export interface ConversationUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  byModel: UsageBreakdownRow[];
  byProvider: UsageBreakdownRow[];
  chart: { label: string; costUsd: number; inputTokens: number; outputTokens: number }[];
  budgetStatus: {
    state: "ok" | "warning" | "exceeded";
    budgetUsd: number;
    spentUsd: number;
    ratio: number;
  };
  alerts: UsageAlert[];
}

export interface UsageOptions {
  modelIdForMessage?: (message: Message) => string | null | undefined;
  monthlyBudgetUsd?: number;
  expensiveSessionUsd?: number;
  priceOverrides?: Record<string, ModelPrice>;
}

const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  "openai:gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "openai:gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "openai:gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8 },
  "anthropic:claude-3-5-haiku-20241022": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "anthropic:claude-3-5-sonnet-20241022": { inputPerMillion: 3, outputPerMillion: 15 },
  "anthropic:claude-sonnet-4-20250514": { inputPerMillion: 3, outputPerMillion: 15 },
  "deepseek:deepseek-chat": { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  "deepseek:deepseek-reasoner": { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  "groq:llama-3.3-70b-versatile": { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  "opencode-go-free:deepseek-v4-flash-free": { inputPerMillion: 0, outputPerMillion: 0 },
};

function splitModelId(modelId: string): { providerId: string; providerModelId: string } {
  const [providerId, ...rest] = modelId.split(":");
  return {
    providerId: providerId || "unknown",
    providerModelId: rest.join(":") || modelId || "unknown",
  };
}

export function estimateMessageCost(
  message: Pick<Message, "inputTokens" | "outputTokens">,
  modelId: string | null | undefined,
  overrides: Record<string, ModelPrice> = {},
): number {
  const id = modelId || "unknown";
  const price = overrides[id] ?? DEFAULT_MODEL_PRICES[id];
  if (!price) return 0;
  const input = message.inputTokens ?? 0;
  const output = message.outputTokens ?? 0;
  return (input / 1_000_000) * price.inputPerMillion + (output / 1_000_000) * price.outputPerMillion;
}

function emptyBreakdown(providerId: string, modelId: string): UsageBreakdownRow {
  return {
    providerId,
    modelId,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    messages: 0,
    latencyMs: 0,
  };
}

export function buildConversationUsage(messages: Message[], options: UsageOptions = {}): ConversationUsage {
  const byModelMap = new Map<string, UsageBreakdownRow>();
  const byProviderMap = new Map<string, UsageBreakdownRow>();
  const chart: ConversationUsage["chart"] = [];
  const priceOverrides = options.priceOverrides ?? {};

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let totalLatencyMs = 0;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const modelId = options.modelIdForMessage?.(message) ?? "unknown";
    const { providerId } = splitModelId(modelId);
    const inputTokens = message.inputTokens ?? 0;
    const outputTokens = message.outputTokens ?? 0;
    const latencyMs = message.turnDurationMs ?? message.streamingDurationMs ?? 0;
    const costUsd = estimateMessageCost(message, modelId, priceOverrides);

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCostUsd += costUsd;
    totalLatencyMs += latencyMs;

    const modelRow = byModelMap.get(modelId) ?? emptyBreakdown(providerId, modelId);
    modelRow.inputTokens += inputTokens;
    modelRow.outputTokens += outputTokens;
    modelRow.costUsd += costUsd;
    modelRow.messages += 1;
    modelRow.latencyMs += latencyMs;
    byModelMap.set(modelId, modelRow);

    const providerRow = byProviderMap.get(providerId) ?? emptyBreakdown(providerId, providerId);
    providerRow.inputTokens += inputTokens;
    providerRow.outputTokens += outputTokens;
    providerRow.costUsd += costUsd;
    providerRow.messages += 1;
    providerRow.latencyMs += latencyMs;
    byProviderMap.set(providerId, providerRow);

    chart.push({
      label: new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      costUsd,
      inputTokens,
      outputTokens,
    });
  }

  const monthlyBudgetUsd = Math.max(0, options.monthlyBudgetUsd ?? 25);
  const ratio = monthlyBudgetUsd > 0 ? totalCostUsd / monthlyBudgetUsd : 0;
  const budgetState = ratio >= 1 ? "exceeded" : ratio >= 0.8 ? "warning" : "ok";
  const expensiveThreshold = Math.max(0, options.expensiveSessionUsd ?? 1);
  const alerts: UsageAlert[] = [];

  if (expensiveThreshold > 0 && totalCostUsd >= expensiveThreshold) {
    alerts.push({
      kind: "expensive-session",
      amountUsd: totalCostUsd,
      message: `This conversation has used $${totalCostUsd.toFixed(4)}.`,
    });
  }
  if (budgetState === "warning") {
    alerts.push({
      kind: "budget-warning",
      amountUsd: totalCostUsd,
      message: `This conversation is at ${Math.round(ratio * 100)}% of the configured budget.`,
    });
  } else if (budgetState === "exceeded") {
    alerts.push({
      kind: "budget-exceeded",
      amountUsd: totalCostUsd,
      message: `This conversation exceeds the configured budget.`,
    });
  }

  const byModel = Array.from(byModelMap.values()).sort((a, b) => b.costUsd - a.costUsd);
  const byProvider = Array.from(byProviderMap.values()).sort((a, b) => b.costUsd - a.costUsd);

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    totalLatencyMs,
    byModel,
    byProvider,
    chart,
    budgetStatus: {
      state: budgetState,
      budgetUsd: monthlyBudgetUsd,
      spentUsd: totalCostUsd,
      ratio,
    },
    alerts,
  };
}

export interface BranchNode {
  id: string;
  role: Message["role"];
  label: string;
  createdAt: number;
  depth: number;
  childCount: number;
  isTip: boolean;
  isActive: boolean;
}

export interface BranchGraph {
  nodes: BranchNode[];
  edges: { from: string; to: string }[];
  tips: BranchNode[];
  activePath: string[];
}

export function buildBranchGraph(messages: Message[], activeTipId?: string | null): BranchGraph {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const childCounts = new Map<string, number>();
  const edges: BranchGraph["edges"] = [];

  for (const message of messages) {
    if (!message.parentId) continue;
    if (!byId.has(message.parentId)) continue;
    edges.push({ from: message.parentId, to: message.id });
    childCounts.set(message.parentId, (childCounts.get(message.parentId) ?? 0) + 1);
  }

  const tipsRaw = messages.filter((message) => (childCounts.get(message.id) ?? 0) === 0);
  const activeTip = activeTipId && byId.has(activeTipId)
    ? activeTipId
    : tipsRaw.slice().sort((a, b) => b.createdAt - a.createdAt)[0]?.id;
  const activePath: string[] = [];
  let cursor = activeTip ? byId.get(activeTip) : undefined;
  while (cursor) {
    activePath.unshift(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  const activeSet = new Set(activePath);

  const depthCache = new Map<string, number>();
  const depthFor = (message: Message): number => {
    const cached = depthCache.get(message.id);
    if (cached !== undefined) return cached;
    const parent = message.parentId ? byId.get(message.parentId) : undefined;
    const depth = parent ? depthFor(parent) + 1 : 0;
    depthCache.set(message.id, depth);
    return depth;
  };

  const nodes = messages.map((message) => {
    const childCount = childCounts.get(message.id) ?? 0;
    return {
      id: message.id,
      role: message.role,
      label: message.content.trim().slice(0, 44) || message.role,
      createdAt: message.createdAt,
      depth: depthFor(message),
      childCount,
      isTip: childCount === 0,
      isActive: activeSet.has(message.id),
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const tips = tipsRaw
    .map((message) => nodeById.get(message.id))
    .filter((node): node is BranchNode => !!node)
    .sort((a, b) => a.createdAt - b.createdAt);

  return { nodes, edges, tips, activePath };
}

export interface PromptDocument {
  name: string;
  body: string;
  description: string;
  tags: string[];
  version: number;
  updatedAt: number;
  author: string;
  history: PromptVersion[];
  stats: {
    characters: number;
    words: number;
    variables: string[];
  };
}

export interface PromptVersion {
  version: number;
  body: string;
  updatedAt: number;
  author: string;
}

export function createPromptVersion(
  name: string,
  body: string,
  options: {
    previous?: PromptDocument;
    description?: string;
    tags?: string[];
    author?: string;
    at?: number;
  } = {},
): PromptDocument {
  const now = options.at ?? Date.now();
  const previous = options.previous;
  const history = previous
    ? [
        ...previous.history,
        {
          version: previous.version,
          body: previous.body,
          updatedAt: previous.updatedAt,
          author: previous.author,
        },
      ]
    : [];
  const variables = Array.from(new Set(Array.from(body.matchAll(/\$([A-Z0-9_]+|\d+|@)/gi)).map((m) => m[1])));

  return {
    name,
    body,
    description: options.description ?? previous?.description ?? body.split("\n").find((line) => line.trim())?.slice(0, 120) ?? "",
    tags: Array.from(new Set((options.tags ?? previous?.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))),
    version: (previous?.version ?? 0) + 1,
    updatedAt: now,
    author: options.author ?? previous?.author ?? "local",
    history,
    stats: {
      characters: body.length,
      words: body.trim() ? body.trim().split(/\s+/).length : 0,
      variables,
    },
  };
}

export function filterPromptDocuments(
  prompts: PromptDocument[],
  query: string,
  tags: string[] = [],
): PromptDocument[] {
  const needle = query.trim().toLowerCase();
  const wantedTags = tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  return prompts.filter((prompt) => {
    const haystack = `${prompt.name} ${prompt.description} ${prompt.body}`.toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
    return wantedTags.every((tag) => prompt.tags.includes(tag));
  });
}

export function computeNextRun(schedule: string, from = new Date()): Date {
  const trimmed = schedule.trim();
  if (trimmed === "@daily") {
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0));
  }
  if (trimmed === "@weekly") {
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 7, 0, 0, 0, 0));
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Unsupported schedule '${schedule}'. Use @daily, @weekly, */N * * * *, or M H * * *.`);
  }
  const [minutePart, hourPart] = parts;
  const next = new Date(from.getTime());
  next.setUTCSeconds(0, 0);

  const intervalMatch = minutePart.match(/^\*\/(\d+)$/);
  if (intervalMatch && hourPart === "*") {
    const interval = Math.max(1, Number(intervalMatch[1]));
    const currentMinute = next.getUTCMinutes();
    const delta = interval - (currentMinute % interval);
    next.setUTCMinutes(currentMinute + (delta === 0 ? interval : delta));
    return next;
  }

  const minute = Number(minutePart);
  const hour = Number(hourPart);
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    throw new Error(`Unsupported schedule '${schedule}'.`);
  }
  next.setUTCHours(hour, minute, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export type NotebookCellKind = "text" | "code" | "ai";
export interface NotebookCell {
  id: string;
  kind: NotebookCellKind;
  content: string;
  status: "idle" | "running" | "done" | "error";
  output?: string;
  updatedAt: number;
}

export function createNotebookCell(kind: NotebookCellKind, content = "", seed = Date.now()): NotebookCell {
  return {
    id: `cell-${seed}-${kind}`,
    kind,
    content,
    status: "idle",
    updatedAt: seed,
  };
}

export interface SyncConfig {
  enabled: boolean;
  provider: "icloud" | "s3";
  bucket?: string;
  endpoint?: string;
  prefix?: string;
  encryptionKeyHint?: string;
  remoteLabel: string;
}

export function normalizeSyncConfig(config: Omit<SyncConfig, "remoteLabel">): SyncConfig {
  const prefix = (config.prefix ?? "").trim().replace(/^\/+|\/+$/g, "");
  const bucket = config.bucket?.trim();
  return {
    ...config,
    bucket,
    endpoint: config.endpoint?.trim().replace(/\/+$/g, ""),
    prefix,
    encryptionKeyHint: config.encryptionKeyHint?.trim(),
    remoteLabel: config.provider === "icloud" ? "iCloud Drive" : `S3 ${bucket || "bucket"}`,
  };
}

export interface WatcherEventSummaryInput {
  path: string;
  kind: "create" | "modify" | "remove";
  at: number;
  diagnostic?: string;
}

export function summarizeWatcherEvent(event: WatcherEventSummaryInput): string {
  const path = event.path;
  if (/fail|error/i.test(event.diagnostic ?? "")) {
    return `Test signal failed after ${path} changed.`;
  }
  if (/(^|\/)(dist|build|target|out)\//.test(path) || /\.(png|pdf|zip|dmg|app|wasm)$/i.test(path)) {
    return `New artifact observed at ${path}.`;
  }
  if (/(package\.json|Cargo\.toml|vite\.config|tsconfig|\.env|\.toml|\.ya?ml)$/i.test(path)) {
    return `Configuration changed at ${path}.`;
  }
  if (event.kind === "remove") return `${path} was removed.`;
  if (event.kind === "create") return `${path} appeared.`;
  return `${path} changed.`;
}
