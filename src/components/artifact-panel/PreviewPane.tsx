import { Code } from "lucide-react";
import type { ReactNode } from "react";
import type { Artifact } from "../../stores/chat";
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
          <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-[#f59e42] animate-spin" />
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

function markdownDocument(markdown: string) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 32px;
      font-family: Geist, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
    }
    h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
    h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    code { background: rgba(27,31,35,0.05); padding: 0.2em 0.4em; border-radius: 3px; font-size: 85%; }
    pre { background: #f6f8fa; padding: 16px; overflow: auto; font-size: 85%; line-height: 1.45; border-radius: 3px; }
    pre code { background: transparent; padding: 0; }
    blockquote { margin: 0; padding: 0 1em; color: #6a737d; border-left: 0.25em solid #dfe2e5; }
    table { border-spacing: 0; border-collapse: collapse; margin-top: 0; margin-bottom: 16px; }
    table th, table td { padding: 6px 13px; border: 1px solid #dfe2e5; }
    table th { font-weight: 600; background: #f6f8fa; }
  </style>
</head>
<body>
  <div id="content"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    const md = ${JSON.stringify(markdown)};
    document.getElementById('content').innerHTML = marked.parse(md);
  </script>
</body>
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
    return (
      <iframe
        key={`preview-${previewKey}`}
        className="flex-1 w-full border-none bg-white"
        srcDoc={markdownDocument(artifact.code)}
        sandbox={getSandboxAttribute("none")}
        title={artifact.title}
      />
    );
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
