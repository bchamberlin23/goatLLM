import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  Brain,
  CalendarClock,
  Cloud,
  Cpu,
  Flag,
  Layout,
  Mic2,
  Search,
  Shield,
  Sparkles,
} from "lucide-react";
import { ProvidersTab } from "./ProvidersTab";
import { ToolsTab } from "./ToolsTab";
import { InterfaceTab } from "./InterfaceTab";
import { AdvancedTab } from "./AdvancedTab";
import { SettingsGroup } from "./SettingsGroup";
import { ToggleRow } from "./ToggleRow";
import { useChatStore, type ProductFeatureFlags } from "../../stores/chat";
import { normalizeSyncConfig } from "../../lib/product-workspace";

const TAB_STORAGE_KEY = "goatllm-settings-tab";

export type SettingsTabId =
  | "providers"
  | "appearance"
  | "features"
  | "cost"
  | "voice"
  | "sync"
  | "memory"
  | "prompts"
  | "schedules"
  | "advanced";

const TABS: { id: SettingsTabId; label: string; hint: string; icon: typeof Cpu; keywords: string }[] = [
  { id: "providers", label: "Providers", hint: "Models and keys", icon: Cpu, keywords: "providers models api keys openai anthropic ollama lm studio" },
  { id: "appearance", label: "Appearance", hint: "Canvas and polish", icon: Layout, keywords: "appearance interface artifacts design theme liquid glass" },
  { id: "features", label: "Feature Flags", hint: "Product modules", icon: Flag, keywords: "flags beta toggles modules pursue goal" },
  { id: "cost", label: "Cost & Budget", hint: "Usage controls", icon: BarChart3, keywords: "cost usage tokens budget spending alerts price" },
  { id: "voice", label: "Voice", hint: "Speak and dictate", icon: Mic2, keywords: "voice text to speech tts dictate microphone hands free" },
  { id: "sync", label: "Sync", hint: "iCloud and S3", icon: Cloud, keywords: "cloud sync icloud s3 encrypted cross device" },
  { id: "memory", label: "Memory/RAG", hint: "Retrieval controls", icon: Brain, keywords: "memory rag embeddings retrieval provenance documents source" },
  { id: "prompts", label: "Prompt Library", hint: "Versioned prompts", icon: BookOpen, keywords: "prompt library templates version tags share fork clone" },
  { id: "schedules", label: "Scheduled Agents", hint: "Recurring runs", icon: CalendarClock, keywords: "scheduled agents cron recurring daily nightly digest" },
  { id: "advanced", label: "Advanced", hint: "Tools and developer", icon: Shield, keywords: "advanced developer tools mcp search searxng permissions skills semantic" },
];

function loadStoredTab(): SettingsTabId {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored && TABS.some((t) => t.id === stored)) return stored as SettingsTabId;
  } catch {
    // ignore
  }
  return "providers";
}

