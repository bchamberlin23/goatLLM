import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Code2, Copy, Check, Maximize2, Minimize2, RotateCw, Sparkles } from "lucide-react";

/**
 * Inline widget — a model-authored, self-contained HTML/CSS/JS snippet that
 * renders LIVE in the flow of the reply (not the side-panel canvas). One
 * primitive covers charts, diagrams, animations, simulations, calculators,
 * and small interactive demos.
 *
 * Security: the body runs in a sandboxed iframe WITHOUT `allow-same-origin`,
 * so it can't reach goatLLM's storage, cookies, or DOM. Scripts are allowed so
 * the widget actually behaves, but it's boxed off from the host app. The frame
 * auto-sizes to its content via a tiny injected postMessage bridge (the parent
 * can't read a cross-origin frame's height directly).
 */

const FRAME_SANDBOX = "allow-scripts allow-popups allow-forms allow-modals allow-pointer-lock";
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 640;

const SCAFFOLD_STYLE = `:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Geist,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#ececec;background:transparent;padding:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:#f59e42}
code,pre{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}`;

function resizeBridge(widgetId: string): string {
  // Injected into every widget so the host can size the frame. Kept tiny and
  // defensive — a widget that throws shouldn't break the measurement.
  return `<script>(function(){
  var id=${JSON.stringify(widgetId)};
  function measure(){
    var b=document.body,e=document.documentElement;
    return Math.max(b?b.scrollHeight:0,b?b.offsetHeight:0,e?e.scrollHeight:0,e?e.offsetHeight:0);
  }
  function post(){try{parent.postMessage({source:"goatllm-widget",id:id,height:measure()},"*");}catch(_){}}
  window.addEventListener("load",post);
  window.addEventListener("resize",post);
  document.addEventListener("DOMContentLoaded",post);
  try{var ro=new ResizeObserver(post);ro.observe(document.documentElement);if(document.body)ro.observe(document.body);}catch(_){}
  [60,200,500,1200].forEach(function(t){setTimeout(post,t);});
})();</script>`;
}

/** True when the body already looks like a full HTML document. */
function isFullDocument(code: string): boolean {
  return /<!doctype html|<html[\s>]/i.test(code);
}

/**
 * Build the iframe srcDoc: inject a <base target="_blank"> (so links don't
 * navigate the frame) and the resize bridge. Snippet-style bodies are wrapped
 * in a dark-friendly scaffold; full documents are left intact aside from the
 * injected base + bridge.
 */
