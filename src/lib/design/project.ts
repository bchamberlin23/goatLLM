/**
 * Design project — per-conversation multi-file artifact tree.
 *
 * Each design conversation can produce several files (template.html,
 * brand-spec.md, theme.css, generated images). We use a dual-write pattern:
 *   1. localStorage (fast synchronous write, survives any close path)
 *   2. File system (via Tauri fs API, durable and enables real file preview)
 *
 * The DesignWorkspacePicker and ArtifactPanel "Open in workspace" sidebar
 * read from this store. When a workspace folder is set, files are written
 * to disk for external editing and preview.
 */

import { invoke } from "@tauri-apps/api/core";

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
  /** Optional workspace folder path for file-based storage. */
  workspacePath?: string;
  /** Timestamp when the project was last modified. */
  updatedAt?: number;
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

export async function saveProject(project: DesignProject): Promise<void> {
  try {
    // Update timestamp
    const updated = { ...project, updatedAt: Date.now() };
    
    // Write to localStorage (fast, synchronous)
    localStorage.setItem(
      projectKey(project.conversationId),
      JSON.stringify(updated),
    );
    
    // Write to file system if workspace path is set
    if (updated.workspacePath) {
      await saveProjectToDisk(updated);
    }
  } catch {
    // Quota exceeded or fs error — best-effort, don't crash the app.
  }
}

/**
 * Write project files to disk in the workspace folder.
 * Creates the folder structure:
 *   {workspacePath}/{conversationId}/
 *     template.html
 *     brand-spec.md
 *     theme.css
 *     assets/
 */
async function saveProjectToDisk(project: DesignProject): Promise<void> {
  if (!project.workspacePath) return;
  
  const projectDir = `${project.workspacePath}/${project.conversationId}`;
  
  try {
    // Create project directory
    await invoke("create_dir", { path: projectDir });
    
    // Write each file
    for (const [filename, contents] of Object.entries(project.files)) {
      const filePath = `${projectDir}/${filename}`;
      
      // Create parent directories if needed (e.g., "assets/logo.svg")
      const lastSlash = filename.lastIndexOf("/");
      if (lastSlash > 0) {
        const parentDir = `${projectDir}/${filename.slice(0, lastSlash)}`;
        await invoke("create_dir", { path: parentDir });
      }
      
      await invoke("write_file", { path: filePath, contents });
    }
    
    // Write metadata file
    const metadata = {
      conversationId: project.conversationId,
      skillId: project.skillId,
      systemId: project.systemId,
      directionId: project.directionId,
      updatedAt: project.updatedAt,
      files: Object.keys(project.files),
    };
    await invoke("write_file", {
      path: `${projectDir}/.goatllm-project.json`,
      contents: JSON.stringify(metadata, null, 2),
    });
  } catch (error) {
    console.warn("Failed to save project to disk:", error);
    // Don't throw — localStorage is the source of truth
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

export async function setFile(
  project: DesignProject,
  filename: string,
  contents: string,
): Promise<DesignProject> {
  const updated = { 
    ...project, 
    files: { ...project.files, [filename]: contents },
    updatedAt: Date.now(),
  };
  
  // Save to localStorage and disk
  await saveProject(updated);
  
  return updated;
}

export async function deleteFile(
  project: DesignProject,
  filename: string,
): Promise<DesignProject> {
  const next = { ...project.files };
  delete next[filename];
  const updated = { 
    ...project, 
    files: next,
    updatedAt: Date.now(),
  };
  
  await saveProject(updated);
  
  return updated;
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
  /** Optional workspace folder path for file-based storage. */
  workspacePath?: string;
}): DesignProject {
  const project: DesignProject = {
    conversationId: params.conversationId,
    skillId: params.skillId,
    systemId: params.systemId,
    directionId: params.directionId,
    files: {},
    workspacePath: params.workspacePath,
    updatedAt: Date.now(),
  };
  if (params.seedHtml) {
    project.files["template.html"] = params.seedHtml;
  }
  return project;
}

// ── Workspace helpers ───────────────────────────────────────────────────

/**
 * Set or change the workspace path for a project.
 * Triggers a full save to disk.
 */
export async function setWorkspacePath(
  project: DesignProject,
  workspacePath: string | undefined,
): Promise<DesignProject> {
  const updated = { ...project, workspacePath };
  await saveProject(updated);
  return updated;
}

/**
 * Get the full path to a file in the workspace.
 * Returns null if no workspace is set.
 */
export function getFilePath(
  project: DesignProject,
  filename: string,
): string | null {
  if (!project.workspacePath) return null;
  return `${project.workspacePath}/${project.conversationId}/${filename}`;
}

/**
 * Open a file in the system's default application.
 * Requires workspace path to be set.
 */
export async function openFileInApp(
  project: DesignProject,
  filename: string,
): Promise<void> {
  const path = getFilePath(project, filename);
  if (!path) throw new Error("No workspace path set");
  await invoke("open_path", { path });
}

/**
 * Reveal a file in the system's file manager (Finder/Explorer).
 * Requires workspace path to be set.
 */
export async function revealFileInFinder(
  project: DesignProject,
  filename: string,
): Promise<void> {
  const path = getFilePath(project, filename);
  if (!path) throw new Error("No workspace path set");
  await invoke("show_in_folder", { path });
}
