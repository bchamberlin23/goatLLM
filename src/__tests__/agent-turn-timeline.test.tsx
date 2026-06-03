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

    fireEvent.click(screen.getByRole("button", { name: /expand run timeline/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
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
