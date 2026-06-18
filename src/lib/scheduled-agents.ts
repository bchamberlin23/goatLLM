import type { ScheduledAgent } from "../stores/chat";

export type ScheduledAgentRunStatus = "queued" | "running" | "done" | "error" | "missed";

export interface ScheduledAgentRun {
  id: string;
  agentId: string;
  agentName: string;
  prompt: string;
  status: ScheduledAgentRunStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  trace: string[];
  outputArtifactIds?: string[];
  conversationId?: string;
  readAt?: number;
}

export interface ScheduledRunCompletion {
  status: "done" | "error" | "missed";
  result?: string;
  error?: string;
  completedAt: number;
  nextRunAt: number;
  outputArtifactIds?: string[];
  conversationId?: string;
}

const RUNNING_STATUSES = new Set<ScheduledAgentRunStatus>(["queued", "running"]);
const SCHEDULED_AGENTS_KEY = "goatllm-scheduled-agents";
const SCHEDULED_AGENT_RUNS_KEY = "goatllm-scheduled-agent-runs";

let _invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

async function getInvoke() {
  if (_invoke) return _invoke;
  const mod = await import("@tauri-apps/api/core");
  _invoke = mod.invoke;
  return _invoke;
}

function makeRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `run-${crypto.randomUUID()}`;
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function computeNextScheduledRun(schedule: string, from = new Date()): Date {
  const trimmed = schedule.trim();
  if (trimmed === "@daily") {
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0));
  }
  if (trimmed === "@weekly") {
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 7, 0, 0, 0, 0));
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Unsupported schedule '${schedule}'. Use @daily, @weekly, */N * * * *, or M H * * *.`);
  }
  const [minutePart, hourPart] = parts;
  const next = new Date(from.getTime());
  next.setUTCSeconds(0, 0);

  const intervalMatch = minutePart.match(/^\*\/(\d+)$/);
  if (intervalMatch && hourPart === "*") {
    const interval = Math.max(1, Number(intervalMatch[1]));
    const currentMinute = next.getUTCMinutes();
    const delta = interval - (currentMinute % interval);
    next.setUTCMinutes(currentMinute + (delta === 0 ? interval : delta));
    return next;
  }

  const minute = Number(minutePart);
  const hour = Number(hourPart);
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    throw new Error(`Unsupported schedule '${schedule}'.`);
  }
  next.setUTCHours(hour, minute, 0, 0);
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function createScheduledAgentRun(agent: ScheduledAgent, now = Date.now()): ScheduledAgentRun {
  return {
    id: makeRunId(),
    agentId: agent.id,
    agentName: agent.name,
    prompt: agent.prompt,
    status: "queued",
    createdAt: now,
    trace: [],
  };
}

export function appendScheduledRun(
  runs: ScheduledAgentRun[],
  run: ScheduledAgentRun,
  limit = 50,
): ScheduledAgentRun[] {
  return [run, ...runs.filter((existing) => existing.id !== run.id)].slice(0, Math.max(1, limit));
}

export function dueScheduledAgents(
  agents: ScheduledAgent[],
  runs: ScheduledAgentRun[],
  now = Date.now(),
): ScheduledAgent[] {
  const busyAgentIds = new Set(
    runs.filter((run) => RUNNING_STATUSES.has(run.status)).map((run) => run.agentId),
  );
  return agents.filter((agent) =>
    agent.enabled &&
    agent.nextRunAt <= now &&
    !busyAgentIds.has(agent.id),
  );
}

export function updateScheduledAgentAfterRun(
  agent: ScheduledAgent,
  completion: ScheduledRunCompletion,
): ScheduledAgent {
  return {
    ...agent,
    nextRunAt: completion.nextRunAt,
    lastRunAt: completion.completedAt,
    lastStatus: completion.status === "done" ? "done" : "error",
    lastResult: completion.status === "done"
      ? completion.result
      : completion.error || (completion.status === "missed" ? "Scheduled run missed." : "Scheduled run failed."),
  };
}

function sanitizeRun(raw: unknown): ScheduledAgentRun | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.agentId !== "string") return null;
  if (typeof row.agentName !== "string" || typeof row.prompt !== "string") return null;
  const status = row.status;
  const safeStatus: ScheduledAgentRunStatus =
    status === "queued" || status === "running" || status === "done" || status === "error" || status === "missed"
      ? status
      : "error";
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agentName,
    prompt: row.prompt,
    status: safeStatus,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
    startedAt: typeof row.startedAt === "number" ? row.startedAt : undefined,
    completedAt: typeof row.completedAt === "number" ? row.completedAt : undefined,
    result: typeof row.result === "string" ? row.result : undefined,
    error: typeof row.error === "string" ? row.error : undefined,
    trace: Array.isArray(row.trace) ? row.trace.filter((entry): entry is string => typeof entry === "string") : [],
    outputArtifactIds: Array.isArray(row.outputArtifactIds)
      ? row.outputArtifactIds.filter((id): id is string => typeof id === "string")
      : undefined,
    conversationId: typeof row.conversationId === "string" ? row.conversationId : undefined,
    readAt: typeof row.readAt === "number" ? row.readAt : undefined,
  };
}

export function sanitizeScheduledAgentRuns(raw: unknown): ScheduledAgentRun[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeRun)
    .filter((run): run is ScheduledAgentRun => !!run)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function settleScheduledAgentRuntimeState(
  agents: ScheduledAgent[],
  runs: ScheduledAgentRun[],
): { agents: ScheduledAgent[]; runs: ScheduledAgentRun[] } {
  const nextAgents = agents.map((agent) =>
    agent.lastStatus === "running"
      ? { ...agent, lastStatus: "error" as const, lastResult: "Scheduled run interrupted." }
      : agent,
  );
  const nextRuns = sanitizeScheduledAgentRuns(runs).map((run) =>
    RUNNING_STATUSES.has(run.status)
      ? {
          ...run,
          status: "error" as const,
          error: run.error || "Scheduled run interrupted.",
          completedAt: run.completedAt ?? Date.now(),
        }
      : run,
  );
  return { agents: nextAgents, runs: nextRuns };
}

export function buildContinueScheduledRunPrompt(run: ScheduledAgentRun): string {
  const trace = run.trace.length > 0 ? run.trace.map((entry) => `- ${entry}`).join("\n") : "- No trace captured.";
  const result = run.result || run.error || "No result was captured.";
  return [
    `Scheduled agent: ${run.agentName}`,
    `Status: ${run.status}`,
    `Original prompt:\n${run.prompt}`,
    `Trace:\n${trace}`,
    `Result:\n${result}`,
    "Continue from this scheduled run. Preserve useful context, call out any stale assumptions, and help the user take the next step.",
  ].join("\n\n");
}

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // SQLite mirror is best effort fallback.
  }
}

function mergeAgents(local: ScheduledAgent[], sqlite: ScheduledAgent[]): ScheduledAgent[] {
  const byId = new Map<string, ScheduledAgent>();
  for (const agent of sqlite) byId.set(agent.id, agent);
  for (const agent of local) byId.set(agent.id, { ...byId.get(agent.id), ...agent });
  return Array.from(byId.values());
}

function mergeRuns(local: ScheduledAgentRun[], sqlite: ScheduledAgentRun[]): ScheduledAgentRun[] {
  const byId = new Map<string, ScheduledAgentRun>();
  for (const run of sqlite) byId.set(run.id, run);
  for (const run of local) byId.set(run.id, { ...byId.get(run.id), ...run });
  return sanitizeScheduledAgentRuns(Array.from(byId.values())).slice(0, 200);
}

export async function loadScheduledAgentState(
  sanitizeAgents: (raw: unknown) => ScheduledAgent[],
): Promise<{ agents: ScheduledAgent[]; runs: ScheduledAgentRun[] }> {
  const localAgents = sanitizeAgents(safeReadJson<unknown>(SCHEDULED_AGENTS_KEY, []));
  const localRuns = sanitizeScheduledAgentRuns(safeReadJson<unknown>(SCHEDULED_AGENT_RUNS_KEY, []));
  try {
    const invoke = await getInvoke();
    const sqlite = await invoke<{ agents: ScheduledAgent[]; runs: ScheduledAgentRun[] }>("scheduled_agents_load");
    const agents = mergeAgents(localAgents, sanitizeAgents(sqlite.agents));
    const runs = mergeRuns(localRuns, sanitizeScheduledAgentRuns(sqlite.runs));
    const settled = settleScheduledAgentRuntimeState(agents, runs);
    safeWriteJson(SCHEDULED_AGENTS_KEY, settled.agents);
    safeWriteJson(SCHEDULED_AGENT_RUNS_KEY, settled.runs);
    return settled;
  } catch {
    return settleScheduledAgentRuntimeState(localAgents, localRuns);
  }
}

export function persistScheduledAgentState(agents: ScheduledAgent[], runs: ScheduledAgentRun[]) {
  const safeRuns = sanitizeScheduledAgentRuns(runs).slice(0, 200);
  safeWriteJson(SCHEDULED_AGENTS_KEY, agents);
  safeWriteJson(SCHEDULED_AGENT_RUNS_KEY, safeRuns);
  void (async () => {
    try {
      const invoke = await getInvoke();
      await invoke("scheduled_agents_save", {
        payload: { agents, runs: safeRuns },
      });
    } catch {
      // Synchronous local journal is already written.
    }
  })();
}
