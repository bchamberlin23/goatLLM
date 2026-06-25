/**
 * Seed built-in skills from `public/skills/` into the goat agent skills
 * directory on first run. Runs once per skill — if the SKILL.md already
 * exists on disk, we skip seeding to preserve user edits.
 */

interface SeedManifest {
  name: string;
  files: string[]; // paths relative to /skills/<name>/
}

const BUILTIN_SKILLS: SeedManifest[] = [
  {
    name: "impeccable",
    files: [
      "SKILL.md",
      "reference/adapt.md",
      "reference/animate.md",
      "reference/audit.md",
      "reference/bolder.md",
      "reference/brand.md",
      "reference/clarify.md",
      "reference/codex.md",
      "reference/cognitive-load.md",
      "reference/color-and-contrast.md",
      "reference/colorize.md",
      "reference/craft.md",
      "reference/critique.md",
      "reference/delight.md",
      "reference/distill.md",
      "reference/document.md",
      "reference/extract.md",
      "reference/harden.md",
      "reference/heuristics-scoring.md",
      "reference/interaction-design.md",
      "reference/layout.md",
      "reference/live.md",
      "reference/motion-design.md",
      "reference/onboard.md",
      "reference/optimize.md",
      "reference/overdrive.md",
      "reference/personas.md",
      "reference/polish.md",
      "reference/product.md",
      "reference/quieter.md",
      "reference/responsive-design.md",
      "reference/shape.md",
      "reference/spatial-design.md",
      "reference/teach.md",
      "reference/typeset.md",
      "reference/typography.md",
      "reference/ux-writing.md",
      "agents/impeccable-asset-producer.md",
    ],
  },
  // Curated chat-only skills. These are pure prompt-injection: no scripts,
  // no reference docs, no tools assumed. They show up in chat mode (and
  // also in agent mode if marked `both`).
  { name: "concise", files: ["SKILL.md"] },
  { name: "socratic", files: ["SKILL.md"] },
  { name: "devil-advocate", files: ["SKILL.md"] },
  { name: "internet-research-router", files: ["SKILL.md"] },
  { name: "stop-slop", files: ["SKILL.md"] },
  { name: "taste-check", files: ["SKILL.md"] },
  // Agent-mode discipline skill. Engineering rigor as a prompt: TDD,
  // root-cause thinking, no fake fixes, no swallowed errors.
  { name: "superpowers", files: ["SKILL.md"] },
  // Ralph loop — iterative agent-driven development methodology.
  { name: "ralph-loop", files: ["SKILL.md"] },
  // User-invoked scoping/grilling flow inspired by small composable
  // engineering skills. Disabled for model invocation to avoid ceremony on
  // straightforward implementation requests.
  { name: "engineering-grill", files: ["SKILL.md"] },
];

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

import { log, withError } from "./logger";

// Bake version. Bump when bakeSkillContent's output format changes so a
// stale seed gets refreshed on next launch. The marker is written into the
// SKILL.md as an HTML comment.
const BAKE_VERSION = "goatllm-bake-v3";
const BAKE_MARKER = `<!-- ${BAKE_VERSION} -->`;

/**
 * Post-process SKILL.md template variables so the agent gets real paths.
 * Pi uses `{{scripts_path}}` and `{{command_prefix}}`. goatLLM doesn't ship
 * the optional Node.js helper scripts, so we substitute pi's `node ...mjs`
 * invocations with goatLLM-native equivalents and prepend a short note.
 *
 * Also injects `mode: both` into the frontmatter for impeccable so the
 * picker shows it in both agent and chat mode (it's design knowledge that
 * works without tools).
 */
