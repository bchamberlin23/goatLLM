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
    accent: "text-[#ececec]",
  },
  {
    id: "auto",
    label: "Auto",
    Icon: Zap,
    help: "File edits run automatically. Shell commands still require approval.",
    accent: "text-[#f59e42]",
  },
  {
    id: "yolo",
    label: "YOLO",
    Icon: Flame,
    help: "Everything runs without prompting — files and shell commands. Use carefully.",
    accent: "text-[#fca5a5]",
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
        className="flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-[12px] font-medium transition-colors"
      >
        <ActiveIcon size={12} strokeWidth={2} aria-hidden="true" className={active.accent} />
        <span className={active.accent}>{active.label}</span>
        <ChevronDown
          size={11}
          strokeWidth={2}
          aria-hidden="true"
          className={`text-[#a0a0a0] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Agent permission mode"
          className="absolute bottom-full left-0 mb-1.5 w-[260px] bg-[#2a2a2c] border border-white/10 rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.55)] py-1 z-50 animate-[dropdownIn_110ms_ease]"
        >
          <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-[#8e8e8e] font-semibold">
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
                className={`flex items-start gap-2.5 w-full px-3 py-2 text-left text-[12px] transition-colors ${
                  isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.05]"
                }`}
              >
                <OptIcon
                  size={13}
                  strokeWidth={2}
                  className={`shrink-0 mt-0.5 ${isActive ? opt.accent : "text-[#a0a0a0]"}`}
                  aria-hidden="true"
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className={`font-medium ${isActive ? opt.accent : "text-[#ececec]"}`}>
                    {opt.label}
                  </span>
                  <span className="text-[10.5px] text-[#a0a0a0] leading-snug mt-0.5">
                    {opt.help}
                  </span>
                </div>
                {isActive && (
                  <span
                    aria-hidden
                    className="shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full bg-[#f59e42]"
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
