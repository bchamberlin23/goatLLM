import { useChatStore } from "../stores/chat";
import { Hand, Zap, Flame } from "lucide-react";

type Mode = "manual" | "auto" | "yolo";

const MODES: { id: Mode; label: string; Icon: typeof Hand; help: string }[] = [
  {
    id: "manual",
    label: "Manual",
    Icon: Hand,
    help: "Manual — every write, edit, or shell command requires your approval.",
  },
  {
    id: "auto",
    label: "Auto",
    Icon: Zap,
    help: "Auto — file writes/edits run without prompting, shell commands still require approval.",
  },
  {
    id: "yolo",
    label: "YOLO",
    Icon: Flame,
    help: "YOLO — every tool call runs without prompting, including shell commands. Use carefully.",
  },
];

export function AutoApproveToggle() {
  const agentMode = useChatStore((s) => s.agentMode);
  const permissionMode = useChatStore((s) => s.permissionMode);
  const setPermissionMode = useChatStore((s) => s.setPermissionMode);

  if (!agentMode) return null;

  return (
    <div
      role="radiogroup"
      aria-label="Permission mode"
      className="flex items-center gap-0.5 p-0.5 rounded-md border border-white/5 bg-white/[0.03] shrink-0"
    >
      {MODES.map(({ id, label, Icon, help }) => {
        const active = permissionMode === id;
        const accent =
          id === "yolo"
            ? "bg-error/15 text-error shadow-[0_0_8px_rgba(248,113,113,0.15)]"
            : id === "auto"
              ? "bg-accent/15 text-accent shadow-[0_0_8px_rgba(245,158,66,0.15)]"
              : "bg-white/10 text-text-1";
        return (
          <button
            key={id}
            role="radio"
            aria-checked={active}
            aria-label={help}
            title={help}
            onClick={() => setPermissionMode(id)}
            className={`flex items-center gap-1 px-2 py-1 rounded-[5px] text-[11.5px] font-medium transition-all ${
              active ? accent : "text-text-3 hover:text-text-1 hover:bg-white/5"
            }`}
          >
            <Icon size={11} strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
