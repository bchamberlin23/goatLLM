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

  it("omits the web_search nudge by default", () => {
    const out = buildChatSystemPrompt();
    expect(out).not.toMatch(/web_search tool is available/);
  });

  it("includes the web_search nudge when hasWebSearch is true", () => {
    const out = buildChatSystemPrompt(undefined, false, true);
    expect(out).toMatch(/web_search tool is available/);
    expect(out).toMatch(/current events/i);
  });

  it("makes web search an autonomous evidence tool instead of a forced one-shot step", () => {
    const out = buildChatSystemPrompt(undefined, false, true);
    expect(out).toMatch(/Use it autonomously/);
    expect(out).toMatch(/extracted page evidence/);
    expect(out).not.toMatch(/only get ONE search per turn/i);
  });

  it("web_search nudge composes with user instructions", () => {
    const out = buildChatSystemPrompt("be brief", false, true);
    expect(out).toMatch(/web_search tool is available/);
    expect(out).toMatch(/<user_instructions>/);
    expect(out).toMatch(/be brief/);
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

  it("uses a Codex-style operating guide while preserving goatLLM capabilities", () => {
    const out = buildAgentSystemPrompt({ tools: [] });

    expect(out).toMatch(/Your capabilities:/);
    expect(out).toMatch(/# How you work/);
    expect(out).toMatch(/## Responsiveness/);
    expect(out).toMatch(/## Task execution/);
    expect(out).toMatch(/## Validating your work/);
    expect(out).toMatch(/side-panel canvas/);
    expect(out).toMatch(/load_skill/);
    expect(out).toMatch(/spawn_subagent/);
    expect(out).toMatch(/todo_create/);
    expect(out).toMatch(/done/);
  });

  it("relies on tool approval cards instead of telling the agent to wait separately", () => {
    const out = buildAgentSystemPrompt({ tools: [] });

    expect(out).toMatch(/approval card/i);
    expect(out).not.toMatch(/wait for user approval before making changes/i);
  });

  it("explains project instruction precedence when project context is injected", () => {
    const out = buildAgentSystemPrompt({
      tools: [],
      projectContextFiles: [
        { path: "AGENTS.md", content: "Run focused tests before finalizing." },
      ],
    });

    expect(out).toMatch(/Project instructions/i);
    expect(out).toMatch(/more deeply nested/i);
    expect(out).toMatch(/direct user instructions/i);
    expect(out).toMatch(/Run focused tests before finalizing/);
  });

  it("routes grep-shaped work to search_content (PR0 grep nudge)", () => {
    const out = buildAgentSystemPrompt({ tools: [] });
    // Tool routing: search_content beats bash grep, including the new flags.
    expect(out).toMatch(/search_content[^.]*not bash grep/i);
    expect(out).toMatch(/context_lines/);
    expect(out).toMatch(/case_insensitive/);
    // Bash guidance should NOT claim grep / find as bash territory anymore.
    expect(out).not.toMatch(/Use bash for shell operations like ls, grep, find/);
  });

  it("does not include research preamble by default", () => {
    const out = buildAgentSystemPrompt({ tools: [] });
    expect(out).not.toMatch(/RESEARCH MODE/);
  });

  it("prepends research preamble when researchMode is true", () => {
    const out = buildAgentSystemPrompt({ tools: [], researchMode: true });
    expect(out).toMatch(/\[RESEARCH MODE\]/);
    expect(out).toMatch(/PLAN/);
    expect(out).toMatch(/SYNTHESIZE/);
    expect(out).toMatch(/citations/i);
  });

  it("research preamble appears before the agent identity statement", () => {
    const out = buildAgentSystemPrompt({ tools: [], researchMode: true });
    const researchIdx = out.indexOf("[RESEARCH MODE]");
    const agentIdx = out.indexOf("expert coding agent");
    expect(researchIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeGreaterThan(researchIdx);
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

  it("is derived from the live registry — no drift", async () => {
    // Drift-bug regression net: every tool registered in ALL_TOOLS must
    // surface in the prompt list. Adding a tool to the registry without
    // updating system-prompt should never silently hide it from the model.
    const { ALL_TOOLS } = await import("../lib/tools/registry");
    const promptNames = new Set(getGoatLLMToolInfo().map((t) => t.name));
    for (const registeredName of Object.keys(ALL_TOOLS)) {
      expect(promptNames.has(registeredName)).toBe(true);
    }
  });

  it("buildAgentSystemPrompt accepts a live ToolSet and renders every tool", async () => {
    const { ALL_TOOLS } = await import("../lib/tools/registry");
    const prompt = buildAgentSystemPrompt({ tools: ALL_TOOLS });
    for (const name of Object.keys(ALL_TOOLS)) {
      expect(prompt).toMatch(new RegExp(`- ${name}:`));
    }
  });
});
