## Summary

<!-- One or two sentences describing what this PR changes and why. -->

## Changes

<!-- Bulleted list of the substantive changes. -->

## Test plan

<!-- How did you verify this works? Commands run, scenarios covered. -->

- [ ] `pnpm install`
- [ ] `pnpm tsc --noEmit`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `cargo test` (in `src-tauri/`)

## Checklist

- [ ] Source code follows `DESIGN.md` tokens (fonts, colors, spacing, motion)
- [ ] No new "primary" colors introduced (one accent: `#f59e42`)
- [ ] No AI co-author trailers in the commit message (per `AGENTS.md`)
- [ ] Persistence is dual-written (localStorage journal **and** SQLite via `@tauri-apps/plugin-store`) for any data that must survive reload
- [ ] Loaded chats reset runtime-only state (streaming flags, timers, research/plan toggles) on hydrate
