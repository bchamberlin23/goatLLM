# Design System — goatLLM

> Source of truth for typography, color, spacing, layout, and motion.
> Read this before making any visual or UI decision. Flag deviations in PR review.

## Product Context

- **What this is:** A local-first multi-provider LLM chat client packaged as a Tauri desktop app. Chats with cloud providers (OpenAI, Groq, OpenCode Go) and local providers (LM Studio, Ollama). Has an "Agent" mode that operates against a workspace with file edits, shell, and web search.
- **Who it's for:** Developers who want a fast, transparent multi-provider chat that can also act as an agent against their own machine.
- **Space / industry:** Developer tools / LLM clients. Peers: Claude Code, Cursor's chat panel, Jan.ai, LM Studio UI, Open WebUI, Cherry Studio.
- **Project type:** Desktop web app (Tauri 2 + React 19 + Vite + Tailwind 4).

## The memorable thing

**A serious tool for builders.** First three seconds should feel like opening a workshop, not a chatbox. The opposite of ChatGPT's friendly bubble. Dark utilitarian surface, sharp typography, one warm accent that signals "active." Nothing performs at you. Everything earns its pixels.

Every design decision below serves that feeling.

## Aesthetic Direction

- **Direction:** Workshop-grade utilitarian. IDE-adjacent, not chatbox-adjacent.
- **Decoration level:** Minimal with purpose. No patterns, no textures. The radial warmth on the chat surface is atmospheric, not decorative. Hairline borders at white/5–white/10 do the structural work.
- **Mood:** Calm dark surface, sharp grotesque type, one warm accent. Restraint signals seriousness. The user should feel they've arrived at a tool, not a product demo.
- **Reference posture:** Linear's restraint, Raycast's warmth, Vercel dashboard's typography — but darker, more workshop, less marketing.

## Typography

Loaded via Google Fonts in `index.html`.

- **Display / UI / Body:** Geist — sharp, technical, neutral, made for product UI. Replaces Inter (which is the convergence default everyone reaches for, including ChatGPT and Claude Desktop).
- **Data / Mono / Code:** JetBrains Mono — already shipped, excellent fit. Tabular numerals enabled.
- **Loading strategy:** Google Fonts CDN, `display=swap`, weights 400 / 450 / 500 / 600 / 700 for sans; 400 / 500 for mono.

### Type scale

Sizes are in pixels (Tailwind arbitrary values). Root is 16px.

| Role | Size | Used for |
|------|------|----------|
| caption | 10–11.5 px | kbd hints, uppercase metadata labels, version chips |
| small | 12–12.5 px | UI labels, secondary buttons, settings prose |
| body | 13–14 px | message text, settings descriptions, dropdown items |
| lead | 16 px | input bar textarea (the most-touched control) |
| h3 | 18 px | section headings inside Settings |
| h2 | 22 px | modal titles |
| h1 | 28 px | empty-state heading |

**Tabular numerals** are required wherever numbers should align in columns. The `index.css` rule auto-applies them to `kbd`, `code.font-mono`, `.code-block__lang`. Add the `.tabular-nums` utility (or `font-variant-numeric: tabular-nums`) for sidebar timestamps, conversation/message counts, line numbers, token counts, and pagination indicators (`1 / 12`).

### Font feature settings

`font-feature-settings: "cv11", "ss01"` enabled globally for Geist's preferred glyphs.

## Color

Restrained: one warm accent, three-tier neutral system, four semantic colors.

### Tokens

CSS variables defined in `:root` (`src/index.css`). Tailwind arbitrary values still reference these by literal hex throughout the codebase — DESIGN.md is the source of truth, the variables let future themes override.

```
/* Surfaces (lightest at top to darkest at bottom in z-stack) */
--bg              #1a1a1c    main app background
--surface-1       #2a2a2c    panels, popovers, modals
--surface-2       #2d2d2d    cards (input bar, message bubbles)
--surface-3       #212122    sunken cards (settings rows)
--sunken          #161618    code blocks, mono surfaces

/* Borders */
--hairline        rgba(255,255,255,0.06)   default border
--hairline-strong rgba(255,255,255,0.10)   hover, focus

/* Text */
--text-1          #ececec    primary content
--text-2          #b4b4b4    secondary (subtitles, descriptions)
--text-3          #a0a0a0    tertiary (timestamps, metadata, kbd)  -- WCAG AA at 5.4:1 on #1a1a1c
--text-4          #888888    placeholder, disabled

/* Accent (single warm) */
--accent          #f59e42    amber. Active state, primary action, attention.
--accent-hover    #f0903a    one shade darker for hover states
--accent-soft     rgba(245,158,66,0.10)    backgrounds, fills

/* Semantic */
--success         #34d399    positive, online, copied
--warning         #f59e42    same as --accent (warning is the accent's other job)
--error           #f87171    destructive, offline, failed
--info            #60a5fa    informational tool states (currently unused, reserved)
```

### Color usage rules

