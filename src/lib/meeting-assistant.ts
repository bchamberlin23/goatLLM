export type MeetingSessionStatus = "recording" | "transcribing" | "ready" | "summarizing" | "done" | "error";
export type MeetingSessionSource = "recording" | "upload";
export type MeetingSummaryStyle = "concise" | "detailed" | "standup";

export interface MeetingSession {
  id: string;
  title: string;
  source: MeetingSessionSource;
  status: MeetingSessionStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  audioFilename?: string;
  transcript?: string;
  summary?: string;
  actionItems: string[];
  decisions: string[];
  participants: string[];
  modelId?: string;
  conversationId?: string;
  error?: string;
}

export interface MeetingSettings {
  autoSummarize: boolean;
  summaryStyle: MeetingSummaryStyle;
  speakerLabels: boolean;
  storeTranscripts: boolean;
}

export interface MeetingState {
  sessions: MeetingSession[];
  settings: MeetingSettings;
}

export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  autoSummarize: true,
  summaryStyle: "concise",
  speakerLabels: true,
  storeTranscripts: true,
};

const MEETING_SESSIONS_KEY = "goatllm-meeting-sessions";
const MEETING_SETTINGS_KEY = "goatllm-meeting-settings";
const RUNTIME_STATUSES = new Set<MeetingSessionStatus>(["recording", "transcribing", "summarizing"]);

let _invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

async function getInvoke() {
  if (_invoke) return _invoke;
  const mod = await import("@tauri-apps/api/core");
  _invoke = mod.invoke;
  return _invoke;
}

