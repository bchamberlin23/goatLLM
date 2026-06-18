# OpenAI Codex Subscription Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate built-in OpenAI Codex provider backed by ChatGPT Plus/Pro subscription authentication.

**Architecture:** Keep Codex subscription access out of the existing OpenAI API-key provider. Add native OpenAI OAuth in goatLLM, store credentials in goatLLM app data, refresh access tokens in Rust, and stream `https://chatgpt.com/backend-api/codex/responses` SSE events. Route `streamChat()` through a provider-specific adapter when the selected provider is `openai-codex-subscription`. Do not invoke, inspect, or depend on the Codex CLI in any path.

**Tech Stack:** Tauri 2 Rust commands, React 19 settings UI, Zustand chat store, Vitest, Codex Responses SSE.

---

### Task 1: Codex Provider Unit Surface

**Files:**
- Create: `src/lib/openai-codex-subscription.ts`
- Modify: `src/__tests__/openai-codex-subscription.test.ts`

- [x] Write failing tests for Responses request serialization and SSE event normalization.
- [x] Implement provider constants, model catalog, request builder, event parser, and stream adapter surface.
- [x] Run `pnpm test src/__tests__/openai-codex-subscription.test.ts`.

### Task 2: Registry And Store Integration

**Files:**
- Modify: `src/lib/model-registry.ts`
- Modify: `src/stores/chat.ts`
- Modify: `src/__tests__/model-registry.test.ts`
- Modify: `src/__tests__/chat-store.test.ts`

- [x] Write failing tests that the Codex provider appears as a built-in and produces an `LlmConfig`.
- [x] Add the provider to the built-in registry and preserve OpenCode Go free behavior.
- [x] Route built-in config without API keys.
- [x] Run `pnpm test src/__tests__/model-registry.test.ts src/__tests__/chat-store.test.ts`.

### Task 3: Tauri Native Codex Bridge

**Files:**
- Create: `src-tauri/src/commands/codex.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Add auth status, OAuth start, OAuth complete, logout, native Responses stream, and cancel commands.
- [x] Generate PKCE verifier/challenge and OAuth state in Rust.
- [x] Exchange authorization codes and refresh tokens through OpenAI OAuth without exposing access tokens to JS.
- [x] Store credentials under goatLLM app data, not Codex CLI paths.
- [x] POST Responses requests to ChatGPT's Codex backend and emit SSE events keyed by run id.
- [x] Run `cargo check` in `src-tauri`.

### Task 4: Runtime Routing

**Files:**
- Modify: `src/lib/llm.ts`
- Modify: `src/lib/model-factory.ts`
- Modify: `src/lib/tools/builtins/subagent.ts`
- Modify: `src/__tests__/openai-codex-subscription.test.ts`

- [x] Route `openai-codex-subscription` to `streamCodexSubscription()` before AI SDK model creation.
- [x] Fall back to heuristic title generation for Codex subscription models.
- [x] Add a guard in `createModel()` so accidental direct model creation reports the correct path.
- [x] Convert goatLLM `ToolSet` schemas into Responses function tools.
- [x] Map Responses function-call events into goatLLM tool callbacks, execute tools through goatLLM's existing approval/runtime path, append `function_call_output`, and continue the turn.
- [x] Route Codex-backed subagents through the native Codex subscription adapter instead of AI SDK model creation.
- [x] Run focused Vitest tests and `pnpm typecheck`.

### Task 5: Settings UI

**Files:**
- Create: `src/components/settings/CodexSubscriptionCard.tsx`
- Modify: `src/components/settings/ProvidersTab.tsx`

- [x] Add the Codex card above API-key cloud provider cards.
- [x] Wire check, native browser OAuth sign-in, manual redirect-code completion, and sign-out commands.
- [x] Keep styling within `DESIGN.md` tokens.
- [x] Run settings/component tests and typecheck.

### Task 6: Final Verification

**Files:**
- All modified files

- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `cargo check` in `src-tauri`.
- [x] Inspect `git diff` for unrelated changes and design-token drift.
