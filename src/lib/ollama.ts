/**
 * Built-in Ollama lifecycle and model catalog.
 *
 * Architecture:
 *   - Rust side (`src-tauri/src/ollama.rs`) owns install/start/stop/uninstall
 *     and hardware probing. Returns paths and progress events.
 *   - TS side (this file) owns the catalog of recommended models, the
 *     hardware-fit logic (which model is "Recommended" / "Will work" /
 *     "Tight fit" / "Not enough RAM"), and HTTP calls to Ollama's own API
 *     for pull / list / delete (since the daemon already exposes them and
 *     wrapping in Rust would just double the surface).
 *
 * The recommendations list is intentionally small. We prefer "the right
 * five models for ~95% of users" over an exhaustive registry — picking is
 * the user's bottleneck, not browsing.
 */
import { getFetch } from "./fetch-adapter";

export interface OllamaSystemInfo {
  os: string;
  arch: string;
  ramBytes: number;
  cpuBrand: string | null;
  cpuThreads: number;
  hasGpu: boolean;
  gpuName: string | null;
  vramBytes: number | null;
}

export interface OllamaStatus {
  /** True if the daemon answered `/api/version`. The only signal that
   *  actually matters for using local models. */
  running: boolean;
  /** True if our own managed `ollama serve` child is alive. */
  managed: boolean;
  /** Path to a discovered Ollama binary, when present. Empty if the user
   *  hasn't run the setup script yet. */
  systemBinaryPath: string | null;
  /** Reported version (e.g. "0.24.0") when the daemon is up. */
  version: string | null;
}

/** OS family the user is on, mapped to the official one-line install
 *  command Ollama publishes. We surface this to the renderer so it can
 *  show the right script without rolling its own platform sniffing. */
export type OllamaInstallPlatform = "macos" | "linux" | "windows" | "unknown";

export interface OllamaInstallGuide {
  platform: OllamaInstallPlatform;
  /** Human label for the script ("Terminal", "PowerShell"). */
  shellLabel: string;
  /** The exact command to paste. */
  command: string;
  /** Where the upstream installer is documented, in case the user wants
   *  to read it before pasting. */
  docsUrl: string;
}

/**
 * Pick the right one-line install command for the current OS.
 *
 * macOS and Linux share Ollama's POSIX installer; Windows uses the
 * PowerShell installer. We deliberately keep this as a small switch in
 * one place so the strings are easy to audit, copy-paste-test, and update
 * when upstream changes the URL.
 */
export function ollamaInstallGuide(info: OllamaSystemInfo | null): OllamaInstallGuide {
  const os = info?.os ?? detectClientOs();
  switch (os) {
    case "windows":
      return {
        platform: "windows",
        shellLabel: "PowerShell",
        command: "irm https://ollama.com/install.ps1 | iex",
        docsUrl: "https://ollama.com/download/windows",
      };
    case "macos":
      return {
        platform: "macos",
        shellLabel: "Terminal",
        command: "curl -fsSL https://ollama.com/install.sh | sh",
        docsUrl: "https://ollama.com/download/mac",
      };
    case "linux":
      return {
        platform: "linux",
        shellLabel: "Terminal",
        command: "curl -fsSL https://ollama.com/install.sh | sh",
        docsUrl: "https://ollama.com/download/linux",
      };
    default:
      return {
        platform: "unknown",
        shellLabel: "Terminal",
        command: "curl -fsSL https://ollama.com/install.sh | sh",
        docsUrl: "https://ollama.com/download",
      };
  }
}

/** Best-effort OS sniff for the rare case Rust hasn't reported yet.
 *  Tauri's process is the source of truth — this is just a fallback so
 *  the UI never renders without *some* command shown. */
function detectClientOs(): OllamaInstallPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "unknown";
}

