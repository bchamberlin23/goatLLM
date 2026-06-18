import { estimateMessageTokens } from "./token-estimate";

import type { Message } from "../../stores/chat";

export interface CutPointResult {
  firstKeptIndex: number;
  isSplitTurn: boolean;
  turnStartIndex: number;
  turnPrefixEndIndex: number;
}

function hasCompletedToolOutput(message: Message): boolean {
  return !!message.toolCalls?.some((toolCall) => toolCall.output !== undefined);
}

function isValidCutBoundary(message: Message): boolean {
  if (message.role === "tool") return false;
  if (message.role === "assistant" && hasCompletedToolOutput(message)) return false;
  return true;
}

export function findValidCutPoints(
  messages: Message[],
  startIdx: number,
  endIdx: number,
): number[] {
  const points: number[] = [];
  const start = Math.max(0, startIdx);
  const end = Math.min(messages.length - 1, endIdx);
  for (let i = start; i <= end; i++) {
    if (isValidCutBoundary(messages[i])) points.push(i);
  }
  return points;
}

function findTurnStart(messages: Message[], index: number, startIdx: number): number {
  for (let i = index; i >= startIdx; i--) {
    if (messages[i].role === "user") return i;
  }
  return index;
}

export function findCutPoint(
  messages: Message[],
  startIdx: number,
  endIdx: number,
  keepRecentTokens: number,
): CutPointResult {
  const start = Math.max(0, startIdx);
  const end = Math.min(messages.length - 1, endIdx);
  if (messages.length === 0 || end < start) {
    return {
      firstKeptIndex: 0,
      isSplitTurn: false,
      turnStartIndex: 0,
      turnPrefixEndIndex: -1,
    };
  }

  let tokens = 0;
  let boundary = start;
  for (let i = end; i >= start; i--) {
    const nextTokens = estimateMessageTokens(messages[i]);
    if (i < end && tokens + nextTokens > keepRecentTokens) {
      boundary = i + 1;
      break;
    }
    tokens += nextTokens;
    boundary = i;
  }

  if (boundary <= start) {
    return {
      firstKeptIndex: start,
      isSplitTurn: false,
      turnStartIndex: start,
      turnPrefixEndIndex: start - 1,
    };
  }

  const pinnedBeforeBoundary = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message, index }) => message.pinned && index >= start && index < boundary)
    .map(({ index }) => index);
  if (pinnedBeforeBoundary.length > 0) {
    boundary = Math.min(...pinnedBeforeBoundary);
  }

  const valid = findValidCutPoints(messages, boundary, end);
  const firstKeptIndex = valid[0] ?? boundary;
  const turnStartIndex = findTurnStart(messages, firstKeptIndex, start);
  const isSplitTurn = turnStartIndex < firstKeptIndex;

  return {
    firstKeptIndex,
    isSplitTurn,
    turnStartIndex,
    turnPrefixEndIndex: isSplitTurn ? firstKeptIndex - 1 : turnStartIndex - 1,
  };
}
