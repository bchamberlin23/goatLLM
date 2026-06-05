import { File, FileArchive, FileAudio, FileCode, FileSpreadsheet, FileText, Image as ImageIcon, X } from "lucide-react";
import type { Attachment } from "../../stores/chat";

function getFileIcon(mimeType: string, filename = "") {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.startsWith("audio/") || /^(mp3|m4a|wav|flac|ogg|aac|webm)$/.test(ext)) return FileAudio;
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.endsWith("xml") || mimeType.endsWith("yaml") || mimeType === "application/javascript") return FileCode;
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("excel") || ext === "xlsx" || ext === "xls" || ext === "csv") return FileSpreadsheet;
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("gzip") || mimeType.includes("rar") || mimeType.includes("7z")) return FileArchive;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("word") || mimeType.includes("presentation") || ext === "pdf" || ext === "docx" || ext === "doc" || ext === "pptx" || ext === "ppt" || ext === "rtf" || ext === "ipynb") return FileText;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return String(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function getFileExtColor(mimeType: string, filename = ""): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType.startsWith("image/")) return "#a78bfa";
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.includes("javascript")) return "#60a5fa";
  if (mimeType.includes("pdf") || ext === "pdf") return "#f87171";
  if (mimeType.includes("word") || ext === "docx" || ext === "doc") return "#3b82f6";
  if (mimeType.includes("presentation") || ext === "pptx" || ext === "ppt") return "#fb923c";
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("excel") || ext === "xlsx" || ext === "xls" || ext === "csv") return "#34d399";
  if (ext === "ipynb") return "#f59e0b";
  if (ext === "rtf") return "#94a3b8";
  if (mimeType.includes("zip") || mimeType.includes("tar")) return "#fbbf24";
  return "#a0a0a0";
}

interface AttachmentChipsProps {
  files: Attachment[];
  onRemove: (index: number) => void;
}

export function AttachmentChips({ files, onRemove }: AttachmentChipsProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {files.map((file, index) => {
        const isImage = file.mimeType.startsWith("image/");
        const Icon = getFileIcon(file.mimeType, file.filename);
        const color = getFileExtColor(file.mimeType, file.filename);

        return (
          <div key={file.filename + "-" + index} className="soft-card motion-feedback motion-reveal group/file relative flex items-center gap-2.5 px-3 py-2 rounded-xl hover:border-white/[0.12] hover:bg-white/[0.055] transition-[background,border-color,box-shadow,transform] max-w-[220px]">
            {isImage ? (
              <img src={file.dataUrl} alt={file.filename} className="w-9 h-9 rounded-lg object-cover shrink-0 border border-white/10" />
            ) : (
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: color + "12", border: "1px solid " + color + "25" }}>
                <Icon size={16} strokeWidth={1.75} style={{ color }} />
              </div>
            )}
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[12px] font-medium text-[#d5d5d5] truncate leading-tight">{file.filename}</span>
              <span className="text-[10.5px] text-[#888] leading-tight mt-0.5">{formatFileSize(file.sizeBytes)}</span>
            </div>
            <button onClick={() => onRemove(index)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#343437] border border-white/10 flex items-center justify-center text-[#a0a0a0] hover:text-[#f87171] hover:bg-[#4a2020] hover:border-red-500/30 opacity-0 group-hover/file:opacity-100 focus:opacity-100 transition-all shadow-sm" aria-label={"Remove " + file.filename} type="button">
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
