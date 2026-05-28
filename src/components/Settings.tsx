import { useEffect } from "react";
import { X } from "lucide-react";
import { SettingsTabs } from "./settings/SettingsTabs";

interface Props { onClose: () => void; }

export function Settings({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm animate-[fadeIn_150ms_ease]" onClick={onClose}>
      <div className="w-[600px] max-w-[92vw] h-[640px] max-h-[88vh] bg-surface-1 border border-white/10 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden animate-[contextMenuIn_180ms_ease]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
          <h2 className="text-[15px] font-semibold text-text-1 tracking-[-0.015em]">Settings</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-text-1 hover:bg-white/5 transition-colors" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <SettingsTabs />
      </div>
    </div>
  );
}
