import type { Message } from "../../stores/chat";

export function mergeSplitTurnSummary(historySummary: string, turnPrefixSummary: string): string {
  const prefix = turnPrefixSummary.trim();
  if (!prefix) return historySummary;
  const history = historySummary.trim();
  return `${history}\n\n---\n\n**Turn Context (split turn):**\n${prefix}`;
}

export function buildTurnPrefixSummary(messages: Message[]): string {
  const lines = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const role = message.role === "user" ? "User" : "Assistant";
      const content = message.content.trim().slice(0, 240);
      const suffix = message.content.length > 240 ? "..." : "";
      return `- ${role}: ${content}${suffix}`;
    })
    .filter((line) => line.trim().length > 0);
  return lines.join("\n");
}
