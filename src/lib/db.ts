/**
 * Persistence bridge.
 *
 * Two layers, both used together so we never lose a message to a close-race:
 *
 *  1. localStorage journal (synchronous, survives any close path including
 *     Cmd+Q and force-quit). Every conversation/message is written here
 *     immediately on the calling thread before control returns to the UI.
 *
 *  2. SQLite mirror (async, via Tauri IPC). The same payload is also queued
 *     for durable storage. Search, large history, and cross-restart loads
 *     come from here.
 *
 * On startup we read the journal first (instant, no IPC), then merge in
 * whatever's in SQLite. Anything in the journal that isn't in SQLite gets
 * replayed. Anything in SQLite that's missing from the journal still loads.
 *
 * This is overkill for happy-path writes, but the UX guarantee is:
 *   "type a message, close the app a millisecond later, reopen → it's there"
 * which is more important than IPC efficiency.
 */

import type { Conversation, Message } from "../stores/chat";
import { compareMessages } from "../stores/chat";
import type { CompactionEntry } from "./compaction/types";
import { log, withError } from "./logger";

let _invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

async function getInvoke() {
  if (_invoke) return _invoke;
  const mod = await import("@tauri-apps/api/core");
  _invoke = mod.invoke;
  return _invoke;
}

// ── localStorage journal ───────────────────────────────────────────────

const JOURNAL_CONV_PREFIX = "goatllm-journal-conv:";
const JOURNAL_MSG_PREFIX = "goatllm-journal-msg:";
const JOURNAL_COMPACTION_PREFIX = "goatllm-journal-compaction:";
const JOURNAL_DEL_CONV_PREFIX = "goatllm-journal-del-conv:";
const JOURNAL_DEL_MSG_PREFIX = "goatllm-journal-del-msg:";

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // QuotaExceeded is the only realistic failure. Best-effort prune of the
    // oldest message entry, then retry once. If it still fails we log and
    // give up — SQLite mirror will catch it on the next successful write.
    try {
      const oldest = oldestMessageKey();
      if (oldest) localStorage.removeItem(oldest);
      localStorage.setItem(key, value);
    } catch (e2) {
      log.error("localStorage write failed", withError("db", { originalError: e instanceof Error ? e.message : String(e) }, e2));
    }
  }
}

function safeRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function oldestMessageKey(): string | null {
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(JOURNAL_MSG_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { createdAt?: number };
      const ts = parsed.createdAt ?? 0;
      if (ts < oldestTs) { oldestTs = ts; oldestKey = k; }
    } catch { /* skip corrupt entry */ }
  }
  return oldestKey;
}

function readJournal(): {
  conversations: Conversation[];
  messages: Message[];
  compactionEntries: CompactionEntry[];
  deletedConvIds: Set<string>;
  deletedMsgIds: Set<string>;
} {
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const compactionEntries: CompactionEntry[] = [];
  const deletedConvIds = new Set<string>();
  const deletedMsgIds = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    try {
      if (k.startsWith(JOURNAL_CONV_PREFIX)) {
        const raw = localStorage.getItem(k);
        if (raw) conversations.push(JSON.parse(raw) as Conversation);
      } else if (k.startsWith(JOURNAL_MSG_PREFIX)) {
        const raw = localStorage.getItem(k);
        if (raw) messages.push(JSON.parse(raw) as Message);
      } else if (k.startsWith(JOURNAL_COMPACTION_PREFIX)) {
        const raw = localStorage.getItem(k);
        if (raw) compactionEntries.push(JSON.parse(raw) as CompactionEntry);
      } else if (k.startsWith(JOURNAL_DEL_CONV_PREFIX)) {
        deletedConvIds.add(k.slice(JOURNAL_DEL_CONV_PREFIX.length));
      } else if (k.startsWith(JOURNAL_DEL_MSG_PREFIX)) {
        deletedMsgIds.add(k.slice(JOURNAL_DEL_MSG_PREFIX.length));
      }
    } catch {
      // Corrupt entry — drop it so we don't loop on it forever.
      safeRemove(k);
    }
  }
  return { conversations, messages, compactionEntries, deletedConvIds, deletedMsgIds };
}

// ── SQLite write queue ─────────────────────────────────────────────────

type WriteJob = () => Promise<void>;

const writeQueue: WriteJob[] = [];
let draining = false;

