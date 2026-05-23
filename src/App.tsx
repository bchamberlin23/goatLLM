import { useEffect, useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Settings } from "./components/Settings";
import { useChatStore } from "./stores/chat";

export default function App() {
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const getModels = useChatStore((s) => s.getModels);
  const hydrate = useChatStore((s) => s.hydrate);
  const _hydrated = useChatStore((s) => s._hydrated);
  const checkAllProvidersHealth = useChatStore((s) => s.checkAllProvidersHealth);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => { hydrate(); }, []);
  useEffect(() => { if (_hydrated) checkAllProvidersHealth(); }, [_hydrated]);
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

  return (
    <div className="w-full h-screen flex overflow-hidden" style={{ background: "#1e1e1e" }}>
      {sidebarOpen && <Sidebar onOpenSettings={handleOpenSettings} />}
      <main
        className="flex-1 h-full flex flex-col relative overflow-hidden"
        style={{
          background:
            "radial-gradient(1100px 620px at 50% -10%, rgba(245,158,66,0.045), transparent 55%), radial-gradient(900px 500px at 100% 110%, rgba(99,102,241,0.035), transparent 55%), #1e1e1e",
        }}
      >
        <ChatView onOpenSettings={handleOpenSettings} />
      </main>
      {settingsOpen && <Settings onClose={handleCloseSettings} />}
    </div>
  );
}
