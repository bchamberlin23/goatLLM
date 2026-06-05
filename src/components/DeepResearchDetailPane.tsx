import { useEffect, useState } from "react";
import { X, Globe, FileText, ExternalLink, Search, Copy, Check } from "lucide-react";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

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

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(text);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // clipboards might be blocked/unavailable
    }
  };

  const getFilteredSources = () => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sources;
    return sources.filter(
      (url) => url.toLowerCase().includes(query) || getDomain(url).toLowerCase().includes(query)
    );
  };

  const getFilteredFindings = () => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return findings;
    return findings.filter((finding) => finding.toLowerCase().includes(query));
  };

  const filteredSources = getFilteredSources();
  const filteredFindings = getFilteredFindings();

  const handleCopyAll = async () => {
    const textToCopy =
      activeTab === "sources"
        ? filteredSources.join("\n")
        : filteredFindings.map((f, i) => `Finding ${i + 1}:\n${f}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      // clipboards might be blocked/unavailable
    }
  };

  return (
    <>
      {/* Translucent Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-40 dr-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Container */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex w-[420px] max-w-full flex-col bg-[#0b0b0c] border-l border-white/[0.06] shadow-[var(--shadow-float)] dr-drawer-panel"
        role="dialog"
        aria-label="Deep Research details"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="m-0 text-xs font-semibold uppercase tracking-wider text-text-2">Research Details</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {((activeTab === "sources" && filteredSources.length > 0) ||
              (activeTab === "findings" && filteredFindings.length > 0)) && (
              <button
                onClick={handleCopyAll}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] border border-white/[0.06] bg-white/[0.03] text-text-3 hover:text-text-1 hover:bg-white/[0.06] active:bg-white/[0.04] transition-colors cursor-pointer"
                title="Copy all currently filtered items"
              >
                {copiedAll ? (
                  <>
                    <Check size={11} className="text-success" />
                    <span>Copied all</span>
                  </>
                ) : (
                  <>
                    <Copy size={11} />
                    <span>Copy all</span>
                  </>
                )}
              </button>
            )}
            <button
              onClick={onClose}
              className="control-icon flex h-6 w-6 items-center justify-center rounded-md hover:text-text-1 cursor-pointer"
              aria-label="Close details pane"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06] px-4 shrink-0">
          <button
            onClick={() => {
              setActiveTab("sources");
              setSearchQuery("");
            }}
            className={`flex-1 py-2 text-center text-[12px] font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "sources"
                ? "border-accent text-accent"
                : "border-transparent text-text-3 hover:text-text-2"
            }`}
          >
            Sources <span className="font-mono text-[10px] bg-white/5 px-1 py-0.5 rounded ml-1 tabular-nums">({sources.length})</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("findings");
              setSearchQuery("");
            }}
            className={`flex-1 py-2 text-center text-[12px] font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "findings"
                ? "border-accent text-accent"
                : "border-transparent text-text-3 hover:text-text-2"
            }`}
          >
            Findings <span className="font-mono text-[10px] bg-white/5 px-1 py-0.5 rounded ml-1 tabular-nums">({findings.length})</span>
          </button>
        </div>

        {/* Search / Filter Input */}
        <div className="px-4 py-2.5 border-b border-white/[0.06] shrink-0 bg-white/[0.01]">
          <div className="relative flex items-center">
            <Search size={12} className="absolute left-2.5 text-text-4" />
            <input
              type="text"
              placeholder={activeTab === "sources" ? "Search sources by domain or URL..." : "Search findings by text..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] py-1.5 pl-8 pr-8 text-xs text-text-1 placeholder-text-4 outline-none transition-all focus:border-white/[0.12] focus:bg-white/[0.04] focus:ring-1 focus:ring-accent/20"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 p-0.5 text-text-4 hover:text-text-2 transition-colors rounded hover:bg-white/5 cursor-pointer"
                aria-label="Clear filter"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === "sources" ? (
            filteredSources.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center text-text-4">
                <Globe size={20} className="mb-2 opacity-30" />
                <span className="text-xs">{sources.length === 0 ? "No sources found yet" : "No matching sources"}</span>
              </div>
            ) : (
              <ul className="m-0 space-y-2 p-0 list-none">
                {filteredSources.map((url, i) => (
                  <li
                    key={url}
                    className="dr-event-enter flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.01] p-2.5 hover:bg-white/[0.03] transition-all"
                    style={{ animationDelay: `${i * 20}ms` }}
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-2">
                        <Globe size={11} className="text-text-3 shrink-0" />
                        <span className="truncate">{getDomain(url)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-text-4 font-mono select-all">
                        {url}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleCopy(url)}
                        className="control-icon flex h-6 w-6 items-center justify-center rounded-md hover:text-text-1 cursor-pointer"
                        title="Copy source URL"
                        aria-label={`Copy source URL for ${url}`}
                      >
                        {copiedKey === url ? (
                          <Check size={11} className="text-success" />
                        ) : (
                          <Copy size={11} />
                        )}
                      </button>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="control-icon flex h-6 w-6 items-center justify-center rounded-md hover:text-text-1"
                        title="Open link in new tab"
                        aria-label={`Open link in new tab for ${url}`}
                      >
                        <ExternalLink size={11} />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : filteredFindings.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-text-4">
              <FileText size={20} className="mb-2 opacity-30" />
              <span className="text-xs">{findings.length === 0 ? "No findings extracted yet" : "No matching findings"}</span>
            </div>
          ) : (
            <ul className="m-0 space-y-2.5 p-0 list-none">
              {filteredFindings.map((finding, i) => (
                <li
                  key={finding}
                  className="dr-event-enter relative rounded-lg border border-white/[0.05] bg-white/[0.008] p-3 text-xs leading-relaxed text-text-2 hover:bg-white/[0.02] hover:border-white/[0.08] transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.01)]"
                  style={{ animationDelay: `${i * 25}ms` }}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 font-semibold text-text-3">
                      <FileText size={11} className="shrink-0" />
                      <span className="font-mono text-[10px] tracking-wider uppercase">Finding {i + 1}</span>
                    </div>
                    <button
                      onClick={() => handleCopy(finding)}
                      className="control-icon flex h-5.5 w-5.5 items-center justify-center rounded hover:text-text-1 cursor-pointer"
                      title="Copy finding text"
                      aria-label={`Copy finding ${i + 1}`}
                    >
                      {copiedKey === finding ? (
                        <Check size={11} className="text-success" />
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                  </div>
                  <div className="text-text-2 pr-1 select-text selection:bg-accent/20">{finding}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
