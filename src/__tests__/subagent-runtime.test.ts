import { describe, expect, it, vi } from "vitest";
import type { LlmConfig } from "../lib/llm-types";
import {
  createSubagentLivenessMonitor,
  resolveSubagentConfig,
  sanitizeSubagentSettings,
  type SubagentSettings,
} from "../lib/subagent-runtime";

const currentConfig: LlmConfig = {
  provider: "openai",
  modelId: "gpt-current",
  apiKey: "current-key",
};

describe("subagent runtime policy", () => {
  it("routes explore and implement subagents to configured models", () => {
    const settings: SubagentSettings = {
      staleAfterMs: 120_000,
      models: {
        explore: { mode: "model", modelId: "anthropic:claude-explore" },
        implement: { mode: "model", modelId: "opencode-go:gpt-implement" },
      },
    };
    const getConfigForModel = vi.fn((modelId: string): LlmConfig | null => ({
      provider: modelId.split(":")[0],
      modelId: modelId.split(":").slice(1).join(":"),
      apiKey: `${modelId}-key`,
    }));

    expect(resolveSubagentConfig("explore", settings, currentConfig, getConfigForModel)).toMatchObject({
      provider: "anthropic",
      modelId: "claude-explore",
    });
    expect(resolveSubagentConfig("implement", settings, currentConfig, getConfigForModel)).toMatchObject({
      provider: "opencode-go",
      modelId: "gpt-implement",
    });
    expect(getConfigForModel).toHaveBeenCalledTimes(2);
  });

  it("falls back to the current chat model when a subagent model is unset or unavailable", () => {
    const settings = sanitizeSubagentSettings({
      models: {
        explore: { mode: "current" },
        implement: { mode: "model", modelId: "missing:model" },
      },
    });

    expect(resolveSubagentConfig("explore", settings, currentConfig, () => null)).toBe(currentConfig);
    expect(resolveSubagentConfig("implement", settings, currentConfig, () => null)).toBe(currentConfig);
  });

  it("detects stale subagents after the configured inactivity window", () => {
    vi.useFakeTimers();
    try {
      const onStale = vi.fn();
      const monitor = createSubagentLivenessMonitor({
        staleAfterMs: 120_000,
        checkEveryMs: 30_000,
        now: () => Date.now(),
        onStale,
      });

      vi.advanceTimersByTime(90_000);
      expect(onStale).not.toHaveBeenCalled();

      monitor.markProgress();
      vi.advanceTimersByTime(90_000);
      expect(onStale).not.toHaveBeenCalled();

      vi.advanceTimersByTime(30_000);
      expect(onStale).toHaveBeenCalledTimes(1);
      expect(onStale).toHaveBeenCalledWith(expect.objectContaining({
        idleMs: 120_000,
        staleAfterMs: 120_000,
      }));

      monitor.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
