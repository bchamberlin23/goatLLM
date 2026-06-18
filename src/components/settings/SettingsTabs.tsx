import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Brain,
  CalendarClock,
  Cloud,
  Cpu,
  Eye,
  FileText,
  Flag,
  Image as ImageIcon,
  Layout,
  Mic2,
  Search,
  Shield,
  Sparkles,
  Plus,
  DownloadCloud,
  UploadCloud,
  Tag,
  Check,
  Copy,
  Trash2,
  Edit3,
  RefreshCw,
  Play,
  Pin,
} from "lucide-react";
import { ProvidersTab } from "./ProvidersTab";
import { ToolsTab } from "./ToolsTab";
import { InterfaceTab } from "./InterfaceTab";
import { AdvancedTab } from "./AdvancedTab";
import { SettingsGroup } from "./SettingsGroup";
import { ToggleRow } from "./ToggleRow";
import { useChatStore, type ProductFeatureFlags, type ScheduledAgent, type ImageGenSettings } from "../../stores/chat";
import { loadPromptTemplates } from "../../lib/prompt-templates";
import type { Memory } from "../../lib/memory";
import { createPromptVersion, filterPromptDocuments, type PromptDocument } from "../../lib/product-workspace";
import {
  createKnowledgeDocument,
  deleteDocumentChunks,
  embedKnowledgeDocument,
  searchKnowledgeDocuments,
  setDocumentEmbedded,
  setDocumentPinned,
  type KnowledgeDocument,
  type RetrievalPreviewHit,
} from "../../lib/document-workspace";
import { computeNextScheduledRun, type ScheduledAgentRun } from "../../lib/scheduled-agents";
import { buildMemoryProvenance } from "../../lib/memory-extraction";
import { invoke } from "@tauri-apps/api/core";

const TAB_STORAGE_KEY = "goatllm-settings-tab";

export type SettingsTabId =
  | "providers"
  | "appearance"
  | "features"
  | "voice"
  | "images"
  | "cost"
  | "prompts"
  | "sync"
  | "memory"
  | "schedules"
  | "watcher"
  | "advanced";

