# Design Mode — Plan

> Goal: Add a third mode "Design" next to Chat and Agent, recreating the Open Design loop inside goatLLM while keeping our existing visual identity (Geist + JetBrains Mono, single amber accent, three-tier neutrals, hairline borders, no decorative gradients). No new fonts, no new accents, no Open Design chrome.

## What goatLLM already has that we keep

- **Artifact panel + sandboxed iframe preview** (`ArtifactPanel.tsx`, kinds: html / python / latex / docx / pptx / xlsx). Solid foundation; we extend rather than replace.
- **Streaming artifact parser** (`artifact-segments.ts`).
- **Skills directory** (`lib/skills.ts`, `lib/skill-seed.ts`).
- **System-prompt composer** (`lib/system-prompt.ts`).
- **Conversation store + persistence** (`stores/chat.ts` + dual-write SQLite/journal).
- **ModeToggle** (Chat / Agent radio pair).
- **Pi-ai context-window registry** + ContextMeter (just shipped).

We do **not** reproduce Open Design's full PATH-scan-for-CLI architecture, ACP/JSON-RPC dispatch to Claude Code / Codex / Cursor, or Electron sidecar IPC. Our agent runtime is the existing model providers — that's the right form factor for goatLLM. We port what's portable (the design loop, skills, design systems, directions, discovery form, project workspace) and ignore what isn't (CLI multiplexing, sidecar protocol).

## The new Design mode

A third tab on `ModeToggle`: `[ Chat ] [ Agent ] [ Design ]`. Selecting it:

1. Swaps the empty-state hero for a **skill picker grid** — one card per skill, grouped by scenario. Click a card → it's the active skill.
2. Reveals a **design system pill** + **direction pill** in the InputBar footer, peers to the existing AgentPill.
3. Replaces the system prompt with the design stack: identity charter + active `DESIGN.md` + active `SKILL.md` + project metadata + skill side-files.
4. First user message triggers the **discovery form** — a streamed `<question-form>` payload the chat surface renders as native radios/checkboxes, not chat text.
5. Subsequent turns produce one or more `<artifact>` blocks → live in the artifact panel, downloadable as HTML/PDF/ZIP.

We do not break the existing Chat/Agent paths. Design mode is additive.

## Architecture sketch

```
ModeToggle (Chat / Agent / Design)
   │
   └── designMode = true (new chat-store flag, mutually exclusive with agentMode)
        │
        ├── DesignHero — skill picker grid (replaces welcome message in design mode)
        │
        ├── InputBar
        │     ├── DesignSystemPill   — opens DesignSystemPicker (~30 systems)
        │     └── DirectionPill      — opens DirectionPicker (5 directions)
        │
        ├── System prompt composer (lib/design/prompt.ts)
        │     identity_charter
        │     + active DESIGN.md
        │     + active SKILL.md
        │     + project metadata (kind, fidelity, scenario)
        │     + skill side-files (template.html + references/*.md)
        │     + DISCOVERY directives (turn-1 form, anti-slop, 5-dim critique)
        │
        ├── QuestionFormRenderer — parses <question-form id="discovery"> in stream
        │     Renders inline in the message body as radios / checkboxes / chips.
        │     Submitting the form sends the answer as a structured user turn.
        │
        ├── ArtifactPanel (existing)
        │     Now also exposes "Open in workspace" — multi-file editor
        │     for the generated project (template.html, brand-spec.md,
        │     theme.css, generated assets).
        │
        └── DesignProject — per-conversation folder under
              localStorage / sqlite that stores the multi-file artifact tree.
```

## Library shape

New directory: `src/lib/design/`

```
design/
├── skills.ts            ← SKILL definitions (TS data, not loose files for v1)
├── systems.ts           ← DesignSystem definitions (TS data)
├── directions.ts        ← 5 visual directions with OKLch palettes
├── prompt.ts            ← composeDesignSystemPrompt()
├── parser.ts            ← <question-form>, <artifact-meta>, <todo-write> tag parser
├── critique.ts          ← 5-dim self-critique runner (post-stream LLM call)
├── project.ts           ← per-conversation file tree (read/write/save-as-zip)
└── export.ts            ← single-file HTML, PDF (browser print), ZIP
```

`Skill` shape (TS-native, not loose markdown for the first cut):

