import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Hammer, Layout, Shield } from "lucide-react";
import { ProvidersTab } from "./ProvidersTab";
import { ToolsTab } from "./ToolsTab";
import { InterfaceTab } from "./InterfaceTab";
import { AdvancedTab } from "./AdvancedTab";

const TAB_STORAGE_KEY = "goatllm-settings-tab";

export type SettingsTabId = "providers" | "tools" | "interface" | "advanced";

const TABS: { id: SettingsTabId; label: string; icon: typeof Cpu }[] = [
  { id: "providers", label: "Providers", icon: Cpu },
  { id: "tools", label: "Tools", icon: Hammer },
  { id: "interface", label: "Interface", icon: Layout },
  { id: "advanced", label: "Advanced", icon: Shield },
];

function loadStoredTab(): SettingsTabId {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored && TABS.some((t) => t.id === stored)) return stored as SettingsTabId;
  } catch { /* ignore */ }
  return "providers";
}

export function SettingsTabs() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(loadStoredTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const next = (index + dir + TABS.length) % TABS.length;
        setActiveTab(TABS[next].id);
        tabRefs.current[next]?.focus();
      }
    },
    [],
  );

  return (
    <div className="flex flex-1 min-h-0">
      <nav
        className="w-[140px] shrink-0 bg-bg border-r border-white/5 flex flex-col py-2 px-2 gap-0.5"
        aria-label="Settings sections"
      >
        {TABS.map((tab, index) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[index] = el; }}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12.5px] font-medium transition-colors text-left ${
                isActive
                  ? "bg-white/5 text-text-1 border-l-2 border-accent pl-[calc(0.625rem-2px)]"
                  : "text-text-3 hover:text-text-2 hover:bg-white/[0.03] border-l-2 border-transparent"
              }`}
            >
              <Icon size={14} strokeWidth={1.75} className={isActive ? "text-accent" : ""} aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div
        className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 min-w-0"
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === activeTab)?.label}
      >
        {activeTab === "providers" && <ProvidersTab />}
        {activeTab === "tools" && <ToolsTab />}
        {activeTab === "interface" && <InterfaceTab />}
        {activeTab === "advanced" && <AdvancedTab />}
      </div>
    </div>
  );
}
