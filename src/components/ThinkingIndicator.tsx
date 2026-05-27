import { useEffect, useState } from "react";

export function Shimmer({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`shimmer ${className}`} aria-live="polite">
      {text}
    </span>
  );
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
  const diffMs = Math.max(0, now - startedAt);
  const totalSec = Math.floor(diffMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
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
        <span className="text-[13.5px] font-medium text-[#8e8e8e]">
          {label === "Working" ? "Worked" : `${label.replace(/ing$/, "ed")}`} for {elapsed}
        </span>
      ) : (
        <span className="text-[13.5px] font-medium text-[#8e8e8e]">
          {label === "Working" ? "Done" : label.replace(/ing$/, "ed")}
        </span>
      )}
      <div className="h-px bg-white/5 w-full" />
    </div>
  );
}
