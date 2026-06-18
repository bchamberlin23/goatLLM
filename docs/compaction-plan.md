# Compaction v2 — adopt pi's model for goatLLM

A comprehensive plan to bring goatLLM's auto-compaction in line with how `pi-coding-agent` does it, adapted to goatLLM's linear-conversation, dual-write, Tauri-Rust-SQLite stack. The goal is durable, replay-safe compaction for agent mode without regressing chat-mode performance.

Reference: pi's implementation lives in `pi-mono/packages/coding-agent/src/core/compaction/` — see `compaction.ts`, `branch-summarization.ts`, `utils.ts`, plus `session-manager.ts` (`buildSessionContext`, `appendCompaction`) and `messages.ts` (`CompactionSummaryMessage`).

---

## 0. Why this is a v2 and not just an edit

goatLLM's current compaction (`src/lib/context-manager.ts`) is a *streaming* design: the summary is a transient function of the original messages, re-derived on every send, held only in a per-process `Map<convId, string>`. pi's is an *archive* design: the summary is a first-class session entry, written to disk, replayed on every load, cumulative across compactions.

For chat mode the streaming design is fine. For agent mode it is not, because:

- The model treats the summary as part of its working memory. A summary that disappears on reload forces the model to re-derive prior context from raw tool transcripts, which is the exact thing the summary exists to prevent.
- File operations (read / written / edited) are the agent's audit trail. The current code computes `readFiles` / `modifiedFiles` from the dropped window only — they do not roll forward across compactions. After three compactions, the model "remembers" only the third window's file list.
- The trigger is a hard-coded `40_000` / `180_000` budget, not a fraction of the actual model context window. Models with 8K, 128K, and 1M windows all get the same treatment, which is wrong.
- The cut point can split a tool call from its result. Pi's rule is that tool results must stay with their producing tool call. goatLLM's recency loop walks by `createdAt` and will happily keep an assistant message while dropping the tool result that follows it.
- There is no split-turn handling. In agent mode, a single turn (user → assistant → 5 tool results → assistant → 3 tool results) is often the entire budget. Pi's `isSplitTurn` path generates a *turn-prefix* summary and merges it with the history summary; goatLLM has no analog.
- Settings are hard-coded. pi exposes `compaction.enabled`, `compaction.reserveTokens`, `compaction.keepRecentTokens` in `settings.json` and honors them. goatLLM has no settings at all.

