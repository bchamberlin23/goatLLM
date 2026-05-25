import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Trash2,
  Cpu,
  HardDrive,
  Power,
  PowerOff,
  Loader2,
  Check,
  AlertCircle,
  RefreshCw,
  Sparkles,
  X,
  Copy,
  ExternalLink,
  Terminal,
} from "lucide-react";
import {
  RECOMMENDED_MODELS,
  getTierModelIds,
  modelFit,
  formatBytes,
  ollamaSystemInfo,
  ollamaStatus,
  ollamaStart,
  ollamaStop,
  ollamaInstallGuide,
  listInstalledModels,
  pullModel,
  deleteModel,
  type OllamaSystemInfo,
  type OllamaStatus,
  type RecommendedModel,
  type InstalledModel,
  type PullProgress,
  type ModelFit,
  type OllamaInstallGuide,
} from "../lib/ollama";
import { useChatStore } from "../stores/chat";

/**
 * The "Local model setup" panel. End-to-end onboarding for running models
 * locally with Ollama:
 *
 *   1. probe the user's hardware so we can recommend models that'll fit,
 *   2. show a one-line setup command for whichever OS they're on (we don't
 *      auto-install — the official scripts handle code-signing, daemons,
 *      and PATH wiring better than we ever could from inside a sandboxed
 *      Tauri app),
 *   3. detect when Ollama is up so the user doesn't have to manually flip
 *      the panel from "not installed" to "running",
 *   4. surface the recommended model catalog once the daemon answers.
 *
 * Why all of it lives in one component: the steps are sequential and share
 * state. Splitting it would mean prop-drilling four pieces of state through
 * three files for one settings panel. If this grows past ~600 lines we
 * should split.
 */
