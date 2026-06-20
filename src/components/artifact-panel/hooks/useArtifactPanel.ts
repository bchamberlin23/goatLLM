import { useCallback, useEffect, useRef, useState } from "react";
import type { Artifact, ArtifactKind } from "../../../stores/chat";
import { resolveArtifactReferences } from "../../../lib/artifact-resolver";
import {
  exportDocxBlob,
  exportPptxBlob,
  exportXlsxBlob,
  officeFilename,
  officeMimeType,
  renderDocxPreview,
  renderPptxPreview,
  renderXlsxPreview,
} from "../../../lib/office-artifacts";

type WorkspaceFile = { path: string; name: string; content: string };

const OFFICE_KINDS = new Set<ArtifactKind>(["docx", "pptx", "xlsx"]);
const HTML_LIKE_KINDS = new Set<ArtifactKind>(["html", "deck", "mini-app"]);

interface UseArtifactPanelOptions {
  activeId: string | null;
  activeArtifact: Artifact | undefined;
  completedToolCount: number;
  workspacePath: string | null;
  workspaceFile: WorkspaceFile | null;
  workspaceFileIsPreviewable: boolean;
  setWorkspaceFile: (file: WorkspaceFile | null) => void;
}

function artifactPathFor(artifact: Artifact) {
  const base = artifact.title
    ? artifact.title.toLowerCase().replace(/[^\w.-]+/g, "-")
    : "index";
  return `${base}.html`;
}

