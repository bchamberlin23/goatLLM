import { useState, useRef, useEffect, useCallback } from "react";
import { useChatStore } from "../stores/chat";
import { ChevronDown, Hand, Zap, Flame } from "lucide-react";

type PermMode = "manual" | "auto" | "yolo";

const PERM_OPTIONS: { id: PermMode; label: string; Icon: typeof Hand; help: string; accent: string }[] = [
  {
    id: "manual",
    label: "Manual",
    Icon: Hand,
    help: "Every file write, edit, and shell command requires your approval.",
    accent: "text-text-1",
  },
  {
    id: "auto",
    label: "Auto",
    Icon: Zap,
    help: "File edits run automatically. Shell commands still require approval.",
    accent: "text-accent",
  },
  {
    id: "yolo",
    label: "YOLO",
    Icon: Flame,
    help: "Everything runs without prompting — files and shell commands. Use carefully.",
    accent: "text-error",
  },
];

/**
 * Compact agent pill rendered inside the InputBar footer while agent mode is
 * active. Click to open the permission-mode menu; click the X-style toggle
 * area in the main ModeToggle (above the input) to leave agent mode.
 *
 * Visually mirrors ChatGPT/Claude's inline tool pill — small chip flush with
 * the other input controls, never absent while the user is in agent mode.
 */
export function AgentPill() {
  const agentMode = useChatStore((s) => s.agentMode);
  const permissionMode = useChatStore((s) => s.permissionMode);
  const setPermissionMode = useChatStore((s) => s.setPermissionMode);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handlePick = useCallback((id: PermMode) => {
    setPermissionMode(id);
    setOpen(false);
  }, [setPermissionMode]);

  if (!agentMode) return null;

  const active = PERM_OPTIONS.find((o) => o.id === permissionMode) ?? PERM_OPTIONS[0];
  const ActiveIcon = active.Icon;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Agent permission — ${active.label}. ${active.help}`}
        className="control-pill flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[12px] font-medium transition-colors"
      >
        <ActiveIcon size={12} strokeWidth={2} aria-hidden="true" className={active.accent} />
        <span className={active.accent}>{active.label}</span>
        <ChevronDown
          size={11}
          strokeWidth={2}
          aria-hidden="true"
          className={`text-text-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Agent permission mode"
          className="popover-surface motion-popover-in absolute bottom-full left-0 mb-1.5 w-[260px] rounded-xl py-1 z-50"
        >
          <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-text-3 font-semibold">
            Permission mode
          </div>
          {PERM_OPTIONS.map((opt) => {
            const isActive = opt.id === permissionMode;
            const OptIcon = opt.Icon;
            return (
              <button
                key={opt.id}
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => handlePick(opt.id)}
                className={`motion-row flex items-start gap-2.5 w-full px-3 py-2 text-left text-[12px] transition-colors ${
                  isActive ? "bg-white/5" : "hover:bg-white/5"
                }`}
              >
                <OptIcon
                  size={13}
                  strokeWidth={2}
                  className={`shrink-0 mt-0.5 ${isActive ? opt.accent : "text-text-3"}`}
                  aria-hidden="true"
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className={`font-medium ${isActive ? opt.accent : "text-text-1"}`}>
                    {opt.label}
                  </span>
                  <span className="text-[10.5px] text-text-3 leading-snug mt-0.5">
                    {opt.help}
                  </span>
                </div>
                {isActive && (
                  <span
                    aria-hidden
                    className="motion-pop-in shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full bg-accent"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
