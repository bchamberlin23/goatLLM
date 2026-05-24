# goatLLM

A desktop AI workspace with three modes — chat, coding agent, and design-to-code artifact generation. Model-agnostic. Workspace-aware. Built with Tauri 2, React 19, and the Vercel AI SDK.

## Feature Overview

### Chat

Full streaming chat with multi-model support. No tools, no workspace — just conversation.

- **Streaming responses** with markdown rendering (syntax-highlighted code blocks via Shiki, tables, blockquotes, inline math)
- **Multi-model** — LM Studio, Ollama, OpenAI, Anthropic, Groq, OpenCode Go (DeepSeek V4 free tier included out of the box, no key needed), Google Gemini, xAI Grok, and any OpenAI-compatible endpoint
- **Image attachments** — drag-and-drop images into the chat; multimodal models see them inline
- **Time-of-day welcome** greetings that rotate by hour (🌅 dawn messages, ☕ morning, 🌙 late-night)
- **Editable messages** — edit any message and regenerate from that point in history
- **Conversation management** — search, rename, archive, tag, export to Markdown or JSON
- **Speech-to-text** — Web Speech API for voice input in the chat bar
- **Slash commands** — `/review`, `/plan`, and any workspace-level `.goat/prompts/*.md` templates expand into full prompts

### Agent

