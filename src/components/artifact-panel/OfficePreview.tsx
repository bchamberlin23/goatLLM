import { getSandboxAttribute } from "./lib/sandbox";

interface OfficePreviewProps {
  error: string | null;
  html: string | null;
  previewKey: number;
  title: string;
  artifactId: string;
}

export function OfficePreview({ artifactId, error, html, previewKey, title }: OfficePreviewProps) {
  if (error) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <p className="text-[12px] text-[#f87171] whitespace-pre-wrap leading-relaxed">
          {error}
        </p>
      </div>
    );
  }

  if (!html) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 flex-1 text-[#a0a0a0]">
        <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[#f59e42] animate-spin" />
        <span className="text-[12.5px]">Rendering preview...</span>
      </div>
    );
  }

  return (
    <iframe
      key={`office-${artifactId}-${previewKey}`}
      className="flex-1 w-full border-none"
      srcDoc={html}
      sandbox={getSandboxAttribute("office")}
      title={title}
    />
  );
}
