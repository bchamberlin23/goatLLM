import { getContextWindow } from "./context-window";

export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
  vision?: boolean;
}

type ModelLike = Record<string, unknown>;

const CONTEXT_KEYS = [
  "contextWindow",
  "context_window",
  "contextLength",
  "context_length",
  "max_context_length",
  "loaded_context_length",
  "max_input_tokens",
  "max_sequence_length",
  "max_model_len",
  "n_ctx",
  "num_ctx",
] as const;

const NESTED_KEYS = [
  "metadata",
  "meta",
  "details",
  "extra",
  "extras",
  "capabilities",
  "parameters",
  "model_info",
] as const;

function positiveNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function findContextWindow(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as ModelLike;
  for (const key of CONTEXT_KEYS) {
    const direct = positiveNumber(obj[key]);
    if (direct) return direct;
  }
  for (const key of Object.keys(obj)) {
    if (key.endsWith(".context_length") || key.endsWith(".contextWindow")) {
      const nested = positiveNumber(obj[key]);
      if (nested) return nested;
    }
  }
  for (const key of NESTED_KEYS) {
    const nested = findContextWindow(obj[key]);
    if (nested) return nested;
  }
  return undefined;
}

function arrayIncludesCapability(value: unknown, match: RegExp): boolean {
  return Array.isArray(value) && value.some((item) => match.test(String(item).toLowerCase()));
}

function findVisionCapability(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as ModelLike;
  if (typeof obj.vision === "boolean") return obj.vision;
  if (typeof obj.supports_vision === "boolean") return obj.supports_vision;
  if (typeof obj.multimodal === "boolean") return obj.multimodal;
  if (arrayIncludesCapability(obj.modalities, /vision|image|multimodal/)) return true;
  if (arrayIncludesCapability(obj.input_modalities, /vision|image|multimodal/)) return true;
  if (arrayIncludesCapability(obj.capabilities, /vision|image|multimodal/)) return true;
  for (const key of NESTED_KEYS) {
    const nested = findVisionCapability(obj[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function idFromItem(item: ModelLike): string {
  return String(item.id ?? item.name ?? item.model ?? "").trim();
}

function humanNameFromItem(item: ModelLike, id: string): string {
  return String(item.display_name ?? item.displayName ?? item.name ?? id).trim() || id;
}

function modelItemsFromBody(body: unknown): ModelLike[] {
  if (Array.isArray(body)) return body.filter((item): item is ModelLike => !!item && typeof item === "object");
  if (!body || typeof body !== "object") return [];
  const obj = body as ModelLike;
  const source = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.models)
      ? obj.models
      : Array.isArray(obj.items)
        ? obj.items
        : [];
  return source.filter((item): item is ModelLike => !!item && typeof item === "object");
}

export function normalizeProviderModels(providerId: string, body: unknown): DiscoveredModel[] {
  return modelItemsFromBody(body)
    .map((item) => {
      const id = idFromItem(item);
      if (!id) return null;
      const exactContext = findContextWindow(item);
      const detectedContext = exactContext ?? getContextWindow(providerId, id);
      const contextWindow = detectedContext > 0 ? detectedContext : undefined;
      const vision = findVisionCapability(item) ?? inferVisionFromModelId(id);
      return {
        id,
        name: humanNameFromItem(item, id),
        ...(contextWindow ? { contextWindow } : {}),
        ...(vision !== undefined ? { vision } : {}),
      };
    })
    .filter((model): model is DiscoveredModel => model !== null);
}

export function contextWindowFromOllamaShow(body: unknown): number | undefined {
  const structured = findContextWindow(body);
  if (structured) return structured;
  const parameters =
    body && typeof body === "object" && typeof (body as ModelLike).parameters === "string"
      ? (body as { parameters: string }).parameters
      : null;
  if (parameters) {
    const match = parameters.match(/(?:num_ctx|context_length)\s+(\d+)/);
    const parsed = match ? positiveNumber(match[1]) : undefined;
    if (parsed) return parsed;
  }
  return undefined;
}

function inferVisionFromModelId(modelId: string): boolean | undefined {
  const name = modelId.toLowerCase();
  if (/\b(?:llava|bakllava|moondream|qwen2(?:\.5)?-vl|qwen-vl|vision|pixtral|gemma3)\b/.test(name)) {
    return true;
  }
  return undefined;
}