Workspace-scoped tools for reading, searching, editing, and running code. Same conversation surface as Chat — toggle via `⌘\` or the mode button.

**Workspace isolation** — pick a project folder; tools cannot escape it. Write operations show a diff preview before approval.

#### Read-only tools (execute automatically)

| Tool | What it does |
|---|---|
| `read_file` | Read workspace files with offset/limit, 50KB cap with chunking hint |
| `list_dir` | List directory contents sorted with folders first |
| `search_content` | Regex search across workspace (skips node_modules, .git, target, dist, build) |
| `search_semantic` | Local vector search via Ollama embeddings — finds semantic matches regex misses |
| `git_status` | `git status --porcelain` |
| `git_log` | Recent commits with optional path filter (`--follow`), compact/full/patch formats |
| `git_blame` | Per-line author + last commit, optional line range |
| `web_search` | Tavily web search (requires API key, separate free tier token available) |
| `read_attachment` | Read text extracted from attached files (PDFs, images, docs) |
| `search_attachment` | Regex search inside attachment text |
| `list_attachments` | List all files the model has attached to the conversation |

#### Write tools (require approval)

| Tool | What it does |
|---|---|
| `write_file` | Create/write files with pre-approval diff preview |
| `edit_file` | Targeted text replacement, single or multi-edit in one call |
| `bash` | Run shell commands with automatic danger classification |
| `diff_file` | Show `git diff` for a specific file |
| `git_branch` | Create or switch branches |
| `git_commit` | Stage + commit with message |
| `git_push` | Push current branch |
| `read_lints` | Run `cargo check` or `tsc --noEmit` (auto-detects) |
| `run_tests` | Run `cargo test` or `vitest` (auto-detects) |
| `browser_fetch` | Fetch http(s) URLs — CORS bypassed via Tauri HTTP plugin, scheme/host blocklist, 200KB cap |
| `browser_extract` | CSS-selector extraction over `browser_fetch` — grab `main`, `article`, `pre code`, etc. |
| `browser_session_open` | Open a persistent headless browser session (keeps cookies, localStorage across calls) |
| `browser_session_navigate` | Navigate within an open browser session |
| `browser_session_close` | Tear down a browser session |
| `index_workspace` | Build semantic index (chunk → Ollama embed → SQLite) for `search_semantic` |

#### Agent infrastructure

- **Permission modes** — Ask (default), Auto-approve read-only, YOLO (approve everything). Toggled from the InputBar pill.
- **Command safety** — `exec_command` classifies every shell command as safe, suspicious, or destructive. Destructive commands (`rm -rf`, `DROP TABLE`, `git push --force`) require double confirmation.
- **Denylist** — `.env`, credentials, private keys, `.ssh`, `secrets/` are blocked at the path level regardless of permission mode.
- **Path traversal protection** — every resolved path is canonicalized and checked against the workspace root.
- **Context management** — auto-summarize long conversations when approaching the model's context window. Pinned messages survive compaction. Context meter in the chat footer shows remaining budget.
- **Context window awareness** — auto-detects per-model context limits via `@earendil-works/pi-ai` registry; user can override per model.
- **ANSI rendering** — terminal output from `bash` tools renders with color codes intact (not raw escape sequences).
- **Subagent loop** — `agentLoop.ts` provides the generic stream loop for the parent agent; designed for future parallel subagent swarms.

### Designer

Turn natural-language briefs into rendered HTML pages, slide decks, and design documents — inline, without leaving the app. The model reads a curated design stack (identity charter + design system + skill template + visual direction) and produces artifacts in the existing ArtifactPanel.

- **Three-mode toggle** — [Chat] [Agent] [Designer]. Modes are mutually exclusive; each gets its own prompt composition path.
- **Skill picker** — 14 templates: web prototype, SaaS landing, dashboard, pricing page, docs page, blog post, mobile app frames, social carousel, magazine poster, simple deck, magazine deck, weekly update deck, PM spec, kanban board. Each carries an HTML seed template + anti-AI-slop checklist + design rules.
- **Design system browser** — 18 design systems (Linear, Stripe, Vercel, Cursor, Supabase, Figma, Raycast, Sentry, Anthropic, OpenAI, Cohere, Mistral, Notion, Airbnb, Apple, Tesla, Spotify, plus two starters) with full 9-section DESIGN.md (palette, typography, spacing, components, motion, voice, anti-patterns) the model reads as source of truth.
- **Visual directions** — 5 directions (editorial, modern-minimal, tech-utility, brutalist, soft-warm) with OKLch palettes + display/body font stacks + reference inspiration. Selected direction's palette binds into `:root` on every artifact render.
- **Discovery form** — on first turn, the model emits a `<question-form>` XML block. The parser renders it as native radio/checkbox/text controls inside the chat bubble (not raw XML). User answers become a structured follow-up message.
- **Artifact pipeline** — supports both markdown ` ```html ``` ` fences and `<artifact kind="html">` XML tags. Extracted artifacts enter the ArtifactPanel automatically.
- **Live HTML preview** — sandboxed iframe renders model output in real time. Design-mode artifacts use `sandbox="allow-same-origin"` (scripts off by default) for safety.
- **PDF/LaTeX** — model generates LaTeX, goatLLM compiles via tectonic (bundled ~30MB, first-run download). Inline PDF preview + download.
- **Python execution** — model generates Python, executes in-browser. Stdout/stderr rendered inline.
- **Office artifacts** — Word (.docx from Markdown), PowerPoint (.pptx from Markdown), Excel (.xlsx from Markdown + pipe tables). Real OOXML blobs, browser-side, no Office runtime needed.
- **Multi-file project workspace** — per-conversation file tree (template.html, brand-spec.md, theme.css, generated assets). Persisted via localStorage.
- **Export pipeline** — single-file HTML download, browser print → Save as PDF, ZIP of all project files.
- **5-dim self-critique** — model scores its own output (philosophy, hierarchy, execution, specificity, restraint) before showing it. Below-3 dimensions trigger a regenerate.

### Artifact Panel (shared across modes)

Universal side panel for viewing and interacting with model-generated content:

- **6 artifact kinds** — HTML, LaTeX (PDF), Python (output), Word, PowerPoint, Excel
- **Monaco editor** — syntax-highlighted source view for every artifact kind. Office formats authored as Markdown and rendered to OOXML on export
- **Preview/Code toggle** — flip between rendered preview and editable source
- **Run** — Python artifacts get a Run button; LaTeX auto-compiles to PDF
- **Critique** — Designer mode HTML artifacts get a 5-dim critique button
- **Print** — HTML artifacts open the browser print dialog for Save as PDF
- **Download** — office formats download as real .docx/.pptx/.xlsx; HTML as .html
- **Copy** — copy source code to clipboard
- **Undo/Redo** — Monaco editor undo stack

### Persistence

**Dual-write strategy** — every message and conversation survives any close path including Cmd+Q and force-quit:

1. **localStorage journal** (`goatllm-*` keys) — synchronous write on the calling thread before control returns to the UI
2. **SQLite mirror** (via Tauri IPC) — async, durable write for search, large history loads, and cross-restart reliability

On startup: read the journal first (instant, no IPC), then merge in SQLite. The journal fills gaps SQLite missed; SQLite fills gaps the journal lost.

### Safety

- **Workspace confinement** — tools resolve and canonicalize every path against the workspace root. Traversal blocked.
- **Denylist patterns** — `.env`, credentials files, `.ssh`, `secrets/`, private keys, `.pem`, `.key`, `id_rsa`
- **Approval gates** — every write operation shows a diff preview card. User clicks Approve or Deny before execution.
- **Command classification** — safe (read-only: `ls`, `cat`, `git status`), suspicious (writes to workspace: `echo > file`, `npm install`), destructive (outside workspace: `rm -rf /`, `chmod 777`, `git push --force`). Destructive requires double confirmation.
- **Network safety** — `browser_fetch` blocks non-http schemes (file://, data:, javascript:), rejects SSRF targets (169.254.169.254, metadata endpoints), and caps output at 200KB.
- **Design artifact sandbox** — Designer-mode HTML renders in an iframe with `sandbox="allow-same-origin"` (scripts disabled) vs `allow-scripts` for Chat mode.

### Settings

- **Provider management** — add/remove API keys for OpenAI, Anthropic, Groq, Google, xAI, and any OpenAI-compatible endpoint. Per-provider custom base URLs.
- **Model overrides** — per-model gear menu: context window, temperature, custom system prompt
- **Local model lifecycle** — Ollama auto-detect, recommended model catalog with hardware-fit labels (Recommended / Will work / Tight fit / Not enough RAM), install/start/stop from Settings
- **Tavily web search** — API key for agent web search. Free tier token available.
- **Semantic index** — toggle Ollama embeddings, pick embedding model, trigger reindex
- **Artifact toggles** — enable/disable auto-extraction, office artifact generation
- **Skills** — pi-compatible skill directory picker, enable/disable individual skills
- **Denylist editor** — add/remove custom blocked patterns

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘N` / `Ctrl+N` | New chat |
| `⌘B` / `Ctrl+B` | Toggle sidebar |
| `⌘,` / `Ctrl+,` | Open / close Settings |
| `⌘\` / `Ctrl+\` | Cycle Chat → Agent → Designer |
| `⌘.` / `Ctrl+.` | Stop streaming |
| `⌘F` / `Ctrl+F` | Focus conversation search |
| `⌘1`–`⌘9` | Switch to conversation by position |
| `Esc` | Close Settings (when open) |

## Tech Stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 19, Vite 6 |
| AI SDK | `ai` (Vercel), `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible` |
| State | Zustand 5 |
| Database | SQLite via `rusqlite` (bundled, WAL mode) |
| Markdown | `react-markdown` + Shiki + `remark-gfm` |
| Editor | Monaco Editor (lazy-loaded) |
| Office | `docx` + `pptxgenjs` + `xlsx` (SheetJS) — all browser-side |
| LaTeX | tectonic (Rust, ~30MB, first-run download) |
| Styling | Tailwind 4 + CSS variables (DESIGN.md is source of truth) |
| Testing | Vitest + React Testing Library + jsdom |
| Linting | TypeScript strict mode |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  React Frontend (Vite dev server :1420)              │
│                                                      │
│  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │ Zustand Store│  │ AI SDK Stream                  │ │
│  │ hydrate from │  │ streamText + tool calling       │ │
│  │ SQLite       │  │                                │ │
│  │ auto-save    │  │ Three prompt paths:             │ │
│  │              │  │  • chat  → buildChatSystemPrompt │ │
│  │              │  │  • agent → buildAgentSystemPrompt│ │
│  │              │  │  • design→ buildDesignSystemPrompt│ │
│  └──────┬───────┘  └───────────────┬────────────────┘ │
│         │                          │                  │
│  ┌──────┴──────────────────────────┴────────────────┐ │
│  │  Tauri invoke() bridge (IPC)                     │ │
│  └──────────────────────┬───────────────────────────┘ │
└─────────────────────────┼─────────────────────────────┘
                          │
┌─────────────────────────┼─────────────────────────────┐
│  Rust Backend           │                             │
│                         │                             │
│  ┌──────────────────────┴───────────────────────────┐ │
│  │  Tauri Commands                                   │ │
│  │  • SQLite CRUD (conversations, messages, events)  │ │
│  │  • File ops (read, write, list directory, trunc)  │ │
│  │  • Search (regex walkdir + glob patterns)         │ │
│  │  • Shell execution (stdout + stderr capture)      │ │
│  │  • Git (status, log, blame, branch, commit, push) │ │
│  │  • Lint / test runners (cargo check, tsc, vitest) │ │
│  │  • Semantic index (walk → chunk → embed → store)  │ │
│  │  • Ollama lifecycle (detect, install, start/stop) │ │
│  │  • LaTeX → PDF (tectonic compile)                 │ │
│  │  • Event log (append-only JSONL)                  │ │
│  └──────────────────┬───────────────────────────────┘ │
│                     │                                 │
│  ┌──────────────────┴───────────────────────────────┐ │
│  │  Safety Layer                                     │ │
│  │  • Path canonicalization + workspace-root check   │ │
│  │  • Denylist pattern matching                      │ │
│  │  • Command classification (safe/suspicious/dest)  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │  SQLite (goatllm.db, WAL mode, auto-migration)    │ │
│  └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.80+)
- [Node.js](https://nodejs.org/) (20+)
- [pnpm](https://pnpm.io/)
- macOS 14+ (Sonoma or later — Tauri 2 requirement)

### Development

```bash
git clone https://github.com/bench/goatLLM.git
cd goatLLM

