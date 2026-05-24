/**
 * Skills loader — Agent Skills standard implementation.
 *
 * Implements the [Agent Skills](https://agentskills.io/specification) format
 * with pi-compatible discovery rules. Skills can live in:
 *
 *   Global:
 *     ~/.goat/skills/          (native, highest priority)
 *     ~/.pi/agent/skills/      (pi compat)
 *     ~/.claude/skills/        (Claude Code compat)
 *     ~/.agents/skills/        (generic agents compat)
 *
 *   Project:
 *     .goat/skills/            (native, highest priority)
 *     .pi/skills/              (pi compat)
 *     .claude/skills/          (Claude Code compat)
 *     .agents/skills/          (generic agents compat)
 *
 *   Custom: user-configured directories (stored as `skillPaths` in the store).
 *
 * At startup we scan every location and build a `Skill[]` array with name,
 * description, filePath, and baseDir. The model decides when to load a
 * SKILL.md via read_file based on the XML descriptions in the system prompt.
 *
 * Discovery rules (mirrors pi):
 *  - A directory containing SKILL.md is a skill root; do not recurse further.
 *  - Otherwise, recurse into subdirectories looking for SKILL.md.
 *  - Direct root .md files are skills for `.goat/skills` and `.pi/skills`;
 *    for `.agents/skills` they are ignored (spec compliance).
 *  - Directories starting with `.` are skipped.
 *  - `node_modules` is skipped.
 */

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  /** When true, the model cannot invoke this skill on its own; the user must
   *  call `/skill:name` or pick it from the UI. */
  disableModelInvocation: boolean;
  /** Hint shown in autocomplete, e.g. "[path]" or "[query]". */
  argumentHint?: string;
  /** Slash-command names this skill also registers as. */
  aliases?: string[];
  /** Source label for the UI, e.g. "~/.goat/skills" or "project/.goat/skills". */
  source: string;
  /** Which goatLLM mode the skill applies to.
   *   - "agent": needs tool access (read/write/bash) — most pi and Claude skills.
   *   - "chat":  pure prompt injection, no tools required — personas, expertise modes.
   *   - "both":  works in either mode (e.g. design knowledge).
   * Defaults to "agent" since the Agent Skills standard assumes tool use. */
  mode: "agent" | "chat" | "both";
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  "disable-model-invocation"?: boolean;
  "argument-hint"?: string;
  aliases?: string | string[];
  /** goatLLM extension: which mode the skill applies to. */
  mode?: "agent" | "chat" | "both";
  [key: string]: unknown;
}

export interface LoadSkillsResult {
  skills: Skill[];
  errorMessages: string[];
}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

// ── Tauri abs-path helpers (thin wrappers around the Rust commands above) ──

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

async function listDirAbs(path: string): Promise<{ name: string; is_dir: boolean; size: number }[]> {
  try {
    return await invoke("list_dir_abs", { path });
  } catch {
    return [];
  }
}

async function readTextFileAbs(path: string): Promise<string> {
  return invoke<string>("read_text_file_abs", { path });
}

async function pathExistsAbs(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>("path_exists_abs", { path });
  } catch {
    return false;
  }
}

async function getGoatAgentDir(): Promise<string> {
  return invoke<string>("goat_agent_dir");
}

async function getHomeDir(): Promise<string> {
  return invoke<string>("home_dir");
}

// ── Frontmatter parsing ──

function parseFrontmatter(raw: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split(/\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    meta[kv[1]] = v;
  }
  return { meta, body: (m[2] ?? "").replace(/^\n+/, "") };
}

function parseSkillFrontmatter(raw: string): {
  meta: SkillFrontmatter;
  content: string;
} {
  const { meta: rawMeta, body } = parseFrontmatter(raw);
  const meta: SkillFrontmatter = {};
  for (const [k, v] of Object.entries(rawMeta)) {
    if (k === "disable-model-invocation") {
      meta["disable-model-invocation"] =
        v === "true" || v === "yes" || v === "1" || v === true;
    } else if (k === "argument-hint") {
      meta["argument-hint"] = String(v);
    } else if (k === "aliases") {
      if (typeof v === "string") {
        meta.aliases = v.split(",").map((s) => s.trim());
      } else if (Array.isArray(v)) {
        meta.aliases = v.map((s) => String(s).trim());
      } else {
        meta.aliases = [String(v).trim()];
      }
    } else if (k === "mode") {
      const m = String(v).toLowerCase().trim();
      if (m === "agent" || m === "chat" || m === "both") {
        meta.mode = m;
      }
    } else {
      meta[k] = v;
    }
  }
  return { meta, content: body };
}

