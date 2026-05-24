import { useEffect, useState, lazy, Suspense, useMemo } from "react";
import { useChatStore, type Attachment } from "../stores/chat";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { extractAttachment, classify } from "../lib/attachment-extract";
import { Copy, Download, X, FileCode, FileText, FileSpreadsheet, FileArchive, File as FileIcon, Image as ImageIcon, Columns } from "lucide-react";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.default })),
);

// ── Helpers ──

function getIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.endsWith("xml") ||
    mimeType.endsWith("yaml") ||
    mimeType === "application/javascript"
  )
    return FileCode;
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("excel")) return FileSpreadsheet;
  if (
    mimeType.includes("zip") ||
    mimeType.includes("tar") ||
    mimeType.includes("gzip") ||
    mimeType.includes("rar") ||
    mimeType.includes("7z")
  )
    return FileArchive;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("word")) return FileText;
  return FileIcon;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  h: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  md: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  xml: "xml",
  svg: "xml",
};

function extOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function detectLanguage(filename: string, mimeType: string): string {
  const ext = extOf(filename);
  if (ext && EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];
  if (mimeType === "application/json") return "json";
  if (mimeType === "application/javascript") return "javascript";
  if (mimeType.endsWith("xml")) return "xml";
  if (mimeType.endsWith("yaml")) return "yaml";
  if (mimeType.startsWith("text/markdown")) return "markdown";
  if (mimeType.startsWith("text/html")) return "html";
  if (mimeType.startsWith("text/css")) return "css";
  return "plaintext";
}

function isTextLike(mime: string, filename: string): boolean {
  const ext = extOf(filename);
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json") return true;
  if (mime === "application/javascript") return true;
  if (mime.endsWith("xml")) return true;
  if (mime.endsWith("yaml")) return true;
  // Sometimes the OS reports `application/octet-stream` for known code extensions.
  if (ext && ext in EXT_TO_LANG) return true;
  return false;
}

/** Binary attachment kinds that we extract through the Rust/JS pipeline so the
 *  side panel can show the same text the model sees. PDFs are excluded — they
 *  have a dedicated iframe preview. */
function isExtractable(a: Attachment): boolean {
  const k = classify(a);
  return k === "docx" || k === "pptx" || k === "xlsx" || k === "ipynb" || k === "rtf";
}

type PreviewKind = "html" | "markdown" | "svg" | "pdf" | null;

/** What kind of rich preview, if any, can we render for this file? */
function detectPreviewKind(a: Attachment): PreviewKind {
  const ext = extOf(a.filename);
  if (a.mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (a.mimeType.startsWith("text/html") || ext === "html" || ext === "htm") return "html";
  if (a.mimeType.startsWith("image/svg") || ext === "svg") return "svg";
  if (a.mimeType.startsWith("text/markdown") || ext === "md" || ext === "markdown") return "markdown";
  return null;
}

/** Decode a `data:` URL to text. Returns null on failure. */
async function dataUrlToText(dataUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(dataUrl);
    return await resp.text();
  } catch {
    return null;
  }
}

// ── Side panel ──