const TABS: { id: SettingsTabId; label: string; hint: string; icon: typeof Cpu; keywords: string }[] = [
  { id: "providers", label: "Providers", hint: "Models and keys", icon: Cpu, keywords: "providers models api keys openai anthropic ollama lm studio" },
  { id: "appearance", label: "Appearance", hint: "Canvas and polish", icon: Layout, keywords: "appearance interface artifacts design theme liquid glass" },
  { id: "features", label: "Feature Flags", hint: "Product modules", icon: Flag, keywords: "flags beta toggles modules pursue goal" },
  { id: "voice", label: "Voice", hint: "Speak and dictate", icon: Mic2, keywords: "voice text to speech tts dictate microphone hands free" },
  { id: "images", label: "Images", hint: "Generation settings", icon: ImageIcon, keywords: "image generation flux stable diffusion openai endpoint" },
  { id: "cost", label: "Cost & Budget", hint: "Spending controls", icon: BarChart3, keywords: "cost usage tokens budget spending alerts price" },
  { id: "prompts", label: "Prompt Library", hint: "Versioned prompts", icon: FileText, keywords: "prompt library templates version tags share fork clone" },
  { id: "sync", label: "Sync", hint: "iCloud and S3", icon: Cloud, keywords: "cloud sync icloud s3 encrypted cross device" },
  { id: "memory", label: "Memory/RAG", hint: "Retrieval controls", icon: Brain, keywords: "memory rag embeddings retrieval provenance documents source" },
  { id: "schedules", label: "Scheduled Agents", hint: "Recurring runs", icon: CalendarClock, keywords: "scheduled agents cron recurring daily nightly digest" },
  { id: "watcher", label: "Watcher", hint: "File system events", icon: Eye, keywords: "watcher filesystem events notify changes" },
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
      className={`motion-feedback h-9 rounded-lg border border-hairline-strong bg-black/20 px-3 text-[12.5px] text-text-1 placeholder:text-text-3 outline-none focus:border-accent/45 ${props.className ?? ""}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`motion-feedback h-9 rounded-lg border border-hairline-strong bg-sunken px-3 text-[12.5px] text-text-1 outline-none focus:border-accent/45 ${props.className ?? ""}`}
    />
  );
}

const FEATURE_LABELS: Record<Exclude<keyof ProductFeatureFlags, "notebookMode">, { title: string; description: string }> = {
  costDashboard: { title: "Cost dashboard", description: "Per-conversation token, cost, budget, and alert surfaces." },
  modelComparison: { title: "Model comparison", description: "Parallel multi-model prompting with metrics and diff view." },
  browserMirror: { title: "Browser mirror", description: "Embedded panel for agent-visible browser state." },
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
      <aside className="w-[236px] shrink-0 border-r border-hairline bg-black/15 p-3 max-[760px]:w-full max-[760px]:border-r-0 max-[760px]:border-b">
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
                className={`motion-feedback flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-[background,border-color,color,box-shadow,transform] max-[760px]:min-w-[180px] ${
                  isActive
                    ? "border-accent/28 bg-accent/10 text-text-1 shadow-[0_18px_48px_-34px_rgba(245,158,66,0.9),inset_0_1px_0_rgba(255,255,255,0.055)]"
                    : "border-transparent text-text-3 hover:border-hairline-strong hover:bg-white/5 hover:text-text-2"
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
        <div key={activeTab} className="motion-reveal flex flex-col gap-6">
          {activeTab === "providers" && <ProvidersTab />}
          {activeTab === "appearance" && <AppearanceSettings />}
          {activeTab === "features" && <FeatureFlagSettings />}
          {activeTab === "voice" && <VoiceSettings />}
          {activeTab === "images" && <ImageSettings />}
          {activeTab === "cost" && <CostSettings />}
          {activeTab === "prompts" && <PromptsSettings />}
          {activeTab === "sync" && <SyncSettings />}
          {activeTab === "memory" && <MemorySettings />}
          {activeTab === "schedules" && <ScheduleSettings />}
          {activeTab === "watcher" && <WatcherSettings />}
          {activeTab === "advanced" && <AdvancedDeveloperSettings />}
        </div>
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
    <SettingsGroup title="Product modules" description="Enable or disable features across the app. Usage, comparison, browser, notebook, images, prompts, sync, memory, watcher, and schedules are integrated directly into the app.">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {(Object.keys(FEATURE_LABELS) as (keyof typeof FEATURE_LABELS)[]).map((key) => (
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

function ImageSettings() {
  const imageGenSettings = useChatStore((s) => s.imageGenSettings);
  const setImageGenSettings = useChatStore((s) => s.setImageGenSettings);

  const ollamaModels = [
    { name: "flux2-klein:4b", size: "5.7 GB", rec: true },
    { name: "flux2-klein:9b", size: "12 GB", rec: false },
  ];

  const showSizeSelector = imageGenSettings.provider === "openai" || imageGenSettings.provider === "ollama";
  const showCustomEndpoint = imageGenSettings.provider === "flux" || imageGenSettings.provider === "stable-diffusion" || imageGenSettings.provider === "custom";
  const showOllamaInfo = imageGenSettings.provider === "ollama";

  return (
    <SettingsGroup title="Image generation" description="Configure provider, model, and endpoint for the image generation button in the input bar.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Provider">
          <Select value={imageGenSettings.provider} onChange={(e) => {
            const provider = e.target.value as ImageGenSettings["provider"];
            const defaults: Record<string, string> = {
              openai: "gpt-image-1.5",
              ollama: "flux2-klein:4b",
              flux: "flux-schnell",
              "stable-diffusion": "sd3-medium",
              custom: "",
            };
            setImageGenSettings({ ...imageGenSettings, provider, model: defaults[provider] || "" });
          }}>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama (local)</option>
            <option value="flux">Flux</option>
            <option value="stable-diffusion">Stable Diffusion</option>
            <option value="custom">Custom endpoint</option>
          </Select>
        </Field>
        {showOllamaInfo ? (
          <Field label="Model">
            <Select value={imageGenSettings.model} onChange={(e) => setImageGenSettings({ ...imageGenSettings, model: e.target.value })}>
              {ollamaModels.map((m) => (
                <option key={m.name} value={m.name}>{m.name} ({m.size})</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Model">
            <TextInput value={imageGenSettings.model} onChange={(e) => setImageGenSettings({ ...imageGenSettings, model: e.target.value })} placeholder={imageGenSettings.provider === "openai" ? "gpt-image-1.5" : "model-name"} />
          </Field>
        )}
        {showSizeSelector && (
          <Field label="Size">
            <Select value={imageGenSettings.size} onChange={(e) => setImageGenSettings({ ...imageGenSettings, size: e.target.value })}>
              <option value="1024x1024">1024×1024</option>
              <option value="1792x1024">1792×1024</option>
              <option value="1024x1792">1024×1792</option>
            </Select>
          </Field>
        )}
        {showCustomEndpoint && (
          <Field label="Custom endpoint URL">
            <TextInput value={imageGenSettings.customEndpoint} onChange={(e) => setImageGenSettings({ ...imageGenSettings, customEndpoint: e.target.value })} placeholder="https://..." />
          </Field>
        )}
      </div>

      {showOllamaInfo && (
        <div className="mt-4 rounded-xl border border-hairline-strong bg-black/20 p-4">
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[12px] font-medium text-text-1">Recommended Ollama image models</div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ollamaModels.map((m) => (
                  <div key={m.name} className={`rounded-lg border px-3 py-2 text-[12px] ${m.rec ? "border-accent/25 bg-accent/[0.04]" : "border-hairline"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-text-1">{m.name}</span>
                      {m.rec && <span className="text-[10px] text-accent font-medium">Recommended</span>}
                    </div>
                    <div className="mt-0.5 text-text-3">{m.size}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-accent/20 bg-accent/[0.05] px-3 py-2">
              <p className="text-[11.5px] text-accent leading-relaxed">
                <strong>Memory warning:</strong> Running an image model alongside an LLM can consume significant VRAM.
                The 4B model uses ~5.7 GB and the 9B uses ~12 GB. Make sure you have enough GPU memory free,
                especially if you already have a large LLM loaded in Ollama. On limited hardware, consider
                unloading your LLM before generating images (<code className="text-[10.5px] font-mono">ollama stop &lt;model&gt;</code>).
              </p>
            </div>
          </div>
        </div>
      )}
    </SettingsGroup>
  );
}

function CostSettings() {
  const usageSettings = useChatStore((s) => s.usageSettings);
  const setUsageSettings = useChatStore((s) => s.setUsageSettings);
  return (
    <>
      <SettingsGroup title="Budget" description="Controls the conversation cost tracking in the context meter and inline alerts.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Monthly budget (USD)">
            <TextInput
              type="number"
              min={0}
              step={1}
              value={usageSettings.monthlyBudgetUsd}
              onChange={(e) => setUsageSettings({ ...usageSettings, monthlyBudgetUsd: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Expensive-session alert (USD)">
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
      <SettingsGroup title="Price overrides" description="Custom per-model pricing as JSON. Keys are model IDs, values have inputPerMillion and outputPerMillion.">
        <textarea
          value={JSON.stringify(usageSettings.priceOverrides, null, 2)}
          onChange={(e) => {
            try {
              setUsageSettings({ ...usageSettings, priceOverrides: JSON.parse(e.target.value) });
            } catch { /* keep typing until valid JSON */ }
          }}
          className="min-h-[160px] w-full rounded-xl border border-hairline-strong bg-black/20 p-3 font-mono text-[11.5px] text-text-1 outline-none focus:border-accent/45"
          placeholder='{"openai:gpt-4o": {"inputPerMillion": 2.50, "outputPerMillion": 10.00}}'
        />
      </SettingsGroup>
    </>
  );
}

// ── Prompt Library ──

function promptDocsStorageKey(workspace: string) {
  return `goatllm-prompt-docs:${workspace}`;
}

function loadPromptDocHistory(workspace: string): Record<string, PromptDocument> {
  try {
    const raw = localStorage.getItem(promptDocsStorageKey(workspace));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePromptDocHistory(workspace: string, docs: Record<string, PromptDocument>) {
  try {
    localStorage.setItem(promptDocsStorageKey(workspace), JSON.stringify(docs));
  } catch { /* ignore quota */ }
}

function PromptsSettings() {
  const workspace = useChatStore((s) => s.workspacePath);
  const [docs, setDocs] = useState<PromptDocument[]>([]);
  const [selected, setSelected] = useState<PromptDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    if (!workspace) return;
    const templates = await loadPromptTemplates(workspace).catch(() => []);
    const saved = loadPromptDocHistory(workspace);
    const next: Record<string, PromptDocument> = { ...saved };
    for (const tpl of templates) {
      if (!next[tpl.name]) {
        next[tpl.name] = createPromptVersion(tpl.name, tpl.content, {
          description: tpl.description,
          tags: tpl.argumentHint ? [tpl.argumentHint] : [],
        });
      } else if (next[tpl.name].body !== tpl.content) {
        next[tpl.name] = createPromptVersion(tpl.name, tpl.content, {
          previous: next[tpl.name],
          description: tpl.description,
          tags: next[tpl.name].tags,
        });
      }
    }
    savePromptDocHistory(workspace, next);
    setDocs(Object.values(next).sort((a, b) => b.updatedAt - a.updatedAt));
    if (!selected && Object.values(next)[0]) {
      setSelected(Object.values(next)[0]);
      setDraft(Object.values(next)[0].body);
    }
  }, [workspace, selected]);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => filterPromptDocuments(docs, query), [docs, query]);

  const saveDoc = async () => {
    if (!workspace || !selected) return;
    const next = createPromptVersion(selected.name, draft, { previous: selected, tags: selected.tags });
    await invoke("create_dir_abs", { path: `${workspace}/.goat/prompts` }).catch(() => undefined);
    await invoke("write_file", { workspace, path: `.goat/prompts/${next.name}.md`, content: next.body });
    const map = loadPromptDocHistory(workspace);
    map[next.name] = next;
    savePromptDocHistory(workspace, map);
    setSelected(next);
    setDocs(Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt));
    setStatus("Saved.");
  };

  const cloneDoc = async () => {
    if (!workspace || !selected) return;
    const name = `${selected.name}-copy-${Date.now().toString(36)}`;
    const next = createPromptVersion(name, selected.body, { description: selected.description, tags: selected.tags });
    await invoke("create_dir_abs", { path: `${workspace}/.goat/prompts` }).catch(() => undefined);
    await invoke("write_file", { workspace, path: `.goat/prompts/${name}.md`, content: next.body });
    const map = loadPromptDocHistory(workspace);
    map[name] = next;
    savePromptDocHistory(workspace, map);
    setDocs(Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt));
    setSelected(next);
    setDraft(next.body);
    setStatus("Cloned.");
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr]">
      <SettingsGroup title="Library" description="Browse and manage prompts.">
        {!workspace ? (
          <p className="text-[12px] text-text-3">Open a workspace in Agent mode to manage prompts.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompts..." />
            <div className="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
              {filtered.map((doc) => (
                <button
                  key={doc.name}
                  type="button"
                  onClick={() => { setSelected(doc); setDraft(doc.body); }}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected?.name === doc.name ? "border-accent/30 bg-accent/10" : "border-hairline bg-black/15 hover:bg-white/5"
                  }`}
                >
                  <div className="truncate text-[12px] font-medium text-text-1">/{doc.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[10.5px] text-text-3">{doc.description || "No description"}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-text-4">
                    <Tag size={10} /> v{doc.version} · {doc.stats.words}w
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title={selected ? `/${selected.name}` : "Prompt editor"}
        description="Edit, clone, or save to disk."
        action={
          selected && (
            <div className="flex gap-1.5">
              <button onClick={() => navigator.clipboard?.writeText(draft)} className="control-pill px-2 py-1 rounded text-[11px]"><Copy size={12} /></button>
              <button onClick={cloneDoc} className="control-pill px-2 py-1 rounded text-[11px]"><Plus size={12} /> Clone</button>
              <button onClick={saveDoc} className="primary-action px-3 py-1 rounded text-[11px] font-medium"><Check size={12} /> Save</button>
            </div>
          )
        }
      >
        {selected ? (
          <div className="flex flex-col gap-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[300px] w-full rounded-lg border border-hairline-strong bg-black/20 p-3 font-mono text-[12px] text-text-1 outline-none focus:border-accent/45 resize-none"
            />
            <div className="flex items-center gap-4 text-[11px] text-text-3">
              <span>v{selected.version}</span>
              <span>{selected.stats.words} words</span>
              <span>{selected.stats.variables.length} vars: {selected.stats.variables.join(", ") || "none"}</span>
            </div>
            {status && <p className="text-[11px] text-accent">{status}</p>}
          </div>
        ) : (
          <p className="text-[12px] text-text-3">{workspace ? "Select a prompt from the library." : "Open an agent workspace to see prompts."}</p>
        )}
      </SettingsGroup>
    </div>
  );
}

function SyncSettings() {
  const syncSettings = useChatStore((s) => s.syncSettings);
  const setSyncSettings = useChatStore((s) => s.setSyncSettings);
  const [status, setStatus] = useState("");

  const handleExport = async () => {
    setStatus("Exporting...");
    try {
      const passphrase = prompt("Enter encryption passphrase:");
      if (!passphrase) { setStatus("Export cancelled."); return; }
      const state = useChatStore.getState();
      const payload = JSON.stringify({
        version: 1,
        exportedAt: Date.now(),
        conversations: state.conversations,
        messages: state.messages,
      });
      const result = await invoke<string>("sync_export_state", { config: syncSettings, payload }).catch((e) => {
        throw new Error(e instanceof Error ? e.message : String(e));
      });
      setStatus(result || "Exported.");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleImport = async () => {
    setStatus("Importing...");
    try {
      const raw = await invoke<string>("sync_import_state", { config: syncSettings });
      const imported = JSON.parse(raw);
      if (imported.conversations?.length) {
        useChatStore.setState({
          conversations: [...useChatStore.getState().conversations, ...imported.conversations],
          messages: { ...useChatStore.getState().messages, ...(imported.messages ?? {}) },
        });
      }
      setStatus(`Imported ${imported.conversations?.length ?? 0} conversations.`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      <SettingsGroup title="Encrypted cloud sync" description="Opt-in sync package target for iCloud Drive or S3-compatible storage.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ToggleRow enabled={syncSettings.enabled} onToggle={(enabled) => setSyncSettings({ ...syncSettings, enabled })} title="Enable sync" description="Allow export/import actions." />
          <Field label="Provider">
            <Select value={syncSettings.provider} onChange={(e) => setSyncSettings({ ...syncSettings, provider: e.target.value as "icloud" | "s3" })}>
              <option value="icloud">iCloud Drive</option>
              <option value="s3">S3-compatible</option>
            </Select>
          </Field>
          <Field label="Prefix">
            <TextInput value={syncSettings.prefix ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, prefix: e.target.value })} />
          </Field>
          <Field label="Encryption key hint">
            <TextInput value={syncSettings.encryptionKeyHint ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, encryptionKeyHint: e.target.value })} />
          </Field>
          <Field label="S3 bucket">
            <TextInput value={syncSettings.bucket ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, bucket: e.target.value })} />
          </Field>
          <Field label="S3 endpoint">
            <TextInput value={syncSettings.endpoint ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, endpoint: e.target.value })} placeholder="https://... or file:///..." />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={handleExport} className="control-pill px-4 py-2 rounded-lg text-[12px] font-medium"><UploadCloud size={13} className="inline mr-1.5" />Export</button>
          <button onClick={handleImport} className="control-pill px-4 py-2 rounded-lg text-[12px] font-medium"><DownloadCloud size={13} className="inline mr-1.5" />Import</button>
        </div>
        {status && <p className="mt-3 text-[12px] text-text-3">{status}</p>}
      </SettingsGroup>
    </>
  );
}

function MemorySettings() {
  const ragSettings = useChatStore((s) => s.ragSettings);
  const setRagSettings = useChatStore((s) => s.setRagSettings);
  const memoryEnabled = useChatStore((s) => s.memoryEnabled);
  const setMemoryEnabled = useChatStore((s) => s.setMemoryEnabled);
  const memoryExtractionSettings = useChatStore((s) => s.memoryExtractionSettings);
  const setMemoryExtractionSettings = useChatStore((s) => s.setMemoryExtractionSettings);
  const documentWorkspaces = useChatStore((s) => s.documentWorkspaces);
  const activeDocumentWorkspaceId = useChatStore((s) => s.activeDocumentWorkspaceId);
  const createDocumentWorkspace = useChatStore((s) => s.createDocumentWorkspace);
  const deleteDocumentWorkspace = useChatStore((s) => s.deleteDocumentWorkspace);
  const setActiveDocumentWorkspace = useChatStore((s) => s.setActiveDocumentWorkspace);
  const renameDocumentWorkspace = useChatStore((s) => s.renameDocumentWorkspace);
  const upsertKnowledgeDocument = useChatStore((s) => s.upsertKnowledgeDocument);
  const updateKnowledgeDocument = useChatStore((s) => s.updateKnowledgeDocument);
  const ollamaUrl = useChatStore((s) => s.ollamaUrl);
  const embeddingModel = useChatStore((s) => s.embeddingModel);
  const workspacePath = useChatStore((s) => s.workspacePath);
  const [memText, setMemText] = useState("");
  const [memCategory, setMemCategory] = useState("fact");
  const [memScope, setMemScope] = useState<"global" | "project">("global");
  const [memQuery, setMemQuery] = useState("");
  const [memList, setMemList] = useState<Memory[]>([]);
  const [memStatus, setMemStatus] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editMemoryText, setEditMemoryText] = useState("");
  const [editMemoryCategory, setEditMemoryCategory] = useState("fact");
  const [editMemoryScope, setEditMemoryScope] = useState<"global" | "project">("global");
  const [workspaceName, setWorkspaceName] = useState("");
  const [documentStatus, setDocumentStatus] = useState("");
  const [retrievalQuery, setRetrievalQuery] = useState("");
  const [retrievalPreview, setRetrievalPreview] = useState<RetrievalPreviewHit[]>([]);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);

  const activeDocumentWorkspace = useMemo(
    () => documentWorkspaces.find((workspace) => workspace.id === activeDocumentWorkspaceId) ?? documentWorkspaces[0] ?? null,
    [activeDocumentWorkspaceId, documentWorkspaces],
  );

  const refreshMemories = useCallback(async () => {
    try {
      const { listMemories } = await import("../../lib/memory");
      setMemList(await listMemories().catch(() => []));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshMemories(); }, [refreshMemories]);

  const addMem = async () => {
    if (!memText.trim()) return;
    try {
      const { addMemory } = await import("../../lib/memory");
      await addMemory(memText, memCategory, {
        scope: memScope,
        workspacePath: memScope === "project" ? workspacePath : null,
      });
      setMemText("");
      setMemStatus("Memory saved.");
      refreshMemories();
    } catch (e) {
      setMemStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const searchMem = async () => {
    if (!memQuery.trim()) return;
    try {
      const { searchMemories } = await import("../../lib/memory");
      const hits = await searchMemories(memQuery, ragSettings.maxRetrievedMemories).catch(() => []);
      setMemList(hits.length > 0 ? hits : []);
      setMemStatus(hits.length > 0 ? `${hits.length} hit${hits.length === 1 ? "" : "s"}` : "No results.");
    } catch (e) {
      setMemStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const deleteMem = async (id: string) => {
    try {
      const { deleteMemory } = await import("../../lib/memory");
      await deleteMemory(id);
      refreshMemories();
    } catch { /* ignore */ }
  };

  const startEditMemory = (memory: Memory) => {
    setEditingMemoryId(memory.id);
    setEditMemoryText(memory.text);
    setEditMemoryCategory(memory.category);
    setEditMemoryScope(memory.scope === "project" ? "project" : "global");
  };

  const saveEditMemory = async () => {
    if (!editingMemoryId || !editMemoryText.trim()) return;
    try {
      const { updateMemory } = await import("../../lib/memory");
      await updateMemory(editingMemoryId, {
        text: editMemoryText,
        category: editMemoryCategory,
        scope: editMemoryScope,
        workspacePath: editMemoryScope === "project" ? workspacePath : null,
      });
      setEditingMemoryId(null);
      setMemStatus("Memory updated.");
      refreshMemories();
    } catch (e) {
      setMemStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const ensureDocumentWorkspace = () => {
    if (activeDocumentWorkspace) return activeDocumentWorkspace.id;
    return createDocumentWorkspace("Knowledge workspace");
  };

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Could not read file."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });

  const importKnowledgeFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const workspaceId = ensureDocumentWorkspace();
    setDocumentStatus(`Importing ${files.length} file${files.length === 1 ? "" : "s"}...`);
    try {
      const { extractAttachment } = await import("../../lib/attachment-extract");
      let imported = 0;
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        const extracted = await extractAttachment({
          filename: file.name,
          mimeType: file.type,
          dataUrl,
          sizeBytes: file.size,
        });
        const text = extracted.rawBody || extracted.inlinedText.replace(/^\[[^\]]+\]\s*/m, "").trim();
        if (!text.trim()) continue;
        const document = createKnowledgeDocument({
          workspaceId,
          title: file.name.replace(/\.[^.]+$/, "") || file.name,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          text,
          source: { kind: "upload", label: file.name },
        });
        upsertKnowledgeDocument(workspaceId, document);
        imported++;
      }
      setDocumentStatus(imported > 0 ? `Imported ${imported} document${imported === 1 ? "" : "s"}.` : "No extractable text found.");
    } catch (e) {
      setDocumentStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const addWorkspace = () => {
    const id = createDocumentWorkspace(workspaceName.trim() || "Knowledge workspace");
    setActiveDocumentWorkspace(id);
    setWorkspaceName("");
  };

  const saveWorkspaceName = () => {
    if (!activeDocumentWorkspace || !workspaceName.trim()) return;
    renameDocumentWorkspace(activeDocumentWorkspace.id, workspaceName);
    setWorkspaceName("");
  };

  const embedDocument = async (document: KnowledgeDocument) => {
    if (!activeDocumentWorkspace) return;
    setBusyDocumentId(document.id);
    updateKnowledgeDocument(activeDocumentWorkspace.id, document.id, { status: "embedding", lastError: undefined });
    try {
      const embedded = await embedKnowledgeDocument({
        workspaceId: activeDocumentWorkspace.id,
        document,
        ollamaUrl,
        model: embeddingModel,
        onProgress: (done, total) => setDocumentStatus(`Embedding ${document.title}: ${done}/${total}`),
      });
      upsertKnowledgeDocument(activeDocumentWorkspace.id, embedded);
      setDocumentStatus(`Embedded ${document.title}.`);
    } catch (e) {
      updateKnowledgeDocument(activeDocumentWorkspace.id, document.id, {
        status: "error",
        embedded: false,
        lastError: e instanceof Error ? e.message : String(e),
      });
      setDocumentStatus(`Embed failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyDocumentId(null);
    }
  };

  const unembedDocument = async (document: KnowledgeDocument) => {
    if (!activeDocumentWorkspace) return;
    setBusyDocumentId(document.id);
    try {
      await deleteDocumentChunks(document.id);
      upsertKnowledgeDocument(
        activeDocumentWorkspace.id,
        setDocumentEmbedded(document, {
          embedded: false,
          status: "ready",
          chunkCount: 0,
        }),
      );
      setDocumentStatus(`Unembedded ${document.title}.`);
    } catch (e) {
      setDocumentStatus(`Unembed failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyDocumentId(null);
    }
  };

  const togglePinned = (document: KnowledgeDocument) => {
    if (!activeDocumentWorkspace) return;
    upsertKnowledgeDocument(activeDocumentWorkspace.id, setDocumentPinned(document, !document.pinned));
  };

  const runRetrievalPreview = async () => {
    if (!activeDocumentWorkspace || !retrievalQuery.trim()) return;
    setDocumentStatus("Searching embedded documents...");
    try {
      const hits = await searchKnowledgeDocuments({
        workspaceId: activeDocumentWorkspace.id,
        query: retrievalQuery,
        limit: ragSettings.maxRetrievedMemories,
        ollamaUrl,
        model: embeddingModel,
        includeProvenance: ragSettings.provenance,
      });
      setRetrievalPreview(hits);
      setDocumentStatus(hits.length > 0 ? `${hits.length} retrieval hit${hits.length === 1 ? "" : "s"}.` : "No retrieval hits.");
    } catch (e) {
      setDocumentStatus(`Retrieval failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      <SettingsGroup title="Memory and retrieval" description="Control what can be remembered, retrieved, and shown.">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ToggleRow enabled={memoryEnabled} onToggle={setMemoryEnabled} title="Long-term memory" description="Allow memories to be saved and searched during chat." />
          <ToggleRow enabled={ragSettings.projectMemory} onToggle={(v) => setRagSettings({ ...ragSettings, projectMemory: v })} title="Project memory" description="Use project-scoped memory sources." />
          <ToggleRow enabled={ragSettings.conversationMemory} onToggle={(v) => setRagSettings({ ...ragSettings, conversationMemory: v })} title="Conversation memory" description="Use conversation-specific facts." />
          <ToggleRow enabled={ragSettings.retrievalPreview} onToggle={(v) => setRagSettings({ ...ragSettings, retrievalPreview: v })} title="Retrieval preview" description="Show retrieved snippets." />
          <ToggleRow enabled={ragSettings.provenance} onToggle={(v) => setRagSettings({ ...ragSettings, provenance: v })} title="Provenance" description="Track where context came from." />
          <ToggleRow enabled={memoryExtractionSettings.enabled} onToggle={(v) => setMemoryExtractionSettings({ ...memoryExtractionSettings, enabled: v })} title="Automatic extraction" description="Conservatively save explicit durable facts after a turn." />
          <ToggleRow enabled={memoryExtractionSettings.globalScope} onToggle={(v) => setMemoryExtractionSettings({ ...memoryExtractionSettings, globalScope: v })} title="Global extraction" description="Allow user-level preferences and stable facts." />
          <ToggleRow enabled={memoryExtractionSettings.projectScope} onToggle={(v) => setMemoryExtractionSettings({ ...memoryExtractionSettings, projectScope: v })} title="Project extraction" description="Allow repo/workspace-specific facts." />
          <Field label="Max retrieved">
            <TextInput type="number" min={1} max={24} value={ragSettings.maxRetrievedMemories} onChange={(e) => setRagSettings({ ...ragSettings, maxRetrievedMemories: Number(e.target.value) || 8 })} />
          </Field>
          <Field label="Max extracted">
            <TextInput type="number" min={1} max={8} value={memoryExtractionSettings.maxCandidatesPerTurn} onChange={(e) => setMemoryExtractionSettings({ ...memoryExtractionSettings, maxCandidatesPerTurn: Number(e.target.value) || 3 })} />
          </Field>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Document knowledge workspaces" description="Reusable document corpora for retrieval, provenance, pinning, and source-aware context.">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <TextInput value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder={activeDocumentWorkspace ? "Rename workspace" : "Workspace name"} className="min-w-0 flex-1" />
              <button onClick={activeDocumentWorkspace ? saveWorkspaceName : addWorkspace} className="control-pill shrink-0 rounded-lg px-3 py-2 text-[11px]">
                {activeDocumentWorkspace ? "Rename" : "Create"}
              </button>
            </div>
            <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
              {documentWorkspaces.map((workspace) => {
                const active = activeDocumentWorkspace?.id === workspace.id;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => setActiveDocumentWorkspace(workspace.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      active ? "border-accent/30 bg-accent/10" : "border-hairline bg-black/20 hover:border-hairline-strong hover:bg-white/5"
                    }`}
                  >
                    <span className="block truncate text-[12.5px] font-medium text-text-1">{workspace.name}</span>
                    <span className="mt-0.5 block text-[10.5px] text-text-3">{workspace.documents.length} document{workspace.documents.length === 1 ? "" : "s"}</span>
                  </button>
                );
              })}
              {documentWorkspaces.length === 0 && (
                <div className="rounded-lg border border-hairline bg-black/20 px-3 py-2 text-[12px] text-text-3">
                  No knowledge workspace yet.
                </div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="control-pill inline-flex cursor-pointer items-center rounded-lg px-3 py-2 text-[11px] font-medium">
                <UploadCloud size={13} className="mr-1.5" />
                Import files
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void importKnowledgeFiles(e.currentTarget.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              {activeDocumentWorkspace && (
                <button onClick={() => deleteDocumentWorkspace(activeDocumentWorkspace.id)} className="control-pill rounded-lg px-3 py-2 text-[11px] text-error">
                  <Trash2 size={13} className="mr-1.5 inline" />
                  Delete corpus
                </button>
              )}
              {documentStatus && <span className="text-[11px] text-text-3">{documentStatus}</span>}
            </div>

            {activeDocumentWorkspace && activeDocumentWorkspace.documents.length > 0 && (
              <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto">
                {activeDocumentWorkspace.documents.map((document) => (
                  <div key={document.id} className="rounded-lg border border-hairline bg-black/20 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[12.5px] font-medium text-text-1">{document.title}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${document.status === "error" ? "text-error" : document.embedded ? "text-success" : "text-text-3"}`}>
                            {document.status}
                          </span>
                          {document.pinned && <Pin size={12} className="text-accent" aria-label="Pinned" />}
                        </div>
                        <div className="mt-0.5 truncate text-[10.5px] text-text-3">
                          {document.filename} · {document.characters.toLocaleString()} chars · {document.chunkCount ?? 0} chunks
                        </div>
                        {document.lastError && <div className="mt-1 text-[10.5px] text-error">{document.lastError}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => togglePinned(document)} className="control-icon rounded p-1 text-text-3 hover:text-accent" aria-label={document.pinned ? "Unpin document" : "Pin document"}>
                          <Pin size={13} />
                        </button>
                        <button
                          onClick={() => document.embedded ? void unembedDocument(document) : void embedDocument(document)}
                          disabled={busyDocumentId === document.id}
                          className="control-pill rounded-md px-2 py-1 text-[10.5px] disabled:opacity-50"
                        >
                          {document.embedded ? "Unembed" : "Embed"}
                        </button>
                        <button onClick={() => void embedDocument(document)} disabled={busyDocumentId === document.id} className="control-icon rounded p-1 text-text-3 hover:text-text-1 disabled:opacity-50" aria-label="Resync document">
                          <RefreshCw size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-hairline bg-black/20 p-3">
              <div className="flex gap-2">
                <TextInput value={retrievalQuery} onChange={(e) => setRetrievalQuery(e.target.value)} placeholder="Preview retrieval query" className="min-w-0 flex-1" onKeyDown={(e) => e.key === "Enter" && void runRetrievalPreview()} />
                <button onClick={() => void runRetrievalPreview()} disabled={!activeDocumentWorkspace || !retrievalQuery.trim()} className="control-pill shrink-0 rounded-lg px-3 py-2 text-[11px] disabled:opacity-50">
                  <Search size={13} />
                </button>
              </div>
              {retrievalPreview.length > 0 && (
                <div className="mt-3 flex max-h-[180px] flex-col gap-1 overflow-y-auto">
                  {retrievalPreview.map((hit) => (
                    <div key={hit.id} className="rounded border border-hairline bg-sunken px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11.5px] font-medium text-text-2">{hit.title}</span>
                        <span className="font-mono text-[10px] text-text-3">{hit.score.toFixed(3)}</span>
                      </div>
                      {hit.provenance && <div className="mt-0.5 text-[10.5px] text-text-3">{hit.provenance}</div>}
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-3">{hit.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Add memory" description="Save a fact, preference, or task for future retrieval.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_120px_1fr]">
          <Select value={memCategory} onChange={(e) => setMemCategory(e.target.value)}>
            <option value="fact">Fact</option>
            <option value="preference">Preference</option>
            <option value="project">Project</option>
            <option value="task">Task</option>
          </Select>
          <Select value={memScope} onChange={(e) => setMemScope(e.target.value as "global" | "project")}>
            <option value="global">Global</option>
            <option value="project">Project</option>
          </Select>
          <div className="flex gap-2">
            <TextInput value={memText} onChange={(e) => setMemText(e.target.value)} placeholder="What should goatLLM remember?" className="flex-1" />
            <button onClick={addMem} disabled={!memText.trim()} className="primary-action px-3 py-2 rounded-lg text-[11px] font-medium disabled:opacity-50 shrink-0"><Plus size={13} className="inline mr-1" />Add</button>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Search memories" description="Find and manage saved memories.">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <TextInput value={memQuery} onChange={(e) => setMemQuery(e.target.value)} placeholder="Search memories..." className="flex-1" onKeyDown={(e) => e.key === "Enter" && searchMem()} />
            <button onClick={searchMem} className="control-pill px-3 py-2 rounded-lg text-[11px] shrink-0"><Search size={13} /></button>
            <button onClick={refreshMemories} className="control-pill px-3 py-2 rounded-lg text-[11px] shrink-0"><RefreshCw size={13} /></button>
          </div>
          {memStatus && <p className="text-[11px] text-text-3">{memStatus}</p>}
          <div className="flex flex-col gap-1 max-h-[250px] overflow-y-auto">
            {memList.map((mem) => (
              <div key={mem.id} className="rounded-lg border border-hairline bg-surface-3 px-3 py-2">
                {editingMemoryId === mem.id ? (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_120px_1fr]">
                      <Select value={editMemoryCategory} onChange={(e) => setEditMemoryCategory(e.target.value)}>
                        <option value="fact">Fact</option>
                        <option value="preference">Preference</option>
                        <option value="project">Project</option>
                        <option value="task">Task</option>
                      </Select>
                      <Select value={editMemoryScope} onChange={(e) => setEditMemoryScope(e.target.value as "global" | "project")}>
                        <option value="global">Global</option>
                        <option value="project">Project</option>
                      </Select>
                      <TextInput value={editMemoryText} onChange={(e) => setEditMemoryText(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveEditMemory} className="primary-action rounded-md px-3 py-1 text-[11px] font-medium">Save</button>
                      <button onClick={() => setEditingMemoryId(null)} className="control-pill rounded-md px-3 py-1 text-[11px]">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] uppercase text-accent">{mem.category}</span>
                        <span className="text-[10px] uppercase text-text-3">{mem.scope ?? "global"}</span>
                        {mem.auto_extracted && <span className="text-[10px] uppercase text-text-3">auto</span>}
                      </div>
                      <p className="mt-0.5 text-[12px] text-text-2">{mem.text}</p>
                      <p className="mt-1 text-[10.5px] text-text-3">{buildMemoryProvenance(mem)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => startEditMemory(mem)} className="control-icon rounded p-1 text-text-3 hover:text-text-1" aria-label="Edit memory"><Edit3 size={12} /></button>
                      <button onClick={() => deleteMem(mem.id)} className="control-icon rounded p-1 text-text-3 hover:text-error" aria-label="Delete memory"><Trash2 size={12} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </SettingsGroup>
    </>
  );
}

function ScheduleSettings() {
  const agents = useChatStore((s) => s.scheduledAgents);
  const setAgents = useChatStore((s) => s.setScheduledAgents);
  const runs = useChatStore((s) => s.scheduledAgentRuns);
  const runScheduledAgent = useChatStore((s) => s.runScheduledAgent);
  const continueScheduledRun = useChatStore((s) => s.continueScheduledRun);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("@daily");
  const [prompt, setPrompt] = useState("");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );

  const addAgent = () => {
    if (!prompt.trim()) return;
    let nextRunAt: number;
    try {
      nextRunAt = computeNextScheduledRun(schedule.trim() || "@daily").getTime();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      return;
    }
    const agent: ScheduledAgent = {
      id: crypto.randomUUID(),
      name: name.trim() || "Scheduled agent",
      prompt: prompt.trim(),
      schedule: schedule.trim() || "@daily",
      enabled: true,
      nextRunAt,
      lastStatus: "idle",
    };
    setAgents([agent, ...agents]);
    setName("");
    setPrompt("");
    setSchedule("@daily");
    setStatus("Schedule added.");
  };

  const updateAgent = (agent: ScheduledAgent, updates: Partial<ScheduledAgent>) => {
    setAgents(agents.map((item) => (item.id === agent.id ? { ...item, ...updates } : item)));
  };

  const runsForAgent = (agentId: string): ScheduledAgentRun[] =>
    runs.filter((run) => run.agentId === agentId).slice(0, 5);

  return (
    <SettingsGroup title="Scheduled agents" description="Cron-style recurring runs for digests, repo checks, and periodic work.">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Daily digest)" />
          <TextInput value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="@daily or 0 9 * * *" />
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the agent do on schedule?"
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-hairline-strong bg-surface-1 text-[12.5px] text-text-1 placeholder:text-text-3 outline-none focus:border-accent/45 resize-none"
        />
        <button onClick={addAgent} disabled={!prompt.trim()} className="primary-action self-start px-4 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-50">
          Add Schedule
        </button>
      </div>
      {notificationPermission === "default" && (
        <button
          onClick={async () => setNotificationPermission(await Notification.requestPermission())}
          className="control-pill mt-2 rounded-md px-2.5 py-1 text-[11px]"
        >
          Enable Notifications
        </button>
      )}
      {status && <p className="mt-2 text-[11px] text-text-3">{status}</p>}
      {agents.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="text-[11.5px] font-medium text-text-2">{agents.length} configured agent{agents.length === 1 ? "" : "s"}</div>
          {agents.map((agent) => (
            <div key={agent.id} className="rounded-lg border border-hairline bg-surface-3 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12.5px] font-medium text-text-1">{agent.name}</span>
                    <span className={`text-[10.5px] ${agent.enabled ? "text-accent" : "text-text-3"}`}>{agent.enabled ? "enabled" : "paused"}</span>
                    {agent.lastStatus && <span className="text-[10.5px] text-text-3">{agent.lastStatus}</span>}
                  </div>
                  <div className="mt-1 text-[11px] text-text-3">
                    {agent.schedule} · next {new Date(agent.nextRunAt).toLocaleString()}
                  </div>
                  {agent.lastResult && <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-3">{agent.lastResult}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => updateAgent(agent, { enabled: !agent.enabled })} className="control-pill rounded-md px-2 py-1 text-[10.5px]">
                    {agent.enabled ? "Pause" : "Enable"}
                  </button>
                  <button onClick={() => void runScheduledAgent(agent.id)} className="control-pill rounded-md px-2 py-1 text-[10.5px]">
                    Run now
                  </button>
                  <button onClick={() => setAgents(agents.filter((a) => a.id !== agent.id))} className="control-icon rounded p-1 text-text-3 hover:text-error" aria-label="Delete scheduled agent">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {runsForAgent(agent.id).length > 0 && (
                <div className="mt-2 flex flex-col gap-1 border-t border-hairline pt-2">
                  {runsForAgent(agent.id).map((run) => {
                    const expanded = expandedRunId === run.id;
                    return (
                      <div key={run.id} className="rounded border border-hairline bg-sunken px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <button onClick={() => setExpandedRunId(expanded ? null : run.id)} className="min-w-0 truncate text-left text-[11.5px] font-medium text-text-2">
                            {new Date(run.createdAt).toLocaleString()} · {run.status}
                          </button>
                          <button onClick={() => continueScheduledRun(run.id)} className="control-pill shrink-0 rounded-md px-2 py-1 text-[10px]">
                            Continue
                          </button>
                        </div>
                        {expanded && (
                          <div className="mt-2 flex flex-col gap-1 text-[10.5px] leading-relaxed text-text-3">
                            {(run.trace.length > 0 ? run.trace : ["No trace captured."]).map((entry, index) => (
                              <div key={`${run.id}-trace-${index}`}>- {entry}</div>
                            ))}
                            {(run.result || run.error) && (
                              <div className={run.error ? "text-error" : "text-text-2"}>{run.result || run.error}</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SettingsGroup>
  );
}

function WatcherSettings() {
  const events = useChatStore((s) => s.watcherEvents);
  const clearEvents = useChatStore((s) => s.clearWatcherEvents);
  const workspace = useChatStore((s) => s.workspacePath);
  const [watching, setWatching] = useState(false);
  const [status, setStatus] = useState("");

  const startWatch = async () => {
    if (!workspace) return;
    try {
      await invoke("watch_workspace", { workspace });
      setWatching(true);
      setStatus(`Watching ${workspace}`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stopWatch = async () => {
    if (!workspace) return;
    try {
      await invoke("unwatch_workspace", { workspace }).catch(() => undefined);
      setWatching(false);
      setStatus("Stopped watcher.");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <SettingsGroup title="Filesystem watcher" description="Native notify events for config changes, test signals, and generated artifacts.">
      <div className="flex flex-col gap-3">
        {!workspace && <p className="text-[12px] text-text-3">Open a workspace in Agent mode to start the watcher.</p>}
        <div className="flex items-center gap-2">
          <button onClick={startWatch} disabled={!workspace || watching} className="control-pill px-3 py-1.5 rounded-lg text-[11px] font-medium disabled:opacity-40"><Play size={13} className="inline mr-1" />Start</button>
          <button onClick={stopWatch} disabled={!watching} className="control-pill px-3 py-1.5 rounded-lg text-[11px] font-medium disabled:opacity-40">Stop</button>
          <button onClick={clearEvents} className="control-pill px-3 py-1.5 rounded-lg text-[11px]">Clear events</button>
        </div>
        {status && <p className="text-[11px] text-accent">{status}</p>}
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-2">{events.length} event{events.length === 1 ? "" : "s"}</span>
        </div>
        {events.length > 0 && (
          <div className="flex flex-col gap-1 max-h-[250px] overflow-y-auto">
            {events.map((event, i) => (
              <div key={`${event.path}-${event.at}-${i}`} className="rounded border border-hairline bg-black/20 px-3 py-1.5">
                <div className="text-[11.5px] text-text-2 truncate">{event.path}</div>
                <div className="text-[10.5px] text-text-3">{event.kind} · {new Date(event.at).toLocaleTimeString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}

function AdvancedDeveloperSettings() {
  return (
    <>
      <ToolsTab />
      <AdvancedTab />
      <SettingsGroup title="Developer note" description="Workspace features like usage, sync, memory, prompts, schedules, and more are now accessible directly from the sidebar.">
        <div className="soft-card flex items-center gap-3 rounded-xl p-4 text-[12.5px] text-text-2">
          <Sparkles size={15} className="text-accent" />
          Features are integrated directly into the app: usage tracking in context meter, model comparison in model picker, branch navigation on messages, browser in artifact panel, notebook as a mode, and image generation in the input bar.
        </div>
      </SettingsGroup>
    </>
  );
}
