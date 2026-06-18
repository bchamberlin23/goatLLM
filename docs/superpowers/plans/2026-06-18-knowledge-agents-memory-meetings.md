# Knowledge, Schedules, Memory, and Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build goatLLM's document knowledge workspaces, scheduled agent runner, conservative automatic memory extraction, and meeting assistant as local-first product features.

**Architecture:** Keep the app local-first and desktop-native. Each new user-visible data set gets a synchronous localStorage journal for close-race safety plus SQLite commands and migrations for durable search/reload. AnythingLLM's implementation informs the data shapes: document rows separate from vector chunks, scheduled job rows separate from immutable run rows, memory extraction as observer/reflector, and meeting transcripts as reusable knowledge documents.

**Tech Stack:** Tauri 2, Rust SQLite commands, React 19, Zustand, Vercel AI SDK, Ollama embeddings, existing attachment/audio extraction commands, Vitest.

---

## AnythingLLM Patterns To Keep

- Documents: metadata rows track embed status, pin/watch flags, source provenance, and vector records separately.
- Scheduled jobs: schedules own configuration; runs own status, traces, outputs, timestamps, and recovery state.
- Memory extraction: background extraction is opt-in, capped, conservative, and split into candidate extraction plus reflection/deduplication.
- Meetings: audio/video transcription becomes a first-class document with summary, action items, speakers, and chat/search affordances.

## goatLLM Adaptation

- Scope stays personal/local, not multi-user admin.
- Settings surfaces use existing compact product UI patterns, Geist typography, `bg-surface-*`, `text-text-*`, `border-hairline`, and single amber accent.
- Scheduled jobs run only while the app is open. Missed runs are recorded as missed/pending on next launch instead of pretending background daemon reliability.
- Meeting assistant starts with file-based audio/video import and transcript management. Live system-audio capture can be layered later once platform permissions are settled.

## Tasks

### Task 1: Document Knowledge Workspaces

**Files:**
- Create `src/lib/document-workspace.ts`
- Create `src/lib/__tests__/document-workspace.test.ts`
- Create `src-tauri/migrations/012_document_workspaces.sql`
- Create `src-tauri/src/commands/documents.rs`
- Modify `src-tauri/src/lib.rs`
- Modify `src-tauri/src/commands/mod.rs`
- Modify `src/stores/chat.ts`
- Modify `src/components/settings/SettingsTabs.tsx`

- [ ] Write tests for document sanitization, chunking, pinning, retrieval preview ordering, and reload status reset.
- [ ] Add SQLite tables for document workspaces, document sources, and document chunks.
- [ ] Add Tauri commands for upsert/list/delete/embed/unembed/resync/search.
- [ ] Add localStorage mirror keys and Zustand actions.
- [ ] Add Memory/RAG settings UI for corpus list, upload/import, embed/unembed, pin, resync, retrieval preview, provenance, and RAG knobs.
- [ ] Verify `pnpm test -- document-workspace`.
- [ ] Commit as `feat: add document knowledge workspaces`.

### Task 2: Scheduled Agent Runner

**Files:**
- Create `src/lib/scheduled-agents.ts`
- Create `src/lib/__tests__/scheduled-agents.test.ts`
- Create `src-tauri/migrations/013_scheduled_agent_runs.sql`
- Create `src-tauri/src/commands/scheduled_agents.rs`
- Modify `src-tauri/src/lib.rs`
- Modify `src-tauri/src/commands/mod.rs`
- Modify `src/stores/chat.ts`
- Modify `src/components/settings/SettingsTabs.tsx`

- [ ] Write tests for schedule parsing, next-run computation, in-flight recovery, run history sanitization, and due-run selection.
- [ ] Add SQLite tables for scheduled agents and scheduled agent runs.
- [ ] Add localStorage journal plus SQLite mirror.
- [ ] Add runner that claims due jobs, creates run records, executes with selected model and safe tool limits, captures traces, updates status, and posts notifications.
- [ ] Add continue-in-thread action that creates a conversation containing the scheduled prompt/result.
- [ ] Expand Scheduled Agents settings with enabled toggle, manual run, run history, trace preview, output/artifact links, delete, and recovery messaging.
- [ ] Verify `pnpm test -- scheduled-agents`.
- [ ] Commit as `feat: finish scheduled agent runner`.

### Task 3: Automatic Memory Extraction

**Files:**
- Modify `src/lib/memory.ts`
- Create `src/lib/memory-extraction.ts`
- Create `src/lib/__tests__/memory-extraction.test.ts`
- Create `src-tauri/migrations/014_memory_scopes.sql`
- Modify `src-tauri/src/commands/memory.rs`
- Modify `src/stores/chat.ts`
- Modify `src/components/settings/SettingsTabs.tsx`

- [ ] Write tests for candidate extraction prompt assembly, conservative filtering, dedupe, scope classification, provenance, and hydrate reset.
- [ ] Extend memory rows with scope, workspace path, provenance, updated timestamp, extraction status, and source message ids.
- [ ] Add opt-in settings: auto extraction, idle threshold, global/workspace limits, review before save, and max candidates.
- [ ] Implement observer/reflector helpers using structured JSON output and deterministic fallback validation.
- [ ] Add edit/delete/promote/demote UI and provenance display.
- [ ] Trigger extraction after completed assistant turns only when enabled and idle enough.
- [ ] Verify `pnpm test -- memory-extraction`.
- [ ] Commit as `feat: add automatic memory extraction`.

### Task 4: Meeting Assistant

**Files:**
- Create `src/lib/meeting-assistant.ts`
- Create `src/lib/__tests__/meeting-assistant.test.ts`
- Create `src-tauri/migrations/015_meetings.sql`
- Create `src-tauri/src/commands/meetings.rs`
- Modify `src-tauri/src/lib.rs`
- Modify `src-tauri/src/commands/mod.rs`
- Modify `src/stores/chat.ts`
- Modify `src/components/settings/SettingsTabs.tsx`
- Modify input/assets surfaces as needed for meeting imports.

- [ ] Write tests for meeting lifecycle, transcript segment sanitization, action item parsing, knowledge-document export, and interrupted import recovery.
- [ ] Add SQLite tables for meetings, transcript segments, meeting artifacts, and meeting-linked document sources.
- [ ] Add localStorage journal plus SQLite mirror.
- [ ] Use existing audio transcription command for uploaded audio/video; store transcript segments with timestamps when available.
- [ ] Add summary generation prompt for title, attendees, decisions, action items, risks, follow-ups, and concise notes.
- [ ] Let users chat with a meeting via the document corpus path and pin meeting transcripts into RAG.
- [ ] Add Meeting Assistant settings/surface with import, status, transcript, summary, action items, exports, and delete.
- [ ] Verify `pnpm test -- meeting-assistant`.
- [ ] Commit as `feat: add meeting assistant`.

### Final Verification

- [ ] Run `pnpm test -- --runInBand`.
- [ ] Run `pnpm typecheck`.
- [ ] Run targeted Rust tests or `cargo test` in `src-tauri` if Rust commands changed.
- [ ] Audit persistence: every new durable object has localStorage mirror, SQLite mirror, hydrate sanitization, and no stale running state after reload.
- [ ] Audit design tokens: no new raw hex outside existing tokens, no second accent, no decorative gradients/blobs.