```ts
export interface Skill {
  id: string;                          // "saas-landing"
  name: string;                        // "SaaS landing"
  scenario: "design" | "marketing" | "operation" | "engineering"
          | "product" | "finance" | "hr" | "personal";
  mode: "prototype" | "deck" | "document";
  preview: { kind: "single-page" | "multi-frame" | "deck"; aspect?: string };
  description: string;                 // 1 sentence shown on the picker card
  template: string;                    // assets/template.html as inline string
  references: string[];                // references/*.md as inline strings
  defaultFor?: "prototype" | "deck";   // marks the picker default
  example?: { html: string };          // optional canned preview thumbnail
}
```

`DesignSystem` shape:

```ts
export interface DesignSystem {
  id: string;                          // "linear-app"
  name: string;                        // "Linear"
  category: "ai" | "devtools" | "productivity" | "fintech"
          | "media" | "automotive" | "starter" | "other";
  // The 9-section DESIGN.md baked in.
  designMd: string;
  // 4-color signature swatch shown on the picker card.
  swatches: [string, string, string, string];
  // Font stack hint for the card preview.
  fonts: { display: string; body: string; mono: string };
  isStarter?: boolean;                 // "default" + "warm-editorial"
}
```

`Direction` shape:

```ts
export interface Direction {
  id: "editorial" | "modern-minimal" | "tech-utility" | "brutalist" | "soft-warm";
  name: string;                        // "Editorial — Monocle / FT"
  mood: string;                        // 1 sentence
  palette: { bg: string; fg: string; accent: string; mute: string }; // OKLch
  fonts: { display: string; body: string };
  refs: string[];                      // ["Monocle", "FT Weekend", "NYT Magazine"]
}
```

## v1 catalog scope

Cut deep, ship working. We ship a curated subset, not 130 skills. Adding more is one TS object literal each, so the picker scales naturally.

**Skills (v1 — 14 total)**:
- prototype × 9: `web-prototype` (default), `saas-landing`, `dashboard`, `pricing-page`, `docs-page`, `blog-post`, `mobile-app`, `social-carousel`, `magazine-poster`
- deck × 3: `simple-deck` (default), `magazine-deck`, `weekly-update`
- document × 2: `pm-spec`, `kanban-board`

**Design systems (v1 — 18 total)**:
- Starters: `default` (Neutral Modern), `warm-editorial`
- Devtools: `linear-app`, `vercel`, `stripe`, `cursor`, `supabase`, `figma`, `raycast`, `sentry`
- AI: `anthropic`, `openai`, `cohere`, `mistral`
- Productivity: `notion`, `airbnb`
- Other: `apple`, `tesla`, `spotify`

Source the `DESIGN.md` text from the upstream `awesome-design-md` repo (Apache-2.0). One-off import script, then they're TS data forever — no runtime fetch.

**Directions (v1 — 5)**: editorial · modern-minimal · tech-utility · brutalist · soft-warm. Full OKLch + font stack.

## The discovery loop

Turn 1 (user types brief, hits send):
1. System prompt is the design stack with the active SKILL + DESIGN.md inlined.
2. Model emits `<question-form id="discovery">…</question-form>` only — no artifact, no narration. Hard rule.
3. Form parser intercepts the tag in the streaming body, renders inline radios/checkboxes for: surface · audience · tone · scale · brand-context.
4. User answers. Submission becomes a structured user message: `[discovery] surface=marketing, audience=devs, tone=technical, …`.

Turn 2 branches:
- **Has brand spec** (user attached screenshot / link / hex list) → agent runs the 5-step brand-extraction protocol (locate · download · grep hex · write `brand-spec.md` · summarize), then proceeds to artifact.
- **No brand spec** → agent emits a second `<question-form id="direction">` with the 5 cards. User clicks one; that direction's palette + fonts get bound into the seed template's `:root`.

Turn 3+ (post-discovery):
- Agent reads the skill's `assets/template.html` + `references/*.md` (already in system prompt as side-files), runs internal P0 checklist, optionally a 5-dim critique pass, then emits `<artifact kind="html" id="…">…</artifact>`.

The `<question-form>` parser is new. Everything else builds on goatLLM's existing artifact pipeline.

## UI work

