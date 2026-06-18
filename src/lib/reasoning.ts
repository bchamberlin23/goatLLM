import type { LlmConfig } from "./llm-types";
import type {
  ModelConfig,
  ProviderCompat,
  ProviderConfig,
  ThinkingBudgets,
  ThinkingLevel,
  ThinkingLevelMap,
} from "./providers";

export type { ThinkingBudgets, ThinkingLevel, ThinkingLevelMap };

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

const DEFAULT_ANTHROPIC_BUDGETS: Required<ThinkingBudgets> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16_384,
  xhigh: 32_768,
};

export interface ReasoningLevelOption {
  level: ThinkingLevel;
  label: string;
}

export interface ResolveReasoningRequestInput {
  config: LlmConfig;
  model?: ModelConfig | null;
  provider?: Pick<ProviderConfig, "id" | "compat"> | null;
}

export interface ResolvedReasoningRequest {
  level: ThinkingLevel;
  providerOptions?: Record<string, unknown>;
  codexReasoning?: { effort: string; summary: "auto" };
}

export function getReasoningLevelOptions(input: {
  model?: ModelConfig | null;
  config?: LlmConfig | null;
}): ReasoningLevelOption[] {
  const model = input.model ?? modelFromConfig(input.config);
  if (!model?.reasoning) return [];
  const levelMap = model.thinkingLevelMap ?? input.config?.thinkingLevelMap;
  return THINKING_LEVELS
    .filter((level) => isLevelSupported(level, levelMap))
    .map((level) => ({ level, label: labelForLevel(level) }));
}

export function normalizeReasoningEffort(
  effort: string | undefined,
  input: { model?: ModelConfig | null; config?: LlmConfig | null },
): ThinkingLevel | undefined {
  const model = input.model ?? modelFromConfig(input.config);
  if (!model?.reasoning) return "off";
  if (!effort) return undefined;
  const requested = parseThinkingLevel(effort);
  if (!requested) return undefined;
  const supported = getReasoningLevelOptions({ model, config: input.config }).map((o) => o.level);
  if (supported.length === 0) return "off";
  if (supported.includes(requested)) return requested;

  const requestedIndex = THINKING_LEVELS.indexOf(requested);
  const nextHigher = THINKING_LEVELS.slice(requestedIndex + 1).find((level) => supported.includes(level));
  if (nextHigher) return nextHigher;
  const nextLower = [...THINKING_LEVELS.slice(0, requestedIndex)].reverse().find((level) => supported.includes(level));
  return nextLower ?? "off";
}

export function resolveReasoningRequest(input: ResolveReasoningRequestInput): ResolvedReasoningRequest {
  const { config } = input;
  const model = input.model ?? modelFromConfig(config);
  const providerCompat = input.provider?.compat ?? config.providerCompat;
  const level = normalizeReasoningEffort(config.reasoningEffort, { model, config }) ?? "off";
  if (!model?.reasoning || !config.reasoningEffort || level === "off") {
    return { level: level === "off" ? "off" : level, providerOptions: undefined, codexReasoning: undefined };
  }

  const api = providerCompat?.reasoningApi ?? defaultReasoningApi(config.provider);
  if (api === "none") {
    return { level, providerOptions: undefined, codexReasoning: undefined };
  }

  const value = mappedProviderValue(level, model.thinkingLevelMap ?? config.thinkingLevelMap, api);
  if (value === null) {
    return { level: "off", providerOptions: undefined, codexReasoning: undefined };
  }

  if (config.provider === "openai-codex-subscription") {
    return {
      level,
      providerOptions: undefined,
      codexReasoning: { effort: value, summary: "auto" },
    };
  }

  if (api === "anthropic") {
    const budget = budgetForLevel(level, model.thinkingBudgets ?? config.thinkingBudgets);
    return {
      level,
      providerOptions: {
        [config.provider]: { thinking: { type: "enabled", budgetTokens: budget } },
      },
      codexReasoning: undefined,
    };
  }

  if (api === "openrouter") {
    return {
      level,
      providerOptions: {
        [config.provider]: { reasoning: { effort: value } },
      },
      codexReasoning: undefined,
    };
  }

  if (api === "qwen") {
    return {
      level,
      providerOptions: {
        [config.provider]: { extraBody: { enable_thinking: true } },
      },
      codexReasoning: undefined,
    };
  }

  if (providerCompat?.supportsReasoningEffort === false) {
    return { level, providerOptions: undefined, codexReasoning: undefined };
  }

  return {
    level,
    providerOptions: {
      [config.provider]: { reasoningEffort: value },
    },
    codexReasoning: undefined,
  };
}

export function labelForLevel(level: ThinkingLevel): string {
  switch (level) {
    case "off":
      return "Off";
    case "minimal":
      return "Minimal";
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "X-High";
  }
}

function modelFromConfig(config: LlmConfig | null | undefined): ModelConfig | null {
  if (!config) return null;
  return {
    id: config.modelId,
    name: config.modelId,
    contextWindow: 0,
    reasoning: config.reasoning,
    thinkingLevelMap: config.thinkingLevelMap,
    thinkingBudgets: config.thinkingBudgets,
  };
}

function parseThinkingLevel(value: string): ThinkingLevel | undefined {
  return THINKING_LEVELS.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;
}

function isLevelSupported(level: ThinkingLevel, map: ThinkingLevelMap | undefined): boolean {
  return map?.[level] !== null;
}

function mappedProviderValue(
  level: ThinkingLevel,
  map: ThinkingLevelMap | undefined,
  api: NonNullable<ProviderCompat["reasoningApi"]>,
): string | null {
  const mapped = map?.[level];
  if (mapped === null) return null;
  if (typeof mapped === "string") return mapped;
  if (level === "xhigh" && (api === "openai" || api === "openrouter")) return "high";
  return level;
}

function budgetForLevel(level: ThinkingLevel, budgets: ThinkingBudgets | undefined): number {
  if (level === "off") return 0;
  return budgets?.[level] ?? DEFAULT_ANTHROPIC_BUDGETS[level];
}

function defaultReasoningApi(provider: string): NonNullable<ProviderCompat["reasoningApi"]> {
  if (provider === "anthropic") return "anthropic";
  if (provider === "openrouter") return "openrouter";
  return "openai";
}
