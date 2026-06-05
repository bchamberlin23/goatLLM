import { useEffect, useRef, useState } from "react";
import { Code, FileCode, FileSpreadsheet, FileText, FileType, Image as ImageIcon, Presentation, type LucideIcon } from "lucide-react";
import { useChatStore, type ArtifactKind } from "../../stores/chat";
import { CritiqueButton } from "../design/CritiqueButton";
import { ManualEditPanel } from "../design/ManualEditPanel";
import { WorkspaceFileBrowser } from "../WorkspaceFileBrowser";
import { ArtifactHeader } from "./ArtifactHeader";
import { type ArtifactPanelView } from "./ArtifactTabs";
import { CodePane } from "./CodePane";
import { BrowserCanvas, FileCanvas } from "./FileCanvas";
import { useArtifactPanel } from "./hooks/useArtifactPanel";
import { PreviewPane } from "./PreviewPane";

const ARTIFACT_LANG: Record<ArtifactKind, string> = {
  html: "html", latex: "plaintext", python: "python", docx: "markdown", pptx: "markdown", xlsx: "markdown",
  deck: "html", "react-component": "typescript", "markdown-document": "markdown", svg: "xml", diagram: "plaintext",
  "code-snippet": "plaintext", "mini-app": "html", image: "plaintext", "design-system": "markdown",
};

const KIND_ICON: Record<ArtifactKind, LucideIcon> = {
  html: FileCode, latex: FileText, python: Code, docx: FileType, pptx: Presentation, xlsx: FileSpreadsheet,
  deck: Presentation, "react-component": Code, "markdown-document": FileText, svg: FileCode, diagram: FileCode,
  "code-snippet": Code, "mini-app": FileCode, image: ImageIcon, "design-system": FileText,
};

const KIND_LABEL: Record<ArtifactKind, string> = {
  html: "HTML", latex: "LaTeX", python: "Python", docx: "Word", pptx: "Slides", xlsx: "Excel", deck: "Deck",
  "react-component": "React", "markdown-document": "Markdown", svg: "SVG", diagram: "Diagram", "code-snippet": "Code",
  "mini-app": "App", image: "Image", "design-system": "Design System",
};

const KIND_VERB: Record<ArtifactKind, string> = {
  html: "Building page", latex: "Drafting document", python: "Writing script", docx: "Writing", pptx: "Building deck",
  xlsx: "Building sheet", deck: "Building presentation", "react-component": "Building component",
  "markdown-document": "Writing document", svg: "Drawing graphic", diagram: "Creating diagram", "code-snippet": "Writing code",
  "mini-app": "Building app", image: "Generating image", "design-system": "Documenting system",
};

export function kindIcon(kind: ArtifactKind) {
  return KIND_ICON[kind] ?? FileCode;
}

export function kindLabel(kind: ArtifactKind) {
  return KIND_LABEL[kind] ?? "Artifact";
}

export function kindVerb(kind: ArtifactKind) {
  return KIND_VERB[kind] ?? "Opening artifact";
}

function artifactLanguage(kind: ArtifactKind) {
  return ARTIFACT_LANG[kind] ?? "plaintext";
}

function getWsFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]).has(ext)) {
    return ImageIcon;
  }
  if (["pdf", "md", "markdown", "txt", "log", "csv"].includes(ext)) return FileText;
  return FileCode;
}

