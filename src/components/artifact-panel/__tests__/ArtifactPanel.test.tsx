import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ArtifactPanel } from "../../ArtifactPanel";
import { useChatStore, type Artifact } from "../../../stores/chat";
import { getSandboxAttribute } from "../lib/sandbox";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const panelDir = path.resolve(__dirname, "..");

const targetFiles = [
  "ArtifactPanel.tsx",
  "ArtifactHeader.tsx",
  "ArtifactTabs.tsx",
  "PreviewPane.tsx",
  "CodePane.tsx",
  "HistoryPane.tsx",
  "FileCanvas.tsx",
  "PdfLoader.tsx",
  "PyRunner.tsx",
  "OfficePreview.tsx",
  "hooks/useArtifactPanel.ts",
  "lib/sandbox.ts",
];

const childFiles = [
  "ArtifactHeader.tsx",
  "ArtifactTabs.tsx",
  "PreviewPane.tsx",
  "CodePane.tsx",
  "HistoryPane.tsx",
  "FileCanvas.tsx",
  "PdfLoader.tsx",
  "PyRunner.tsx",
  "OfficePreview.tsx",
];

function readPanelFile(relativePath: string) {
  return fs.readFileSync(path.join(panelDir, relativePath), "utf8");
}

beforeEach(() => {
  useChatStore.setState({
    activeId: null,
    artifacts: {},
    artifactPanelOpen: false,
    activeArtifactId: null,
    agentMode: false,
    designMode: false,
    workspacePath: "",
    designWorkspacePath: "",
    workspaceFile: null,
    messages: {},
  });
});

describe("ArtifactPanel decomposition", () => {
  it("keeps the requested focused file surface", () => {
    for (const relativePath of targetFiles) {
      expect(fs.existsSync(path.join(panelDir, relativePath)), relativePath).toBe(true);
    }

    const orchestrator = readPanelFile("ArtifactPanel.tsx");
    expect(orchestrator.split("\n").length).toBeLessThan(250);
  });

  it("keeps store access out of child components", () => {
    for (const relativePath of childFiles) {
      expect(readPanelFile(relativePath), relativePath).not.toMatch(/useChatStore/);
    }
  });

  it("centralizes iframe sandbox strings in the sandbox helper", () => {
    expect(getSandboxAttribute("html")).toBe("allow-scripts allow-same-origin allow-popups");
    expect(getSandboxAttribute("html-design")).toBe("allow-same-origin allow-popups");
    expect(getSandboxAttribute("office")).toBe("allow-scripts");
    expect(getSandboxAttribute("browser")).toBe("allow-scripts allow-same-origin allow-forms allow-popups");
    expect(getSandboxAttribute("none")).toBe("");

    for (const relativePath of targetFiles.filter((file) => file !== "lib/sandbox.ts")) {
      expect(readPanelFile(relativePath), relativePath).not.toMatch(
        /allow-scripts|allow-same-origin|allow-popups|allow-forms/,
      );
    }
  });

  it("lazy-loads Monaco behind the CodeSkeleton suspense fallback", () => {
    const codePane = readPanelFile("CodePane.tsx");

    expect(codePane).toContain('React.lazy(() => import("@monaco-editor/react"))');
    expect(codePane).toContain("<Suspense fallback={<CodeSkeleton />}>");
  });

  it("preserves the public ArtifactPanel render path", () => {
    const artifact: Artifact = {
      id: "artifact-1",
      kind: "html",
      title: "Landing Page",
      code: "<main>hello</main>",
      messageId: "message-1",
      createdAt: Date.now(),
      versions: [
        {
          code: "<main>hello</main>",
          title: "Landing Page",
          createdAt: Date.now(),
          source: "agent",
          messageId: "message-1",
        },
      ],
      activeVersionIndex: 0,
    };

    useChatStore.setState({
      activeId: "conversation-1",
      artifacts: { "conversation-1": [artifact] },
      activeArtifactId: artifact.id,
      artifactPanelOpen: true,
    });

    render(<ArtifactPanel />);

    expect(screen.getByText("Landing Page")).toBeInTheDocument();
    const iframe = screen.getByTitle("Landing Page");
    expect(iframe).toHaveAttribute("sandbox", getSandboxAttribute("html"));
  });
});