function buildSrcDoc(code: string, widgetId: string): string {
  const bridge = resizeBridge(widgetId);
  if (isFullDocument(code)) {
    let out = code;
    if (/<head[\s>]/i.test(out)) {
      out = out.replace(/<head([^>]*)>/i, `<head$1><base target="_blank">`);
    } else if (/<html[^>]*>/i.test(out)) {
      out = out.replace(/<html([^>]*)>/i, `<html$1><head><base target="_blank"></head>`);
    }
    if (/<\/body>/i.test(out)) {
      out = out.replace(/<\/body>/i, `${bridge}</body>`);
    } else {
      out += bridge;
    }
    return out;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"><style>${SCAFFOLD_STYLE}</style></head><body>${code}${bridge}</body></html>`;
}

interface InlineWidgetProps {
  code: string;
  title?: string;
}

export const InlineWidget = memo(function InlineWidget({ code, title }: InlineWidgetProps) {
  const reactId = useId();
  const widgetId = useMemo(() => `w${reactId.replace(/[^a-zA-Z0-9]/g, "")}`, [reactId]);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const srcDoc = useMemo(() => buildSrcDoc(code, widgetId), [code, widgetId]);

  // Listen for the frame's height reports. Cross-origin (sandbox, no
  // same-origin) means postMessage is the only channel.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.source !== "goatllm-widget" || data.id !== widgetId) return;
      const h = Number(data.height);
      if (Number.isFinite(h) && h > 0) {
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(h))));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [widgetId]);

  // Escape closes the fullscreen overlay.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    }, () => {});
  }, [code]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const frame = (
    <iframe
      key={`${widgetId}-${reloadKey}`}
      className="w-full border-none bg-transparent block"
      style={{ height: expanded ? "100%" : height }}
      srcDoc={srcDoc}
      sandbox={FRAME_SANDBOX}
      title={title || "Inline widget"}
      loading="lazy"
    />
  );

  const headerLabel = title?.trim() || "Widget";

  return (
    <>
      <div className="my-2 rounded-xl border border-white/[0.06] bg-[#161618] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-center gap-2 px-3 h-9 border-b border-white/[0.06] bg-white/[0.015]">
          <Sparkles size={12} strokeWidth={1.9} className="text-accent/70 shrink-0" aria-hidden="true" />
          <span className="text-[11.5px] font-medium text-[#d5d5d5] truncate flex-1">{headerLabel}</span>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setView((v) => (v === "preview" ? "code" : "preview"))}
              className={`control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors ${view === "code" ? "text-accent" : ""}`}
              aria-label={view === "code" ? "Show preview" : "Show code"}
              title={view === "code" ? "Preview" : "View code"}
            >
              <Code2 size={13} strokeWidth={1.7} aria-hidden="true" />
            </button>
            {view === "preview" && (
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors"
                aria-label="Re-run widget"
                title="Re-run"
              >
                <RotateCw size={12.5} strokeWidth={1.7} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors"
              aria-label={copied ? "Copied" : "Copy code"}
              title={copied ? "Copied" : "Copy code"}
            >
              {copied ? (
                <Check size={13} strokeWidth={2} className="text-[#34d399]" aria-hidden="true" />
              ) : (
                <Copy size={12.5} strokeWidth={1.7} aria-hidden="true" />
              )}
            </button>
            {view === "preview" && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="control-icon w-6 h-6 flex items-center justify-center rounded-md transition-colors"
                aria-label="Expand widget to fullscreen"
                title="Fullscreen"
              >
                <Maximize2 size={12.5} strokeWidth={1.7} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {view === "preview" ? (
          <div className="w-full bg-transparent" style={{ maxHeight: MAX_HEIGHT, overflow: "auto" }}>
            {!expanded && frame}
          </div>
        ) : (
          <pre className="m-0 max-h-[420px] overflow-auto px-3.5 py-3 text-[12px] leading-relaxed text-[#cfcfcf] font-mono whitespace-pre-wrap break-words">
            <code>{code}</code>
          </pre>
        )}
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/70 backdrop-blur-sm animate-[fadeIn_180ms_ease]"
          role="dialog"
          aria-modal="true"
          aria-label={`${headerLabel} — fullscreen`}
        >
          <div className="flex items-center gap-2 px-4 h-11 border-b border-white/[0.08] bg-[#1a1a1c]">
            <Sparkles size={13} strokeWidth={1.9} className="text-accent/70 shrink-0" aria-hidden="true" />
            <span className="text-[12.5px] font-medium text-[#ececec] truncate flex-1">{headerLabel}</span>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="control-icon w-7 h-7 flex items-center justify-center rounded-md transition-colors"
              aria-label="Re-run widget"
              title="Re-run"
            >
              <RotateCw size={14} strokeWidth={1.7} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="control-icon w-7 h-7 flex items-center justify-center rounded-md transition-colors"
              aria-label="Exit fullscreen"
              title="Close (Esc)"
            >
              <Minimize2 size={14} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
          <div className="flex-1 min-h-0 bg-[#161618]">{frame}</div>
        </div>
      )}
    </>
  );
});

/**
 * Streaming placeholder shown while a widget fence is still being authored.
 * Mirrors the artifact placeholder card so the reply doesn't jump around when
 * the live frame swaps in.
 */
export function InlineWidgetPlaceholder({ title }: { title?: string }) {
  return (
    <div className="my-2 rounded-xl border border-white/[0.06] bg-[#161618] overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-white/[0.06] bg-white/[0.015]">
        <Sparkles size={12} strokeWidth={1.9} className="text-accent/70 shrink-0" aria-hidden="true" />
        <span className="text-[11.5px] font-medium text-[#d5d5d5] truncate flex-1">
          {title?.trim() || "Widget"}
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-[pulse-soft_1.6s_ease-in-out_infinite] shrink-0" />
      </div>
      <div className="px-3.5 py-4 text-[12px] text-[#a0a0a0] thinking-line">Building widget…</div>
    </div>
  );
}
