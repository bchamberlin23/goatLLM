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

  it("compacts only when usage exceeds context window minus reserve tokens", () => {
    expect(shouldCompact(80_000, 100_000, settings)).toBe(false);
    expect(shouldCompact(84_000, 100_000, settings)).toBe(true);
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
