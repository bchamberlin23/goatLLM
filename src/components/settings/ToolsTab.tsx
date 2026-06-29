import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Play,
  Square,
  RefreshCw,
  Plus,
  Trash2
} from "lucide-react";
import { useChatStore } from "../../stores/chat";
import { ToggleRow } from "./ToggleRow";
import { TavilyKeyRow } from "./TavilyKeyRow";
import { SemanticIndexSection } from "./SemanticIndexSection";
import { McpSettingsSection } from "./McpSettingsSection";
import { SkillsSection } from "./SkillsSection";
import { SettingsGroup } from "./SettingsGroup";
import { AgentPolicyPanel } from "../AgentPolicyPanel";
import type { Memory } from "../../lib/memory";

interface SearxngStatus {
  docker_available: boolean;
  docker_installed: boolean;
  daemon_running: boolean;
  container_exists: boolean;
  container_running: boolean;
  is_responding: boolean;
  port: number;
}

export function ToolsTab() {
  const tavilyApiKey = useChatStore((s) => s.tavilyApiKey);
  const setTavilyApiKey = useChatStore((s) => s.setTavilyApiKey);
  const firecrawlApiKey = useChatStore((s) => s.firecrawlApiKey);
  const setFirecrawlApiKey = useChatStore((s) => s.setFirecrawlApiKey);
  const chatCodeExec = useChatStore((s) => s.chatCodeExec);
  const setChatCodeExec = useChatStore((s) => s.setChatCodeExec);
  const subagentsEnabled = useChatStore((s) => s.subagentsEnabled);
  const setSubagentsEnabled = useChatStore((s) => s.setSubagentsEnabled);
  const subagentSettings = useChatStore((s) => s.subagentSettings);
  const setSubagentSettings = useChatStore((s) => s.setSubagentSettings);
  const getModels = useChatStore((s) => s.getModels);
  const providerConfigs = useChatStore((s) => s.providerConfigs);
  const providerHealth = useChatStore((s) => s.providerHealth);
  const discoveredModels = useChatStore((s) => s.discoveredModels);
  const modelOverrides = useChatStore((s) => s.modelOverrides);
  const codexAuthStatus = useChatStore((s) => s.codexAuthStatus);
  void providerConfigs;
  void providerHealth;
  void discoveredModels;
  void modelOverrides;
  void codexAuthStatus;
  const models = getModels();
  const deepResearchMaxRounds = useChatStore((s) => s.deepResearchMaxRounds);
  const setDeepResearchMaxRounds = useChatStore((s) => s.setDeepResearchMaxRounds);
  const deepResearchMaxSearches = useChatStore((s) => s.deepResearchMaxSearches);
  const setDeepResearchMaxSearches = useChatStore((s) => s.setDeepResearchMaxSearches);

  const searchBackend = useChatStore((s) => s.searchBackend);
  const setSearchBackend = useChatStore((s) => s.setSearchBackend);
  const memoryEnabled = useChatStore((s) => s.memoryEnabled);
  const setMemoryEnabled = useChatStore((s) => s.setMemoryEnabled);

  // SearXNG Local Service Manager State
  const [searxngState, setSearxngState] = useState<SearxngStatus | null>(null);
  const [searxngLoading, setSearxngLoading] = useState(false);
  const [searxngError, setSearxngError] = useState<string | null>(null);
  const [searxngMessage, setSearxngMessage] = useState<string | null>(null);
  const [dockerActionProgress, setDockerActionProgress] = useState<string | null>(null);
  const [dockerPercent, setDockerPercent] = useState<number | null>(null);

  // Memory Settings State
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [newMemoryCategory, setNewMemoryCategory] = useState("fact");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const enabledModels = models.filter((model) => model.isAvailable);

  const updateSubagentModel = (kind: "explore" | "implement", value: string) => {
    setSubagentSettings({
      ...subagentSettings,
      models: {
        ...subagentSettings.models,
        [kind]: value === "current"
          ? { mode: "current" }
          : { mode: "model", modelId: value },
      },
    });
  };

  // Check SearXNG Docker status
  const checkSearxngStatus = useCallback(async () => {
    setSearxngLoading(true);
    setSearxngError(null);
    try {
      const status = await invoke<SearxngStatus>("searxng_status");
      setSearxngState(status);
    } catch (e) {
      setSearxngError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearxngLoading(false);
    }
  }, []);

  const handleStartSearxng = async () => {
    setSearxngLoading(true);
    setSearxngError(null);
    setSearxngMessage(null);
    try {
      await invoke("searxng_start");
      await checkSearxngStatus();
    } catch (e) {
      setSearxngError(e instanceof Error ? e.message : String(e));
      setSearxngLoading(false);
    }
  };

  const handleStopSearxng = async () => {
    setSearxngLoading(true);
    setSearxngError(null);
    setSearxngMessage(null);
    try {
      await invoke("searxng_stop");
      await checkSearxngStatus();
    } catch (e) {
      setSearxngError(e instanceof Error ? e.message : String(e));
      setSearxngLoading(false);
    }
  };

  const handleInstallDocker = async () => {
    setSearxngLoading(true);
    setDockerPercent(0);
    setDockerActionProgress("Downloading and installing Docker Desktop via Homebrew Cask. This downloads over 600MB and typically takes 1 to 3 minutes depending on your internet connection. Please wait...");
    setSearxngError(null);
    setSearxngMessage(null);
    try {
      const msg = await invoke<string>("searxng_install_docker");
      setSearxngMessage(msg);
      await checkSearxngStatus();
    } catch (e) {
      setSearxngError(e instanceof Error ? e.message : String(e));
    } finally {
      setDockerActionProgress(null);
      setDockerPercent(null);
      setSearxngLoading(false);
    }
  };

  const handleStartDockerDaemon = async () => {
    setSearxngLoading(true);
    setDockerActionProgress("Launching Docker Desktop app and starting daemon. This typically takes up to 30 seconds. Please wait...");
    setSearxngError(null);
    setSearxngMessage(null);
    try {
      const msg = await invoke<string>("searxng_start_docker_daemon");
      setSearxngMessage(msg);
      // Wait a few seconds for daemon to boot and recheck
      setTimeout(async () => {
        await checkSearxngStatus();
        setDockerActionProgress(null);
      }, 5000);
    } catch (e) {
      setSearxngError(e instanceof Error ? e.message : String(e));
      setDockerActionProgress(null);
      setSearxngLoading(false);
    }
  };

  // Memory operations
  const fetchMemories = useCallback(async () => {
    try {
      const { listMemories } = await import("../../lib/memory");
      const list = await listMemories();
      if (list && Array.isArray(list)) {
        list.sort((a, b) => b.created_at - a.created_at);
        setMemories(list);
      } else {
        setMemories([]);
      }
    } catch (e) {
      console.warn("Failed to fetch memories:", e);
    }
  }, []);

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newMemoryText.trim();
    if (!text) return;
    setMemoryLoading(true);
    try {
      const { addMemory } = await import("../../lib/memory");
      await addMemory(text, newMemoryCategory);
      setNewMemoryText("");
      await fetchMemories();
    } catch (e) {
      console.error("Failed to add memory:", e);
    } finally {
      setMemoryLoading(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      const { deleteMemory } = await import("../../lib/memory");
      await deleteMemory(id);
      await fetchMemories();
    } catch (e) {
      console.error("Failed to delete memory:", e);
    }
  };

  // Run on mount or backend change
  useEffect(() => {
    if (searchBackend === "searxng") {
      checkSearxngStatus();
    }
  }, [searchBackend, checkSearxngStatus]);

  useEffect(() => {
    if (memoryEnabled) {
      fetchMemories();
    }
  }, [memoryEnabled, fetchMemories]);

  // Listen for Docker install progress events
  useEffect(() => {
    let active = true;
    import("@tauri-apps/api/event").then(({ listen }) => {
      if (!active) return;
      listen<string>("docker-install-progress", (event) => {
        const text = event.payload;
        setDockerActionProgress(text);
        
        // Parse percentage from Homebrew / curl output if present (e.g. " 12.5%" or " 80%")
        const percentMatch = text.match(/(\d+(?:\.\d+)?)\%/);
        if (percentMatch) {
          const parsed = parseFloat(percentMatch[1]);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
            setDockerPercent(parsed);
          }
        } else if (text.includes("Installing Cask") || text.includes("Launching")) {
          setDockerPercent(null);
        }
      }).then((unlisten) => {
        if (!active) unlisten();
      });
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <SettingsGroup title="Search" description="Backends for the agent's web_search tool.">
        <div className="flex items-center justify-between gap-3 p-3.5 bg-surface-3 border border-white/5 rounded-xl transition-colors">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-medium text-text-1">Search Provider</span>
            <span className="text-[11px] text-text-3">Choose the metasearch provider for the web_search tool.</span>
          </div>
          <select
            value={searchBackend}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
            onChange={(e) => setSearchBackend(e.target.value as any)}
            className="h-[32px] px-3 bg-surface-2 border border-white/5 rounded-lg text-[13px] text-text-1 outline-none focus:border-white/15 cursor-pointer font-medium"
          >
            <option value="searxng">SearXNG (Local Docker metasearch)</option>
            <option value="tavily">Tavily (API Key required)</option>
          </select>
        </div>

        {searchBackend === "tavily" && (
          <TavilyKeyRow
            apiKey={tavilyApiKey}
            onSave={setTavilyApiKey}
            onRemove={() => setTavilyApiKey("")}
          />
        )}

        <TavilyKeyRow
          apiKey={firecrawlApiKey}
          onSave={setFirecrawlApiKey}
          onRemove={() => setFirecrawlApiKey("")}
          serviceName="Firecrawl Scrape"
          host="api.firecrawl.dev"
          placeholder="fc-..."
        />

        {searchBackend === "searxng" && (
          <div className="flex flex-col gap-3 p-3.5 bg-surface-3 border border-white/5 rounded-xl transition-colors">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-text-1">SearXNG Service Status</span>
                <span className="text-[11px] text-text-3">
                  Docker container running local metasearch on port 8080.
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[12px] font-mono">
                {searxngLoading ? (
                  <span className="text-text-3 flex items-center gap-1">
                    <RefreshCw size={12} className="animate-spin" /> Checking...
                  </span>
                ) : !searxngState ? (
                  <span className="text-text-3">Unknown</span>
                ) : !searxngState.docker_installed ? (
                  <span className="text-red-400">Docker Not Installed</span>
                ) : !searxngState.daemon_running ? (
                  <span className="text-red-400">Docker Daemon Stopped</span>
                ) : searxngState.is_responding ? (
                  <span className="text-success flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    Running
                  </span>
                ) : searxngState.container_running ? (
                  <span className="text-yellow-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                    Starting...
                  </span>
                ) : (
                  <span className="text-red-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    Stopped
                  </span>
                )}
              </div>
            </div>

            {searxngError && (
              <div className="text-[11.5px] text-error bg-red-500/5 border border-red-500/10 rounded-lg p-2.5 font-mono leading-normal whitespace-pre-wrap">
                {searxngError}
              </div>
            )}

            {searxngMessage && (
              <div className="text-[11.5px] text-success bg-success/5 border border-success/10 rounded-lg p-2.5 font-mono leading-normal">
                {searxngMessage}
              </div>
            )}

            {dockerActionProgress && (
              <div className="flex flex-col gap-2.5 p-3 bg-accent/5 border border-accent/10 rounded-lg font-mono text-[11.5px] text-accent leading-normal">
                <div className="flex items-center gap-2">
                  <RefreshCw size={12} className="animate-spin shrink-0" />
                  <span className="font-medium">Docker Setup Action in Progress</span>
                </div>
                <div className="text-text-3 text-[11px] select-all truncate bg-black/20 px-2 py-1.5 rounded border border-white/5">
                  {dockerActionProgress}
                </div>
                {dockerPercent !== null && (
                  <div className="flex flex-col gap-1 w-full mt-0.5">
                    <div className="flex justify-between text-[10px] text-text-4 font-bold">
                      <span>Downloading Cask Package</span>
                      <span>{dockerPercent.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-300 rounded-full"
                        style={{ width: `${dockerPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {searxngState && (
              <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                {!searxngState.docker_installed ? (
                  <button
                    onClick={handleInstallDocker}
                    disabled={searxngLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium bg-accent/10 text-accent hover:bg-accent/20 rounded-lg transition-colors"
                  >
                    <Play size={12} />
                    {dockerActionProgress ? "Installing Docker..." : "Install Docker Desktop (1-Click)"}
                  </button>
                ) : !searxngState.daemon_running ? (
                  <button
                    onClick={handleStartDockerDaemon}
                    disabled={searxngLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium bg-accent/10 text-accent hover:bg-accent/20 rounded-lg transition-colors"
                  >
                    <Play size={12} />
                    {dockerActionProgress ? "Starting Docker..." : "Start Docker Desktop"}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleStartSearxng}
                      disabled={searxngLoading || searxngState.is_responding}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-lg transition-colors ${
                        searxngState.is_responding
                          ? "bg-white/5 text-text-4 cursor-not-allowed"
                          : "bg-success/10 text-success hover:bg-success/20"
                      }`}
                    >
                      <Play size={12} />
                      Start Container
                    </button>
                    <button
                      onClick={handleStopSearxng}
                      disabled={searxngLoading || !searxngState.container_running}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-lg transition-colors ${
                        !searxngState.container_running
                          ? "bg-white/5 text-text-4 cursor-not-allowed"
                          : "bg-red-500/10 text-error hover:bg-red-500/20"
                      }`}
                    >
                      <Square size={12} />
                      Stop Container
                    </button>
                  </>
                )}
                <button
                  onClick={checkSearxngStatus}
                  disabled={searxngLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-text-2 bg-white/5 rounded-lg hover:bg-white/10 hover:text-text-1 transition-colors"
                >
                  <RefreshCw size={12} className={searxngLoading ? "animate-spin" : ""} />
                  Check Status
                </button>
              </div>
            )}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Deep Research" description="Configure sequential search limits and depths.">
        <div className="flex items-center justify-between gap-3 p-3.5 bg-surface-3 border border-white/5 rounded-xl transition-colors">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-medium text-text-1">Max Rounds</span>
            <span className="text-[11px] text-text-3">The maximum number of sequential research loops to execute.</span>
          </div>
          <input
            type="number"
            min={1}
            max={20}
            value={deepResearchMaxRounds}
            onChange={(e) => setDeepResearchMaxRounds(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-[80px] h-[32px] px-3 bg-surface-2 border border-white/5 rounded-lg text-[13px] text-text-1 text-center outline-none focus:border-white/15 font-mono"
          />
        </div>

        <div className="flex items-center justify-between gap-3 p-3.5 bg-surface-3 border border-white/5 rounded-xl transition-colors">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-medium text-text-1">Max Searches per Round</span>
            <span className="text-[11px] text-text-3">Maximum queries/URLs to scrape per query in each round.</span>
          </div>
          <input
            type="number"
            min={1}
            max={20}
            value={deepResearchMaxSearches}
            onChange={(e) => setDeepResearchMaxSearches(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-[80px] h-[32px] px-3 bg-surface-2 border border-white/5 rounded-lg text-[13px] text-text-1 text-center outline-none focus:border-white/15 font-mono"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Memory" description="Long-term memory management for the agent.">
        <ToggleRow
          enabled={memoryEnabled}
          onToggle={setMemoryEnabled}
          title="Persistent Memory"
          description="Allow the agent to remember and recall facts, preferences, and details across sessions."
        />

        {memoryEnabled && (
          <div className="flex flex-col gap-3 p-3.5 bg-surface-3 border border-white/5 rounded-xl transition-colors">
            {/* Add Memory Form */}
            <form onSubmit={handleAddMemory} className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-text-1">Add New Memory Record</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type a detail to remember (e.g. I prefer Python for coding)..."
                  value={newMemoryText}
                  onChange={(e) => setNewMemoryText(e.target.value)}
                  className="flex-1 h-[32px] px-2.5 bg-white/5 border border-white/10 rounded-lg text-[12px] text-text-1 placeholder:text-text-4 outline-none focus:border-accent/45 focus:ring-1 focus:ring-accent/20"
                />
                <select
                  value={newMemoryCategory}
                  onChange={(e) => setNewMemoryCategory(e.target.value)}
                  className="h-[32px] px-2 bg-white/5 border border-white/10 rounded-lg text-[12px] text-text-1 outline-none focus:border-accent/45 focus:ring-1 focus:ring-accent/20 cursor-pointer"
                >
                  <option value="fact">Fact</option>
                  <option value="preference">Preference</option>
                  <option value="contact">Contact</option>
                  <option value="task">Task</option>
                </select>
                <button
                  type="submit"
                  disabled={memoryLoading || !newMemoryText.trim()}
                  className="primary-action h-[32px] px-3 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg text-[12px] font-medium transition-colors flex items-center gap-1.5"
                >
                  <Plus size={12} strokeWidth={2.5} />
                  Add
                </button>
              </div>
            </form>

            {/* Memory List */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
              <span className="text-[12.5px] font-medium text-text-1 mb-1">
                Saved Memories ({memories.length})
              </span>

              {memories.length === 0 ? (
                <div className="text-center py-4 text-[12px] text-text-3">
                  No memory records saved yet. The agent will add records automatically or you can add them manually.
                </div>
              ) : (
                <div className="max-h-[250px] overflow-y-auto flex flex-col gap-1.5 pr-1">
                  {memories.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-start justify-between gap-3 p-2.5 bg-surface-2/60 border border-white/5 rounded-lg hover:border-white/10 transition-colors"
                    >
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase font-mono ${
                            m.category === "preference"
                              ? "bg-accent/10 text-accent"
                              : m.category === "contact"
                                ? "bg-blue-500/10 text-blue-400"
                                : m.category === "task"
                                  ? "bg-green-500/10 text-green-400"
                                  : "bg-accent/10 text-accent"
                          }`}>
                            {m.category}
                          </span>
                          <span className="text-[10px] text-text-4 font-mono">
                            Uses: {m.uses}
                          </span>
                          <span className="text-[10px] text-text-4 font-mono">
                            {new Date(m.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <span className="text-[12.5px] text-text-1 leading-relaxed break-words pr-2">
                          {m.text}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteMemory(m.id)}
                        className="p-1.5 text-text-3 hover:text-error hover:bg-red-500/10 rounded-md transition-colors shrink-0"
                        title="Delete memory record"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Execution" description="What the agent can run beyond chat.">
        <ToggleRow
          enabled={chatCodeExec}
          onToggle={setChatCodeExec}
          title="Code execution in Chat"
          description="Python and JavaScript snippets in chat mode. Each run asks for approval."
        />
        <ToggleRow
          enabled={subagentsEnabled}
          onToggle={setSubagentsEnabled}
          title="Subagents"
          description="Spawn child agents for parallel work in Agent and Design modes only."
        />
        {subagentsEnabled && (
          <div className="soft-card grid gap-3 rounded-xl p-3.5">
            <div className="grid gap-1">
              <div className="text-[12.5px] font-medium text-text-1">Subagent models</div>
              <div className="text-[11px] leading-relaxed text-text-3">
                Use the current chat model, or route exploration and implementation to specific enabled models.
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["explore", "implement"] as const).map((kind) => {
                const selection = subagentSettings.models[kind];
                return (
                  <label key={kind} className="grid gap-1.5">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wider text-text-4">
                      {kind === "explore" ? "Exploration" : "Implementation"}
                    </span>
                    <select
                      value={selection.mode === "model" ? selection.modelId : "current"}
                      onChange={(event) => updateSubagentModel(kind, event.currentTarget.value)}
                      className="min-w-0 rounded-md border border-hairline bg-surface-1 px-2 py-1.5 text-[12px] text-text-1 outline-none transition-colors focus:border-hairline-strong focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                    >
                      <option value="current">Current chat model</option>
                      {enabledModels.map((model) => (
                        <option key={`${kind}-${model.id}`} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            <div className="text-[11px] leading-relaxed text-text-3">
              Stalled subagents are stopped after {Math.round(subagentSettings.staleAfterMs / 1000)} seconds without tokens or tool progress.
            </div>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Agent policy" description="Verification, permission, path, and budget defaults for agent mode.">
        <AgentPolicyPanel embedded />
      </SettingsGroup>

      <SettingsGroup title="Integrations" description="External tools and reusable agent capabilities.">
        <McpSettingsSection embedded />
        <SkillsSection embedded />
      </SettingsGroup>

      <SettingsGroup title="Workspace" description="Semantic search over the active project.">
        <SemanticIndexSection />
      </SettingsGroup>
    </>
  );
}
