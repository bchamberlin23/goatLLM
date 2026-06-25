import type { Message, ToolCallEntry } from "../stores/chat";
import { summarizeAgentTurn, type RollbackFile, type SuggestedVerificationCommand } from "./agent-turn-summary";

export interface VerificationPolicy {
  requireBuildForWeb: boolean;
  requireRustTests: boolean;
  customCommands: string[];
}

export interface ProjectCheckMemory {
  successfulCommands: string[];
  flakyCommands?: string[];
  failedCommands?: Record<string, number>;
}

export interface AgentCheckpoint {
  messageId: string;
  createdAt: number;
  changedFiles: string[];
  verificationLabel: string;
  status: ReturnType<typeof summarizeAgentTurn>["doneContract"]["status"];
  rollbackFiles: RollbackFile[];
  name?: string;
}

export interface LineHunk {
  type: "context" | "added" | "removed";
  line: string;
}

export interface FailedCheckDiagnostic {
  headline: string;
  nextCommand: string;
}

export interface ApprovalHistoryEntry {
  toolCallId: string;
  toolName: string;
  label: string;
  state: ToolCallEntry["state"];
  risk?: ToolCallEntry["dangerLevel"];
}

export interface PathPermissionRule {
  pattern: string;
  action: "auto" | "ask" | "block";
}

export interface AgentBudgetControls {
  maxToolCalls: number;
  maxSubagents: number;
  maxMinutes: number;
}

const DEFAULT_LABELS = new Map<string, string>([
  ["pnpm test", "Run tests"],
  ["pnpm build", "Build app"],
  ["cargo test", "Run Rust tests"],
]);

function inputString(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function addSuggestion(
  suggestions: Map<string, SuggestedVerificationCommand>,
  command: string,
  label = DEFAULT_LABELS.get(command) ?? command,
) {
  suggestions.set(command, { command, label });
}

export function buildLineHunks(before: string, after: string): LineHunk[] {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const rows: LineHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length || j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      rows.push({ type: "context", line: beforeLines[i] ?? "" });
      i++;
      j++;
    } else if (beforeLines[i + 1] === afterLines[j]) {
      rows.push({ type: "removed", line: beforeLines[i] ?? "" });
      i++;
    } else if (beforeLines[i] === afterLines[j + 1]) {
      rows.push({ type: "added", line: afterLines[j] ?? "" });
      j++;
    } else {
      if (i < beforeLines.length) rows.push({ type: "removed", line: beforeLines[i++] });
      if (j < afterLines.length) rows.push({ type: "added", line: afterLines[j++] });
    }
  }
  return rows;
}

function isVerificationToolCall(tc: ToolCallEntry): boolean {
  if (tc.toolName === "run_tests" || tc.toolName === "read_lints") return true;
  if (tc.toolName !== "bash" && tc.toolName !== "exec_command") return false;
  const command = inputString(tc.input, "command")?.toLowerCase() ?? "";
  return /\b(?:pnpm|npm|yarn|bun)\s+(?:test|build|lint|typecheck|run\s+(?:test|build|lint|typecheck))\b/.test(command) ||
    /\bcargo\s+(?:test|check|clippy)\b/.test(command) ||
    /\b(?:vitest|jest|pytest|go\s+test|tsc)\b/.test(command);
}

export function buildVerificationSuggestions(
  changedFiles: string[],
  policy: VerificationPolicy,
  memory: ProjectCheckMemory,
): SuggestedVerificationCommand[] {
  const suggestions = new Map<string, SuggestedVerificationCommand>();
  const hasWebChange = changedFiles.some((file) => /\.(?:ts|tsx|js|jsx|css|json)$/.test(file));
  const hasRustChange = changedFiles.some((file) => /\.rs$|^Cargo\.toml$|\/Cargo\.toml$/.test(file));

  if (hasWebChange) addSuggestion(suggestions, "pnpm test");
  if (hasWebChange && policy.requireBuildForWeb) addSuggestion(suggestions, "pnpm build");
  if (hasRustChange && policy.requireRustTests) addSuggestion(suggestions, "cargo test");
  for (const command of policy.customCommands) addSuggestion(suggestions, command);
  for (const command of memory.successfulCommands) addSuggestion(suggestions, command);
  if (changedFiles.length > 0 && suggestions.size === 0) addSuggestion(suggestions, "pnpm test");

  return Array.from(suggestions.values());
}

