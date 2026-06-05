import { invoke } from "@tauri-apps/api/core";
import { embedQuery } from "./semantic-index";
import { useChatStore } from "../stores/chat";
import { log, withError } from "./logger";

export interface Memory {
  id: string;
  text: string;
  category: string; // 'fact' | 'contact' | 'preference' | 'task'
  uses: number;
  created_at: number;
}

export interface MemorySearchHit extends Memory {
  score: number;
}

/**
 * Add a new memory. Generates embedding if Ollama is running and configured.
 */
export async function addMemory(text: string, category = "fact"): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText) return;

  const id = crypto.randomUUID();
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

  await invoke("memory_insert", {
    id,
    text: cleanText,
    category,
    embedding,
    model,
  });
}

/**
 * List memories, optionally filtering by category.
 */
export async function listMemories(category?: string): Promise<Memory[]> {
  return invoke<Memory[]>("memory_list", { category: category || null });
}

/**
 * Delete a memory by id.
 */
export async function deleteMemory(id: string): Promise<void> {
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
