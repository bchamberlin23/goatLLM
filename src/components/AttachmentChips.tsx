import { memo } from "react";
import { FileText, FileCode, File as FileIcon, FileSpreadsheet, FileArchive, FileAudio, Image as ImageIcon } from "lucide-react";
import { useChatStore, type Attachment } from "../stores/chat";

function getFileIcon(mimeType: string, filename = "") {
  if (mimeType.startsWith("image/")) return ImageIcon;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType.startsWith("audio/") || /^(mp3|m4a|wav|flac|ogg|aac|webm)$/.test(ext)) return FileAudio;
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.endsWith("xml") ||
    mimeType.endsWith("yaml") ||
    mimeType === "application/javascript"
  )
    return FileCode;
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("csv") ||
    mimeType.includes("excel") ||
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "csv"
  )
    return FileSpreadsheet;
  if (
    mimeType.includes("zip") ||
    mimeType.includes("tar") ||
    mimeType.includes("gzip") ||
    mimeType.includes("rar") ||
    mimeType.includes("7z")
  )
    return FileArchive;
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("word") ||
    mimeType.includes("presentation") ||
    ext === "pdf" ||
    ext === "docx" ||
    ext === "doc" ||
    ext === "pptx" ||
    ext === "ppt" ||
    ext === "rtf" ||
    ext === "ipynb"
  )
    return FileText;
  return FileIcon;
}

function getFileExtColor(mimeType: string, filename = ""): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType.startsWith("image/")) return "#a78bfa";
  if (mimeType.startsWith("audio/") || /^(mp3|m4a|wav|flac|ogg|aac|webm)$/.test(ext)) return "#f472b6"; // pink
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.includes("javascript")) return "#60a5fa";
  if (mimeType.includes("pdf") || ext === "pdf") return "#f87171"; // red
  if (mimeType.includes("word") || ext === "docx" || ext === "doc") return "#3b82f6"; // blue
  if (mimeType.includes("presentation") || ext === "pptx" || ext === "ppt") return "#fb923c"; // orange
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("excel") || ext === "xlsx" || ext === "xls" || ext === "csv") return "#34d399"; // green
  if (ext === "ipynb") return "#f59e0b"; // jupyter amber
  if (ext === "rtf") return "#94a3b8";
  if (mimeType.includes("zip") || mimeType.includes("tar")) return "#fbbf24";
  return "#a0a0a0";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileLabel(name: string): string {
  // Show extension subtly above icons later if we want; for now just show the
  // filename truncated by CSS.
  return name;
}

interface AttachmentChipsProps {
  attachments: Attachment[];
  /** "compact" renders smaller chips for inside a message bubble. */
  variant?: "default" | "compact";
}

/** Pretty chip strip used in the message bubble for files the user attached.
 * Matches the input bar's chips so the affordance feels continuous from
 * compose → sent. */
export const AttachmentChips = memo(function AttachmentChips({ attachments, variant = "compact" }: AttachmentChipsProps) {
  const setActiveAttachment = useChatStore((s) => s.setActiveAttachment);
  if (!attachments || attachments.length === 0) return null;

  const compact = variant === "compact";
  const thumbSize = compact ? "w-8 h-8" : "w-9 h-9";
  const padding = compact ? "px-2.5 py-1.5" : "px-3 py-2";
  const nameSize = compact ? "text-[12px]" : "text-[12px]";
  const sizeText = compact ? "text-[10px]" : "text-[10.5px]";

  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {attachments.map((a, i) => {
        const isImage = a.mimeType.startsWith("image/");
        const Icon = getFileIcon(a.mimeType, a.filename);
        const color = getFileExtColor(a.mimeType, a.filename);

        return (
          <button
            key={`${a.filename}-${i}`}
            type="button"
            onClick={() => setActiveAttachment(a)}
            className={`flex items-center gap-2 ${padding} bg-white/[0.05] border border-white/[0.07] rounded-xl max-w-[220px] hover:bg-white/[0.08] hover:border-white/[0.12] transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20`}
            title={`Open ${a.filename}`}
            aria-label={`Open ${a.filename}`}
          >
            {isImage ? (
              <img
                src={a.dataUrl}
                alt={a.filename}
                className={`${thumbSize} rounded-lg object-cover shrink-0 border border-white/10`}
              />
            ) : (
              <div
                className={`${thumbSize} rounded-lg flex items-center justify-center shrink-0`}
                style={{ backgroundColor: `${color}1f`, border: `1px solid ${color}30` }}
              >
                <Icon size={14} strokeWidth={1.75} style={{ color }} />
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <span className={`${nameSize} font-medium text-[#d5d5d5] truncate leading-tight`}>{fileLabel(a.filename)}</span>
              <span className={`${sizeText} text-[#888] leading-tight mt-0.5`}>{formatFileSize(a.sizeBytes)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
});

/** Strip the inlined attachment marker blocks (`[File: ...]\n<body>`,
 * `[PDF: ...]\n<body>`, `[Word: ...]\n<body>`, `[Slides: ...]\n<body>`,
 * `[Spreadsheet: ...]\n<body>`, `[Notebook: ...]\n<body>`,
 * `[RTF: ...]\n<body>`) and the one-liner `[Attached: ...]` notes baked
 * into displayContent by the InputBar send pipeline. Keeps just the user's
 * prose, since the chip strip already conveys what's attached. */
export function stripAttachmentMarkers(content: string): string {
  if (!content) return "";

  // Names of all marker prefixes we recognize. Body markers (everything
  // except `Attached:`) consume content until the next marker.
  const BODY_MARKERS = ["File", "PDF", "Word", "Slides", "Spreadsheet", "Notebook", "RTF", "Image OCR", "Web", "YouTube", "Audio"];
  // Lookahead matches any marker prefix preceded by a newline OR end-of-string.
  const lookahead = `(?=\\n\\[(?:${[...BODY_MARKERS, "Attached"].join("|")}): |$)`;

  let out = content;
  for (const name of BODY_MARKERS) {
    const re = new RegExp(`\\[${name}: [^\\]]+\\][\\s\\S]*?${lookahead}`, "g");
    out = out.replace(re, "");
  }

  // Remove `[Attached: ...]` lines (one-liners with size).
  out = out.replace(/\n?\[Attached: [^\]]+\]/g, "");
  out = out.replace(/\n?\[Heads up\][\s\S]*?(?=\n\[|$)/g, "");
  out = out.replace(/\n?\[Image: [^\]]+\] \(OCR failed:[^)]+\)/g, "");

  return out.replace(/^\s+|\s+$/g, "");
}
