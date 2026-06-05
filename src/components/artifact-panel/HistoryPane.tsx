import { useEffect, useRef } from "react";
import type { Artifact } from "../../stores/chat";

interface HistoryPaneProps {
  artifact: Artifact;
  onClose: () => void;
  onRestoreVersion: (versionIndex: number) => void;
}

function formatTimestamp(timestamp: number) {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function HistoryPane({ artifact, onClose, onRestoreVersion }: HistoryPaneProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement?.tagName === "IFRAME") onClose();
      }, 0);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  const versions = artifact.versions ?? [];
  const activeIndex = artifact.activeVersionIndex ?? versions.length - 1;

  return (
    <div
      ref={ref}
      className="popover-surface motion-popover-in absolute top-full right-0 mt-1.5 w-[280px] max-h-[400px] overflow-y-auto rounded-xl z-50"
    >
      <div className="px-3 py-2 border-b border-white/5 sticky top-0 bg-[#2a2a2c]/90 backdrop-blur-md">
        <span className="text-[10.5px] uppercase tracking-wider text-[#8e8e8e] font-semibold">
          Version history
        </span>
      </div>
      <div className="p-1">
        {versions.length === 0 && (
          <p className="text-[12px] text-[#a0a0a0] px-3 py-3">No history yet.</p>
        )}
        {[...versions].map((_, indexAsc) => {
          const versionIndex = versions.length - 1 - indexAsc;
          const version = versions[versionIndex];
          const isActive = versionIndex === activeIndex;
          return (
            <button
              key={versionIndex}
              type="button"
              onClick={() => {
                onRestoreVersion(versionIndex);
                onClose();
              }}
              className={`motion-row flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left transition-colors ${
                isActive ? "bg-[#f59e42]/10" : "hover:bg-white/[0.06]"
              }`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  version.source === "agent" ? "bg-[#60a5fa]" : "bg-[#f59e42]"
                }`}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className={`text-[12px] truncate ${isActive ? "text-[#f59e42]" : "text-[#d5d5d5]"}`}>
                  {version.source === "agent" ? "Agent" : "You"}
                  {version.restoredFrom !== undefined && " (restored)"}
                  {versionIndex === versions.length - 1 ? " - latest" : ""}
                </span>
                <span className="text-[10.5px] text-[#888]">
                  {formatTimestamp(version.createdAt)}
                </span>
              </div>
              {isActive && <span className="text-[10px] text-[#f59e42] shrink-0">current</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