/** Single entry in the recommended-models catalog shown in Settings. */
export interface RecommendedModel {
  /** ID Ollama's `/api/pull` accepts (e.g. "llama3.2:3b"). */
  id: string;
  /** Display name in the UI. */
  name: string;
  /** Short tagline (one phrase, ~5–10 words). */
  blurb: string;
  /** Approx download size in GB. */
  sizeGb: number;
  /** Approx RAM/VRAM needed to run with reasonable speed, in GB.
   *  This is the *minimum* — runs faster with more headroom. */
  ramGb: number;
  /** Parameter count badge (e.g. "3B", "7B", "70B"). */
  params: string;
  /** Is this model good for general chat? Coding? Vision? Embedding? */
  use: "chat" | "coding" | "vision" | "embedding";
  /** Sort order — smaller first so the recommended-default appears top. */
  order: number;
}

/**
 * Curated catalog. Sized so the agent's "default install" picks a 4-bit
 * quant under ~5GB that will work on a 16GB Mac. No 70B+ entries by default
 * — those are still pull-able by typing the ID, but we don't recommend.
 */
export const RECOMMENDED_MODELS: RecommendedModel[] = [
  // ── 4 GB tier ──
  {
    id: "gemma4:e2b",
    name: "Gemma 4 Edge 2B",
    blurb: "Google's efficient edge model. Top-tier instruction following on minimal hardware.",
    sizeGb: 1.8,
    ramGb: 4,
    params: "2B",
    use: "chat",
    order: 0,
  },
  {
    id: "qwen3.5:2b",
    name: "Qwen 3.5 2B",
    blurb: "Outstanding baseline for general chat and light tool utilization.",
    sizeGb: 1.5,
    ramGb: 4,
    params: "2B",
    use: "chat",
    order: 1,
  },
  {
    id: "granite4.1:3b",
    name: "Granite 4.1 3B",
    blurb: "IBM's enterprise model. Highly optimized for structured JSON and tool workflows.",
    sizeGb: 2.2,
    ramGb: 4,
    params: "3B",
    use: "coding",
    order: 2,
  },

  // ── 8 GB tier ──
  {
    id: "gemma4:e4b",
    name: "Gemma 4 Edge 4B",
    blurb: "Best reasoning depth and native vision for standard consumer hardware.",
    sizeGb: 3.5,
    ramGb: 8,
    params: "4B",
    use: "chat",
    order: 3,
  },
  {
    id: "qwen3.5:9b",
    name: "Qwen 3.5 9B",
    blurb: "Extremely reliable for multilingual tasks, structured workflows, and coding.",
    sizeGb: 5.5,
    ramGb: 8,
    params: "9B",
    use: "coding",
    order: 4,
  },
  {
    id: "deepseek-r1:8b",
    name: "DeepSeek R1 8B",
    blurb: "Dedicated reasoning model for deep math, logic, and analysis tasks.",
    sizeGb: 5.0,
    ramGb: 8,
    params: "8B",
    use: "coding",
    order: 5,
  },

  // ── 12 GB tier ──
  {
    id: "qwen3.5:14b",
    name: "Qwen 3.5 14B",
    blurb: "Perfectly balanced foundation model with robust vision and tool calling.",
    sizeGb: 9.0,
    ramGb: 12,
    params: "14B",
    use: "chat",
    order: 6,
  },
  {
    id: "ministral-3:14b",
    name: "Ministral 3 14B",
    blurb: "Highly optimized edge model for reliable multimodal deployment.",
    sizeGb: 9.0,
    ramGb: 12,
    params: "14B",
    use: "vision",
    order: 7,
  },

  // ── 16 GB tier ──
  {
    id: "qwen3.6:27b",
    name: "Qwen 3.6 27B",
    blurb: "Generational leap. Elite commercial-grade intelligence, agentic coding, and thinking preservation.",
    sizeGb: 16.0,
    ramGb: 16,
    params: "27B",
    use: "coding",
    order: 8,
  },
  {
    id: "gemma4:26b",
    name: "Gemma 4 26B",
    blurb: "Frontier-class alternative for complex workflow orchestration and logic.",
    sizeGb: 15.5,
    ramGb: 16,
    params: "26B",
    use: "chat",
    order: 9,
  },
  {
    id: "gpt-oss:20b",
    name: "GPT-OSS 20B",
    blurb: "OpenAI's open-weight option. Smaller footprint leaves room for multi-step dev tasks.",
    sizeGb: 12.0,
    ramGb: 16,
    params: "20B",
    use: "coding",
    order: 10,
  },

  // ── 24 GB tier ──
  {
    id: "gemma4:31b",
    name: "Gemma 4 31B",
    blurb: "Google's dense 31B model. Unlocks deep logic and long-form execution without MoE complexity.",
    sizeGb: 18.5,
    ramGb: 24,
    params: "31B",
    use: "chat",
    order: 11,
  },
  {
    id: "mistral-small3.2:24b",
    name: "Mistral Small 3.2 24B",
    blurb: "Excellent for structural tool use and exploring multi-file local codebases.",
    sizeGb: 14.5,
    ramGb: 20,
    params: "24B",
    use: "coding",
    order: 12,
  },

  // ── 32 GB tier ──
  {
    id: "qwen3.6:35b",
    name: "Qwen 3.6 35B",
    blurb: "Parameter scale-up of the 27B architecture. Maximum depth for dense multi-agent workflows.",
    sizeGb: 21.0,
    ramGb: 32,
    params: "35B",
    use: "coding",
    order: 13,
  },
  {
    id: "olmo-3.1:32b",
    name: "OLMo 3.1 32B",
    blurb: "Fully open science model optimized for multi-turn structured workflows and strict instruction adherence.",
    sizeGb: 19.0,
    ramGb: 32,
    params: "32B",
    use: "coding",
    order: 14,
  },

  // ── 48 GB+ tier ──
  {
    id: "deepseek-r1:70b",
    name: "DeepSeek R1 70B",
    blurb: "Massive reasoning model for deep theoretical math, logic, and analysis.",
    sizeGb: 42.0,
    ramGb: 48,
    params: "70B",
    use: "chat",
    order: 15,
  },
  {
    id: "nemotron-3-super:120b",
    name: "Nemotron-3 Super 120B",
    blurb: "Highly efficient MoE — activates only 12B per token. Speed on enterprise hardware.",
    sizeGb: 70.0,
    ramGb: 64,
    params: "120B",
    use: "chat",
    order: 16,
  },
  {
    id: "mistral-medium-3.5:128b",
    name: "Mistral Medium 3.5 128B",
    blurb: "Flagship ultra-large dense model. Elite instruction following and vision.",
    sizeGb: 75.0,
    ramGb: 128,
    params: "128B",
    use: "chat",
    order: 17,
  },

];

