import { useEffect, useState } from "react";

export function Shimmer({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`shimmer ${className}`} aria-live="polite">
      {text}
    </span>
  );
}

/** Format a duration in ms as a human-readable elapsed label. */
export function formatDurationMs(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (totalMin < 60) return s === 0 ? `${totalMin}m` : `${totalMin}m ${s}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function useElapsedLabel(startedAt: number | null, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!startedAt) return "0s";
  return formatDurationMs(now - startedAt);
}

export function WorkingHeader({
  startedAt,
  running,
  label = "Working",
}: {
  startedAt: number | null;
  running: boolean;
  label?: string;
}) {
  const elapsed = useElapsedLabel(startedAt, running);
  return (
    <div className="flex flex-col gap-2 my-1 mb-3 w-full">
      {running ? (
        <Shimmer text={`${label} for ${elapsed}`} className="text-[13.5px] font-medium" />
      ) : elapsed !== "0s" ? (
        <span className="text-[13.5px] font-medium text-text-3">
          {label === "Working" ? "Worked" : `${label.replace(/ing$/, "ed")}`} for {elapsed}
        </span>
      ) : (
        <span className="text-[13.5px] font-medium text-text-3">
          {label === "Working" ? "Done" : label.replace(/ing$/, "ed")}
        </span>
      )}
      <div className="h-px bg-white/5 w-full" />
    </div>
  );
}
