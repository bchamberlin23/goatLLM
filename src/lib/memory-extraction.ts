import type { Memory } from "./memory";

export type MemoryScope = "global" | "project";
export type MemoryCategory = "fact" | "contact" | "preference" | "task" | "project";

export interface MemoryExtractionSettings {
  enabled: boolean;
  globalScope: boolean;
  projectScope: boolean;
  maxCandidatesPerTurn: number;
}

export interface MemoryCandidate {
  text: string;
  category: MemoryCategory;
  scope: MemoryScope;
  workspacePath?: string | null;
  sourceConversationId?: string;
  sourceMessageIds?: string[];
  sourceExcerpt?: string;
  confidence: number;
}

export interface ExtractMemoryInput {
  userText: string;
  assistantText?: string;
  workspacePath?: string | null;
  settings: MemoryExtractionSettings;
  conversationId?: string;
  sourceMessageIds?: string[];
}

export const DEFAULT_MEMORY_EXTRACTION_SETTINGS: MemoryExtractionSettings = {
  enabled: false,
  globalScope: true,
  projectScope: true,
  maxCandidatesPerTurn: 3,
};

const MEMORY_EXTRACTION_SETTINGS_KEY = "goatllm-memory-extraction-settings";

let _invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

async function getInvoke() {
  if (_invoke) return _invoke;
  const mod = await import("@tauri-apps/api/core");
  _invoke = mod.invoke;
  return _invoke;
}

export function sanitizeMemoryExtractionSettings(raw: unknown): MemoryExtractionSettings {
  const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : DEFAULT_MEMORY_EXTRACTION_SETTINGS.enabled,
    globalScope: typeof row.globalScope === "boolean" ? row.globalScope : DEFAULT_MEMORY_EXTRACTION_SETTINGS.globalScope,
    projectScope: typeof row.projectScope === "boolean" ? row.projectScope : DEFAULT_MEMORY_EXTRACTION_SETTINGS.projectScope,
    maxCandidatesPerTurn: Math.min(
      8,
      Math.max(1, typeof row.maxCandidatesPerTurn === "number" ? Math.floor(row.maxCandidatesPerTurn) : DEFAULT_MEMORY_EXTRACTION_SETTINGS.maxCandidatesPerTurn),
    ),
  };
}

export function loadMemoryExtractionSettingsFromJournal(): MemoryExtractionSettings {
  try {
    const raw = localStorage.getItem(MEMORY_EXTRACTION_SETTINGS_KEY);
    return sanitizeMemoryExtractionSettings(raw ? JSON.parse(raw) : undefined);
  } catch {
    return { ...DEFAULT_MEMORY_EXTRACTION_SETTINGS };
  }
}

export async function loadMemoryExtractionSettings(): Promise<MemoryExtractionSettings> {
  const local = loadMemoryExtractionSettingsFromJournal();
  try {
    const invoke = await getInvoke();
    const sqlite = await invoke<MemoryExtractionSettings | null>("memory_settings_load", {
      key: MEMORY_EXTRACTION_SETTINGS_KEY,
    });
    const merged = sanitizeMemoryExtractionSettings(sqlite ?? local);
    persistMemoryExtractionSettings(merged);
    return merged;
  } catch {
    return local;
  }
}

export function persistMemoryExtractionSettings(settings: MemoryExtractionSettings) {
  const safe = sanitizeMemoryExtractionSettings(settings);
  try {
    localStorage.setItem(MEMORY_EXTRACTION_SETTINGS_KEY, JSON.stringify(safe));
  } catch {
    // SQLite mirror is best effort.
  }
  void (async () => {
    try {
      const invoke = await getInvoke();
      await invoke("memory_settings_save", {
        key: MEMORY_EXTRACTION_SETTINGS_KEY,
        value: JSON.stringify(safe),
      });
    } catch {
      // The local journal was already written synchronously.
    }
  })();
}

export function normalizeMemoryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCandidates(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function cleanFact(text: string): string {
  return text
    .trim()
    .replace(/^(please\s+)?remember\s+(that\s+)?/i, "")
    .replace(/^(note\s+that|keep\s+in\s+mind\s+that)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:\-\s]+/, "")
    .replace(/[;,\s]+$/, ".")
    .replace(/\.{2,}$/g, ".");
}

function isUncertain(text: string): boolean {
  return /\b(maybe|might|possibly|probably|not sure|i think|tentative|could switch|later)\b/i.test(text);
}

function isSecretLike(text: string): boolean {
  return /\b(api[_ -]?key|token|password|secret|private key|bearer|sk-[a-z0-9])/i.test(text);
}

function pushCandidate(
  candidates: MemoryCandidate[],
  input: ExtractMemoryInput,
  partial: Omit<MemoryCandidate, "sourceConversationId" | "sourceMessageIds" | "sourceExcerpt" | "confidence"> & { confidence?: number },
  source: string,
) {
  if (!partial.text || partial.text.length < 12 || partial.text.length > 240) return;
  if (isUncertain(source) || isSecretLike(source)) return;
  if (partial.scope === "global" && !input.settings.globalScope) return;
  if (partial.scope === "project" && (!input.settings.projectScope || !input.workspacePath)) return;
  candidates.push({
    ...partial,
    workspacePath: partial.scope === "project" ? input.workspacePath : undefined,
    sourceConversationId: input.conversationId,
    sourceMessageIds: input.sourceMessageIds ?? [],
    sourceExcerpt: source.slice(0, 360),
    confidence: partial.confidence ?? 0.78,
  });
}

