import { useEffect, useState, useCallback } from "react";
import { PanelLeft } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Settings } from "./components/Settings";
import { useChatStore } from "./stores/chat";
import { useKeyboardShortcuts } from "./lib/keyboard";
import { seedBuiltinSkills } from "./lib/skill-seed";
import { loadAllSkills } from "./lib/skills";

async function refreshSkills() {
  const state = useChatStore.getState();
  const { skills } = await loadAllSkills({
    customPaths: state.skillPaths,
    includeDefaults: true,
  });
  state.setDiscoveredSkills(skills);
}

export default function App() {
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const getModels = useChatStore((s) => s.getModels);
  const hydrate = useChatStore((s) => s.hydrate);
  const _hydrated = useChatStore((s) => s._hydrated);
  const checkAllProvidersHealth = useChatStore((s) => s.checkAllProvidersHealth);
  const discoverAllLocalModels = useChatStore((s) => s.discoverAllLocalModels);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const toggleSidebar = useChatStore((s) => s.toggleSidebar);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => { hydrate(); }, []);
  useEffect(() => { if (_hydrated) checkAllProvidersHealth(); }, [_hydrated]);
  useEffect(() => { if (_hydrated) void discoverAllLocalModels(); }, [_hydrated]);
  // Seed built-in skills then refresh the list once hydrated.
  useEffect(() => {
    if (!_hydrated) return;
    seedBuiltinSkills().then(() => refreshSkills());
  }, [_hydrated]);
  // Poll local provider health every 30s
  useEffect(() => {
    if (!_hydrated) return;
    const id = setInterval(() => checkAllProvidersHealth(), 30_000);
    return () => clearInterval(id);
  }, [_hydrated]);
  useEffect(() => {
    if (!selectedModelId && _hydrated) {
      const models = getModels();
      const first = models[0];
      if (first) setSelectedModel(first.id);
    }
  }, [_hydrated]);

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
  const handleFocusInput = useCallback(() => useChatStore.getState().focusInput(), []);

  useKeyboardShortcuts({
    onOpenSettings: handleOpenSettings,
    onCloseSettings: handleCloseSettings,
    isSettingsOpen: settingsOpen,
    onFocusInput: handleFocusInput,
  });

  return (
    <div className="w-full h-screen flex overflow-hidden relative" style={{ background: "#1e1e1e" }}>
      <div
        className="h-full overflow-hidden shrink-0 transition-[width] duration-300 ease-out"
        style={{ width: sidebarOpen ? 244 : 0 }}
      >
        <Sidebar onOpenSettings={handleOpenSettings} />
      </div>
      <main
        className="flex-1 h-full flex flex-col relative overflow-hidden"
        style={{
          background:
            "radial-gradient(1100px 620px at 50% -10%, rgba(245,158,66,0.045), transparent 55%), radial-gradient(900px 500px at 100% 110%, rgba(99,102,241,0.035), transparent 55%), #1e1e1e",
        }}
      >
        <ChatView onOpenSettings={handleOpenSettings} />
      </main>
      <button
        onClick={toggleSidebar}
        className="absolute top-[5px] left-[78px] z-50 p-1.5 rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] transition-colors"
        aria-label={sidebarOpen ? "Hide sidebar" : "Expand sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Expand sidebar"}
      >
        <PanelLeft size={16} strokeWidth={1.75} />
      </button>
      {settingsOpen && <Settings onClose={handleCloseSettings} />}
    </div>
  );
}
