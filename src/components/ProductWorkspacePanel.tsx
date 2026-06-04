import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { generateText } from "ai";
import { invoke } from "@tauri-apps/api/core";
import {
  BarChart3,
  BookOpen,
  Boxes,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  Cloud,
  Code,
  Copy,
  Diff,
  DownloadCloud,
  Eye,
  FileClock,
  GitBranch,
  Globe2,
  Image as ImageIcon,
  Loader2,
  MemoryStick,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Columns2,
  Tags,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import {
  buildBranchGraph,
  buildConversationUsage,
  computeNextRun,
  createNotebookCell,
  createPromptVersion,
  estimateMessageCost,
  filterPromptDocuments,
  summarizeWatcherEvent,
  type NotebookCell,
  type NotebookCellKind,
  type PromptDocument,
} from "../lib/product-workspace";
import { createModel } from "../lib/model-factory";
import { computeDiff } from "../lib/diff-utils";
import { addMemory, deleteMemory, listMemories, searchMemories, type Memory, type MemorySearchHit } from "../lib/memory";
import { loadPromptTemplates } from "../lib/prompt-templates";
import { persistConversation, persistMessage } from "../lib/db";
import { useChatStore, type ImageGenerationJob, type Message, type ProductWorkspaceTab, type ScheduledAgent } from "../stores/chat";

const TABS: { id: ProductWorkspaceTab; label: string; icon: typeof BarChart3 }[] = [
  { id: "usage", label: "Usage", icon: BarChart3 },
  { id: "compare", label: "Compare", icon: Columns2 },
  { id: "branches", label: "Branches", icon: GitBranch },
  { id: "browser", label: "Browser", icon: Globe2 },
  { id: "notebook", label: "Notebook", icon: BookOpen },
  { id: "images", label: "Images", icon: ImageIcon },
  { id: "prompts", label: "Prompts", icon: FileClock },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "sync", label: "Sync", icon: Cloud },
  { id: "watcher", label: "Watcher", icon: Eye },
];

const TAB_BY_ID = Object.fromEntries(TABS.map((tab) => [tab.id, tab])) as Record<ProductWorkspaceTab, (typeof TABS)[number]>;
const EMPTY_MESSAGES: Message[] = [];

function formatUsd(value: number): string {
  if (value <= 0) return "$0.0000";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function formatMs(value?: number): string {
  if (!value) return "0 ms";
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)} min`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}

function Section({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: typeof BarChart3;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="soft-card rounded-xl border-white/[0.07] bg-white/[0.025]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={15} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden="true" />
          <h3 className="truncate text-[12px] font-semibold uppercase tracking-[0.08em] text-text-2">
            {title}
          </h3>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-text-3">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tracking-normal text-text-1">{value}</div>
      {detail && <div className="mt-1 text-[11.5px] text-text-3">{detail}</div>}
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[12px] font-medium text-text-2 transition-colors hover:border-white/[0.14] hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 rounded-lg border border-white/[0.08] bg-black/20 px-3 text-[12.5px] text-text-1 placeholder:text-text-3 outline-none transition-colors focus:border-accent/45 ${props.className ?? ""}`}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-[92px] rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[12.5px] leading-relaxed text-text-1 placeholder:text-text-3 outline-none transition-colors focus:border-accent/45 ${props.className ?? ""}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-9 rounded-lg border border-white/[0.08] bg-[#171719] px-3 text-[12.5px] text-text-1 outline-none transition-colors focus:border-accent/45 ${props.className ?? ""}`}
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-text-1">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] leading-relaxed text-text-3">{description}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#f59e42]"
      />
    </label>
  );
}

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
  } catch {
    // ignore quota
  }
}

function useActiveConversationMessages() {
  return useChatStore((s) => {
    if (!s.activeId) return EMPTY_MESSAGES;
    return s.messages[s.activeId] ?? EMPTY_MESSAGES;
  });
}

