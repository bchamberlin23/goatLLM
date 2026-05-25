/**
 * MCP trust + readOnlyHint tests (D3=B).
 */
import { describe, it, expect } from "vitest";
import type { McpServerConfig, McpToolInfo } from "../client";

describe("MCP trust toggle — canSkipApproval logic", () => {
  function canSkipApproval(config: Pick<McpServerConfig, "trusted">, tool: Pick<McpToolInfo, "annotations">): boolean {
    const isReadOnly = tool.annotations?.readOnlyHint === true;
    return !!config.trusted && isReadOnly;
  }

  it("untrusted server + readOnlyHint → NO skip", () => {
    expect(canSkipApproval(
      { trusted: false },
      { annotations: { readOnlyHint: true } },
    )).toBe(false);
  });

  it("untrusted server + no annotation → NO skip", () => {
    expect(canSkipApproval(
      { trusted: false },
      { annotations: undefined },
    )).toBe(false);
  });

  it("trusted server + readOnlyHint → skip", () => {
    expect(canSkipApproval(
      { trusted: true },
      { annotations: { readOnlyHint: true } },
    )).toBe(true);
  });

  it("trusted server + readOnlyHint=false → NO skip", () => {
    expect(canSkipApproval(
      { trusted: true },
      { annotations: { readOnlyHint: false } },
    )).toBe(false);
  });

  it("trusted server + destructiveHint → NO skip (not read-only)", () => {
    expect(canSkipApproval(
      { trusted: true },
      { annotations: { destructiveHint: true } },
    )).toBe(false);
  });

  it("trusted server + no annotations → NO skip", () => {
    expect(canSkipApproval(
      { trusted: true },
      { annotations: undefined },
    )).toBe(false);
  });
});
