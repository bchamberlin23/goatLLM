import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "../stores/chat";
import { AgentTurnRollbackButton, AgentTurnTimelineHeader } from "../components/AgentTurnTimeline";
import { useChatStore } from "../stores/chat";

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

describe("AgentTurnTimelineHeader", () => {
  it("renders a compact turn summary and toggles the timeline", () => {
    const onToggle = vi.fn();
    const message = assistantMessage({
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
          toolCallId: "pending-1",
          toolName: "bash",
          input: { command: "pnpm install" },
          state: "pending_approval",
        },
      ],
    });

    render(
      <AgentTurnTimelineHeader
        message={message}
        durationLabel="12s"
        expanded={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByRole("button", { name: /expand run timeline/i })).toBeInTheDocument();
    expect(screen.getByText("Run timeline")).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(screen.getByText("4 tools")).toBeInTheDocument();
    expect(screen.getByText("1 approval")).toBeInTheDocument();
    expect(screen.getByText("1 check")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /expand run timeline/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("surfaces failed tool counts", () => {
    const message = assistantMessage({
      toolCalls: [
        {
          toolCallId: "cmd-1",
          toolName: "bash",
          input: { command: "pnpm test" },
          state: "error",
        },
      ],
    });

    render(
      <AgentTurnTimelineHeader
        message={message}
        durationLabel="3s"
        expanded
        onToggle={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /collapse run timeline/i })).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("1 check")).toBeInTheDocument();
    expect(screen.getByText("Verification failed")).toBeInTheDocument();
  });

  it("shows when file changes still need verification", () => {
    const onRunSuggestedCheck = vi.fn();
    const message = assistantMessage({
      editedFiles: ["src/App.tsx"],
      toolCalls: [
        {
          toolCallId: "edit-1",
          toolName: "edit_file",
          input: { path: "src/App.tsx" },
          state: "done",
        },
      ],
    });

    render(
      <AgentTurnTimelineHeader
        message={message}
        durationLabel="2s"
        expanded={false}
        onToggle={() => {}}
        onRunSuggestedCheck={onRunSuggestedCheck}
      />,
    );

    expect(screen.getByText("Needs verification")).toBeInTheDocument();
    expect(screen.getByText("Run tests")).toBeInTheDocument();
    expect(screen.getByText("Build app")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Run tests"));
    expect(onRunSuggestedCheck).toHaveBeenCalledWith("pnpm test");
  });

  it("renders grouped details, checkpoints, and subagent bypass audit when expanded", () => {
    const message = assistantMessage({
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
          rollbackSnapshot: {
            path: "src/App.tsx",
            existed: true,
            content: "before",
            capturedAt: 1,
          },
        },
        {
          toolCallId: "sub-1",
          toolName: "spawn_subagent",
          input: { task: "inspect" },
          state: "done",
          approvalBypassed: true,
        },
      ],
    });

    render(
      <AgentTurnTimelineHeader
        message={message}
        durationLabel="4s"
        expanded
        onToggle={() => {}}
      />,
    );

    expect(screen.getByText("Checkpoint")).toBeInTheDocument();
    expect(screen.getByText(/Subagent auto-ran 1 tool/)).toBeInTheDocument();
    expect(screen.getByText("Read/search")).toBeInTheDocument();
    expect(screen.getByText("File changes")).toBeInTheDocument();
    expect(screen.getByText("Subagents")).toBeInTheDocument();
  });

  it("previews rollback files before applying snapshots and records outcome", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn().mockResolvedValue("ok"),
    }));
    useChatStore.setState({
      workspacePath: "/workspace",
      messages: {
        "conv-1": [
          assistantMessage({
            editedFiles: ["src/App.tsx"],
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
        ],
      },
    });
    const message = useChatStore.getState().messages["conv-1"][0];

    render(<AgentTurnRollbackButton message={message} />);

    fireEvent.click(screen.getByText("Preview rollback"));
    expect(screen.getByText("Rollback preview")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("Before rollback")).toBeInTheDocument();
    expect(screen.getByText("After current turn")).toBeInTheDocument();
    expect(screen.getByText("before")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm rollback"));

    await screen.findByText("Rolled back 1 file");
    const updated = useChatStore.getState().messages["conv-1"][0];
    expect(updated.rollbackResult?.status).toBe("done");
    vi.doUnmock("@tauri-apps/api/core");
  });
});