export function extractMemoryCandidates(input: ExtractMemoryInput): MemoryCandidate[] {
  const settings = sanitizeMemoryExtractionSettings(input.settings);
  if (!settings.enabled) return [];
  const candidates: MemoryCandidate[] = [];

  for (const sentence of sentenceCandidates(input.userText)) {
    const explicit = sentence.match(/\b(?:please\s+)?remember\s+(?:that\s+)?(.+)/i);
    if (explicit?.[1]) {
      const text = cleanFact(explicit[1]);
      const projectish = /\b(this project|this repo|this workspace|for this project|in this repo|we use|the repo uses)\b/i.test(text);
      pushCandidate(candidates, input, {
        text,
        category: projectish ? "project" : inferCategory(text),
        scope: projectish ? "project" : "global",
        confidence: 0.9,
      }, sentence);
      continue;
    }

    const project = sentence.match(/\b(?:for|in)\s+this\s+(?:project|repo|workspace),?\s+(.+)/i);
    if (project?.[1]) {
      const text = `This project ${project[1].replace(/^we\s+use\b/i, "uses").replace(/^we\s+/i, "").trim()}`;
      pushCandidate(candidates, input, {
        text: cleanFact(text),
        category: "project",
        scope: "project",
        confidence: 0.84,
      }, sentence);
      continue;
    }

    const prefer = sentence.match(/\b(i\s+(?:prefer|like|use|usually use|work in|write)|call me|my name is)\s+(.+)/i);
    if (prefer?.[0]) {
      pushCandidate(candidates, input, {
        text: cleanFact(sentence),
        category: inferCategory(sentence),
        scope: "global",
        confidence: 0.8,
      }, sentence);
    }
  }

  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = `${candidate.scope}:${normalizeMemoryText(candidate.text)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, settings.maxCandidatesPerTurn);
}

function inferCategory(text: string): MemoryCategory {
  if (/\b(prefer|like|usually|call me|my name is)\b/i.test(text)) return "preference";
  if (/\b(todo|remind me|follow up|need to)\b/i.test(text)) return "task";
  if (/\b(email|phone|contact|@)\b/i.test(text)) return "contact";
  if (/\b(project|repo|workspace|pnpm|vite|typescript|rust|tauri)\b/i.test(text)) return "project";
  return "fact";
}

function sameMemory(candidate: MemoryCandidate, memory: Memory): boolean {
  if (memory.scope && candidate.scope !== memory.scope) return false;
  if (candidate.scope === "project" && memory.workspace_path && candidate.workspacePath !== memory.workspace_path) return false;
  const a = normalizeMemoryText(candidate.text);
  const b = normalizeMemoryText(memory.text);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function dedupeMemoryCandidates(candidates: MemoryCandidate[], memories: Memory[]): MemoryCandidate[] {
  return candidates.filter((candidate) => !memories.some((memory) => sameMemory(candidate, memory)));
}

export function buildMemoryProvenance(
  memory: Pick<Memory, "scope" | "workspace_path" | "source_conversation_id" | "source_message_ids"> & {
    workspacePath?: string | null;
    sourceConversationId?: string;
    sourceMessageIds?: string[];
  },
): string {
  const parts: string[] = [];
  if (memory.scope === "project") {
    const path = memory.workspace_path ?? memory.workspacePath;
    const workspace = path?.split(/[\\/]/).filter(Boolean).pop();
    parts.push(workspace ? `Project ${workspace}` : "Project");
  } else {
    parts.push("Global");
  }
  const conversationId = memory.source_conversation_id ?? memory.sourceConversationId;
  if (conversationId) parts.push(conversationId);
  const count = (memory.source_message_ids ?? memory.sourceMessageIds)?.length ?? 0;
  if (count > 0) parts.push(`${count} message${count === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export async function extractAndPersistTurnMemories(input: ExtractMemoryInput): Promise<MemoryCandidate[]> {
  const { addMemory, listMemories } = await import("./memory");
  const candidates = extractMemoryCandidates(input);
  if (candidates.length === 0) return [];
  const existing = await listMemories().catch(() => [] as Memory[]);
  const fresh = dedupeMemoryCandidates(candidates, existing);
  for (const candidate of fresh) {
    await addMemory(candidate.text, candidate.category, {
      scope: candidate.scope,
      workspacePath: candidate.workspacePath,
      sourceConversationId: candidate.sourceConversationId,
      sourceMessageIds: candidate.sourceMessageIds,
      sourceExcerpt: candidate.sourceExcerpt,
      autoExtracted: true,
      confidence: candidate.confidence,
    });
  }
  return fresh;
}
