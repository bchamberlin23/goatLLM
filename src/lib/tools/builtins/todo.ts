/**
 * Todo tool definitions for agent mode.
 *
 * 6 tools: todo_create, todo_update, todo_list, todo_get, todo_delete, todo_clear.
 * Each reads/writes the module cell from ../todo.ts and returns formatted output.
 */

import { tool } from "ai";
import { z } from "zod";
import { useChatStore } from "../../../stores/chat";
import {
  getBoardForConversation,
  applyAction,
  detectCycle,
  isValidTransition,
  isBlocked,
  formatBoardForToolOutput,
  type Task,
} from "../todo";

function getActiveConvId(): string | null {
  return useChatStore.getState().activeId || null;
}

// ─── todo_create ──────────────────────────────────────────────────────────

export const todo_create = tool({
  description:
    "Create a new task in the todo list. Tasks track work to be done with status tracking " +
    "(pending → in_progress → completed) and optional dependency blocking.",
  inputSchema: z.object({
    title: z.string().describe("Short task title (required)"),
    description: z.string().optional().describe("Optional longer description"),
    blockedBy: z
      .array(z.string())
      .optional()
      .describe("Task IDs that must be completed before this one"),
  }),
  execute: async ({ title, description, blockedBy }) => {
    const convId = getActiveConvId();
    if (!convId) return "Error: no active conversation";

    const board = getBoardForConversation(convId);
    const deps = blockedBy ?? [];

    // Validate blockedBy refs
    for (const dep of deps) {
      const depTask = board.tasks.get(dep);
      if (!depTask) return `Error: blockedBy task "${dep}" not found`;
      if (depTask.status === "deleted")
        return `Error: blockedBy task "${dep}" has been deleted`;
    }

    // Cycle detection
    const tempId = `__new_${Date.now()}`;
    const cycle = detectCycle(board.tasks, tempId, deps);
    if (cycle) return `Error: blockedBy creates a dependency cycle: ${cycle.join(" --> ")}`;

    const task: Omit<Task, "createdAt" | "updatedAt"> = {
      title,
      description,
      status: "pending",
      blockedBy: deps,
      id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    };

    const newBoard = applyAction(convId, { type: "create", task });
    bumpStore(convId);

    return formatBoardForToolOutput(newBoard, `Created task: ${task.id} (${task.title})`);
  },
});

// ─── todo_update ──────────────────────────────────────────────────────────