function bakeSkillContent(raw: string, skillDir: string, skillName: string): string {
  // First pass: variable substitution (impeccable-only).
  let baked = raw
    .replace(/\{\{scripts_path\}\}/g, `${skillDir}/scripts`)
    .replace(/\{\{command_prefix\}\}/g, `/skill:${skillName} `)
    .replace(/\{\{model\}\}/g, "the model");

  // Inject `mode: both` for impeccable specifically. The curated chat
  // skills declare their own mode in frontmatter; don't touch them.
  if (skillName === "impeccable" && !/^mode:\s*/m.test(baked)) {
    baked = baked.replace(/^---\n/, "---\nmode: both\n");
  }

  // Skip the goatLLM-aware preamble for non-impeccable skills — they don't
  // reference scripts or external infrastructure.
  if (skillName !== "impeccable") {
    // Still write the bake marker so re-seed logic works.
    const fmEnd = baked.indexOf("\n---", 4);
    const marker = `\n\n${BAKE_MARKER}\n`;
    if (fmEnd !== -1) {
      return baked.slice(0, fmEnd + 4) + marker + baked.slice(fmEnd + 4);
    }
    return marker + baked;
  }

  // Impeccable preamble.
  const fmEnd = baked.indexOf("\n---", 4);
  const preamble =
    `\n\n${BAKE_MARKER}\n` +
    "> **goatLLM note:** Helper scripts under `scripts/` are NOT bundled " +
    "(they require pi's separate npm package). When this skill instructs you " +
    "to run `node .../load-context.mjs`, instead use `read_file` to load " +
    "`PRODUCT.md` and `DESIGN.md` from the workspace root yourself. When it " +
    "references `scripts/live*.mjs` (live-browser iteration), tell the user " +
    "that mode requires installing pi separately. Reference docs under " +
    "`reference/` ARE present and you should read them via `read_file` when " +
    "the skill tells you to.\n";
  if (fmEnd !== -1) {
    return baked.slice(0, fmEnd + 4) + preamble + baked.slice(fmEnd + 4);
  }
  return preamble + baked;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>("path_exists_abs", { path });
  } catch {
    return false;
  }
}

/**
 * Read the SKILL.md and check whether it contains the current bake-version
 * marker. Returns true if the file exists AND has been baked with the
 * current version. Lets us re-seed when the bake format changes without
 * requiring a manual reset.
 */
async function isSkillCurrent(skillPath: string): Promise<boolean> {
  if (!(await fileExists(skillPath))) return false;
  try {
    const existing = await invoke<string>("read_text_file_abs", { path: skillPath });
    return existing.includes(BAKE_MARKER);
  } catch {
    return false;
  }
}

/**
 * Seed a single skill from the public/ directory into the goat agent dir.
 * Returns the number of new files written (0 if already up to date).
 */
async function seedOneSkill(manifest: SeedManifest): Promise<number> {
  const agentDir = await invoke<string>("goat_agent_dir");
  const skillDir = `${agentDir}/skills/${manifest.name}`;
  const skillPath = `${skillDir}/SKILL.md`;

  // Up-to-date copy already on disk — skip.
  if (await isSkillCurrent(skillPath)) {
    return 0;
  }

  let written = 0;
  for (const file of manifest.files) {
    const url = `/skills/${manifest.name}/${file}`;
    let raw: string;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        log.warn(`Failed to fetch ${url}: ${resp.status}`, { tag: "seed", data: { url, status: resp.status } });
        continue;
      }
      raw = await resp.text();
    } catch (e) {
      log.warn(`Network error fetching ${url}`, withError("seed", { url }, e));
      continue;
    }

    // SKILL.md gets the goatLLM-aware preamble; reference docs are written
    // verbatim. We always overwrite SKILL.md to pick up bake-format changes,
    // but we never overwrite reference files (they may be user-edited).
    const content = file === "SKILL.md" ? bakeSkillContent(raw, skillDir, manifest.name) : raw;
    const relPath = `${manifest.name}/${file}`;

    // For non-SKILL.md files, skip if already present so user edits survive.
    if (file !== "SKILL.md") {
      const existsCheck = `${skillDir}/${file}`;
      if (await fileExists(existsCheck)) continue;
    }

    try {
      await invoke<string>("write_skill_file", {
        relativePath: relPath,
        content,
      });
      written++;
    } catch (e) {
      log.warn(`Failed to write ${relPath}`, withError("seed", { relPath }, e));
    }
  }

  return written;
}

let seedRun = false;

/** Seed all built-in skills. Idempotent — call at startup. */
export async function seedBuiltinSkills(): Promise<void> {
  if (seedRun) return;
  seedRun = true;

  for (const manifest of BUILTIN_SKILLS) {
    try {
      const written = await seedOneSkill(manifest);
      if (written > 0) {
        log.info(`Seeded ${written} files for skill "${manifest.name}"`, { tag: "seed", data: { written, name: manifest.name } });
      }
    } catch (e) {
      log.warn(`Failed to seed "${manifest.name}"`, withError("seed", { name: manifest.name }, e));
    }
  }
}