/**
 * VRAM tier → the 3 model IDs to recommend for that tier.
 * Ordered by ascending VRAM. The lookup walks backwards to find the
 * largest tier the user's hardware can handle, so e.g. 10GB RAM gets
 * the 8GB tier, 20GB gets the 16GB tier, etc.
 */
const TIER_MODEL_IDS: [vramGb: number, ids: string[]][] = [
  [4,   ["gemma4:e2b", "qwen3.5:2b", "granite4.1:3b"]],
  [8,   ["gemma4:e4b", "qwen3.5:9b", "deepseek-r1:8b"]],
  [12,  ["gemma4:e4b", "qwen3.5:14b", "ministral-3:14b"]],
  [16,  ["qwen3.6:27b", "gemma4:26b", "gpt-oss:20b"]],
  [24,  ["qwen3.6:27b", "gemma4:31b", "mistral-small3.2:24b"]],
  [32,  ["qwen3.6:35b", "gemma4:31b", "olmo-3.1:32b"]],
  [48,  ["qwen3.6:35b", "gemma4:31b", "deepseek-r1:70b"]],
  [64,  ["qwen3.6:35b", "gemma4:31b", "nemotron-3-super:120b"]],
  [128, ["qwen3.6:35b", "gemma4:31b", "mistral-medium-3.5:128b"]],
];