export const todo_update = tool({
  description:
    "Update an existing task. Change title, description, status, or blockedBy dependencies. " +
    "Valid status transitions: pending→in_progress→completed (and back). Any status can be deleted.",
  inputSchema: z.object({
    id: z.string().describe("Task ID to update"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    status: z
      .enum(["pending", "in_progress", "completed"])
      .optional()
      .describe("New status — follow the pending→in_progress→completed flow"),
    blockedBy: z
      .array(z.string())
      .optional()
      .describe("Replacement list of blocking task IDs"),
  }),
  execute: async ({ id, title, description, status, blockedBy }) => {
    const convId = getActiveConvId();
    if (!convId) return "Error: no active conversation";

    const board = getBoardForConversation(convId);
    const task = board.tasks.get(id);
    if (!task) return `Error: task "${id}" not found`;

    if (!title && !description && !status && !blockedBy) {
      return "Error: update requires at least one field to change (title, description, status, or blockedBy)";
    }

    // Validate status transition
    if (status && !isValidTransition(task.status, status)) {
      return `Error: invalid status transition: ${task.status} → ${status}`;
    }

    // Validate + cycle-check blockedBy
    if (blockedBy) {
      for (const dep of blockedBy) {
        if (dep === id) return `Error: task cannot block itself`;
        const depTask = board.tasks.get(dep);
        if (!depTask) return `Error: blockedBy task "${dep}" not found`;
        if (depTask.status === "deleted")
          return `Error: blockedBy task "${dep}" has been deleted`;
      }
      const cycle = detectCycle(board.tasks, id, blockedBy);
      if (cycle)
        return `Error: blockedBy creates a dependency cycle: ${cycle.join(" --> ")}`;
    }

    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (status !== undefined) patch.status = status;
    if (blockedBy !== undefined) patch.blockedBy = blockedBy;

    const newBoard = applyAction(convId, {
      type: "update",
      id,
      patch: patch as Partial<Pick<Task, "title" | "description" | "status" | "blockedBy">>,
    });
    bumpStore(convId);

    return formatBoardForToolOutput(
      newBoard,
      `Updated task: ${id}${status ? ` (${task.status} → ${status})` : ""}`,
    );
  },
});

// ─── todo_list ────────────────────────────────────────────────────────────

export const todo_list = tool({
  description:
    "List all tasks in the todo list. Shows task IDs, statuses, titles, and blocking info.",
  inputSchema: z.object({}),
  execute: async () => {
    const convId = getActiveConvId();
    if (!convId) return "Error: no active conversation";

    const board = getBoardForConversation(convId);
    bumpStore(convId);

    return formatBoardForToolOutput(board, "Task list:");
  },
});

// ─── todo_get ─────────────────────────────────────────────────────────────

export const todo_get = tool({
  description: "Get full details of a single task by ID.",
  inputSchema: z.object({
    id: z.string().describe("Task ID to retrieve"),
  }),
  execute: async ({ id }) => {
    const convId = getActiveConvId();
    if (!convId) return "Error: no active conversation";

    const board = getBoardForConversation(convId);
    const task = board.tasks.get(id);
    if (!task) return `Error: task "${id}" not found`;

    const blocked = isBlocked(task, board.tasks);
    const blocksOthers = board.order
      .map((tid) => board.tasks.get(tid))
      .filter((t) => t && t.blockedBy?.includes(id));

    const lines = [
      `Task: ${task.id}`,
      `Title: ${task.title}`,
      `Status: ${task.status}${blocked ? " (BLOCKED)" : ""}`,
    ];
    if (task.description) lines.push(`Description: ${task.description}`);
    if (task.blockedBy?.length)
      lines.push(`Depends on: ${task.blockedBy.join(", ")}`);
    if (blocksOthers.length)
      lines.push(`Blocks: ${blocksOthers.map((t) => `${t!.id} (${t!.title})`).join(", ")}`);
    lines.push(`Created: ${new Date(task.createdAt).toISOString()}`);
    if (task.completedAt)
      lines.push(`Completed: ${new Date(task.completedAt).toISOString()}`);

    bumpStore(convId);
    return lines.join("\n");
  },
});

// ─── todo_delete ──────────────────────────────────────────────────────────

export const todo_delete = tool({
  description:
    "Delete a task (marks as deleted tombstone). The task ID is preserved so " +
    "blockedBy references to it don't break. Use todo_clear to remove all tasks.",
  inputSchema: z.object({
    id: z.string().describe("Task ID to delete"),
  }),
  execute: async ({ id }) => {
    const convId = getActiveConvId();
    if (!convId) return "Error: no active conversation";

    const board = getBoardForConversation(convId);
    const task = board.tasks.get(id);
    if (!task) return `Error: task "${id}" not found`;
    if (task.status === "deleted") return `Error: task "${id}" is already deleted`;

    const newBoard = applyAction(convId, { type: "delete", id });
    bumpStore(convId);

    return formatBoardForToolOutput(newBoard, `Deleted task: ${id} (${task.title})`);
  },
});

// ─── todo_clear ───────────────────────────────────────────────────────────

export const todo_clear = tool({
  description: "Clear ALL tasks from the todo board. This is permanent — deleted tombstones are also removed.",
  inputSchema: z.object({}),
  execute: async () => {
    const convId = getActiveConvId();
    if (!convId) return "Error: no active conversation";

    const board = getBoardForConversation(convId);
    const count = board.tasks.size;

    applyAction(convId, { type: "clear" });
    bumpStore(convId);

    return `Cleared ${count} tasks. Board is empty.`;
  },
});

// ─── Store bump ───────────────────────────────────────────────────────────

function bumpStore(convId: string): void {
  const store = useChatStore.getState();
  if (store.activeId === convId) {
    useChatStore.setState({ todoBoardUpdated: (store.todoBoardUpdated ?? 0) + 1 });
  }
}

// ─── Tool set ─────────────────────────────────────────────────────────────

export const TODO_TOOLS = {
  todo_create,
  todo_update,
  todo_list,
  todo_get,
  todo_delete,
  todo_clear,
};
