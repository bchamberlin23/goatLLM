import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useChatStore, type Artifact, type ArtifactKind } from "../stores/chat";
import { CritiqueButton } from "./design/CritiqueButton";
import { ManualEditPanel } from "./design/ManualEditPanel";
import { WorkspaceFileBrowser } from "./WorkspaceFileBrowser";
import {
  Code,
  FileCode,
  FileText,
  FileType,
  Presentation,
  FileSpreadsheet,
  X,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Printer,
  RotateCw,
  Undo2,
  Redo2,
  History,
} from "lucide-react";
import {
  renderDocxPreview,
  renderPptxPreview,
  renderXlsxPreview,
  exportDocxBlob,
  exportPptxBlob,
  exportXlsxBlob,
  officeFilename,
  officeMimeType,
} from "../lib/office-artifacts";
import { resolveArtifactReferences } from "../lib/artifact-resolver";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.default })),
);

const ARTIFACT_LANG: Record<ArtifactKind, string> = {
  html: "html",
  latex: "plaintext",
  python: "python",
  // The office kinds are authored as Markdown (with table extensions), so we
  // give Monaco the markdown grammar — gets us list/heading/table coloring
  // for free.
  docx: "markdown",
  pptx: "markdown",
  xlsx: "markdown",
  // New artifact kinds
  deck: "html",
  "react-component": "typescript",
  "markdown-document": "markdown",
  svg: "xml",
  diagram: "plaintext",
  "code-snippet": "plaintext",
  "mini-app": "html",
  "design-system": "markdown",
};

const KIND_ICON: Record<ArtifactKind, typeof Code> = {
  html: FileCode,
  latex: FileText,
  python: Code,
  docx: FileType,
  pptx: Presentation,
  xlsx: FileSpreadsheet,
  deck: Presentation,
  "react-component": Code,
  "markdown-document": FileText,
  svg: FileCode,
  diagram: FileCode,
  "code-snippet": Code,
  "mini-app": FileCode,
  "design-system": FileText,
};
const KIND_LABEL: Record<ArtifactKind, string> = {
  html: "HTML",
  latex: "LaTeX",
  python: "Python",
  docx: "Word",
  pptx: "Slides",
  xlsx: "Excel",
  deck: "Deck",
  "react-component": "React",
  "markdown-document": "Markdown",
  svg: "SVG",
  diagram: "Diagram",
  "code-snippet": "Code",
  "mini-app": "App",
  "design-system": "Design System",
};

const OFFICE_KINDS = new Set<ArtifactKind>(["docx", "pptx", "xlsx"]);

// ── Rendered artifact content ──