export function ProductWorkspacePanel() {
  const activeId = useChatStore((s) => s.activeId);
  const closeWorkspacePanel = useChatStore((s) => s.closeWorkspacePanel);
  const workspacePanelTab = useChatStore((s) => s.workspacePanelTab);
  const setWorkspacePanelTab = useChatStore((s) => s.setWorkspacePanelTab);
  const activeTabMeta = TAB_BY_ID[workspacePanelTab];
  const ActiveIcon = activeTabMeta.icon;

  return (
    <div className="modal-surface flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
            <ActiveIcon size={16} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-text-1">Workspace</h2>
            <p className="truncate text-[11.5px] text-text-3">{activeTabMeta.label}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={closeWorkspacePanel}
          className="control-icon flex h-8 w-8 items-center justify-center rounded-lg"
          aria-label="Close workspace panel"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="w-[148px] shrink-0 overflow-y-auto border-r border-white/[0.06] bg-black/15 p-2 [scrollbar-width:none]" aria-label="Workspace sections">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = workspacePanelTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setWorkspacePanelTab(tab.id)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] font-medium transition-colors ${
                  active
                    ? "border-accent/25 bg-accent/10 text-text-1"
                    : "border-transparent text-text-3 hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-text-2"
                }`}
              >
                <Icon size={14} strokeWidth={1.75} className={active ? "text-accent" : ""} aria-hidden="true" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!activeId && workspacePanelTab !== "prompts" && workspacePanelTab !== "sync" && (
            <div className="mb-4 rounded-xl border border-accent/20 bg-accent/[0.055] px-4 py-3 text-[12.5px] leading-relaxed text-text-2">
              Start or select a conversation to see conversation-specific data.
            </div>
          )}
          {workspacePanelTab === "usage" && <UsageSection />}
          {workspacePanelTab === "compare" && <CompareSection />}
          {workspacePanelTab === "branches" && <BranchSection />}
          {workspacePanelTab === "browser" && <BrowserSection />}
          {workspacePanelTab === "notebook" && <NotebookSection />}
          {workspacePanelTab === "images" && <ImagesSection />}
          {workspacePanelTab === "prompts" && <PromptsSection />}
          {workspacePanelTab === "schedules" && <SchedulesSection />}
          {workspacePanelTab === "memory" && <MemorySection />}
          {workspacePanelTab === "sync" && <SyncSection />}
          {workspacePanelTab === "watcher" && <WatcherSection />}
        </div>
      </div>
    </div>
  );
}

function UsageSection() {
  const messages = useActiveConversationMessages();
  const usageSettings = useChatStore((s) => s.usageSettings);
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const conversationModel = activeId ? conversations.find((c) => c.id === activeId)?.modelId : null;
  const usage = useMemo(
    () =>
      buildConversationUsage(messages, {
        monthlyBudgetUsd: usageSettings.monthlyBudgetUsd,
        expensiveSessionUsd: usageSettings.expensiveSessionUsd,
        priceOverrides: usageSettings.priceOverrides,
        modelIdForMessage: (message) => message.modelId ?? conversationModel ?? undefined,
      }),
    [messages, usageSettings, conversationModel],
  );
  const maxChartCost = Math.max(0.000001, ...usage.chart.map((point) => point.costUsd));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Cost" value={formatUsd(usage.totalCostUsd)} detail={`${Math.round(usage.budgetStatus.ratio * 100)}% of budget`} />
        <MetricCard label="Input" value={formatTokens(usage.totalInputTokens)} detail="tokens sent" />
        <MetricCard label="Output" value={formatTokens(usage.totalOutputTokens)} detail="tokens received" />
        <MetricCard label="Latency" value={formatMs(usage.totalLatencyMs)} detail="turn wall time" />
      </div>

      {usage.alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {usage.alerts.map((alert) => (
            <div key={alert.kind} className="rounded-lg border border-[#f59e42]/25 bg-[#f59e42]/[0.075] px-3 py-2 text-[12.5px] text-text-2">
              {alert.message}
            </div>
          ))}
        </div>
      )}

      <Section title="Spending chart" icon={BarChart3}>
        {usage.chart.length === 0 ? (
          <p className="text-[12.5px] text-text-3">Token usage appears after model responses complete.</p>
        ) : (
          <div className="flex h-[140px] items-end gap-1.5 border-b border-white/[0.08] px-1 pb-2">
            {usage.chart.slice(-28).map((point, index) => (
              <div key={`${point.label}-${index}`} className="group relative flex flex-1 items-end justify-center">
                <div
                  className="w-full max-w-[16px] rounded-t bg-gradient-to-t from-[#f59e42]/45 to-[#f7c37c]/85 shadow-[0_0_16px_rgba(245,158,66,0.16)]"
                  style={{ height: `${Math.max(8, (point.costUsd / maxChartCost) * 118)}px` }}
                />
                <div className="pointer-events-none absolute bottom-full mb-2 hidden rounded-md border border-white/[0.08] bg-[#18181a] px-2 py-1 text-[11px] text-text-2 shadow-xl group-hover:block">
                  {point.label}: {formatUsd(point.costUsd)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Model breakdown" icon={Boxes}>
        <div className="flex flex-col gap-2">
          {usage.byModel.length === 0 ? (
            <p className="text-[12.5px] text-text-3">No priced assistant turns yet.</p>
          ) : usage.byModel.map((row) => (
            <div key={row.modelId} className="rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="min-w-0 truncate font-medium text-text-1">{row.modelId}</span>
                <span className="text-accent">{formatUsd(row.costUsd)}</span>
              </div>
              <div className="mt-1 text-[11px] text-text-3">
                {row.messages} turns · {formatTokens(row.inputTokens)} in · {formatTokens(row.outputTokens)} out · {formatMs(row.latencyMs)}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function CompareSection() {
  const getModels = useChatStore((s) => s.getModels);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const usageSettings = useChatStore((s) => s.usageSettings);
  const runs = useChatStore((s) => s.modelComparisonRuns);
  const addRun = useChatStore((s) => s.addModelComparisonRun);
  const updateRun = useChatStore((s) => s.updateModelComparisonRun);
  const [prompt, setPrompt] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const models = getModels().filter((model) => model.isAvailable);

  useEffect(() => {
    if (selectedIds.length > 0 || models.length === 0) return;
    const initial = [selectedModelId, ...models.map((m) => m.id)].filter((id): id is string => !!id);
    setSelectedIds(Array.from(new Set(initial)).slice(0, 2));
  }, [selectedIds.length, models, selectedModelId]);

  const patchResult = useCallback((runId: string, modelId: string, patch: Partial<(typeof runs)[number]["results"][number]>) => {
    const current = useChatStore.getState().modelComparisonRuns.find((run) => run.id === runId);
    if (!current) return;
    updateRun(runId, {
      results: current.results.map((result) =>
        result.modelId === modelId ? { ...result, ...patch } : result,
      ),
    });
  }, [updateRun]);

  const runCompare = useCallback(async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || selectedIds.length === 0 || running) return;
    setRunning(true);
    const runId = crypto.randomUUID();
    addRun({
      id: runId,
      prompt: cleanPrompt,
      modelIds: selectedIds,
      createdAt: Date.now(),
      results: selectedIds.map((modelId) => ({ modelId, status: "queued", content: "" })),
    });
    await Promise.all(selectedIds.map(async (modelId) => {
      patchResult(runId, modelId, { status: "running" });
      const started = performance.now();
      try {
        const cfg = useChatStore.getState().getLlmConfigForModel(modelId);
        if (!cfg) throw new Error("Model is not configured.");
        const model = await createModel(cfg);
        const result = await generateText({
          model,
          prompt: cleanPrompt,
          temperature: 0.2,
        });
        const latencyMs = performance.now() - started;
        const usage = (result as unknown as { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }).usage;
        const inputTokens = usage?.inputTokens ?? Math.ceil(cleanPrompt.length / 4);
        const outputTokens = usage?.outputTokens ?? Math.ceil(result.text.length / 4);
        patchResult(runId, modelId, {
          status: "done",
          content: result.text,
          latencyMs,
          inputTokens,
          outputTokens,
          costUsd: estimateMessageCost({ inputTokens, outputTokens } as any, modelId, usageSettings.priceOverrides),
        });
      } catch (error) {
        patchResult(runId, modelId, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));
    setRunning(false);
  }, [addRun, patchResult, prompt, running, selectedIds, usageSettings.priceOverrides]);

  const latest = runs[0];
  const diff = useMemo(() => {
    const done = latest?.results.filter((result) => result.status === "done") ?? [];
    if (done.length < 2) return null;
    return computeDiff(done[0].content, done[1].content);
  }, [latest]);

  return (
    <div className="flex flex-col gap-4">
      <Section title="Parallel prompt" icon={Columns2} action={<SmallButton onClick={runCompare} disabled={running || !prompt.trim()}>{running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run</SmallButton>}>
        <div className="flex flex-col gap-3">
          <TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask the same question across models..." />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {models.slice(0, 12).map((model) => (
              <Toggle
                key={model.id}
                label={model.name}
                description={model.providerId}
                checked={selectedIds.includes(model.id)}
                onChange={(checked) => setSelectedIds((cur) => checked ? Array.from(new Set([...cur, model.id])).slice(0, 4) : cur.filter((id) => id !== model.id))}
              />
            ))}
          </div>
        </div>
      </Section>

      {latest && (
        <Section title="Latest comparison" icon={Sparkles}>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {latest.results.map((result) => (
              <div key={result.modelId} className="flex min-h-[220px] flex-col rounded-xl border border-white/[0.07] bg-black/20">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
                  <span className="truncate text-[12.5px] font-medium text-text-1">{result.modelId}</span>
                  <span className="text-[11px] text-text-3">
                    {result.status === "running" ? "Running" : result.status === "done" ? `${formatMs(result.latencyMs)} · ${formatUsd(result.costUsd ?? 0)}` : result.status}
                  </span>
                </div>
                <pre className="m-0 flex-1 overflow-auto whitespace-pre-wrap p-3 text-[12.5px] leading-relaxed text-text-2">
                  {result.status === "error" ? result.error : result.content || "..."}
                </pre>
              </div>
            ))}
          </div>
          {diff && (
            <div className="mt-4 rounded-xl border border-white/[0.07] bg-black/20">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-[12px] font-medium text-text-2">
                <Diff size={14} strokeWidth={1.75} className="text-accent" /> Diff view
                <span className="ml-auto text-[11px] text-text-3">+{diff.added} / -{diff.removed}</span>
              </div>
              <pre className="m-0 max-h-[260px] overflow-auto p-3 text-[11.5px] leading-relaxed text-text-2">
                {diff.lines.slice(0, 160).map((line) => `${line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}${line.content}`).join("\n")}
              </pre>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function BranchSection() {
  const activeId = useChatStore((s) => s.activeId);
  const messages = useActiveConversationMessages();
  const activeTip = useChatStore((s) => activeId ? s.activeBranchTips[activeId] : undefined);
  const navigateToBranch = useChatStore((s) => s.navigateToBranch);
  const graph = useMemo(() => buildBranchGraph(messages, activeTip), [messages, activeTip]);

  return (
    <Section title="Conversation tree" icon={GitBranch}>
      {graph.nodes.length === 0 ? (
        <p className="text-[12.5px] text-text-3">Branches appear after edits, regenerations, or branch navigation.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <div className="relative min-w-[520px]">
              {graph.nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => activeId && navigateToBranch(activeId, node.id)}
                  className={`mb-2 flex max-w-[360px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12px] transition-colors ${
                    node.isActive ? "border-accent/35 bg-accent/10 text-text-1" : "border-white/[0.07] bg-white/[0.03] text-text-3 hover:text-text-2"
                  }`}
                  style={{ marginLeft: node.depth * 26 }}
                >
                  <span className={`h-2 w-2 rounded-full ${node.isTip ? "bg-accent" : "bg-white/30"}`} />
                  <span className="min-w-0 flex-1 truncate">{node.label}</span>
                  {node.childCount > 0 && <span className="text-[10.5px] text-text-3">{node.childCount}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {graph.tips.map((tip) => (
              <SmallButton key={tip.id} onClick={() => activeId && navigateToBranch(activeId, tip.id)}>
                <GitBranch size={13} /> Tip {tip.id.slice(0, 4)}
              </SmallButton>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function BrowserSection() {
  const browserMirror = useChatStore((s) => s.browserMirror);
  const setBrowserMirror = useChatStore((s) => s.setBrowserMirror);
  const [url, setUrl] = useState(browserMirror.url || "https://example.com");
  const normalizedUrl = /^https?:\/\//i.test(browserMirror.url) ? browserMirror.url : "";

  return (
    <div className="flex flex-col gap-4">
      <Section title="Embedded browser mirror" icon={Globe2} action={<SmallButton onClick={() => setBrowserMirror({ url, status: "ready", visible: true, updatedAt: Date.now() })}><ChevronRight size={13} /> Open</SmallButton>}>
        <div className="flex flex-col gap-3">
          <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          <p className="text-[12px] leading-relaxed text-text-3">
            The browser panel mirrors the agent-visible URL or screenshot stream. Sites that block framing still show the URL state and can be tracked by screenshots when the agent updates it.
          </p>
        </div>
      </Section>

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/30">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
          <span className="truncate text-[12.5px] text-text-2">{browserMirror.title || "Browser"}</span>
          <span className="text-[11px] text-text-3">{browserMirror.status}</span>
        </div>
        <div className="h-[420px] bg-[#f5f5f5]">
          {browserMirror.screenshotDataUrl ? (
            <img src={browserMirror.screenshotDataUrl} alt="Browser screenshot" className="h-full w-full object-contain" />
          ) : normalizedUrl ? (
            <iframe src={normalizedUrl} title="Embedded browser mirror" className="h-full w-full border-0 bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
          ) : (
            <div className="flex h-full items-center justify-center text-[12.5px] text-[#555]">Open a URL to mirror browser state.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function NotebookSection() {
  const cells = useChatStore((s) => s.notebookCells);
  const setCells = useChatStore((s) => s.setNotebookCells);
  const updateCell = useChatStore((s) => s.updateNotebookCell);

  const addCell = (kind: NotebookCellKind) => {
    setCells([...useChatStore.getState().notebookCells, createNotebookCell(kind, "", Date.now())]);
  };

  const runCell = async (cell: NotebookCell) => {
    updateCell(cell.id, { status: "running", output: "" });
    try {
      if (cell.kind === "text") {
        updateCell(cell.id, { status: "done", output: cell.content });
        return;
      }
      if (cell.kind === "code") {
        const output = await invoke<string>("run_python", { code: cell.content });
        updateCell(cell.id, { status: "done", output });
        return;
      }
      const cfg = useChatStore.getState().getActiveLlmConfig();
      if (!cfg) throw new Error("No configured model selected.");
      const model = await createModel(cfg);
      const result = await generateText({ model, prompt: cell.content, temperature: 0.2 });
      updateCell(cell.id, { status: "done", output: result.text });
    } catch (error) {
      updateCell(cell.id, { status: "error", output: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Cells"
        icon={BookOpen}
        action={
          <div className="flex gap-1.5">
            <SmallButton onClick={() => addCell("text")}><Plus size={13} /> Text</SmallButton>
            <SmallButton onClick={() => addCell("code")}><Code size={13} /> Code</SmallButton>
            <SmallButton onClick={() => addCell("ai")}><Sparkles size={13} /> AI</SmallButton>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {cells.length === 0 && <p className="text-[12.5px] text-text-3">Add a text, Python, or AI prompt cell to build a runnable notebook.</p>}
          {cells.map((cell, index) => (
            <div key={cell.id} className="rounded-xl border border-white/[0.07] bg-black/20">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
                <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-3">{index + 1}. {cell.kind}</span>
                <div className="flex items-center gap-1.5">
                  <SmallButton onClick={() => runCell(cell)} disabled={cell.status === "running"}>{cell.status === "running" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run</SmallButton>
                  <button
                    type="button"
                    className="control-icon flex h-8 w-8 items-center justify-center rounded-lg"
                    onClick={() => setCells(useChatStore.getState().notebookCells.filter((c) => c.id !== cell.id))}
                    aria-label="Delete cell"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-2">
                <TextArea value={cell.content} onChange={(e) => updateCell(cell.id, { content: e.target.value })} placeholder={cell.kind === "code" ? "Python code..." : cell.kind === "ai" ? "Prompt..." : "Notes..."} className="min-h-[140px]" />
                <pre className="m-0 min-h-[140px] overflow-auto rounded-lg border border-white/[0.06] bg-black/25 p-3 text-[12px] leading-relaxed text-text-2">
                  {cell.output || (cell.status === "idle" ? "Output appears here." : cell.status)}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

async function responseImageToDataUrl(payload: any): Promise<string> {
  const first = payload?.data?.[0] ?? payload?.images?.[0] ?? payload;
  const b64 = first?.b64_json ?? first?.b64 ?? first?.image ?? first?.data;
  if (typeof b64 === "string") {
    if (b64.startsWith("data:")) return b64;
    return `data:image/png;base64,${b64}`;
  }
  const url = first?.url ?? first?.image_url;
  if (typeof url === "string") return url;
  throw new Error("Image response did not include a URL or base64 image.");
}

function ImagesSection() {
  const activeId = useChatStore((s) => s.activeId);
  const providerConfigs = useChatStore((s) => s.providerConfigs);
  const jobs = useChatStore((s) => s.imageJobs);
  const addJob = useChatStore((s) => s.addImageJob);
  const updateJob = useChatStore((s) => s.updateImageJob);
  const addImageArtifact = useChatStore((s) => s.addImageArtifact);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<ImageGenerationJob["provider"]>("openai");
  const [imageModel, setImageModel] = useState("gpt-image-1.5");
  const [customEndpoint, setCustomEndpoint] = useState(() => localStorage.getItem("goatllm-image-endpoint") ?? "");
  const [running, setRunning] = useState(false);

  const runImage = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || running) return;
    setRunning(true);
    localStorage.setItem("goatllm-image-endpoint", customEndpoint);
    const jobId = crypto.randomUUID();
    addJob({ id: jobId, prompt: cleanPrompt, provider, status: "running", createdAt: Date.now() });
    try {
      let dataUrl = "";
      if (provider === "openai") {
        const cfg = providerConfigs.openai;
        if (!cfg?.apiKey) throw new Error("Configure an OpenAI API key in Settings first.");
        const baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
        const res = await fetch(`${baseUrl}/images/generations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: imageModel || "gpt-image-1.5",
            prompt: cleanPrompt,
            size: "1024x1024",
            quality: "auto",
            background: "auto",
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || `Image request failed (${res.status}).`);
        dataUrl = await responseImageToDataUrl(json);
      } else {
        if (!customEndpoint.trim()) throw new Error("Add a custom Flux or Stable Diffusion endpoint.");
        const res = await fetch(customEndpoint.trim(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: cleanPrompt, model: imageModel, provider }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || `Image request failed (${res.status}).`);
        dataUrl = await responseImageToDataUrl(json);
      }
      const artifactId = activeId
        ? addImageArtifact(activeId, cleanPrompt.slice(0, 64) || "Generated Image", dataUrl)
        : undefined;
      updateJob(jobId, { status: "done", imageDataUrl: dataUrl, artifactId });
    } catch (error) {
      updateJob(jobId, { status: "error", error: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Generate image" icon={ImageIcon} action={<SmallButton onClick={runImage} disabled={running || !prompt.trim()}>{running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Generate</SmallButton>}>
        <div className="flex flex-col gap-3">
          <TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the image..." />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select value={provider} onChange={(e) => setProvider(e.target.value as ImageGenerationJob["provider"])}>
              <option value="openai">OpenAI GPT Image</option>
              <option value="flux">Flux endpoint</option>
              <option value="stable-diffusion">Stable Diffusion endpoint</option>
              <option value="custom">Custom JSON endpoint</option>
            </Select>
            <TextInput value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder="gpt-image-1.5" />
            <TextInput value={customEndpoint} onChange={(e) => setCustomEndpoint(e.target.value)} placeholder="Custom endpoint URL" />
          </div>
        </div>
      </Section>

      <Section title="Image jobs" icon={FileClock}>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {jobs.length === 0 && <p className="text-[12.5px] text-text-3">Generated images appear here and in the Artifact panel.</p>}
          {jobs.map((job) => (
            <div key={job.id} className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/20">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
                <span className="truncate text-[12px] font-medium text-text-1">{job.prompt}</span>
                <span className="text-[11px] text-text-3">{job.status}</span>
              </div>
              {job.imageDataUrl ? (
                <img src={job.imageDataUrl} alt={job.prompt} className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square items-center justify-center p-4 text-center text-[12px] text-text-3">
                  {job.error || "Waiting for image..."}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function PromptsSection() {
  const workspace = useChatStore((s) => s.workspacePath);
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<PromptDocument[]>([]);
  const [selected, setSelected] = useState<PromptDocument | null>(null);
  const [draft, setDraft] = useState("");
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
    const values = Object.values(next).sort((a, b) => b.updatedAt - a.updatedAt);
    setDocs(values);
    if (!selected && values[0]) {
      setSelected(values[0]);
      setDraft(values[0].body);
    }
  }, [selected, workspace]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    setStatus("Saved new version.");
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
    setStatus("Cloned prompt.");
  };

  return (
    <div className="grid min-h-[600px] grid-cols-1 gap-4 xl:grid-cols-[280px_1fr]">
      <Section title="Library" icon={FileClock}>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" aria-hidden="true" />
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompts" className="w-full pl-8" />
          </div>
          {!workspace && <p className="text-[12.5px] text-text-3">Choose a workspace to manage `.goat/prompts/*.md`.</p>}
          <div className="flex max-h-[500px] flex-col gap-2 overflow-y-auto">
            {filtered.map((doc) => (
              <button
                key={doc.name}
                type="button"
                onClick={() => { setSelected(doc); setDraft(doc.body); }}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected?.name === doc.name ? "border-accent/30 bg-accent/10" : "border-white/[0.06] bg-black/15 hover:bg-white/[0.045]"
                }`}
              >
                <div className="truncate text-[12.5px] font-medium text-text-1">/{doc.name}</div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-3">{doc.description}</div>
                <div className="mt-2 flex items-center gap-2 text-[10.5px] text-text-3">
                  <Tags size={11} /> v{doc.version} · {doc.stats.words} words
                </div>
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section
        title={selected ? `/${selected.name}` : "Prompt editor"}
        icon={Sparkles}
        action={
          selected && (
            <div className="flex gap-1.5">
              <SmallButton onClick={() => navigator.clipboard?.writeText(draft)}><Copy size={13} /> Share</SmallButton>
              <SmallButton onClick={cloneDoc}><Copy size={13} /> Clone</SmallButton>
              <SmallButton onClick={saveDoc}><Check size={13} /> Save</SmallButton>
            </div>
          )
        }
      >
        {selected ? (
          <div className="flex flex-col gap-3">
            <TextArea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[360px] font-mono text-[12px]" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <MetricCard label="Version" value={`v${selected.version}`} detail={`${selected.history.length} prior`} />
              <MetricCard label="Variables" value={String(selected.stats.variables.length)} detail={selected.stats.variables.join(", ") || "none"} />
              <MetricCard label="Stats" value={`${selected.stats.words}`} detail={`${selected.stats.characters} chars`} />
            </div>
            {status && <p className="text-[12px] text-accent">{status}</p>}
          </div>
        ) : (
          <p className="text-[12.5px] text-text-3">Select a prompt to edit, clone, fork, version, or share.</p>
        )}
      </Section>
    </div>
  );
}

function SchedulesSection() {
  const agents = useChatStore((s) => s.scheduledAgents);
  const setAgents = useChatStore((s) => s.setScheduledAgents);
  const [name, setName] = useState("Daily digest");
  const [schedule, setSchedule] = useState("@daily");
  const [prompt, setPrompt] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);

  const saveAgent = () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;
    const agent: ScheduledAgent = {
      id: crypto.randomUUID(),
      name: name.trim() || "Scheduled agent",
      prompt: cleanPrompt,
      schedule: schedule.trim() || "@daily",
      enabled: true,
      nextRunAt: computeNextRun(schedule.trim() || "@daily").getTime(),
      lastStatus: "idle",
    };
    setAgents([agent, ...agents]);
    setPrompt("");
  };

  const runAgent = async (agent: ScheduledAgent) => {
    setRunningId(agent.id);
    setAgents(useChatStore.getState().scheduledAgents.map((item) => item.id === agent.id ? { ...item, lastStatus: "running" } : item));
    try {
      const cfg = useChatStore.getState().getActiveLlmConfig();
      if (!cfg) throw new Error("No configured model selected.");
      const model = await createModel(cfg);
      const result = await generateText({ model, prompt: agent.prompt, temperature: 0.2 });
      const updated = {
        ...agent,
        lastRunAt: Date.now(),
        lastStatus: "done" as const,
        lastResult: result.text,
        nextRunAt: computeNextRun(agent.schedule).getTime(),
      };
      setAgents(useChatStore.getState().scheduledAgents.map((item) => item.id === agent.id ? updated : item));
    } catch (error) {
      setAgents(useChatStore.getState().scheduledAgents.map((item) =>
        item.id === agent.id
          ? { ...item, lastRunAt: Date.now(), lastStatus: "error", lastResult: error instanceof Error ? error.message : String(error) }
          : item,
      ));
    } finally {
      setRunningId(null);
    }
  };

  useEffect(() => {
    const due = agents.filter((agent) => agent.enabled && agent.nextRunAt <= Date.now() && agent.lastStatus !== "running");
    if (due.length > 0 && runningId === null) {
      runAgent(due[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length]);

  return (
    <div className="flex flex-col gap-4">
      <Section title="New recurring agent" icon={CalendarClock} action={<SmallButton onClick={saveAgent}><Plus size={13} /> Save</SmallButton>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <TextInput value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="@daily or 0 9 * * *" />
          <TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should the agent do on schedule?" className="sm:col-span-2" />
        </div>
      </Section>
      <Section title="Runs" icon={FileClock}>
        <div className="flex flex-col gap-3">
          {agents.length === 0 && <p className="text-[12.5px] text-text-3">Create a schedule for daily digests, nightly checks, or recurring analysis.</p>}
          {agents.map((agent) => (
            <div key={agent.id} className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-text-1">{agent.name}</div>
                  <div className="mt-1 text-[11px] text-text-3">{agent.schedule} · next {new Date(agent.nextRunAt).toLocaleString()}</div>
                </div>
                <div className="flex gap-1.5">
                  <SmallButton onClick={() => runAgent(agent)} disabled={runningId === agent.id}>{runningId === agent.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run</SmallButton>
                  <button type="button" className="control-icon flex h-8 w-8 items-center justify-center rounded-lg" onClick={() => setAgents(agents.filter((item) => item.id !== agent.id))} aria-label="Delete schedule"><Trash2 size={14} /></button>
                </div>
              </div>
              {agent.lastResult && <pre className="mt-3 max-h-[180px] overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-black/25 p-3 text-[12px] text-text-2">{agent.lastResult}</pre>}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function MemorySection() {
  const ragSettings = useChatStore((s) => s.ragSettings);
  const setRagSettings = useChatStore((s) => s.setRagSettings);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [hits, setHits] = useState<MemorySearchHit[]>([]);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("fact");

  const refresh = useCallback(async () => {
    setMemories(await listMemories().catch(() => []));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = async () => {
    await addMemory(text, category);
    setText("");
    refresh();
  };

  const search = async () => {
    setHits(await searchMemories(query, ragSettings.maxRetrievedMemories).catch(() => []));
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="RAG controls" icon={MemoryStick}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Toggle label="Project memory" checked={ragSettings.projectMemory} onChange={(checked) => setRagSettings({ ...ragSettings, projectMemory: checked })} />
          <Toggle label="Conversation memory" checked={ragSettings.conversationMemory} onChange={(checked) => setRagSettings({ ...ragSettings, conversationMemory: checked })} />
          <Toggle label="Retrieval preview" checked={ragSettings.retrievalPreview} onChange={(checked) => setRagSettings({ ...ragSettings, retrievalPreview: checked })} />
          <Toggle label="Provenance" checked={ragSettings.provenance} onChange={(checked) => setRagSettings({ ...ragSettings, provenance: checked })} />
          <label className="flex flex-col gap-1 text-[12px] text-text-3">
            Retrieved memories
            <TextInput type="number" min={1} max={24} value={ragSettings.maxRetrievedMemories} onChange={(e) => setRagSettings({ ...ragSettings, maxRetrievedMemories: Number(e.target.value) || 8 })} />
          </label>
        </div>
      </Section>

      <Section title="Add memory" icon={Brain} action={<SmallButton onClick={add}><Plus size={13} /> Add</SmallButton>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="fact">Fact</option>
            <option value="preference">Preference</option>
            <option value="project">Project</option>
            <option value="task">Task</option>
          </Select>
          <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="What should goatLLM remember?" />
        </div>
      </Section>

      <Section title="Search memory" icon={Search} action={<SmallButton onClick={search}><Search size={13} /> Search</SmallButton>}>
        <div className="flex flex-col gap-3">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search remembered context" />
          {(hits.length > 0 ? hits : memories).map((memory) => (
            <div key={memory.id} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-accent">{memory.category}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-text-2">{memory.text}</p>
                  <p className="mt-1 text-[11px] text-text-3">Used {memory.uses} times</p>
                </div>
                <button type="button" className="control-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" onClick={async () => { await deleteMemory(memory.id); refresh(); }} aria-label="Delete memory">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveSyncKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bufferSource(salt), iterations: 210_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptSyncPayload(payload: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveSyncKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    key,
    new TextEncoder().encode(payload),
  );
  return JSON.stringify({
    encrypted: true,
    version: 1,
    kdf: "PBKDF2-SHA256",
    cipher: "AES-256-GCM",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  });
}

async function decryptSyncPayload(payload: string, passphrase: string): Promise<string> {
  const parsed = JSON.parse(payload);
  if (!parsed?.encrypted) return payload;
  const key = await deriveSyncKey(passphrase, base64ToBytes(parsed.salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferSource(base64ToBytes(parsed.iv)) },
    key,
    bufferSource(base64ToBytes(parsed.data)),
  );
  return new TextDecoder().decode(decrypted);
}

function SyncSection() {
  const syncSettings = useChatStore((s) => s.syncSettings);
  const setSyncSettings = useChatStore((s) => s.setSyncSettings);
  const [status, setStatus] = useState("");

  const exportState = async () => {
    setStatus("Exporting...");
    const passphrase = syncSettings.encryptionKeyHint?.trim();
    if (!passphrase) {
      setStatus("Add an encryption passphrase in Settings before exporting.");
      return;
    }
    const state = useChatStore.getState();
    const payload = JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      conversations: state.conversations,
      messages: state.messages,
      settings: {
        usage: state.usageSettings,
        voice: state.voiceSettings,
        sync: state.syncSettings,
        features: state.featureFlags,
        rag: state.ragSettings,
      },
      prompts: Object.keys(localStorage)
        .filter((key) => key.startsWith("goatllm-prompt-docs:"))
        .reduce<Record<string, string | null>>((acc, key) => ({ ...acc, [key]: localStorage.getItem(key) }), {}),
    });
    const encryptedPayload = await encryptSyncPayload(payload, passphrase);
    const result = await invoke<string>("sync_export_state", { config: syncSettings, payload: encryptedPayload }).catch((error) => {
      throw new Error(error instanceof Error ? error.message : String(error));
    });
    setStatus(result);
  };

  const importState = async () => {
    setStatus("Importing...");
    const passphrase = syncSettings.encryptionKeyHint?.trim();
    if (!passphrase) {
      setStatus("Add the encryption passphrase before importing.");
      return;
    }
    const raw = await invoke<string>("sync_import_state", { config: syncSettings });
    const decrypted = await decryptSyncPayload(raw, passphrase);
    const imported = JSON.parse(decrypted);
    if (Array.isArray(imported.conversations)) {
      for (const conversation of imported.conversations) {
        await persistConversation(conversation);
      }
    }
    if (imported.messages && typeof imported.messages === "object") {
      for (const list of Object.values(imported.messages)) {
        if (!Array.isArray(list)) continue;
        for (const message of list) {
          await persistMessage(message as any);
        }
      }
    }
    if (imported.prompts && typeof imported.prompts === "object") {
      for (const [key, value] of Object.entries(imported.prompts)) {
        if (typeof value === "string") localStorage.setItem(key, value);
      }
    }
    const settings = imported.settings ?? {};
    const store = useChatStore.getState();
    if (settings.usage) store.setUsageSettings(settings.usage);
    if (settings.voice) store.setVoiceSettings(settings.voice);
    if (settings.sync) store.setSyncSettings(settings.sync);
    if (settings.rag) store.setRagSettings(settings.rag);
    if (Array.isArray(imported.conversations) && imported.messages && typeof imported.messages === "object") {
      useChatStore.setState({
        conversations: imported.conversations,
        messages: imported.messages,
      });
    }
    setStatus(`Imported ${imported.conversations?.length ?? 0} conversations and rehydrated local state.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Encrypted sync target" icon={Cloud}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Toggle label="Enable sync" checked={syncSettings.enabled} onChange={(checked) => setSyncSettings({ ...syncSettings, enabled: checked })} />
          <Select value={syncSettings.provider} onChange={(e) => setSyncSettings({ ...syncSettings, provider: e.target.value as "icloud" | "s3", remoteLabel: e.target.value === "icloud" ? "iCloud Drive" : "S3 bucket" })}>
            <option value="icloud">iCloud Drive</option>
            <option value="s3">S3-compatible storage</option>
          </Select>
          <TextInput value={syncSettings.prefix ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, prefix: e.target.value })} placeholder="Prefix" />
          <TextInput value={syncSettings.encryptionKeyHint ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, encryptionKeyHint: e.target.value })} placeholder="Encryption key hint" />
          <TextInput value={syncSettings.bucket ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, bucket: e.target.value })} placeholder="S3 bucket" />
          <TextInput value={syncSettings.endpoint ?? ""} onChange={(e) => setSyncSettings({ ...syncSettings, endpoint: e.target.value })} placeholder="S3 endpoint" />
        </div>
      </Section>
      <Section title="Actions" icon={RefreshCw}>
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={exportState}><UploadCloud size={13} /> Export</SmallButton>
          <SmallButton onClick={importState}><DownloadCloud size={13} /> Import</SmallButton>
        </div>
        {status && <p className="mt-3 text-[12px] text-text-3">{status}</p>}
      </Section>
    </div>
  );
}

function WatcherSection() {
  const workspace = useChatStore((s) => s.workspacePath);
  const events = useChatStore((s) => s.watcherEvents);
  const clearEvents = useChatStore((s) => s.clearWatcherEvents);
  const [watching, setWatching] = useState(false);
  const [status, setStatus] = useState("");

  const start = async () => {
    if (!workspace) return;
    await invoke("watch_workspace", { workspace });
    setWatching(true);
    setStatus(`Watching ${workspace}`);
  };

  const stop = async () => {
    if (!workspace) return;
    await invoke("unwatch_workspace", { workspace }).catch(() => undefined);
    setWatching(false);
    setStatus("Stopped watcher.");
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Filesystem watcher" icon={Eye}>
        <div className="flex flex-wrap items-center gap-2">
          <SmallButton onClick={start} disabled={!workspace || watching}><Eye size={13} /> Start</SmallButton>
          <SmallButton onClick={stop} disabled={!watching}><X size={13} /> Stop</SmallButton>
          <SmallButton onClick={clearEvents}><Trash2 size={13} /> Clear</SmallButton>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-text-3">
          notify-based events are translated into reactions for config changes, test signals, generated artifacts, and external edits.
        </p>
        {status && <p className="mt-2 text-[12px] text-accent">{status}</p>}
      </Section>
      <Section title="Recent reactions" icon={Zap}>
        <div className="flex flex-col gap-2">
          {events.length === 0 && <p className="text-[12.5px] text-text-3">No watcher events yet.</p>}
          {events.map((event, index) => (
            <div key={`${event.path}-${event.at}-${index}`} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12.5px] text-text-1">{summarizeWatcherEvent(event)}</span>
                <span className="shrink-0 text-[10.5px] text-text-3">{new Date(event.at).toLocaleTimeString()}</span>
              </div>
              <p className="mt-1 truncate text-[11px] text-text-3">{event.path}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