/**
 * Given system info, return the 3 model IDs to recommend for the
 * user's hardware tier. Falls back to the 4GB tier if nothing is known.
 * Returns exactly 3 model IDs — the three curated picks for the
 * largest VRAM tier the hardware can handle.
 */
export function getTierModelIds(info: OllamaSystemInfo | null): string[] {
  if (!info) return TIER_MODEL_IDS[0][1];

  const ramGb = info.ramBytes / (1024 ** 3);

  // Mirror modelFit's memory-sizing logic so tier picks match reality:
  // - Apple Silicon → unified memory (RAM = VRAM)
  // - NVIDIA GPU   → use VRAM as the binding constraint
  // - Integrated / CPU-only → use system RAM with OS reserve
  const isUnified = info.os === "macos" && info.arch === "aarch64";
  let availableGb = ramGb;
  if (info.hasGpu && !isUnified && info.vramBytes) {
    // Discrete GPU: VRAM is the limit; Ollama can offload overflow to CPU
    // so the ceiling is whichever pool is larger.
    availableGb = Math.max(info.vramBytes / (1024 ** 3), ramGb);
  }
  // Reserve 4GB for OS + browser; never drop below half of system RAM.
  const usable = Math.max(availableGb - 4, ramGb * 0.5);

  for (let i = TIER_MODEL_IDS.length - 1; i >= 0; i--) {
    if (usable >= TIER_MODEL_IDS[i][0]) return TIER_MODEL_IDS[i][1];
  }
  return TIER_MODEL_IDS[0][1];
}

export type ModelFit = "recommended" | "fits" | "tight" | "too-big";

/**
 * Decide whether a model will run well on this machine.
 *
 *   recommended → sizable headroom (RAM ≥ 1.5× model needs)
 *   fits        → model will run (RAM ≥ model needs)
 *   tight       → close to the edge (RAM ≥ 0.85× model needs)
 *   too-big     → model needs more RAM than the machine has
 *
 * For Apple Silicon we use unified memory (RAM = effective VRAM). For
 * NVIDIA we use VRAM if reported, falling back to RAM. CPU-only inference
 * uses RAM directly.
 */
export function modelFit(model: RecommendedModel, info: OllamaSystemInfo | null): ModelFit {
  if (!info) return "fits"; // unknown — don't gate the UI
  const ramGb = info.ramBytes / (1024 ** 3);
  // VRAM matters when there's a discrete GPU; otherwise we run on the CPU/
  // unified memory path and main RAM is the binding constraint.
  const isUnified = info.os === "macos" && info.arch === "aarch64";
  let availableGb = ramGb;
  if (info.hasGpu && !isUnified && info.vramBytes) {
    // Take the bigger of the two — Ollama can offload partially to CPU when
    // VRAM is short, so the user-visible ceiling is whichever is larger.
    availableGb = Math.max(info.vramBytes / (1024 ** 3), ramGb);
  }
  // Reserve 4GB for the OS, browser, etc. before deciding fit.
  const usable = Math.max(availableGb - 4, ramGb * 0.5);

  if (usable >= model.ramGb * 1.5) return "recommended";
  if (usable >= model.ramGb) return "fits";
  if (usable >= model.ramGb * 0.85) return "tight";
  return "too-big";
}

/** Bytes → "1.2 GB" / "740 MB". */
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ── Tauri command bridge ─────────────────────────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

interface RawSystemInfo {
  os: string;
  arch: string;
  ram_bytes: number;
  cpu_brand: string | null;
  cpu_threads: number;
  has_gpu: boolean;
  gpu_name: string | null;
  vram_bytes: number | null;
}

interface RawStatus {
  running: boolean;
  managed: boolean;
  system_binary_path: string | null;
  version: string | null;
}

export async function ollamaSystemInfo(): Promise<OllamaSystemInfo> {
  const r = await invoke<RawSystemInfo>("ollama_system_info");
  return {
    os: r.os,
    arch: r.arch,
    ramBytes: r.ram_bytes,
    cpuBrand: r.cpu_brand,
    cpuThreads: r.cpu_threads,
    hasGpu: r.has_gpu,
    gpuName: r.gpu_name,
    vramBytes: r.vram_bytes,
  };
}

