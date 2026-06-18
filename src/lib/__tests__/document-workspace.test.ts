import { describe, expect, it } from "vitest";
import {
  buildDocumentRetrievalPreview,
  chunkDocumentText,
  createDocumentWorkspace,
  createKnowledgeDocument,
  sanitizeDocumentWorkspaces,
  setDocumentEmbedded,
  setDocumentPinned,
} from "../document-workspace";

describe("document-workspace", () => {
  it("creates workspaces and documents with source provenance", () => {
    const workspace = createDocumentWorkspace("Product Research", "/tmp/research", 10);
    const document = createKnowledgeDocument({
      workspaceId: workspace.id,
      title: "AnythingLLM Notes",
      filename: "anything.md",
      mimeType: "text/markdown",
      text: "Source material",
      source: { kind: "upload", label: "anything.md", uri: "file:///anything.md" },
      now: 11,
    });

    expect(workspace).toMatchObject({
      name: "Product Research",
      workspacePath: "/tmp/research",
      createdAt: 10,
      updatedAt: 10,
    });
    expect(document).toMatchObject({
      workspaceId: workspace.id,
      title: "AnythingLLM Notes",
      filename: "anything.md",
      status: "ready",
      pinned: false,
      embedded: false,
      source: { kind: "upload", label: "anything.md", uri: "file:///anything.md" },
      characters: 15,
    });
  });

  it("chunks text with line provenance and stable document ids", () => {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
    const chunks = chunkDocumentText({
      documentId: "doc-1",
      text,
      maxLines: 5,
      overlapLines: 2,
    });

    expect(chunks.map((chunk) => [chunk.startLine, chunk.endLine])).toEqual([
      [1, 5],
      [4, 8],
      [7, 11],
      [10, 12],
    ]);
    expect(chunks[0]).toMatchObject({
      documentId: "doc-1",
      content: "line 1\nline 2\nline 3\nline 4\nline 5",
    });
  });

  it("updates pin and embedding state without dropping provenance", () => {
    const document = createKnowledgeDocument({
      workspaceId: "ws-1",
      title: "Spec",
      filename: "spec.pdf",
      mimeType: "application/pdf",
      text: "Pinned source",
      source: { kind: "upload", label: "spec.pdf" },
      now: 20,
    });

    const pinned = setDocumentPinned(document, true, 21);
    const embedded = setDocumentEmbedded(pinned, {
      embedded: true,
      status: "embedded",
      chunkCount: 4,
      embeddingModel: "nomic-embed-text",
      now: 22,
    });

    expect(embedded.pinned).toBe(true);
    expect(embedded.embedded).toBe(true);
    expect(embedded.chunkCount).toBe(4);
    expect(embedded.embeddingModel).toBe("nomic-embed-text");
    expect(embedded.source).toEqual(document.source);
    expect(embedded.updatedAt).toBe(22);
  });

  it("orders retrieval previews by pin, score, and recency", () => {
    const preview = buildDocumentRetrievalPreview(
      [
        {
          id: "old-high",
          documentId: "doc-old",
          title: "Old High",
          content: "older high score",
          score: 0.93,
          pinned: false,
          updatedAt: 5,
          source: { kind: "upload", label: "old.md" },
        },
        {
          id: "pinned-low",
          documentId: "doc-pin",
          title: "Pinned Low",
          content: "pinned lower score",
          score: 0.62,
          pinned: true,
          updatedAt: 3,
          source: { kind: "upload", label: "pin.md" },
        },
        {
          id: "fresh-high",
          documentId: "doc-fresh",
          title: "Fresh High",
          content: "newer high score",
          score: 0.93,
          pinned: false,
          updatedAt: 9,
          source: { kind: "upload", label: "fresh.md" },
        },
      ],
      { limit: 3, includeProvenance: true },
    );

    expect(preview.map((hit) => hit.id)).toEqual(["pinned-low", "fresh-high", "old-high"]);
    expect(preview[0].provenance).toBe("upload: pin.md");
  });

  it("settles runtime-only hydrate states", () => {
    const sanitized = sanitizeDocumentWorkspaces([
      {
        id: "ws-1",
        name: "Knowledge",
        workspacePath: null,
        createdAt: 1,
        updatedAt: 2,
        documents: [
          {
            id: "doc-1",
            workspaceId: "ws-1",
            title: "Running",
            filename: "running.pdf",
            mimeType: "application/pdf",
            source: { kind: "upload", label: "running.pdf" },
            text: "body",
            characters: 4,
            status: "embedding",
            embedded: false,
            pinned: false,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    ]);

    expect(sanitized[0].documents[0]).toMatchObject({
      status: "error",
      lastError: "Embedding interrupted.",
    });
  });
});
