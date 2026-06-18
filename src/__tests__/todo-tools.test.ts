import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useChatStore } from "../stores/chat";
import { getBoardForConversation, clearBoard, loadBoardFromHistory } from "../lib/tools/todo";
import { todo_create } from "../lib/tools/builtins/todo";

const convId = "conv-todo-tools-test";

function setupChatStore() {
  useChatStore.setState({
    conversations: [
      {
        id: convId,
        title: "Test Todo",
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

describe("Todo Tools - Batch Creation", () => {
  beforeEach(() => {
    clearBoard(convId);
    setupChatStore();
  });

  afterEach(() => {
    clearBoard(convId);
  });

  it("creates a single task successfully (backward compatibility)", async () => {
    const output = await todo_create.execute!({
      title: "Single Task",
      description: "A single task description",
    }, {} as any);

    expect(output).toContain("Created task:");
    expect(output).toContain("Single Task");

    const board = getBoardForConversation(convId);
    expect(board.order.length).toBe(1);
    const task = board.tasks.get(board.order[0])!;
    expect(task.title).toBe("Single Task");
    expect(task.description).toBe("A single task description");
    expect(task.status).toBe("pending");
  });

  it("creates multiple tasks in a batch upfront", async () => {
    const output = await todo_create.execute!({
      tasks: [
        { id: "task-a", title: "Task A", description: "Desc A" },
        { id: "task-b", title: "Task B", description: "Desc B", blockedBy: ["task-a"] },
        { id: "task-c", title: "Task C" },
      ],
    }, {} as any);

    expect(output).toContain("Created 3 tasks:");
    expect(output).toContain("task-a, task-b, task-c");

    const board = getBoardForConversation(convId);
    expect(board.order.length).toBe(3);
    expect(board.order).toEqual(["task-a", "task-b", "task-c"]);

    const taskB = board.tasks.get("task-b")!;
    expect(taskB.title).toBe("Task B");
    expect(taskB.blockedBy).toEqual(["task-a"]);
  });

  it("rejects batch task creation with self-blocking tasks", async () => {
    const output = await todo_create.execute!({
      tasks: [
        { id: "task-a", title: "Task A", blockedBy: ["task-a"] },
      ],
    }, {} as any);

    expect(output).toContain("Error: task \"task-a\" cannot block itself");
    const board = getBoardForConversation(convId);
    expect(board.order.length).toBe(0);
  });

  it("rejects batch task creation with missing dependencies", async () => {
    const output = await todo_create.execute!({
      tasks: [
        { id: "task-a", title: "Task A", blockedBy: ["task-nonexistent"] },
      ],
    }, {} as any);

    expect(output).toContain("Error: blockedBy task \"task-nonexistent\" not found");
    const board = getBoardForConversation(convId);
    expect(board.order.length).toBe(0);
  });

  it("rejects batch task creation with dependency cycles", async () => {
    const output = await todo_create.execute!({
      tasks: [
        { id: "task-a", title: "Task A", blockedBy: ["task-b"] },
        { id: "task-b", title: "Task B", blockedBy: ["task-a"] },
      ],
    }, {} as any);

    expect(output).toContain("Error: blockedBy creates a dependency cycle");
    const board = getBoardForConversation(convId);
    expect(board.order.length).toBe(0);
  });

  it("replays batch task creations from history", () => {
    const toolCalls = [
      {
        toolName: "todo_create",
        input: {
          tasks: [
            { id: "replay-a", title: "Replay A" },
            { id: "replay-b", title: "Replay B", blockedBy: ["replay-a"] },
          ],
        },
        output: "Created 2 tasks: replay-a, replay-b\n\nTasks: 2 total\n  [ ] replay-a Replay A\n  [ ] replay-b Replay B (depends on: replay-a)\n\n<!-- TODO_BOARD\n{\n  \"tasks\": [\n    {\n      \"id\": \"replay-a\",\n      \"title\": \"Replay A\",\n      \"status\": \"pending\",\n      \"blockedBy\": [],\n      \"createdAt\": 1,\n      \"updatedAt\": 1\n    },\n    {\n      \"id\": \"replay-b\",\n      \"title\": \"Replay B\",\n      \"status\": \"pending\",\n      \"blockedBy\": [\n        \"replay-a\"\n      ],\n      \"createdAt\": 1,\n      \"updatedAt\": 1\n    }\n  ],\n  \"order\": [\n    \"replay-a\",\n    \"replay-b\"\n  ]\n}\nTODO_BOARD -->",
      },
    ];

    const board = loadBoardFromHistory(convId, toolCalls);
    expect(board).not.toBeNull();
    expect(board!.order).toEqual(["replay-a", "replay-b"]);
    expect(board!.tasks.get("replay-b")!.blockedBy).toEqual(["replay-a"]);
  });
});
