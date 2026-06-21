import { describe, expect, it } from "vitest";

import {
  calculateContextTokens,
  shouldCompact,
  type CompactionSettings,
} from "../lib/context-manager";

const settings: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

describe("compaction trigger", () => {
  it("prefers usage.totalTokens over component token counts", () => {
    expect(
      calculateContextTokens({
        totalTokens: 900,
        inputTokens: 100,
        outputTokens: 100,
        cacheRead: 100,
        cacheWrite: 100,
      }),
    ).toBe(900);
  });

  it("falls back to input, output, and cache token components", () => {
    expect(
      calculateContextTokens({
        inputTokens: 300,
        outputTokens: 50,
        cacheRead: 25,
        cacheWrite: 10,
      }),
    ).toBe(385);
  });

  it.each([
    ["chat", 32_000],
    ["agent", 128_000],
    ["design", 1_000_000],
  ])("starts auto-compaction at 80%% in %s mode", (_mode, contextWindow) => {
    expect(shouldCompact(Math.floor(contextWindow * 0.8) - 1, contextWindow, settings)).toBe(false);
    expect(shouldCompact(Math.floor(contextWindow * 0.8), contextWindow, settings)).toBe(true);
  });

  it("respects disabled compaction settings", () => {
    expect(
      shouldCompact(99_000, 100_000, {
        ...settings,
        enabled: false,
      }),
    ).toBe(false);
  });
});
