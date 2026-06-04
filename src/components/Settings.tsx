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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#111112]/70 backdrop-blur-md animate-[fadeIn_150ms_ease]" onClick={onClose}>
      <div
        className="modal-surface w-[1040px] max-w-[94vw] h-[760px] max-h-[90vh] rounded-2xl flex flex-col overflow-hidden animate-[contextMenuIn_180ms_ease]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div className="min-w-0">
            <h2 id="settings-title" className="text-[15px] font-semibold text-text-1">Settings</h2>
            <p className="mt-0.5 text-[11.5px] text-text-3">Providers, product modules, memory, sync, voice, and developer controls.</p>
          </div>
          <button className="control-icon w-7 h-7 flex items-center justify-center rounded-md transition-colors" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <SettingsTabs />
      </div>
    </div>
  );
}
