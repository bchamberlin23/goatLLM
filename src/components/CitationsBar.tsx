import { useEffect, useRef, useState } from "react";
import { BookText, Globe, FileText, ArrowUpRight } from "lucide-react";
import type { Citation } from "../stores/chat";

/**
 * Per-message "Sources" affordance (chat mode only). Shows the sources the
 * assistant actually cited inline this turn — web search results and attached
 * documents the model referenced with a `[n]` marker. Click to expand a
 * popover listing each source; web entries open in the browser.
 *
 * Mirrors ContextMeter's click-to-expand popover pattern and the DESIGN.md
 * token system (surfaces, hairline, single amber accent, Geist/JetBrains).
 */
export function CitationsBar({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!citations || citations.length === 0) return null;

  const count = citations.length;

  return (
    <div className="relative mt-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
          open
            ? "bg-accent/10 border-accent/25 text-accent"
            : "bg-white/5 border-hairline text-text-3 hover:bg-white/10 hover:text-text-2 hover:border-hairline-strong"
        }`}
        aria-label={`${count} source${count === 1 ? "" : "s"} cited — show details`}
        aria-expanded={open}
        title="Sources cited in this response"
      >
        <BookText size={12} strokeWidth={1.75} aria-hidden="true" />
        <span>
          {count} source{count === 1 ? "" : "s"}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Cited sources"
          className="popover-surface motion-popover-in absolute bottom-full left-0 mb-1.5 w-[340px] max-w-[88vw] rounded-xl z-50 overflow-hidden"
        >
          <div className="px-3.5 pt-3 pb-2 flex items-center gap-2">
            <span className="text-[12.5px] font-medium text-text-1">Sources</span>
            <span className="text-[10.5px] text-text-4 tabular-nums">
              {count} cited
            </span>
          </div>
          <div className="h-px bg-white/5 mx-3" />
          <ul className="max-h-[320px] overflow-y-auto py-1.5">
            {citations.map((c) => (
              <li key={c.index}>
                <CitationRow citation={c} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CitationRow({ citation }: { citation: Citation }) {
  const isWeb = citation.type === "web" && !!citation.url;
  const Icon = isWeb ? Globe : FileText;

  const open = () => {
    if (isWeb && citation.url) {
      window.open(citation.url, "_blank", "noopener,noreferrer");
    }
  };

  const host = (() => {
    if (!citation.url) return undefined;
    try {
      return new URL(citation.url).hostname.replace(/^www\./, "");
    } catch {
      return citation.url;
    }
  })();

  const content = (
    <>
      <span className="shrink-0 mt-0.5 w-[18px] h-[18px] rounded-md bg-white/5 border border-hairline flex items-center justify-center text-[10px] font-mono tabular-nums text-text-3">
        {citation.index}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Icon size={11} strokeWidth={1.6} className="shrink-0 text-text-4" aria-hidden="true" />
          <span className="text-[12px] font-medium text-text-1 leading-snug truncate">
            {citation.title}
          </span>
          {isWeb && (
            <ArrowUpRight size={11} strokeWidth={1.75} className="shrink-0 text-text-4" aria-hidden="true" />
          )}
        </span>
        {host && (
          <span className="block text-[10.5px] text-text-4 font-mono truncate mt-0.5 pl-[18.5px]">
            {host}
          </span>
        )}
        {citation.snippet && (
          <span className="block text-[11px] text-text-3 leading-relaxed line-clamp-2 mt-1 pl-[18.5px]">
            {citation.snippet}
          </span>
        )}
      </span>
    </>
  );

  if (isWeb) {
    return (
      <button
        type="button"
        onClick={open}
        className="w-full text-left flex items-start gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors focus:outline-none focus-visible:bg-white/5"
        title={`Open ${citation.url}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex items-start gap-2 px-3 py-1.5">{content}</div>
  );
}
