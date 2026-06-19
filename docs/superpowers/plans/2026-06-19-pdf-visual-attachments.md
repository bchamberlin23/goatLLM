# PDF Visual Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let models read uploaded PDFs as text plus first-class image assets referenced from the document.

**Architecture:** Preserve the existing text extraction, preview, and attachment-navigation pipeline. Add a PDF asset cache that stores extracted PDF image XObjects as data URLs, inserts Markdown image references into the inlined PDF body, and exposes those assets to model inputs/tools.

**Tech Stack:** TypeScript, Vitest, Tauri commands, Rust, `lopdf`, AI SDK multimodal content parts.

---

### Task 1: Model-Facing PDF Asset Cache

**Files:**
- Modify: `src/lib/attachment-cache.ts`
- Modify: `src/__tests__/attachment-cache.test.ts`

- [ ] Write failing tests for storing PDF visual assets, building Markdown references, and looking assets up by `image_id`.
- [ ] Implement `PdfVisualAsset`, asset storage on cached attachments, and lookup helpers.
- [ ] Run `pnpm vitest run src/__tests__/attachment-cache.test.ts`.
- [ ] Commit `feat: cache pdf visual assets`.

### Task 2: PDF Attachment Extraction Contract

**Files:**
- Modify: `src/lib/attachment-extract.ts`
- Modify: `src/__tests__/attachment-extract.test.ts`

- [ ] Write failing tests showing a PDF body includes `attachment-image://<pdf>/<asset>` Markdown references when the extractor returns assets.
- [ ] Add an `extract_pdf_images` Tauri command call after `extract_pdf_text`, cache the returned assets, and append a visual-assets section to the PDF Markdown.
- [ ] Run `pnpm vitest run src/__tests__/attachment-extract.test.ts src/__tests__/attachment-cache.test.ts`.
- [ ] Commit `feat: inline pdf image references`.

### Task 3: Rust PDF Image Extraction

**Files:**
- Create: `src-tauri/src/commands/extract/pdf_images.rs`
- Modify: `src-tauri/src/commands/extract.rs`
- Modify: `src-tauri/src/commands/extract/tests.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] Write Rust unit tests for image ID generation and filter-to-MIME detection.
- [ ] Implement best-effort extraction of page XObject images for `DCTDecode` and `JPXDecode`, with page numbers and dimensions.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml extract`.
- [ ] Commit `feat: extract embedded pdf images`.

### Task 4: Model Input Wiring

**Files:**
- Modify: `src/components/input-bar/hooks/useComposer.ts`
- Modify: `src/lib/native-pdf.ts`

- [ ] Write or update tests for attaching PDF images to vision-capable model turns.
- [ ] Attach small extracted PDF image assets as `image` content parts, and send native PDFs to supported vision providers for mixed PDFs under existing attachment limits.
- [ ] Run focused Vitest coverage around attachment extraction and send-message behavior.
- [ ] Commit `feat: send pdf visuals to vision models`.

### Task 5: Verification and Push

**Files:**
- All changed files.

- [ ] Run `pnpm test -- --runInBand` or focused Vitest if the full suite is too broad for the desktop turn.
- [ ] Run `pnpm typecheck`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Push `main` to GitHub.
