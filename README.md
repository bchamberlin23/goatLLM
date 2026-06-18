# goatLLM

> A local-first AI workspace for chat, coding agents, research, and artifacts.
> Built with Tauri 2, React 19, and the Vercel AI SDK.

<!-- Replace with actual screenshot at docs/screenshot.png -->
![goatLLM screenshot](docs/screenshot.png)

---

## Why goatLLM

Most AI tools are either cloud-locked, context-unaware, or treat your local files
as an afterthought. goatLLM is different:

- **Your workspace, not a sandbox.** The agent reads your actual files, runs your
  actual tests, and understands your project structure.
- **You stay in control.** File writes, shell commands, git operations, and browser
  actions require your approval by default.
- **Nothing disappears on crash.** Every message is dual-written to localStorage
  and SQLite so an abrupt exit loses nothing.
- **Model-agnostic.** Use OpenAI, Anthropic, Ollama, LM Studio, or any
  OpenAI-compatible endpoint. Three free models are bundled out of the box.

---

## Quick Start

**Prerequisites:** Node 20+, pnpm, Rust stable,
[Tauri 2 platform deps](https://tauri.app/start/prerequisites/)

```bash
git clone https://github.com/bchamberlin23/goatLLM.git
cd goatLLM
pnpm install
pnpm tauri dev
```

For fast UI iteration without the desktop shell:

```bash
pnpm dev   # Vite only at http://localhost:1420
```

---

## Modes

goatLLM has four primary modes, each with a focused tool set.

### 💬 Chat

Conversational interface with streaming responses. Supports markdown, math,
syntax-highlighted code, tables, attachments, branching/forking, conversation
search, context compaction, and collapsible reasoning blocks for thinking models.

Optional lightweight tools can be toggled on: web search, URL scraping, document
reading, memory management, and sandboxed code execution.

### 🤖 Agent

The agent has read and write access to your workspace. It can browse files,
search code semantically, run tests, make git commits, open browser sessions,
and delegate subtasks to subagents.

**Read tools** run freely. **Write tools are approval-gated:**

| Category | Tools |
|----------|-------|
| Files | `write_file`, `edit_file`, `diff_file` |
| Shell | `bash`, `exec_command`, `run_tests` |
| Git | `git_branch`, `git_commit`, `git_push` |
| Browser | `browser_session_*`, `browser_fetch` |
| Code | `run_python`, `run_javascript` |

The agent is instructed to respect your working tree — it won't silently overwrite
unrelated changes.

### 🎨 Design & Artifacts

Generate and refine artifacts in a side panel. The panel supports:

- **HTML** — live preview in a sandboxed iframe
- **LaTeX** — source editing with PDF compilation
- **Python** — runnable output
- **Office** — Word, PowerPoint, and Excel from markdown/table sources
- **Monaco editor** — for any artifact source

### 📓 Notebook *(feature-flagged)*

A freeform board of text and runnable code cells with AI assistance. Enable it
in settings to get a fourth mode tab.

---

## Models & Providers

| Type | Examples |
|------|---------|
| Cloud APIs | OpenAI, Anthropic, Google, Mistral, Groq |
| Local | Ollama, LM Studio |
| Compatible | Any OpenAI-compatible endpoint |
| Free (bundled) | DeepSeek V4 Flash, MiMo V2.5, Nemotron 3 Super |

Configure providers, API keys, and custom base URLs in Settings.

---

## Safety Model

goatLLM is conservative around your local system by default:

- Workspace paths are validated against the selected root — no path traversal
- Sensitive files (`.env`, private keys, `.ssh`, `secrets/`) are blocked
- Shell commands are classified by risk level before execution
- Browser fetch blocks non-HTTP schemes and cloud metadata endpoints
- Artifact previews run in a sandboxed iframe
- All write operations require explicit approval unless you opt out

---

## Persistence

Messages survive crashes through a **dual-write strategy**:

1. **Synchronous** — written to `localStorage` immediately on every message
2. **Async** — mirrored to SQLite via Tauri IPC

On startup the localStorage journal loads first for instant recovery, then merges
with SQLite. If you send a message and force-quit, it will be there when you reopen.

> **For contributors:** any new user-visible durable state should follow this same
> pattern — write to both layers, reset runtime-only flags on hydrate.

---

## Architecture

```
React / Vite frontend
  src/App.tsx · src/components/ · src/stores/chat.ts · src/lib/
        │
        │  Tauri invoke()
        ▼
Rust backend
  commands/db · files · git · search · tools · extract · latex · memory · embeddings
  mcp.rs · ollama.rs · searxng.rs
        │
        ▼
localStorage · SQLite · filesystem · shell · git · Ollama · HTTP · MCP
```

**Key frontend modules:**

| Module | Role |
|--------|------|
| `src/stores/chat.ts` | Central Zustand store and persistence |
| `src/lib/llm.ts` | Streaming and model interaction |
| `src/lib/agentLoop.ts` | Agent execution loop |
| `src/lib/tools/` | Tool definitions, registry, and approval |
| `src/lib/system-prompt.ts` | Prompt construction for chat and agent |
| `src/lib/db.ts` | Dual-write persistence |
| `src/lib/semantic-index.ts` | Local embedding index |
| `src/lib/memory.ts` | Durable memory operations |
| `src/lib/command-safety.ts` | Shell command risk classification |
| `src/components/ArtifactPanel.tsx` | Artifact preview and editing |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop shell | Tauri 2 |
| Backend | Rust |
| Frontend | React 19, Vite 6 |
| Styling | Tailwind 4, CSS variables |
| State | Zustand 5 |
| LLM streaming | Vercel AI SDK |
| Local providers | Ollama, LM Studio |
| Editor | Monaco |
| Markdown | react-markdown, remark-gfm, Shiki, KaTeX |
| Office artifacts | docx, pptxgenjs, xlsx |
| Validation | Zod |
| Tests | Vitest, Testing Library |

---

## Development

```bash
pnpm test          # Vitest suite
pnpm typecheck     # TypeScript checks
pnpm lint          # ESLint
pnpm build         # TS + Vite build
pnpm tauri build   # Desktop bundle

# Targeted tests
pnpm test src/__tests__/system-prompt.test.ts
pnpm test src/__tests__/product-workspace.test.ts
```

**Before making UI or visual changes, read [`DESIGN.md`](DESIGN.md).** It defines
fonts, the amber accent (`#f59e42`), surface tokens, spacing, motion, and a list
of anti-patterns to avoid.

---

## Contributing

- Dual-write all user-visible durable state; reset runtime flags on hydrate
- Prefer structured tool APIs over raw shell calls in agent prompts
- Write focused regression tests for prompt, persistence, tool, and hydrate behavior
- No AI co-author trailers in commit messages
- No force-pushes or destructive git ops unless explicitly requested

---

## Roadmap

**Done**
- Streaming chat with markdown, math, attachments, and branching
- Workspace-aware agent with approval-gated write tools
- Dual-write persistence with crash recovery
- Artifact extraction, preview, editing, and Office export
- Deep research flow with progress UI
- Skills, memory, todos, MCP, browser sessions, subagents
- Semantic workspace search with local embeddings
- Notebook mode (feature-flagged)

**Up next**
- Full notebook workflows
- Multi-file artifact editing
- E2E coverage for desktop flows
- Release signing and auto-updater
- Windows and Linux distribution hardening
- Unified model capability and routing registry

---

## License

MIT
