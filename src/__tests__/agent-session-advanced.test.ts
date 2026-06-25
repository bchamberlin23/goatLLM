import { describe, expect, it } from "vitest";
import type { Message } from "../stores/chat";
import {
  applyBudgetControls,
  buildApprovalHistory,
  buildFileImpactSummary,
  buildGitIntegrationSuggestions,
  buildLineHunks,
  buildReplayPrompt,
  buildSessionExportJson,
  buildWorkspaceHealthDashboard,
  canMarkAgentDone,
  compareSubagentFindings,
  discoverCheckCommands,
  evaluatePathPermission,
  explainToolRisk,
  filterSessionItems,
  nameCheckpoints,
  planTransactionalRestore,
  rememberCheckResult,
  sessionOnboardingSteps,
  summarizeFailedCheck,
  workspacePolicyStorageKey,
  type AgentBudgetControls,
  type PathPermissionRule,
} from "../lib/agent-session";

const convId = "conv-advanced";

function assistantMessage(partial: Partial<Message>): Message {
  return {
    id: "assistant-1",
    conversationId: convId,
    role: "assistant",
    content: "",
    createdAt: 1,
    ...partial,
  };
}

describe("advanced agent session helpers", () => {
  it("builds true line hunks for checkpoint diffs", () => {
    expect(buildLineHunks("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { type: "context", line: "a" },
      { type: "removed", line: "b" },
      { type: "added", line: "B" },
      { type: "context", line: "c" },
      { type: "added", line: "d" },
    ]);
  });

  it("exports JSON audit data as a structured string", () => {
    const json = JSON.parse(buildSessionExportJson({
      conversationTitle: "Audit",
      workspacePath: "/workspace",
      messages: [assistantMessage({ toolCalls: [{ toolCallId: "cmd", toolName: "bash", input: { command: "pnpm test" }, state: "done" }] })],
    }));

    expect(json.title).toBe("Audit");
    expect(json.turns[0].tools[0].toolName).toBe("bash");
  });

  it("blocks done until changed turns have verification", () => {
    const blocked = assistantMessage({
      editedFiles: ["src/App.tsx"],
      toolCalls: [{ toolCallId: "edit", toolName: "edit_file", input: { path: "src/App.tsx" }, state: "done" }],
    });
    const verified = assistantMessage({
      editedFiles: ["src/App.tsx"],
      toolCalls: [{ toolCallId: "test", toolName: "bash", input: { command: "pnpm test" }, state: "done" }],
    });

    expect(canMarkAgentDone(blocked).allowed).toBe(false);
    expect(canMarkAgentDone(verified).allowed).toBe(true);
  });

  it("derives stable per-workspace policy storage keys", () => {
    expect(workspacePolicyStorageKey("/Users/me/App")).toBe("goatllm-policy:/Users/me/App");
  });

  it("discovers check commands from project files", () => {
    expect(discoverCheckCommands({
      "package.json": JSON.stringify({ scripts: { test: "vitest", lint: "eslint .", build: "vite build" } }),
      "Cargo.toml": "[package]\nname = \"app\"",
      "pytest.ini": "[pytest]",
    })).toEqual(["pnpm test", "pnpm build", "pnpm lint", "cargo test", "pytest"]);
  });

  it("summarizes failed checks into actionable diagnostics", () => {
    expect(summarizeFailedCheck("FAIL src/app.test.ts\nExpected true to be false")).toEqual({
      headline: "Test failure in src/app.test.ts",
      nextCommand: "pnpm test src/app.test.ts",
    });
  });

  it("builds approval history from completed tool calls", () => {
    expect(buildApprovalHistory([
      assistantMessage({
        toolCalls: [
          { toolCallId: "cmd", toolName: "bash", input: { command: "rm -rf dist" }, state: "done", dangerLevel: "destructive" },
        ],
      }),
    ])).toEqual([{ toolCallId: "cmd", toolName: "bash", label: "rm -rf dist", state: "done", risk: "destructive" }]);
  });

  it("plans transactional restore steps for rollback files", () => {
    expect(planTransactionalRestore(["src/App.tsx", "src/New.tsx"])).toEqual([
      "Capture current state for 2 files",
      "Restore checkpoint files",
      "Verify restored files are writable",
      "On failure, restore captured current state",
    ]);
  });

  it("applies checkpoint names", () => {
    expect(nameCheckpoints([{ messageId: "turn-1", createdAt: 1, changedFiles: [], verificationLabel: "Verified", status: "complete", rollbackFiles: [] }], { "turn-1": "before auth" })[0].name).toBe("before auth");
  });

  it("builds workspace health dashboard data", () => {
    const dashboard = buildWorkspaceHealthDashboard([
      assistantMessage({
        editedFiles: ["src/App.tsx"],
        toolCalls: [{ toolCallId: "test", toolName: "bash", input: { command: "pnpm test" }, state: "error" }],
      }),
    ], { successfulCommands: ["pnpm build"], flakyCommands: ["pnpm test"], failedCommands: { "pnpm test": 2 } });

    expect(dashboard.latestStatus).toBe("failed");
    expect(dashboard.rememberedChecks).toEqual(["pnpm build"]);
    expect(dashboard.flakyCommands).toEqual(["pnpm test"]);
  });

  it("builds replay prompts from previous turns", () => {
    expect(buildReplayPrompt([
      { id: "u1", conversationId: convId, role: "user", content: "Fix auth", createdAt: 1 },
      assistantMessage({ content: "Done" }),
    ])).toContain("Replay this request: Fix auth");
  });

  it("compares subagent findings", () => {
    expect(compareSubagentFindings(["Auth fails on refresh", "Auth fails on refresh", "CSS issue"]).agreements).toEqual(["Auth fails on refresh"]);
  });

  it("explains tool risk and path permissions", () => {
    expect(explainToolRisk("bash", { command: "rm -rf dist" })).toContain("destructive");
    const rules: PathPermissionRule[] = [{ pattern: ".env", action: "ask" }, { pattern: "src/**", action: "auto" }];
    expect(evaluatePathPermission("src/App.tsx", rules)).toBe("auto");
    expect(evaluatePathPermission(".env", rules)).toBe("ask");
  });

  it("tracks flaky check results", () => {
    const memory = rememberCheckResult({ successfulCommands: [], flakyCommands: [], failedCommands: {} }, "pnpm test", "error");
    const recovered = rememberCheckResult(memory, "pnpm test", "done");
    expect(recovered.flakyCommands).toEqual(["pnpm test"]);
  });

  it("filters session items by tool/checkpoint/failure", () => {
    const messages = [
      assistantMessage({ id: "a", toolCalls: [{ toolCallId: "test", toolName: "bash", input: { command: "pnpm test" }, state: "error" }] }),
      assistantMessage({ id: "b", toolCalls: [{ toolCallId: "edit", toolName: "edit_file", input: { path: "src/App.tsx" }, state: "done", rollbackSnapshot: { path: "src/App.tsx", existed: true, content: "", capturedAt: 1 } }] }),
    ];
    expect(filterSessionItems(messages, "failed").map((message) => message.id)).toEqual(["a"]);
    expect(filterSessionItems(messages, "checkpoints").map((message) => message.id)).toEqual(["b"]);
  });

  it("builds git integration suggestions and file impact summaries", () => {
    expect(buildGitIntegrationSuggestions("complete")).toEqual(["Commit verified changes", "Create branch from checkpoint"]);
    expect(buildFileImpactSummary("src/App.tsx", "before", "after\nmore")).toContain("src/App.tsx changed by 1 line");
  });

  it("applies budget controls and onboarding steps", () => {
    const controls: AgentBudgetControls = { maxToolCalls: 4, maxSubagents: 1, maxMinutes: 10 };
    expect(applyBudgetControls(controls)).toBe("Max 4 tool calls, 1 subagent, 10 minutes");
    expect(applyBudgetControls({ ...controls, maxSubagents: 0 })).toBe("Max 4 tool calls, unlimited subagents, 10 minutes");
    expect(sessionOnboardingSteps({ hasWorkspace: false, hasPolicy: false, hasChecks: false })).toEqual([
      "Choose a workspace",
      "Pick a permission profile",
      "Confirm verification checks",
    ]);
  });
});
