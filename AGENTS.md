## Design System

Always read `DESIGN.md` before making any visual or UI decision. All font choices, color tokens, spacing, border radius, motion timings, and aesthetic direction are defined there. Do not deviate without explicit user approval.

Quick reference (full detail in `DESIGN.md`):
- Fonts: Geist (sans), JetBrains Mono (mono). Never reach for Inter, Roboto, system-ui, or `-apple-system` as primary.
- Accent: `#f59e42` amber, single. No second accent. Use it for active state and the primary action only.
- Tertiary text floor: `#a0a0a0`. Anything dimmer fails WCAG AA on `#1a1a1c`.
- Surfaces: `#1a1a1c` (bg) → `#2a2a2c` / `#2d2d2d` (cards) → `#161618` (sunken/code).
- Hairline: `rgba(255,255,255,0.06)` default, `0.10` on hover/focus.
- Send button is solid `#f59e42`, never cream or white. The most repeated action is the most confident color.

When reviewing UI changes (in `/design-review`, `/qa`, or PR review), flag any:
- Hex value that isn't in `DESIGN.md`'s token list.
- Tertiary text below 4.5:1 against its background.
- Use of decorative gradients, blobs, 3-column icon grids, centered-everything, or any AI-slop pattern listed in `DESIGN.md`.
- New "primary" colors. There is one accent.

## Persistence — Dual Write Strategy

Every message and conversation is written to TWO backends:

1. **localStorage journal** (`goatllm-*` keys) — synchronous, survives any close path including Cmd+Q and force-quit. Written on the calling thread before control returns to the UI.
2. **SQLite mirror** (via Tauri IPC `@tauri-apps/plugin-store`) — async, durable. Powers search, large history loads, and cross-restart loads.

On startup: read the journal first (instant, no IPC), then merge in SQLite. The journal fills gaps SQLite may have missed; SQLite fills gaps the journal may have lost. The UX guarantee is: "type a message, close the app a millisecond later, reopen → it's there."

Source: `src/lib/db.ts`. This is intentional overkill — crash-proof message saving is a real UX moat.

## Git Conventions

Never include AI/bot co-author trailers (Claude, ClaudeCode, CommandCodeBot, etc.) in git commits messages. Only credit human contributors. AI agents are tools, not collaborators.

## Persistence for New Features

When adding any feature that introduces data a user would expect to survive across sessions (messages, attachments, artifacts, tool call state, UI preferences, etc.), you MUST:

1. **Write to both layers** — journal (localStorage) for crash safety AND SQLite for durability. Never persist to only one.
2. **Clean up runtime-only state on hydrate** — any streaming flags, in-progress indicators, pending approval gates, or elapsed-time counters must be reset to a "done" state when loading old chats. A loaded chat should look identical to a finished live chat, not show stale spinners, stuck timers, or non-functional buttons.
3. **Test the reload cycle** — verify that Cmd+Q → reopen restores every piece of user-visible data exactly as it appeared before closing. Pay special attention to timestamps (no "Working for 3d" artifacts), attachment data URLs, artifact version history, and mode toggles that should reset per-session (research, plan).
4. **Don't persist things that should be per-session** — research mode, plan mode, web search count, and similar one-shot toggles must reset on every reload. Remove their localStorage keys during hydrate rather than restoring them.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
