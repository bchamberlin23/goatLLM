import type { Message, ToolCallEntry } from "../stores/chat";

export interface AgentTurnCheck {
  label: string;
  state: ToolCallEntry["state"];
  toolName: string;
}

export interface AgentTurnGroup {
  label: string;
  count: number;
  toolNames: string[];
}

export interface SuggestedVerificationCommand {
  command: string;
  label: string;
}

export interface RollbackFile {
  path: string;
  existed: boolean;
}

export interface RollbackPreviewRow {
  path: string;
  action: "restore" | "delete";
  beforeSnippet: string;
  afterSnippet: string;
}

export interface AgentTurnAuditEntry {
  label: string;
  detail?: string;
  tone: AgentTurnVerificationTone;
}

export interface AgentTurnDoneContract {
  status: "complete" | "blocked" | "failed" | "rolled_back";
  changedFiles: string[];
  checksRun: string[];
  failures: string[];
  nextSteps: string[];
}

export type AgentTurnVerificationStatus =
  | "not_applicable"
  | "missing"
  | "passed"
  | "failed"
  | "running";

export type AgentTurnVerificationTone = "neutral" | "warning" | "success" | "error";

export interface AgentTurnVerification {
  status: AgentTurnVerificationStatus;
  label: string;
  tone: AgentTurnVerificationTone;
}

export interface AgentTurnSummary {
  totalTools: number;
  completedTools: number;
  failedTools: number;
  runningTools: number;
  pendingApprovals: number;
  changedFiles: string[];
  checks: AgentTurnCheck[];
  groups: AgentTurnGroup[];
  suggestedChecks: SuggestedVerificationCommand[];
  rollbackFiles: RollbackFile[];
  subagentBypassCount: number;
  auditEntries: AgentTurnAuditEntry[];
  doneContract: AgentTurnDoneContract;
  verification: AgentTurnVerification;
}

const FILE_MUTATION_TOOLS = new Set(["write_file", "edit_file"]);
const VERIFICATION_TOOLS = new Set(["run_tests", "read_lints"]);
const READ_TOOLS = new Set([
  "read_file",
  "view_file",
  "list_dir",
  "search_content",
  "grep_search",
  "file_search",
  "search_semantic",
  "git_status",
  "git_log",
  "git_blame",
  "read_attachment",
  "search_attachment",
  "list_attachments",
]);

function inputString(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactSnippet(content: string | undefined, fallback: string): string {
  if (!content || !content.trim()) return fallback;
  const lines = content.trimEnd().split(/\r?\n/);
  const visible = lines.slice(0, 8).join("\n");
  return lines.length > 8 ? `${visible}\n...` : visible;
}

function isVerificationCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return (
    /\b(?:pnpm|npm|yarn|bun)\s+(?:test|run\s+test|build|run\s+build|lint|run\s+lint|typecheck|run\s+typecheck)\b/.test(normalized) ||
    /\bcargo\s+(?:test|check|clippy)\b/.test(normalized) ||
    /\b(?:vitest|jest|pytest|go\s+test|tsc|mvn\s+test|gradle\s+test)\b/.test(normalized)
  );
}

function verificationLabel(tc: ToolCallEntry): string | null {
  if (VERIFICATION_TOOLS.has(tc.toolName)) return tc.toolName;
  if (tc.toolName !== "bash" && tc.toolName !== "exec_command") return null;
  const command = inputString(tc.input, "command");
  if (!command || !isVerificationCommand(command)) return null;
  return command;
}

function buildVerification(
  changedFiles: Set<string>,
  checks: AgentTurnCheck[],
): AgentTurnVerification {
  if (checks.some((check) => check.state === "error")) {
    return { status: "failed", label: "Verification failed", tone: "error" };
  }

  if (checks.some((check) => check.state === "running" || check.state === "pending_approval")) {
    return { status: "running", label: "Verification pending", tone: "warning" };
  }

  if (checks.length > 0) {
    return { status: "passed", label: "Verified", tone: "success" };
  }

  if (changedFiles.size > 0) {
    return { status: "missing", label: "Needs verification", tone: "warning" };
  }

  return { status: "not_applicable", label: "No changes", tone: "neutral" };
}

function addGroup(groups: AgentTurnGroup[], label: string, toolName: string) {
  const existing = groups.find((group) => group.label === label);
  if (existing) {
    existing.count++;
    if (!existing.toolNames.includes(toolName)) existing.toolNames.push(toolName);
    return;
  }
  groups.push({ label, count: 1, toolNames: [toolName] });
}

function buildGroups(toolCalls: ToolCallEntry[]): AgentTurnGroup[] {
  const groups: AgentTurnGroup[] = [];
  for (const tc of toolCalls) {
    if (READ_TOOLS.has(tc.toolName)) addGroup(groups, "Read/search", tc.toolName);
    else if (FILE_MUTATION_TOOLS.has(tc.toolName)) addGroup(groups, "File changes", tc.toolName);
    else if (verificationLabel(tc)) addGroup(groups, "Verification", tc.toolName);
    else if (tc.toolName.startsWith("git_")) addGroup(groups, "Git", tc.toolName);
    else if (tc.toolName === "spawn_subagent") addGroup(groups, "Subagents", tc.toolName);
    else addGroup(groups, "Other tools", tc.toolName);
  }
  return groups;
}

