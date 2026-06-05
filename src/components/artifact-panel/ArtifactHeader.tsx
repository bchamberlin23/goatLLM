import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  History,
  Pencil,
  Printer,
  Redo2,
  RotateCw,
  Undo2,
  X,
} from "lucide-react";
import type { Artifact } from "../../stores/chat";
import { ArtifactTabs, type ArtifactPanelView } from "./ArtifactTabs";
import { HistoryPane } from "./HistoryPane";

interface ArtifactHeaderProps {
  activeArtifact: Artifact | undefined;
  activeIndex: number;
  artifactCount: number;
  canRedo: boolean;
  canUndo: boolean;
  conversationId: string | null;
  copied: boolean;
  critiqueSlot?: ReactNode;
  flashTint: (key: string) => string;
  historyOpen: boolean;
  icon: LucideIcon;
  isDesignMode: boolean;
  kindLabel: string | null;
  title: string;
  view: ArtifactPanelView;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onManualEdit: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onPrint: () => void;
  onRedo: () => void;
  onReload: () => void;
  onRestoreVersion: (versionIndex: number) => void;
  onUndo: () => void;
  onViewChange: (view: "preview" | "code") => void;
  setHistoryOpen: (open: boolean | ((open: boolean) => boolean)) => void;
}

export function ArtifactHeader({
  activeArtifact,
  activeIndex,
  artifactCount,
  canRedo,
  canUndo,
  conversationId,
  copied,
  critiqueSlot,
  flashTint,
  historyOpen,
  icon: Icon,
  isDesignMode,
  kindLabel,
  title,
  view,
  onClose,
  onCopy,
  onDownload,
  onManualEdit,
  onNext,
  onPrevious,
  onPrint,
  onRedo,
  onReload,
  onRestoreVersion,
  onUndo,
  onViewChange,
  setHistoryOpen,
}: ArtifactHeaderProps) {
  const showArtifactControls = !!activeArtifact;
  const showPreviewReload =
    activeArtifact && view === "preview" && activeArtifact.kind !== "python";
  const showDesignControls =
    activeArtifact && activeArtifact.kind === "html" && isDesignMode;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] shrink-0">
      <Icon size={13} strokeWidth={1.75} className="text-[#a0a0a0] shrink-0" />
      <span className="text-[13px] font-medium text-[#ececec] truncate min-w-0">
        {title}
      </span>
      {kindLabel && (
        <span className="text-[10px] text-[#a0a0a0] bg-white/5 px-1.5 py-0.5 rounded shrink-0">
          {kindLabel}
        </span>
      )}

      {activeArtifact && artifactCount > 1 && (
        <div className="flex items-center gap-0.5 ml-1 shrink-0">
          <button
            type="button"
            onClick={onPrevious}
            disabled={activeIndex <= 0}
            aria-label="Previous artifact"
            className="control-icon p-1 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={13} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="text-[10.5px] text-[#a0a0a0] min-w-[28px] text-center tabular-nums">
            {activeIndex + 1}/{artifactCount}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={activeIndex >= artifactCount - 1}
            aria-label="Next artifact"
            className="control-icon p-1 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="flex-1" />

      {showArtifactControls && activeArtifact && (
        <>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              aria-label="Undo"
              title="Previous version"
              className={`control-icon p-1.5 rounded-md disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#a0a0a0] transition-colors duration-300 ${flashTint("undo")}`}
            >
              <Undo2 size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              aria-label="Redo"
              title="Next version"
              className={`control-icon p-1.5 rounded-md disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#a0a0a0] transition-colors duration-300 ${flashTint("redo")}`}
            >
              <Redo2 size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-label="Version history"
              title="Version history"
              className={`p-1.5 rounded-md transition-colors ${
                historyOpen ? "control-icon text-[#ececec] bg-white/[0.08]" : "control-icon"
              }`}
            >
              <History size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {historyOpen && conversationId && (
              <HistoryPane
                artifact={activeArtifact}
                onClose={() => setHistoryOpen(false)}
                onRestoreVersion={onRestoreVersion}
              />
            )}
          </div>

          {view !== "browser" && (
            <ArtifactTabs
              view={view}
              onChange={onViewChange}
            />
          )}

          {showPreviewReload && (
            <button
              type="button"
              onClick={onReload}
              aria-label="Reload preview"
              title="Reload preview"
              className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("reload")}`}
            >
              <RotateCw size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={onCopy}
            aria-label="Copy code"
            title={copied ? "Copied" : "Copy code"}
            className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("copy")}`}
          >
            <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>

          {showDesignControls && critiqueSlot}

          {showDesignControls && (
            <button
              type="button"
              onClick={onManualEdit}
              aria-label="Manual edit"
              title="Edit code manually"
              className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("edit")}`}
            >
              <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}

          {activeArtifact.kind === "html" && (
            <button
              type="button"
              onClick={onPrint}
              aria-label="Print or save as PDF"
              title="Print / Save as PDF"
              className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("print")}`}
            >
              <Printer size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={onDownload}
            aria-label="Download"
            title="Download source"
            className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("download")}`}
          >
            <Download size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        aria-label="Close artifact panel"
        className={`control-icon p-1.5 rounded-md transition-colors duration-300 ${flashTint("close")}`}
      >
        <X size={13} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
