import type { LlmConfig } from "./llm-types";

export type SubagentKind = "explore" | "implement";

export type SubagentModelSelection =
  | { mode: "current" }
  | { mode: "model"; modelId: string };

export interface SubagentSettings {
  staleAfterMs: number;
  models: Record<SubagentKind, SubagentModelSelection>;
}

export const DEFAULT_SUBAGENT_SETTINGS: SubagentSettings = {
  staleAfterMs: 120_000,
  models: {
    explore: { mode: "current" },
    implement: { mode: "current" },
  },
};

const MIN_STALE_AFTER_MS = 30_000;
const MAX_STALE_AFTER_MS = 15 * 60_000;

export function sanitizeSubagentSettings(value: unknown): SubagentSettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawModels = raw.models && typeof raw.models === "object"
    ? raw.models as Record<string, unknown>
    : {};

  return {
    staleAfterMs: clampNumber(raw.staleAfterMs, DEFAULT_SUBAGENT_SETTINGS.staleAfterMs, MIN_STALE_AFTER_MS, MAX_STALE_AFTER_MS),
    models: {
      explore: sanitizeModelSelection(rawModels.explore),
      implement: sanitizeModelSelection(rawModels.implement),
    },
  };
}

function sanitizeModelSelection(value: unknown): SubagentModelSelection {
  if (!value || typeof value !== "object") return { mode: "current" };
  const raw = value as Record<string, unknown>;
  if (raw.mode === "model" && typeof raw.modelId === "string" && raw.modelId.trim()) {
    return { mode: "model", modelId: raw.modelId.trim() };
  }
  return { mode: "current" };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function resolveSubagentConfig(
  kind: SubagentKind,
  settings: SubagentSettings,
  currentConfig: LlmConfig,
  getConfigForModel: (modelId: string) => LlmConfig | null,
): LlmConfig {
  const selection = settings.models[kind];
  if (selection.mode !== "model") return currentConfig;
  return getConfigForModel(selection.modelId) ?? currentConfig;
}

export interface SubagentStaleInfo {
  idleMs: number;
  staleAfterMs: number;
}

export function createSubagentLivenessMonitor({
  staleAfterMs,
  checkEveryMs = Math.min(30_000, staleAfterMs),
  now = Date.now,
  onStale,
}: {
  staleAfterMs: number;
  checkEveryMs?: number;
  now?: () => number;
  onStale: (info: SubagentStaleInfo) => void;
}) {
  let lastProgressAt = now();
  let stopped = false;
  let fired = false;

  const interval = setInterval(() => {
    if (stopped || fired) return;
    const idleMs = now() - lastProgressAt;
    if (idleMs >= staleAfterMs) {
      fired = true;
      onStale({ idleMs, staleAfterMs });
    }
  }, Math.max(1, checkEveryMs));

  return {
    markProgress() {
      lastProgressAt = now();
    },
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}
