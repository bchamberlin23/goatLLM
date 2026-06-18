import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCompactionReplay } from "../lib/compaction/replay";
import {
  getLatestCompactionEntry,
  loadAllFromDb,
  persistCompactionEntry,
} from "../lib/db";

import type { CompactionEntry } from "../lib/compaction/types";
import type { Conversation, Message } from "../stores/chat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const conversation: Conversation = {
  id: "conv-1",
  title: "Compacted chat",
  lastMessagePreview: "latest",
  lastMessageAt: 50,
  createdAt: 1,
  modelId: "openai:gpt-4.1",
  systemPrompt: "",
  mode: "agent",
};

function message(id: string, role: Message["role"], content: string, createdAt: number): Message {
  return {
    id,
    conversationId: "conv-1",
    role,
    content,
    createdAt,
  };
}

function pinnedMessage(id: string, content: string, createdAt: number): Message {
  return {
    ...message(id, "user", content, createdAt),
    pinned: true,
  };
}

function entry(overrides: Partial<CompactionEntry> = {}): CompactionEntry {
  return {
    id: "cmp-1",
    conversationId: "conv-1",
    firstKeptId: "m3",
    summary: "## Goal\nPersist compaction summaries.",
    readFiles: ["src/App.tsx"],
    modifiedFiles: ["src/lib/db.ts"],
    tokensBefore: 12345,
    source: "auto",
    isSplitTurn: false,
    promptVersion: "initial",
    createdAt: 40,
    mode: "agent",
    modelId: "openai:gpt-4.1",
    ...overrides,
  };
}

describe("compaction persistence", () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    localStorage.clear();
    const mod = await import("@tauri-apps/api/core");
    invoke = mod.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
  });

  it("hydrates compaction entries from SQLite and replays a synthetic summary before the first kept message", async () => {
    const sqliteEntry = entry();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "load_all_data") {
        return {
          conversations: [
            {
              id: conversation.id,
              title: conversation.title,
              last_message_preview: conversation.lastMessagePreview,
              last_message_at: conversation.lastMessageAt,
              created_at: conversation.createdAt,
              model_id: conversation.modelId,
              system_prompt: conversation.systemPrompt,
              mode: conversation.mode,
              workspace_path: "",
              archived: 0,
              tags: "[]",
            },
          ],
          messages: [
            {
              id: "m1",
              conversation_id: "conv-1",
              role: "user",
              content: "old",
              tool_calls: null,
              attachments: null,
              created_at: 10,
              pinned: 0,
            },
            {
              id: "m2",
              conversation_id: "conv-1",
              role: "assistant",
              content: "older",
              tool_calls: null,
              attachments: null,
              created_at: 20,
              pinned: 0,
            },
            {
              id: "m3",
              conversation_id: "conv-1",
              role: "user",
              content: "kept",
              tool_calls: null,
              attachments: null,
              created_at: 30,
              pinned: 0,
            },
          ],
          compaction_entries: [
            {
              id: sqliteEntry.id,
              conversation_id: sqliteEntry.conversationId,
              first_kept_id: sqliteEntry.firstKeptId,
              summary: sqliteEntry.summary,
              read_files: JSON.stringify(sqliteEntry.readFiles),
              modified_files: JSON.stringify(sqliteEntry.modifiedFiles),
              tokens_before: sqliteEntry.tokensBefore,
              source: sqliteEntry.source,
              is_split_turn: 0,
              turn_prefix: null,
              prompt_version: sqliteEntry.promptVersion,
              created_at: sqliteEntry.createdAt,
              mode: sqliteEntry.mode,
              model_id: sqliteEntry.modelId,
            },
          ],
        };
      }
      return undefined;
    });

    const hydrated = await loadAllFromDb();
    const latest = getLatestCompactionEntry(hydrated.compactionEntries, "conv-1");
    const replayed = applyCompactionReplay(hydrated.messages["conv-1"], latest);

    expect(replayed.llmMessages.map((m) => m.content)).toEqual([
      expect.stringContaining("Persist compaction summaries"),
      "kept",
    ]);
    expect(replayed.timelineMessages[0].role).toBe("compactionSummary");
    expect(hydrated.messages["conv-1"].map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("recovers a journal-only compaction entry and queues a SQLite replay write", async () => {
    const journalEntry = entry({ id: "cmp-journal", createdAt: 60 });
    localStorage.setItem(
      `goatllm-journal-compaction:conv-1:${journalEntry.id}`,
      JSON.stringify(journalEntry),
    );

    invoke.mockImplementation((cmd: string) => {
      if (cmd === "load_all_data") {
        return {
          conversations: [],
          messages: [],
          compaction_entries: [],
        };
      }
      return undefined;
    });

    const hydrated = await loadAllFromDb();
    expect(hydrated.compactionEntries["conv-1"][0].id).toBe("cmp-journal");

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_compaction_entry", {
        payload: expect.objectContaining({
          id: "cmp-journal",
          conversationId: "conv-1",
          firstKeptId: "m3",
        }),
      });
    });
  });

  it("writes compaction entries to the sync journal before SQLite", async () => {
    const saved = entry({ id: "cmp-save" });

    persistCompactionEntry(saved);

    expect(localStorage.getItem("goatllm-journal-compaction:conv-1:cmp-save")).toContain(
      "Persist compaction summaries",
    );
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_compaction_entry", {
        payload: expect.objectContaining({
          id: "cmp-save",
          source: "auto",
          readFiles: JSON.stringify(["src/App.tsx"]),
        }),
      });
    });
  });

  it("falls back to the full transcript if firstKeptId no longer exists", () => {
    const messages = [
      message("m1", "user", "old", 10),
      message("m2", "assistant", "still visible", 20),
    ];

    const replayed = applyCompactionReplay(messages, entry({ firstKeptId: "deleted" }));

    expect(replayed.llmMessages).toEqual(messages);
    expect(replayed.hiddenCount).toBe(0);
  });

  it("keeps pinned messages visible even when they are older than firstKeptId", () => {
    const messages = [
      message("m1", "user", "old", 10),
      pinnedMessage("pin", "IMPORTANT_CONSTRAINT", 20),
      message("m2", "assistant", "older", 30),
      message("m3", "user", "kept", 40),
    ];

    const replayed = applyCompactionReplay(messages, entry({ firstKeptId: "m3" }));

    expect(replayed.timelineMessages.map((m) => m.content)).toEqual([
      "IMPORTANT_CONSTRAINT",
      expect.stringContaining("Persist compaction summaries"),
      "kept",
    ]);
    expect(replayed.hiddenCount).toBe(2);
  });
});
