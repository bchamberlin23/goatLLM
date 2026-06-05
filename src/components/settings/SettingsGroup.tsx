import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function SettingsGroup({
  title,
  description,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-start justify-between gap-2 rounded-lg text-left group transition-colors hover:bg-white/[0.025] w-full"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-text-1">{title}</h3>
          {description && (
            <p className="text-[12px] text-text-3 leading-relaxed mt-0.5">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {open && action}
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={`shrink-0 mt-0.5 text-text-3 transition-transform duration-200 group-hover:text-text-2 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </div>
      </button>
      {open && <div className="flex flex-col gap-2">{children}</div>}
    </section>
  );
}
