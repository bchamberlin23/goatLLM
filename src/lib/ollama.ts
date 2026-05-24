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
  {
    id: "llama3.2:3b",
    name: "Llama 3.2 3B",
    blurb: "Tiny and quick. Great default for any laptop.",
    sizeGb: 2.0,
    ramGb: 4,
    params: "3B",
    use: "chat",
    order: 1,
  },
  {
    id: "llama3.2:1b",
    name: "Llama 3.2 1B",
    blurb: "Smallest viable chat model. Fits on anything.",
    sizeGb: 1.3,
    ramGb: 2,
    params: "1B",
    use: "chat",
    order: 0,
  },
  {
    id: "qwen2.5-coder:7b",
    name: "Qwen 2.5 Coder 7B",
    blurb: "Coding-tuned. Strong tool use for the agent.",
    sizeGb: 4.7,
    ramGb: 8,
    params: "7B",
    use: "coding",
    order: 2,
  },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 8B",
    blurb: "Balanced general-purpose chat.",
    sizeGb: 4.7,
    ramGb: 8,
    params: "8B",
    use: "chat",
    order: 3,
  },
  {
    id: "gemma3:4b",
    name: "Gemma 3 4B",
    blurb: "Google's small open model. Multilingual.",
    sizeGb: 3.3,
    ramGb: 6,
    params: "4B",
    use: "chat",
    order: 4,
  },
  {
    id: "qwen2.5:14b",
    name: "Qwen 2.5 14B",
    blurb: "Heavier reasoning. Needs 16GB+ free.",
    sizeGb: 9.0,
    ramGb: 16,
    params: "14B",
    use: "chat",
    order: 5,
  },
  {
    id: "llava:7b",
    name: "LLaVA 7B",
    blurb: "Multimodal — pass images in chat.",
    sizeGb: 4.7,
    ramGb: 8,
    params: "7B",
    use: "vision",
    order: 6,
  },
  {
    id: "nomic-embed-text",
    name: "Nomic Embed Text",
    blurb: "Embedding model. Required for semantic search.",
    sizeGb: 0.3,
    ramGb: 1,
    params: "137M",
    use: "embedding",
    order: 7,
  },
];

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