function enqueueWrite(job: WriteJob) {
  writeQueue.push(async () => {
    try { await job(); } catch (e) { log.error("queued write failed", withError("db", undefined, e)); }
  });
  if (!draining) {
    draining = true;
    void drainLoop();
  }
}

async function drainLoop() {
  while (writeQueue.length > 0) {
    const job = writeQueue.shift()!;
    await job();
  }
  draining = false;
}

// ── Types matching the Rust backend ──

interface DbConversation {
  id: string;
  title: string;
  last_message_preview: string;
  last_message_at: number;
  created_at: number;
  model_id: string | null;
  system_prompt: string;
  archived?: number;
  tags?: string;
  mode?: string;
  workspace_path?: string;
}

interface DbMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  attachments: string | null;
  created_at: number;
  pinned?: boolean;
  thinking_content?: string | null;
  turn_duration_ms?: number | null;
  edited_files?: string | null;
  model_id?: string | null;
  citations?: string | null;
  usage_json?: string | null;
  estimated_context_tokens?: number | null;
}

interface DbCompactionEntry {
  id: string;
  conversation_id: string;
  first_kept_id: string;
  summary: string;
  read_files: string;
  modified_files: string;
  tokens_before: number;
  source: string;
  is_split_turn: number;
  turn_prefix: string | null;
  prompt_version: string;
  created_at: number;
  mode: string;
  model_id: string | null;
}

interface AllData {
  conversations: DbConversation[];
  messages: DbMessage[];
  compaction_entries?: DbCompactionEntry[];
}

function parseOptionalJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function fromDbConversation(d: DbConversation): Conversation {
  let tags: string[] | undefined;
  if (d.tags) {
    try {
      const parsed = JSON.parse(d.tags);
      if (Array.isArray(parsed) && parsed.length > 0) tags = parsed.filter((t) => typeof t === "string");
    } catch { /* malformed tags column — leave undefined */ }
  }
  return {
    id: d.id,
    title: d.title,
    lastMessagePreview: d.last_message_preview,
    lastMessageAt: d.last_message_at,
    createdAt: d.created_at,
    modelId: d.model_id,
    systemPrompt: d.system_prompt,
    archived: d.archived ? true : undefined,
    tags,
    mode: (d.mode as Conversation["mode"]) ?? "chat",
    workspacePath: d.workspace_path || null,
  };
}

function fromDbMessage(d: DbMessage): Message {
  let editedFiles: string[] | undefined;
  if (d.edited_files) {
    try {
      const parsed = JSON.parse(d.edited_files);
      if (Array.isArray(parsed)) {
        editedFiles = parsed.filter((p) => typeof p === "string");
      }
    } catch { /* malformed */ }
  }
  return {
    id: d.id,
    conversationId: d.conversation_id,
    role: d.role as Message["role"],
    content: d.content,
    createdAt: d.created_at,
    toolCalls: parseOptionalJson<Message["toolCalls"]>(d.tool_calls),
    attachments: parseOptionalJson<Message["attachments"]>(d.attachments),
    pinned: d.pinned ? true : undefined,
    thinkingContent: d.thinking_content || undefined,
    turnDurationMs: d.turn_duration_ms ?? undefined,
    editedFiles,
    modelId: d.model_id || undefined,
    citations: parseOptionalJson<Message["citations"]>(d.citations ?? null),
    usage: parseOptionalJson<Message["usage"]>(d.usage_json ?? null),
    estimatedContextTokens: d.estimated_context_tokens ?? undefined,
  };
}

function stringArrayFromJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function fromDbCompactionEntry(d: DbCompactionEntry): CompactionEntry {
  return {
    id: d.id,
    conversationId: d.conversation_id,
    firstKeptId: d.first_kept_id,
    summary: d.summary,
    readFiles: stringArrayFromJson(d.read_files),
    modifiedFiles: stringArrayFromJson(d.modified_files),
    tokensBefore: d.tokens_before,
    source: d.source as CompactionEntry["source"],
    isSplitTurn: d.is_split_turn !== 0,
    turnPrefix: d.turn_prefix || undefined,
    promptVersion: d.prompt_version as CompactionEntry["promptVersion"],
    createdAt: d.created_at,
    mode: d.mode as CompactionEntry["mode"],
    modelId: d.model_id || undefined,
  };
}