function ArtifactContent({
  artifact,
  view,
  previewKey,
}: {
  artifact: Artifact;
  view: "preview" | "code";
  /** Bumps when preview should reload (manual refresh or code change). */
  previewKey: number;
}) {
  const activeId = useChatStore((s) => s.activeId);
  const updateArtifact = useChatStore((s) => s.updateArtifact);
  const workspacePath = useChatStore((s) =>
    s.designMode ? s.designWorkspacePath : s.workspacePath
  );
  const editorRef = useRef<any>(null);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pyOutput, setPyOutput] = useState<string | null>(null);
  const [pyRunning, setPyRunning] = useState(false);
  const [pyError, setPyError] = useState<string | null>(null);
  const [officeHtml, setOfficeHtml] = useState<string | null>(null);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(null);
  const [resolvingHtml, setResolvingHtml] = useState(false);

  useEffect(() => {
    setPdfDataUrl(null); setPdfError(null);
    setPyOutput(null); setPyError(null);
    setOfficeHtml(null); setOfficeError(null);
    setResolvedHtml(null); setResolvingHtml(false);
    autoFollowRef.current = true;
  }, [artifact.id]);

  // Render the Office preview HTML whenever the source changes. All three
  // formats share the same iframe slot — we just swap the body.
  useEffect(() => {
    if (!OFFICE_KINDS.has(artifact.kind)) return;
    let cancelled = false;
    (async () => {
      try {
        let html: string;
        if (artifact.kind === "docx") {
          html = await renderDocxPreview(artifact.code, artifact.title);
        } else if (artifact.kind === "pptx") {
          html = renderPptxPreview(artifact.code, artifact.title);
        } else {
          html = renderXlsxPreview(artifact.code, artifact.title);
        }
        if (!cancelled) setOfficeHtml(html);
      } catch (e) {
        if (!cancelled) setOfficeError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [artifact.id, artifact.kind, artifact.code, artifact.title]);

  // Resolve external file references (CSS, JS, images) for HTML-like artifacts.
  // This inlines referenced files so the preview works without a web server.
  const HTML_LIKE_KINDS = new Set(["html", "deck", "mini-app"]);
  useEffect(() => {
    if (!HTML_LIKE_KINDS.has(artifact.kind)) return;
    let cancelled = false;
    setResolvingHtml(true);
    setResolvedHtml(null);

    // Build a pseudo-path for the artifact to resolve relative references
    const ext = artifact.kind === "html" ? "html" : "html";
    const artifactPath = artifact.title
      ? `${artifact.title.toLowerCase().replace(/[^\w.-]+/g, "-")}.${ext}`
      : `index.${ext}`;

    (async () => {
      try {
        const processed = await resolveArtifactReferences(
          artifact.code,
          artifactPath,
          workspacePath,
        );
        if (!cancelled) setResolvedHtml(processed);
      } catch (e) {
        // Fall back to original HTML on error
        console.warn("[ArtifactPanel] HTML resolution failed:", e);
        if (!cancelled) setResolvedHtml(artifact.code);
      } finally {
        if (!cancelled) setResolvingHtml(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artifact.id, artifact.kind, artifact.code, workspacePath]);

  // Auto-compile LaTeX whenever the code or active version changes.
  useEffect(() => {
    if (artifact.kind !== "latex") return;
    let cancelled = false;
    setPdfLoading(true); setPdfError(null);
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<string>("compile_latex", { content: artifact.code });
        if (!cancelled) setPdfDataUrl(result);
      } catch (e) {
        if (!cancelled) setPdfError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artifact.id, artifact.kind, artifact.code, previewKey]);

  const handleRunPython = useCallback(async () => {
    if (pyRunning) return;
    setPyRunning(true); setPyError(null); setPyOutput(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<string>("run_python", { code: artifact.code });
      setPyOutput(result);
    } catch (e) { setPyError(e instanceof Error ? e.message : String(e)); }
    finally { setPyRunning(false); }
  }, [artifact.code, pyRunning]);

  // Auto-scroll Monaco to the bottom while streaming — follows code
  // generation without requiring the user to chase the cursor. Breaks
  // smoothly when the user scrolls away. Re-engages on next streaming
  // artifact switch.
  const wasStreamingRef = useRef(false);
  const autoFollowRef = useRef(true);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const isNow = artifact.versions?.[
      artifact.activeVersionIndex ?? (artifact.versions?.length ?? 1) - 1
    ]?.streaming;
    if (isNow && autoFollowRef.current) {
      // Scroll the editor to the last line without moving the cursor.
      const model = editor.getModel();
      if (model) {
        const lastLine = model.getLineCount();
        editor.revealLine(lastLine, 1); // 1 = smooth
      }
    }
    // User scrolled away mid-stream? Detect and disable auto-follow.
    if (wasStreamingRef.current && !isNow) {
      autoFollowRef.current = true; // reset for next streaming session
    }
    wasStreamingRef.current = !!isNow;
  }, [artifact.code, artifact.id]);

  if (view === "code") {
    const handleEditorChange = (value: string | undefined) => {
      if (value === undefined || !activeId) return;
      updateArtifact(activeId, artifact.id, value);
    };
    const handleEditorMount = (editor: any) => {
      editorRef.current = editor;
      editor.onDidScrollChange(() => {
        // If the editor viewport is near the bottom, stay in auto-follow
        // mode; otherwise the user has scrolled away — pause following.
        const model = editor.getModel();
        if (!model) return;
        const visibleRanges = editor.getVisibleRanges();
        if (visibleRanges.length === 0) return;
        const lastVisible = visibleRanges[visibleRanges.length - 1];
        const distFromBottom = model.getLineCount() - lastVisible.endLineNumber;
        autoFollowRef.current = distFromBottom <= 2;
      });
    };

    return (
      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-[12px] text-[#a0a0a0]">
              Loading editor…
            </div>
          }
        >
          <MonacoEditor
            height="100%"
            defaultLanguage={ARTIFACT_LANG[artifact.kind]}
            language={ARTIFACT_LANG[artifact.kind]}
            value={artifact.code}
            theme="vs-dark"
            onMount={handleEditorMount}
            onChange={handleEditorChange}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              automaticLayout: true,
              renderLineHighlight: "line",
              lineNumbers: "on",
              smoothScrolling: true,
              cursorSmoothCaretAnimation: "on",
              padding: { top: 12, bottom: 12 },
            }}
          />
        </Suspense>
      </div>
    );
  }

  switch (artifact.kind) {
    case "html": {
      // Design-mode artifacts use a stricter sandbox by default — the model
      // generates arbitrary HTML and we don't auto-execute scripts. Users
      // can toggle scripts on via a small control in the panel footer.
      const isDesignArtifact = useChatStore.getState().designMode;
      const sandboxAttr = isDesignArtifact
        ? "allow-same-origin allow-popups"
        : "allow-scripts allow-same-origin allow-popups";

      // Use resolved HTML if available, otherwise show loading or original
      const htmlToRender = resolvedHtml ?? artifact.code;

      // Inject <base target="_blank"> so links open externally instead of
      // navigating the iframe to a goatLLM instance. A click-interception
      // script is also injected as a belt-and-suspenders measure when
      // scripts are enabled.
      const baseInjection = '<base target="_blank">\n';
      const clickScript =
        `<script>document.addEventListener('click',function(e){var a=e.target.closest('a');` +
        `if(a&&a.getAttribute('href')&&!/^(javascript:|#)/.test(a.getAttribute('href')||''))` +
        `{e.preventDefault();e.stopPropagation();window.open(a.href,'_blank','noopener,noreferrer')}},!0)</script>`;

      const preppedHtml = isDesignArtifact
        ? baseInjection + htmlToRender
        : baseInjection + htmlToRender + clickScript;

      // Show loading indicator while resolving external references
      if (resolvingHtml) {
        return (
          <div className="flex-1 relative">
            <div className="absolute inset-0 flex items-center justify-center bg-[#1c1c1e]/80 z-10">
              <div className="flex flex-col items-center gap-2 text-[#a0a0a0]">
                <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-[#f59e42] animate-spin" />
                <span className="text-[11px]">Resolving references…</span>
              </div>
            </div>
            <iframe
              key={`html-${previewKey}`}
              className="flex-1 w-full border-none bg-white"
              srcDoc={preppedHtml}
              sandbox={sandboxAttr}
              title={artifact.title}
            />
          </div>
        );
      }

      return (
        <iframe
          key={`html-${previewKey}`}
          className="flex-1 w-full border-none bg-white"
          srcDoc={preppedHtml}
          sandbox={sandboxAttr}
          title={artifact.title}
        />
      );
    }
    case "latex":
      return (
        <>
          {pdfLoading && (
            <div className="flex flex-col items-center justify-center gap-3 flex-1 text-[#a0a0a0]">
              <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[#f59e42] animate-spin" />
              <span className="text-[12.5px]">Compiling…</span>
              <span className="text-[11px] text-[#888888]">First run downloads the LaTeX engine ({String.fromCharCode(0x007e)}30 MB)</span>
            </div>
          )}
          {pdfDataUrl && (
            <iframe
              key={`latex-pdf-${previewKey}`}
              className="flex-1 w-full border-none"
              src={pdfDataUrl}
              title="PDF Preview"
            />
          )}
          {pdfError && (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-[12px] text-[#f87171] whitespace-pre-wrap leading-relaxed">{pdfError}</p>
            </div>
          )}
        </>
      );
    case "python":
      return (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between px-4 py-2 bg-[#161618] shrink-0 border-b border-white/5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#a0a0a0]">Output</span>
            <button
              onClick={handleRunPython}
              disabled={pyRunning}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${pyRunning ? "control-pill opacity-70" : "primary-action"}`}
            >
              {pyRunning ? "Running…" : "Run"}
            </button>
          </div>
          {pyOutput !== null && <pre className="flex-1 p-4 text-[13px] font-mono text-[#d5d5d5] whitespace-pre-wrap overflow-auto m-0">{pyOutput}</pre>}
          {pyError && <div className="p-3 text-[12px] text-[#f87171] whitespace-pre-wrap border-t border-white/5">{pyError}</div>}
          {pyOutput === null && !pyRunning && !pyError && <p className="flex-1 flex items-center justify-center text-[12px] text-[#a0a0a0]">Click Run to execute.</p>}
        </div>
      );
    case "docx":
    case "pptx":
    case "xlsx":
      if (officeError) {
        return (
          <div className="flex flex-col gap-2 p-4">
            <p className="text-[12px] text-[#f87171] whitespace-pre-wrap leading-relaxed">{officeError}</p>
          </div>
        );
      }
      if (!officeHtml) {
        return (
          <div className="flex flex-col items-center justify-center gap-3 flex-1 text-[#a0a0a0]">
            <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[#f59e42] animate-spin" />
            <span className="text-[12.5px]">Rendering preview…</span>
          </div>
        );
      }
      return (
        <iframe
          key={`office-${artifact.id}-${previewKey}`}
          className="flex-1 w-full border-none"
          srcDoc={officeHtml}
          sandbox="allow-scripts"
          title={artifact.title}
        />
      );
    case "deck":
    case "mini-app": {
      // Deck and mini-app render as HTML with scripts enabled
      // Use resolved HTML if available for these kinds too
      const htmlToRender = resolvedHtml ?? artifact.code;
      const baseInjection = '<base target="_blank">\n';
      const preppedHtml = baseInjection + htmlToRender;

      if (resolvingHtml) {
        return (
          <div className="flex-1 relative">
            <div className="absolute inset-0 flex items-center justify-center bg-[#1c1c1e]/80 z-10">
              <div className="flex flex-col items-center gap-2 text-[#a0a0a0]">
                <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-[#f59e42] animate-spin" />
                <span className="text-[11px]">Resolving references…</span>
              </div>
            </div>
            <iframe
              key={`deck-${previewKey}`}
              className="flex-1 w-full border-none bg-white"
              srcDoc={preppedHtml}
              sandbox="allow-scripts allow-same-origin allow-popups"
              title={artifact.title}
            />
          </div>
        );
      }

      return (
        <iframe
          key={`deck-${previewKey}`}
          className="flex-1 w-full border-none bg-white"
          srcDoc={preppedHtml}
          sandbox="allow-scripts allow-same-origin allow-popups"
          title={artifact.title}
        />
      );
    }
    case "svg": {
      // Render SVG directly in an iframe
      const svgHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff; }
    svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>${artifact.code}</body>
</html>`;
      return (
        <iframe
          key={`preview-${previewKey}`}
          className="flex-1 w-full border-none bg-white"
          srcDoc={svgHtml}
          sandbox=""
          title={artifact.title}
        />
      );
    }
    case "markdown-document":
    case "design-system": {
      // Render markdown as HTML
      const markdownHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { 
      margin: 0; 
      padding: 32px; 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
    }
    h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
    h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    code { background: rgba(27,31,35,0.05); padding: 0.2em 0.4em; border-radius: 3px; font-size: 85%; }
    pre { background: #f6f8fa; padding: 16px; overflow: auto; font-size: 85%; line-height: 1.45; border-radius: 3px; }
    pre code { background: transparent; padding: 0; }
    blockquote { margin: 0; padding: 0 1em; color: #6a737d; border-left: 0.25em solid #dfe2e5; }
    table { border-spacing: 0; border-collapse: collapse; margin-top: 0; margin-bottom: 16px; }
    table th, table td { padding: 6px 13px; border: 1px solid #dfe2e5; }
    table th { font-weight: 600; background: #f6f8fa; }
  </style>
</head>
<body>
  <div id="content"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    const md = ${JSON.stringify(artifact.code)};
    document.getElementById('content').innerHTML = marked.parse(md);
  </script>
</body>
</html>`;
      return (
        <iframe
          key={`preview-${previewKey}`}
          className="flex-1 w-full border-none bg-white"
          srcDoc={markdownHtml}
          sandbox=""
          title={artifact.title}
        />
      );
    }
    case "react-component":
    case "diagram":
    case "code-snippet": {
      // These kinds are primarily viewed in code mode
      return (
        <div className="flex flex-col items-center justify-center flex-1 text-[#a0a0a0] p-8">
          <Code size={48} strokeWidth={1.5} className="mb-4 text-[#666]" />
          <p className="text-[13px] text-center mb-2">
            {artifact.kind === "react-component" && "React components are best viewed in code mode."}
            {artifact.kind === "diagram" && "Diagrams are best viewed in code mode."}
            {artifact.kind === "code-snippet" && "Code snippets are best viewed in code mode."}
          </p>
          <p className="text-[11px] text-[#666] text-center">
            Switch to Code view to see the full source.
          </p>
        </div>
      );
    }
  }
}

// ── Header pill: Code | Preview ──

function ViewToggle({
  view,
  onChange,
}: {
  view: "preview" | "code";
  onChange: (v: "preview" | "code") => void;
}) {
  return (
    <div className="segmented-shell flex items-center gap-0.5 p-0.5 rounded-full">
      <button
        onClick={() => onChange("code")}
        aria-pressed={view === "code"}
        className={`px-2.5 py-0.5 text-[11.5px] font-medium rounded-full transition-colors ${
          view === "code" ? "bg-accent/10 text-[#ececec] border border-accent/20" : "text-[#a0a0a0] border border-transparent hover:text-[#ececec] hover:bg-white/[0.055]"
        }`}
      >
        Code
      </button>
      <button
        onClick={() => onChange("preview")}
        aria-pressed={view === "preview"}
        className={`px-2.5 py-0.5 text-[11.5px] font-medium rounded-full transition-colors ${
          view === "preview" ? "bg-accent/10 text-[#ececec] border border-accent/20" : "text-[#a0a0a0] border border-transparent hover:text-[#ececec] hover:bg-white/[0.055]"
        }`}
      >
        Preview
      </button>
    </div>
  );
}

// ── History dropdown ──

function HistoryMenu({
  artifact,
  conversationId,
  onClose,
}: {
  artifact: Artifact;
  conversationId: string;
  onClose: () => void;
}) {
  const restore = useChatStore((s) => s.restoreArtifactVersion);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // The iframe (HTML preview, LaTeX PDF) eats clicks — they never bubble
    // to document, so a mousedown listener alone misses them. Window blur
    // fires when an iframe takes focus, so we use it as the iframe-aware
    // outside-click signal.
    const onBlur = () => {
      // Defer one tick: blur fires before document.activeElement updates.
      setTimeout(() => {
        if (document.activeElement?.tagName === "IFRAME") onClose();
      }, 0);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  const versions = artifact.versions ?? [];
  const activeIdx = artifact.activeVersionIndex ?? versions.length - 1;

  const fmt = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div
      ref={ref}
      className="popover-surface absolute top-full right-0 mt-1.5 w-[280px] max-h-[400px] overflow-y-auto rounded-xl z-50 animate-[fadeIn_100ms_ease]"
    >
      <div className="px-3 py-2 border-b border-white/5 sticky top-0 bg-[#2a2a2c]/90 backdrop-blur-md">
        <span className="text-[10.5px] uppercase tracking-wider text-[#8e8e8e] font-semibold">
          Version history
        </span>
      </div>
      <div className="p-1">
        {versions.length === 0 && (
          <p className="text-[12px] text-[#a0a0a0] px-3 py-3">No history yet.</p>
        )}
        {[...versions].map((_, idxAsc) => {
          // Show newest first.
          const i = versions.length - 1 - idxAsc;
          const ver = versions[i];
          const isActive = i === activeIdx;
          return (
            <button
              key={i}
              onClick={() => {
                restore(conversationId, artifact.id, i);
                onClose();
              }}
              className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left transition-colors ${
                isActive ? "bg-[#f59e42]/10" : "hover:bg-white/[0.06]"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                ver.source === "agent" ? "bg-[#60a5fa]" : "bg-[#f59e42]"
              }`} />
              <div className="flex flex-col min-w-0 flex-1">
                <span className={`text-[12px] truncate ${isActive ? "text-[#f59e42]" : "text-[#d5d5d5]"}`}>
                  {ver.source === "agent" ? "Agent" : "You"}
                  {ver.restoredFrom !== undefined && ` (restored)`}
                  {i === versions.length - 1 ? " — latest" : ""}
                </span>
                <span className="text-[10.5px] text-[#888]">{fmt(ver.createdAt)}</span>
              </div>
              {isActive && <span className="text-[10px] text-[#f59e42] shrink-0">current</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Workspace file preview renderer ──

function renderWorkspacePreview(
  wsFile: { path: string; name: string; content: string },
  resolvedContent: string | null,
) {
  const content = resolvedContent ?? wsFile.content;
  const ext = wsFile.name.split(".").pop()?.toLowerCase() || "";

  if (["html", "htm"].includes(ext)) {
    // HTML - render with scripts enabled
    return (
      <iframe
        key={`${wsFile.path}-${content.length}`}
        className="flex-1 w-full border-none bg-white"
        srcDoc={`<base target="_blank">\n${content}`}
        sandbox="allow-scripts allow-same-origin allow-popups"
        title={wsFile.name}
      />
    );
  }

  if (ext === "svg") {
    // SVG - render in a wrapper HTML
    const svgHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff; }
    svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>${content}</body>
</html>`;
    return (
      <iframe
        key={`${wsFile.path}-${content.length}`}
        className="flex-1 w-full border-none bg-white"
        srcDoc={svgHtml}
        sandbox=""
        title={wsFile.name}
      />
    );
  }

  if (["md", "markdown"].includes(ext)) {
    // Markdown - render as HTML
    const markdownHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 32px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
    }
    h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
    h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    code { background: rgba(27,31,35,0.05); padding: 0.2em 0.4em; border-radius: 3px; font-size: 85%; }
    pre { background: #f6f8fa; padding: 16px; overflow: auto; font-size: 85%; line-height: 1.45; border-radius: 3px; }
    pre code { background: transparent; padding: 0; }
    blockquote { margin: 0; padding: 0 1em; color: #6a737d; border-left: 0.25em solid #dfe2e5; }
    table { border-spacing: 0; border-collapse: collapse; margin-top: 0; margin-bottom: 16px; }
    table th, table td { padding: 6px 13px; border: 1px solid #dfe2e5; }
    table th { font-weight: 600; background: #f6f8fa; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  <div id="content"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    const md = ${JSON.stringify(content)};
    document.getElementById('content').innerHTML = marked.parse(md);
  </script>
</body>
</html>`;
    return (
      <iframe
        key={`${wsFile.path}-${content.length}`}
        className="flex-1 w-full border-none bg-white"
        srcDoc={markdownHtml}
        sandbox=""
        title={wsFile.name}
      />
    );
  }

  if (ext === "css") {
    // CSS - show a preview by applying styles to sample HTML
    const cssPreviewHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      background: #f5f5f5;
    }
    .preview-section {
      background: white;
      padding: 20px;
      margin-bottom: 16px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .preview-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #888;
      margin-bottom: 12px;
    }
  </style>
  <style id="user-css">${content}</style>
</head>
<body>
  <div class="preview-section">
    <div class="preview-label">Typography</div>
    <h1>Heading 1</h1>
    <h2>Heading 2</h2>
    <h3>Heading 3</h3>
    <p>Paragraph text with <strong>bold</strong> and <em>italic</em> styles. <a href="#">Link example</a></p>
  </div>
  <div class="preview-section">
    <div class="preview-label">Lists</div>
    <ul>
      <li>Unordered list item</li>
      <li>Another item</li>
    </ul>
    <ol>
      <li>Ordered list item</li>
      <li>Another item</li>
    </ol>
  </div>
  <div class="preview-section">
    <div class="preview-label">Buttons & Forms</div>
    <button>Button</button>
    <input type="text" placeholder="Input field">
    <select><option>Select</option></select>
  </div>
  <div class="preview-section">
    <div class="preview-label">Table</div>
    <table>
      <thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>
      <tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody>
    </table>
  </div>
  <div class="preview-section">
    <div class="preview-label">Custom Elements</div>
    <div class="card">Card example</div>
    <div class="container">Container example</div>
    <div class="box">Box example</div>
  </div>
</body>
</html>`;
    return (
      <iframe
        key={`${wsFile.path}-${content.length}`}
        className="flex-1 w-full border-none"
        srcDoc={cssPreviewHtml}
        sandbox=""
        title={wsFile.name}
      />
    );
  }

  // Fallback - should not reach here
  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[#161618]">
      <pre className="p-4 text-[12.5px] leading-relaxed text-[#b4b4b4] whitespace-pre-wrap break-words font-mono">
        {content}
      </pre>
    </div>
  );
}

// ── Full panel ──

export function ArtifactPanel() {
  const activeId = useChatStore((s) => s.activeId);
  const artifacts = useChatStore((s) => (activeId ? s.artifacts[activeId] : undefined));
  const activeArtifactId = useChatStore((s) => s.activeArtifactId);
  const setActiveArtifact = useChatStore((s) => s.setActiveArtifact);
  const artifactPanelOpen = useChatStore((s) => s.artifactPanelOpen);
  const undoArtifact = useChatStore((s) => s.undoArtifact);
  const redoArtifact = useChatStore((s) => s.redoArtifact);
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const workspacePath = useChatStore((s) =>
    s.designMode ? s.designWorkspacePath : s.workspacePath
  );

  const [view, setView] = useState<"preview" | "code">("preview");
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [manualEditOpen, setManualEditOpen] = useState(false);
  // Workspace file browser state — lives in the store so the sidebar can open files too.
  const wsFile = useChatStore((s) => s.workspaceFile);
  const setWsFile = useChatStore((s) => s.setWorkspaceFile);
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const flashTimer = useRef<number | null>(null);
  /** True when the user has manually flipped the toggle for this artifact.
   *  Once they've expressed a preference, we stop auto-switching. */
  const userPickedView = useRef<string | null>(null);

  const flash = useCallback((key: string) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlashed(key);
    flashTimer.current = window.setTimeout(() => setFlashed(null), 450);
  }, []);

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  useEffect(() => {
    const onRefresh = () => setPreviewReloadKey((k) => k + 1);
    window.addEventListener("goatllm:refresh-artifact-preview", onRefresh);
    return () => window.removeEventListener("goatllm:refresh-artifact-preview", onRefresh);
  }, []);

  // Reset the user's view preference whenever the active artifact changes —
  // they're looking at a different document now, so prior intent doesn't
  // apply.
  useEffect(() => {
    userPickedView.current = null;
  }, [activeArtifactId]);

  // Refresh file browser when tool calls complete (files may have changed)
  // Use a stable selector to avoid unnecessary re-renders
  const completedToolCount = useChatStore((s) => {
    if (!activeId) return 0;
    const msgs = s.messages[activeId] ?? [];
    let count = 0;
    for (const m of msgs) {
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          if (tc.state === "done") count++;
        }
      }
    }
    return count;
  });
  useEffect(() => {
    if (completedToolCount > 0) setFileRefreshKey((k) => k + 1);
  }, [completedToolCount]);

  // Resolve external references for workspace files
  const [resolvedWsHtml, setResolvedWsHtml] = useState<string | null>(null);
  const [resolvingWsFile, setResolvingWsFile] = useState(false);
  const [wsFileView, setWsFileView] = useState<"preview" | "code">("preview");

  // Check if workspace file can be previewed (HTML, SVG, Markdown, CSS)
  const wsFileIsPreviewable = wsFile && /\.(html?|htm|svg|md|markdown|css)$/i.test(wsFile.name);

  useEffect(() => {
    if (!wsFile || !wsFileIsPreviewable) {
      setResolvedWsHtml(null);
      return;
    }

    let cancelled = false;
    setResolvingWsFile(true);
    setResolvedWsHtml(null);

    (async () => {
      try {
        const processed = await resolveArtifactReferences(
          wsFile.content,
          wsFile.path,
          workspacePath,
        );
        if (!cancelled) setResolvedWsHtml(processed);
      } catch (e) {
        console.warn("[ArtifactPanel] Workspace file resolution failed:", e);
        if (!cancelled) setResolvedWsHtml(wsFile.content);
      } finally {
        if (!cancelled) setResolvingWsFile(false);
      }
    })();

    return () => { cancelled = true; };
  }, [wsFile?.path, wsFile?.content, workspacePath]);

  // Reset wsFile when conversation changes
  useEffect(() => {
    setWsFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Auto-switch: while the agent is streaming, pin the editor open so the
  // user watches the code being typed; once streaming finishes, snap to
  // preview so they see the rendered result. Skip both moves once the user
  // has expressed their own preference for this artifact.
  // Note: This must be before the null guard to satisfy React's rules of hooks.
  const streamingForActive = (() => {
    try {
      if (!artifacts || artifacts.length === 0) return false;
      const a = artifacts.find((x) => x.id === activeArtifactId) ?? artifacts[0];
      if (!a) return false;
      const v = a.versions?.[a.activeVersionIndex ?? a.versions.length - 1];
      if (!v?.streaming) return false;
      // Only auto-switch to code for brand-new artifacts (first version).
      // For edits to existing artifacts, stay on preview so the user
      // doesn't see the raw code flash.
      const versions = a.versions ?? [];
      const nonStreaming = versions.filter((ver) => !ver.streaming);
      return nonStreaming.length === 0;
    } catch {
      return false;
    }
  })();
  useEffect(() => {
    if (userPickedView.current === activeArtifactId) return;
    setView(streamingForActive ? "code" : "preview");
  }, [streamingForActive, activeArtifactId]);

  if (!activeId || !artifactPanelOpen) return null;
  // Allow the panel to show for workspace files even without artifacts.
  if ((!artifacts || artifacts.length === 0) && !wsFile) return null;

  const activeIdx = artifacts?.findIndex((a) => a.id === activeArtifactId) ?? -1;
  const activeArtifact = activeIdx >= 0 ? artifacts![activeIdx] : artifacts?.[0];
  const Icon = activeArtifact ? (KIND_ICON[activeArtifact.kind] ?? KIND_ICON.html) : FileCode;

  const previewKey =
    previewReloadKey * 1_000_000 +
    (activeArtifact?.code.length ?? 0) +
    (activeArtifact?.activeVersionIndex ?? 0);

  const versions = activeArtifact?.versions ?? [];
  const verIdx = activeArtifact?.activeVersionIndex ?? versions.length - 1;
  const canUndo = verIdx > 0;
  const canRedo = verIdx < versions.length - 1;

  // Brief amber tint when a button is pressed, so the click registers visually.
  const flashTint = (key: string) =>
    flashed === key ? "bg-[#f59e42]/20 text-[#f59e42]" : "";

  const handleClose = () => { flash("close"); setActiveArtifact(null); setWsFile(null); };
  const handleUndo = () => { if (activeArtifact) { flash("undo"); undoArtifact(activeId, activeArtifact.id); } };
  const handleRedo = () => { if (activeArtifact) { flash("redo"); redoArtifact(activeId, activeArtifact.id); } };
  const handleReload = () => {
    flash("reload");
    setPreviewReloadKey((k) => k + 1);
  };

  const handleCopy = () => {
    if (!activeArtifact) return;
    flash("copy");
    navigator.clipboard.writeText(activeArtifact.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Slugify title for filename.
  const filename = (() => {
    if (!activeArtifact) return "file";
    const k = activeArtifact.kind;
    if (k === "docx" || k === "pptx" || k === "xlsx") {
      return officeFilename(k, activeArtifact.title);
    }
    const ext = k === "html" ? "html" : k === "python" ? "py" : "tex";
    const base = (activeArtifact.title || "artifact")
      .toLowerCase()
      .replace(/[^\w\s.-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "artifact";
    return `${base}.${ext}`;
  })();

  const handlePrint = () => {
    if (!activeArtifact) return;
    flash("print");
    if (activeArtifact.kind !== "html") return;
    // Open the artifact in a new window and trigger the browser's print
    // dialog from inside it. Users can pick "Save as PDF" from there —
    // matches Open Design's deck export pattern (window.print on the same
    // document tree the iframe rendered).
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return;
    w.document.open();
    w.document.write(activeArtifact.code);
    w.document.close();
    // Wait one tick so styles + fonts paint before the print dialog fires.
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* user closed the popup before we got here */
      }
    }, 250);
  };

  const handleDownload = async () => {
    if (!activeArtifact) return;
    flash("download");
    const k = activeArtifact.kind;

    // Office formats build a real .docx/.pptx/.xlsx blob from source.
    if (k === "docx" || k === "pptx" || k === "xlsx") {
      try {
        let blob: Blob;
        if (k === "docx") blob = await exportDocxBlob(activeArtifact.code, activeArtifact.title);
        else if (k === "pptx") blob = await exportPptxBlob(activeArtifact.code, activeArtifact.title);
        else blob = await exportXlsxBlob(activeArtifact.code, activeArtifact.title);
        // Re-wrap to ensure the MIME type is the OOXML one even when the
        // generator returns application/octet-stream.
        const typed = new Blob([await blob.arrayBuffer()], { type: officeMimeType(k) });
        const url = URL.createObjectURL(typed);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return;
      } catch (e) {
        console.error("[artifact] office export failed", e);
        // Fall through to source download below as a safety net.
      }
    }

    // For LaTeX, prefer the compiled PDF if we have it. Otherwise download
    // the source. We don't have the pdfDataUrl up here; the simplest cross-
    // type behavior is to always download source — users can right-click the
    // rendered PDF iframe to save.
    const mime =
      activeArtifact.kind === "html"
        ? "text/html;charset=utf-8"
        : activeArtifact.kind === "python"
          ? "text/x-python"
          : activeArtifact.kind === "latex"
            ? "application/x-tex"
            : "text/plain";
    const blob = new Blob([activeArtifact.code], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="liquid-surface flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden animate-[fadeIn_120ms_ease]">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] shrink-0">
        <Icon size={13} strokeWidth={1.75} className="text-[#a0a0a0] shrink-0" />
        <span className="text-[13px] font-medium text-[#ececec] truncate min-w-0">
          {activeArtifact ? activeArtifact.title : wsFile?.name ?? "File"}
        </span>
        {activeArtifact && (
          <span className="text-[10px] text-[#a0a0a0] bg-white/5 px-1.5 py-0.5 rounded shrink-0">
            {KIND_LABEL[activeArtifact.kind]}
          </span>
        )}

        {/* Inter-artifact navigation when there's more than one */}
        {activeArtifact && artifacts && artifacts.length > 1 && (
          <div className="flex items-center gap-0.5 ml-1 shrink-0">
            <button
              onClick={() => activeIdx > 0 && setActiveArtifact(artifacts[activeIdx - 1].id)}
              disabled={activeIdx <= 0}
              aria-label="Previous artifact"
              className="control-icon p-1 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={13} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className="text-[10.5px] text-[#a0a0a0] min-w-[28px] text-center tabular-nums">
              {activeIdx + 1}/{artifacts.length}
            </span>
            <button
              onClick={() => activeIdx < artifacts.length - 1 && setActiveArtifact(artifacts[activeIdx + 1].id)}
              disabled={activeIdx >= artifacts.length - 1}
              aria-label="Next artifact"
              className="control-icon p-1 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Artifact-specific controls (hidden when viewing a workspace file) */}
        {activeArtifact && (<>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Previous version"
            className={`control-icon p-1.5 rounded-md disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#a0a0a0] transition-colors duration-300 ${flashTint("undo")}`}
          >
            <Undo2 size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Next version"
            className={`control-icon p-1.5 rounded-md disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#a0a0a0] transition-colors duration-300 ${flashTint("redo")}`}
          >
            <Redo2 size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {/* History dropdown — sits left of the Code/Preview toggle */}
        <div className="relative">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            aria-label="Version history"
            title="Version history"
            className={`p-1.5 rounded-md transition-colors ${
              historyOpen ? "control-icon text-[#ececec] bg-white/[0.08]" : "control-icon"
            }`}
          >
            <History size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {historyOpen && (
            <HistoryMenu
              artifact={activeArtifact}
              conversationId={activeId}
              onClose={() => setHistoryOpen(false)}
            />
          )}
        </div>

        {/* Code/Preview toggle */}
        <ViewToggle
          view={view}
          onChange={(v) => {
            userPickedView.current = activeArtifactId;
            setView(v);
          }}
        />

        {/* Refresh preview (HTML, LaTeX PDF, office, deck, etc.) */}
        {view === "preview" && activeArtifact.kind !== "python" && (
          <button
            onClick={handleReload}
            aria-label="Reload preview"
            title="Reload preview"
            className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("reload")}`}
          >
            <RotateCw size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}

        {/* Copy */}
        <button
          onClick={handleCopy}
          aria-label="Copy code"
          title={copied ? "Copied" : "Copy code"}
          className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("copy")}`}
        >
          <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>

        {/* 5-dim critique — design mode + HTML only */}
        {activeArtifact.kind === "html" && useChatStore.getState().designMode && (
          <CritiqueButton code={activeArtifact.code} />
        )}

        {/* Manual edit — design mode + HTML only */}
        {activeArtifact.kind === "html" && useChatStore.getState().designMode && (
          <button
            onClick={() => setManualEditOpen(true)}
            aria-label="Manual edit"
            title="Edit code manually"
            className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("edit")}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}

        {/* Print — HTML only, opens browser print dialog (Save as PDF) */}
        {activeArtifact.kind === "html" && (
          <button
            onClick={handlePrint}
            aria-label="Print or save as PDF"
            title="Print / Save as PDF"
            className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("print")}`}
          >
            <Printer size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}

        {/* Download */}
        <button
          onClick={handleDownload}
          aria-label="Download"
          title="Download source"
          className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("download")}`}
        >
          <Download size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
        </>)}

        {/* Close */}
        <button
          onClick={handleClose}
          aria-label="Close artifact panel"
          className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("close")}`}
        >
          <X size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex-1 min-h-0 flex">
        {/* Sidebar: file browser + artifact list */}
        <div className="w-[200px] shrink-0 border-r border-white/[0.05] bg-[#181819]/42 flex flex-col overflow-hidden">
          {(agentMode || designMode) && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <WorkspaceFileBrowser
                onFileContent={(path, name, content) => {
                  setWsFile({ path, name, content });
                }}
                refreshKey={fileRefreshKey}
              />
            </div>
          )}
          {artifacts && artifacts.length > 0 && (
            <div className="border-t border-white/[0.04]">
              <div className="px-3 py-1.5">
                <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#888] font-semibold">Artifacts</span>
              </div>
              <div className="max-h-[160px] overflow-y-auto px-1 pb-1">
                {artifacts.map((a) => {
                  const AIcon = KIND_ICON[a.kind];
                  const isActive = a.id === activeArtifact?.id && !wsFile;
                  return (
                    <button
                      key={a.id}
                      onClick={() => {
                        setActiveArtifact(a.id);
                        setWsFile(null);
                      }}
                      className={`flex items-center gap-1.5 w-full text-left py-[3px] px-2 rounded-md text-[12px] transition-colors ${
                        isActive
                          ? "bg-[#f59e42]/10 text-[#f59e42]"
                          : "text-[#b4b4b4] hover:bg-white/[0.04] hover:text-[#ececec]"
                      }`}
                    >
                      <AIcon size={12} strokeWidth={1.75} className="shrink-0 text-[#666]" />
                      <span className="truncate">{a.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 min-h-0 flex flex-col">
          {wsFile ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] shrink-0">
                <FileCode size={13} strokeWidth={1.75} className="text-[#a0a0a0] shrink-0" />
                <span className="text-[13px] font-medium text-[#ececec] truncate">{wsFile.name}</span>
                <span className="text-[10px] text-[#666] truncate">{wsFile.path}</span>
                <div className="flex-1" />
                {/* View toggle for previewable files */}
                {wsFileIsPreviewable && (
                  <ViewToggle
                    view={wsFileView}
                    onChange={setWsFileView}
                  />
                )}
                <button
                  onClick={() => setWsFile(null)}
                  className="control-icon p-1 rounded transition-colors"
                  aria-label="Close file"
                >
                  <X size={13} strokeWidth={1.75} />
                </button>
              </div>

              {/* Render based on file type and view mode */}
              {wsFileIsPreviewable && wsFileView === "preview" ? (
                resolvingWsFile ? (
                  <div className="flex-1 relative">
                    <div className="absolute inset-0 flex items-center justify-center bg-[#1c1c1e]/80 z-10">
                      <div className="flex flex-col items-center gap-2 text-[#a0a0a0]">
                        <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-[#f59e42] animate-spin" />
                        <span className="text-[11px]">Resolving references…</span>
                      </div>
                    </div>
                    {renderWorkspacePreview(wsFile, resolvedWsHtml)}
                  </div>
                ) : (
                  renderWorkspacePreview(wsFile, resolvedWsHtml)
                )
              ) : (
                <div className="flex-1 min-h-0 overflow-auto bg-[#161618]">
                  <pre className="p-4 text-[12.5px] leading-relaxed text-[#b4b4b4] whitespace-pre-wrap break-words font-mono">
                    {wsFile.content}
                  </pre>
                </div>
              )}
            </div>
          ) : manualEditOpen && activeId && activeArtifact ? (
            <ManualEditPanel
              conversationId={activeId}
              artifactId={activeArtifact.id}
              onClose={() => setManualEditOpen(false)}
            />
          ) : activeArtifact ? (
            <ArtifactContent
              artifact={activeArtifact}
              view={view}
              previewKey={previewKey}
            />
          ) : null}
        </div>
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
      className="soft-card flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-white/[0.055] hover:border-white/[0.11] transition-[background,border-color,box-shadow] text-left group"
    >
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 group-hover:bg-white/10 transition-colors">
        <Icon size={15} strokeWidth={1.75} className="text-[#a0a0a0]" />
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[12px] font-medium text-[#d5d5d5] truncate">{artifact.title}</span>
        <span className="text-[11px] text-[#a0a0a0]">{KIND_LABEL[artifact.kind]}</span>
      </div>
      <span className="text-[11px] text-[#a0a0a0] group-hover:text-[#ececec] transition-colors shrink-0">Open</span>
    </button>
  );
}

/**
 * Inline card shown while the model is still streaming the artifact body.
 * The actual `Artifact` row doesn't exist yet — we don't run detection until
 * the message finalizes — so this card carries just enough metadata to look
 * like the real one and shows a shimmer label so the user knows something
 * is being authored.
 */
export function ArtifactPlaceholderCard({
  kind,
  title,
}: {
  kind: ArtifactKind;
  title: string;
}) {
  const Icon = KIND_ICON[kind];
  const verb = KIND_VERB[kind];
  const label = KIND_LABEL[kind];
  return (
    <div className="soft-card flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left">
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
        <Icon size={15} strokeWidth={1.75} className="text-[#a0a0a0]" />
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[12px] font-medium text-[#d5d5d5] truncate">
          {title || `Untitled ${label}`}
        </span>
        <span className="text-[11px] text-[#a0a0a0] thinking-line">{verb}…</span>
      </div>
      <span className="w-1.5 h-1.5 rounded-full bg-[#f59e42] animate-[pulse-soft_1.6s_ease-in-out_infinite] shrink-0" />
    </div>
  );
}

const KIND_VERB: Record<ArtifactKind, string> = {
  html: "Building page",
  latex: "Drafting document",
  python: "Writing script",
  docx: "Writing",
  pptx: "Building deck",
  xlsx: "Building sheet",
  deck: "Building presentation",
  "react-component": "Building component",
  "markdown-document": "Writing document",
  svg: "Drawing graphic",
  diagram: "Creating diagram",
  "code-snippet": "Writing code",
  "mini-app": "Building app",
  "design-system": "Documenting system",
};
