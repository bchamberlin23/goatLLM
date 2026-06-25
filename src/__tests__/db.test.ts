import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadAllFromDb, loadNotebooksFromDb, persistConversation, persistMessage, persistNotebooks } from "../lib/db";
import { createNotebook, createNotebookSource } from "../lib/canvas";
import type { Conversation, Message } from "../stores/chat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("loadAllFromDb", () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    localStorage.clear();
    const mod = await import("@tauri-apps/api/core");
    invoke = mod.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
  });

  it("keeps SQLite rows when one message has malformed JSON metadata", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_data") {
        return {
          conversations: [
            {
              id: "c1",
              title: "Saved chat",
              last_message_preview: "hello",
              last_message_at: 20,
              created_at: 10,
              model_id: null,
              system_prompt: "",
            },
          ],
          messages: [
            {
              id: "m1",
              conversation_id: "c1",
              role: "assistant",
              content: "hello",
              tool_calls: "{not valid json",
              attachments: "{also invalid",
              created_at: 20,
            },
          ],
        };
      }
      return undefined;
    });

    const data = await loadAllFromDb();

    expect(data.conversations).toHaveLength(1);
    expect(data.messages.c1).toHaveLength(1);
    expect(data.messages.c1[0].toolCalls).toBeUndefined();
    expect(data.messages.c1[0].attachments).toBeUndefined();
  });

  it("mirrors conversation writes through a structured IPC payload", async () => {
    const conversation: Conversation = {
      id: "c1",
      title: "Saved chat",
      lastMessagePreview: "hello",
      lastMessageAt: 20,
      createdAt: 10,
      modelId: "model-a",
      systemPrompt: "Be useful.",
      archived: true,
      tags: ["agent"],
      mode: "agent",
      workspacePath: "/workspace",
    };

    persistConversation(conversation);

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_conversation", {
        payload: {
          id: "c1",
          title: "Saved chat",
          lastMessagePreview: "hello",
          lastMessageAt: 20,
          createdAt: 10,
          modelId: "model-a",
          systemPrompt: "Be useful.",
          archived: 1,
          tags: JSON.stringify(["agent"]),
          mode: "agent",
          workspacePath: "/workspace",
        },
      });
    });
  });

  it("mirrors message writes through a structured IPC payload", async () => {
    const message: Message = {
      id: "m1",
      conversationId: "c1",
      role: "assistant",
      content: "Done",
      createdAt: 30,
      pinned: true,
      thinkingContent: "Reasoning",
      turnDurationMs: 1234,
      modelId: "openai:gpt-4o-mini",
      editedFiles: ["src/App.tsx"],
      toolCalls: [
        {
          toolCallId: "tool-1",
          toolName: "bash",
          input: { command: "pnpm test" },
          state: "done",
        },
      ],
      attachments: [
        {
          filename: "notes.txt",
          mimeType: "text/plain",
          dataUrl: "data:text/plain,hello",
          sizeBytes: 5,
        },
      ],
    };

    persistMessage(message);

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_message", {
        payload: {
          id: "m1",
          conversationId: "c1",
          role: "assistant",
          content: "Done",
          toolCalls: JSON.stringify(message.toolCalls),
          attachments: JSON.stringify(message.attachments),
          createdAt: 30,
          pinned: true,
          thinkingContent: "Reasoning",
          turnDurationMs: 1234,
          editedFiles: JSON.stringify(["src/App.tsx"]),
          modelId: "openai:gpt-4o-mini",
          citations: null,
          usage: null,
          estimatedContextTokens: null,
        },
      });
    });
  });

  it("mirrors notebooks through the journal and SQLite IPC", async () => {
    const notebook = {
      ...createNotebook("Research", 100),
      sources: [
        createNotebookSource({
          title: "Paper",
          kind: "text",
          content: "Findings",
          seed: 101,
        }),
      ],
    };

    persistNotebooks([notebook]);

    expect(localStorage.getItem("goatllm-notebooks")).toContain("Research");
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("notebooks_save", {
        payload: JSON.stringify([notebook]),
      });
    });
  });

  it("loads notebooks by merging SQLite with the fresher journal", async () => {
    const sqliteNotebook = {
      ...createNotebook("SQLite copy", 100),
      id: "nb-shared",
      updatedAt: 100,
    };
    const localNotebook = {
      ...sqliteNotebook,
      name: "Local wins",
      updatedAt: 200,
      notes: [
        {
          id: "note-local",
          title: "Local note",
          content: "Saved before quit",
          kind: "manual" as const,
          sourceIds: [],
          contextMode: "full" as const,
          createdAt: 200,
          updatedAt: 200,
        },
      ],
    };
    const sqliteOnly = {
      ...createNotebook("SQLite only", 300),
      id: "nb-sqlite-only",
    };
    localStorage.setItem("goatllm-notebooks", JSON.stringify([localNotebook]));

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "notebooks_load") return JSON.stringify([sqliteNotebook, sqliteOnly]);
      return undefined;
    });

    const notebooks = await loadNotebooksFromDb();

    expect(notebooks.map((notebook) => notebook.id)).toEqual(["nb-sqlite-only", "nb-shared"]);
    expect(notebooks.find((notebook) => notebook.id === "nb-shared")?.name).toBe("Local wins");
    expect(notebooks.find((notebook) => notebook.id === "nb-shared")?.notes).toHaveLength(1);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("notebooks_save", {
        payload: expect.stringContaining("Local wins"),
      });
    });
  });
});