// ── Public API ──

export interface HydratedData {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  compactionEntries: Record<string, CompactionEntry[]>;
}

/**
 * Load all data. Reads SQLite + localStorage journal and merges them so we
 * never lose a recent write to a close-race. Anything in the journal that
 * isn't yet in SQLite gets replayed (queued write) so the next clean run
 * has it on disk too.
 */
export async function loadAllFromDb(): Promise<HydratedData> {
  // Journal first — synchronous, can't fail, instant.
  const journal = readJournal();

  // SQLite — best effort.
  let sqliteConvs: Conversation[] = [];
  let sqliteMsgs: Message[] = [];
  let sqliteCompactions: CompactionEntry[] = [];
  try {
    const invoke = await getInvoke();
    const data = await invoke<AllData>("load_all_data");
    sqliteConvs = data.conversations.map(fromDbConversation);
    sqliteMsgs = data.messages.map(fromDbMessage);
    sqliteCompactions = (data.compaction_entries ?? []).map(fromDbCompactionEntry);
  } catch (e) {
    log.warn("SQLite load failed, using journal only", withError("db", undefined, e));
  }

  // Merge conversations: union by id, journal entry wins for fields it has
  // (it's always at least as fresh as SQLite for the writes we made).
  const convMap = new Map<string, Conversation>();
  for (const c of sqliteConvs) {
    if (journal.deletedConvIds.has(c.id)) continue;
    convMap.set(c.id, c);
  }
  for (const c of journal.conversations) {
    if (journal.deletedConvIds.has(c.id)) continue;
    const existing = convMap.get(c.id);
    if (!existing || c.lastMessageAt >= existing.lastMessageAt) {
      convMap.set(c.id, c);
    }
  }

  // Merge messages: union by id.
  const msgMap = new Map<string, Message>();
  for (const m of sqliteMsgs) {
    if (journal.deletedMsgIds.has(m.id)) continue;
    msgMap.set(m.id, m);
  }
  for (const m of journal.messages) {
    if (journal.deletedMsgIds.has(m.id)) continue;
    const existing = msgMap.get(m.id);
    // Journal entry wins if its content is non-empty and longer (covers
    // streaming where the journal was last updated mid-stream and SQLite
    // never got the final flush).
    if (!existing || (m.content && m.content.length >= existing.content.length)) {
      msgMap.set(m.id, m);
    }
  }

  const conversations = Array.from(convMap.values()).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const messages: Record<string, Message[]> = {};
  for (const m of msgMap.values()) {
    if (!convMap.has(m.conversationId)) continue;
    if (!messages[m.conversationId]) messages[m.conversationId] = [];
    messages[m.conversationId].push(m);
  }
  for (const arr of Object.values(messages)) {
    arr.sort(compareMessages);
  }

  const compactionMap = new Map<string, CompactionEntry>();
  for (const entry of sqliteCompactions) {
    if (journal.deletedConvIds.has(entry.conversationId)) continue;
    compactionMap.set(entry.id, entry);
  }
  for (const entry of journal.compactionEntries) {
    if (journal.deletedConvIds.has(entry.conversationId)) continue;
    const existing = compactionMap.get(entry.id);
    if (!existing || entry.createdAt >= existing.createdAt) {
      compactionMap.set(entry.id, entry);
    }
  }
  const compactionEntries: Record<string, CompactionEntry[]> = {};
  for (const entry of compactionMap.values()) {
    if (!compactionEntries[entry.conversationId]) compactionEntries[entry.conversationId] = [];
    compactionEntries[entry.conversationId].push(entry);
  }
  for (const arr of Object.values(compactionEntries)) {
    arr.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }

  // Replay journal entries that SQLite is missing so the next session has
  // them durably on disk too. Plus any pending deletes.
  const sqliteConvIds = new Set(sqliteConvs.map((c) => c.id));
  const sqliteMsgIds = new Set(sqliteMsgs.map((m) => m.id));
  const sqliteCompactionIds = new Set(sqliteCompactions.map((entry) => entry.id));
  for (const c of journal.conversations) {
    if (!sqliteConvIds.has(c.id) && !journal.deletedConvIds.has(c.id)) {
      enqueueWrite(() => invokeSaveConversation(c));
    }
  }
  for (const m of journal.messages) {
    if (!sqliteMsgIds.has(m.id) && !journal.deletedMsgIds.has(m.id)) {
      enqueueWrite(() => invokeSaveMessage(m));
    }
  }
  for (const entry of journal.compactionEntries) {
    if (!sqliteCompactionIds.has(entry.id) && !journal.deletedConvIds.has(entry.conversationId)) {
      enqueueWrite(() => invokeSaveCompactionEntry(entry));
    }
  }
  for (const id of journal.deletedConvIds) {
    enqueueWrite(() => invokeDeleteConversation(id));
  }
  for (const id of journal.deletedMsgIds) {
    enqueueWrite(() => invokeDeleteMessage(id));
  }

  return { conversations, messages, compactionEntries };
}

