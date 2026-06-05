import { invoke } from "@tauri-apps/api/core";
import { generateText } from "ai";
import {
  BookOpen,
  Plus,
  Code,
  Sparkles,
  Play,
  Loader2,
  Trash2,
  FileText,
} from "lucide-react";
import { useChatStore } from "../stores/chat";
import { createNotebookCell, type NotebookCell, type NotebookCellKind } from "../lib/product-workspace";
import { createModel } from "../lib/model-factory";

export function NotebookView() {
  const cells = useChatStore((s) => s.notebookCells);
  const setCells = useChatStore((s) => s.setNotebookCells);
  const updateCell = useChatStore((s) => s.updateNotebookCell);

  const addCell = (kind: NotebookCellKind) => {
    setCells([...useChatStore.getState().notebookCells, createNotebookCell(kind, "", Date.now())]);
  };

  const runCell = async (cell: NotebookCell) => {
    updateCell(cell.id, { status: "running", output: "" });
    try {
      if (cell.kind === "text") {
        updateCell(cell.id, { status: "done", output: cell.content });
        return;
      }
      if (cell.kind === "code") {
        const output = await invoke<string>("run_python", { code: cell.content });
        updateCell(cell.id, { status: "done", output });
        return;
      }
      // AI cell
      const cfg = useChatStore.getState().getActiveLlmConfig();
      if (!cfg) throw new Error("No configured model selected.");
      const model = await createModel(cfg);
      const result = await generateText({ model, prompt: cell.content, temperature: 0.2 });
      updateCell(cell.id, { status: "done", output: result.text });
    } catch (error) {
      updateCell(cell.id, { status: "error", output: error instanceof Error ? error.message : String(error) });
    }
  };

  const deleteCell = (cellId: string) => {
    setCells(useChatStore.getState().notebookCells.filter((c) => c.id !== cellId));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0a]">
      {/* Header */}
      <div className="shrink-0 border-b border-border/30 bg-[#0f0f0f] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
              <BookOpen size={16} className="text-accent" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-text-1">Notebook</h1>
              <p className="text-[11.5px] text-text-3">Interactive cells for experimentation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => addCell("text")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 bg-bg-hover hover:bg-bg-active text-text-2 text-[12px] font-medium transition-colors"
            >
              <FileText size={13} />
              Text
            </button>
            <button
              onClick={() => addCell("code")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 bg-bg-hover hover:bg-bg-active text-text-2 text-[12px] font-medium transition-colors"
            >
              <Code size={13} />
              Code
            </button>
            <button
              onClick={() => addCell("ai")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 bg-bg-hover hover:bg-bg-active text-text-2 text-[12px] font-medium transition-colors"
            >
              <Sparkles size={13} />
              AI
            </button>
          </div>
        </div>
      </div>

      {/* Cells */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {cells.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-accent/5 border border-accent/10 flex items-center justify-center mb-4">
              <BookOpen size={28} className="text-accent/50" />
            </div>
            <h3 className="text-[14px] font-medium text-text-1 mb-2">No cells yet</h3>
            <p className="text-[12px] text-text-3 max-w-[320px] mb-4">
              Add text, code, or AI cells to start building your notebook. Cells run independently and can be reordered.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => addCell("text")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/10 hover:bg-accent/20 text-accent text-[12px] font-medium transition-colors"
              >
                <Plus size={13} />
                Add first cell
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {cells.map((cell, index) => (
              <div
                key={cell.id}
                className="rounded-xl border border-border/40 bg-[#0f0f0f] overflow-hidden"
              >
                {/* Cell header */}
                <div className="flex items-center justify-between border-b border-border/30 px-4 py-2 bg-[#0a0a0a]">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-text-4">
                      [{index + 1}]
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">
                      {cell.kind}
                    </span>
                    {cell.status === "running" && (
                      <span className="flex items-center gap-1 text-[10px] text-accent">
                        <Loader2 size={10} className="animate-spin" />
                        Running
                      </span>
                    )}
                    {cell.status === "done" && (
                      <span className="text-[10px] text-green-500">✓ Done</span>
                    )}
                    {cell.status === "error" && (
                      <span className="text-[10px] text-red-500">✗ Error</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => runCell(cell)}
                      disabled={cell.status === "running"}
                      className="p-1 rounded hover:bg-bg-hover text-text-3 hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Run cell"
                    >
                      {cell.status === "running" ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => deleteCell(cell.id)}
                      className="p-1 rounded hover:bg-bg-hover text-text-3 hover:text-red-500 transition-colors"
                      title="Delete cell"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Cell content */}
                <div className="p-4">
                  <textarea
                    value={cell.content}
                    onChange={(e) => updateCell(cell.id, { content: e.target.value })}
                    placeholder={
                      cell.kind === "text"
                        ? "Write notes or documentation..."
                        : cell.kind === "code"
                        ? "Write Python code..."
                        : "Ask the AI a question..."
                    }
                    className="w-full min-h-[120px] bg-transparent border-0 resize-none text-[13px] text-text-1 placeholder:text-text-4 focus:outline-none font-mono"
                  />

                  {/* Output */}
                  {cell.output && (
                    <div className="mt-4 pt-4 border-t border-border/30">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-text-4 mb-2">
                        Output
                      </div>
                      <pre
                        className={`text-[12px] font-mono whitespace-pre-wrap ${
                          cell.status === "error" ? "text-red-500" : "text-text-2"
                        }`}
                      >
                        {cell.output}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
