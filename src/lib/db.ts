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
      console.error("[db] localStorage write failed:", e2, "(original:", e, ")");
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
  deletedConvIds: Set<string>;
  deletedMsgIds: Set<string>;
} {
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
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
  return { conversations, messages, deletedConvIds, deletedMsgIds };
}

// ── SQLite write queue ─────────────────────────────────────────────────

type WriteJob = () => Promise<void>;

const writeQueue: WriteJob[] = [];
let draining = false;

function enqueueWrite(job: WriteJob) {
  writeQueue.push(async () => {
    try { await job(); } catch (e) { console.error("[db] queued write failed:", e); }
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
}

interface AllData {
  conversations: DbConversation[];
  messages: DbMessage[];
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
  return {
    id: d.id,
    conversationId: d.conversation_id,
    role: d.role as Message["role"],
    content: d.content,
    createdAt: d.created_at,
    toolCalls: d.tool_calls ? JSON.parse(d.tool_calls) : undefined,
    attachments: d.attachments ? JSON.parse(d.attachments) : undefined,
    pinned: d.pinned ? true : undefined,
  };
}

// ── Public API ──

export interface HydratedData {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
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
  try {
    const invoke = await getInvoke();
    const data = await invoke<AllData>("load_all_data");
    sqliteConvs = data.conversations.map(fromDbConversation);
    sqliteMsgs = data.messages.map(fromDbMessage);
  } catch (e) {
    console.warn("[db] SQLite load failed, using journal only:", e);
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

  // Replay journal entries that SQLite is missing so the next session has
  // them durably on disk too. Plus any pending deletes.
  const sqliteConvIds = new Set(sqliteConvs.map((c) => c.id));
  const sqliteMsgIds = new Set(sqliteMsgs.map((m) => m.id));
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
  for (const id of journal.deletedConvIds) {
    enqueueWrite(() => invokeDeleteConversation(id));
  }
  for (const id of journal.deletedMsgIds) {
    enqueueWrite(() => invokeDeleteMessage(id));
  }

  return { conversations, messages };
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
  });
}

async function invokeSaveMessage(m: Message): Promise<void> {
  const invoke = await getInvoke();
  await invoke("save_message", {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
    attachments: m.attachments ? JSON.stringify(m.attachments) : null,
    createdAt: m.createdAt,
    pinned: m.pinned ?? false,
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
    console.warn("[db] Failed to search messages:", e);
    return [];
  }
}
