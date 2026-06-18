import type { Message, Conversation } from "../stores/chat";

export function exportAsMarkdown(conv: Conversation, messages: Message[]): string {
  const header = [
    `# ${conv.title}`,
    ``,
    `- **Date:** ${new Date(conv.createdAt).toISOString()}`,
    `- **Model:** ${conv.modelId ?? "unknown"}`,
    `- **Messages:** ${messages.length}`,
    ``,
    `---`,
    ``,
  ].join("\n");

  const body = messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "compactionSummary")
    .map((m) => {
      const roleLabel =
        m.role === "user"
          ? "**You**"
          : m.role === "assistant"
            ? "**Assistant**"
            : "**Compaction summary**";
      const time = new Date(m.createdAt).toLocaleTimeString();
      const detail =
        m.role === "compactionSummary" && m.compaction
          ? `\n\n_${m.compaction.summarizedCount} earlier messages summarized; ${m.compaction.tokensBefore.toLocaleString()} tokens before compaction._`
          : "";
      return `${roleLabel} — ${time}${detail}\n\n${m.content}\n`;
    })
    .join("\n\n---\n\n");

  return header + body;
}

export function exportAsJson(conv: Conversation, messages: Message[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      conversation: {
        id: conv.id,
        title: conv.title,
        modelId: conv.modelId,
        createdAt: new Date(conv.createdAt).toISOString(),
        lastMessageAt: new Date(conv.lastMessageAt).toISOString(),
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role === "compactionSummary" ? "compaction_summary" : m.role,
        content: m.content,
        createdAt: new Date(m.createdAt).toISOString(),
        ...(m.compaction ? { compaction: m.compaction } : {}),
        ...(m.pinned ? { pinned: true } : {}),
        ...(m.attachments ? { attachments: m.attachments } : {}),
      })),
    },
    null,
    2,
  );
}

export function downloadExport(
  conv: Conversation,
  messages: Message[],
  format: "markdown" | "json",
) {
  const ext = format === "markdown" ? "md" : "json";
  const mime = format === "markdown" ? "text/markdown" : "application/json";
  const content =
    format === "markdown"
      ? exportAsMarkdown(conv, messages)
      : exportAsJson(conv, messages);

  const safeTitle = conv.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const filename = `${safeTitle}-${conv.id.slice(0, 8)}.${ext}`;

  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