function validateName(name: string): string[] {
  const errors: string[] = [];
  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }
  // lowercase a-z, 0-9, hyphens — no leading/trailing hyphens, no consecutive
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name)) {
    errors.push(
      `name contains invalid characters (lowercase a-z, 0-9, hyphens only, no leading/trailing hyphens)`,
    );
  }
  if (name.includes("--")) {
    errors.push(`name must not contain consecutive hyphens`);
  }
  return errors;
}

function validateDescription(desc: string): string[] {
  const errors: string[] = [];
  if (!desc || desc.trim() === "") {
    errors.push("description is required");
  } else if (desc.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  return errors;
}

// ── Discovery ──

interface LoadDirOptions {
  dir: string;
  source: string;
  includeRootFiles: boolean;
}

async function loadSkillsFromDir(
  options: LoadDirOptions,
): Promise<{ skills: Skill[]; errors: string[] }> {
  const { dir, source, includeRootFiles } = options;
  if (!(await pathExistsAbs(dir))) return { skills: [], errors: [] };

  const skills: Skill[] = [];
  const errors: string[] = [];

  const entries = await listDirAbs(dir);
  if (entries.length === 0) return { skills: [], errors: [] };

  // Pass 1: check for SKILL.md (this dir IS a skill root, stop here)
  for (const entry of entries) {
    if (entry.name === "SKILL.md" && !entry.is_dir) {
      const result = await loadSkillFromFile(`${dir}/SKILL.md`, source);
      if (result.skill) skills.push(result.skill);
      errors.push(...result.errors);
      return { skills, errors };
    }
  }

  // Pass 2: direct root .md files (when includeRootFiles is true).
  // Pi's `.agents/skills` excludes root .md; `.goat/skills` and
  // `.pi/skills` include them. We follow the same rule.
  if (includeRootFiles) {
    for (const entry of entries) {
      if (entry.is_dir) continue;
      if (!entry.name.endsWith(".md")) continue;
      if (entry.name === "SKILL.md") continue; // already handled above
      const result = await loadSkillFromFile(`${dir}/${entry.name}`, source);
      if (result.skill) {
        // Strip .md for the name unless the file is literally "SKILL.md"
        const name = entry.name.replace(/\.md$/i, "");
        const nameErrors = validateName(name);
        if (nameErrors.length > 0) {
          errors.push(
            `${dir}/${entry.name}: ${nameErrors.join(", ")}`,
          );
          continue;
        }
        result.skill.name = name;
        skills.push(result.skill);
      }
      errors.push(...result.errors);
    }
  }

  // Pass 3: recurse into subdirectories
  for (const entry of entries) {
    if (!entry.is_dir) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const recurse = await loadSkillsFromDir({
      dir: `${dir}/${entry.name}`,
      source,
      includeRootFiles: false, // subdirs are always skill-root only
    });
    skills.push(...recurse.skills);
    errors.push(...recurse.errors);
  }

  return { skills, errors };
}

interface LoadSkillFileResult {
  skill?: Skill;
  errors: string[];
}

async function loadSkillFromFile(
  filePath: string,
  source: string,
): Promise<LoadSkillFileResult> {
  const errors: string[] = [];
  try {
    const raw = await readTextFileAbs(filePath);
    const { meta, content } = parseSkillFrontmatter(raw);

    const name = meta.name ?? "";
    const desc = meta.description ?? content.slice(0, 1024).trim();

    // Validate
    const nameErrs = name ? validateName(name) : ["name is required"];
    const descErrs = validateDescription(desc);
    if (nameErrs.length > 0) {
      errors.push(`${filePath}: name — ${nameErrs.join(", ")}`);
    }
    if (descErrs.length > 0) {
      errors.push(`${filePath}: description — ${descErrs.join(", ")}`);
    }

    if (nameErrs.length > 0 || (!name && descErrs.length > 0)) {
      return { errors, skill: undefined };
    }

    const baseDir = filePath.replace(/\/[^/]+$/, "");

    const skill: Skill = {
      name: name || "unnamed",
      description: desc,
      filePath,
      baseDir,
      disableModelInvocation: meta["disable-model-invocation"] === true,
      argumentHint:
        typeof meta["argument-hint"] === "string"
          ? meta["argument-hint"]
          : undefined,
      aliases:
        Array.isArray(meta.aliases) && meta.aliases.length > 0
          ? meta.aliases
          : undefined,
      source,
      mode: meta.mode ?? "agent",
    };

    return { skill, errors };
  } catch (e) {
    errors.push(`${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    return { errors };
  }
}

// ── Public API ──

export interface LoadAllSkillsOptions {
  /** User-configured extra skill directories. */
  customPaths: string[];
  /** Whether to include the default global/project directories. */
  includeDefaults: boolean;
}

/**
 * Load all skills from all locations. Deduplicates by name (first-match
 * wins — earlier sources take priority). Returns a flat list suitable for
 * display in Settings and injection into the system prompt.
 */
export async function loadAllSkills(
  options: LoadAllSkillsOptions,
): Promise<LoadSkillsResult> {
  const skills: Skill[] = [];
  const allErrors: string[] = [];
  const seen = new Set<string>();

  const add = (s: Skill) => {
    if (seen.has(s.name)) return;
    seen.add(s.name);
    skills.push(s);
  };

  // --- Resolve home dir (needed for default sources AND custom paths) ---
  const home = await getHomeDir().catch(() => "");

  // --- Default sources ---
  if (options.includeDefaults) {
    let goatAgent: string;
    try {
      goatAgent = await getGoatAgentDir();
    } catch {
      goatAgent = `${home}/.goat/agent`;
    }
    const goatSkillsDir = `${goatAgent}/skills`;

    // 1. goatLLM's own seeded directory — the only built-in source we
    //    auto-load. We deliberately do NOT pick up `~/.pi/agent/skills`,
    //    `~/.claude/skills`, or `~/.agents/skills` automatically anymore;
    //    they were dragging in unrelated skills (autoplan, ship, etc.) the
    //    user never asked for. If you want those, add the directory under
    //    Settings → Skills → custom paths.
    const gNative = await loadSkillsFromDir({
      dir: `${goatSkillsDir}`,
      source: `${goatSkillsDir}`,
      includeRootFiles: true,
    });
    gNative.skills.forEach(add);
    allErrors.push(...gNative.errors);

    // --- Project sources ---
    // We use the current workspace path. But skills loader runs at app
    // startup, not at message-send time — we'll need the workspace to be
    // set. At startup, there may be no workspace. That's fine: project
    // skills refresh whenever the workspace changes.
    try {
      const { useChatStore } = await import("../stores/chat");
      const ws = useChatStore.getState().workspacePath;
      if (ws) {
        // Project sources stay narrow too — only the goatLLM-native dir.
        for (const dir of [".goat/skills"]) {
          const includeRoot = true;
          const fullPath = `${ws}/${dir}`;
          if (await pathExistsAbs(fullPath)) {
            const r = await loadSkillsFromDir({
              dir: fullPath,
              source: `${dir}`,
              includeRootFiles: includeRoot,
            });
            r.skills.forEach(add);
            allErrors.push(...r.errors);
          }
        }
      }
    } catch {
      // workspace not yet set — skip project skills for now
    }
  }

  // --- Custom paths ---
  for (const customPath of options.customPaths) {
    const expandHome = (p: string): string => {
      if (p.startsWith("~/")) return home + "/" + p.slice(2);
      if (p === "~") return home;
      return p;
    };
    const fullPath = home ? expandHome(customPath) : customPath;
    if (!(await pathExistsAbs(fullPath))) {
      allErrors.push(`Custom skill path not found: ${fullPath}`);
      continue;
    }
    const r = await loadSkillsFromDir({
      dir: fullPath,
      source: fullPath,
      includeRootFiles: true,
    });
    r.skills.forEach(add);
    allErrors.push(...r.errors);
  }

  return { skills, errorMessages: allErrors };
}

/**
 * Read a SKILL.md (or any text file under a skills root) by absolute path.
 * Used by the InputBar to inline skill content on `/skill:name` invocation,
 * so the model gets the full instructions whether or not it can use tools.
 */
export async function readSkillFile(absolutePath: string): Promise<string> {
  return readTextFileAbs(absolutePath);
}

/**
 * Format skills as an XML block for the system prompt, per the
 * [Agent Skills integration spec](https://agentskills.io/integrate-skills).
 *
 * Only non-disableModelInvocation skills are included — disabled-for-model
 * skills must be explicitly invoked via `/skill:name` or the UI button.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (visible.length === 0) return "";

  let out = "\n<available_skills>\n";
  for (const s of visible) {
    out += `  <skill>\n`;
    out += `    <name>${escapeXml(s.name)}</name>\n`;
    out += `    <description>${escapeXml(s.description)}</description>\n`;
    out += `    <location>${escapeXml(s.filePath)}</location>\n`;
    out += `  </skill>\n`;
  }
  out += "</available_skills>\n";
  return out;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
