import { describe, expect, it } from "vitest";
import type { Message } from "../stores/chat";
import { buildRollbackPreview, summarizeAgentTurn } from "../lib/agent-turn-summary";

function assistantMessage(partial: Partial<Message>): Message {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    role: "assistant",
    content: "",
    createdAt: 1,
    ...partial,
  };
}

describe("summarizeAgentTurn", () => {
  it("counts tool states, changed files, and verification checks", () => {
    const summary = summarizeAgentTurn(
      assistantMessage({
        editedFiles: ["src/App.tsx"],
        toolCalls: [
          {
            toolCallId: "read-1",
            toolName: "read_file",
            input: { path: "src/App.tsx" },
            state: "done",
          },
          {
            toolCallId: "edit-1",
            toolName: "edit_file",
            input: { path: "src/App.tsx" },
            state: "done",
          },
          {
            toolCallId: "test-1",
            toolName: "run_tests",
            input: { filter: "App" },
            state: "done",
          },
          {
            toolCallId: "build-1",
            toolName: "bash",
            input: { command: "pnpm build" },
            state: "error",
          },
          {
            toolCallId: "write-1",
            toolName: "write_file",
            input: { path: "src/Feature.tsx", content: "export {};" },
            state: "pending_approval",
          },
        ],
      }),
    );

    expect(summary.totalTools).toBe(5);
    expect(summary.completedTools).toBe(3);
    expect(summary.failedTools).toBe(1);
    expect(summary.pendingApprovals).toBe(1);
    expect(summary.runningTools).toBe(0);
    expect(summary.changedFiles).toEqual(["src/App.tsx", "src/Feature.tsx"]);
    expect(summary.checks).toEqual([
      { label: "run_tests", state: "done", toolName: "run_tests" },
      { label: "pnpm build", state: "error", toolName: "bash" },
    ]);
    expect(summary.groups).toEqual([
      { label: "Read/search", count: 1, toolNames: ["read_file"] },
      { label: "File changes", count: 2, toolNames: ["edit_file", "write_file"] },
      { label: "Verification", count: 2, toolNames: ["run_tests", "bash"] },
    ]);
  });

  it("treats test-like shell commands as checks without false positives", () => {
    const summary = summarizeAgentTurn(
      assistantMessage({
        toolCalls: [
          {
            toolCallId: "cmd-1",
            toolName: "exec_command",
            input: { command: "cargo test" },
            state: "done",
          },
          {
            toolCallId: "cmd-2",
            toolName: "bash",
            input: { command: "cat package.json" },
            state: "done",
          },
        ],
      }),
    );

    expect(summary.checks).toEqual([
      { label: "cargo test", state: "done", toolName: "exec_command" },
    ]);
  });

  it("marks changed files without checks as needing verification", () => {
    const summary = summarizeAgentTurn(
      assistantMessage({
        editedFiles: ["src/App.tsx"],
        toolCalls: [
          {
            toolCallId: "edit-1",
            toolName: "edit_file",
            input: { path: "src/App.tsx" },
            state: "done",
          },
        ],
      }),
    );

    expect(summary.verification).toEqual({
      status: "missing",
      label: "Needs verification",
      tone: "warning",
    });
    expect(summary.suggestedChecks).toEqual([
      { command: "pnpm test", label: "Run tests" },
      { command: "pnpm build", label: "Build app" },
    ]);
    expect(summary.doneContract.status).toBe("blocked");
    expect(summary.doneContract.nextSteps).toEqual(["Run verification checks before marking done"]);
  });

  it("marks completed checks as verified", () => {
    const summary = summarizeAgentTurn(
      assistantMessage({
        editedFiles: ["src/App.tsx"],
        toolCalls: [
          {
            toolCallId: "test-1",
            toolName: "bash",
            input: { command: "pnpm test" },
            state: "done",
          },
        ],
      }),
    );

    expect(summary.verification).toEqual({
      status: "passed",
      label: "Verified",
      tone: "success",
    });
  });

  it("marks failed checks as failed verification", () => {
    const summary = summarizeAgentTurn(
      assistantMessage({
        editedFiles: ["src/App.tsx"],
        toolCalls: [
          {
            toolCallId: "test-1",
            toolName: "bash",
            input: { command: "pnpm test" },
            state: "error",
          },
        ],
      }),
    );

    expect(summary.verification).toEqual({
      status: "failed",
      label: "Verification failed",
      tone: "error",
    });
  });

  it("does not require verification when nothing changed", () => {
    const summary = summarizeAgentTurn(
      assistantMessage({
        toolCalls: [
          {
            toolCallId: "read-1",
            toolName: "read_file",
            input: { path: "src/App.tsx" },
            state: "done",
          },
        ],
      }),
    );

    expect(summary.verification).toEqual({
      status: "not_applicable",
      label: "No changes",
      tone: "neutral",
    });
  });

  it("suggests Rust checks for Rust file changes", () => {
    const summary = summarizeAgentTurn(
      assistantMessage({
        editedFiles: ["src-tauri/src/lib.rs"],
        toolCalls: [
          {
            toolCallId: "edit-1",
            toolName: "edit_file",
            input: { path: "src-tauri/src/lib.rs" },
            state: "done",
          },
        ],
      }),
    );

    expect(summary.suggestedChecks).toEqual([
      { command: "cargo test", label: "Run Rust tests" },
    ]);
  });

  it("surfaces rollback snapshots and subagent bypass counts", () => {
    const summary = summarizeAgentTurn(
      assistantMessage({
        toolCalls: [
          {
            toolCallId: "edit-1",
            toolName: "edit_file",
            input: { path: "src/App.tsx" },
            state: "done",
            rollbackSnapshot: {
              path: "src/App.tsx",
              existed: true,
              content: "before",
              capturedAt: 1,
            },
          },
          {
            toolCallId: "write-1",
            toolName: "write_file",
            input: { path: "src/New.tsx" },
            state: "done",
            rollbackSnapshot: {
              path: "src/New.tsx",
              existed: false,
              content: "",
              capturedAt: 2,
            },
          },
          {
            toolCallId: "sub-1",
            toolName: "spawn_subagent",
            input: { task: "check files" },
            state: "done",
            approvalBypassed: true,
          },
        ],
      }),
    );

    expect(summary.rollbackFiles).toEqual([
      { path: "src/App.tsx", existed: true },
      { path: "src/New.tsx", existed: false },
    ]);
    expect(summary.subagentBypassCount).toBe(1);
    expect(summary.auditEntries.map((entry) => entry.label)).toEqual([
      "Edited src/App.tsx",
      "Wrote src/New.tsx",
      "Subagent bypassed approvals",
    ]);
    expect(summary.doneContract.status).toBe("blocked");
    expect(summary.doneContract.changedFiles).toEqual(["src/App.tsx", "src/New.tsx"]);
    expect(summary.doneContract.nextSteps).toEqual(["Run verification checks before marking done"]);
  });

  it("marks rolled back turns in the done contract and audit", () => {
    const summary = summarizeAgentTurn(
      assistantMessage({
        editedFiles: ["src/App.tsx"],
        rollbackResult: {
          status: "done",
          files: ["src/App.tsx"],
          completedAt: 10,
        },
        toolCalls: [
          {
            toolCallId: "edit-1",
            toolName: "edit_file",
            input: { path: "src/App.tsx" },
            state: "done",
            rollbackSnapshot: {
              path: "src/App.tsx",
              existed: true,
              content: "before",
              capturedAt: 1,
            },
          },
        ],
      }),
    );

    expect(summary.doneContract.status).toBe("rolled_back");
    expect(summary.auditEntries[summary.auditEntries.length - 1]).toEqual({
      label: "Rollback completed",
      detail: "1 file restored",
      tone: "success",
    });
  });

  it("builds rollback preview rows with before and after snippets", () => {
    const message = assistantMessage({
      toolCalls: [
        {
          toolCallId: "edit-1",
          toolName: "edit_file",
          input: {
            path: "src/App.tsx",
            content: "export function App() {\n  return <main>After</main>;\n}",
          },
          state: "done",
          rollbackSnapshot: {
            path: "src/App.tsx",
            existed: true,
            content: "export function App() {\n  return <main>Before</main>;\n}",
            capturedAt: 1,
          },
        },
        {
          toolCallId: "write-1",
          toolName: "write_file",
          input: {
            path: "src/New.tsx",
            content: "export const New = true;",
          },
          state: "done",
          rollbackSnapshot: {
            path: "src/New.tsx",
            existed: false,
            content: "",
            capturedAt: 2,
          },
        },
      ],
    });

    expect(buildRollbackPreview(message)).toEqual([
      {
        path: "src/App.tsx",
        action: "restore",
        beforeSnippet: "export function App() {\n  return <main>Before</main>;\n}",
        afterSnippet: "export function App() {\n  return <main>After</main>;\n}",
      },
      {
        path: "src/New.tsx",
        action: "delete",
        beforeSnippet: "(file did not exist)",
        afterSnippet: "export const New = true;",
      },
    ]);
  });
});
