import type { Message } from "../../stores/chat";

export function estimateTextTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: Message): number {
  let tokens = estimateTextTokens(message.content);
  tokens += estimateTextTokens(message.thinkingContent);

  if (message.toolCalls) {
    for (const toolCall of message.toolCalls) {
      tokens += estimateTextTokens(JSON.stringify(toolCall.input ?? ""));
      if (typeof toolCall.output === "string") {
        tokens += estimateTextTokens(toolCall.output);
      } else if (toolCall.output !== undefined) {
        tokens += estimateTextTokens(JSON.stringify(toolCall.output));
      }
    }
  }

  if (message.attachments) {
    for (const attachment of message.attachments) {
      tokens += estimateTextTokens(attachment.filename);
      tokens += Math.ceil(attachment.sizeBytes / 16);
    }
  }

  return tokens;
}