export async function ollamaStatus(): Promise<OllamaStatus> {
  const r = await invoke<RawStatus>("ollama_status");
  return {
    running: r.running,
    managed: r.managed,
    systemBinaryPath: r.system_binary_path,
    version: r.version,
  };
}

export async function ollamaStart(): Promise<string> {
  return invoke<string>("ollama_start");
}

export async function ollamaStop(): Promise<string> {
  return invoke<string>("ollama_stop");
}

// ── HTTP client (against Ollama's own API) ───────────────────────────────

function getOllamaFetch(): typeof fetch {
  return getFetch() ?? globalThis.fetch.bind(globalThis);
}

/** Default daemon URL; swappable by callers when needed. */
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

export interface InstalledModel {
  name: string;
  size: number;
  modifiedAt: string | null;
  /** The exact tag (`llama3.2:3b`) — same as `name` for Ollama. */
  id: string;
  /** Family + parameter size when the daemon reports it. */
  family?: string | null;
  parameterSize?: string | null;
  quantization?: string | null;
}

/** GET /api/tags — list installed models. */
export async function listInstalledModels(host = DEFAULT_OLLAMA_HOST): Promise<InstalledModel[]> {
  const fetcher = getOllamaFetch();
  const r = await fetcher(`${host}/api/tags`);
  if (!r.ok) throw new Error(`/api/tags returned ${r.status}`);
  const body = await r.json() as {
    models?: Array<{
      name: string;
      size: number;
      modified_at?: string;
      details?: { family?: string; parameter_size?: string; quantization_level?: string };
    }>;
  };
  return (body.models ?? []).map((m) => ({
    name: m.name,
    id: m.name,
    size: m.size,
    modifiedAt: m.modified_at ?? null,
    family: m.details?.family ?? null,
    parameterSize: m.details?.parameter_size ?? null,
    quantization: m.details?.quantization_level ?? null,
  }));
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

/**
 * POST /api/pull — stream NDJSON pull progress.
 *
 * Ollama emits a JSON object per line. We parse them as they arrive and call
 * `onProgress` with the latest. Returns when the stream closes.
 *
 * Cancellation: pass an AbortSignal; the fetch will tear down and the
 * transport closes. Note that Ollama itself keeps pulling layers on the
 * server side — that's a daemon limitation, not something we can fix here.
 */
export async function pullModel(
  modelId: string,
  onProgress: (p: PullProgress) => void,
  opts: { host?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const fetcher = getOllamaFetch();
  const host = opts.host ?? DEFAULT_OLLAMA_HOST;
  const r = await fetcher(`${host}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelId, stream: true }),
    signal: opts.signal,
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`/api/pull returned ${r.status}: ${body || r.statusText}`);
  }
  if (!r.body) {
    // Tauri's plugin-http returns the body unconditionally; if it's missing
    // we likely aren't streaming. Fall back to a single read.
    const text = await r.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { onProgress(JSON.parse(trimmed) as PullProgress); } catch { /* ignore */ }
    }
    return;
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          onProgress(JSON.parse(line) as PullProgress);
        } catch {
          // Best-effort — skip non-JSON lines (e.g. blank keepalives).
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
  // Flush trailing buffer.
  const tail = buffer.trim();
  if (tail) {
    try { onProgress(JSON.parse(tail) as PullProgress); } catch { /* */ }
  }
}

/** DELETE /api/delete — remove a pulled model. */
export async function deleteModel(modelId: string, host = DEFAULT_OLLAMA_HOST): Promise<void> {
  const fetcher = getOllamaFetch();
  const r = await fetcher(`${host}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelId }),
  });
  if (!r.ok && r.status !== 404) {
    const body = await r.text().catch(() => "");
    throw new Error(`/api/delete returned ${r.status}: ${body}`);
  }
}
