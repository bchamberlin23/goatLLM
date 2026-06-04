import { useChatStore } from "../stores/chat";
import { useState, useEffect, useMemo, useRef } from "react";
import { CheckSquare, Pencil, Trash2, Plus } from "lucide-react";
import type { Task } from "../lib/tools/todo";

export function TodoWidget() {
  const activeId = useChatStore((s) => s.activeId);
  const todoBoardUpdated = useChatStore((s) => s.todoBoardUpdated);
  const manualTasksEnabled = useChatStore((s) => s.manualTasksEnabled);
  const updateManualTodoBoard = useChatStore((s) => s.updateManualTodoBoard);
  const isStreaming = useChatStore((s) =>
    s.activeId ? s.isConversationStreaming(s.activeId) : false,
  );
  const [board, setBoard] = useState<any>(null);
  const [boardEmpty, setBoardEmpty] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  useEffect(() => {
    if (!activeId) {
      setBoard(null);
      setBoardEmpty(false);
      setExpanded(false);
      return;
    }
    import("../lib/tools/todo").then((m) => {
      const b = m.getBoardForConversation(activeId);
      setBoard(b);
      const empty = b.tasks.size === 0;
      setBoardEmpty(empty);
      if (empty && !manualTasksEnabled) setExpanded(false);
    });
  }, [activeId, todoBoardUpdated, manualTasksEnabled]);

  const visibleTasks = useMemo(() => {
    if (!board) return [];
    return board.order
      .map((id: string) => board.tasks.get(id))
      .filter((t: any) => t && t.status !== "deleted");
  }, [board]);

  const completedCount = visibleTasks.filter((t: any) => t.status === "completed").length;
  const allDone = completedCount === visibleTasks.length;
  const inProgressCount = visibleTasks.filter((t: any) => t.status === "in_progress").length;

  // When every task is done and the agent turn has finished, clear the board
  // so a new todo_create batch doesn't stack under old completed rows.
  // Do not clear the board automatically if manual tasks is enabled.
  useEffect(() => {
    if (!activeId || visibleTasks.length === 0 || !allDone || isStreaming || manualTasksEnabled) return;
    let cancelled = false;
    import("../lib/tools/todo").then((m) => {
      if (cancelled) return;
      m.clearBoard(activeId);
      useChatStore.setState((s) => ({
        todoBoardUpdated: (s.todoBoardUpdated ?? 0) + 1,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, allDone, isStreaming, visibleTasks.length, manualTasksEnabled]);

  if (!activeId) return null;
  
  // Show widget if not empty, OR if manual tasks is enabled (which allows adding tasks to an empty board)
  const showWidget = !boardEmpty || manualTasksEnabled;
  if (!showWidget) return null;

  const handleAddTask = () => {
    if (newTaskTitle.trim() === "" || !board) return;
    const newId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newTask = {
      id: newId,
      title: newTaskTitle.trim(),
      status: "pending" as const,
      blockedBy: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const nextTasks = new Map<string, Task>(board.tasks);
    nextTasks.set(newId, newTask);
    const nextOrder = [...board.order, newId];
    updateManualTodoBoard(activeId, {
      tasks: nextTasks,
      order: nextOrder,
    });
    setNewTaskTitle("");
  };

  return (
    <div className="absolute top-3 left-0 w-full max-w-[860px] pointer-events-none flex justify-center z-40">
      <div className="pointer-events-auto max-w-[320px] w-[280px] flex flex-col items-center">
        {/* Collapsed badge — always visible */}
        {!expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2a2a2d]/90 backdrop-blur-xl border border-white/[0.07] shadow-[0_4px_20px_rgba(0,0,0,0.3)] text-[12.5px] text-[#c9c9c9] hover:bg-[#323236] hover:text-[#ececec] transition-colors select-none"
          >
            <CheckSquare size={14} strokeWidth={1.75} className={visibleTasks.length === 0 ? "text-[#888]" : allDone ? "text-[#4ade80]" : inProgressCount > 0 ? "text-[#f59e42]" : "text-[#888]"} />
            <span className="tabular-nums font-medium">
              {visibleTasks.length === 0 && !manualTasksEnabled ? "0/0" : visibleTasks.length === 0 ? "Tasks" : `${completedCount}/${visibleTasks.length}`}
            </span>
            <span className="text-[#888]">{visibleTasks.length === 0 && !manualTasksEnabled ? "tasks" : visibleTasks.length === 0 ? "(empty)" : "tasks"}</span>
          </button>
        )}

        {/* Expanded panel */}
        {expanded && (
          <div className="rounded-xl bg-[#242426]/95 backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden animate-[fadeIn_160ms_ease] w-full flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-white/[0.05]">
              <CheckSquare
                size={15}
                strokeWidth={1.75}
                className={visibleTasks.length === 0 ? "text-[#888]" : allDone ? "text-[#4ade80]" : inProgressCount > 0 ? "text-[#f59e42]" : "text-[#888]"}
              />
              <span className="text-[13px] font-medium text-[#ececec] flex-1">
                Tasks
              </span>
              {visibleTasks.length > 0 && (
                <span className="text-[11.5px] text-[#888] tabular-nums">
                  {completedCount}/{visibleTasks.length}
                </span>
              )}
              <button
                onClick={() => setExpanded(false)}
                className="p-0.5 rounded hover:bg-white/[0.06] text-[#888] hover:text-[#ececec] transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Progress bar */}
            {visibleTasks.length > 0 && (
              <div className="h-0.5 bg-white/[0.04]">
                <div
                  className={`h-full transition-all duration-500 ${
                    allDone ? "bg-[#4ade80]" : "bg-[#f59e42]"
                  }`}
                  style={{ width: `${(completedCount / visibleTasks.length) * 100}%` }}
                />
              </div>
            )}

            {/* Task list */}
            {visibleTasks.length > 0 ? (
              <div className="flex flex-col max-h-[260px] overflow-y-auto p-2 gap-0.5">
                {visibleTasks.map((task: any) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    board={board}
                    activeId={activeId}
                    manualTasksEnabled={manualTasksEnabled}
                    updateManualTodoBoard={updateManualTodoBoard}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-[#666] text-[12px] italic select-none">
                No tasks created yet.
              </div>
            )}

            {/* Add Task input at bottom */}
            {manualTasksEnabled && (
              <div className="border-t border-white/[0.05] p-2 bg-white/[0.01]">
                <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1 focus-within:border-white/[0.15] focus-within:bg-white/[0.06] transition-all">
                  <input
                    type="text"
                    placeholder="Add a task..."
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddTask();
                    }}
                    className="flex-1 bg-transparent border-0 p-0 text-[12px] text-[#ececec] placeholder-[#666] focus:outline-none focus:ring-0 h-6"
                  />
                  <button
                    onClick={handleAddTask}
                    disabled={!newTaskTitle.trim()}
                    className="p-0.5 rounded text-[#888] hover:text-[#ececec] disabled:opacity-20 disabled:hover:text-[#888] transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  board,
  activeId,
  manualTasksEnabled,
  updateManualTodoBoard,
}: {
  task: any;
  board: any;
  activeId: string;
  manualTasksEnabled: boolean;
  updateManualTodoBoard: any;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditTitle(task.title);
  }, [task.title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const blocked = useMemo(() => {
    if (!task.blockedBy?.length) return false;
    return task.blockedBy.some((depId: string) => {
      const dep = board.tasks.get(depId);
      if (!dep) return true;
      if (dep.status === "deleted") return true;
      return dep.status !== "completed";
    });
  }, [task, board]);

  const handleToggleStatus = () => {
    if (!manualTasksEnabled) return;
    const nextStatus = task.status === "completed" ? "pending" : "completed";
    const nextTasks = new Map<string, Task>(board.tasks);
    const updatedTask = {
      ...task,
      status: nextStatus,
      updatedAt: Date.now(),
    };
    if (nextStatus === "completed") {
      updatedTask.completedAt = Date.now();
    } else {
      delete updatedTask.completedAt;
    }
    nextTasks.set(task.id, updatedTask);
    updateManualTodoBoard(activeId, {
      ...board,
      tasks: nextTasks,
    });
  };

  const handleSave = () => {
    if (editTitle.trim() === "") {
      setIsEditing(false);
      setEditTitle(task.title);
      return;
    }
    if (editTitle.trim() === task.title) {
      setIsEditing(false);
      return;
    }
    const nextTasks = new Map<string, Task>(board.tasks);
    const updatedTask = {
      ...task,
      title: editTitle.trim(),
      updatedAt: Date.now(),
    };
    nextTasks.set(task.id, updatedTask);
    updateManualTodoBoard(activeId, {
      ...board,
      tasks: nextTasks,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(task.title);
    setIsEditing(false);
  };

  const handleDelete = () => {
    const nextTasks = new Map<string, Task>(board.tasks);
    const updatedTask = {
      ...task,
      status: "deleted",
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    };
    nextTasks.set(task.id, updatedTask);
    updateManualTodoBoard(activeId, {
      ...board,
      tasks: nextTasks,
    });
  };

  return (
    <div
      className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] select-none transition-colors hover:bg-white/[0.04] ${
        task.status === "completed"
          ? "text-[#666] line-through"
          : task.status === "in_progress"
            ? "text-[#f59e42]"
            : blocked
              ? "text-[#888] opacity-70"
              : "text-[#c9c9c9]"
      }`}
      title={task.title}
    >
      <button
        disabled={!manualTasksEnabled}
        onClick={handleToggleStatus}
        aria-label="Toggle completion status"
        className={`shrink-0 w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all bg-transparent focus:outline-none ${
          manualTasksEnabled
            ? "cursor-pointer hover:border-white/[0.4] active:scale-95"
            : ""
        } ${
          task.status === "completed"
            ? "bg-[#4ade80] border-[#4ade80]"
            : task.status === "in_progress"
              ? "bg-[#f59e42] border-[#f59e42] animate-pulse"
              : blocked
                ? "border-[#666]"
                : "border-[#888]"
        }`}
      >
        {task.status === "completed" && (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          className="flex-1 bg-white/[0.06] border border-white/[0.12] rounded px-1.5 py-0.5 text-[12.5px] text-[#ececec] focus:outline-none focus:border-white/[0.2] focus:ring-0"
        />
      ) : (
        <span
          className={`truncate flex-1 leading-snug ${manualTasksEnabled ? "cursor-pointer" : ""}`}
          onDoubleClick={() => manualTasksEnabled && setIsEditing(true)}
        >
          {task.title}
        </span>
      )}

      {/* Action buttons (only in manual mode) */}
      {manualTasksEnabled && !isEditing && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1 rounded hover:bg-white/[0.06] text-[#888] hover:text-[#ececec] transition-colors"
            title="Edit task title"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1 rounded hover:bg-red-500/10 text-[#888] hover:text-[#ff5555] transition-colors"
            title="Delete task"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}

      {task.blockedBy && task.blockedBy.length > 0 && !isEditing && (
        <span
          className="text-[10px] text-[#888] shrink-0 font-mono tabular-nums group-hover:hidden"
          title={`Blocked by: ${task.blockedBy.join(", ")}`}
        >
          x{task.blockedBy.length}
        </span>
      )}
    </div>
  );
}
