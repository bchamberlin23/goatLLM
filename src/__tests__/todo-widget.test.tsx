import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodoWidget } from "../components/TodoWidget";
import { applyAction, clearBoard } from "../lib/tools/todo";
import { useChatStore } from "../stores/chat";

const convId = "conv-todo-widget";

function resetChatStore() {
  useChatStore.setState({
    conversations: [
      {
        id: convId,
        title: "Todo Widget",
        lastMessagePreview: "",
        lastMessageAt: 1,
        createdAt: 1,
        modelId: null,
        systemPrompt: "",
      },
    ],
    activeId: convId,
    messages: { [convId]: [] },
    isStreaming: false,
    streamingConversationId: null,
    streamingAbortControllers: {},
    todoBoardUpdated: 0,
  });
}

function createTask(id: string, status: "pending" | "completed" = "pending") {
  applyAction(convId, {
    type: "create",
    task: {
      id,
      title: `Task ${id}`,
      status,
      blockedBy: [],
    },
  });
}

describe("TodoWidget", () => {
  beforeEach(() => {
    clearBoard(convId);
    resetChatStore();
  });

  afterEach(() => {
    clearBoard(convId);
    vi.restoreAllMocks();
  });

  it("keeps hook order stable when the active conversation is cleared", async () => {
    createTask("task-1");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TodoWidget />);
    expect(screen.getByText("tasks")).toBeInTheDocument();

    await expect(
      act(async () => {
        useChatStore.setState({ activeId: null });
      }),
    ).resolves.toBeUndefined();

    await waitFor(() => {
      expect(screen.queryByText("tasks")).not.toBeInTheDocument();
    });

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Rendered fewer hooks than expected"),
    );
  });

  it("keeps hook order stable when a board becomes empty", async () => {
    createTask("task-1");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TodoWidget />);
    expect(screen.getByText("tasks")).toBeInTheDocument();

    clearBoard(convId);
    await act(async () => {
      useChatStore.setState((s) => ({ todoBoardUpdated: s.todoBoardUpdated + 1 }));
    });

    await waitFor(() => {
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining("Rendered fewer hooks than expected"),
      );
    });
  });
});
