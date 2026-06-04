import { useEffect, useState } from "react";
import { X, Globe, FileText, ExternalLink } from "lucide-react";

interface DeepResearchDetailPaneProps {
  sources: string[];
  findings: string[];
  initialTab: "sources" | "findings";
  onClose: () => void;
}

function getDomain(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return urlStr;
  }
}

export function DeepResearchDetailPane({
  sources,
  findings,
  initialTab,
  onClose,
}: DeepResearchDetailPaneProps) {
  const [activeTab, setActiveTab] = useState<"sources" | "findings">(initialTab);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="dr-detail-pane popover-surface fixed right-4 bottom-20 top-20 z-50 flex w-[380px] flex-col rounded-2xl border border-white/[0.12] p-4 shadow-[0_22px_70px_rgba(0,0,0,0.66)]"
      role="dialog"
      aria-label="Deep Research details"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
        <h3 className="m-0 text-sm font-semibold text-text-1">Research Details</h3>
        <button
          onClick={onClose}
          className="control-icon flex h-6 w-6 items-center justify-center rounded-md text-text-3 hover:text-text-1"
          aria-label="Close details pane"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-3 flex rounded-lg bg-white/[0.03] p-0.5">
        <button
          onClick={() => setActiveTab("sources")}
          className={`flex-1 rounded-md py-1.5 text-center text-xs font-medium transition-all ${
            activeTab === "sources"
              ? "bg-white/[0.08] text-text-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              : "text-text-3 hover:text-text-2"
          }`}
        >
          Sources ({sources.length})
        </button>
        <button
          onClick={() => setActiveTab("findings")}
          className={`flex-1 rounded-md py-1.5 text-center text-xs font-medium transition-all ${
            activeTab === "findings"
              ? "bg-white/[0.08] text-text-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              : "text-text-3 hover:text-text-2"
          }`}
        >
          Findings ({findings.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-4 flex-1 overflow-y-auto pr-1">
        {activeTab === "sources" ? (
          sources.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-text-4">
              <Globe size={24} className="mb-2 opacity-50" />
              <span className="text-xs">No sources found yet</span>
            </div>
          ) : (
            <ul className="m-0 space-y-2 p-0 list-none">
              {sources.map((url, i) => (
                <li
                  key={i}
                  className="dr-event-enter flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.02] p-2.5 hover:bg-white/[0.04] transition-colors"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-text-2">
                      <Globe size={12} className="text-text-3" />
                      <span>{getDomain(url)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-text-4">
                      {url}
                    </div>
                  </div>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="control-icon flex h-6 w-6 items-center justify-center rounded-md hover:text-text-1 shrink-0"
                    title="Open link in new tab"
                    aria-label={`Open link in new tab for ${url}`}
                  >
                    <ExternalLink size={12} />
                  </a>
                </li>
              ))}
            </ul>
          )
        ) : findings.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-text-4">
            <FileText size={24} className="mb-2 opacity-50" />
            <span className="text-xs">No findings extracted yet</span>
          </div>
        ) : (
          <ul className="m-0 space-y-2 p-0 list-none">
            {findings.map((finding, i) => (
              <li
                key={i}
                className="dr-event-enter rounded-lg border border-white/[0.04] bg-white/[0.015] p-3 text-xs leading-relaxed text-text-2 hover:bg-white/[0.03] transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex items-center gap-1.5 mb-1.5 font-medium text-text-3">
                  <FileText size={12} />
                  <span>Finding {i + 1}</span>
                </div>
                <div>{finding}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
