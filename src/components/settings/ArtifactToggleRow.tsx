export function ArtifactToggleRow({
  enabled,
  onToggle,
  title,
  description,
  dimmedWhen,
  dimmedHint,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  title: string;
  description: string;
  dimmedWhen?: boolean;
  dimmedHint?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 p-3.5 bg-[#212122] border rounded-xl transition-colors ${
        enabled ? "border-[#f59e42]/25" : "border-white/5"
      } ${dimmedWhen ? "opacity-60" : ""}`}
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-medium text-[#ececec]">{title}</span>
          <span className={`flex items-center gap-1.5 text-[11px] ${enabled ? "text-[#f59e42]" : "text-[#a0a0a0]"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${enabled ? "bg-[#f59e42]" : "bg-[#4a4a4a]"}`} />
            {enabled ? "On" : "Off"}
          </span>
        </div>
        <span className="text-[11px] text-[#a0a0a0] leading-relaxed">
          {description}
        </span>
        {dimmedHint && <span className="text-[11px] text-[#888] leading-relaxed italic">{dimmedHint}</span>}
      </div>

      <div className="shrink-0">
        <button
          role="switch"
          aria-checked={enabled}
          aria-label={title}
          onClick={() => onToggle(!enabled)}
          className={`relative w-10 h-6 rounded-full transition-colors ${enabled ? "bg-[#f59e42]" : "bg-[#3a3a3a]"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`}
          />
        </button>
      </div>
    </div>
  );
}
