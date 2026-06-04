import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
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

  describe("Manual Task Management", () => {
    beforeEach(() => {
      useChatStore.setState({ manualTasksEnabled: true });
    });

    it("renders empty state placeholder when no tasks exist and manual mode is enabled", async () => {
      render(<TodoWidget />);
      expect(screen.getByText("Tasks")).toBeInTheDocument();
      expect(screen.getByText("(empty)")).toBeInTheDocument();
    });

    it("allows checking off a task manually", async () => {
      createTask("task-1");
      const updateManualTodoBoardSpy = vi.fn();
      useChatStore.setState({ updateManualTodoBoard: () => {} }); // dummy, we'll set the spy
      useChatStore.setState({ updateManualTodoBoard: updateManualTodoBoardSpy });

      render(<TodoWidget />);
      
      const toggleButton = await screen.findByRole("button", { name: /0\/1/ });
      await act(async () => {
        toggleButton.click();
      });

      const checkboxButton = screen.getByRole("button", { name: "Toggle completion status" });
      await act(async () => {
        checkboxButton.click();
      });

      expect(updateManualTodoBoardSpy).toHaveBeenCalled();
      const updatedBoard = updateManualTodoBoardSpy.mock.calls[0][1];
      expect(updatedBoard.tasks.get("task-1").status).toBe("completed");
    });

    it("allows adding a task manually", async () => {
      const updateManualTodoBoardSpy = vi.fn();
      useChatStore.setState({ updateManualTodoBoard: updateManualTodoBoardSpy });

      render(<TodoWidget />);
      
      const toggleButton = await screen.findByRole("button", { name: /Tasks/ });
      await act(async () => {
        toggleButton.click();
      });

      const input = screen.getByPlaceholderText("Add a task...");
      await act(async () => {
        fireEvent.change(input, { target: { value: "New Manual Task" } });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      });

      expect(updateManualTodoBoardSpy).toHaveBeenCalled();
      const updatedBoard = updateManualTodoBoardSpy.mock.calls[0][1];
      expect(updatedBoard.order.length).toBe(1);
      const newTask = updatedBoard.tasks.get(updatedBoard.order[0]);
      expect(newTask.title).toBe("New Manual Task");
      expect(newTask.status).toBe("pending");
    });
  });
});
