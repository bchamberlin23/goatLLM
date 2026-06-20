import { useEffect, useState, useCallback, useRef, type CSSProperties } from "react";
import { PanelLeft } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Settings } from "./components/Settings";
import { useChatStore } from "./stores/chat";
import { useKeyboardShortcuts } from "./lib/keyboard";
import { seedBuiltinSkills } from "./lib/skill-seed";
import { loadAllSkills } from "./lib/skills";
import { dueScheduledAgents } from "./lib/scheduled-agents";
import { useAmbientGlowPosition } from "./lib/ambient-glow";

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
  const checkCodexAuthStatus = useChatStore((s) => s.checkCodexAuthStatus);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const toggleSidebar = useChatStore((s) => s.toggleSidebar);
  const glowBackgroundEnabled = useChatStore((s) => s.glowBackgroundEnabled);
  const glowBackgroundMode = useChatStore((s) => s.glowBackgroundMode);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useAmbientGlowPosition(shellRef, glowBackgroundEnabled);

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
  useEffect(() => { if (_hydrated) void checkCodexAuthStatus(); }, [_hydrated, checkCodexAuthStatus]);
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

  useEffect(() => {
    if (!_hydrated) return;
    const tick = () => {
      const state = useChatStore.getState();
      if (!state.featureFlags.scheduledAgents) return;
      const due = dueScheduledAgents(state.scheduledAgents, state.scheduledAgentRuns, Date.now());
      for (const agent of due) {
        void state.runScheduledAgent(agent.id);
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
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

  useKeyboardShortcuts({
    onOpenSettings: handleOpenSettings,
    onCloseSettings: handleCloseSettings,
    isSettingsOpen: settingsOpen,
    onFocusInput: handleFocusInput,
  });

  return (
    <div
      ref={shellRef}
      className={`w-full h-screen flex overflow-hidden relative bg-bg mode-${glowBackgroundMode}`}
      style={{
        "--glow-x": "52%",
        "--glow-y": "8%",
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
      <div
        className="relative z-10 h-full overflow-hidden shrink-0 transition-[width] duration-300 ease-out"
        style={{ width: sidebarOpen ? 244 : 0 }}
      >
        <Sidebar onOpenSettings={handleOpenSettings} />
      </div>
      <main
        className="relative z-10 flex-1 h-full flex flex-col overflow-hidden"
      >
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
