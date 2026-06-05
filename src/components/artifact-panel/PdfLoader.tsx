import { getSandboxAttribute } from "./lib/sandbox";

interface PdfLoaderProps {
  dataUrl: string | null;
  error: string | null;
  loading: boolean;
  previewKey: number;
}

export function PdfLoader({ dataUrl, error, loading, previewKey }: PdfLoaderProps) {
  return (
    <>
      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 flex-1 text-[#a0a0a0]">
          <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[#f59e42] animate-spin" />
          <span className="text-[12.5px]">Compiling...</span>
          <span className="text-[11px] text-[#888888]">
            First run downloads the LaTeX engine (~30 MB)
          </span>
        </div>
      )}
      {dataUrl && (
        <iframe
          key={`latex-pdf-${previewKey}`}
          className="flex-1 w-full border-none"
          src={dataUrl}
          sandbox={getSandboxAttribute("none")}
          title="PDF Preview"
        />
      )}
      {error && (
        <div className="flex flex-col gap-2 p-4">
          <p className="text-[12px] text-[#f87171] whitespace-pre-wrap leading-relaxed">
            {error}
          </p>
        </div>
      )}
    </>
  );
}