/**
 * Load just the messages for a single conversation. Reads journal + SQLite,
 * merges by id. Used when activating a conversation that the in-memory store
 * thinks is empty.
 */
export async function loadMessagesForConversation(conversationId: string): Promise<Message[]> {
  const journal = readJournal();
  const journalMsgs = journal.messages.filter(
    (m) => m.conversationId === conversationId && !journal.deletedMsgIds.has(m.id),
  );

  let sqliteMsgs: Message[] = [];
  try {
    const invoke = await getInvoke();
    const rows = await invoke<DbMessage[]>("load_messages_for_conversation", { conversationId });
    sqliteMsgs = rows.map(fromDbMessage).filter((m) => !journal.deletedMsgIds.has(m.id));
  } catch {
    // Either Rust command isn't registered yet (dev rebuild needed) or another
    // failure. Journal alone still gives a usable view.
  }

  const merged = new Map<string, Message>();
  for (const m of sqliteMsgs) merged.set(m.id, m);
  for (const m of journalMsgs) {
    const existing = merged.get(m.id);
    if (!existing || (m.content && m.content.length >= existing.content.length)) {
      merged.set(m.id, m);
    }
  }
  return Array.from(merged.values()).sort(compareMessages);
}

// ── Writes ──

async function invokeSaveConversation(c: Conversation): Promise<void> {
  const invoke = await getInvoke();
  await invoke("save_conversation", {
    payload: {
      id: c.id,
      title: c.title,
      lastMessagePreview: c.lastMessagePreview,
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
      modelId: c.modelId,
      systemPrompt: c.systemPrompt,
      archived: c.archived ? 1 : 0,
      tags: JSON.stringify(c.tags ?? []),
      mode: c.mode ?? "chat",
      workspacePath: c.workspacePath ?? "",
    },
  });
}

async function invokeSaveMessage(m: Message): Promise<void> {
  const invoke = await getInvoke();
  await invoke("save_message", {
    payload: {
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
      attachments: m.attachments ? JSON.stringify(m.attachments) : null,
      createdAt: m.createdAt,
      pinned: m.pinned ?? false,
      thinkingContent: m.thinkingContent ?? null,
      turnDurationMs: m.turnDurationMs ?? null,
      editedFiles:
        m.editedFiles && m.editedFiles.length > 0
          ? JSON.stringify(m.editedFiles)
          : null,
      modelId: m.modelId ?? null,
      citations:
        m.citations && m.citations.length > 0
          ? JSON.stringify(m.citations)
          : null,
      usage: m.usage ? JSON.stringify(m.usage) : null,
      estimatedContextTokens: m.estimatedContextTokens ?? null,
    },
  });
}

async function invokeSaveCompactionEntry(entry: CompactionEntry): Promise<void> {
  const invoke = await getInvoke();
  await invoke("save_compaction_entry", {
    payload: {
      id: entry.id,
      conversationId: entry.conversationId,
      firstKeptId: entry.firstKeptId,
      summary: entry.summary,
      readFiles: JSON.stringify(entry.readFiles),
      modifiedFiles: JSON.stringify(entry.modifiedFiles),
      tokensBefore: entry.tokensBefore,
      source: entry.source,
      isSplitTurn: entry.isSplitTurn,
      turnPrefix: entry.turnPrefix ?? null,
      promptVersion: entry.promptVersion,
      createdAt: entry.createdAt,
      mode: entry.mode,
      modelId: entry.modelId ?? null,
    },
  });
}

async function invokeDeleteConversation(id: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke("delete_conversation_db", { id });
}

