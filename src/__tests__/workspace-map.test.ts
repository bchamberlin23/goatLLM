import { describe, expect, it } from "vitest";

import { buildWorkspaceMap, shouldSkipWorkspaceMapPath, type WorkspaceMapFile } from "../lib/workspace-map";

const file = (path: string, content = ""): WorkspaceMapFile => ({ path, content, size: content.length });

describe("workspace map", () => {
  it("summarizes important files, scripts, frameworks, directories, and entry points", () => {
    const map = buildWorkspaceMap([
      file("package.json", JSON.stringify({
        scripts: { dev: "vite", test: "vitest run", tauri: "tauri" },
        dependencies: { react: "^19", "@tauri-apps/api": "^2", vite: "^6" },
      })),
      file("src/App.tsx", "export function App() { return null; }"),
      file("src/lib/db.ts", "export function loadAll() {}"),
      file("src/main.tsx", "import { createRoot } from 'react-dom/client';"),
      file("README.md", "# goatLLM\nLocal first chat."),
      file("src-tauri/src/main.rs", "fn main() {}"),
      file("node_modules/pkg/index.js", "ignore me"),
    ]);

    expect(map.projectType).toContain("React");
    expect(map.projectType).toContain("Tauri");
    expect(map.packageScripts).toEqual(["dev", "test", "tauri"]);
    expect(map.importantFiles).toContain("package.json");
    expect(map.importantFiles).toContain("README.md");
    expect(map.topDirectories).toEqual(expect.arrayContaining(["src", "src-tauri"]));
    expect(map.entryPoints).toEqual(expect.arrayContaining(["src/main.tsx", "src/App.tsx", "src-tauri/src/main.rs"]));
    expect(map.files.some((entry) => entry.path.includes("node_modules"))).toBe(false);
  });

  it("extracts cheap import edges for TypeScript and Rust files", () => {
    const map = buildWorkspaceMap([
      file("src/App.tsx", "import { loadAll } from './lib/db';\nimport React from 'react';"),
      file("src-tauri/src/main.rs", "mod commands;\nuse tauri::Manager;"),
    ]);

    expect(map.importHints).toContainEqual({
      from: "src/App.tsx",
      imports: ["./lib/db", "react"],
    });
    expect(map.importHints).toContainEqual({
      from: "src-tauri/src/main.rs",
      imports: ["mod commands", "tauri::Manager"],
    });
  });

  it("skips generated, dependency, and large binary-ish paths", () => {
    expect(shouldSkipWorkspaceMapPath("node_modules/react/index.js")).toBe(true);
    expect(shouldSkipWorkspaceMapPath("dist/assets/app.js")).toBe(true);
    expect(shouldSkipWorkspaceMapPath(".git/config")).toBe(true);
    expect(shouldSkipWorkspaceMapPath("src/App.tsx")).toBe(false);
  });
});