The plan: lift pi's algorithm wholesale, but store the `CompactionEntry` in goatLLM's existing SQLite (not pi's JSONL session file) and replay it through the dual-write journal. No tree, no branch summary, no extension hooks — those are out of scope.

---

## 1. Architecture overview

### 1.1 Data model

Add one table:

```sql
-- 016_compaction_entries.sql
CREATE TABLE compaction_entries (
  id              TEXT PRIMARY KEY,             -- matches chat msg id style (timestamp-random)
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- Pointers into the messages table — same primary keys as Message.id.
  first_kept_id   TEXT NOT NULL,
  -- The summary that replaces every message in this conversation with
  -- id < first_kept_id (and not itself a compaction entry).
  summary         TEXT NOT NULL,
  -- Snapshot of cumulative file ops at the time of compaction.
  read_files      TEXT NOT NULL DEFAULT '[]',  -- JSON array of paths
  modified_files  TEXT NOT NULL DEFAULT '[]',  -- JSON array of paths
  -- Diagnostic metadata.
  tokens_before   INTEGER NOT NULL,            -- raw token count that triggered
  source          TEXT NOT NULL,               -- 'auto' | 'manual' | 'overflow-retry' | 'mid-loop'
  is_split_turn   INTEGER NOT NULL DEFAULT 0,  -- 1 if this compaction split a turn
  turn_prefix     TEXT,                        -- turn-prefix summary if isSplitTurn=1
  prompt_version  TEXT NOT NULL,               -- 'initial' | 'update' — which LLM prompt was used
  created_at      INTEGER NOT NULL,
  -- Mode at time of compaction. Different from the conversation.mode; we may
  -- compact a chat conversation that was later switched to agent.
  mode            TEXT NOT NULL,
  model_id        TEXT                         -- the model that generated the summary
);
CREATE INDEX compaction_entries_conv_idx
  ON compaction_entries(conversation_id, created_at DESC);
```

A conversation has at most a few compaction entries. The "current" one is the one with the largest `created_at`; its `first_kept_id` is where the model should start reading from after replay.

### 1.2 Replay semantics

On hydrate, after the journal + SQLite merge for `messages`, run a post-pass:

```text
for each conversation with at least one compaction_entry:
  latest = most recent compaction_entry for that conversation
  all_messages = sorted(messages[conversation_id], by createdAt)
  if any message.id < latest.first_kept_id and is not the summary itself:
    hide it from the LLM-facing list
  insert the compaction summary as a synthetic system-role message
    positioned at the index right before the message with id == first_kept_id
```

The summary is **never** persisted as a real `messages` row. It is always derived from the latest `compaction_entries` row at hydrate time. This keeps the original messages intact for the meter and for export, and avoids the dual-write confusion of "which copy of the summary is the truth."

### 1.3 Re-cut vs append

pi appends a new `CompactionEntry` on every compact. We do the same, but the table is keyed by `(conversation_id, created_at)`, and the hydration logic always uses the latest. Old compactions stay around as audit trail; they can be displayed in a "compaction history" panel in the future.

---

## 2. Phased implementation

### Phase 1 — Storage and replay (the foundation)

**Goal:** make compaction durable across reload. No algorithm changes yet.

**Changes:**

1. **New Rust migration `016_compaction_entries.sql`** (table above) wired into `lib.rs` migration runner alongside 015.
2. **TS dual-write** in `src/lib/db.ts`:
   - `loadCompactionEntries(conversationId): CompactionEntry[]`
   - `saveCompactionEntry(entry): Promise<void>` (async SQLite) **and** `safeSet(goatllm-journal-compaction:<convId>:<entryId>, JSON.stringify(entry))` (sync journal).
   - On hydrate, merge: read all journal compaction entries, read SQLite, union by `entry.id`, take the latest per `conversation_id`.
3. **TS types** in `src/stores/chat.ts` (or a new `src/lib/compaction/types.ts`):
   ```ts
   interface CompactionEntry {
     id: string;
     conversationId: string;
     firstKeptId: string;
     summary: string;
     readFiles: string[];
     modifiedFiles: string[];
     tokensBefore: number;
     source: "auto" | "manual" | "overflow-retry" | "mid-loop";
     isSplitTurn: boolean;
     turnPrefix?: string;
     promptVersion: "initial" | "update";
     createdAt: number;
     mode: ChatMode;
     modelId?: string;
   }
   ```
4. **Hydration hook in `useComposer` (and `InputBar` legacy path):** before calling `compactMessages`, look up the latest `CompactionEntry` for the conversation. If one exists, build the "LLM-facing message list" as `[...preCompactHidden, summary, ...postFirstKept]` instead of starting from `history`. The meter should still see the *original* `history` for display.
5. **Write path in `compactMessages`:** when compaction actually runs and produces a non-trivial `summarizedCount > 0`, return a new `compactionEntry` field in the `CompactionResult` (or alongside it). Caller writes it to db + journal.

**Files to touch:**
- `src-tauri/migrations/016_compaction_entries.sql` (new)
- `src-tauri/src/lib.rs` (add migration case)
- `src/lib/db.ts` (add compaction entry load/save functions)
- `src/lib/context-manager.ts` (return compaction entry in result)
- `src/components/input-bar/hooks/useComposer.ts` (hydrate from db, write to db)
- `src/components/InputBar.tsx` (mirror the change for the legacy path)
- `src/stores/chat.ts` (add `compactionEntries: Record<convId, CompactionEntry[]>` and a setter)

**Tests:** hydration of a conversation with a compaction entry returns summary + post-kept messages; meter still sees full original count; dual-write survives a SQLite-only and a journal-only scenario.

---

### Phase 2 — Cumulative file tracking

**Goal:** file ops roll forward across compactions, like pi's `extractFileOperations` reading from the previous `CompactionEntry.details`.

**Changes:**

1. In `compactMessages`, before computing `fileOps`, look up the previous `compactionEntry.readFiles` / `compactionEntry.modifiedFiles` and seed the `readFiles` / `modifiedFiles` sets from them. (This is a direct port of `extractFileOperations` in `compaction.ts:18-41`.)
2. In `buildSummary`, include only files *newly added* in this window in the `<read-files>` / `<modified-files>` blocks — the cumulative set is what gets stored on the entry, but the rendered summary shows the delta, otherwise the model sees the same file list three times in a row after three compactions.
3. In `LLM_SUMMARY_PROMPT` (`summarizeWithLlm`), append the cumulative file list to the user prompt as `<cumulative-files>...</cumulative-files>` so the LLM knows the full history. This is a small change to the prompt and matches pi's behavior of including previous summary contents via `<previous-summary>` tags (see `compaction.ts:283-288`).

**Files to touch:**
- `src/lib/context-manager.ts` — `buildSummary`, `summarizeWithLlm`
- `src/__tests__/context-manager.test.ts` — new test: "compaction B includes files from compaction A"

---

### Phase 3 — Iterative summary updates

**Goal:** the second (and later) compaction should use the **update** prompt, not the initial one.

**Changes:**

1. Split `LLM_SUMMARY_PROMPT` into two: `INITIAL_SUMMARY_PROMPT` and `UPDATE_SUMMARY_PROMPT`. The update prompt has different rules — "preserve all existing, add new, move items from in-progress to done" — and is the prompt pi uses for any compaction after the first (see `compaction.ts:226-256`).
2. In `summarizeWithLlm`, accept an optional `previousSummary` parameter. If present, switch to `UPDATE_SUMMARY_PROMPT` and append `<previous-summary>${previousSummary}</previous-summary>` to the user message. Set `promptVersion: "update"` on the entry.
3. In `useComposer`, when about to call `compactMessages`, look up the latest `compactionEntry` for the conversation; pass its `summary` as `previousSummary` to the compact call.
4. Update `buildSummary` to add a small "PREVIOUS CONTEXT" header when called in update mode, mirroring the LLM prompt structure so the extractive fallback is consistent with the LLM path.

**Files to touch:**
- `src/lib/context-manager.ts` — split prompts, thread `previousSummary` through
- `src/components/input-bar/hooks/useComposer.ts` — pass previous summary
- `src/__tests__/context-manager.test.ts` — new tests for the update path

---

### Phase 4 — Better cut-point rules and split-turn handling

**Goal:** never drop a tool result while keeping its producing assistant message. Handle turns that exceed the budget on their own.

**Changes:**

1. **New helper `findValidCutPoints(messages, startIdx, endIdx)`** — port from `compaction.ts:155-194`. Returns indices of messages that are valid cut boundaries: user, assistant, system, custom. Explicitly excludes tool-result-shaped messages. (In goatLLM the tool result lives inside the same `Message` object as the tool call, on `msg.toolCalls[].output`, so the rule is: if a message has `toolCalls` with `output`, the cut must keep the *whole* message including the output — no splitting the assistant message from its tool results.)
2. **New helper `findCutPoint(messages, startIdx, endIdx, keepRecentTokens)`** — port from `compaction.ts:218-289`. Walk backwards from newest, accumulating tokens; snap to the nearest valid cut point at or after the budget boundary. Detect split-turn: if the cut point is in the middle of a user/assistant/tool-call sequence, mark `isSplitTurn = true` and return `turnStartIndex`.
3. **Split-turn summary path:** when `isSplitTurn`, also generate a `turnPrefixSummary` (smaller budget, half of `reserveTokens`). Merge `historySummary + turnPrefixSummary` before returning, with a `---` separator and a "**Turn Context (split turn):**" header, matching `compaction.ts:357-374`.
4. **Wire cut-point rules into `compactMessages`:** replace the current "walk back by `createdAt`" logic with `findCutPoint`. The pinned-message soft cap and "always keep the last message" rules become constraints on the cut-point search, not separate code paths. Specifically:
   - Pinned messages are treated as "cannot be cut" — `findValidCutPoints` must skip over them, equivalent to extending `firstKeptIndex` past any pinned message before the budget boundary.
   - The "always keep the last message" rule becomes "if the last message is a user message or has no tool calls, the cut point must be ≤ last index." This is a strict subset of pi's behavior.

**Files to touch:**
- `src/lib/context-manager.ts` — replace the recency loop with `findCutPoint` + `findValidCutPoints`
- `src/lib/compaction/cut-point.ts` (new) — extracted, testable
- `src/lib/compaction/split-turn.ts` (new) — extracted, testable
- `src/__tests__/cut-point.test.ts` (new) — exhaustive tests of cut-point rules
- `src/__tests__/context-manager.test.ts` — update existing tests to match new behavior

---

### Phase 5 — Trigger check from real usage

**Goal:** the trigger should be `contextTokens > contextWindow − reserveTokens`, not a hard-coded 40K/180K.

**Changes:**

1. **New helper `calculateContextTokens(usage)`** — port of `compaction.ts:67-69`. Returns `usage.totalTokens` if set, else `input + output + cacheRead + cacheWrite`. The Vercel AI SDK exposes this on the `usage` field of every assistant message.
2. **New helper `getLastAssistantUsage(messages)`** — port of `compaction.ts:78-92`. Walks messages in reverse, returns the last non-aborted, non-error assistant message's `usage`.
3. **New helper `estimateContextTokens(messages)`** — port of `compaction.ts:104-126`. Uses `getLastAssistantUsage` for the prefix and `estimateMessageTokens` for the trailing messages. Returns `{ tokens, usageTokens, trailingTokens, lastUsageIndex }`.
4. **New helper `shouldCompact(contextTokens, contextWindow, settings)`** — port of `compaction.ts:130-133`. Returns `contextTokens > contextWindow - reserveTokens` if `settings.enabled`.
5. **Replace the hard-coded budgets in `useComposer` and `InputBar`:** the per-mode budgets go away. Instead, `useComposer` calls `shouldCompact` and respects the result. If the threshold isn't hit, no compact runs (currently it always runs and short-circuits inside `compactMessages`).
6. **Settings source of truth** for the knobs: read from `usageSettings` in the chat store (same place the model overrides live). Defaults:
   - `enabled: true`
   - `reserveTokens: 16_384` (matches pi default)
   - `keepRecentTokens: 20_000` (matches pi default)

**Files to touch:**
- `src/lib/context-manager.ts` — new token accounting helpers
- `src/stores/chat.ts` — add `compactionSettings` to `usageSettings` shape
- `src/components/settings/*` — add a "Context compaction" section
- `src/components/input-bar/hooks/useComposer.ts` — use `shouldCompact` instead of always-call
- `src/components/ContextMeter.tsx` — show "disabled" state when settings.enabled is false

---

### Phase 6 — Surface compactions in the UI

**Goal:** make the summary visible in the conversation timeline.

**Changes:**

1. **Render `CompactionSummaryMessage`** in `MessageList.tsx` / `MessageBubble.tsx` as a distinct visual: an amber-tinted card with the summary heading, the "previous X messages summarized" label, and a `tokensBefore` indicator. Style follows the pinned-message aesthetic in `DESIGN.md` (one accent only).
2. **Compaction history popover** in the top bar (next to ContextMeter): a small dot that appears if a conversation has more than one compaction. Click → list of compactions with timestamps and "kept from message #N" labels.
3. **Empty-state for the summary:** if a user opens a conversation whose first message is "below the cut," show a one-line notice at the top: "Showing summary of N earlier messages. Original transcript not visible — open the conversation in 'expanded' view to see everything." (Optional, for v2.5.)

**Files to touch:**
- `src/components/MessageList.tsx` — new `CompactionBubble` component
- `src/components/MessageBubble.tsx` — handle `role === "compactionSummary"` messages
- `src/components/ContextMeter.tsx` — new popover section
- `src/index.css` — compaction bubble style (one accent only, per DESIGN.md)

---

## 3. What we explicitly skip

These are pi features that don't earn their complexity in goatLLM's current shape:

- **Tree structure / branching.** goatLLM conversations are linear. Adopting `id`/`parentId` tree entries would require rewriting the message store. The dual-write persistence, the SQLite layout, the meter, the message list — all assume a flat array. Cost is enormous; benefit is zero unless we also build `/tree` UI, which is out of scope.
- **Branch summarization.** Only meaningful with branching. Skip.
- **Extension hooks (`session_before_compact`).** goatLLM has no extension system in the pi sense. If we want them later, the `source: "auto" | "manual" | ...` field on the entry plus a `fromHook: boolean` field is enough scaffolding; we don't need a runtime event bus today.
- **JSONL session file.** goatLLM uses SQLite + localStorage. The summary is a row in `compaction_entries`, not a line in `~/.pi/agent/sessions/...jsonl`. The algorithm ports cleanly; the storage layer does not.
- **Prompt caching integration.** pi integrates with Anthropic and OpenAI prompt cache retention. goatLLM already has a `cacheRetention` option on `agentLoop.ts`; we don't need to change it. Compaction is orthogonal to caching — caching reduces the *cost* of the kept prefix; compaction reduces the *size* of the kept prefix.

---

## 4. Test plan

New tests in `src/__tests__/`:

1. **`compaction-persistence.test.ts`** — write a compaction entry, reload, hydrate; assert summary appears in LLM-facing list at the right index.
2. **`compaction-persistence.test.ts`** — dual-write: simulate SQLite-out-of-sync and journal-only; reload should still recover.
3. **`compaction-cumulative-files.test.ts`** — compact A includes file X; compact B (after more tool calls) should include X *and* the new files.
4. **`compaction-iterative.test.ts`** — second compact uses UPDATE prompt (verify by stubbing the LLM call and inspecting the request).
5. **`cut-point.test.ts`** — exhaustive table:
   - cut at user message → not a split turn
   - cut at assistant message with tool calls → keep the whole message including its tool results
   - cut in middle of a turn → isSplitTurn=true, turnPrefixSummary present
   - pinned message straddling the budget → cut snaps to before the pin
6. **`trigger.test.ts`** — `shouldCompact` returns false below threshold, true above; respects `enabled: false`; uses the model's actual context window, not a hard-coded budget.
7. **`estimate-tokens.test.ts`** — `calculateContextTokens` prefers `usage.totalTokens`; falls back to component sum; `estimateContextTokens` correctly mixes usage-based and estimated tokens.

All existing `context-manager.test.ts` tests must continue to pass; some will need updating because of the cut-point rewrite (Phase 4).

---

## 5. Risks and open questions

1. **The `__summary__` placeholder system message in the current code becomes redundant.** The current `compactMessages` injects a synthetic `{ id: "__summary__", role: "system", content: summary }` into the LLM-facing list. After Phase 1, this is replaced by a hydrate-time injection from `compaction_entries`. The `summaryMessageIndex` field on the current result becomes vestigial. Clean it up.

2. **Mid-loop compaction in `agentLoop.ts`** (`compactModelMessages`, `CONTEXT_PRESSURE_THRESHOLD`, `COMPACTION_TARGET`) operates on a different layer — the per-step working messages inside a single agent turn, not the cross-turn history. It should keep its own threshold but should *not* write a `compaction_entry` to the DB, because the summary is regenerated every time the agent loop runs and would flood the table. Add a `source: "mid-loop"` discriminator to make this explicit and skip the db write for that source. (Open question: should mid-loop summaries ever persist? Pi doesn't persist them. We should match pi.)

3. **The `llmSummaryCache` in `useComposer.ts` becomes redundant after Phase 1+3.** With persistent compactions and iterative update, there's no need for an in-memory cache — the latest entry from db is the cache. Delete the `llmSummaryCache` and `llmSummaryInflight` maps.

4. **The `droppedMessages` field on `CompactionResult`** is currently passed to `summarizeWithLlm` to generate the next turn's summary. After Phase 1+3, the LLM summary is written to the db, not to an in-memory cache, and `droppedMessages` becomes unused. Remove it.

5. **Export to Markdown/JSON** needs to handle the summary cleanly. `src/lib/export.ts` should render a `compaction_summary` entry inline, not as a phantom user/assistant message. Test that the export of a compacted conversation reads naturally.

6. **Settings UI for compaction knobs** is the most user-facing change in this plan. Needs to fit the design system. Suggested: a single "Context & memory" section in `Settings.tsx` with three rows — "Auto-compact" toggle, "Reserve tokens for response" number input, "Keep recent tokens" number input. All with the design-system input style; no second accent.

7. **What if the user manually deletes a message after a compaction?** The first-kept pointer becomes invalid. Hydration should detect this (no message with that id exists) and fall back to "no compaction, show all messages." Add a defensive check.

8. **What if a compaction is the most recent entry in the path but the user has since added 50 new messages?** Hydration uses the latest compaction regardless of how many messages have come after. This matches pi's behavior — the summary is the "floor" of context, and everything after the compaction is added on top. No change needed, but worth a test.

---

## 6. Order of operations

Build phases in this order. Each phase is shippable independently.

1. Phase 1 (storage + replay) — the foundation. After this, compaction survives a reload, even with the old algorithm. The dual-write property is preserved end to end.
2. Phase 5 (trigger check) — small, isolated, makes the rest of the system testable. Pairs with the existing `compactModelMessages` mid-loop path; the two thresholds can coexist.
3. Phase 2 (cumulative files) — additive change to `buildSummary` + `summarizeWithLlm`. Visible improvement in agent mode immediately.
4. Phase 3 (iterative updates) — small change to the prompts. Pairs with Phase 2 for full cumulative behavior.
5. Phase 4 (cut-point + split-turn) — biggest algorithmic change. The "always keep the last message" rule changes; pinned-message handling refactors. The most test-heavy phase.
6. Phase 6 (UI) — cosmetic, depends on Phase 1 being in. Best done last so the UI is rendering the final data shape.

Estimated total: ~600–800 lines of TS, ~30 lines of SQL, ~20 lines of Rust. New tests: ~400 lines.

---

## 7. Reference: mapping pi concepts to goatLLM

| pi concept | goatLLM equivalent |
|---|---|
| `~/.pi/agent/sessions/<cwd>/<id>.jsonl` | SQLite `messages` + `compaction_entries` tables |
| `CompactionEntry` (in session JSONL) | SQLite `compaction_entries` row, mirrored to localStorage journal |
| `firstKeptEntryId` | `compaction_entries.first_kept_id` |
| `tokensBefore` | `compaction_entries.tokens_before` (sourced from real usage when available) |
| `CompactionSummaryMessage` (`messages.ts`) | Hydrate-time synthetic system message; not persisted as a real row |
| `buildSessionContext()` walks the path, emits summary first then kept messages | `useComposer` hydrate pass: lookup latest `compaction_entries` row, splice summary into the LLM-facing list |
| `getLastAssistantUsage()` (from `usage`) | New helper in `context-manager.ts`; reads `Message.usage` (need to add field to `Message` type — see Phase 5) |
| `findCutPoint` / `findValidCutPoints` | New `src/lib/compaction/cut-point.ts` |
| `isSplitTurn` + `generateTurnPrefixSummary` | New `src/lib/compaction/split-turn.ts` |
| `extractFileOperations` (reads previous `details`) | Inline in `compactMessages`; seeds `readFiles` / `modifiedFiles` from previous entry's stored lists |
| `SUMMARIZATION_PROMPT` / `UPDATE_SUMMARIZATION_PROMPT` | `INITIAL_SUMMARY_PROMPT` / `UPDATE_SUMMARY_PROMPT` in `context-manager.ts` |
| `SUMMARIZATION_SYSTEM_PROMPT` | `LLM_SUMMARY_PROMPT` (rename for parity) |
| `serializeConversation()` (truncates tool results to 2K chars) | New helper in `src/lib/compaction/serialize.ts`; mirrors `utils.ts:117-186` |
| `formatFileOperations()` (`<read-files>` / `<modified-files>` XML) | Already in `buildSummary`; extend to be delta-aware (Phase 2) |
| `compaction.enabled` / `reserveTokens` / `keepRecentTokens` | New fields in `usageSettings`; defaults match pi |
| `shouldCompact()` | New helper in `context-manager.ts`; replaces hard-coded budgets |
| `CompactionDetails { readFiles, modifiedFiles }` | JSON columns on `compaction_entries` |
| Manual `/compact [instructions]` | Existing ContextMeter "Compact context…" button + instructions input |
| `session_before_compact` extension hook | Out of scope (see §3) |
| `/tree` branching + `BranchSummaryEntry` | Out of scope (see §3) |