async function invokeDeleteMessage(id: string): Promise<void> {
  const invoke = await getInvoke();
  await invoke("delete_message_db", { id });
}

/**
 * Upsert a conversation. Writes the journal synchronously (durable
 * immediately) and queues the SQLite mirror.
 */
export function persistConversation(c: Conversation): void {
  safeSet(JOURNAL_CONV_PREFIX + c.id, JSON.stringify(c));
  safeRemove(JOURNAL_DEL_CONV_PREFIX + c.id);
  enqueueWrite(async () => {
    await invokeSaveConversation(c);
    // Mirror succeeded — keep the journal entry anyway so a later
    // close-race doesn't lose newer fields. The journal only grows in
    // proportion to active conversations, which is fine in practice.
  });
}

/**
 * Upsert a message. Writes the journal synchronously and queues the SQLite mirror.
 */
export function persistMessage(m: Message): void {
  safeSet(JOURNAL_MSG_PREFIX + m.id, JSON.stringify(m));
  safeRemove(JOURNAL_DEL_MSG_PREFIX + m.id);
  enqueueWrite(() => invokeSaveMessage(m));
}

export function persistCompactionEntry(entry: CompactionEntry): void {
  safeSet(
    `${JOURNAL_COMPACTION_PREFIX}${entry.conversationId}:${entry.id}`,
    JSON.stringify(entry),
  );
  enqueueWrite(() => invokeSaveCompactionEntry(entry));
}

export async function loadCompactionEntries(conversationId: string): Promise<CompactionEntry[]> {
  const journal = readJournal();
  const journalEntries = journal.compactionEntries.filter(
    (entry) => entry.conversationId === conversationId && !journal.deletedConvIds.has(conversationId),
  );

  let sqliteEntries: CompactionEntry[] = [];
  try {
    const invoke = await getInvoke();
    const rows = await invoke<DbCompactionEntry[]>("load_compaction_entries", { conversationId });
    sqliteEntries = rows.map(fromDbCompactionEntry);
  } catch {
    // Journal-only recovery is still valid.
  }

  const merged = new Map<string, CompactionEntry>();
  for (const entry of sqliteEntries) merged.set(entry.id, entry);
  for (const entry of journalEntries) {
    const existing = merged.get(entry.id);
    if (!existing || entry.createdAt >= existing.createdAt) merged.set(entry.id, entry);
  }
  return Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function getLatestCompactionEntry(
  entriesByConversation: Record<string, CompactionEntry[]> | undefined,
  conversationId: string,
): CompactionEntry | null {
  const entries = entriesByConversation?.[conversationId];
  if (!entries || entries.length === 0) return null;
  return [...entries].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] ?? null;
}

/** Delete a conversation. Marks the journal and queues SQLite. */
export function deleteConversationFromDb(id: string): void {
  safeRemove(JOURNAL_CONV_PREFIX + id);
  safeSet(JOURNAL_DEL_CONV_PREFIX + id, "1");
  // Drop any journaled messages belonging to this conv.
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(JOURNAL_MSG_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const m = JSON.parse(raw) as Message;
      if (m.conversationId === id) safeRemove(k);
    } catch { safeRemove(k); }
  }
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(`${JOURNAL_COMPACTION_PREFIX}${id}:`)) continue;
    safeRemove(k);
  }
  enqueueWrite(async () => {
    await invokeDeleteConversation(id);
    safeRemove(JOURNAL_DEL_CONV_PREFIX + id);
  });
}

/** Delete a message. */
export function deleteMessageFromDb(id: string): void {
  safeRemove(JOURNAL_MSG_PREFIX + id);
  safeSet(JOURNAL_DEL_MSG_PREFIX + id, "1");
  enqueueWrite(async () => {
    await invokeDeleteMessage(id);
    safeRemove(JOURNAL_DEL_MSG_PREFIX + id);
  });
}

interface MessageSearchResult {
  message_id: string;
  conversation_id: string;
  conversation_title: string;
  role: string;
  content_preview: string;
  created_at: number;
}

export async function searchMessages(query: string): Promise<MessageSearchResult[]> {
  try {
    const invoke = await getInvoke();
    return await invoke<MessageSearchResult[]>("search_messages", { query });
  } catch (e) {
    log.warn("Failed to search messages", withError("db", undefined, e));
    return [];
  }
}