- **`ModeToggle.tsx`** — add a third radio. The toggle becomes 3-wide; check max width on the empty-state row.
- **`DesignHero.tsx`** (new) — skill picker grid, replaces welcome hero when `designMode && !activeId`. Cards group by scenario, show preview thumbnail (canned `example.html` for v1), name, 1-sentence description.
- **`DesignSystemPicker.tsx`** (new) — modal triggered from the InputBar pill. Two-column layout: left list of categories + names, right preview of the active system's swatches + type specimen. Same dark surface vocabulary as the existing settings modal.
- **`DirectionPicker.tsx`** (new) — 5 cards in a row, each showing a 4-swatch strip + display-font sample + mood line. Click sets the active direction.
- **`QuestionFormRenderer.tsx`** (new) — given a parsed form tree, render native form controls inside the assistant message bubble. On submit, dispatch a structured follow-up message.
- **`MessageBubble.tsx`** — extend the streaming-content renderer to swap `<question-form>` segments with the renderer above. Existing artifact / code-fence handling untouched.
- **`InputBar.tsx`** — show DesignSystemPill + DirectionPill when `designMode`, hide AgentPill (mode is mutually exclusive).
- **`ArtifactPanel.tsx`** — already supports HTML; add a "View project files" sidebar listing `template.html`, `brand-spec.md`, `theme.css`, plus any generated images. Same Monaco editor as today.

## Store changes

`stores/chat.ts`:

- Add `designMode: boolean` flag (mutually exclusive with `agentMode` — toggling either off the other).
- Add `activeSkillId: string | null`, `activeSystemId: string | null`, `activeDirectionId: string | null`.
- Per-conversation: `designProject?: { skillId, systemId, directionId, files: Record<string, string> }`. Persisted alongside messages.

`getActiveLlmConfig` is unchanged. The Design system prompt is composed in `lib/design/prompt.ts`, called from `InputBar.handleSend` when `designMode` is true (parallel to the existing chat/agent system prompt path).

## Visual direction

We do not borrow Open Design's chrome (their orange-tinted hero, their card grids, their gradient strip). Everything stays goatLLM's existing voice:

- Surfaces: `#1a1a1c` → `#2a2a2c` → `#161618` (already in design tokens).
- Hairlines: `rgba(255,255,255,0.06)` default, `0.10` on hover.
- Single accent: `#f59e42` for active state and primary action only.
- No decorative gradients, no second accent, no rounded purple cards.
- Skill preview cards: simple flat thumbnails, hairline border, name + 1-sentence description. Active state = amber border, not amber background.

The `DESIGN.md` of each system is *content* the model reads. None of it themes the goatLLM UI itself — the chat shell stays goatLLM's design system regardless of which design system the user picks for their artifact.

## Sequencing — what we do per Ralph iteration

The implementation is big enough to want clear checkpoints. Suggested loop:

| Iteration | Deliverable | Done when |
|---|---|---|
| 1 | Mode plumbing | `designMode` flag on store, ModeToggle 3-wide, mutual exclusion with agentMode, no UI change beyond the new pill |
| 2 | `lib/design/{skills,systems,directions}.ts` | 14 skills, 18 systems, 5 directions all typed and exported, lint clean. No UI yet. |
| 3 | `DesignHero` skill picker + active-skill state | Selecting a skill in the empty state sets `activeSkillId`, persists, survives reload |
| 4 | `DesignSystemPicker` + `DirectionPicker` modals + InputBar pills | Both pills open their picker modal, active selection round-trips |
| 5 | `lib/design/prompt.ts` + wire into `InputBar.handleSend` | Sending a message in design mode sends the design system prompt to the model. Existing chat/agent paths untouched. |
| 6 | `lib/design/parser.ts` + `QuestionFormRenderer` | `<question-form>` in the stream renders as inline radios/checkboxes; submit sends a structured turn |
| 7 | Direction-branch + brand-extraction guidance in the system prompt | Turn-2 form fires when no brand spec attached; selecting a direction binds its palette into subsequent renders |
| 8 | `DesignProject` multi-file workspace in ArtifactPanel | Side-panel lists project files, clicking opens in Monaco, edits round-trip to the model on next send |
| 9 | Export polish — single-file HTML, PDF (print), ZIP | All three buttons in ArtifactPanel produce a real download for design artifacts |
| 10 | 5-dim critique pre-emit gate (optional, behind a setting) | Setting enabled → agent runs critique pass before final artifact, score visible in the message footer |

We can collapse 1+2, 3+4, and 6+7 into single iterations if iteration size allows. The dependency order matters: store → data → pickers → prompt → parser → workspace → export → critique.

## Out of scope for v1

- Multi-CLI agent dispatch (Claude Code / Codex / Cursor / etc.).
- ACP / JSON-RPC sidecar protocol.
- Plugin marketplace, skill marketplace, importing skills from a GitHub URL.
- HyperFrames HTML→MP4 rendering.
- Image / video / audio generation surfaces. (Existing chat-side generation continues to work; we just don't add a Design-mode-specific path for now.)
- 130 skills + 150 systems. We start with the 14 + 18 above, expand by PR.
- Comment-mode surgical edits on the preview iframe (Open Design themselves only ship a partial version).
