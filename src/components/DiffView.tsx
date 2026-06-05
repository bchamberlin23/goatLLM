import { useState } from "react";
import type { DiffResult } from "../lib/diff-utils";

export function DiffView({ diff }: { diff: DiffResult }) {
  const [expanded, setExpanded] = useState(false);
  const maxPreview = 20;
  const displayLines = expanded ? diff.lines : diff.lines.slice(0, maxPreview);

  return (
    <div className="border border-hairline rounded-md overflow-hidden bg-sunken">
      <div className="px-2.5 py-1.5 bg-white/5 border-b border-hairline">
        <span className="text-[10px] text-text-3 font-mono font-medium">
          <span className="text-success font-semibold">+{diff.added}</span>{" "}
          /{" "}
          <span className="text-error font-semibold">-{diff.removed}</span>{" "}
          lines
        </span>
      </div>
      <pre className="m-0 p-2.5 font-mono text-[11px] leading-relaxed max-h-[280px] overflow-auto whitespace-pre text-text-2">
        {displayLines.map((line, i) => (
          <span
            key={i}
            className={`block ${
              line.type === "added"
                ? "bg-green-500/10 text-success"
                : line.type === "removed"
                  ? "bg-red-500/10 text-error"
                  : "text-text-3"
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
          className="w-full px-2.5 py-1.5 bg-white/5 border-t border-hairline text-[11px] text-text-3 hover:bg-white/5 hover:text-text-1 transition-colors"
          onClick={() => setExpanded(true)}
        >
          Show all {diff.lines.length} lines…
        </button>
      )}
    </div>
  );
}
