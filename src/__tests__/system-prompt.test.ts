import { describe, it, expect } from "vitest";
import {
  buildAgentSystemPrompt,
  buildChatSystemPrompt,
  getGoatLLMToolInfo,
} from "../lib/system-prompt";

describe("buildChatSystemPrompt", () => {
  it("returns base prompt with no user instructions", () => {
    const out = buildChatSystemPrompt();
    expect(out).toMatch(/helpful AI assistant/);
    expect(out).not.toMatch(/user_instructions/);
  });

  it("wraps user prompt in user_instructions tags", () => {
    const out = buildChatSystemPrompt("be brief");
    expect(out).toMatch(/<user_instructions>/);
    expect(out).toMatch(/be brief/);
    expect(out).toMatch(/<\/user_instructions>/);
  });

  it("returns base when user prompt is empty string", () => {
    const out = buildChatSystemPrompt("");
    expect(out).not.toMatch(/<user_instructions>/);
  });
});

describe("buildAgentSystemPrompt", () => {
  it("includes the workspace path when set", () => {
    const out = buildAgentSystemPrompt({
      tools: [],
      workspacePath: "/Users/me/project",
    });
    expect(out).toMatch(/\/Users\/me\/project/);
  });

  it("includes a no-workspace fallback", () => {
    const out = buildAgentSystemPrompt({ tools: [] });
    expect(out).toMatch(/No workspace selected/);
  });

  it("lists every provided tool", () => {
    const out = buildAgentSystemPrompt({
      tools: [
        { name: "tool_a", description: "Does A" },
        { name: "tool_b", description: "Does B" },
      ],
    });
    expect(out).toMatch(/tool_a: Does A/);
    expect(out).toMatch(/tool_b: Does B/);
  });

  it("contains coding-agent identity statement", () => {
    const out = buildAgentSystemPrompt({ tools: [] });
    expect(out).toMatch(/coding agent/i);
    expect(out).toMatch(/goatLLM/);
  });
});

describe("getGoatLLMToolInfo", () => {
  it("returns the canonical tool list", () => {
    const tools = getGoatLLMToolInfo();
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("bash");
    expect(names).toContain("list_dir");
    expect(names).toContain("search_content");
  });

  it("every tool has a non-empty description", () => {
    const tools = getGoatLLMToolInfo();
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});
