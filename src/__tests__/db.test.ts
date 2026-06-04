import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadAllFromDb, persistConversation, persistMessage } from "../lib/db";
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
        },
      });
    });
  });
});
