import { useChatStore, type Attachment } from "../stores/chat";
import { InputBar } from "./InputBar";
import { MessageList } from "./MessageList";
import { WorkspacePicker } from "./WorkspacePicker";
import { DesignWorkspacePicker } from "./design/DesignWorkspacePicker";
import { ModeToggle } from "./ModeToggle";
import { SafeArtifactPanel } from "./SafeArtifactPanel";
import { AttachmentPanel } from "./AttachmentPanel";
import { TopBar } from "./TopBar";
import { TodoWidget } from "./TodoWidget";
import { Settings as SettingsIcon, ArrowRight, Upload, Folder, X } from "lucide-react";
import { SubagentPanel } from "./SubagentPanel";
import { ToolActivityIndicator } from "./ToolActivityIndicator";
import { ApprovalQueue } from "./ApprovalQueue";
import { WorkspaceHealthPanel } from "./WorkspaceHealthPanel";
import { NotebookView } from "./NotebookView";
import { useState, useRef, useCallback, useEffect, DragEvent } from "react";
import { getWelcomeMessage, type WelcomeMessageResult } from "../lib/welcome-messages";

/** Files we never want to inline from a dropped folder — binary blobs that
 *  add no signal, vendor directories, OS metadata. Mirrors what `search_content`
 *  ignores so a student dropping their project folder gets the source code,
 *  not 200MB of node_modules. */
const FOLDER_SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", "dist", "build", "out", "target",
  ".next", ".nuxt", ".turbo", ".cache", ".idea", ".vscode", "__pycache__",
  ".venv", "venv", "env", ".DS_Store",
]);

const FOLDER_SKIP_EXTS = new Set([
  "exe", "dll", "so", "dylib", "a", "o", "obj", "class", "jar", "war",
  "zip", "tar", "gz", "bz2", "xz", "7z", "rar",
  "jpg", "jpeg", "png", "gif", "webp", "ico", "bmp", "tiff", // images keep their own path
  "woff", "woff2", "ttf", "otf", "eot",
  "mp4", "mkv", "mov", "avi", "wmv",
]);

const FOLDER_DROP_MAX_FILES = 100;

function isWebkitFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

function isWebkitDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function hasWebkitGetAsEntry(
  item: DataTransferItem,
): item is DataTransferItem & { webkitGetAsEntry: () => FileSystemEntry | null } {
  return typeof (item as { webkitGetAsEntry?: unknown }).webkitGetAsEntry === "function";
}