pnpm install
pnpm tauri dev
```

The app opens a desktop window. Vite dev server at `http://localhost:1420` hot-reloads on file changes.

### Configure Models

1. Open Settings (`⌘,`)
2. Add API keys for cloud providers — OpenAI, Anthropic, Groq, Google Gemini, xAI Grok
3. Or select a local model — Ollama auto-detects; pick from the recommended catalog
4. DeepSeek V4 Free is included out of the box via OpenCode Go — no key required

### Run Tests

```bash
pnpm vitest          # frontend tests (385 tests, jsdom)
cargo test           # Rust backend tests
```

### Build for Distribution

```bash
pnpm tauri build     # produces .dmg in src-tauri/target/release/bundle/
```

## Roadmap

- [x] Chat — streaming, markdown, multi-model, attachments, speech-to-text
- [x] Agent — read-only tools, workspace isolation, permission modes
- [x] SQLite persistence with dual-write journal
- [x] Agent — write tools with approval gates + diff preview
- [x] Command safety classification
- [x] Context management (auto-summarize, pinning, context meter)
- [x] Browser tools (fetch, extract, persistent sessions)
- [x] Semantic search (local Ollama embeddings)
- [x] Git tools (branch, commit, push)
- [x] LaTeX → PDF compilation (tectonic)
- [x] Python execution (in-browser)
- [x] Office artifacts (docx, pptx, xlsx)
- [x] Slash commands (`/review`, workspace prompt templates)
- [x] Designer mode — skill picker, design systems, discovery form, HTML artifacts
- [x] Designer export pipeline (HTML download, PDF print, ZIP)
- [x] Designer 5-dim critique
- [ ] Multi-file Monaco editor in artifact panel (edit template.html, theme.css inline)
- [ ] Agent subagent swarms — parallel orchestration for long-horizon coding sessions
- [ ] Windows + Linux distribution
- [ ] Homebrew cask for macOS

## License

MIT
