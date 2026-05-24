/**
 * Design project — per-conversation multi-file artifact tree.
 *
 * Each design conversation can produce several files (template.html,
 * brand-spec.md, theme.css, generated images). We store them as a flat
 * Record<string, string> keyed by filename, persisted via localStorage
 * (fast synchronous write, survives any close path). For large projects
 * a future migration can add SQLite mirroring via the db.ts dual-write path.
 *
 * The DesignWorkspacePicker and ArtifactPanel "Open in workspace" sidebar
 * read from this store.
 */

export interface DesignProject {
  /** Stable id — the conversation id this project belongs to. */
  conversationId: string;
  /** The skill used when the project was started. */
  skillId: string;
  /** The design system active when the project was started. */
  systemId: string | null;
  /** The direction active when the project was started (if any). */
  directionId: string | null;
  /** Flat file tree — filename → contents. Keys are relative paths like
   *  "template.html", "brand-spec.md", "theme.css", "assets/logo.svg". */
  files: Record<string, string>;
}

const PROJECT_PREFIX = "goatllm-design-project-";

function projectKey(conversationId: string): string {
  return `${PROJECT_PREFIX}${conversationId}`;
}

// ── CRUD ────────────────────────────────────────────────────────────────

export function loadProject(
  conversationId: string,
): DesignProject | null {
  try {
    const raw = localStorage.getItem(projectKey(conversationId));
    if (!raw) return null;
    return JSON.parse(raw) as DesignProject;
  } catch {
    return null;
  }
}

export function saveProject(project: DesignProject): void {
  try {
    localStorage.setItem(
      projectKey(project.conversationId),
      JSON.stringify(project),
    );
  } catch {
    // Quota exceeded — best-effort, don't crash the app.
  }
}

export function deleteProject(conversationId: string): void {
  try {
    localStorage.removeItem(projectKey(conversationId));
  } catch {
    // ignore
  }
}

// ── File operations ─────────────────────────────────────────────────────

export function getFile(
  project: DesignProject,
  filename: string,
): string | undefined {
  return project.files[filename];
}

export function setFile(
  project: DesignProject,
  filename: string,
  contents: string,
): DesignProject {
  return { ...project, files: { ...project.files, [filename]: contents } };
}

export function deleteFile(
  project: DesignProject,
  filename: string,
): DesignProject {
  const next = { ...project.files };
  delete next[filename];
  return { ...project, files: next };
}

/** List files in the project, sorted alphabetically with directories first. */
export function listFiles(project: DesignProject): string[] {
  const names = Object.keys(project.files);
  return names.sort((a, b) => {
    const aDir = a.includes("/");
    const bDir = b.includes("/");
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    return a.localeCompare(b);
  });
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createProject(params: {
  conversationId: string;
  skillId: string;
  systemId: string | null;
  directionId: string | null;
  /** Optional seed template — the skill's template.html. */
  seedHtml?: string;
}): DesignProject {
  const project: DesignProject = {
    conversationId: params.conversationId,
    skillId: params.skillId,
    systemId: params.systemId,
    directionId: params.directionId,
    files: {},
  };
  if (params.seedHtml) {
    project.files["template.html"] = params.seedHtml;
  }
  return project;
}