function buildSuggestedChecks(changedFiles: Set<string>, checks: AgentTurnCheck[]): SuggestedVerificationCommand[] {
  if (changedFiles.size === 0 || checks.length > 0) return [];

  const suggestions = new Map<string, SuggestedVerificationCommand>();
  const add = (command: string, label: string) => suggestions.set(command, { command, label });
  const files = Array.from(changedFiles);

  if (files.some((file) => /\.(?:ts|tsx|js|jsx|css|json)$/.test(file))) {
    add("pnpm test", "Run tests");
    add("pnpm build", "Build app");
  }
  if (files.some((file) => /\.rs$|^Cargo\.toml$|\/Cargo\.toml$/.test(file))) {
    add("cargo test", "Run Rust tests");
  }
  if (suggestions.size === 0) add("pnpm test", "Run tests");

  return Array.from(suggestions.values());
}

function buildRollbackFiles(toolCalls: ToolCallEntry[]): RollbackFile[] {
  const byPath = new Map<string, RollbackFile>();
  for (const tc of toolCalls) {
    const snapshot = tc.rollbackSnapshot;
    if (!snapshot || byPath.has(snapshot.path)) continue;
    byPath.set(snapshot.path, {
      path: snapshot.path,
      existed: snapshot.existed,
    });
  }
  return Array.from(byPath.values());
}

export function buildRollbackPreview(message: Pick<Message, "toolCalls">): RollbackPreviewRow[] {
  const rows = new Map<string, RollbackPreviewRow>();
  for (const tc of message.toolCalls ?? []) {
    const snapshot = tc.rollbackSnapshot;
    if (!snapshot || rows.has(snapshot.path)) continue;
    rows.set(snapshot.path, {
      path: snapshot.path,
      action: snapshot.existed ? "restore" : "delete",
      beforeSnippet: snapshot.existed
        ? compactSnippet(snapshot.content, "(empty file)")
        : "(file did not exist)",
      afterSnippet: compactSnippet(inputString(tc.input, "content"), "(current content unavailable)"),
    });
  }
  return Array.from(rows.values());
}

function buildAuditEntries(message: Pick<Message, "toolCalls" | "rollbackResult">): AgentTurnAuditEntry[] {
  const entries: AgentTurnAuditEntry[] = [];
  for (const tc of message.toolCalls ?? []) {
    const path = inputString(tc.input, "path");
    if (tc.toolName === "edit_file") {
      entries.push({ label: `Edited ${path ?? "file"}`, tone: "neutral" });
    } else if (tc.toolName === "write_file") {
      entries.push({ label: `Wrote ${path ?? "file"}`, tone: "neutral" });
    } else if (verificationLabel(tc)) {
      entries.push({
        label: tc.state === "error" ? "Check failed" : "Verification ran",
        detail: verificationLabel(tc) ?? undefined,
        tone: tc.state === "error" ? "error" : "success",
      });
    } else if (tc.approvalBypassed) {
      entries.push({
        label: "Subagent bypassed approvals",
        detail: tc.toolName,
        tone: "warning",
      });
    }
  }
  if (message.rollbackResult?.status === "done") {
    entries.push({
      label: "Rollback completed",
      detail: `${message.rollbackResult.files.length} ${message.rollbackResult.files.length === 1 ? "file" : "files"} restored`,
      tone: "success",
    });
  } else if (message.rollbackResult?.status === "error") {
    entries.push({
      label: "Rollback failed",
      detail: message.rollbackResult.error,
      tone: "error",
    });
  }
  return entries;
}

function buildDoneContract(
  message: Pick<Message, "rollbackResult">,
  changedFiles: string[],
  checks: AgentTurnCheck[],
): AgentTurnDoneContract {
  const failures = checks.filter((check) => check.state === "error").map((check) => check.label);
  const checksRun = checks.map((check) => check.label);
  if (message.rollbackResult?.status === "done") {
    return {
      status: "rolled_back",
      changedFiles,
      checksRun,
      failures,
      nextSteps: [],
    };
  }
  if (failures.length > 0) {
    return {
      status: "failed",
      changedFiles,
      checksRun,
      failures,
      nextSteps: ["Fix failing verification"],
    };
  }
  if (changedFiles.length > 0 && checks.length === 0) {
    return {
      status: "blocked",
      changedFiles,
      checksRun,
      failures,
      nextSteps: ["Run verification checks before marking done"],
    };
  }
  return {
    status: "complete",
    changedFiles,
    checksRun,
    failures,
    nextSteps: [],
  };
}

export function summarizeAgentTurn(message: Pick<Message, "toolCalls" | "editedFiles" | "rollbackResult">): AgentTurnSummary {
  const toolCalls = message.toolCalls ?? [];
  const changedFiles = new Set<string>(message.editedFiles ?? []);
  const checks: AgentTurnCheck[] = [];

  let completedTools = 0;
  let failedTools = 0;
  let runningTools = 0;
  let pendingApprovals = 0;

  for (const tc of toolCalls) {
    if (tc.state === "done") completedTools++;
    if (tc.state === "error") failedTools++;
    if (tc.state === "running") runningTools++;
    if (tc.state === "pending_approval") pendingApprovals++;

    if (FILE_MUTATION_TOOLS.has(tc.toolName)) {
      const path = inputString(tc.input, "path");
      if (path) changedFiles.add(path);
    }

    const label = verificationLabel(tc);
    if (label) {
      checks.push({
        label,
        state: tc.state,
        toolName: tc.toolName,
      });
    }
  }

  const changedFileList = Array.from(changedFiles);

  return {
    totalTools: toolCalls.length,
    completedTools,
    failedTools,
    runningTools,
    pendingApprovals,
    changedFiles: changedFileList,
    checks,
    groups: buildGroups(toolCalls),
    suggestedChecks: buildSuggestedChecks(changedFiles, checks),
    rollbackFiles: buildRollbackFiles(toolCalls),
    subagentBypassCount: toolCalls.filter((tc) => tc.approvalBypassed).length,
    auditEntries: buildAuditEntries(message),
    doneContract: buildDoneContract(message, changedFileList, checks),
    verification: buildVerification(changedFiles, checks),
  };
}
