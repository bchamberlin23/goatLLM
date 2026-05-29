import { useState } from "react";
import type { DiffResult } from "../lib/diff-utils";

export function DiffView({ diff }: { diff: DiffResult }) {
  const [expanded, setExpanded] = useState(false);
  const maxPreview = 20;
  const displayLines = expanded ? diff.lines : diff.lines.slice(0, maxPreview);

  return (
    <div className="border border-white/[0.06] rounded-md overflow-hidden bg-[#161618]">
      <div className="px-2.5 py-1.5 bg-white/[0.04] border-b border-white/[0.06]">
        <span className="text-[10px] text-[#a0a0a0] font-mono font-medium">
          <span className="text-[#4ade80] font-semibold">+{diff.added}</span>{" "}
          /{" "}
          <span className="text-[#f87171] font-semibold">-{diff.removed}</span>{" "}
          lines
        </span>
      </div>
      <pre className="m-0 p-2.5 font-mono text-[11px] leading-relaxed max-h-[280px] overflow-auto whitespace-pre text-[#b4b4b4]">
        {displayLines.map((line, i) => (
          <span
            key={i}
            className={`block ${
              line.type === "added"
                ? "bg-green-500/10 text-[#bbf7d0]"
                : line.type === "removed"
                  ? "bg-red-500/10 text-[#fecaca]"
                  : "text-[#a0a0a0]"
            }`}
          >
            {line.content}
            {"\n"}
          </span>
        ))}
      </pre>
      {diff.lines.length > maxPreview && !expanded && (
        <button
          type="button"
          className="w-full px-2.5 py-1.5 bg-white/[0.04] border-t border-white/[0.06] text-[11px] text-[#a0a0a0] hover:bg-white/[0.06] hover:text-[#ececec] transition-colors"
          onClick={() => setExpanded(true)}
        >
          Show all {diff.lines.length} lines…
        </button>
      )}
    </div>
  );
}
