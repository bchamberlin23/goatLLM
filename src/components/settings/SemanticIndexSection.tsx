import { useState, useEffect, useCallback } from "react";
import { useChatStore } from "../../stores/chat";

export function SemanticIndexSection() {
  const workspacePath = useChatStore((s) => s.workspacePath);
  const ollamaUrl = useChatStore((s) => s.ollamaUrl);
  const setOllamaUrl = useChatStore((s) => s.setOllamaUrl);
  const embeddingModel = useChatStore((s) => s.embeddingModel);
  const setEmbeddingModel = useChatStore((s) => s.setEmbeddingModel);

  const [count, setCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; current?: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "indexing" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState(ollamaUrl);
  const [modelDraft, setModelDraft] = useState(embeddingModel);

  useEffect(() => { setUrlDraft(ollamaUrl); }, [ollamaUrl]);
  useEffect(() => { setModelDraft(embeddingModel); }, [embeddingModel]);

  const refreshCount = useCallback(async () => {
    if (!workspacePath) { setCount(null); return; }
    try {
      const { indexCount } = await import("../../lib/semantic-index");
      const n = await indexCount(workspacePath);
      setCount(n);
    } catch {
      setCount(null);
    }
  }, [workspacePath]);

  useEffect(() => { void refreshCount(); }, [refreshCount]);

  const handleIndex = useCallback(async () => {
    if (!workspacePath) return;
    setStatus("indexing");
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const { indexWorkspace } = await import("../../lib/semantic-index");
      const result = await indexWorkspace({
        workspace: workspacePath,
        ollamaUrl: urlDraft || undefined,
        model: modelDraft || undefined,
        onProgress: (p) => setProgress(p),
      });
      setStatus("done");
      setProgress({ done: result.chunksIndexed, total: result.chunksTotal });
      await refreshCount();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [workspacePath, urlDraft, modelDraft, refreshCount]);

  const handleClear = useCallback(async () => {
    if (!workspacePath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("embeddings_clear", { workspace: workspacePath });
      setStatus("idle");
      setProgress(null);
      await refreshCount();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [workspacePath, refreshCount]);

  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  if (!workspacePath) {
    return (
      <div className="p-3.5 bg-[#212122] border border-white/5 rounded-xl">
        <p className="text-[12.5px] text-[#a0a0a0]">Pick a workspace first to enable semantic indexing.</p>
      </div>
    );
  }

  return (
    <div className="p-3.5 bg-[#212122] border border-white/5 rounded-xl flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[13px] text-[#ececec]">
            {count === null ? "—" : count === 0 ? "Not indexed" : `${count.toLocaleString()} chunks indexed`}
          </span>
          <span className="text-[11px] text-[#a0a0a0] font-mono truncate">{workspacePath}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {count !== null && count > 0 && status !== "indexing" && (
            <button
              onClick={handleClear}
              className="px-2.5 py-1.5 text-[12px] font-medium text-[#a0a0a0] hover:text-[#f87171] hover:bg-red-500/10 rounded-md transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={handleIndex}
            disabled={status === "indexing"}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
              status === "indexing"
                ? "bg-white/5 text-[#a0a0a0]"
                : "bg-[#f59e42] text-black hover:bg-[#fbb968]"
            }`}
          >
            {status === "indexing" ? "Indexing…" : count && count > 0 ? "Reindex" : "Build index"}
          </button>
        </div>
      </div>

      {status === "indexing" && progress && (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#f59e42] transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-[#a0a0a0] font-mono">
            <span>{progress.done.toLocaleString()} / {progress.total.toLocaleString() || "?"}</span>
            {progress.current && <span className="truncate ml-2 max-w-[60%]">{progress.current}</span>}
          </div>
        </div>
      )}

      {status === "error" && error && (
        <div className="text-[12px] text-[#f87171] bg-red-500/5 border border-red-500/15 rounded-md p-2.5 whitespace-pre-wrap leading-relaxed">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-[#a0a0a0] w-[80px] shrink-0">Ollama URL</label>
          <input
            type="text"
            className="flex-1 h-[26px] px-2 bg-[#2c2c2e] border border-white/5 rounded text-[11px] text-[#ececec] font-mono outline-none focus:border-white/15"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={() => setOllamaUrl(urlDraft.trim() || "http://localhost:11434")}
            placeholder="http://localhost:11434"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-[#a0a0a0] w-[80px] shrink-0">Model</label>
          <input
            type="text"
            className="flex-1 h-[26px] px-2 bg-[#2c2c2e] border border-white/5 rounded text-[11px] text-[#ececec] font-mono outline-none focus:border-white/15"
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => setEmbeddingModel(modelDraft.trim() || "nomic-embed-text")}
            placeholder="nomic-embed-text"
          />
        </div>
        <p className="text-[11px] text-[#888] leading-relaxed">
          Run <span className="font-mono text-[#a0a0a0]">ollama pull {modelDraft || "nomic-embed-text"}</span> first if you haven't.
        </p>
      </div>
    </div>
  );
}