function Field({
  label,
  children,
  description,
}: {
  label: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[12px] text-text-3">
      <span className="font-medium text-text-2">{label}</span>
      {children}
      {description && <span className="leading-relaxed text-text-4">{description}</span>}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 rounded-lg border border-white/[0.08] bg-black/20 px-3 text-[12.5px] text-text-1 placeholder:text-text-3 outline-none focus:border-accent/45 ${props.className ?? ""}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-9 rounded-lg border border-white/[0.08] bg-[#171719] px-3 text-[12.5px] text-text-1 outline-none focus:border-accent/45 ${props.className ?? ""}`}
    />
  );
}

const FEATURE_LABELS: Record<keyof ProductFeatureFlags, { title: string; description: string }> = {
  costDashboard: { title: "Cost dashboard", description: "Per-conversation token, cost, budget, and alert surfaces." },
  modelComparison: { title: "Model comparison", description: "Parallel multi-model prompting with metrics and diff view." },
  browserMirror: { title: "Browser mirror", description: "Embedded panel for agent-visible browser state." },
  notebookMode: { title: "Notebook mode", description: "Runnable text, Python, and AI prompt cells." },
  imageGeneration: { title: "Image generation", description: "OpenAI, Flux, Stable Diffusion, and custom image endpoints." },
  cloudSync: { title: "Cloud sync", description: "Opt-in encrypted export/import to iCloud Drive or S3-compatible storage." },
  promptLibrary: { title: "Prompt library", description: "Versioned `.goat/prompts/*.md` manager with search and stats." },
  scheduledAgents: { title: "Scheduled agents", description: "Cron-style recurring agent runs with next-open results." },
  ragMemory: { title: "RAG and memory", description: "Source, retrieval, memory, provenance, and deletion controls." },
  filesystemWatcher: { title: "Filesystem watcher", description: "Native notify events for external changes and generated artifacts." },
  pursueGoal: { title: "Pursue Goal", description: "One-shot autonomous goal execution under the + menu." },
};

export function SettingsTabs() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(loadStoredTab);
  const [query, setQuery] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  const filteredTabs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return TABS;
    return TABS.filter((tab) => `${tab.label} ${tab.hint} ${tab.keywords}`.toLowerCase().includes(needle));
  }, [query]);

  useEffect(() => {
    if (filteredTabs.length > 0 && !filteredTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(filteredTabs[0].id);
    }
  }, [activeTab, filteredTabs]);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
        const next = (index + dir + filteredTabs.length) % filteredTabs.length;
        setActiveTab(filteredTabs[next].id);
        tabRefs.current[next]?.focus();
      }
    },
    [filteredTabs],
  );

  return (
    <div className="flex flex-1 min-h-0 max-[760px]:flex-col">
      <aside className="w-[236px] shrink-0 border-r border-white/[0.06] bg-black/15 p-3 max-[760px]:w-full max-[760px]:border-r-0 max-[760px]:border-b">
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" aria-hidden="true" />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            className="w-full pl-8"
            aria-label="Search settings"
          />
        </div>
        <nav
          className="flex max-h-[calc(88vh-150px)] flex-col gap-1 overflow-y-auto [scrollbar-width:none] max-[760px]:max-h-none max-[760px]:flex-row max-[760px]:overflow-x-auto"
          aria-label="Settings sections"
          role="tablist"
        >
          {filteredTabs.map((tab, index) => {
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
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-[background,border-color,color,box-shadow] max-[760px]:min-w-[180px] ${
                  isActive
                    ? "border-accent/28 bg-accent/10 text-text-1 shadow-[0_18px_48px_-34px_rgba(245,158,66,0.9),inset_0_1px_0_rgba(255,255,255,0.055)]"
                    : "border-transparent text-text-3 hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-text-2"
                }`}
              >
                <Icon size={15} strokeWidth={1.75} className={isActive ? "text-accent" : ""} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{tab.label}</span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-text-4">{tab.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div
        className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 min-w-0 max-[760px]:p-4"
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === activeTab)?.label}
      >
        {activeTab === "providers" && <ProvidersTab />}
        {activeTab === "appearance" && <AppearanceSettings />}
        {activeTab === "features" && <FeatureFlagSettings />}
        {activeTab === "cost" && <CostSettings />}
        {activeTab === "voice" && <VoiceSettings />}
        {activeTab === "sync" && <SyncSettings />}
        {activeTab === "memory" && <MemorySettings />}
        {activeTab === "prompts" && <PromptLibrarySettings />}
        {activeTab === "schedules" && <ScheduleSettings />}
        {activeTab === "advanced" && <AdvancedDeveloperSettings />}
      </div>
    </div>
  );
}

function AppearanceSettings() {
  return (
    <>
      <InterfaceTab />
    </>
  );
}

function FeatureFlagSettings() {
  const featureFlags = useChatStore((s) => s.featureFlags);
  const setFeatureFlag = useChatStore((s) => s.setFeatureFlag);
  return (
    <SettingsGroup title="Product modules" description="Control which expansion features appear in the + menu and workspace panel.">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {(Object.keys(FEATURE_LABELS) as (keyof ProductFeatureFlags)[]).map((key) => (
          <ToggleRow
            key={key}
            enabled={featureFlags[key]}
            onToggle={(enabled) => setFeatureFlag(key, enabled)}
            title={FEATURE_LABELS[key].title}
            description={FEATURE_LABELS[key].description}
          />
        ))}
      </div>
    </SettingsGroup>
  );
}

function CostSettings() {
  const usageSettings = useChatStore((s) => s.usageSettings);
  const setUsageSettings = useChatStore((s) => s.setUsageSettings);
  return (
    <>
      <SettingsGroup title="Budget status" description="Controls the conversation usage dashboard and expensive-session warnings.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Monthly budget">
            <TextInput
              type="number"
              min={0}
              step={1}
              value={usageSettings.monthlyBudgetUsd}
              onChange={(e) => setUsageSettings({ ...usageSettings, monthlyBudgetUsd: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Expensive-session alert">
            <TextInput
              type="number"
              min={0}
              step={0.1}
              value={usageSettings.expensiveSessionUsd}
              onChange={(e) => setUsageSettings({ ...usageSettings, expensiveSessionUsd: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
        <div className="mt-3">
          <ToggleRow
            enabled={usageSettings.showInlineAlerts}
            onToggle={(enabled) => setUsageSettings({ ...usageSettings, showInlineAlerts: enabled })}
            title="Inline budget alerts"
            description="Surface cost warnings when a conversation crosses configured thresholds."
          />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Price overrides" description="Optional JSON keyed by model id, e.g. openai:gpt-4o.">
        <textarea
          value={JSON.stringify(usageSettings.priceOverrides, null, 2)}
          onChange={(e) => {
            try {
              setUsageSettings({ ...usageSettings, priceOverrides: JSON.parse(e.target.value) });
            } catch {
              // keep typing until JSON is valid
            }
          }}
          className="min-h-[180px] w-full rounded-xl border border-white/[0.08] bg-black/20 p-3 font-mono text-[12px] text-text-1 outline-none focus:border-accent/45"
        />
      </SettingsGroup>
    </>
  );
}

function VoiceSettings() {
  const voiceSettings = useChatStore((s) => s.voiceSettings);
  const setVoiceSettings = useChatStore((s) => s.setVoiceSettings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.onvoiceschanged = refresh;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  return (
    <>
      <SettingsGroup title="Voice output" description="Playback controls for assistant responses.">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ToggleRow enabled={voiceSettings.enabled} onToggle={(enabled) => setVoiceSettings({ ...voiceSettings, enabled })} title="Enable voice" description="Show response playback controls on assistant messages." />
          <ToggleRow enabled={voiceSettings.autoPlayAssistant} onToggle={(autoPlayAssistant) => setVoiceSettings({ ...voiceSettings, autoPlayAssistant })} title="Auto-play fresh responses" description="Speak new assistant replies after they complete." />
          <ToggleRow enabled={voiceSettings.handsFree} onToggle={(handsFree) => setVoiceSettings({ ...voiceSettings, handsFree, autoPlayAssistant: handsFree ? true : voiceSettings.autoPlayAssistant })} title="Hands-free dictate -> hear" description="Send final dictation automatically and read the response aloud." />
          <Field label="Voice">
            <Select value={voiceSettings.voiceURI} onChange={(e) => setVoiceSettings({ ...voiceSettings, voiceURI: e.target.value })}>
              <option value="">System default</option>
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
              ))}
            </Select>
          </Field>
          <Field label="Rate">
            <TextInput type="number" min={0.5} max={2} step={0.05} value={voiceSettings.rate} onChange={(e) => setVoiceSettings({ ...voiceSettings, rate: Number(e.target.value) || 1 })} />
          </Field>
          <Field label="Pitch">
            <TextInput type="number" min={0.5} max={2} step={0.05} value={voiceSettings.pitch} onChange={(e) => setVoiceSettings({ ...voiceSettings, pitch: Number(e.target.value) || 1 })} />
          </Field>
        </div>
      </SettingsGroup>
    </>
  );
}

function SyncSettings() {
  const syncSettings = useChatStore((s) => s.syncSettings);
  const setSyncSettings = useChatStore((s) => s.setSyncSettings);
  return (
    <SettingsGroup title="Encrypted cloud sync" description="Opt-in sync package target for iCloud Drive or user-supplied S3-compatible storage.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ToggleRow enabled={syncSettings.enabled} onToggle={(enabled) => setSyncSettings({ ...syncSettings, enabled })} title="Enable sync" description="Allow export/import actions from the Workspace sync panel." />
        <Field label="Provider">
          <Select
            value={syncSettings.provider}
            onChange={(e) => setSyncSettings(normalizeSyncConfig({ ...syncSettings, provider: e.target.value as "icloud" | "s3" }))}
          >
            <option value="icloud">iCloud Drive</option>
            <option value="s3">S3-compatible</option>
          </Select>
        </Field>
        <Field label="Prefix">
          <TextInput value={syncSettings.prefix ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, prefix: e.target.value })} />
        </Field>
        <Field label="Encryption passphrase / hint">
          <TextInput value={syncSettings.encryptionKeyHint ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, encryptionKeyHint: e.target.value })} />
        </Field>
        <Field label="S3 bucket">
          <TextInput value={syncSettings.bucket ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, bucket: e.target.value })} />
        </Field>
        <Field label="S3 endpoint">
          <TextInput value={syncSettings.endpoint ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, endpoint: e.target.value })} placeholder="https://... or file:///..." />
        </Field>
      </div>
    </SettingsGroup>
  );
}

function MemorySettings() {
  const ragSettings = useChatStore((s) => s.ragSettings);
  const setRagSettings = useChatStore((s) => s.setRagSettings);
  const memoryEnabled = useChatStore((s) => s.memoryEnabled);
  const setMemoryEnabled = useChatStore((s) => s.setMemoryEnabled);
  return (
    <>
      <SettingsGroup title="Memory and retrieval" description="Control what can be remembered, retrieved, and shown with provenance.">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ToggleRow enabled={memoryEnabled} onToggle={setMemoryEnabled} title="Long-term memory" description="Allow memories to be saved and searched during chat turns." />
          <ToggleRow enabled={ragSettings.projectMemory} onToggle={(projectMemory) => setRagSettings({ ...ragSettings, projectMemory })} title="Project memory" description="Use project-scoped memory sources when available." />
          <ToggleRow enabled={ragSettings.conversationMemory} onToggle={(conversationMemory) => setRagSettings({ ...ragSettings, conversationMemory })} title="Conversation memory" description="Use conversation-specific remembered facts." />
          <ToggleRow enabled={ragSettings.retrievalPreview} onToggle={(retrievalPreview) => setRagSettings({ ...ragSettings, retrievalPreview })} title="Retrieval preview" description="Show what memory snippets were retrieved before use." />
          <ToggleRow enabled={ragSettings.provenance} onToggle={(provenance) => setRagSettings({ ...ragSettings, provenance })} title="Provenance" description="Track where remembered context came from." />
          <Field label="Max retrieved memories">
            <TextInput type="number" min={1} max={24} value={ragSettings.maxRetrievedMemories} onChange={(e) => setRagSettings({ ...ragSettings, maxRetrievedMemories: Number(e.target.value) || 8 })} />
          </Field>
        </div>
      </SettingsGroup>
    </>
  );
}

function PromptLibrarySettings() {
  const workspacePath = useChatStore((s) => s.workspacePath);
  const openWorkspacePanel = useChatStore((s) => s.openWorkspacePanel);
  return (
    <SettingsGroup title="Prompt library" description="Visual manager for `.goat/prompts/*.md` with local history, stats, tags, clone, and share.">
      <div className="soft-card rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-text-1">{workspacePath ? workspacePath : "No workspace selected"}</div>
            <div className="mt-1 text-[11px] text-text-3">Open the workspace panel to edit prompts and save versions to disk.</div>
          </div>
          <button type="button" className="primary-action rounded-lg px-3 py-1.5 text-[12px] font-medium" onClick={() => openWorkspacePanel("prompts")}>
            Open Library
          </button>
        </div>
      </div>
    </SettingsGroup>
  );
}

function ScheduleSettings() {
  const scheduledAgents = useChatStore((s) => s.scheduledAgents);
  const openWorkspacePanel = useChatStore((s) => s.openWorkspacePanel);
  return (
    <SettingsGroup title="Scheduled agents" description="Cron-style recurring runs for digests, repo checks, and periodic work.">
      <div className="soft-card rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[22px] font-semibold text-text-1">{scheduledAgents.length}</div>
            <div className="text-[11px] text-text-3">configured recurring agents</div>
          </div>
          <button type="button" className="primary-action rounded-lg px-3 py-1.5 text-[12px] font-medium" onClick={() => openWorkspacePanel("schedules")}>
            Manage Runs
          </button>
        </div>
      </div>
    </SettingsGroup>
  );
}

function AdvancedDeveloperSettings() {
  return (
    <>
      <ToolsTab />
      <AdvancedTab />
      <SettingsGroup title="Developer note" description="Use the Workspace panel for watcher, sync, prompt library, notebook, browser, and image generation operational views.">
        <div className="soft-card flex items-center gap-3 rounded-xl p-4 text-[12.5px] text-text-2">
          <Sparkles size={15} className="text-accent" />
          Feature architecture is persisted locally and connected to Tauri commands where native access is required.
        </div>
      </SettingsGroup>
    </>
  );
}
