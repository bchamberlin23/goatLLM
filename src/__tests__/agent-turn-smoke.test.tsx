import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { MessageBubble } from "../components/MessageBubble";
import { InlineToolCall } from "../components/InlineToolCall";
import { useChatStore, type Message } from "../stores/chat";

const convId = "conv-agent-smoke";

function resetChatStore() {
  useChatStore.setState({
    conversations: [
      {
        id: convId,
        title: "Agent Smoke",
        lastMessagePreview: "",
        lastMessageAt: 1,
        createdAt: 1,
        modelId: null,
        systemPrompt: "",
        workspacePath: "/workspace",
      },
    ],
    activeId: convId,
    messages: { [convId]: [] },
    workspacePath: "/workspace",
    isStreaming: false,
    streamingConversationId: null,
    streamingAbortControllers: {},
  });
}

function assistantMessage(partial: Partial<Message>): Message {
  return {
    id: "msg-1",
    conversationId: convId,
    role: "assistant",
    content: "Done.",
    createdAt: 1,
    ...partial,
  };
}

describe("agent turn smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a completed edit turn with verification and rollback affordances", () => {
    resetChatStore();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = assistantMessage({
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
    });

    render(<MessageBubble message={message} />);

    expect(screen.getByText("Run timeline")).toBeInTheDocument();
    expect(screen.getByText("Needs verification")).toBeInTheDocument();
    expect(screen.getByText("Run tests")).toBeInTheDocument();
    expect(screen.getByText("Preview rollback")).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("surfaces subagent approval bypass inline", () => {
    render(
      <InlineToolCall
        tc={{
          toolCallId: "sub-1",
          toolName: "spawn_subagent",
          input: { task: "inspect and patch" },
          state: "done",
          approvalBypassed: true,
          subagentTranscript: [{ role: "assistant", content: "done" }],
        }}
      />,
    );

    expect(screen.getByText("Auto-ran tools")).toBeInTheDocument();
  });
});
