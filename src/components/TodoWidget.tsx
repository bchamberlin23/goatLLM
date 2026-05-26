import { useChatStore } from "../stores/chat";
import { useState, useEffect, useMemo } from "react";
import { CheckSquare } from "lucide-react";

export function TodoWidget() {
  const activeId = useChatStore((s) => s.activeId);
  const todoBoardUpdated = useChatStore((s) => s.todoBoardUpdated);
  const [board, setBoard] = useState<any>(null);
  const [boardEmpty, setBoardEmpty] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
      if (empty) setExpanded(false);
    });
  }, [activeId, todoBoardUpdated]);

  const visibleTasks = useMemo(() => {
    if (!board) return [];
    return board.order
      .map((id: string) => board.tasks.get(id))
      .filter((t: any) => t && t.status !== "deleted");
  }, [board]);

  if (!activeId || boardEmpty) return null;

  const completedCount = visibleTasks.filter((t: any) => t.status === "completed").length;
  const allDone = completedCount === visibleTasks.length;
  const inProgressCount = visibleTasks.filter((t: any) => t.status === "in_progress").length;

  return (
    <div className="fixed top-14 right-6 z-40 max-w-[320px] w-[280px] flex flex-col items-end">
      {/* Collapsed badge — always visible */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2a2a2d]/90 backdrop-blur-xl border border-white/[0.07] shadow-[0_4px_20px_rgba(0,0,0,0.3)] text-[12.5px] text-[#c9c9c9] hover:bg-[#323236] hover:text-[#ececec] transition-colors select-none"
        >
          <CheckSquare size={14} strokeWidth={1.75} className={allDone ? "text-[#4ade80]" : inProgressCount > 0 ? "text-[#f59e42]" : "text-[#888]"} />
          <span className="tabular-nums font-medium">
            {completedCount}/{visibleTasks.length}
          </span>
          <span className="text-[#888]">tasks</span>
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="rounded-xl bg-[#242426]/95 backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden animate-[fadeIn_160ms_ease] w-full">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-white/[0.05]">
            <CheckSquare
              size={15}
              strokeWidth={1.75}
              className={allDone ? "text-[#4ade80]" : inProgressCount > 0 ? "text-[#f59e42]" : "text-[#888]"}
            />
            <span className="text-[13px] font-medium text-[#ececec] flex-1">
              Tasks
            </span>
            <span className="text-[11.5px] text-[#888] tabular-nums">
              {completedCount}/{visibleTasks.length}
            </span>
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
          <div className="h-0.5 bg-white/[0.04]">
            <div
              className={`h-full transition-all duration-500 ${
                allDone ? "bg-[#4ade80]" : "bg-[#f59e42]"
              }`}
              style={{ width: `${(completedCount / visibleTasks.length) * 100}%` }}
            />
          </div>

          {/* Task list */}
          <div className="flex flex-col max-h-[320px] overflow-y-auto p-2 gap-0.5">
            {visibleTasks.map((task: any) => (
              <TaskRow key={task.id} task={task} board={board} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, board }: { task: any; board: any }) {
  const blocked = useMemo(() => {
    if (!task.blockedBy?.length) return false;
    return task.blockedBy.some((depId: string) => {
      const dep = board.tasks.get(depId);
      if (!dep) return true;
      if (dep.status === "deleted") return true;
      return dep.status !== "completed";
    });
  }, [task, board]);

  return (
    <div
      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] select-none transition-colors hover:bg-white/[0.04] ${
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
      <span
        className={`shrink-0 w-3.5 h-3.5 rounded-full border ${
          task.status === "completed"
            ? "bg-[#4ade80] border-[#4ade80]"
            : task.status === "in_progress"
              ? "bg-[#f59e42] border-[#f59e42] animate-pulse"
              : blocked
                ? "bg-transparent border-[#666]"
                : "bg-transparent border-[#888]"
        }`}
      />
      <span className="truncate flex-1 leading-snug">{task.title}</span>
      {task.blockedBy && task.blockedBy.length > 0 && (
        <span
          className="text-[10px] text-[#888] shrink-0 font-mono tabular-nums"
          title={`Blocked by: ${task.blockedBy.join(", ")}`}
        >
          x{task.blockedBy.length}
        </span>
      )}
    </div>
  );
}
