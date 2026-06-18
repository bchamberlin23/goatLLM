import type { Conversation, Message } from "../../stores/chat";

export type CompactionSource = "auto" | "manual" | "overflow-retry" | "mid-loop";
export type CompactionPromptVersion = "initial" | "update";
export type CompactionMode = NonNullable<Conversation["mode"]>;

export interface CompactionEntry {
  id: string;
  conversationId: string;
  firstKeptId: string;
  summary: string;
  readFiles: string[];
  modifiedFiles: string[];
  tokensBefore: number;
  source: CompactionSource;
  isSplitTurn: boolean;
  turnPrefix?: string;
  promptVersion: CompactionPromptVersion;
  createdAt: number;
  mode: CompactionMode;
  modelId?: string;
}

export interface CompactionSummaryMetadata {
  entryId: string;
  summarizedCount: number;
  tokensBefore: number;
  firstKeptId: string;
  readFiles?: string[];
  modifiedFiles?: string[];
  isSplitTurn?: boolean;
}

export type CompactionSummaryMessage = Message & {
  role: "compactionSummary";
  compaction: CompactionSummaryMetadata;
};

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

export function createCompactionId(now = Date.now()): string {
  return `${String(now)}-${Math.random().toString(36).slice(2, 9)}`;
}