export function AttachmentPanel() {
  const attachment = useChatStore((s) => s.activeAttachment);
  const open = useChatStore((s) => s.attachmentPanelOpen);
  const close = useChatStore((s) => s.setActiveAttachment);

  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** When a preview is available, the user can flip between code and preview.
   * We default to code so opening an attached `index.html` shows the source
   * first; the toggle button surfaces the rich preview on demand. */
  const [showPreview, setShowPreview] = useState(false);

  const isImage = !!attachment && attachment.mimeType.startsWith("image/") && !attachment.mimeType.startsWith("image/svg");
  const isText = !!attachment && isTextLike(attachment.mimeType, attachment.filename);
  const isExtracted = !!attachment && isExtractable(attachment);
  const previewKind = useMemo<PreviewKind>(() => (attachment ? detectPreviewKind(attachment) : null), [attachment]);
  const language = useMemo(
    () => (attachment ? detectLanguage(attachment.filename, attachment.mimeType) : "plaintext"),
    [attachment],
  );

  // Reset transient state when the active attachment changes.
  useEffect(() => {
    setShowPreview(false);
    setText(null);
    setError(null);
    setCopied(false);
  }, [attachment?.dataUrl, attachment?.filename]);

  // Load the file body into a string when a text-like attachment becomes active.
  useEffect(() => {
    if (!attachment || !isText) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const body = await dataUrlToText(attachment.dataUrl);
      if (cancelled) return;
      if (body === null) setError("Couldn't read file contents.");
      else setText(body);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment, isText]);

  // For binary docs (Word/Slides/Excel/Notebook/RTF) run the same extractor the
  // send pipeline uses so the panel preview matches what the model sees.
  useEffect(() => {
    if (!attachment || !isExtracted) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await extractAttachment(attachment);
        if (cancelled) return;
        // Strip the leading `[Kind: filename]\n` header — the panel already
        // shows filename and size in the toolbar.
        const body = res.inlinedText.replace(/^\[[^\]]+\]\n?/, "");
        setText(body || "(no extractable text)");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment, isExtracted]);

  if (!attachment || !open) return null;

  const Icon = getIcon(attachment.mimeType);
  const canPreview = previewKind !== null;
  // PDFs only show the preview — there's no useful code view of a binary blob.
  const previewOnly = previewKind === "pdf";
  const effectiveShowPreview = previewOnly ? true : showPreview;

  const handleCopy = () => {
    if (text === null) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = attachment.dataUrl;
    a.download = attachment.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1c1c1e] animate-[fadeIn_120ms_ease]">
      <div className="h-[32px] shrink-0" data-tauri-drag-region />
      {/* Top bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-white/5 shrink-0">
        <Icon size={13} strokeWidth={1.75} className="text-[#a0a0a0]" />
        <span className="text-[13px] font-medium text-[#ececec] truncate">{attachment.filename}</span>
        <span className="text-[10px] text-[#a0a0a0] bg-white/5 px-1.5 py-0.5 rounded">{formatFileSize(attachment.sizeBytes)}</span>
        <div className="flex-1" />
        {canPreview && !previewOnly && (
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors"
            title={effectiveShowPreview ? "View source code" : "Render preview"}
          >
            <Columns size={12} /> {effectiveShowPreview ? "View code" : "View preview"}
          </button>
        )}
        {isText && text !== null && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors"
          >
            <Copy size={12} /> {copied ? "Copied" : "Copy"}
          </button>
        )}
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-[#8e8e8e] hover:text-[#ececec] hover:bg-white/5 transition-colors"
        >
          <Download size={12} /> Save
        </button>
        <button
          onClick={() => close(null)}
          aria-label="Close attachment panel"
          className="p-1 rounded text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors ml-1"
        >
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Rich preview takes priority when toggled on. */}
        {canPreview && effectiveShowPreview && (
          <PreviewSurface kind={previewKind!} attachment={attachment} text={text} />
        )}

        {/* Image (raster) attachments — always show the picture. */}
        {!effectiveShowPreview && isImage && (
          <div className="flex-1 min-h-0 flex items-center justify-center bg-[#0f0f10] p-4 overflow-auto">
            <img src={attachment.dataUrl} alt={attachment.filename} className="max-w-full max-h-full object-contain" />
          </div>
        )}

        {/* Text/code source view (also covers extracted docx/pptx/xlsx/ipynb/rtf). */}
        {!effectiveShowPreview && (isText || isExtracted) && (
          <>
            {loading && (
              <div className="flex-1 flex items-center justify-center text-[12px] text-[#a0a0a0]">Loading…</div>
            )}
            {error && (
              <div className="flex-1 flex items-center justify-center text-[12px] text-[#f87171]">{error}</div>
            )}
            {text !== null && !loading && !error && (
              <Suspense
                fallback={
                  <div className="flex-1 flex items-center justify-center text-[12px] text-[#a0a0a0]">Loading editor…</div>
                }
              >
                <MonacoEditor
                  height="100%"
                  defaultLanguage={language}
                  language={language}
                  value={text}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    tabSize: 2,
                    automaticLayout: true,
                    renderLineHighlight: "line",
                    lineNumbers: "on",
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              </Suspense>
            )}
          </>
        )}

        {/* Unknown binary fallback. */}
        {!effectiveShowPreview && !isImage && !isText && !isExtracted && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
            <Icon size={32} strokeWidth={1.5} className="text-[#5a5a5a]" />
            <span className="text-[13px] text-[#d5d5d5]">No preview available</span>
            <span className="text-[12px] text-[#888]">
              {attachment.mimeType || "Unknown type"} · {formatFileSize(attachment.sizeBytes)}
            </span>
            <button
              onClick={handleDownload}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[12px] text-[#ececec] hover:bg-white/[0.1] transition-colors"
            >
              <Download size={12} /> Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Preview surfaces ──

function PreviewSurface({
  kind,
  attachment,
  text,
}: {
  kind: PreviewKind;
  attachment: Attachment;
  text: string | null;
}) {
  if (kind === "pdf") {
    return <iframe className="flex-1 w-full border-none bg-white" src={attachment.dataUrl} title={attachment.filename} />;
  }
  if (kind === "html") {
    if (text === null) {
      return <div className="flex-1 flex items-center justify-center text-[12px] text-[#a0a0a0]">Loading preview…</div>;
    }
    // Sandbox without `allow-same-origin` so the page can't reach the local
    // app's storage — still allows scripts so the user's HTML behaves naturally.
    return (
      <iframe
        className="flex-1 w-full border-none bg-white"
        srcDoc={text}
        sandbox="allow-scripts allow-forms allow-popups"
        title={attachment.filename}
      />
    );
  }
  if (kind === "svg") {
    if (text === null) {
      return <div className="flex-1 flex items-center justify-center text-[12px] text-[#a0a0a0]">Loading preview…</div>;
    }
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-[#0f0f10] p-4 overflow-auto">
        {/* eslint-disable-next-line react/no-danger */}
        <div
          className="max-w-full max-h-full [&>svg]:max-w-full [&>svg]:max-h-full"
          dangerouslySetInnerHTML={{ __html: text }}
        />
      </div>
    );
  }
  if (kind === "markdown") {
    if (text === null) {
      return <div className="flex-1 flex items-center justify-center text-[12px] text-[#a0a0a0]">Loading preview…</div>;
    }
    return (
      <div className="flex-1 min-h-0 overflow-auto px-6 py-5">
        <MarkdownRenderer content={text} />
      </div>
    );
  }
  return null;
}

/** Programmatic helper used by chips to open an attachment in the side panel. */
export function openAttachment(a: Attachment) {
  useChatStore.getState().setActiveAttachment(a);
}