/** Small bar showing active skills for the current conversation. */
function ActiveSkillsBar() {
  const activeId = useChatStore((s) => s.activeId);
  const conversations = useChatStore((s) => s.conversations);
  const setConversationSkills = useChatStore((s) => s.setConversationSkills);

  const activeSkillNames = activeId
    ? conversations.find((c) => c.id === activeId)?.activeSkillNames ?? []
    : [];

  if (activeSkillNames.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap w-full max-w-[720px] px-1 mb-1.5 animate-[fadeIn_150ms_ease]">
      <span className="text-[10.5px] text-[#888] mr-0.5">Skills:</span>
      {activeSkillNames.map((skillName) => (
        <span
          key={skillName}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.04] text-[11px] text-text-2 border border-white/[0.06]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" aria-hidden="true" />
          {skillName}
          <button
            onClick={() => {
              if (activeId) {
                const next = activeSkillNames.filter((n) => n !== skillName);
                setConversationSkills(activeId, next);
              }
            }}
            className="ml-0.5 p-0.5 rounded-sm hover:bg-white/10 transition-colors text-text-3 hover:text-text-2"
            aria-label={`Remove ${skillName} skill`}
          >
            <X size={9} strokeWidth={2} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Recursively walk a webkit FileSystemEntry tree and collect File objects.
 *  Skips vendor directories and binary file types so dropping a project
 *  folder doesn't yield 5,000 useless attachments. Caps at 100 files; the
 *  caller surfaces a notice if we hit the cap. */
async function entryToFiles(
  entry: FileSystemEntry,
  bucket: File[],
  maxFiles: number,
  pathPrefix = "",
): Promise<{ truncated: boolean }> {
  if (bucket.length >= maxFiles) return { truncated: true };
  if (isWebkitFileEntry(entry)) {
    return new Promise<{ truncated: boolean }>((resolve) => {
      entry.file((f: File) => {
        if (bucket.length >= maxFiles) return resolve({ truncated: true });
        const ext = (f.name.split(".").pop() ?? "").toLowerCase();
        if (FOLDER_SKIP_EXTS.has(ext) && !f.type.startsWith("image/")) {
          return resolve({ truncated: false });
        }
        if (f.size > 5 * 1024 * 1024) {
          // Cap dropped-folder files at 5MB each — anything bigger is almost
          // certainly not the source you want to discuss in chat.
          return resolve({ truncated: false });
        }
        // Stamp the relative path into the filename so the user sees folder
        // structure in the chip strip.
        const rel = pathPrefix ? `${pathPrefix}/${f.name}` : f.name;
        const renamed = new File([f], rel, { type: f.type });
        bucket.push(renamed);
        resolve({ truncated: false });
      }, () => resolve({ truncated: false }));
    });
  }
  if (isWebkitDirectoryEntry(entry)) {
    if (FOLDER_SKIP_DIRS.has(entry.name)) return { truncated: false };
    const reader = entry.createReader();
    let truncated = false;
    // readEntries returns batches; loop until empty.
    while (true) {
      const batch: FileSystemEntry[] = await new Promise((resolve) =>
        reader.readEntries((entries) => resolve(entries), () => resolve([])),
      );
      if (!batch.length) break;
      for (const child of batch) {
        const sub = await entryToFiles(child, bucket, maxFiles, pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name);
        if (sub.truncated) truncated = true;
        if (bucket.length >= maxFiles) return { truncated: true };
      }
    }
    return { truncated };
  }
  return { truncated: false };
}

/** Convert a list of File objects to Attachment[] */
async function filesToAttachments(fileList: File[]): Promise<Attachment[]> {
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const results: Attachment[] = [];
  for (const file of fileList) {
    if (file.size > MAX_FILE_SIZE) continue;
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    results.push({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      dataUrl,
      sizeBytes: file.size,
    });
  }
  return results;
}

export function ChatView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const activeId = useChatStore((s) => s.activeId);
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const notebookMode = useChatStore((s) => s.notebookMode);
  const workspaceHealthEnabled = useChatStore((s) => s.workspaceHealthEnabled);
  const workspacePath = useChatStore((s) => s.workspacePath);
  const designWorkspacePath = useChatStore((s) => s.designWorkspacePath);
  const artifactPanelOpen = useChatStore((s) => s.artifactPanelOpen);
  const activeArtifactId = useChatStore((s) => s.activeArtifactId);
  const artifacts = useChatStore((s) => (s.activeId ? s.artifacts[s.activeId] : undefined));
  const workspaceFile = useChatStore((s) => s.workspaceFile);
  const activeAttachment = useChatStore((s) => s.activeAttachment);
  const attachmentPanelOpen = useChatStore((s) => s.attachmentPanelOpen);
  const subagentPanelOpen = useChatStore((s) => s.subagentPanelOpen);
  const getModels = useChatStore((s) => s.getModels);
  const _hydrated = useChatStore((s) => s._hydrated);
  const addPendingDroppedFiles = useChatStore((s) => s.addPendingDroppedFiles);

  const [welcome, setWelcome] = useState<WelcomeMessageResult>(() => getWelcomeMessage());
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Refresh the welcome message on mount and every hour so it stays
  // time-of-day-appropriate for long-lived sessions.
  useEffect(() => {
    // Re-pick immediately to account for any time-since-render drift
    setWelcome(getWelcomeMessage());
    const interval = setInterval(() => setWelcome(getWelcomeMessage()), 3_600_000);
    return () => clearInterval(interval);
  }, []);

  const selectedArtifactExists =
    !!activeArtifactId && !!artifacts?.some((artifact) => artifact.id === activeArtifactId);
  const artifactCanvasRequested =
    !!workspaceFile || selectedArtifactExists || (!!artifactPanelOpen && !!artifacts?.length);
  const attachmentCanvasRequested = attachmentPanelOpen && !!activeAttachment;
  const canvasPanel = artifactCanvasRequested
    ? "artifact"
    : attachmentCanvasRequested
      ? "attachment"
      : null;
  const sidePanelOpen = canvasPanel !== null;
  const showHero = !activeId && !sidePanelOpen && !notebookMode;
  const availableModels = getModels().filter((m) => m.isAvailable);
  const needsSetup = _hydrated && availableModels.length === 0;
  const heroWorkspacePath = notebookMode ? null : agentMode ? workspacePath : designMode ? designWorkspacePath : null;
  const heroWorkspaceName = heroWorkspacePath?.split("/").pop() || heroWorkspacePath;

  // ── Window-level drag and drop ──

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const items = e.dataTransfer?.items;
    const droppedFiles = e.dataTransfer?.files;
    if (!items?.length && !droppedFiles?.length) return;

    // Walk DataTransferItems via webkitGetAsEntry when available so dropped
    // folders get expanded recursively. Falls back to flat file list when
    // the runtime lacks the entry API (older Edge / non-Webkit shells).
    const collected: File[] = [];
    let truncated = false;
    if (items && items.length > 0 && hasWebkitGetAsEntry(items[0])) {
      const entries = Array.from(items)
        .filter(hasWebkitGetAsEntry)
        .map((it) => it.webkitGetAsEntry())
        .filter((entry): entry is FileSystemEntry => entry !== null);
      for (const entry of entries) {
        const r = await entryToFiles(entry, collected, FOLDER_DROP_MAX_FILES);
        if (r.truncated) truncated = true;
        if (collected.length >= FOLDER_DROP_MAX_FILES) {
          truncated = true;
          break;
        }
      }
    } else if (droppedFiles && droppedFiles.length > 0) {
      collected.push(...Array.from(droppedFiles));
    }

    if (collected.length === 0) return;

    const attachments = await filesToAttachments(collected);
    if (attachments.length > 0) {
      addPendingDroppedFiles(attachments);
      if (truncated) {
        // 100 chips in the input bar makes the truncation visually obvious;
        // the console message helps anyone debugging "why didn't my whole
        // folder come through".
        console.info(
          `[ChatView] Folder drop truncated to ${FOLDER_DROP_MAX_FILES} files; vendor dirs (node_modules, .git, etc.) and binary files were skipped.`,
        );
      }
    }
  }, [addPendingDroppedFiles]);

  return (
    <div
      className="flex flex-col h-full relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Full-window drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#151516]/82 backdrop-blur-md animate-[fadeIn_150ms_ease]">
          <div className="liquid-surface flex flex-col items-center gap-3 p-8 rounded-2xl border border-[#f59e42]/35">
            <div className="w-12 h-12 rounded-full bg-[#f59e42]/10 border border-[#f59e42]/20 flex items-center justify-center shadow-[0_12px_34px_-20px_rgba(245,158,66,0.9)]">
              <Upload size={22} strokeWidth={1.75} className="text-[#f59e42]" />
            </div>
            <span className="text-[15px] font-medium text-[#f59e42]">Drop files here</span>
            <span className="text-[12px] text-[#a0a0a0]">Images, documents, code files…</span>
          </div>
        </div>
      )}
      <TopBar />
      {notebookMode ? (
        <NotebookView onOpenSettings={onOpenSettings} />
      ) : !showHero ? (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Subagent panel replaces chat when active */}
          {subagentPanelOpen ? (
            <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
              <SubagentPanel />
            </div>
          ) : (
            <>
              <div
                className={`min-w-0 min-h-0 overflow-hidden relative ${
                  sidePanelOpen
                    ? "basis-[34%] grow-0 shrink-0 flex flex-col"
                    : "flex-1 w-full grid min-h-0"
                }`}
                style={
                  sidePanelOpen
                    ? undefined
                    : {
                        gridTemplateColumns: "1fr min(860px, 100%) 1fr",
                        gridTemplateRows: "1fr auto",
                      }
                }
              >
                {!sidePanelOpen && (
                  <div className="col-start-1 row-span-full min-w-0" aria-hidden="true" />
                )}
                <div
                  className={
                    sidePanelOpen
                      ? "flex flex-1 min-h-0 flex-col overflow-hidden relative"
                      : "col-start-2 col-end-4 row-start-1 min-h-0 flex flex-col overflow-hidden relative"
                  }
                >
                  <TodoWidget />
                  <MessageList edgeScroll={!sidePanelOpen} />
                </div>
                <div
                  className={
                    sidePanelOpen
                      ? "shrink-0 mt-auto flex flex-col items-center w-[calc(100%_-_32px)] sm:w-full mx-auto pt-2 px-0 sm:px-6 pb-6 gap-3"
                      : "col-start-2 row-start-2 flex flex-col items-center w-[calc(100%_-_32px)] sm:w-full mx-auto pt-2 px-0 sm:px-6 pb-6 gap-3"
                  }
                >
                  <ActiveSkillsBar />
                  {agentMode && <ApprovalQueue />}
                  {agentMode && workspaceHealthEnabled && <WorkspaceHealthPanel />}
                  <ToolActivityIndicator />
                  <InputBar onOpenSettings={onOpenSettings} />
                </div>
              </div>
              {sidePanelOpen && (
                <div className="flex-1 min-h-0 p-2 pl-0 flex flex-col overflow-hidden">
                  {canvasPanel === "attachment" ? <AttachmentPanel /> : (
                    <SafeArtifactPanel resetKey={`${activeId ?? ""}:${activeArtifactId ?? ""}:${workspaceFile?.path ?? ""}`} />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {showHero && (
        <div className="shrink-0 flex flex-col items-center w-[calc(100%_-_32px)] sm:w-full max-w-[860px] mx-auto flex-1 justify-center px-0 sm:px-6 pb-6 gap-3 relative">
          <div className="flex flex-col items-center text-center -mt-10 animate-[fadeIn_320ms_ease]">
            {heroWorkspacePath ? (
              <div className="liquid-surface mb-8 inline-flex max-w-[min(520px,calc(100vw-48px))] items-center gap-2 rounded-full px-4 py-1.5 text-[13px] text-[#c9c9c9]">
                <Folder size={14} strokeWidth={1.75} className="shrink-0 text-[#f59e42]" aria-hidden="true" />
                <span className="text-[#a0a0a0]">
                  {agentMode ? "Working on" : designMode ? "Designing" : "Notebook"}
                </span>
                <span className="min-w-0 truncate font-medium text-[#ececec]">
                  {heroWorkspaceName}
                </span>
              </div>
            ) : (
              // Reserve space for workspace banner in chat mode for consistent spacing
              <div className="mb-8 h-[34px]" aria-hidden="true" />
            )}
            {needsSetup ? (
              <div className="mt-3 flex flex-col items-center gap-2 max-w-[480px]">
                <p className="text-[13px] text-[#a0a0a0] leading-relaxed">
                  No models configured yet. Add an API key in Settings to start chatting.
                </p>
                <button
                  onClick={onOpenSettings}
                  className="group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#f59e42]/12 border border-[#f59e42]/25 text-[#f59e42] text-[12.5px] font-medium hover:bg-[#f59e42]/18 hover:border-[#f59e42]/40 transition-colors"
                  aria-label="Open Settings to add a provider"
                >
                  <SettingsIcon size={13} strokeWidth={2} aria-hidden="true" />
                  Open Settings
                  <ArrowRight size={13} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <p className={`mb-2 w-full max-w-[620px] min-w-0 whitespace-normal break-words px-2 leading-snug [text-wrap:balance] ${
                  welcome.message.display
                    ? "text-[26px] max-[520px]:text-[20px] font-medium text-[#e8e4de]"
                    : "text-[20px] max-[520px]:text-[18px] text-[#c8c8c8]"
                }`}>
                  {welcome.message.emoji && (
                    <span className="mr-2" aria-hidden="true">{welcome.message.emoji}</span>
                  )}
                  {welcome.message.text}
                </p>
                <p className="mt-6 text-[13px] text-[#b4b4b4]">
                  Type below or use <kbd className="font-mono text-[11px] px-1.5 py-px rounded bg-white/[0.06] border border-white/[0.06] text-[#b4b4b4] tabular-nums">⌘N</kbd> for a fresh chat.
                </p>
              </>
            )}
          </div>
          <ActiveSkillsBar />
          <ToolActivityIndicator />
          <InputBar onOpenSettings={onOpenSettings} />
          <div className="flex min-h-[36px] w-full max-w-[720px] items-center gap-2 px-1 max-[520px]:flex-col max-[520px]:items-stretch">
            <ModeToggle />
            <div className="flex min-h-[26px] min-w-0 flex-1 items-center justify-start">
              {agentMode && <WorkspacePicker />}
              {designMode && <DesignWorkspacePicker />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
