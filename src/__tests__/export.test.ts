import { describe, it, expect } from "vitest";
import { exportAsMarkdown, exportAsJson } from "../lib/export";
import type { Conversation, Message } from "../stores/chat";

const conv: Conversation = {
  id: "test-id",
  title: "Test Chat",
  lastMessagePreview: "Hello",
  lastMessageAt: 1700000000000,
  createdAt: 1700000000000,
  modelId: "opencode-go:deepseek-v4-pro",
  systemPrompt: "",
};

const messages: Message[] = [
  {
    id: "msg-1",
    conversationId: "test-id",
    role: "user",
    content: "What is Rust?",
    createdAt: 1700000001000,
  },
  {
    id: "msg-2",
    conversationId: "test-id",
    role: "assistant",
    content: "Rust is a systems programming language.",
    createdAt: 1700000002000,
  },
];

describe("exportAsMarkdown", () => {
  it("includes conversation title and metadata", () => {
    const md = exportAsMarkdown(conv, messages);
    expect(md).toContain("# Test Chat");
    expect(md).toContain("opencode-go:deepseek-v4-pro");
    expect(md).toContain("2");
  });

  it("includes user and assistant messages", () => {
    const md = exportAsMarkdown(conv, messages);
    expect(md).toContain("**You**");
    expect(md).toContain("**Assistant**");
    expect(md).toContain("What is Rust?");
    expect(md).toContain("Rust is a systems programming language.");
  });

  it("excludes system messages", () => {
    const withSystem: Message[] = [
      ...messages,
      {
        id: "msg-3",
        conversationId: "test-id",
        role: "system",
        content: "You are helpful.",
        createdAt: 1700000003000,
      },
    ];
    const md = exportAsMarkdown(conv, withSystem);
    expect(md).not.toContain("You are helpful.");
  });
});

describe("exportAsJson", () => {
  it("produces valid JSON with conversation metadata", () => {
    const json = exportAsJson(conv, messages);
    const parsed = JSON.parse(json);

    expect(parsed.exportedAt).toBeTruthy();
    expect(parsed.conversation.title).toBe("Test Chat");
    expect(parsed.conversation.modelId).toBe("opencode-go:deepseek-v4-pro");
  });

  it("includes all messages with timestamps", () => {
    const json = exportAsJson(conv, messages);
    const parsed = JSON.parse(json);

    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].role).toBe("user");
    expect(parsed.messages[0].content).toBe("What is Rust?");
    expect(parsed.messages[0].createdAt).toBeTruthy();
  });

  it("includes attachments when present", () => {
    const withAttachments: Message[] = [
      {
        id: "msg-1",
        conversationId: "test-id",
        role: "user",
        content: "Look at this",
        createdAt: 1700000001000,
        attachments: [
          {
            filename: "photo.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,abc",
            sizeBytes: 1024,
          },
        ],
      },
    ];
    const json = exportAsJson(conv, withAttachments);
    const parsed = JSON.parse(json);
    expect(parsed.messages[0].attachments).toHaveLength(1);
    expect(parsed.messages[0].attachments[0].filename).toBe("photo.png");
  });
});
