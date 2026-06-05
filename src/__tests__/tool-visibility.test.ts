import { describe, expect, it } from "vitest";
import { isInternalSkillToolCall, shouldShowToolCall } from "../lib/tool-visibility";

describe("tool visibility", () => {
  it("treats load_skill as internal skill machinery", () => {
    expect(isInternalSkillToolCall({ toolName: "load_skill" })).toBe(true);
    expect(isInternalSkillToolCall({ toolName: "read_file" })).toBe(false);
  });

  it("hides skill loads in regular chat only", () => {
    const skillLoad = { toolName: "load_skill" };

    expect(shouldShowToolCall(skillLoad, "chat")).toBe(false);
    expect(shouldShowToolCall(skillLoad, "agent")).toBe(true);
    expect(shouldShowToolCall(skillLoad, "design")).toBe(true);
  });

  it("keeps normal tool calls visible in every mode", () => {
    const readFile = { toolName: "read_file" };

    expect(shouldShowToolCall(readFile, "chat")).toBe(true);
    expect(shouldShowToolCall(readFile, "agent")).toBe(true);
    expect(shouldShowToolCall(readFile, "design")).toBe(true);
  });
});
