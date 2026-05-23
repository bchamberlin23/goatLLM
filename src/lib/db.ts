/**
 * SQLite persistence bridge.
 *
 * All DB operations call Tauri commands in the Rust backend.
 * The store is always the source of truth at runtime — these are
 * write-behind durability calls (fire-and-forget for mutations,
 * awaited for hydration).
 */

import type { Conversation, Message } from "../stores/chat";

let _invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

async function getInvoke() {
  if (_invoke) return _invoke;
  const mod = await import("@tauri-apps/api/core");
  _invoke = mod.invoke;
  return _invoke;
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
}

interface DbMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  attachments: string | null;
  created_at: number;
}

interface AllData {
  conversations: DbConversation[];
  messages: DbMessage[];
}

// ── Converters ──

function fromDbConversation(d: DbConversation): Conversation {
  return {
    id: d.id,
    title: d.title,
    lastMessagePreview: d.last_message_preview,
    lastMessageAt: d.last_message_at,
    createdAt: d.created_at,
    modelId: d.model_id,
    systemPrompt: d.system_prompt,
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
  };
}

// ── Public API ──

export interface HydratedData {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
}

/**
 * Load all data from SQLite. Returns conversations and messages keyed by conversation ID.
 */
export async function loadAllFromDb(): Promise<HydratedData> {
  const invoke = await getInvoke();
  const data = await invoke<AllData>("load_all_data");

  const conversations = data.conversations.map(fromDbConversation);

  const messages: Record<string, Message[]> = {};
  for (const dm of data.messages) {
    const m = fromDbMessage(dm);
    if (!messages[m.conversationId]) messages[m.conversationId] = [];
    messages[m.conversationId].push(m);
  }

  return { conversations, messages };
}

/**
 * Upsert a conversation into SQLite. Fire-and-forget.
 */
export async function persistConversation(c: Conversation): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("save_conversation", {
      id: c.id,
      title: c.title,
      lastMessagePreview: c.lastMessagePreview,
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
      modelId: c.modelId,
      systemPrompt: c.systemPrompt,
    });
  } catch (e) {
    console.error("[db] Failed to persist conversation:", e);
  }
}

/**
 * Upsert a message into SQLite. Fire-and-forget.
 */
export async function persistMessage(m: Message): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("save_message", {
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
      attachments: m.attachments ? JSON.stringify(m.attachments) : null,
      createdAt: m.createdAt,
    });
  } catch (e) {
    console.error("[db] Failed to persist message:", e);
  }
}

/**
 * Delete a conversation and all its messages from SQLite.
 */
export async function deleteConversationFromDb(id: string): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("delete_conversation_db", { id });
  } catch (e) {
    console.warn("[db] Failed to delete conversation:", e);
  }
}

interface MessageSearchResult {
  message_id: string;
  conversation_id: string;
  conversation_title: string;
  role: string;
  content_preview: string;
  created_at: number;
}

/**
 * Search across all messages using LIKE (FTS deferred to later migration).
 * Returns up to 50 matches with conversation context.
 */
export async function searchMessages(query: string): Promise<MessageSearchResult[]> {
  try {
    const invoke = await getInvoke();
    return await invoke<MessageSearchResult[]>("search_messages", { query });
  } catch (e) {
    console.warn("[db] Failed to search messages:", e);
    return [];
  }
}

/**
 * Delete a single message from SQLite.
 */
export async function deleteMessageFromDb(id: string): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("delete_message_db", { id });
  } catch (e) {
    console.warn("[db] Failed to delete message:", e);
  }
}
