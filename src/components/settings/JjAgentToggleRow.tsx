export function JjAgentToggleRow({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 p-3.5 bg-[#212122] border rounded-xl transition-colors ${
        enabled ? "border-[#6c5ce7]/25" : "border-white/5"
      }`}
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-medium text-[#ececec]">
            jjagent — Edit Isolation
          </span>
          <span className={`flex items-center gap-1.5 text-[11px] ${enabled ? "text-[#6c5ce7]" : "text-[#a0a0a0]"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${enabled ? "bg-[#6c5ce7]" : "bg-[#4a4a4a]"}`} />
            {enabled ? "On" : "Off"}
          </span>
        </div>
        <span className="text-[11px] text-[#a0a0a0] leading-relaxed">
          Each agent turn gets its own jj change, squashed when the turn completes. Requires <code className="text-[#c9c9c9] bg-white/5 px-1 py-0.5 rounded text-[12px]">jj</code> and a jj workspace. Edit with confidence — <code className="text-[#c9c9c9] bg-white/5 px-1 py-0.5 rounded text-[12px]">jj undo</code> to roll back.
        </span>
      </div>

      <div className="shrink-0">
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle jjagent edit isolation"
          onClick={() => onToggle(!enabled)}
          className={`relative w-10 h-6 rounded-full transition-colors ${enabled ? "bg-[#6c5ce7]" : "bg-[#3a3a3a]"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`}
          />
        </button>
      </div>
    </div>
  );
}
