# goatLLM

A desktop AI coding agent with workspace-aware tool calling. Built with Tauri 2, React, and the Vercel AI SDK.

## Features

### Chat
- Streaming responses with markdown rendering (syntax-highlighted code blocks, tables, blockquotes)
- Multi-model support — LM Studio, Ollama, OpenAI, Groq, OpenCode Go (20+ models)
- Image attachments via multimodal models
- Conversation management with search, rename, export (Markdown/JSON)
- Editable messages with re-generation from any point in history

### Agent Tools

**Read-only** (MVP 2 — execute immediately):
| Tool | Description |
|---|---|
| `read_file` | Read workspace files with offset/limit |
| `list_dir` | List directory contents |
| `search_content` | Regex search across workspace (skips node_modules, .git, etc.) |
| `git_status` | `git status --porcelain` |

**Write-capable** (MVP 3 — require user approval):
| Tool | Description |
|---|---|
| `write_file` | Create/write files with pre-approval diff preview |
| `exec_command` | Run shell commands with danger classification |
| `diff_file` | Show `git diff` for a file |
| `read_lints` | Run `cargo check` or `tsc --noEmit` |

### Safety

- **Workspace isolation** — tools can only access files within the selected workspace
- **Denylist** — `.env`, credentials, `.ssh`, private keys are blocked
- **Approval gates** — all write operations require explicit user approval
- **Diff preview** — `write_file` shows before/after diff inline before approval
- **Command safety** — `exec_command` classifies commands as safe/suspicious/destructive. Destructive commands require double confirmation.
- **Path traversal protection** — resolved paths are checked against workspace root

### Persistence

- **SQLite** via `rusqlite` — conversations and messages persist across restarts
- WAL mode for concurrent access, auto-migration via `user_version` pragma
- Zustand store hydrates from SQLite on startup; writes fire-and-forget on every mutation

## Tech Stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 19, Vite |
| AI SDK | `@ai-sdk/openai` + `@ai-sdk/openai-compatible` |
| State | Zustand 5 |
| Database | SQLite via `rusqlite` (bundled) |
| Markdown | `react-markdown` + `shiki` + `remark-gfm` |
| Styling | Plain CSS (no framework, ~3KB) |

## Architecture

```
┌──────────────────────────────────────────┐
│  React Frontend (port 1420)              │
│  ┌─────────────┐  ┌───────────────────┐ │
│  │ Zustand Store│  │ AI SDK Stream     │ │
│  │ (hydrate from│  │ (streamText +     │ │
│  │  SQLite,     │  │  tool calling)    │ │
│  │  auto-save)  │  │                   │ │
│  └──────┬───────┘  └────────┬──────────┘ │
│         │                   │            │
│  ┌──────┴───────────────────┴──────────┐ │
│  │  Tauri invoke() bridge              │ │
│  └──────────────────┬──────────────────┘ │
└─────────────────────┼────────────────────┘
                      │ IPC
┌─────────────────────┼────────────────────┐
│  Rust Backend       │                    │
│  ┌──────────────────┴──────────────────┐ │
│  │  Tauri Commands                     │ │
│  │  • SQLite CRUD (conversations, msgs)│ │
│  │  • File ops (read, write, list)     │ │
│  │  • Search (regex + walkdir)         │ │
│  │  • Execute (shell commands)         │ │
│  │  • Git (status, diff)               │ │
│  │  • Lints (cargo check / tsc)        │ │
│  └──────────────────┬──────────────────┘ │
│  ┌──────────────────┴──────────────────┐ │
│  │  Safety Layer                       │ │
│  │  • Path resolution + canon check    │ │
│  │  • Denylist patterns                │ │
│  │  • Workspace confinement            │ │
│  └─────────────────────────────────────┘ │
│  ┌─────────────────────────────────────┐ │
│  │  SQLite (goatllm.db, WAL mode)      │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

## Getting Started

### Prerequisites
- [Rust](https://rustup.rs/) (1.70+)
- [Node.js](https://nodejs.org/) (20+)
- [pnpm](https://pnpm.io/)

### Install & Run

```bash
# Clone
git clone <repo-url>
cd goatLLM

# Install frontend deps
pnpm install

# Run in development
pnpm tauri dev
```

The app opens a desktop window. Vite dev server runs on `http://localhost:1420`.

### Configure Models

1. Click Settings in the sidebar
2. Add API keys for cloud providers (OpenAI, Groq, OpenCode Go)
3. Or use local models via LM Studio (localhost:1234) or Ollama (localhost:11434)

### Use the Agent

1. Click the workspace picker in the header bar
2. Select a project directory
3. Ask the model to read files, search code, or make changes
4. Write operations show a diff preview — approve or deny each change
5. Commands classified as destructive require double confirmation

## Roadmap

- [x] MVP 1 — Chat UI (streaming, markdown, multi-model)
- [x] MVP 2 — Read-only agent tools
- [x] SQLite persistence
- [x] MVP 3 — Write-capable agent with approval gates
- [x] Diff preview in approval cards
- [x] Command safety classification
- [x] Multi-turn tool orchestration (auto-approve toggle for read → think → write → lint → fix in one turn)
- [x] Conversation context management (auto-summarize, truncate old tool outputs)
- [x] Inline terminal output rendering (ANSI-aware)
- [x] Git branch/commit/push tools
- [x] Package for distribution (.dmg, .AppImage, .msi)
- [x] Async title generation
- [x] Test setup (Vitest + React Testing Library + cargo test)

## License

MIT
