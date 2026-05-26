/**
 * Todo core — pure state machine + module-level cell for task management.
 *
 * Architecture:
 * - Module-level cell holds one TaskBoard per conversation
 * - Pure reducer functions for all mutations (testable, no side effects)
 * - State serialized in every tool output for conversation replay
 * - Last-write-wins replay: walk messages, parse the last todo tool output
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  blockedBy: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  deletedAt?: number;
}

export interface TaskBoard {
  tasks: Map<string, Task>;
  order: string[];
}

export type TodoAction =
  | { type: "create"; task: Omit<Task, "createdAt" | "updatedAt"> }
  | { type: "update"; id: string; patch: Partial<Pick<Task, "title" | "description" | "status" | "blockedBy">> }
  | { type: "delete"; id: string }
  | { type: "clear" };

// ─── Module Cell ──────────────────────────────────────────────────────────

const boards = new Map<string, TaskBoard>();

export function getBoardForConversation(convId: string): TaskBoard {
  let board = boards.get(convId);
  if (!board) {
    board = { tasks: new Map(), order: [] };
    boards.set(convId, board);
  }
  return board;
}

export function applyAction(convId: string, action: TodoAction): TaskBoard {
  const board = getBoardForConversation(convId);
  const next = reduceBoard(board, action);
  boards.set(convId, next);
  return next;
}

export function clearBoard(convId: string): void {
  boards.delete(convId);
}

// ─── Valid Transitions ────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  pending: new Set(["in_progress", "completed", "deleted"]),
  in_progress: new Set(["pending", "completed", "deleted"]),
  completed: new Set(["deleted"]),
  deleted: new Set(),
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  if (to === "deleted") return true; // any status can be deleted
  return VALID_TRANSITIONS[from].has(to);
}

// ─── Cycle Detection ──────────────────────────────────────────────────────

export function detectCycle(
  tasks: Map<string, Task>,
  taskId: string,
  blockedBy: string[],
): string[] | null {
  // Build adjacency: all existing edges + proposed new edges
  const edges = new Map<string, string[]>();
  for (const [id, t] of tasks) {
    const deps = id === taskId
      ? [...new Set([...(t.blockedBy ?? []), ...blockedBy])]
      : [...(t.blockedBy ?? [])];
    edges.set(id, deps);
  }
  // Handle new task case (not yet in tasks map)
  if (!edges.has(taskId)) {
    edges.set(taskId, [...blockedBy]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclePath: string[] = [];

  function dfs(node: string): boolean {
    if (visiting.has(node)) {
      cyclePath.push(node);
      return true;
    }
    if (visited.has(node)) return false;

    visiting.add(node);
    cyclePath.push(node);

    for (const neighbor of edges.get(node) ?? []) {
      if (dfs(neighbor)) return true;
    }

    visiting.delete(node);
    cyclePath.pop();
    visited.add(node);
    return false;
  }

  // Check only the affected task's subgraph
  if (dfs(taskId)) {
    // Trim cyclePath to just the cycle portion
    const start = cyclePath.indexOf(cyclePath[cyclePath.length - 1]);
    return cyclePath.slice(start);
  }

  return null;
}

// ─── Blocked Check ────────────────────────────────────────────────────────

export function isBlocked(task: Task, tasks: Map<string, Task>): boolean {
  if (!task.blockedBy?.length) return false;
  return task.blockedBy.some((depId) => {
    const dep = tasks.get(depId);
    if (!dep) return true; // missing dep = blocked
    if (dep.status === "deleted") return true;
    return dep.status !== "completed";
  });
}

// ─── Pure Reducer ─────────────────────────────────────────────────────────

export function reduceBoard(board: TaskBoard, action: TodoAction): TaskBoard {
  const tasks = new Map(board.tasks);
  const order = [...board.order];
  const now = Date.now();

  switch (action.type) {
    case "create": {
      const id = action.task.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const task: Task = {
        ...action.task,
        id,
        createdAt: now,
        updatedAt: now,
      };
      tasks.set(id, task);
      order.push(id);
      return { tasks, order };
    }

    case "update": {
      const existing = tasks.get(action.id);
      if (!existing) return board;

      const updated: Task = {
        ...existing,
        ...action.patch,
        updatedAt: now,
      };

      // Set completedAt when transitioning to completed
      if (action.patch.status === "completed" && existing.status !== "completed") {
        updated.completedAt = now;
      }
      // Clear completedAt when transitioning away from completed
      if (action.patch.status && action.patch.status !== "completed" && existing.status === "completed") {
        updated.completedAt = undefined;
        delete updated.completedAt;
      }

      tasks.set(action.id, updated);
      return { tasks, order };
    }

    case "delete": {
      const existing = tasks.get(action.id);
      if (!existing) return board;

      const tombstone: Task = {
        ...existing,
        status: "deleted",
        deletedAt: now,
        updatedAt: now,
      };
      tasks.set(action.id, tombstone);
      return { tasks, order };
    }

    case "clear":
      return { tasks: new Map(), order: [] };
  }
}

// ─── Serialization ────────────────────────────────────────────────────────

export function serializeBoard(board: TaskBoard): string {
  const tasksArray = board.order
    .map((id) => board.tasks.get(id)!)
    .filter(Boolean);

  if (tasksArray.length === 0) return "No tasks.";

  return JSON.stringify(
    {
      tasks: tasksArray.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        blockedBy: t.blockedBy,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        completedAt: t.completedAt,
        deletedAt: t.deletedAt,
      })),
      order: [...board.order],
    },
    null,
    2,
  );
}

function isTodoTool(toolName: string): boolean {
  return toolName.startsWith("todo_");
}

function formatBoardForModel(board: TaskBoard): string {
  const allTasks = board.order.map((id) => board.tasks.get(id)!).filter(Boolean);

  const visible = allTasks.filter((t) => t.status !== "deleted");
  const deleted = allTasks.filter((t) => t.status === "deleted");

  if (visible.length === 0) return "Task board is empty.";

  const lines: string[] = [];
  const statusCounts = { pending: 0, in_progress: 0, completed: 0 };
  for (const t of visible) statusCounts[t.status as keyof typeof statusCounts]++;

  lines.push(
    `Tasks: ${visible.length} total (${statusCounts.pending} pending, ${statusCounts.in_progress} in progress, ${statusCounts.completed} done)`,
  );
  lines.push("");

  // Sort: in_progress first, then pending, then completed
  const priority: Record<TaskStatus, number> = { in_progress: 0, pending: 1, completed: 2, deleted: 3 };
  const sorted = [...visible].sort((a, b) => priority[a.status] - priority[b.status]);

  for (const task of sorted) {
    const statusIcon =
      task.status === "completed" ? "[x]" : task.status === "in_progress" ? "[>]" : "[ ]";
    const blocked = isBlocked(task, board.tasks) ? " BLOCKED" : "";
    const blockStr = task.blockedBy?.length
      ? ` (depends on: ${task.blockedBy.join(", ")})`
      : "";
    const idStr = task.id.length <= 10 ? task.id : task.id.slice(-8);
    lines.push(`  ${statusIcon} ${idStr} ${task.title}${blocked}${blockStr}`);
  }

  if (deleted.length > 0) {
    lines.push("");
    lines.push(`Deleted tasks (${deleted.length}):`);
    for (const t of deleted) {
      lines.push(`  [d] ${t.id} ${t.title}`);
    }
  }

  return lines.join("\n");
}

export function formatBoardForToolOutput(board: TaskBoard, actionResult: string): string {
  const boardJson = serializeBoard(board);
  return `${actionResult}\n\n${formatBoardForModel(board)}\n\n<!-- TODO_BOARD\n${boardJson}\nTODO_BOARD -->`;
}

// ─── Replay ───────────────────────────────────────────────────────────────

const BOARD_MARKER = "<!-- TODO_BOARD";
const BOARD_MARKER_END = "TODO_BOARD -->";

export function deserializeBoard(raw: string): TaskBoard | null {
  const start = raw.lastIndexOf(BOARD_MARKER);
  if (start === -1) return null;

  const afterMarker = raw.indexOf("\n", start + BOARD_MARKER.length);
  if (afterMarker === -1) return null;

  const end = raw.indexOf(BOARD_MARKER_END, afterMarker);
  if (end === -1) return null;

  const json = raw.slice(afterMarker + 1, end).trim();
  if (!json) return null;

  try {
    return parseBoardJson(json);
  } catch {
    return null;
  }
}

function parseBoardJson(json: string): TaskBoard | null {
  try {
    const raw = JSON.parse(json);
    if (!raw || !Array.isArray(raw.tasks)) return null;

    const tasks = new Map<string, Task>();
    for (const t of raw.tasks) {
      tasks.set(t.id, {
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        blockedBy: t.blockedBy ?? [],
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        completedAt: t.completedAt,
        deletedAt: t.deletedAt,
      });
    }

    const order: string[] = Array.isArray(raw.order)
      ? raw.order.filter((id: string) => tasks.has(id))
      : [...tasks.keys()];

    return { tasks, order };
  } catch {
    return null;
  }
}

interface TodoToolCall {
  toolName: string;
  input: unknown;
  output?: string;
}

export function loadBoardFromHistory(
  convId: string,
  toolCalls: TodoToolCall[],
): TaskBoard | null {
  // Walk in order — replay all actions to reconstruct state
  let board: TaskBoard = { tasks: new Map(), order: [] };

  // First, try last-write-wins from serialized output (fast path)
  const serializedBoards: { board: TaskBoard; index: number }[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    if (!isTodoTool(tc.toolName)) continue;

    if (tc.output && typeof tc.output === "string") {
      const board = deserializeBoard(tc.output);
      if (board) {
        serializedBoards.push({ board, index: i });
      }
    }
  }

  // Use the last serialized board (fast path)
  if (serializedBoards.length > 0) {
    const last = serializedBoards[serializedBoards.length - 1];
    board = last.board;

    // Replay any actions after the last serialized board (fallback)
    for (let i = last.index + 1; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      if (!isTodoTool(tc.toolName)) continue;
      board = replayAction(board, tc.toolName, tc.input);
    }
  } else {
    // No serialized boards — replay all actions from scratch
    for (const tc of toolCalls) {
      if (!isTodoTool(tc.toolName)) continue;
      board = replayAction(board, tc.toolName, tc.input);
    }
  }

  if (board.tasks.size === 0 && board.order.length === 0) return null;
  boards.set(convId, board);
  return board;
}

function replayAction(
  board: TaskBoard,
  toolName: string,
  input: unknown,
): TaskBoard {
  const params = (input ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case "todo_create": {
      const task: Task = {
        id: (params.id as string) || `replay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: (params.title as string) || "Untitled",
        description: params.description as string | undefined,
        status: "pending",
        blockedBy: (params.blockedBy as string[]) ?? [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return reduceBoard(board, { type: "create", task });
    }

    case "todo_update": {
      const id = params.id as string;
      if (!id) return board;
      return reduceBoard(board, {
        type: "update",
        id,
        patch: {
          title: params.title as string | undefined,
          description: params.description as string | undefined,
          status: params.status as TaskStatus | undefined,
          blockedBy: params.blockedBy as string[] | undefined,
        },
      });
    }

    case "todo_delete": {
      const id = params.id as string;
      if (!id) return board;
      return reduceBoard(board, { type: "delete", id });
    }

    case "todo_clear":
      return reduceBoard(board, { type: "clear" });

    default:
      return board;
  }
}
