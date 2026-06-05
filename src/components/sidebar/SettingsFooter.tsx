import { Settings } from "lucide-react";

interface SettingsFooterProps {
  onOpenSettings: () => void;
}

export function SettingsFooter({ onOpenSettings }: SettingsFooterProps) {
  return (
    <div className="mt-1 border-t border-white/[0.04] px-2 pb-3 pt-2">
      <button
        onClick={onOpenSettings}
        className="sidebar-action group flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[#ececec] transition-all"
        aria-label="Open settings"
      >
        <Settings
          size={15}
          strokeWidth={1.75}
          className="text-[#c9c9c9] transition-all duration-300 group-hover:rotate-45 group-hover:text-[#ececec]"
          aria-hidden="true"
        />
        <span className="text-[13px]">Settings</span>
      </button>
    </div>
  );
}