export function canMarkAgentDone(message: Message): { allowed: boolean; reason?: string } {
  const summary = summarizeAgentTurn(message);
  if (summary.doneContract.status === "blocked") {
    return { allowed: false, reason: "Run required verification checks before marking done." };
  }
  if (summary.doneContract.status === "failed") {
    return { allowed: false, reason: "Fix failing verification before marking done." };
  }
  return { allowed: true };
}

export function workspacePolicyStorageKey(workspacePath: string): string {
  return `goatllm-policy:${workspacePath}`;
}

export function discoverCheckCommands(files: Record<string, string>): string[] {
  const commands = new Set<string>();
  const packageJson = files["package.json"];
  if (packageJson) {
    try {
      const scripts = JSON.parse(packageJson).scripts ?? {};
      if (scripts.test) commands.add("pnpm test");
      if (scripts.build) commands.add("pnpm build");
      if (scripts.lint) commands.add("pnpm lint");
      if (scripts.typecheck) commands.add("pnpm typecheck");
    } catch {
      // ignore malformed package metadata
    }
  }
  if (files["Cargo.toml"]) commands.add("cargo test");
  if (files["pytest.ini"] || files["pyproject.toml"] || files["setup.cfg"]) commands.add("pytest");
  return Array.from(commands);
}

export function summarizeFailedCheck(output: string): FailedCheckDiagnostic {
  const testFile = output.match(/\b([\w./-]+(?:test|spec)\.(?:ts|tsx|js|jsx|py|rs))\b/i)?.[1];
  if (testFile) {
    return {
      headline: `Test failure in ${testFile}`,
      nextCommand: testFile.endsWith(".py") ? `pytest ${testFile}` : `pnpm test ${testFile}`,
    };
  }
  const firstLine = output.trim().split(/\r?\n/).find(Boolean) ?? "Verification failed";
  return { headline: firstLine.slice(0, 120), nextCommand: "Re-run the failing check" };
}

export function buildApprovalHistory(messages: Message[]): ApprovalHistoryEntry[] {
  return messages.flatMap((message) => (message.toolCalls ?? [])
    .filter((tc) => tc.state !== "running" && tc.state !== "pending_approval")
    .map((tc) => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      label: inputString(tc.input, "command") ?? inputString(tc.input, "path") ?? tc.toolName,
      state: tc.state,
      risk: tc.dangerLevel,
    })));
}

export function planTransactionalRestore(files: string[]): string[] {
  return [
    `Capture current state for ${files.length} ${files.length === 1 ? "file" : "files"}`,
    "Restore checkpoint files",
    "Verify restored files are writable",
    "On failure, restore captured current state",
  ];
}

export function nameCheckpoints(
  checkpoints: AgentCheckpoint[],
  names: Record<string, string>,
): Array<AgentCheckpoint & { name?: string }> {
  return checkpoints.map((checkpoint) => ({ ...checkpoint, name: names[checkpoint.messageId] }));
}

export function buildWorkspaceHealthDashboard(messages: Message[], memory: ProjectCheckMemory) {
  const agentTurns = messages.filter((message) => message.role === "assistant" && message.toolCalls?.length);
  const latest = agentTurns.length > 0 ? summarizeAgentTurn(agentTurns[agentTurns.length - 1]) : null;
  return {
    latestStatus: latest?.doneContract.status ?? "complete",
    failedChecks: latest?.checks.filter((check) => check.state === "error").map((check) => check.label) ?? [],
    pendingApprovals: latest?.pendingApprovals ?? 0,
    rememberedChecks: memory.successfulCommands,
    flakyCommands: memory.flakyCommands ?? [],
  };
}

