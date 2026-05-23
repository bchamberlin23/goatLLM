/**
 * Command safety classifier for exec_command.
 * Rates commands as safe, suspicious, or destructive to determine
 * the level of user confirmation required.
 */

export type DangerLevel = "safe" | "suspicious" | "destructive";

// Patterns that indicate destructive operations
const DESTRUCTIVE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+(-[rRf]+\s+)+/, reason: "Deletes files recursively" },
  { pattern: /\brmdir\b/, reason: "Removes directories" },
  { pattern: /\bgit\s+push\s+.*--force/, reason: "Force-pushes to remote" },
  { pattern: /\bgit\s+push\s+.*-f\b/, reason: "Force-pushes to remote" },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "Hard reset — loses uncommitted changes" },
  { pattern: /\bgit\s+clean\s+-[fd]/, reason: "Deletes untracked files" },
  { pattern: /\bDROP\s+(TABLE|DATABASE|INDEX)\b/i, reason: "Drops database objects" },
  { pattern: /\bDELETE\s+FROM\b/i, reason: "Deletes database rows" },
  { pattern: /\bTRUNCATE\b/i, reason: "Truncates database table" },
  { pattern: /\bsudo\b/, reason: "Runs with superuser privileges" },
  { pattern: /\bchmod\s+777\b/, reason: "World-writable permissions" },
  { pattern: /\bmv\s+\S+\s+\/etc\//, reason: "Modifies system config" },
  { pattern: /\bdd\s+if=/, reason: "Raw device write" },
  { pattern: /\bmkfs\./, reason: "Formats a filesystem" },
  { pattern: /\bshutdown\b/, reason: "Shuts down the system" },
  { pattern: /\breboot\b/, reason: "Reboots the system" },
  { pattern: /\b:\(\)\s*\{\s*:\|\:&\s*\}\s*;/, reason: "Fork bomb" },
];

// Patterns that indicate suspicious but not necessarily destructive operations
const SUSPICIOUS_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/, reason: "Piping download into shell" },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh\b/, reason: "Piping download into shell" },
  { pattern: /\beval\b/, reason: "Evaluates arbitrary code" },
  { pattern: /\bsource\s+\//, reason: "Sources absolute-path script" },
  { pattern: /\bchmod\b/, reason: "Changes file permissions" },
  { pattern: /\bchown\b/, reason: "Changes file ownership" },
  { pattern: /\bkill\s+-9\b/, reason: "Force-kills processes" },
  { pattern: /\bgit\s+push\b/, reason: "Pushes to remote" },
  { pattern: /\bdocker\s+(rm|prune)\b/, reason: "Removes Docker resources" },
  { pattern: /\bnpm\s+(unpublish|deprecate)\b/, reason: "Modifies npm registry" },
  { pattern: /\bgh\s+repo\s+delete\b/, reason: "Deletes GitHub repository" },
];

export interface Classification {
  level: DangerLevel;
  reason: string | null;
}

/**
 * Classify a shell command by danger level.
 * Returns the highest-matching classification and a human-readable reason.
 */
export function classifyCommand(command: string): Classification {
  // Check destructive first
  for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { level: "destructive", reason };
    }
  }

  // Check suspicious
  for (const { pattern, reason } of SUSPICIOUS_PATTERNS) {
    if (pattern.test(command)) {
      return { level: "suspicious", reason };
    }
  }

  return { level: "safe", reason: null };
}