function sourceFilename(artifact: Artifact) {
  if (OFFICE_KINDS.has(artifact.kind)) {
    return officeFilename(artifact.kind as "docx" | "pptx" | "xlsx", artifact.title);
  }
  const ext = artifact.kind === "html" ? "html" : artifact.kind === "python" ? "py" : "tex";
  const base = (artifact.title || "artifact")
    .toLowerCase()
    .replace(/[^\w\s.-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "artifact";
  return `${base}.${ext}`;
}

function sourceMime(kind: ArtifactKind) {
  if (kind === "html") return "text/html;charset=utf-8";
  if (kind === "python") return "text/x-python";
  if (kind === "latex") return "application/x-tex";
  return "text/plain";
}

export function useArtifactPanel({
  activeId,
  activeArtifact,
  completedToolCount,
  workspacePath,
  workspaceFile,
  workspaceFileIsPreviewable,
  setWorkspaceFile,
}: UseArtifactPanelOptions) {
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [manualEditOpen, setManualEditOpen] = useState(false);
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(null);
  const [resolvingHtml, setResolvingHtml] = useState(false);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pyOutput, setPyOutput] = useState<string | null>(null);
  const [pyRunning, setPyRunning] = useState(false);
  const [pyError, setPyError] = useState<string | null>(null);
  const [officeHtml, setOfficeHtml] = useState<string | null>(null);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [resolvedWsHtml, setResolvedWsHtml] = useState<string | null>(null);
  const [resolvingWsFile, setResolvingWsFile] = useState(false);
  const [workspaceFileView, setWorkspaceFileView] = useState<"preview" | "code">("preview");
  const [browserUrl, setBrowserUrl] = useState("");
  const [browserHistory, setBrowserHistory] = useState<string[]>([]);
  const [browserHistoryIndex, setBrowserHistoryIndex] = useState(-1);
  const flashTimer = useRef<number | null>(null);
  const previousActiveId = useRef(activeId);

  const previewKey =
    previewReloadKey * 1_000_000 +
    (activeArtifact?.code.length ?? 0) +
    (activeArtifact?.activeVersionIndex ?? 0);

  const flash = useCallback((key: string) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlashed(key);
    flashTimer.current = window.setTimeout(() => setFlashed(null), 450);
  }, []);

  const flashTint = useCallback(
    (key: string) => (flashed === key ? "bg-accent/20 text-accent" : ""),
    [flashed],
  );

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  useEffect(() => {
    const onRefresh = () => setPreviewReloadKey((key) => key + 1);
    window.addEventListener("goatllm:refresh-artifact-preview", onRefresh);
    return () => window.removeEventListener("goatllm:refresh-artifact-preview", onRefresh);
  }, []);

  useEffect(() => {
    if (previousActiveId.current === activeId) return;
    previousActiveId.current = activeId;
    setWorkspaceFile(null);
  }, [activeId, setWorkspaceFile]);

  useEffect(() => {
    if (completedToolCount > 0) setFileRefreshKey((key) => key + 1);
  }, [completedToolCount]);

  useEffect(() => {
    setPdfDataUrl(null);
    setPdfError(null);
    setPyOutput(null);
    setPyError(null);
    setOfficeHtml(null);
    setOfficeError(null);
    setResolvedHtml(null);
    setResolvingHtml(false);
    setManualEditOpen(false);
    setHistoryOpen(false);
  }, [activeArtifact?.id]);

  useEffect(() => {
    if (!activeArtifact || !OFFICE_KINDS.has(activeArtifact.kind)) return;
    let cancelled = false;
    (async () => {
      try {
        let html: string;
        if (activeArtifact.kind === "docx") {
          html = await renderDocxPreview(activeArtifact.code, activeArtifact.title);
        } else if (activeArtifact.kind === "pptx") {
          html = renderPptxPreview(activeArtifact.code, activeArtifact.title);
        } else {
          html = renderXlsxPreview(activeArtifact.code, activeArtifact.title);
        }
        if (!cancelled) setOfficeHtml(html);
      } catch (error) {
        if (!cancelled) setOfficeError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeArtifact?.id, activeArtifact?.kind, activeArtifact?.code, activeArtifact?.title]);

  useEffect(() => {
    if (!activeArtifact || !HTML_LIKE_KINDS.has(activeArtifact.kind)) return;
    let cancelled = false;
    setResolvingHtml(true);
    setResolvedHtml(null);
    (async () => {
      try {
        const processed = await resolveArtifactReferences(
          activeArtifact.code,
          artifactPathFor(activeArtifact),
          workspacePath,
        );
        if (!cancelled) setResolvedHtml(processed);
      } catch (error) {
        console.warn("[ArtifactPanel] HTML resolution failed:", error);
        if (!cancelled) setResolvedHtml(activeArtifact.code);
      } finally {
        if (!cancelled) setResolvingHtml(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeArtifact?.id, activeArtifact?.kind, activeArtifact?.code, activeArtifact?.title, workspacePath]);

  useEffect(() => {
    if (!activeArtifact || activeArtifact.kind !== "latex") return;
    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<string>("compile_latex", { content: activeArtifact.code });
        if (!cancelled) setPdfDataUrl(result);
      } catch (error) {
        if (!cancelled) setPdfError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeArtifact?.id, activeArtifact?.kind, activeArtifact?.code, previewKey]);

  useEffect(() => {
    if (!workspaceFile || !workspaceFileIsPreviewable) {
      setResolvedWsHtml(null);
      return;
    }
    let cancelled = false;
    setResolvingWsFile(true);
    setResolvedWsHtml(null);
    (async () => {
      try {
        const processed = await resolveArtifactReferences(
          workspaceFile.content,
          workspaceFile.path,
          workspacePath,
        );
        if (!cancelled) setResolvedWsHtml(processed);
      } catch (error) {
        console.warn("[ArtifactPanel] Workspace file resolution failed:", error);
        if (!cancelled) setResolvedWsHtml(workspaceFile.content);
      } finally {
        if (!cancelled) setResolvingWsFile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    workspaceFile?.path,
    workspaceFile?.content,
    workspaceFileIsPreviewable,
    workspacePath,
  ]);

  const reloadPreview = useCallback(() => {
    flash("reload");
    setPreviewReloadKey((key) => key + 1);
  }, [flash]);

  const copyArtifact = useCallback((artifact: Artifact | undefined) => {
    if (!artifact) return;
    flash("copy");
    navigator.clipboard.writeText(artifact.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [flash]);

  const runPython = useCallback(async () => {
    if (!activeArtifact || pyRunning) return;
    setPyRunning(true);
    setPyError(null);
    setPyOutput(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<string>("run_python", { code: activeArtifact.code });
      setPyOutput(result);
    } catch (error) {
      setPyError(error instanceof Error ? error.message : String(error));
    } finally {
      setPyRunning(false);
    }
  }, [activeArtifact?.code, pyRunning]);

  const printArtifact = useCallback((artifact: Artifact | undefined) => {
    if (!artifact) return;
    flash("print");
    if (artifact.kind !== "html") return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(artifact.code);
    printWindow.document.close();
    window.setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch {
        // The user may close the popup before printing starts.
      }
    }, 250);
  }, [flash]);

  const downloadArtifact = useCallback(async (artifact: Artifact | undefined) => {
    if (!artifact) return;
    flash("download");
    const filename = sourceFilename(artifact);
    if (OFFICE_KINDS.has(artifact.kind)) {
      try {
        let blob: Blob;
        if (artifact.kind === "docx") blob = await exportDocxBlob(artifact.code, artifact.title);
        else if (artifact.kind === "pptx") blob = await exportPptxBlob(artifact.code, artifact.title);
        else blob = await exportXlsxBlob(artifact.code, artifact.title);
        const typed = new Blob([await blob.arrayBuffer()], {
          type: officeMimeType(artifact.kind as "docx" | "pptx" | "xlsx"),
        });
        const url = URL.createObjectURL(typed);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        return;
      } catch (error) {
        console.error("[artifact] office export failed", error);
      }
    }

    const blob = new Blob([artifact.code], { type: sourceMime(artifact.kind) });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [flash]);

  const navigateBrowser = useCallback((url: string) => {
    if (!url.trim()) return;
    const normalizedUrl = url.match(/^https?:\/\//) ? url : `https://${url}`;
    setBrowserUrl(normalizedUrl);
    setBrowserHistory((history) => {
      const next = [...history.slice(0, browserHistoryIndex + 1), normalizedUrl];
      setBrowserHistoryIndex(next.length - 1);
      return next;
    });
  }, [browserHistoryIndex]);

  const goBrowserBack = useCallback(() => {
    if (browserHistoryIndex <= 0) return;
    const nextIndex = browserHistoryIndex - 1;
    setBrowserHistoryIndex(nextIndex);
    setBrowserUrl(browserHistory[nextIndex]);
  }, [browserHistory, browserHistoryIndex]);

  const goBrowserForward = useCallback(() => {
    if (browserHistoryIndex >= browserHistory.length - 1) return;
    const nextIndex = browserHistoryIndex + 1;
    setBrowserHistoryIndex(nextIndex);
    setBrowserUrl(browserHistory[nextIndex]);
  }, [browserHistory, browserHistoryIndex]);

  return {
    browserHistory,
    browserHistoryIndex,
    browserUrl,
    copied,
    downloadArtifact,
    fileRefreshKey,
    flash,
    flashTint,
    goBrowserBack,
    goBrowserForward,
    historyOpen,
    manualEditOpen,
    navigateBrowser,
    officeError,
    officeHtml,
    pdfDataUrl,
    pdfError,
    pdfLoading,
    previewKey,
    pyError,
    pyOutput,
    pyRunning,
    reloadPreview,
    resolvedHtml,
    resolvedWsHtml,
    resolvingHtml,
    resolvingWsFile,
    runPython,
    setBrowserUrl,
    setHistoryOpen,
    setManualEditOpen,
    setWorkspaceFileView,
    workspaceFileView,
    printArtifact,
    copyArtifact,
  };
}