export function buildReplayPrompt(messages: Message[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  return `Replay this request: ${lastUser?.content.trim() || "the previous task"}`;
}

export function compareSubagentFindings(findings: string[]) {
  const counts = new Map<string, number>();
  for (const finding of findings.map((item) => item.trim()).filter(Boolean)) {
    counts.set(finding, (counts.get(finding) ?? 0) + 1);
  }
  return {
    agreements: Array.from(counts.entries()).filter(([, count]) => count > 1).map(([finding]) => finding),
    disagreements: Array.from(counts.entries()).filter(([, count]) => count === 1).map(([finding]) => finding),
  };
}

export function explainToolRisk(toolName: string, input: unknown): string {
  const command = inputString(input, "command")?.toLowerCase() ?? "";
  if (toolName === "bash" || toolName === "exec_command") {
    if (/\brm\s+-rf\b|\bsudo\b|>\s*\/|--force\b/.test(command)) return "destructive shell command; requires explicit approval";
    if (/\b(?:curl|wget|chmod|chown|mv|cp)\b/.test(command)) return "suspicious shell command; review before running";
    return "safe-looking shell command; still approval-gated";
  }
  if (toolName === "write_file" || toolName === "edit_file") return "file mutation; checkpoint will be captured first";
  return "read-only or low-risk tool";
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

export function evaluatePathPermission(path: string, rules: PathPermissionRule[]): PathPermissionRule["action"] {
  for (const rule of rules) {
    if (globToRegExp(rule.pattern).test(path)) return rule.action;
  }
  return "ask";
}

export function rememberCheckResult(
  memory: ProjectCheckMemory,
  command: string,
  state: ToolCallEntry["state"],
): ProjectCheckMemory {
  const successful = new Set(memory.successfulCommands);
  const flaky = new Set(memory.flakyCommands ?? []);
  const failedCommands = { ...(memory.failedCommands ?? {}) };
  if (state === "error") {
    failedCommands[command] = (failedCommands[command] ?? 0) + 1;
  } else if (state === "done") {
    if (failedCommands[command]) flaky.add(command);
    successful.add(command);
  }
  return {
    successfulCommands: Array.from(successful).slice(-12),
    flakyCommands: Array.from(flaky).slice(-12),
    failedCommands,
  };
}

export type SessionFilter = "all" | "tools" | "failed" | "checkpoints";

export function filterSessionItems(messages: Message[], filter: SessionFilter): Message[] {
  if (filter === "all") return messages;
  if (filter === "tools") return messages.filter((message) => message.toolCalls?.length);
  if (filter === "failed") return messages.filter((message) => message.toolCalls?.some((tc) => tc.state === "error"));
  return messages.filter((message) => message.toolCalls?.some((tc) => tc.rollbackSnapshot));
}

export function buildGitIntegrationSuggestions(status: ReturnType<typeof summarizeAgentTurn>["doneContract"]["status"]): string[] {
  if (status === "complete") return ["Commit verified changes", "Create branch from checkpoint"];
  if (status === "blocked") return ["Run checks before commit", "Create branch from checkpoint"];
  if (status === "failed") return ["Fix checks before commit", "Discard unverified changes"];
  return ["Create branch from checkpoint"];
}

export function buildFileImpactSummary(path: string, before: string, after: string): string {
  const delta = after.split(/\r?\n/).length - before.split(/\r?\n/).length;
  const direction = delta === 0 ? "with no line count change" : `by ${Math.abs(delta)} ${Math.abs(delta) === 1 ? "line" : "lines"}`;
  return `${path} changed ${direction}`;
}

export function applyBudgetControls(controls: AgentBudgetControls): string {
  const subagentBudget = controls.maxSubagents <= 0
    ? "unlimited subagents"
    : `${controls.maxSubagents} ${controls.maxSubagents === 1 ? "subagent" : "subagents"}`;
  return `Max ${controls.maxToolCalls} tool calls, ${subagentBudget}, ${controls.maxMinutes} minutes`;
}

export function sessionOnboardingSteps({
  hasWorkspace,
  hasPolicy,
  hasChecks,
}: {
  hasWorkspace: boolean;
  hasPolicy: boolean;
  hasChecks: boolean;
}): string[] {
  const steps: string[] = [];
  if (!hasWorkspace) steps.push("Choose a workspace");
  if (!hasPolicy) steps.push("Pick a permission profile");
  if (!hasChecks) steps.push("Confirm verification checks");
  return steps;
}

export function buildAgentCheckpoints(messages: Message[]): AgentCheckpoint[] {
  return messages
    .filter((message) => message.role === "assistant" && message.toolCalls?.some((tc) => tc.rollbackSnapshot))
    .map((message) => {
      const summary = summarizeAgentTurn(message);
      return {
        messageId: message.id,
        createdAt: message.createdAt,
        changedFiles: summary.changedFiles,
        verificationLabel: summary.verification.label,
        status: summary.doneContract.status,
        rollbackFiles: summary.rollbackFiles,
      };
    });
}

export function rememberSuccessfulChecks(memory: ProjectCheckMemory, message: Pick<Message, "toolCalls">): ProjectCheckMemory {
  const commands = new Set(memory.successfulCommands);
  for (const tc of message.toolCalls ?? []) {
    if (tc.state !== "done" || !isVerificationToolCall(tc)) continue;
    const command = inputString(tc.input, "command");
    if (command) commands.add(command);
  }
  return { successfulCommands: Array.from(commands).slice(-12) };
}

export function buildSessionExport({
  conversationTitle,
  workspacePath,
  messages,
}: {
  conversationTitle: string;
  workspacePath?: string | null;
  messages: Message[];
}): string {
  const lines: string[] = [
    `# ${conversationTitle} Audit`,
    "",
    `Workspace: \`${workspacePath || "none"}\``,
    `Messages: ${messages.length}`,
    "",
  ];

  for (const message of messages) {
    if (message.role === "user") {
      lines.push(`## User: ${message.content.trim() || "(empty)"}`, "");
      continue;
    }
    if (message.role !== "assistant") continue;
    const summary = summarizeAgentTurn(message);
    lines.push(`## Assistant turn \`${message.id}\``, "");
    lines.push(`Status: ${summary.doneContract.status}`);
    lines.push(`Verification: ${summary.verification.label}`);
    if (summary.changedFiles.length > 0) {
      lines.push(`Changed files: ${summary.changedFiles.map((file) => `\`${file}\``).join(", ")}`);
    }
    for (const tc of message.toolCalls ?? []) {
      lines.push(`- Tool: ${tc.toolName} (${tc.state})`);
      const command = inputString(tc.input, "command");
      const path = inputString(tc.input, "path");
      if (command) lines.push(`  - Command: \`${command}\``);
      if (path) lines.push(`  - Path: \`${path}\``);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildSessionExportJson({
  conversationTitle,
  workspacePath,
  messages,
}: {
  conversationTitle: string;
  workspacePath?: string | null;
  messages: Message[];
}): string {
  return JSON.stringify({
    title: conversationTitle,
    workspacePath: workspacePath ?? null,
    exportedAt: new Date(0).toISOString(),
    turns: messages
      .filter((message) => message.role === "assistant")
      .map((message) => {
        const summary = summarizeAgentTurn(message);
        return {
          id: message.id,
          createdAt: message.createdAt,
          status: summary.doneContract.status,
          verification: summary.verification.label,
          changedFiles: summary.changedFiles,
          tools: (message.toolCalls ?? []).map((tc) => ({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            state: tc.state,
            input: tc.input,
            risk: tc.dangerLevel ?? null,
          })),
        };
      }),
  }, null, 2);
}
