import { invoke } from "@tauri-apps/api/core";
import { embedQuery } from "./semantic-index";
import { useChatStore } from "../stores/chat";
import { log, withError } from "./logger";

export interface Memory {
  id: string;
  text: string;
  category: string; // 'fact' | 'contact' | 'preference' | 'task'
  scope?: "global" | "project";
  workspace_path?: string | null;
  source_conversation_id?: string | null;
  source_message_ids?: string[];
  source_excerpt?: string | null;
  auto_extracted?: boolean;
  confidence?: number | null;
  uses: number;
  created_at: number;
  updated_at?: number | null;
}

export interface MemorySearchHit extends Memory {
  score: number;
}

export interface MemoryWriteOptions {
  id?: string;
  scope?: "global" | "project";
  workspacePath?: string | null;
  sourceConversationId?: string;
  sourceMessageIds?: string[];
  sourceExcerpt?: string;
  autoExtracted?: boolean;
  confidence?: number;
}

const MEMORY_JOURNAL_PREFIX = "goatllm-memory:";
const MEMORY_DELETED_PREFIX = "goatllm-memory-deleted:";

function safeWriteMemory(memory: Memory) {
  try {
    localStorage.setItem(MEMORY_JOURNAL_PREFIX + memory.id, JSON.stringify(memory));
    localStorage.removeItem(MEMORY_DELETED_PREFIX + memory.id);
  } catch {
    // SQLite mirror remains best effort if localStorage quota is exhausted.
  }
}

function safeDeleteMemory(id: string) {
  try {
    localStorage.removeItem(MEMORY_JOURNAL_PREFIX + id);
    localStorage.setItem(MEMORY_DELETED_PREFIX + id, "1");
  } catch {
    // ignore
  }
}

function readMemoryJournal(): { memories: Memory[]; deletedIds: Set<string> } {
  const memories: Memory[] = [];
  const deletedIds = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(MEMORY_DELETED_PREFIX)) {
        deletedIds.add(key.slice(MEMORY_DELETED_PREFIX.length));
        continue;
      }
      if (!key.startsWith(MEMORY_JOURNAL_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      memories.push(JSON.parse(raw) as Memory);
    }
  } catch {
    // Corrupt journal entries are ignored.
  }
  return { memories, deletedIds };
}

function mergeMemories(sqlite: Memory[], journal: Memory[], deletedIds: Set<string>): Memory[] {
  const byId = new Map<string, Memory>();
  for (const memory of sqlite) {
    if (!deletedIds.has(memory.id)) byId.set(memory.id, memory);
  }
  for (const memory of journal) {
    if (!deletedIds.has(memory.id)) byId.set(memory.id, { ...byId.get(memory.id), ...memory });
  }
  return Array.from(byId.values()).sort((a, b) => (b.updated_at ?? b.created_at) - (a.updated_at ?? a.created_at));
}

/**
 * Add a new memory. Generates embedding if Ollama is running and configured.
 */
export async function addMemory(text: string, category = "fact", options: MemoryWriteOptions = {}): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText) return;

  const id = options.id ?? crypto.randomUUID();
  const store = useChatStore.getState();
  const ollamaUrl = store.ollamaUrl || "http://localhost:11434";
  const embeddingModel = store.embeddingModel || "nomic-embed-text";

  let embedding: number[] | null = null;
  let model: string | null = null;

  try {
    // Attempt to generate semantic embedding
    embedding = await embedQuery(cleanText, { url: ollamaUrl, model: embeddingModel });
    model = embeddingModel;
  } catch (e) {
    log.warn("Could not generate memory embedding (Ollama offline?), saving text-only memory", withError("memory", undefined, e));
  }

  const now = Math.floor(Date.now() / 1000);
  safeWriteMemory({
    id,
    text: cleanText,
    category,
    scope: options.scope ?? "global",
    workspace_path: options.workspacePath ?? null,
    source_conversation_id: options.sourceConversationId ?? null,
    source_message_ids: options.sourceMessageIds ?? [],
    source_excerpt: options.sourceExcerpt ?? null,
    auto_extracted: options.autoExtracted ?? false,
    confidence: options.confidence ?? null,
    uses: 0,
    created_at: now,
    updated_at: now,
  });

  await invoke("memory_insert", {
    id,
    text: cleanText,
    category,
    embedding,
    model,
    scope: options.scope ?? "global",
    workspacePath: options.workspacePath ?? null,
    sourceConversationId: options.sourceConversationId ?? null,
    sourceMessageIds: options.sourceMessageIds ?? [],
    sourceExcerpt: options.sourceExcerpt ?? null,
    autoExtracted: options.autoExtracted ?? false,
    confidence: options.confidence ?? null,
  });
}

