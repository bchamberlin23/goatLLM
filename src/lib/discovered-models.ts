/** Durable cache for models returned by provider discovery endpoints. */

export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
  vision?: boolean;
}

export type DiscoveredModels = Record<string, DiscoveredModel[]>;

const DISCOVERED_MODELS_KEY = "goatllm-discovered-models";

function sanitizeModels(raw: unknown): DiscoveredModels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([providerId, models]) => providerId.trim().length > 0 && Array.isArray(models))
      .map(([providerId, models]) => [
        providerId,
        (Array.isArray(models) ? models : []).flatMap((model): DiscoveredModel[] => {
          if (!model || typeof model !== "object") return [];
          const value = model as Record<string, unknown>;
          if (typeof value.id !== "string" || typeof value.name !== "string") return [];
          return [{
            id: value.id,
            name: value.name,
            ...(typeof value.contextWindow === "number" ? { contextWindow: value.contextWindow } : {}),
            ...(typeof value.vision === "boolean" ? { vision: value.vision } : {}),
          }];
        }),
      ]),
  );
}

function writeJournal(models: DiscoveredModels) {
  try { localStorage.setItem(DISCOVERED_MODELS_KEY, JSON.stringify(models)); } catch { /* SQLite is the fallback. */ }
}

async function getInvoke() {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke;
}

export function loadDiscoveredModelsFromJournal(): DiscoveredModels {
  try { return sanitizeModels(JSON.parse(localStorage.getItem(DISCOVERED_MODELS_KEY) || "{}")); } catch { return {}; }
}

export async function loadDiscoveredModels(): Promise<DiscoveredModels> {
  const journal = loadDiscoveredModelsFromJournal();
  try {
    const invoke = await getInvoke();
    const sqlite = sanitizeModels(await invoke<unknown>("discovered_models_load"));
    const merged = { ...sqlite, ...journal };
    writeJournal(merged);
    return merged;
  } catch {
    return journal;
  }
}

export function persistDiscoveredModels(models: DiscoveredModels): void {
  const safe = sanitizeModels(models);
  writeJournal(safe);
  void (async () => {
    try {
      const invoke = await getInvoke();
      await invoke("discovered_models_save", { models: safe });
    } catch { /* The journal already contains the latest result. */ }
  })();
}
