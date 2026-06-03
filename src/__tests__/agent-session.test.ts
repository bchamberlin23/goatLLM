import { describe, expect, it } from "vitest";
import type { Message } from "../stores/chat";
import {
  buildAgentCheckpoints,
  buildSessionExport,
  buildVerificationSuggestions,
  rememberSuccessfulChecks,
  type ProjectCheckMemory,
  type VerificationPolicy,
} from "../lib/agent-session";

const convId = "conv-session";

function assistantMessage(partial: Partial<Message>): Message {
  return {
    id: "msg-1",
    conversationId: convId,
    role: "assistant",
    content: "",
    createdAt: 1,
    ...partial,
  };
}

describe("agent session helpers", () => {
  it("builds checkpoints from agent turns with rollback snapshots", () => {
    const checkpoints = buildAgentCheckpoints([
      assistantMessage({
        id: "turn-1",
        createdAt: 10,
        editedFiles: ["src/App.tsx"],
        toolCalls: [
          {
            toolCallId: "edit-1",
            toolName: "edit_file",
            input: { path: "src/App.tsx", content: "after" },
            state: "done",
            rollbackSnapshot: {
              path: "src/App.tsx",
              existed: true,
              content: "before",
              capturedAt: 9,
            },
          },
        ],
      }),
      assistantMessage({
        id: "turn-2",
        createdAt: 20,
        toolCalls: [{ toolCallId: "read-1", toolName: "read_file", input: {}, state: "done" }],
      }),
    ]);

    expect(checkpoints).toEqual([
      {
        messageId: "turn-1",
        createdAt: 10,
        changedFiles: ["src/App.tsx"],
        verificationLabel: "Needs verification",
        status: "blocked",
        rollbackFiles: [{ path: "src/App.tsx", existed: true }],
      },
    ]);
  });

  it("exports a markdown audit bundle for a conversation", () => {
    const markdown = buildSessionExport({
      conversationTitle: "Trust Session",
      workspacePath: "/workspace",
      messages: [
        { id: "user-1", conversationId: convId, role: "user", content: "Fix it", createdAt: 1 },
        assistantMessage({
          id: "turn-1",
          content: "Done",
          editedFiles: ["src/App.tsx"],
          toolCalls: [
            { toolCallId: "test-1", toolName: "bash", input: { command: "pnpm test" }, state: "done" },
          ],
        }),
      ],
    });

    expect(markdown).toContain("# Trust Session Audit");
    expect(markdown).toContain("Workspace: `/workspace`");
    expect(markdown).toContain("User: Fix it");
    expect(markdown).toContain("Assistant turn `turn-1`");
    expect(markdown).toContain("Verification: Verified");
    expect(markdown).toContain("Tool: bash");
  });

  it("combines policy-required checks with remembered successful checks", () => {
    const policy: VerificationPolicy = {
      requireBuildForWeb: true,
      requireRustTests: true,
      customCommands: ["pnpm lint"],
    };
    const memory: ProjectCheckMemory = {
      successfulCommands: ["pnpm typecheck", "pnpm test"],
    };

    expect(buildVerificationSuggestions(["src/App.tsx", "src-tauri/src/lib.rs"], policy, memory)).toEqual([
      { command: "pnpm test", label: "Run tests" },
      { command: "pnpm build", label: "Build app" },
      { command: "cargo test", label: "Run Rust tests" },
      { command: "pnpm lint", label: "pnpm lint" },
      { command: "pnpm typecheck", label: "pnpm typecheck" },
    ]);
  });

  it("remembers successful verification commands without duplicates", () => {
    const memory = rememberSuccessfulChecks(
      { successfulCommands: ["pnpm test"] },
      assistantMessage({
        toolCalls: [
          { toolCallId: "test-1", toolName: "bash", input: { command: "pnpm test" }, state: "done" },
          { toolCallId: "build-1", toolName: "bash", input: { command: "pnpm build" }, state: "done" },
          { toolCallId: "fail-1", toolName: "bash", input: { command: "pnpm lint" }, state: "error" },
        ],
      }),
    );

    expect(memory.successfulCommands).toEqual(["pnpm test", "pnpm build"]);
  });
});
