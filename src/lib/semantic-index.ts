/**
 * Local semantic index over the active workspace.
 *
 * Architecture:
 *   chunks (Rust walkdir) → embeddings (Ollama HTTP) → SQLite BLOBs (Rust)
 *                                                              ↓
 *                                          search_semantic ← cosine in-memory (Rust)
 *
 * Embeddings live in TS because we already have Tauri-routed fetch via
 * fetch-adapter; spinning up a Rust HTTP client just for Ollama is mass for
 * no benefit.
 *
 * Failure mode policy: if Ollama is unreachable, we fail loudly with an
 * install hint. Never silently fall back to regex — the model would think
 * semantic search worked and return wrong results.
 */

import { getFetch } from "./fetch-adapter";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_TOP_K = 8;
/** Ollama embedding endpoint accepts multiple inputs but performance is
 *  comparable to one-by-one and the error surface is simpler. */
const BATCH_CONCURRENCY = 4;

export interface Chunk {
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
}

export interface EmbeddingRow {
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  embedding: number[];
}

export interface SearchHit {
  file: string;
  start_line: number;
  end_line: number;
  content: string;
  score: number;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function embedQuery(
  text: string,
  opts: { url?: string; model?: string } = {},
): Promise<number[]> {
  const url = opts.url ?? DEFAULT_OLLAMA_URL;
  const model = opts.model ?? DEFAULT_MODEL;
  const customFetch = getFetch() ?? globalThis.fetch.bind(globalThis);

  let resp: Response;
  try {
    resp = await customFetch(`${url}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
  } catch (e) {
    throw new Error(
      `Cannot reach Ollama at ${url}. Install Ollama (https://ollama.com), then run:\n  ollama pull ${model}\n\nDetails: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    if (resp.status === 404 || body.includes("not found")) {
      throw new Error(
        `Ollama model '${model}' not pulled. Run:\n  ollama pull ${model}`,
      );
    }
    throw new Error(`Ollama error ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { embedding?: number[] };
  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new Error("Ollama returned no embedding");
  }
  return data.embedding;
}

async function embedBatch(
  texts: string[],
  opts: { url?: string; model?: string },
): Promise<number[][]> {
  // Run in batches of BATCH_CONCURRENCY to avoid overwhelming the local model.
  const out: number[][] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += BATCH_CONCURRENCY) {
    const slice = texts.slice(i, i + BATCH_CONCURRENCY);
    const vecs = await Promise.all(slice.map((t) => embedQuery(t, opts)));
    for (let j = 0; j < vecs.length; j++) out[i + j] = vecs[j];
  }
  return out;
}

export interface IndexProgress {
  total: number;
  done: number;
  current?: string;
}

export interface IndexOptions {
  workspace: string;
  ollamaUrl?: string;
  model?: string;
  onProgress?: (p: IndexProgress) => void;
}

export interface IndexResult {
  chunksTotal: number;
  chunksIndexed: number;
  durationMs: number;
}

export async function indexWorkspace(opts: IndexOptions): Promise<IndexResult> {
  const start = Date.now();

  const chunks = await tauriInvoke<Chunk[]>("workspace_chunks", {
    workspace: opts.workspace,
  });

  if (chunks.length === 0) {
    return { chunksTotal: 0, chunksIndexed: 0, durationMs: Date.now() - start };
  }

  // Wipe existing index for this workspace so reindex is idempotent.
  await tauriInvoke<void>("embeddings_clear", { workspace: opts.workspace });

  // Embed in batches. Persist after every batch so a crash mid-index doesn't
  // lose all progress.
  const BATCH_SIZE = 16;
  let indexed = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const slice = chunks.slice(i, i + BATCH_SIZE);
    const texts = slice.map((c) => c.content);
    const vecs = await embedBatch(texts, {
      url: opts.ollamaUrl,
      model: opts.model,
    });
    const rows: EmbeddingRow[] = slice.map((c, j) => ({
      file_path: c.file_path,
      start_line: c.start_line,
      end_line: c.end_line,
      content: c.content,
      embedding: vecs[j],
    }));
    await tauriInvoke<number>("embeddings_insert", {
      workspace: opts.workspace,
      rows,
      model: opts.model ?? DEFAULT_MODEL,
    });
    indexed += rows.length;
    opts.onProgress?.({
      total: chunks.length,
      done: indexed,
      current: slice[slice.length - 1]?.file_path,
    });
  }

  return {
    chunksTotal: chunks.length,
    chunksIndexed: indexed,
    durationMs: Date.now() - start,
  };
}

export async function searchSemantic(
  workspace: string,
  query: string,
  opts: { topK?: number; ollamaUrl?: string; model?: string } = {},
): Promise<SearchHit[]> {
  const queryEmbedding = await embedQuery(query, {
    url: opts.ollamaUrl,
    model: opts.model,
  });
  return tauriInvoke<SearchHit[]>("embeddings_search", {
    workspace,
    queryEmbedding,
    topK: opts.topK ?? DEFAULT_TOP_K,
  });
}

export async function indexCount(workspace: string): Promise<number> {
  return tauriInvoke<number>("embeddings_count", { workspace });
}
