export type KnowledgeSourceKind = "upload" | "workspace-file" | "url" | "meeting" | "note";

export interface KnowledgeSource {
  kind: KnowledgeSourceKind;
  label: string;
  uri?: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
}

export type KnowledgeDocumentStatus = "ready" | "embedding" | "embedded" | "syncing" | "error";

export interface KnowledgeDocument {
  id: string;
  workspaceId: string;
  title: string;
  filename: string;
  mimeType: string;
  source: KnowledgeSource;
  text: string;
  characters: number;
  status: KnowledgeDocumentStatus;
  embedded: boolean;
  pinned: boolean;
  chunkCount?: number;
  embeddingModel?: string;
  lastEmbeddedAt?: number;
  lastSyncedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentWorkspace {
  id: string;
  name: string;
  workspacePath: string | null;
  documents: KnowledgeDocument[];
  createdAt: number;
  updatedAt: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface RetrievalHit {
  id: string;
  documentId: string;
  title: string;
  content: string;
  score: number;
  pinned: boolean;
  updatedAt: number;
  source: KnowledgeSource;
}

export interface RetrievalPreviewHit extends RetrievalHit {
  provenance?: string;
}

const DOCUMENT_WORKSPACES_KEY = "goatllm-document-workspaces";

let _invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

async function getInvoke() {
  if (_invoke) return _invoke;
  const mod = await import("@tauri-apps/api/core");
  _invoke = mod.invoke;
  return _invoke;
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cleanTitle(title: string, fallback: string): string {
  const clean = title.trim().replace(/\s+/g, " ");
  return clean || fallback;
}

export function createDocumentWorkspace(
  name: string,
  workspacePath: string | null = null,
  now = Date.now(),
): DocumentWorkspace {
  return {
    id: makeId("kb"),
    name: cleanTitle(name, "Knowledge workspace"),
    workspacePath: workspacePath || null,
    documents: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createKnowledgeDocument(input: {
  workspaceId: string;
  title: string;
  filename: string;
  mimeType: string;
  text: string;
  source: KnowledgeSource;
  now?: number;
}): KnowledgeDocument {
  const now = input.now ?? Date.now();
  const text = input.text ?? "";
  return {
    id: makeId("doc"),
    workspaceId: input.workspaceId,
    title: cleanTitle(input.title, input.filename || "Untitled document"),
    filename: input.filename || "document.txt",
    mimeType: input.mimeType || "text/plain",
    source: input.source,
    text,
    characters: text.length,
    status: "ready",
    embedded: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function setDocumentPinned(
  document: KnowledgeDocument,
  pinned: boolean,
  now = Date.now(),
): KnowledgeDocument {
  return { ...document, pinned, updatedAt: now };
}

export function setDocumentEmbedded(
  document: KnowledgeDocument,
  updates: {
    embedded: boolean;
    status: KnowledgeDocumentStatus;
    chunkCount?: number;
    embeddingModel?: string;
    now?: number;
    error?: string;
  },
): KnowledgeDocument {
  const now = updates.now ?? Date.now();
  return {
    ...document,
    embedded: updates.embedded,
    status: updates.status,
    chunkCount: updates.chunkCount ?? document.chunkCount,
    embeddingModel: updates.embeddingModel ?? document.embeddingModel,
    lastEmbeddedAt: updates.embedded ? now : document.lastEmbeddedAt,
    lastError: updates.error,
    updatedAt: now,
  };
}

export function chunkDocumentText(input: {
  documentId: string;
  text: string;
  maxLines?: number;
  overlapLines?: number;
}): DocumentChunk[] {
  const maxLines = Math.max(1, input.maxLines ?? 80);
  const overlapLines = Math.max(0, Math.min(input.overlapLines ?? 20, maxLines - 1));
  const lines = input.text.split(/\r?\n/);
  const chunks: DocumentChunk[] = [];
  let start = 0;

  while (start < lines.length) {
    const end = Math.min(lines.length, start + maxLines);
    const content = lines.slice(start, end).join("\n").trim();
    if (content) {
      chunks.push({
        id: `${input.documentId}:${start + 1}-${end}`,
        documentId: input.documentId,
        startLine: start + 1,
        endLine: end,
        content,
      });
    }
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - overlapLines);
  }

  return chunks;
}

export function formatSourceProvenance(source: KnowledgeSource): string {
  const location =
    source.page !== undefined
      ? ` p.${source.page}`
      : source.lineStart !== undefined
        ? ` L${source.lineStart}${source.lineEnd ? `-${source.lineEnd}` : ""}`
        : "";
  return `${source.kind}: ${source.label}${location}`;
}

export function buildDocumentRetrievalPreview(
  hits: RetrievalHit[],
  options: { limit?: number; includeProvenance?: boolean } = {},
): RetrievalPreviewHit[] {
  const limit = Math.max(1, options.limit ?? 8);
  return hits
    .slice()
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, limit)
    .map((hit) => ({
      ...hit,
      provenance: options.includeProvenance ? formatSourceProvenance(hit.source) : undefined,
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function sanitizeSource(source: unknown, fallbackLabel: string): KnowledgeSource {
  if (!isRecord(source)) return { kind: "upload", label: fallbackLabel };
  const kind = source.kind;
  const validKind: KnowledgeSourceKind =
    kind === "workspace-file" || kind === "url" || kind === "meeting" || kind === "note" ? kind : "upload";
  return {
    kind: validKind,
    label: typeof source.label === "string" && source.label.trim() ? source.label : fallbackLabel,
    uri: typeof source.uri === "string" ? source.uri : undefined,
    page: typeof source.page === "number" ? source.page : undefined,
    lineStart: typeof source.lineStart === "number" ? source.lineStart : undefined,
    lineEnd: typeof source.lineEnd === "number" ? source.lineEnd : undefined,
  };
}

function sanitizeDocument(raw: unknown, workspaceId: string): KnowledgeDocument | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const filename = typeof raw.filename === "string" && raw.filename.trim() ? raw.filename : "document.txt";
  const status = raw.status;
  const runtimeInterrupted = status === "embedding" || status === "syncing";
  const safeStatus: KnowledgeDocumentStatus =
    runtimeInterrupted
      ? "error"
      : status === "ready" || status === "embedded" || status === "error"
        ? status
        : "ready";
  const text = typeof raw.text === "string" ? raw.text : "";
  return {
    id: raw.id,
    workspaceId,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : filename,
    filename,
    mimeType: typeof raw.mimeType === "string" ? raw.mimeType : "text/plain",
    source: sanitizeSource(raw.source, filename),
    text,
    characters: typeof raw.characters === "number" ? raw.characters : text.length,
    status: safeStatus,
    embedded: Boolean(raw.embedded) && safeStatus === "embedded",
    pinned: Boolean(raw.pinned),
    chunkCount: typeof raw.chunkCount === "number" ? raw.chunkCount : undefined,
    embeddingModel: typeof raw.embeddingModel === "string" ? raw.embeddingModel : undefined,
    lastEmbeddedAt: typeof raw.lastEmbeddedAt === "number" ? raw.lastEmbeddedAt : undefined,
    lastSyncedAt: typeof raw.lastSyncedAt === "number" ? raw.lastSyncedAt : undefined,
    lastError: runtimeInterrupted
      ? status === "syncing" ? "Sync interrupted." : "Embedding interrupted."
      : typeof raw.lastError === "string" ? raw.lastError : undefined,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

export function sanitizeDocumentWorkspaces(raw: unknown): DocumentWorkspace[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === "string")
    .map((item) => {
      const id = item.id as string;
      return {
        id,
        name: typeof item.name === "string" && item.name.trim() ? item.name : "Knowledge workspace",
        workspacePath: typeof item.workspacePath === "string" && item.workspacePath ? item.workspacePath : null,
        documents: Array.isArray(item.documents)
          ? item.documents
              .map((doc) => sanitizeDocument(doc, id))
              .filter((doc): doc is KnowledgeDocument => !!doc)
          : [],
        createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
      };
    });
}

function readLocalDocumentWorkspaces(): DocumentWorkspace[] {
  try {
    return sanitizeDocumentWorkspaces(JSON.parse(localStorage.getItem(DOCUMENT_WORKSPACES_KEY) || "[]"));
  } catch {
    return [];
  }
}

function writeLocalDocumentWorkspaces(workspaces: DocumentWorkspace[]) {
  try {
    localStorage.setItem(DOCUMENT_WORKSPACES_KEY, JSON.stringify(workspaces));
  } catch {
    // SQLite mirror remains the fallback if localStorage quota is exhausted.
  }
}

function mergeDocumentWorkspaces(
  local: DocumentWorkspace[],
  sqlite: DocumentWorkspace[],
): DocumentWorkspace[] {
  const byId = new Map<string, DocumentWorkspace>();
  for (const workspace of sqlite) byId.set(workspace.id, workspace);
  for (const workspace of local) {
    const existing = byId.get(workspace.id);
    if (!existing || workspace.updatedAt >= existing.updatedAt) byId.set(workspace.id, workspace);
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadDocumentWorkspaces(): Promise<DocumentWorkspace[]> {
  const local = readLocalDocumentWorkspaces();
  try {
    const invoke = await getInvoke();
    const sqlite = sanitizeDocumentWorkspaces(await invoke<unknown[]>("document_workspaces_load"));
    const merged = mergeDocumentWorkspaces(local, sqlite);
    writeLocalDocumentWorkspaces(merged);
    return merged;
  } catch {
    return local;
  }
}

export function persistDocumentWorkspaces(workspaces: DocumentWorkspace[]) {
  const sanitized = sanitizeDocumentWorkspaces(workspaces);
  writeLocalDocumentWorkspaces(sanitized);
  void (async () => {
    try {
      const invoke = await getInvoke();
      await Promise.all(
        sanitized.map((workspace) =>
          invoke("document_workspace_save", {
            workspace,
          }),
        ),
      );
    } catch {
      // Best effort mirror. The local journal is already written synchronously.
    }
  })();
}

export function deletePersistedDocumentWorkspace(workspaceId: string, workspaces: DocumentWorkspace[]) {
  const next = workspaces.filter((workspace) => workspace.id !== workspaceId);
  writeLocalDocumentWorkspaces(next);
  void (async () => {
    try {
      const invoke = await getInvoke();
      await invoke("document_workspace_delete", { workspaceId });
    } catch {
      // Keep the local deletion; future saves will re-mirror the current list.
    }
  })();
  return next;
}

export async function replaceDocumentChunks(input: {
  workspaceId: string;
  documentId: string;
  chunks: Array<DocumentChunk & { embedding?: number[] }>;
  model?: string;
}): Promise<number> {
  const invoke = await getInvoke();
  return invoke<number>("document_chunks_replace", {
    workspaceId: input.workspaceId,
    documentId: input.documentId,
    chunks: input.chunks,
    model: input.model ?? null,
  });
}

export async function deleteDocumentChunks(documentId: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke("document_chunks_delete", { documentId });
}

export async function embedKnowledgeDocument(input: {
  workspaceId: string;
  document: KnowledgeDocument;
  ollamaUrl?: string;
  model?: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<KnowledgeDocument> {
  const { embedQuery } = await import("./semantic-index");
  const model = input.model ?? "nomic-embed-text";
  const chunks = chunkDocumentText({ documentId: input.document.id, text: input.document.text });
  const embeddedChunks: Array<DocumentChunk & { embedding?: number[] }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await embedQuery(chunk.content, { url: input.ollamaUrl, model });
    embeddedChunks.push({ ...chunk, embedding });
    input.onProgress?.(i + 1, chunks.length);
  }

  await replaceDocumentChunks({
    workspaceId: input.workspaceId,
    documentId: input.document.id,
    chunks: embeddedChunks,
    model,
  });

  return setDocumentEmbedded(input.document, {
    embedded: true,
    status: "embedded",
    chunkCount: chunks.length,
    embeddingModel: model,
  });
}

export async function searchKnowledgeDocuments(input: {
  workspaceId: string;
  query: string;
  limit?: number;
  ollamaUrl?: string;
  model?: string;
  includeProvenance?: boolean;
}): Promise<RetrievalPreviewHit[]> {
  const { embedQuery } = await import("./semantic-index");
  const queryEmbedding = await embedQuery(input.query, {
    url: input.ollamaUrl,
    model: input.model ?? "nomic-embed-text",
  });
  const invoke = await getInvoke();
  const hits = await invoke<RetrievalHit[]>("document_chunks_search", {
    workspaceId: input.workspaceId,
    queryEmbedding,
    limit: input.limit ?? 8,
  });
  return buildDocumentRetrievalPreview(hits, {
    limit: input.limit,
    includeProvenance: input.includeProvenance,
  });
}