export async function updateMemory(
  id: string,
  updates: Pick<Memory, "text" | "category"> & { scope?: "global" | "project"; workspacePath?: string | null },
): Promise<void> {
  const cleanText = updates.text.trim();
  if (!cleanText) return;

  const store = useChatStore.getState();
  const ollamaUrl = store.ollamaUrl || "http://localhost:11434";
  const embeddingModel = store.embeddingModel || "nomic-embed-text";

  let embedding: number[] | null = null;
  let model: string | null = null;
  try {
    embedding = await embedQuery(cleanText, { url: ollamaUrl, model: embeddingModel });
    model = embeddingModel;
  } catch (e) {
    log.warn("Could not regenerate memory embedding, saving text-only update", withError("memory", undefined, e));
  }

  const existing = (await listMemories().catch(() => [])).find((memory) => memory.id === id);
  const now = Math.floor(Date.now() / 1000);
  safeWriteMemory({
    ...(existing ?? {
      id,
      uses: 0,
      created_at: now,
    }),
    text: cleanText,
    category: updates.category,
    scope: updates.scope ?? existing?.scope ?? "global",
    workspace_path: updates.workspacePath ?? existing?.workspace_path ?? null,
    updated_at: now,
  });

  await invoke("memory_update", {
    id,
    text: cleanText,
    category: updates.category,
    scope: updates.scope ?? existing?.scope ?? "global",
    workspacePath: updates.workspacePath ?? existing?.workspace_path ?? null,
    embedding,
    model,
  });
}

/**
 * List memories, optionally filtering by category.
 */
export async function listMemories(category?: string): Promise<Memory[]> {
  const journal = readMemoryJournal();
  try {
    const sqlite = await invoke<Memory[]>("memory_list", { category: category || null });
    return mergeMemories(sqlite, journal.memories, journal.deletedIds)
      .filter((memory) => !category || memory.category === category);
  } catch {
    return mergeMemories([], journal.memories, journal.deletedIds)
      .filter((memory) => !category || memory.category === category);
  }
}

/**
 * Delete a memory by id.
 */
export async function deleteMemory(id: string): Promise<void> {
  safeDeleteMemory(id);
  await invoke("memory_delete", { id });
}

/**
 * Search memories using hybrid search: semantic cosine similarity if Ollama is up,
 * falling back to SQL substring match.
 */
export async function searchMemories(query: string, limit = 8): Promise<MemorySearchHit[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const store = useChatStore.getState();
  const ollamaUrl = store.ollamaUrl || "http://localhost:11434";
  const embeddingModel = store.embeddingModel || "nomic-embed-text";

  try {
    // 1. Try semantic embedding search
    const queryEmbedding = await embedQuery(cleanQuery, { url: ollamaUrl, model: embeddingModel });
    const hits = await invoke<MemorySearchHit[]>("memory_search", {
      queryEmbedding,
      limit,
    });
    
    // Fallback to text search if no semantic results returned
    if (hits.length === 0) {
      return invoke<MemorySearchHit[]>("memory_search_text", { query: cleanQuery, limit });
    }
    return hits;
  } catch (e) {
    // 2. Fallback to SQL text search
    log.debug("Semantic memory search failed, falling back to substring search", withError("memory", undefined, e));
    return invoke<MemorySearchHit[]>("memory_search_text", { query: cleanQuery, limit });
  }
}

/**
 * Increment the uses counter of a memory.
 */
export async function incrementMemoryUses(id: string): Promise<void> {
  await invoke("memory_increment_uses", { id });
}
