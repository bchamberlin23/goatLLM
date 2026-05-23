import { useState, useEffect, useCallback } from "react";
import { useChatStore, type Artifact, type ArtifactKind } from "../stores/chat";
import { Code, FileCode, FileText, X, ChevronLeft, Copy, Columns } from "lucide-react";

const KIND_ICON: Record<ArtifactKind, typeof Code> = { html: FileCode, latex: FileText, python: Code };
const KIND_LABEL: Record<ArtifactKind, string> = { html: "HTML", latex: "LaTeX", python: "Python" };

// ── Rendered artifact content ──

function ArtifactContent({ artifact }: { artifact: Artifact }) {
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pyOutput, setPyOutput] = useState<string | null>(null);
  const [pyRunning, setPyRunning] = useState(false);
  const [pyError, setPyError] = useState<string | null>(null);
  const [viewCode, setViewCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPdfDataUrl(null); setPdfError(null);
    setPyOutput(null); setPyError(null);
    setViewCode(false);
  }, [artifact.id]);

  const handleRenderLatex = useCallback(async () => {
    if (pdfDataUrl) return;
    setPdfLoading(true); setPdfError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<string>("compile_latex", { content: artifact.code });
      setPdfDataUrl(result);
    } catch (e) { setPdfError(e instanceof Error ? e.message : String(e)); }
    finally { setPdfLoading(false); }
  }, [artifact.code, pdfDataUrl]);

  const handleRunPython = useCallback(async () => {
    if (pyOutput !== null) return;
    setPyRunning(true); setPyError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<string>("run_python", { code: artifact.code });
      setPyOutput(result);
    } catch (e) { setPyError(e instanceof Error ? e.message : String(e)); }
    finally { setPyRunning(false); }
  }, [artifact.code, pyOutput]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(artifact.code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }, [artifact.code]);

  if (viewCode) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0">
          <button onClick={() => setViewCode(false)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors">
            <Columns size={12} /> View preview
          </button>
          <div className="flex-1" />
          <button onClick={handleCopy} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors">
            <Copy size={12} /> {copied ? "Copied" : "Copy code"}
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <pre className="p-4 text-[13px] font-mono text-[#d5d5d5] whitespace-pre-wrap m-0"><code>{artifact.code}</code></pre>
        </div>
      </div>
    );
  }

  switch (artifact.kind) {
    case "html":
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0">
            <button onClick={() => setViewCode(true)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors">
              <Columns size={12} /> View code
            </button>
            <div className="flex-1" />
            <button onClick={handleCopy} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors">
              <Copy size={12} /> {copied ? "Copied" : "Copy code"}
            </button>
          </div>
          <iframe className="flex-1 w-full border-none bg-white" srcDoc={artifact.code} sandbox="allow-scripts allow-same-origin" title={artifact.title} />
        </div>
      );
    case "latex":
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0">
            <button onClick={() => setViewCode(true)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors">
              <Columns size={12} /> View code
            </button>
            <div className="flex-1" />
            <button onClick={handleCopy} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors">
              <Copy size={12} /> {copied ? "Copied" : "Copy code"}
            </button>
          </div>
          {!pdfDataUrl && !pdfLoading && (
            <div className="flex flex-col items-center justify-center gap-4 flex-1">
              <FileText size={28} strokeWidth={1.5} className="text-[#a0a0a0]" />
              <p className="text-[13px] text-[#8e8e8e] text-center max-w-[300px]">Compile this LaTeX document to preview the rendered PDF.</p>
              <button onClick={handleRenderLatex} className="px-4 py-2 rounded-lg bg-white text-black text-[13px] font-medium hover:bg-[#e5e5e5] transition-colors">Compile PDF</button>
            </div>
          )}
          {pdfLoading && <div className="flex items-center justify-center flex-1 text-[13px] text-[#8e8e8e]">Compiling…</div>}
          {pdfDataUrl && <iframe className="flex-1 w-full border-none" src={pdfDataUrl} title="PDF Preview" />}
          {pdfError && <div className="p-4 text-[12px] text-[#f87171] whitespace-pre-wrap">{pdfError}</div>}
        </div>
      );
    case "python":
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0">
            <button onClick={() => setViewCode(true)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors">
              <Columns size={12} /> View code
            </button>
            <div className="flex-1" />
            <button onClick={handleCopy} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors">
              <Copy size={12} /> {copied ? "Copied" : "Copy code"}
            </button>
          </div>
          <div className="flex flex-col flex-1">
            <div className="flex items-center justify-between px-4 py-2 bg-[#161618] shrink-0 border-b border-white/5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#a0a0a0]">Output</span>
              <button onClick={handleRunPython} disabled={pyRunning}
                className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${pyRunning ? "bg-white/5 text-[#a0a0a0]" : "bg-white text-black hover:bg-[#e5e5e5]"}`}>
                {pyRunning ? "Running…" : "Run"}
              </button>
            </div>
            {pyOutput !== null && <pre className="flex-1 p-4 text-[13px] font-mono text-[#d5d5d5] whitespace-pre-wrap overflow-auto m-0">{pyOutput}</pre>}
            {pyError && <div className="p-3 text-[12px] text-[#f87171] whitespace-pre-wrap border-t border-white/5">{pyError}</div>}
            {pyOutput === null && !pyRunning && !pyError && <p className="flex-1 flex items-center justify-center text-[12px] text-[#a0a0a0]">Click Run to execute.</p>}
          </div>
        </div>
      );
  }
}

// ── Full-view overlay ──

export function ArtifactPanel() {
  const activeId = useChatStore((s) => s.activeId);
  const artifacts = useChatStore((s) => (activeId ? s.artifacts[activeId] : undefined));
  const activeArtifactId = useChatStore((s) => s.activeArtifactId);
  const setActiveArtifact = useChatStore((s) => s.setActiveArtifact);
  const artifactPanelOpen = useChatStore((s) => s.artifactPanelOpen);

  if (!activeId || !artifacts || artifacts.length === 0 || !artifactPanelOpen) return null;

  const activeIdx = artifacts.findIndex((a) => a.id === activeArtifactId);
  const activeArtifact = activeIdx >= 0 ? artifacts[activeIdx] : artifacts[0];

  const handleClose = () => {
    setActiveArtifact(null);
  };

  const handlePrev = () => {
    if (activeIdx > 0) setActiveArtifact(artifacts[activeIdx - 1].id);
  };

  const handleNext = () => {
    if (activeIdx < artifacts.length - 1) setActiveArtifact(artifacts[activeIdx + 1].id);
  };

  const Icon = KIND_ICON[activeArtifact.kind];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1c1c1e] animate-[fadeIn_120ms_ease]">
      <div className="h-[32px] shrink-0" data-tauri-drag-region />
      {/* Top bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-white/5 shrink-0">
        <Icon size={13} strokeWidth={1.75} className="text-[#a0a0a0]" />
        <span className="text-[13px] font-medium text-[#ececec] truncate">{activeArtifact.title}</span>
        <span className="text-[10px] text-[#a0a0a0] bg-white/5 px-1.5 py-0.5 rounded">{KIND_LABEL[activeArtifact.kind]}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          <button onClick={handlePrev} disabled={activeIdx <= 0} aria-label="Previous artifact" className="p-1 rounded text-[#a0a0a0] hover:text-[#ececec] disabled:opacity-30 transition-colors">
            <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="text-[11px] text-[#a0a0a0] min-w-[32px] text-center" aria-live="polite">{activeIdx + 1}/{artifacts.length}</span>
          <button onClick={handleNext} disabled={activeIdx >= artifacts.length - 1} aria-label="Next artifact" className="p-1 rounded text-[#a0a0a0] hover:text-[#ececec] disabled:opacity-30 transition-colors">
            <ChevronLeft size={15} strokeWidth={2} className="rotate-180" aria-hidden="true" />
          </button>
        </div>
        <button onClick={handleClose} aria-label="Close artifact panel" className="p-1 rounded text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors ml-1">
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        <ArtifactContent artifact={activeArtifact} />
      </div>
    </div>
  );
}

// ── Inline card shown below assistant message ──

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const setActiveArtifact = useChatStore((s) => s.setActiveArtifact);
  const Icon = KIND_ICON[artifact.kind];

  return (
    <button
      onClick={() => setActiveArtifact(artifact.id)}
      className="flex items-center gap-3 w-full px-3 py-2.5 bg-[#212122] border border-white/5 rounded-xl hover:bg-[#252528] hover:border-white/10 transition-colors text-left group"
    >
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 group-hover:bg-white/10 transition-colors">
        <Icon size={15} strokeWidth={1.75} className="text-[#a0a0a0]" />
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[12px] font-medium text-[#d5d5d5] truncate">{artifact.title}</span>
        <span className="text-[11px] text-[#a0a0a0]">{KIND_LABEL[artifact.kind]}</span>
      </div>
      <span className="text-[11px] text-[#a0a0a0] group-hover:text-[#a0a0a0] transition-colors shrink-0">Open →</span>
    </button>
  );
}
