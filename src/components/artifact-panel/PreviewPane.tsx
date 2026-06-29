import { Code } from "lucide-react";
import type { ReactNode } from "react";
import type { Artifact } from "../../stores/chat";
import { MarkdownPreview } from "../MarkdownPreview";
import { OfficePreview } from "./OfficePreview";
import { PdfLoader } from "./PdfLoader";
import { PyRunner } from "./PyRunner";
import { getSandboxAttribute } from "./lib/sandbox";

interface PreviewPaneProps {
  artifact: Artifact;
  designMode: boolean;
  officeError: string | null;
  officeHtml: string | null;
  pdfDataUrl: string | null;
  pdfError: string | null;
  pdfLoading: boolean;
  previewKey: number;
  pyError: string | null;
  pyOutput: string | null;
  pyRunning: boolean;
  resolvedHtml: string | null;
  resolvingHtml: boolean;
  onRunPython: () => void;
}

function LoadingOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 relative">
      <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1c]/80 z-10">
        <div className="flex flex-col items-center gap-2 text-[#a0a0a0]">
          <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-accent animate-spin" />
          <span className="text-[11px]">Resolving references...</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function htmlWithBase(html: string, includeClickScript = false) {
  const base = '<base target="_blank">\n';
  if (!includeClickScript) return base + html;
  const clickScript =
    `<script>document.addEventListener('click',function(e){var a=e.target.closest('a');` +
    `if(a&&a.getAttribute('href')&&!/^(javascript:|#)/.test(a.getAttribute('href')||''))` +
    `{e.preventDefault();e.stopPropagation();window.open(a.href,'_blank','noopener,noreferrer')}},!0)</script>`;
  return base + html + clickScript;
}

function svgDocument(svg: string) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff; }
    svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>${svg}</body>
</html>`;
}

function CodeOnlyNotice({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-[#a0a0a0] p-8">
      <Code size={48} strokeWidth={1.5} className="mb-4 text-[#888888]" />
      <p className="text-[13px] text-center mb-2">{message}</p>
      <p className="text-[11px] text-[#888888] text-center">
        Switch to Code view to see the full source.
      </p>
    </div>
  );
}

export function PreviewPane({
  artifact,
  designMode,
  officeError,
  officeHtml,
  pdfDataUrl,
  pdfError,
  pdfLoading,
  previewKey,
  pyError,
  pyOutput,
  pyRunning,
  resolvedHtml,
  resolvingHtml,
  onRunPython,
}: PreviewPaneProps) {
  if (artifact.kind === "html") {
    const html = htmlWithBase(resolvedHtml ?? artifact.code, !designMode);
    const iframe = (
      <iframe
        key={`html-${previewKey}`}
        className="flex-1 w-full border-none bg-white"
        srcDoc={html}
        sandbox={getSandboxAttribute(designMode ? "html-design" : "html")}
        title={artifact.title}
      />
    );
    return resolvingHtml ? <LoadingOverlay>{iframe}</LoadingOverlay> : iframe;
  }

  if (artifact.kind === "latex") {
    return (
      <PdfLoader
        dataUrl={pdfDataUrl}
        error={pdfError}
        loading={pdfLoading}
        previewKey={previewKey}
      />
    );
  }

  if (artifact.kind === "python") {
    return (
      <PyRunner
        error={pyError}
        output={pyOutput}
        running={pyRunning}
        onRun={onRunPython}
      />
    );
  }

  if (artifact.kind === "docx" || artifact.kind === "pptx" || artifact.kind === "xlsx") {
    return (
      <OfficePreview
        artifactId={artifact.id}
        error={officeError}
        html={officeHtml}
        previewKey={previewKey}
        title={artifact.title}
      />
    );
  }

  if (artifact.kind === "deck" || artifact.kind === "mini-app") {
    const iframe = (
      <iframe
        key={`deck-${previewKey}`}
        className="flex-1 w-full border-none bg-white"
        srcDoc={htmlWithBase(resolvedHtml ?? artifact.code)}
        sandbox={getSandboxAttribute("html")}
        title={artifact.title}
      />
    );
    return resolvingHtml ? <LoadingOverlay>{iframe}</LoadingOverlay> : iframe;
  }

  if (artifact.kind === "svg") {
    return (
      <iframe
        key={`preview-${previewKey}`}
        className="flex-1 w-full border-none bg-white"
        srcDoc={svgDocument(artifact.code)}
        sandbox={getSandboxAttribute("none")}
        title={artifact.title}
      />
    );
  }

  if (artifact.kind === "image") {
    return (
      <div className="flex-1 min-h-0 overflow-auto bg-[#161618]">
        <div className="min-h-full flex items-center justify-center p-6">
          <img
            src={artifact.code}
            alt={artifact.title}
            className="max-h-full max-w-full rounded-xl border border-white/10 bg-black object-contain shadow-[0_28px_80px_-34px_rgba(0,0,0,0.95)]"
          />
        </div>
      </div>
    );
  }

  if (artifact.kind === "markdown-document" || artifact.kind === "design-system") {
    return <MarkdownPreview content={artifact.code} />;
  }

  if (artifact.kind === "react-component") {
    return <CodeOnlyNotice message="React components are best viewed in code mode." />;
  }
  if (artifact.kind === "diagram") {
    return <CodeOnlyNotice message="Diagrams are best viewed in code mode." />;
  }
  if (artifact.kind === "code-snippet") {
    return <CodeOnlyNotice message="Code snippets are best viewed in code mode." />;
  }

  return <CodeOnlyNotice message="Preview is not available for this artifact type." />;
}
