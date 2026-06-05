# Contributing to goatLLM

Thanks for your interest in goatLLM. This guide covers the practical steps for getting the project running locally and the conventions every PR is expected to follow.

## Prerequisites

- **Node.js 20+** and **pnpm** (`corepack enable pnpm` is the cleanest way in)
- **Rust** (stable toolchain) and the platform toolchain required by Tauri 2 — see <https://tauri.app/start/prerequisites/>
- **macOS** for the desktop build (the release matrix targets `aarch64-apple-darwin`, `x86_64-apple-darwin`, and `x86_64-unknown-linux-gnu`)

## Install

```bash
pnpm install
```

This installs the web/TS toolchain (Vite, Vitest, Tauri CLI, Monaco, AI SDK packages, etc.) and resolves the workspace lockfile.

## Run the desktop app (dev)

```bash
pnpm tauri dev
```

This boots Vite on `http://localhost:1420` and launches the Tauri shell against it. The first run will compile the Rust backend, which takes a few minutes; subsequent runs are incremental.

To run the renderer in isolation (no Tauri shell, faster iteration on UI):

```bash
pnpm dev
```

## Run the tests

```bash
pnpm test          # Vitest, 692 tests
```

For the Rust side:

```bash
cd src-tauri
cargo test
```

## Build

```bash
pnpm build         # tsc -b && vite build
```

For a signed desktop bundle, follow the Tauri 2 bundler docs and the release workflow at `.github/workflows/release.yml`.

## Code conventions

- **TypeScript:** strict mode, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`. Prefer named exports; avoid `default export` for components.
- **React 19:** function components only. State lives in Zustand stores under `src/stores/`; no Context for app state.
- **Styling:** Tailwind v4 (driven by `@tailwindcss/vite`). All design tokens are in `DESIGN.md` — fonts, color, spacing, motion, radius. Do not introduce new hex values, new "primary" colors, or new fonts. The single accent is `#f59e42`.
- **Persistence:** any data a user expects to survive a Cmd+Q → reopen must dual-write to the localStorage journal **and** SQLite via `@tauri-apps/plugin-store`. See `AGENTS.md` → "Persistence" for the full contract, including runtime-state cleanup on hydrate.
- **Commits:** conventional commits, scoped, imperative mood. **Do not include AI/bot co-author trailers** (no `Co-Authored-By: Claude …`, `Codex …`, `CommandCodeBot …`, etc.). AI agents are tools, not collaborators.
- **PRs:** fill out `.github/PULL_REQUEST_TEMPLATE.md` end-to-end. The test-plan checklist must be ticked.

## Project layout

```
src/                 React + TS renderer
  components/        UI components (one folder per concern)
  lib/               Pure logic (tools, stores, helpers)
  stores/            Zustand stores
  __tests__/         Vitest suites
src-tauri/           Rust backend + Tauri config
docs/                Design notes, specs
public/              Static assets served by Vite
```

## Filing issues

- **Bug:** use `.github/ISSUE_TEMPLATE/bug_report.md`. Include the commit hash, OS, and reproduction steps. Paste console output; scrub any API keys.
- **Feature request:** use `.github/ISSUE_TEMPLATE/feature_request.md`. Describe the problem first, then the proposed UX. Mark persistence and design-token impact explicitly.

## Review

All PRs require a review from `@bench` (see `CODEOWNERS`). Expect architectural feedback on the design system, persistence, and trust boundaries around the model/tool layer before style nits.
