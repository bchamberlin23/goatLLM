export function ToggleRow({
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
      className={`soft-card flex items-center justify-between gap-3 p-3.5 rounded-xl transition-all ${
        enabled ? "border-accent/25 shadow-[0_10px_30px_-24px_rgba(245,158,66,0.75)]" : ""
      } ${dimmedWhen ? "opacity-60" : ""}`}
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-medium text-text-1">{title}</span>
          <span className={`flex items-center gap-1.5 text-[11px] ${enabled ? "text-accent" : "text-text-3"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${enabled ? "bg-accent" : "bg-text-4"}`} />
            {enabled ? "On" : "Off"}
          </span>
        </div>
        <span className="text-[11px] text-text-3 leading-relaxed">{description}</span>
        {dimmedHint && <span className="text-[11px] text-text-4 leading-relaxed italic">{dimmedHint}</span>}
      </div>

      <div className="shrink-0">
        <button
          role="switch"
          aria-checked={enabled}
          aria-label={title}
          onClick={() => onToggle(!enabled)}
          className={`motion-feedback relative w-10 h-6 rounded-full border transition-all ${
            enabled
              ? "bg-accent border-accent shadow-[0_8px_20px_-10px_rgba(245,158,66,0.9)]"
              : "bg-white/5 border-hairline-strong hover:bg-white/10"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-bg shadow-[0_2px_8px_rgba(0,0,0,0.36),inset_0_1px_0_rgba(255,255,255,0.65)] transition-transform duration-[var(--d-short)] ease-[var(--ease-move)] ${enabled ? "translate-x-4" : "translate-x-0"}`}
          />
        </button>
      </div>
    </div>
  );
}