function makeMeetingId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `meeting-${crypto.randomUUID()}`;
  }
  return `meeting-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createMeetingSession(input: {
  title?: string;
  source: MeetingSessionSource;
  audioFilename?: string;
  now?: number;
}): MeetingSession {
  const now = input.now ?? Date.now();
  return {
    id: makeMeetingId(),
    title: input.title?.trim() || (input.source === "recording" ? "Live meeting" : "Imported meeting"),
    source: input.source,
    status: input.source === "recording" ? "recording" : "transcribing",
    createdAt: now,
    updatedAt: now,
    startedAt: input.source === "recording" ? now : undefined,
    audioFilename: input.audioFilename,
    actionItems: [],
    decisions: [],
    participants: [],
  };
}

export function sanitizeMeetingSettings(raw: unknown): MeetingSettings {
  const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const summaryStyle = row.summaryStyle === "detailed" || row.summaryStyle === "standup" ? row.summaryStyle : "concise";
  return {
    autoSummarize: typeof row.autoSummarize === "boolean" ? row.autoSummarize : DEFAULT_MEETING_SETTINGS.autoSummarize,
    summaryStyle,
    speakerLabels: typeof row.speakerLabels === "boolean" ? row.speakerLabels : DEFAULT_MEETING_SETTINGS.speakerLabels,
    storeTranscripts: typeof row.storeTranscripts === "boolean" ? row.storeTranscripts : DEFAULT_MEETING_SETTINGS.storeTranscripts,
  };
}

function sanitizeStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function sanitizeSession(raw: unknown): MeetingSession | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  const source: MeetingSessionSource = row.source === "recording" ? "recording" : "upload";
  const status: MeetingSessionStatus =
    row.status === "recording" || row.status === "transcribing" || row.status === "ready" ||
    row.status === "summarizing" || row.status === "done" || row.status === "error"
      ? row.status
      : "error";
  return {
    id: row.id,
    title: row.title,
    source,
    status,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
    startedAt: typeof row.startedAt === "number" ? row.startedAt : undefined,
    endedAt: typeof row.endedAt === "number" ? row.endedAt : undefined,
    durationMs: typeof row.durationMs === "number" ? row.durationMs : undefined,
    audioFilename: typeof row.audioFilename === "string" ? row.audioFilename : undefined,
    transcript: typeof row.transcript === "string" ? row.transcript : undefined,
    summary: typeof row.summary === "string" ? row.summary : undefined,
    actionItems: sanitizeStringArray(row.actionItems),
    decisions: sanitizeStringArray(row.decisions),
    participants: sanitizeStringArray(row.participants),
    modelId: typeof row.modelId === "string" ? row.modelId : undefined,
    conversationId: typeof row.conversationId === "string" ? row.conversationId : undefined,
    error: typeof row.error === "string" ? row.error : undefined,
  };
}

export function sanitizeMeetingSessions(raw: unknown): MeetingSession[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeSession)
    .filter((session): session is MeetingSession => !!session)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function settleMeetingRuntimeState(sessions: MeetingSession[]): MeetingSession[] {
  return sanitizeMeetingSessions(sessions)
    .map((session) =>
      RUNTIME_STATUSES.has(session.status)
        ? {
            ...session,
            status: "error" as const,
            error: "Meeting processing interrupted.",
            updatedAt: Date.now(),
          }
        : session,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // SQLite mirror remains best effort.
  }
}

function mergeSessions(local: MeetingSession[], sqlite: MeetingSession[]): MeetingSession[] {
  const byId = new Map<string, MeetingSession>();
  for (const session of sqlite) byId.set(session.id, session);
  for (const session of local) byId.set(session.id, { ...byId.get(session.id), ...session });
  return sanitizeMeetingSessions(Array.from(byId.values())).slice(0, 100);
}

export function loadMeetingStateFromJournal(): MeetingState {
  return {
    sessions: settleMeetingRuntimeState(sanitizeMeetingSessions(readJson<unknown>(MEETING_SESSIONS_KEY, []))),
    settings: sanitizeMeetingSettings(readJson<unknown>(MEETING_SETTINGS_KEY, DEFAULT_MEETING_SETTINGS)),
  };
}

export async function loadMeetingState(): Promise<MeetingState> {
  const local = loadMeetingStateFromJournal();
  try {
    const invoke = await getInvoke();
    const sqlite = await invoke<MeetingState>("meetings_load");
    const state = {
      sessions: settleMeetingRuntimeState(mergeSessions(local.sessions, sanitizeMeetingSessions(sqlite.sessions))),
      settings: sanitizeMeetingSettings(sqlite.settings ?? local.settings),
    };
    persistMeetingState(state.sessions, state.settings);
    return state;
  } catch {
    return local;
  }
}

export function persistMeetingState(sessions: MeetingSession[], settings: MeetingSettings) {
  const safeSessions = sanitizeMeetingSessions(sessions).slice(0, 100);
  const safeSettings = sanitizeMeetingSettings(settings);
  writeJson(MEETING_SESSIONS_KEY, safeSessions);
  writeJson(MEETING_SETTINGS_KEY, safeSettings);
  void (async () => {
    try {
      const invoke = await getInvoke();
      await invoke("meetings_save", { payload: { sessions: safeSessions, settings: safeSettings } });
    } catch {
      // Local journal already has the latest state.
    }
  })();
}

export function buildMeetingSummaryPrompt(session: MeetingSession, settings: MeetingSettings): string {
  return [
    "You are goatLLM's meeting assistant. Turn this transcript into a useful meeting record.",
    `Meeting title: ${session.title}`,
    `Style: ${settings.summaryStyle}`,
    "Return Markdown with exactly these sections: Summary, Decisions, Action Items, Participants, Risks / Open Questions.",
    "Keep action items owner-first when an owner is clear. Do not invent decisions or participants.",
    settings.speakerLabels ? "Preserve speaker names if present." : "Do not require speaker labels if the transcript lacks them.",
    "Transcript:",
    session.transcript?.trim() || "(empty)",
  ].join("\n\n");
}

function sectionLines(markdown: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`(?:^|\\n)#{1,3}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s|$)`, "i"));
  if (!match?.[1]) return [];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^none\.?$/i.test(line));
}

export function extractMeetingSections(markdown: string): { actionItems: string[]; decisions: string[]; participants: string[] } {
  return {
    actionItems: sectionLines(markdown, "Action Items"),
    decisions: sectionLines(markdown, "Decisions"),
    participants: sectionLines(markdown, "Participants"),
  };
}

export function buildContinueMeetingPrompt(session: MeetingSession): string {
  return [
    `Meeting: ${session.title}`,
    `Status: ${session.status}`,
    session.summary ? `Summary:\n${session.summary}` : "Summary:\nNo summary captured.",
    session.decisions.length > 0 ? `Decisions:\n${session.decisions.map((item) => `- ${item}`).join("\n")}` : "Decisions:\n- None captured.",
    session.actionItems.length > 0 ? `Action items:\n${session.actionItems.map((item) => `- ${item}`).join("\n")}` : "Action items:\n- None captured.",
    `Transcript:\n${session.transcript || "No transcript captured."}`,
    "Continue from this meeting record. Help resolve open questions, turn action items into next steps, or draft follow-up materials.",
  ].join("\n\n");
}

export function formatMeetingDuration(ms?: number): string {
  if (!ms || ms < 0) return "0:00";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
