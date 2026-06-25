export interface WorkspaceMapFile {
  path: string;
  size: number;
  content?: string;
}

export interface WorkspaceImportHint {
  from: string;
  imports: string[];
}

export interface WorkspaceMap {
  projectType: string[];
  packageScripts: string[];
  importantFiles: string[];
  topDirectories: string[];
  entryPoints: string[];
  importHints: WorkspaceImportHint[];
  files: { path: string; size: number }[];
}

const SKIP_PARTS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".rs",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

function extension(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx).toLowerCase() : "";
}

export function shouldSkipWorkspaceMapPath(path: string, size = 0): boolean {
  const parts = path.split("/").filter(Boolean);
  if (parts.some((part) => SKIP_PARTS.has(part))) return true;
  if (size > 1_000_000) return true;
  const ext = extension(path);
  if (!ext) return false;
  return !TEXT_EXTENSIONS.has(ext);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function parsePackageJson(content: string | undefined): {
  scripts: string[];
  dependencies: string[];
} {
  if (!content) return { scripts: [], dependencies: [] };
  try {
    const parsed = JSON.parse(content) as {
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return {
      scripts: Object.keys(parsed.scripts ?? {}),
      dependencies: [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
      ],
    };
  } catch {
    return { scripts: [], dependencies: [] };
  }
}

function detectProjectType(files: WorkspaceMapFile[], dependencies: string[]): string[] {
  const types: string[] = [];
  const has = (needle: string) => dependencies.some((dep) => dep === needle || dep.includes(needle));
  const paths = new Set(files.map((file) => file.path));

  if (has("react") || files.some((file) => file.path.endsWith(".tsx"))) types.push("React");
  if (has("vite") || paths.has("vite.config.ts") || paths.has("vite.config.js")) types.push("Vite");
  if (has("@tauri-apps/api") || files.some((file) => file.path.startsWith("src-tauri/"))) types.push("Tauri");
  if (has("vitest") || files.some((file) => file.path.includes("__tests__"))) types.push("Vitest");
  if (files.some((file) => file.path.endsWith(".ts") || file.path.endsWith(".tsx"))) types.push("TypeScript");
  if (files.some((file) => file.path.endsWith(".rs"))) types.push("Rust");
  return uniqueSorted(types);
}

function isImportant(path: string): boolean {
  return (
    /^(AGENTS|CLAUDE|DESIGN|GOAT|README)(\..*)?$/i.test(path) ||
    path === "package.json" ||
    path === "Cargo.toml" ||
    path === "pyproject.toml" ||
    path === "src-tauri/Cargo.toml"
  );
}

function isEntryPoint(path: string): boolean {
  return [
    "src/main.ts",
    "src/main.tsx",
    "src/App.tsx",
    "src/App.ts",
    "src-tauri/src/main.rs",
    "src-tauri/src/lib.rs",
    "app/page.tsx",
    "app/layout.tsx",
    "pages/index.tsx",
  ].includes(path);
}

function extractImportHints(file: WorkspaceMapFile): WorkspaceImportHint | null {
  const content = file.content ?? "";
  if (!content) return null;
  const imports: string[] = [];

  if (/\.[cm]?[jt]sx?$/.test(file.path)) {
    for (const match of content.matchAll(/\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
      imports.push(match[1]);
    }
    for (const match of content.matchAll(/\bexport\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g)) {
      imports.push(match[1]);
    }
  } else if (file.path.endsWith(".rs")) {
    for (const match of content.matchAll(/^\s*mod\s+([A-Za-z0-9_]+)\s*;/gm)) {
      imports.push(`mod ${match[1]}`);
    }
    for (const match of content.matchAll(/^\s*use\s+([^;]+);/gm)) {
      imports.push(match[1].trim());
    }
  }

  const unique = uniqueSorted(imports).slice(0, 12);
  return unique.length > 0 ? { from: file.path, imports: unique } : null;
}

export function buildWorkspaceMap(inputFiles: WorkspaceMapFile[]): WorkspaceMap {
  const files = inputFiles
    .filter((file) => !shouldSkipWorkspaceMapPath(file.path, file.size))
    .sort((a, b) => a.path.localeCompare(b.path));
  const packageInfo = parsePackageJson(files.find((file) => file.path === "package.json")?.content);

  return {
    projectType: detectProjectType(files, packageInfo.dependencies),
    packageScripts: packageInfo.scripts,
    importantFiles: files.filter((file) => isImportant(file.path)).map((file) => file.path),
    topDirectories: uniqueSorted(
      files
        .filter((file) => file.path.includes("/"))
        .map((file) => file.path.split("/")[0])
        .filter(Boolean),
    ),
    entryPoints: files.filter((file) => isEntryPoint(file.path)).map((file) => file.path),
    importHints: files.map(extractImportHints).filter((hint): hint is WorkspaceImportHint => !!hint),
    files: files.map((file) => ({ path: file.path, size: file.size })),
  };
}

export function formatWorkspaceMapForPrompt(map: WorkspaceMap): string {
  const lines = [
    "# Workspace Map",
    "",
    `Project type: ${map.projectType.length ? map.projectType.join(", ") : "unknown"}`,
    `Package scripts: ${map.packageScripts.length ? map.packageScripts.join(", ") : "none detected"}`,
    "",
    "Important files:",
    ...(map.importantFiles.length ? map.importantFiles.map((path) => `- ${path}`) : ["- none detected"]),
    "",
    "Top directories:",
    ...(map.topDirectories.length ? map.topDirectories.map((path) => `- ${path}`) : ["- none detected"]),
    "",
    "Likely entry points:",
    ...(map.entryPoints.length ? map.entryPoints.map((path) => `- ${path}`) : ["- none detected"]),
  ];

  if (map.importHints.length > 0) {
    lines.push("", "Import hints:");
    for (const hint of map.importHints.slice(0, 30)) {
      lines.push(`- ${hint.from}: ${hint.imports.join(", ")}`);
    }
  }

  lines.push("", `Files scanned: ${String(map.files.length)}`);
  return lines.join("\n");
}
