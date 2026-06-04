import { useEffect, useState, useCallback, type CSSProperties, type PointerEvent } from "react";
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
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const toggleSidebar = useChatStore((s) => s.toggleSidebar);
  const glowBackgroundEnabled = useChatStore((s) => s.glowBackgroundEnabled);
  const glowBackgroundMode = useChatStore((s) => s.glowBackgroundMode);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [glow, setGlow] = useState({ x: 52, y: 8 });

  useEffect(() => { hydrate(); }, []);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const collapseOnNarrow = (matches: boolean) => {
      if (matches) setSidebarOpen(false);
    };
    collapseOnNarrow(query.matches);
    const onChange = (event: MediaQueryListEvent) => collapseOnNarrow(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [setSidebarOpen]);
  useEffect(() => { if (_hydrated) checkAllProvidersHealth(); }, [_hydrated]);
  useEffect(() => { if (_hydrated) void discoverAllLocalModels(); }, [_hydrated]);
  useEffect(() => {
    if (!_hydrated) return;
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ path: string; kind: "create" | "modify" | "remove"; at: number; diagnostic?: string }>(
          "workspace-watch-event",
          (event) => {
            if (!event.payload?.path) return;
            useChatStore.getState().addWatcherEvent(event.payload);
          },
        ),
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Browser-mode dev server has no Tauri event bridge.
      });
    return () => {
      unlisten?.();
    };
  }, [_hydrated]);
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

  // Auto-start SearXNG on app launch if configured as the active search backend
  useEffect(() => {
    if (_hydrated) {
      const state = useChatStore.getState();
      if (state.searchBackend === "searxng") {
        const hasTauriBridge = Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
        if (!hasTauriBridge) return;
        import("@tauri-apps/api/core")
          .then(({ invoke }) => {
            invoke("searxng_start").catch((err) => {
              console.warn("Failed to auto-start SearXNG on app launch:", err);
            });
          })
          .catch((err) => {
            console.warn("Failed to load Tauri core invoke for SearXNG auto-start:", err);
          });
      }
    }
  }, [_hydrated]);
  useEffect(() => {
    if (!selectedModelId && _hydrated) {
      const models = getModels();
      const first = models[0];
      if (first) setSelectedModel(first.id);
    }
  }, [_hydrated]);

  // Minimizing the window must not cancel in-flight streams — only explicit
  // Stop does. When the tab becomes visible again, nudge artifact previews.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      window.dispatchEvent(new CustomEvent("goatllm:refresh-artifact-preview"));
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
  const handleFocusInput = useCallback(() => useChatStore.getState().focusInput(), []);
  const handleGlowMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setGlow({
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100,
    });
  }, []);

  useKeyboardShortcuts({
    onOpenSettings: handleOpenSettings,
    onCloseSettings: handleCloseSettings,
    isSettingsOpen: settingsOpen,
    onFocusInput: handleFocusInput,
  });

  return (
    <div className="w-full h-screen flex overflow-hidden relative bg-bg">
      <div
        className="h-full overflow-hidden shrink-0 transition-[width] duration-300 ease-out"
        style={{ width: sidebarOpen ? 244 : 0 }}
      >
        <Sidebar onOpenSettings={handleOpenSettings} />
      </div>
      <main
        className="flex-1 h-full flex flex-col relative overflow-hidden"
        onPointerMove={handleGlowMove}
        style={{
          "--glow-x": `${glow.x}%`,
          "--glow-y": `${glow.y}%`,
        } as CSSProperties}
      >
        {glowBackgroundEnabled && (
          <div className={`liquid-glow-field mode-${glowBackgroundMode}`} aria-hidden="true">
            {glowBackgroundMode === "fluid" && (
              <>
                <div className="fluid-blob blob-1" />
                <div className="fluid-blob blob-2" />
                <div className="fluid-blob blob-3" />
                <div className="fluid-blob blob-mouse" />
              </>
            )}
          </div>
        )}
        <ChatView onOpenSettings={handleOpenSettings} />
      </main>
      <button
        onClick={toggleSidebar}
        className="control-icon absolute top-[5px] left-[78px] max-[720px]:left-3 z-50 p-1.5 rounded-md transition-colors"
        aria-label={sidebarOpen ? "Hide sidebar" : "Expand sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Expand sidebar"}
      >
        <PanelLeft size={16} strokeWidth={1.75} />
      </button>
      {settingsOpen && <Settings onClose={handleCloseSettings} />}
    </div>
  );
}