1. **The accent is for active state.** The active conversation marker, the primary send button, the `Auto` permission mode, the active "Continue generating" hint. Not decoration. Not a hover state.
2. **No second accent.** If you want to highlight something, use elevation (a brighter surface) or weight (heavier type), not a new color.
3. **Semantic colors are restrained.** Green for "online / copied / configured." Red for "offline / destructive / error." Amber doubles as warning. No blues for "primary."
4. **Dark mode is the only mode.** Light mode is a Phase 2 — when it ships, the surface tokens redesign rather than invert, and saturation drops 10–20% on accent.
5. **Accessibility floor:** body and metadata text must clear 4.5:1 against their background. `#a0a0a0` on `#1a1a1c` is the minimum acceptable tertiary text.

## Spacing

4px base unit. Density is **comfortable** in the message column, **compact** in toolbars and dropdown lists.

| Token | Value | Tailwind | Used for |
|-------|-------|----------|----------|
| 2xs | 2 px | `0.5` | kbd inner padding |
| xs | 4 px | `1` | tight icon gaps |
| sm | 8 px | `2` | gap between siblings in toolbars |
| md | 12 px | `3` | gap between unrelated controls |
| lg | 16 px | `4` | section internal padding |
| xl | 24 px | `6` | section external padding (left/right) |
| 2xl | 32 px | `8` | between major sections in Settings |
| 3xl | 48 px | `12` | empty-state breathing room |
| 4xl | 64 px | `16` | reserved |

## Layout

- **Approach:** Grid-disciplined shell, content-flexible body.
- **Sidebar:** 244 px fixed width.
- **Message column max-width:** 720 px. Tool output, artifact panels, and code can break to full-bleed inside the chat column.
- **Title bar:** 32 px reserved at top of main column for Tauri drag region. Sidebar reserves 46 px to clear macOS traffic lights.
- **Modal:** 600 × 640 px, max 92vw / 88vh.

### Border radius

Hierarchical, not uniform. Bigger radius signals more discrete element.

| Token | Value | Used for |
|-------|-------|----------|
| sm | 4 px | kbd, inline tags, code-block lang chip |
| md | 6–8 px | buttons, inputs, dropdown items |
| lg | 12 px | cards, settings rows, popovers |
| xl | 16 px | modals |
| 2xl | 24 px | input bar (signature shape — keep it) |
| full | 9999 px | send button, status dots, avatars |

## Motion

**Approach:** Minimal-functional. Motion aids comprehension; it does not perform.

```
--ease-out   cubic-bezier(0.2, 0, 0, 1)     enters
--ease-in    cubic-bezier(0.4, 0, 1, 1)     exits
--ease-move  cubic-bezier(0.4, 0, 0.2, 1)   moves

--d-micro    110 ms    dropdowns, popovers, context menus
--d-short    180 ms    hover states, button feedback, color transitions
--d-medium   300 ms    settings gear rotate, modal fade-in, sidebar entrance
--d-long     500 ms+   reserved (do not use casually)
```

### Already-shipped animations (in `index.css`)

- `shimmer-sweep` 2.4 s — "Working" / "Thinking" indicator
- `cursor-blink` 1 s — streaming text cursor
- `dot-pulse` 1.5 s — "checking provider health" status dot
- `pulse-soft` 1.6 s — running tool icon
- `fadeIn` 320 ms — empty-state entrance
- `fadeInUp` 150 ms — scroll-to-bottom button reveal
- `dropdownIn` 110 ms — popover entrance
- `contextMenuIn` 110 ms — right-click menu entrance

## Iconography

- **Library:** lucide-react. Already in use. Industry standard for builder tools.
- **Default size:** 13–16 px. 13 for inline metadata, 14–15 for buttons, 16 for primary actions.
- **Default stroke width:** 1.75. Lighter (1.5) for very small icons, heavier (2–2.4) for primary action icons (Send arrow).
- **Always pair icon-only buttons with `aria-label`.** Decorative icons get `aria-hidden="true"`.

## Component patterns

These are the shipped patterns to follow. New components should compose from these tokens, not invent new ones.

- **Card:** `bg-surface-3` (`#212122`) + `border border-hairline` + `rounded-lg`. Interactive: hover lifts to `surface-2`.
- **Input:** `bg-surface-1` + `border-hairline` + `rounded-md`. Focus: `border-hairline-strong` + soft amber glow ring `shadow-[0_0_0_3px_var(--accent-soft)]`.
- **Primary button:** `bg-accent text-bg`. The Send button. Used for the single most committed action in the surface.
- **Secondary button:** `bg-white/5 text-text-2` + hover `bg-white/10`. Used for everything else.
- **Destructive button:** uses `--error` only, never `--accent`.
- **Hairline divider:** `bg-white/5`, height 1 px.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-24 | Initial design system | Codified the emerging system after a /plan-design-review surfaced design-token drift, contrast issues, and missing system foundation |
| 2026-05-24 | Geist replaces Inter | Inter is the slop default. Geist is sharper, made for technical UIs, signals taste at moment-zero |
| 2026-05-24 | Send button is solid amber, not cream | The most repeated action in the app should be the most confident color. Ties send to "active" semantic |
| 2026-05-24 | Tabular numerals globally for mono | Numbers in tool output, line numbers, kbd hints, timestamps must align — tiny detail builders notice |
| 2026-05-24 | `#a0a0a0` is the floor for tertiary text | WCAG AA 5.4:1 on `#1a1a1c`. Replaces `#6e6e6e` (3.5:1, fails AA) used pre-review |
| 2026-05-24 | One accent only | Restraint signals seriousness. Multiple accents would make goatLLM look like a SaaS dashboard |