export function LocalModelsSection() {
  const [info, setInfo] = useState<OllamaSystemInfo | null>(null);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [busy, setBusy] = useState<{ kind: "start" | "stop" | "recheck" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-model pull progress, keyed by model id.
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({});
  const pullAborts = useRef<Record<string, AbortController>>({});
  const [customPull, setCustomPull] = useState("");

  // Push pulled models into the chat store's local provider so they show up
  // in the model picker without a manual refresh.
  const discoverLocalModels = useChatStore((s) => s.discoverLocalModels);
  const configureProvider = useChatStore((s) => s.configureProvider);

  const refreshAll = useCallback(async () => {
    const [s, st] = await Promise.allSettled([ollamaStatus(), ollamaSystemInfo()]);
    if (s.status === "fulfilled") setStatus(s.value);
    if (st.status === "fulfilled") setInfo(st.value);
    if (s.status === "fulfilled" && s.value.running) {
      try { setInstalled(await listInstalledModels()); } catch { /* daemon may have just died */ }
    } else {
      setInstalled([]);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    // Light status polling — every 4s while the panel is open. Cheap (one
    // localhost ping) and keeps the running indicator honest if the user
    // killed Ollama outside the app, or finished running the install
    // script in their terminal.
    const tick = window.setInterval(() => { void refreshAll(); }, 4000);
    return () => {
      window.clearInterval(tick);
    };
  }, [refreshAll]);

  const handleRecheck = useCallback(async () => {
    setBusy({ kind: "recheck" });
    setError(null);
    try {
      await refreshAll();
    } finally {
      // Keep the spinner visible briefly even on fast networks so the user
      // sees that *something* happened. Otherwise the click feels like a
      // no-op and they'll click again.
      window.setTimeout(() => setBusy(null), 350);
    }
  }, [refreshAll]);

  const handleStart = useCallback(async () => {
    setBusy({ kind: "start" });
    setError(null);
    try {
      await ollamaStart();
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [refreshAll]);

  const handleStop = useCallback(async () => {
    setBusy({ kind: "stop" });
    setError(null);
    try {
      await ollamaStop();
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [refreshAll]);

  const installedIds = useMemo(() => new Set(installed.map((m) => m.id)), [installed]);

  /** After a successful pull, append the model to ollama provider's
   *  enabledModels so it appears in the model picker. */
  const addToOllamaProvider = useCallback((modelId: string) => {
    const existing = useChatStore.getState().providerConfigs.ollama;
    const enabled = existing?.enabledModels;
    // If `enabled` is undefined, all models are enabled by default — no action needed.
    // If it's an array, append. If the model is already there, no-op.
    if (Array.isArray(enabled) && !enabled.includes(modelId)) {
      configureProvider("ollama", {
        ...(existing ?? {}),
        apiKey: existing?.apiKey ?? "",
        enabledModels: [...enabled, modelId],
      });
    }
    // Refresh the discovered-models list so the picker UI sees the new tag.
    void discoverLocalModels("ollama");
  }, [configureProvider, discoverLocalModels]);

  const handlePull = useCallback(async (modelId: string) => {
    setError(null);
    const ac = new AbortController();
    pullAborts.current[modelId] = ac;
    setPulls((prev) => ({ ...prev, [modelId]: { status: "pulling manifest…" } }));
    try {
      await pullModel(modelId, (p) => {
        setPulls((prev) => ({ ...prev, [modelId]: p }));
      }, { signal: ac.signal });
      // Done — clear progress, refresh installed list.
      setPulls((prev) => { const next = { ...prev }; delete next[modelId]; return next; });
      delete pullAborts.current[modelId];
      try { setInstalled(await listInstalledModels()); } catch { /* */ }
      addToOllamaProvider(modelId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.name === "AbortError") {
        setPulls((prev) => { const next = { ...prev }; delete next[modelId]; return next; });
      } else {
        setPulls((prev) => ({ ...prev, [modelId]: { status: `error: ${msg}` } }));
        setError(msg);
      }
    }
  }, [addToOllamaProvider]);

  const handleCancelPull = useCallback((modelId: string) => {
    const ac = pullAborts.current[modelId];
    if (ac) {
      ac.abort();
      delete pullAborts.current[modelId];
    }
    setPulls((prev) => { const next = { ...prev }; delete next[modelId]; return next; });
  }, []);

  const handleDelete = useCallback(async (modelId: string) => {
    if (!confirm(`Delete "${modelId}" from disk?`)) return;
    setError(null);
    try {
      await deleteModel(modelId);
      setInstalled(await listInstalledModels());
      void discoverLocalModels("ollama");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [discoverLocalModels]);

  const handleCustomPull = useCallback(async () => {
    const id = customPull.trim();
    if (!id) return;
    setCustomPull("");
    await handlePull(id);
  }, [customPull, handlePull]);

  // Only show the 3 models for the user's hardware tier.
  const sortedRecs = useMemo(() => {
    const tierIds = new Set(getTierModelIds(info));
    return RECOMMENDED_MODELS.filter((m) => tierIds.has(m.id));
  }, [info]);

  // Treat "running daemon" as the most authoritative installed signal —
  // some users run the official Ollama macOS app, which keeps the daemon
  // alive via launchd but tucks the binary inside the .app bundle where
  // our standard-paths sweep may or may not catch it. If `/api/version`
  // answers, Ollama works.
  const isInstalled = !!status?.systemBinaryPath || !!status?.running;
  const isRunning = !!status?.running;
  const installGuide = useMemo<OllamaInstallGuide>(() => ollamaInstallGuide(info), [info]);

  return (
    <div className="flex flex-col gap-3">
      {/* Hardware probe */}
      {info && <HardwareCard info={info} />}

      {/* Install / start / status row */}
      <DaemonControlCard
        status={status}
        busy={busy}
        installGuide={installGuide}
        onStart={handleStart}
        onStop={handleStop}
        onRecheck={handleRecheck}
      />

      {/* Setup guide — only when Ollama isn't around yet. The card gives
          the user one thing to do (paste a command into a terminal) and
          one thing to wait for (the daemon to come online). */}
      {!isInstalled && (
        <SetupGuideCard guide={installGuide} onRecheck={handleRecheck} busy={busy?.kind === "recheck"} />
      )}

      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-500/[0.06] border border-amber-500/15 rounded-lg text-[12px] text-[#fcd34d] leading-relaxed">
          <AlertCircle size={13} strokeWidth={1.75} className="shrink-0 mt-px text-[#f59e42]" />
          <span className="whitespace-pre-wrap">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto shrink-0 text-[#a0a0a0] hover:text-[#ececec]"
            aria-label="Dismiss"
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Recommended models — only show once Ollama is at least installed,
          to keep the empty state focused on the install action. */}
      {isInstalled && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#888] uppercase tracking-wider">
              Recommended for your machine
            </span>
            {!isRunning && (
              <span className="text-[10.5px] text-[#a0a0a0]">
                Start Ollama to download models
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {sortedRecs.map((m) => {
              const fit = modelFit(m, info);
              const inst = installedIds.has(m.id);
              const prog = pulls[m.id];
              return (
                <ModelRow
                  key={m.id}
                  model={m}
                  fit={fit}
                  installed={inst}
                  daemonRunning={isRunning}
                  pullProgress={prog}
                  onPull={() => handlePull(m.id)}
                  onCancel={() => handleCancelPull(m.id)}
                  onDelete={() => handleDelete(m.id)}
                />
              );
            })}
          </div>

          {/* Custom pull — for users who know exactly what they want. */}
          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="text"
              className="flex-1 h-[28px] px-2.5 bg-[#2c2c2e] border border-white/5 rounded-md text-[12px] text-[#ececec] font-mono outline-none focus:border-white/15 placeholder:text-[#666]"
              placeholder="Pull any model: e.g. mistral:7b, phi3.5"
              value={customPull}
              onChange={(e) => setCustomPull(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customPull.trim() && isRunning) {
                  e.preventDefault();
                  void handleCustomPull();
                }
              }}
              disabled={!isRunning}
            />
            <button
              onClick={() => void handleCustomPull()}
              disabled={!customPull.trim() || !isRunning}
              className="shrink-0 h-[28px] px-3 rounded-md text-[12px] font-medium bg-white/5 text-[#b4b4b4] hover:bg-white/10 hover:text-[#ececec] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Pull
            </button>
          </div>

          {/* Show non-recommended installed models too, so the user can
              uninstall things they pulled manually. */}
          <ExtraInstalledList
            installed={installed}
            recommendedIds={new Set(RECOMMENDED_MODELS.map((r) => r.id))}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

function HardwareCard({ info }: { info: OllamaSystemInfo }) {
  const ramGb = info.ramBytes ? (info.ramBytes / 1024 ** 3).toFixed(0) : "?";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-[#212122] border border-white/5 rounded-lg">
      <Cpu size={14} strokeWidth={1.75} className="shrink-0 text-[#a0a0a0]" />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[12px] text-[#d5d5d5] truncate">
          {info.cpuBrand ?? `${info.os} ${info.arch}`}
        </span>
        <div className="flex items-center gap-3 text-[10.5px] text-[#888] mt-0.5">
          <span className="flex items-center gap-1">
            <HardDrive size={10} strokeWidth={1.75} />
            <span className="font-mono tabular-nums">{ramGb} GB RAM</span>
          </span>
          {info.hasGpu && info.gpuName && (
            <span className="flex items-center gap-1 truncate">
              <Sparkles size={10} strokeWidth={1.75} className="text-[#f59e42]" />
              <span className="truncate">{info.gpuName}</span>
            </span>
          )}
          {!info.hasGpu && (
            <span className="text-[#666]">CPU-only inference</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DaemonControlCard({
  status,
  busy,
  installGuide,
  onStart,
  onStop,
  onRecheck,
}: {
  status: OllamaStatus | null;
  busy: { kind: "start" | "stop" | "recheck" } | null;
  installGuide: OllamaInstallGuide;
  onStart: () => void;
  onStop: () => void;
  onRecheck: () => void;
}) {
  const isInstalled = !!status?.systemBinaryPath || !!status?.running;
  const isRunning = !!status?.running;
  const isManaged = !!status?.managed; // we own this child

  let stateLabel: string;
  let stateColor: string;
  if (isRunning) {
    stateLabel = `Running${status?.version ? ` · v${status.version}` : ""}`;
    stateColor = "bg-[#34d399]";
  } else if (isInstalled) {
    stateLabel = "Installed · stopped";
    stateColor = "bg-[#a0a0a0]";
  } else {
    stateLabel = "Not installed";
    stateColor = "bg-[#4a4a4a]";
  }

  // Sub-line under the title — context-aware so the user knows what we know.
  let subline: string;
  if (isRunning) {
    subline = status?.systemBinaryPath
      ? `Detected at ${truncatePath(status.systemBinaryPath)}`
      : "Daemon answering on http://127.0.0.1:11434";
  } else if (isInstalled) {
    subline = `Found at ${truncatePath(status?.systemBinaryPath)}`;
  } else {
    subline = `Run the ${installGuide.shellLabel} command below to install.`;
  }

  return (
    <div className="bg-[#212122] border border-white/5 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[#ececec]">Ollama</span>
            <span className="flex items-center gap-1.5 text-[11px] text-[#a0a0a0]">
              <span className={`w-1.5 h-1.5 rounded-full ${stateColor}`} />
              {stateLabel}
            </span>
          </div>
          <span className="text-[10.5px] text-[#888] mt-0.5 truncate" title={subline}>
            {subline}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onRecheck}
            disabled={busy?.kind === "recheck"}
            className="w-7 h-7 flex items-center justify-center rounded text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 disabled:opacity-50 transition-colors"
            aria-label="Recheck Ollama status"
            title="Recheck"
          >
            <RefreshCw
              size={12}
              strokeWidth={1.75}
              className={busy?.kind === "recheck" ? "animate-spin" : ""}
            />
          </button>

          {isInstalled && !isRunning && (
            <button
              onClick={onStart}
              disabled={!!busy}
              className="h-7 px-3 rounded-md text-[12px] font-medium bg-[#f59e42] text-black hover:bg-[#fbb968] disabled:opacity-60 transition-colors flex items-center gap-1.5"
            >
              {busy?.kind === "start" ? (
                <Loader2 size={12} strokeWidth={2} className="animate-spin" />
              ) : (
                <Power size={12} strokeWidth={2} />
              )}
              Start
            </button>
          )}

          {isRunning && isManaged && (
            <button
              onClick={onStop}
              disabled={!!busy}
              className="h-7 px-3 rounded-md text-[12px] font-medium bg-white/5 text-[#b4b4b4] hover:bg-white/10 hover:text-[#ececec] disabled:opacity-60 transition-colors flex items-center gap-1.5"
            >
              {busy?.kind === "stop" ? (
                <Loader2 size={12} strokeWidth={2} className="animate-spin" />
              ) : (
                <PowerOff size={12} strokeWidth={2} />
              )}
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Setup guide card. Shown only when Ollama isn't installed yet.
 *
 * Why this is a separate card and not a modal or a wizard:
 *   - Pasting a one-liner is a 5-second operation; a wizard adds clicks
 *     for no benefit.
 *   - Keeping the command visible after the user pastes makes it easy to
 *     re-run if something went wrong (e.g. they don't have curl).
 *   - The poll loop in the parent already detects when Ollama comes
 *     online, so we don't need a "Done" button — the card just disappears.
 */
function SetupGuideCard({
  guide,
  onRecheck,
  busy,
}: {
  guide: OllamaInstallGuide;
  onRecheck: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(guide.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Some Tauri builds restrict the async clipboard API; fall back to
      // execCommand which still works inside webviews.
      const ta = document.createElement("textarea");
      ta.value = guide.command;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }
      catch { /* clipboard simply unavailable — user can still triple-click + cmd+c */ }
      finally { document.body.removeChild(ta); }
    }
  }, [guide.command]);

  // Per-platform hint about *what* the command does, so the user feels
  // informed before pasting random shell into their terminal.
  const platformBlurb = useMemo(() => {
    switch (guide.platform) {
      case "windows":
        return "Runs Ollama's official PowerShell installer. Adds it to PATH and starts the background service.";
      case "macos":
        return "Runs Ollama's official installer. Drops the binary in /usr/local/bin and starts the menubar app.";
      case "linux":
        return "Runs Ollama's official installer. Sets up a systemd service for the daemon.";
      default:
        return "Runs Ollama's official installer.";
    }
  }, [guide.platform]);

  return (
    <div className="bg-[#212122] border border-white/5 rounded-lg overflow-hidden">
      <div className="px-3 py-2.5 flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <Terminal size={13} strokeWidth={1.75} className="shrink-0 text-[#f59e42]" />
          <span className="text-[12.5px] font-medium text-[#ececec]">
            Install Ollama with one command
          </span>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[#a0a0a0] uppercase tracking-wider font-mono">
            {guide.shellLabel}
          </span>
        </div>

        <p className="text-[11.5px] text-[#a0a0a0] leading-relaxed">
          {platformBlurb}
        </p>

        {/* The command box. Selectable, copyable, monospaced — same shape as
            a terminal line so it's instantly recognizable. */}
        <div className="group relative flex items-stretch gap-1.5">
          <code className="flex-1 px-2.5 py-2 bg-[#1a1a1c] border border-white/5 rounded-md text-[12px] text-[#ececec] font-mono leading-snug select-all break-all">
            {guide.command}
          </code>
          <button
            onClick={handleCopy}
            className={`shrink-0 px-2.5 rounded-md text-[11.5px] font-medium flex items-center gap-1.5 transition-colors ${
              copied
                ? "bg-[#34d399]/10 text-[#34d399] border border-[#34d399]/30"
                : "bg-white/5 text-[#b4b4b4] hover:bg-white/10 hover:text-[#ececec] border border-white/5"
            }`}
            aria-label="Copy install command"
            title={copied ? "Copied" : "Copy command"}
          >
            {copied ? (
              <>
                <Check size={11} strokeWidth={2.2} />
                Copied
              </>
            ) : (
              <>
                <Copy size={11} strokeWidth={1.75} />
                Copy
              </>
            )}
          </button>
        </div>

        <ol className="text-[11.5px] text-[#a0a0a0] leading-relaxed pl-4 list-decimal flex flex-col gap-0.5 marker:text-[#666]">
          <li>
            Open <span className="text-[#d5d5d5]">{guide.shellLabel}</span>
            {guide.platform === "windows" ? " (Win+R, type 'powershell', Enter)." : "."}
          </li>
          <li>Paste the command and press Enter.</li>
          <li>
            Come back here and click <span className="text-[#d5d5d5]">Recheck</span>.
            We'll detect it automatically too.
          </li>
        </ol>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onRecheck}
            disabled={busy}
            className="h-7 px-3 rounded-md text-[12px] font-medium bg-[#f59e42] text-black hover:bg-[#fbb968] disabled:opacity-60 transition-colors flex items-center gap-1.5"
          >
            {busy ? (
              <Loader2 size={12} strokeWidth={2} className="animate-spin" />
            ) : (
              <RefreshCw size={12} strokeWidth={2} />
            )}
            Recheck
          </button>
          <a
            href={guide.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="h-7 px-2.5 rounded-md text-[11.5px] font-medium bg-white/5 text-[#b4b4b4] hover:bg-white/10 hover:text-[#ececec] transition-colors flex items-center gap-1.5"
          >
            <ExternalLink size={11} strokeWidth={1.75} />
            Read upstream docs
          </a>
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  fit,
  installed,
  daemonRunning,
  pullProgress,
  onPull,
  onCancel,
  onDelete,
}: {
  model: RecommendedModel;
  fit: ModelFit;
  installed: boolean;
  daemonRunning: boolean;
  pullProgress: PullProgress | undefined;
  onPull: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const fitMeta = fitDisplay(fit);
  const isPulling = !!pullProgress;
  const pullPct =
    pullProgress?.total && pullProgress.total > 0
      ? Math.min(100, Math.round((pullProgress.completed ?? 0) / pullProgress.total * 100))
      : null;

  return (
    <div className="bg-[#212122] border border-white/5 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-[#ececec]">{model.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[#888] font-mono">
              {model.params}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[#888]">
              {model.use}
            </span>
            {fit !== "fits" && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${fitMeta.classes}`}>
                {fitMeta.label}
              </span>
            )}
            {installed && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#34d399]/10 text-[#34d399] font-medium flex items-center gap-1">
                <Check size={9} strokeWidth={2.5} />
                Installed
              </span>
            )}
          </div>
          <div className="text-[11px] text-[#a0a0a0] mt-0.5 truncate">{model.blurb}</div>
          <div className="text-[10.5px] text-[#666] mt-0.5 font-mono tabular-nums">
            {model.id} · ~{model.sizeGb}GB · needs ~{model.ramGb}GB RAM
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1">
          {isPulling ? (
            <button
              onClick={onCancel}
              className="h-7 px-2.5 rounded-md text-[11.5px] font-medium bg-white/5 text-[#b4b4b4] hover:bg-white/10 hover:text-[#ececec] transition-colors"
            >
              Cancel
            </button>
          ) : installed ? (
            <button
              onClick={onDelete}
              className="w-7 h-7 flex items-center justify-center rounded text-[#666] hover:text-[#f87171] hover:bg-red-500/10 transition-colors"
              aria-label={`Remove ${model.name}`}
              title="Remove"
            >
              <Trash2 size={12} strokeWidth={1.75} />
            </button>
          ) : (
            <button
              onClick={onPull}
              disabled={!daemonRunning || fit === "too-big"}
              className={`h-7 px-3 rounded-md text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
                fit === "too-big"
                  ? "bg-white/5 text-[#666] cursor-not-allowed"
                  : "bg-white/5 text-[#b4b4b4] hover:bg-white/10 hover:text-[#ececec] disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
              title={
                !daemonRunning
                  ? "Start Ollama first"
                  : fit === "too-big"
                    ? "Not enough RAM for this model"
                    : `Download ${model.name}`
              }
            >
              <Download size={12} strokeWidth={1.75} />
              Get
            </button>
          )}
        </div>
      </div>

      {/* Pull progress */}
      {isPulling && pullProgress && (
        <div className="border-t border-white/5 px-3 py-2 flex flex-col gap-1.5 bg-black/10">
          <div className="flex items-center justify-between text-[11px] text-[#a0a0a0]">
            <span className="truncate">{pullProgress.status || "Pulling…"}</span>
            {pullProgress.total && (
              <span className="font-mono tabular-nums shrink-0 ml-2">
                {formatBytes(pullProgress.completed ?? 0)} / {formatBytes(pullProgress.total)}
              </span>
            )}
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#f59e42] transition-[width] duration-200"
              style={{ width: pullPct != null ? `${pullPct}%` : "8%" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ExtraInstalledList({
  installed,
  recommendedIds,
  onDelete,
}: {
  installed: InstalledModel[];
  recommendedIds: Set<string>;
  onDelete: (id: string) => void;
}) {
  const extras = installed.filter((m) => !recommendedIds.has(m.id));
  if (extras.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-[#888] uppercase tracking-wider">
        Other installed
      </span>
      <div className="flex flex-col gap-1">
        {extras.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-2.5 px-2.5 py-1.5 bg-[#212122] border border-white/5 rounded-md"
          >
            <span className="text-[12px] text-[#d5d5d5] font-mono truncate flex-1">{m.id}</span>
            <span className="text-[10.5px] text-[#888] font-mono tabular-nums">
              {formatBytes(m.size)}
            </span>
            <button
              onClick={() => onDelete(m.id)}
              className="w-6 h-6 flex items-center justify-center rounded text-[#666] hover:text-[#f87171] hover:bg-red-500/10 transition-colors"
              aria-label={`Remove ${m.id}`}
              title="Remove"
            >
              <Trash2 size={11} strokeWidth={1.75} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function fitDisplay(fit: ModelFit): { label: string; classes: string } {
  switch (fit) {
    case "recommended":
      return { label: "Recommended", classes: "bg-[#34d399]/10 text-[#34d399]" };
    case "fits":
      return { label: "Will run", classes: "bg-white/5 text-[#a0a0a0]" };
    case "tight":
      return { label: "Tight fit", classes: "bg-[#f59e42]/10 text-[#f59e42]" };
    case "too-big":
      return { label: "Not enough RAM", classes: "bg-[#f87171]/10 text-[#f87171]" };
  }
}

function truncatePath(p: string | null | undefined): string {
  if (!p) return "";
  if (p.length <= 38) return p;
  return `…${p.slice(p.length - 36)}`;
}
