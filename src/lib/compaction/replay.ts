import { compareMessages } from "../../stores/chat";

import type { CompactionEntry, CompactionSummaryMessage } from "./types";
import type { Message } from "../../stores/chat";

export interface CompactionReplay {
  timelineMessages: Message[];
  llmMessages: Message[];
  hiddenCount: number;
  summaryMessage: CompactionSummaryMessage | null;
}

export function latestCompactionEntry(entries: CompactionEntry[] | undefined): CompactionEntry | null {
  if (!entries || entries.length === 0) return null;
  return [...entries].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] ?? null;
}

export function applyCompactionReplay(
  messages: Message[],
  entry: CompactionEntry | null | undefined,
): CompactionReplay {
  const sorted = [...messages].sort(compareMessages);
  if (!entry) {
    return {
      timelineMessages: sorted,
      llmMessages: sorted,
      hiddenCount: 0,
      summaryMessage: null,
    };
  }

  const firstKeptIndex = sorted.findIndex((message) => message.id === entry.firstKeptId);
  if (firstKeptIndex < 0) {
    return {
      timelineMessages: sorted,
      llmMessages: sorted,
      hiddenCount: 0,
      summaryMessage: null,
    };
  }

  const beforeCut = sorted.slice(0, firstKeptIndex);
  const hidden = beforeCut.filter((message) => !message.pinned);
  const pinnedBeforeCut = beforeCut.filter((message) => message.pinned);
  const kept = sorted.slice(firstKeptIndex);
  const createdAt = Math.max(0, kept[0]?.createdAt ? kept[0].createdAt - 0.5 : entry.createdAt);
  const summaryMessage: CompactionSummaryMessage = {
    id: `compaction-${entry.id}`,
    conversationId: entry.conversationId,
    role: "compactionSummary",
    content: entry.summary,
    createdAt,
    compaction: {
      entryId: entry.id,
      summarizedCount: hidden.length,
      tokensBefore: entry.tokensBefore,
      firstKeptId: entry.firstKeptId,
      readFiles: entry.readFiles,
      modifiedFiles: entry.modifiedFiles,
      isSplitTurn: entry.isSplitTurn,
    },
  };
  const llmSummary: Message = {
    ...summaryMessage,
    role: "system",
  };

  return {
    timelineMessages: [...pinnedBeforeCut, summaryMessage, ...kept],
    llmMessages: [...pinnedBeforeCut, llmSummary, ...kept],
    hiddenCount: hidden.length,
    summaryMessage,
  };
}