export function ArtifactPanel() {
  const activeId = useChatStore((s) => s.activeId);
  const artifacts = useChatStore((s) => (activeId ? s.artifacts[activeId] : undefined));
  const activeArtifactId = useChatStore((s) => s.activeArtifactId);
  const setActiveArtifact = useChatStore((s) => s.setActiveArtifact);
  const artifactPanelOpen = useChatStore((s) => s.artifactPanelOpen);
  const undoArtifact = useChatStore((s) => s.undoArtifact);
  const redoArtifact = useChatStore((s) => s.redoArtifact);
  const restoreArtifactVersion = useChatStore((s) => s.restoreArtifactVersion);
  const updateArtifact = useChatStore((s) => s.updateArtifact);
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const workspacePath = useChatStore((s) => (s.designMode ? s.designWorkspacePath : s.workspacePath));
  const wsFile = useChatStore((s) => s.workspaceFile);
  const setWsFile = useChatStore((s) => s.setWorkspaceFile);
  const completedToolCount = useChatStore((s) => {
    if (!activeId) return 0;
    let count = 0;
    for (const message of s.messages[activeId] ?? []) {
      for (const toolCall of message.toolCalls ?? []) {
        if (toolCall.state === "done") count++;
      }
    }
    return count;
  });
  const [view, setView] = useState<ArtifactPanelView>("preview");
  const userPickedView = useRef<string | null>(null);
  const activeIndex = artifacts?.findIndex((artifact) => artifact.id === activeArtifactId) ?? -1;
  const activeArtifact =
    activeIndex >= 0 ? artifacts?.[activeIndex] : wsFile ? undefined : artifacts?.[0];
  const wsFileIsPreviewable = !!wsFile && /\.(html?|svg|md|markdown|css)$/i.test(wsFile.name);
  const panel = useArtifactPanel({
    activeId,
    activeArtifact,
    completedToolCount,
    workspacePath,
    workspaceFile: wsFile,
    workspaceFileIsPreviewable: wsFileIsPreviewable,
    setWorkspaceFile: setWsFile,
  });

  useEffect(() => {
    userPickedView.current = null;
  }, [activeArtifactId]);

  const streamingForActive = (() => {
    if (!activeArtifact) return false;
    const versions = activeArtifact.versions ?? [];
    const version = versions[activeArtifact.activeVersionIndex ?? versions.length - 1];
    if (!version?.streaming) return false;
    return versions.filter((candidate) => !candidate.streaming).length === 0;
  })();

  useEffect(() => {
    if (userPickedView.current === activeArtifactId) return;
    setView(streamingForActive ? "code" : "preview");
  }, [streamingForActive, activeArtifactId]);

  const artifactCanvasRequested = artifactPanelOpen || !!activeArtifactId || !!wsFile;
  if (!artifactCanvasRequested || (!activeId && !wsFile)) return null;
  if ((!artifacts || artifacts.length === 0) && !wsFile) return null;

  const Icon = wsFile ? getWsFileIcon(wsFile.name) : activeArtifact ? kindIcon(activeArtifact.kind) : FileCode;
  const versions = activeArtifact?.versions ?? [];
  const versionIndex = activeArtifact?.activeVersionIndex ?? versions.length - 1;
  const canUndo = versionIndex > 0;
  const canRedo = versionIndex < versions.length - 1;

  const closePanel = () => {
    panel.flash("close");
    setActiveArtifact(null);
    setWsFile(null);
  };

  return (
    <div className="liquid-surface motion-surface-in flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden">
      <ArtifactHeader
        activeArtifact={activeArtifact}
        activeIndex={activeIndex}
        artifactCount={artifacts?.length ?? 0}
        canRedo={canRedo}
        canUndo={canUndo}
        conversationId={activeId}
        copied={panel.copied}
        critiqueSlot={activeArtifact ? <CritiqueButton code={activeArtifact.code} /> : undefined}
        flashTint={panel.flashTint}
        historyOpen={panel.historyOpen}
        icon={Icon}
        isDesignMode={designMode}
        kindLabel={activeArtifact ? kindLabel(activeArtifact.kind) : null}
        title={activeArtifact ? activeArtifact.title : wsFile?.name ?? "File"}
        view={view}
        onClose={closePanel}
        onCopy={() => panel.copyArtifact(activeArtifact)}
        onDownload={() => void panel.downloadArtifact(activeArtifact)}
        onManualEdit={() => panel.setManualEditOpen(true)}
        onNext={() => artifacts && activeIndex < artifacts.length - 1 && setActiveArtifact(artifacts[activeIndex + 1].id)}
        onPrevious={() => artifacts && activeIndex > 0 && setActiveArtifact(artifacts[activeIndex - 1].id)}
        onPrint={() => panel.printArtifact(activeArtifact)}
        onRedo={() => activeArtifact && activeId && (panel.flash("redo"), redoArtifact(activeId, activeArtifact.id))}
        onReload={panel.reloadPreview}
        onRestoreVersion={(index) => activeArtifact && activeId && restoreArtifactVersion(activeId, activeArtifact.id, index)}
        onUndo={() => activeArtifact && activeId && (panel.flash("undo"), undoArtifact(activeId, activeArtifact.id))}
        onViewChange={(nextView) => {
          userPickedView.current = activeArtifactId;
          setView(nextView);
        }}
        setHistoryOpen={panel.setHistoryOpen}
      />

      <div className="flex-1 min-h-0 flex">
        {(agentMode || designMode) && (
          <div className="w-[200px] shrink-0 border-r border-white/[0.05] bg-[#1a1a1c]/42 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden">
              <WorkspaceFileBrowser
                onFileContent={(path, name, content) => setWsFile({ path, name, content })}
                refreshKey={panel.fileRefreshKey}
              />
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col">
          {view === "browser" ? (
            <BrowserCanvas
              history={panel.browserHistory}
              historyIndex={panel.browserHistoryIndex}
              url={panel.browserUrl}
              onBack={panel.goBrowserBack}
              onForward={panel.goBrowserForward}
              onNavigate={panel.navigateBrowser}
              onUrlChange={panel.setBrowserUrl}
            />
          ) : wsFile ? (
            <FileCanvas
              file={wsFile}
              isPreviewable={wsFileIsPreviewable}
              resolvedContent={panel.resolvedWsHtml}
              resolving={panel.resolvingWsFile}
              view={panel.workspaceFileView}
              onClose={() => setWsFile(null)}
              onViewChange={panel.setWorkspaceFileView}
            />
          ) : panel.manualEditOpen && activeId && activeArtifact ? (
            <ManualEditPanel
              conversationId={activeId}
              artifactId={activeArtifact.id}
              onClose={() => panel.setManualEditOpen(false)}
            />
          ) : activeArtifact && view === "code" ? (
            <CodePane
              artifact={activeArtifact}
              language={artifactLanguage(activeArtifact.kind)}
              onCodeChange={(code) => activeId && updateArtifact(activeId, activeArtifact.id, code)}
            />
          ) : activeArtifact ? (
            <PreviewPane
              artifact={activeArtifact}
              designMode={designMode}
              officeError={panel.officeError}
              officeHtml={panel.officeHtml}
              pdfDataUrl={panel.pdfDataUrl}
              pdfError={panel.pdfError}
              pdfLoading={panel.pdfLoading}
              previewKey={panel.previewKey}
              pyError={panel.pyError}
              pyOutput={panel.pyOutput}
              pyRunning={panel.pyRunning}
              resolvedHtml={panel.resolvedHtml}
              resolvingHtml={panel.resolvingHtml}
              onRunPython={panel.runPython}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
