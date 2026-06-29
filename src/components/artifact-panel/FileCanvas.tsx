import { ChevronLeft, ChevronRight, FileCode, Globe, RotateCw, X } from "lucide-react";
import { MarkdownPreview } from "../MarkdownPreview";
import { ArtifactTabs } from "./ArtifactTabs";
import { getSandboxAttribute } from "./lib/sandbox";

export type WorkspaceFile = { path: string; name: string; content: string };

interface FileCanvasProps {
  file: WorkspaceFile;
  isPreviewable: boolean;
  resolvedContent: string | null;
  resolving: boolean;
  view: "preview" | "code";
  onClose: () => void;
  onViewChange: (view: "preview" | "code") => void;
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

function cssPreviewDocument(css: string) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 24px;
      font-family: Geist, Arial, sans-serif;
      background: #f5f5f5;
    }
    .preview-section {
      background: white;
      padding: 20px;
      margin-bottom: 16px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .preview-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #888;
      margin-bottom: 12px;
    }
  </style>
  <style id="user-css">${css}</style>
</head>
<body>
  <div class="preview-section">
    <div class="preview-label">Typography</div>
    <h1>Heading 1</h1>
    <h2>Heading 2</h2>
    <h3>Heading 3</h3>
    <p>Paragraph text with <strong>bold</strong> and <em>italic</em> styles. <a href="#">Link example</a></p>
  </div>
  <div class="preview-section">
    <div class="preview-label">Lists</div>
    <ul>
      <li>Unordered list item</li>
      <li>Another item</li>
    </ul>
    <ol>
      <li>Ordered list item</li>
      <li>Another item</li>
    </ol>
  </div>
  <div class="preview-section">
    <div class="preview-label">Buttons & Forms</div>
    <button>Button</button>
    <input type="text" placeholder="Input field">
    <select><option>Select</option></select>
  </div>
  <div class="preview-section">
    <div class="preview-label">Table</div>
    <table>
      <thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>
      <tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody>
    </table>
  </div>
  <div class="preview-section">
    <div class="preview-label">Custom Elements</div>
    <div class="card">Card example</div>
    <div class="container">Container example</div>
    <div class="box">Box example</div>
  </div>
</body>
</html>`;
}

function renderWorkspacePreview(file: WorkspaceFile, resolvedContent: string | null) {
  const content = resolvedContent ?? file.content;
  const extension = file.name.split(".").pop()?.toLowerCase() || "";

  if (["html", "htm"].includes(extension)) {
    return (
      <iframe
        key={`${file.path}-${content.length}`}
        className="flex-1 w-full border-none bg-white"
        srcDoc={`<base target="_blank">\n${content}`}
        sandbox={getSandboxAttribute("html")}
        title={file.name}
      />
    );
  }

  if (extension === "svg") {
    return (
      <iframe
        key={`${file.path}-${content.length}`}
        className="flex-1 w-full border-none bg-white"
        srcDoc={svgDocument(content)}
        sandbox={getSandboxAttribute("none")}
        title={file.name}
      />
    );
  }

  if (["md", "markdown"].includes(extension)) {
    return <MarkdownPreview content={content} />;
  }

  if (extension === "css") {
    return (
      <iframe
        key={`${file.path}-${content.length}`}
        className="flex-1 w-full border-none"
        srcDoc={cssPreviewDocument(content)}
        sandbox={getSandboxAttribute("none")}
        title={file.name}
      />
    );
  }

  return <CodeBody code={content} />;
}

function CodeBody({ code }: { code: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[#161618]">
      <pre className="p-4 text-[12.5px] leading-relaxed text-[#b4b4b4] whitespace-pre-wrap break-words font-mono">
        {code}
      </pre>
    </div>
  );
}

export function FileCanvas({
  file,
  isPreviewable,
  resolvedContent,
  resolving,
  view,
  onClose,
  onViewChange,
}: FileCanvasProps) {
  const preview = renderWorkspacePreview(file, resolvedContent);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] shrink-0">
        <FileCode size={13} strokeWidth={1.75} className="text-[#a0a0a0] shrink-0" />
        <span className="text-[13px] font-medium text-[#ececec] truncate">{file.name}</span>
        <span className="text-[10px] text-[#888888] truncate">{file.path}</span>
        <div className="flex-1" />
        {isPreviewable && <ArtifactTabs view={view} onChange={onViewChange} />}
        <button
          type="button"
          onClick={onClose}
          className="control-icon p-1 rounded transition-colors"
          aria-label="Close file"
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>

      {isPreviewable && view === "preview" ? (
        resolving ? (
          <div className="flex-1 relative">
            <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1c]/80 z-10">
              <div className="flex flex-col items-center gap-2 text-[#a0a0a0]">
                <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-accent animate-spin" />
                <span className="text-[11px]">Resolving references...</span>
              </div>
            </div>
            {preview}
          </div>
        ) : (
          preview
        )
      ) : (
        <CodeBody code={file.content} />
      )}
    </div>
  );
}

interface BrowserCanvasProps {
  history: string[];
  historyIndex: number;
  url: string;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (url: string) => void;
  onUrlChange: (url: string) => void;
}

export function BrowserCanvas({
  history,
  historyIndex,
  url,
  onBack,
  onForward,
  onNavigate,
  onUrlChange,
}: BrowserCanvasProps) {
  const currentUrl = history[historyIndex];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] bg-[#1a1a1c]/42 shrink-0">
        <button
          type="button"
          onClick={onBack}
          disabled={historyIndex <= 0}
          className="control-icon p-1 rounded transition-colors disabled:opacity-30"
          aria-label="Back"
        >
          <ChevronLeft size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onForward}
          disabled={historyIndex >= history.length - 1}
          className="control-icon p-1 rounded transition-colors disabled:opacity-30"
          aria-label="Forward"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => onUrlChange(currentUrl || "")}
          disabled={!url}
          className="control-icon p-1 rounded transition-colors disabled:opacity-30"
          aria-label="Reload"
        >
          <RotateCw size={13} strokeWidth={2} />
        </button>
        <input
          type="text"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onNavigate(url);
          }}
          placeholder="Enter URL or search..."
          className="flex-1 px-3 py-1.5 bg-white/[0.06] border border-white/[0.08] rounded-md text-[13px] text-[#ececec] placeholder:text-[#888888] focus:outline-none focus:border-accent/40"
        />
        <button
          type="button"
          onClick={() => onNavigate(url)}
          disabled={!url.trim()}
          className="px-3 py-1.5 bg-accent/20 hover:bg-accent/30 text-accent rounded-md text-[12px] font-medium transition-colors disabled:opacity-30"
        >
          Go
        </button>
      </div>

      {currentUrl ? (
        <iframe
          src={currentUrl}
          className="flex-1 w-full bg-white"
          sandbox={getSandboxAttribute("browser")}
          title="Browser view"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[#1a1a1c]">
          <div className="text-center text-[#888888]">
            <Globe size={48} strokeWidth={1.5} className="mx-auto mb-3 opacity-30" />
            <p className="text-[13px]">Enter a URL to browse</p>
          </div>
        </div>
      )}
    </div>
  );
}
