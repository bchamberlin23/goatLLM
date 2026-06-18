# OpenAI Codex Subscription Provider Design

## Goal

Add a separate goatLLM provider for ChatGPT Plus/Pro Codex subscription access without mixing it with the existing OpenAI API-key provider, and without delegating turns to the Codex CLI/agent harness.

## Source Facts

- Codex supports two OpenAI sign-in paths: ChatGPT sign-in for subscription access and API-key sign-in for Platform billing.
- The ChatGPT subscription runtime endpoint is the Codex Responses backend at `https://chatgpt.com/backend-api/codex/responses`.
- Pi implements this as a native provider (`openai-codex-responses`) inside its own harness: OpenAI OAuth, direct Responses request, SSE/WebSocket parsing, retry/error mapping, and OAuth refresh. It does not spawn the Codex CLI or reuse the Codex harness.
- Current goatLLM chat streaming is built around AI SDK `LanguageModel` objects. Codex subscription access should therefore use a provider-specific stream adapter at the `streamChat()` boundary rather than pretending to be OpenAI-compatible `/v1`.
- The Codex CLI is not part of this integration. goatLLM must not require, invoke, inspect, or guide users through the Codex CLI.

## Recommended Approach

Implement Phase 1 as a native built-in provider:

- Provider id: `openai-codex-subscription`
- Display name: `OpenAI Codex`
- Models: Codex's recommended ChatGPT-auth models, starting with `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex-spark`.
- Auth: goatLLM owns native OpenAI OAuth for this provider. The Tauri bridge runs an authorization-code + PKCE flow against `https://auth.openai.com/oauth/authorize`, receives the localhost callback, stores credentials in goatLLM app data, refreshes access tokens via `https://auth.openai.com/oauth/token`, and keeps bearer tokens on the Rust side.
- Runtime: `streamChat()` detects this provider and routes through a native adapter. The adapter builds an OpenAI Responses-shaped request, asks a Tauri command to POST it to the Codex backend, and maps streamed SSE events into goatLLM callbacks.
- Harness boundary: goatLLM owns conversation state, UI streaming, abort handling, persistence, titles, and settings. The Codex subscription provider only supplies auth and model transport.
- Scope: The native adapter streams chat/reasoning text and maps Responses function-call events into goatLLM's existing tool callbacks, approval gates, subagent routing, and continuation loop.

## UI

Add a compact `OpenAI Codex` card above API-key cloud providers in Settings > Providers:

- Shows native ChatGPT subscription auth availability and account id presence.
- Buttons: Check, Sign in, Sign out.
- Copy explains that this uses ChatGPT subscription entitlements and that the existing `OpenAI` card remains Platform API-key billing.

No new colors or token drift: use existing `bg-surface-*`, `text-*`, `border-hairline`, `bg-accent`, `text-error`, and `text-success` classes.

## Data Flow

1. User selects `OpenAI Codex:gpt-5.5` in the model picker.
2. `getLlmConfigForModel()` returns an `LlmConfig` with provider `openai-codex-subscription`.
3. `streamChat()` routes to `streamCodexSubscription()`.
4. The adapter serializes goatLLM messages plus system prompt into a Responses-style request with `store: false`, `stream: true`, and a session-bound prompt cache key when available.
5. Tauri refreshes goatLLM's stored ChatGPT OAuth credentials if needed, POSTs to `/backend-api/codex/responses`, and emits SSE event payloads keyed by run id.
6. The frontend adapter maps `response.output_text.delta` to `onToken`, reasoning-summary deltas to `onThinking`, usage from completion events to `onUsage`, and terminal events to `onDone`.
7. When the model emits a Responses `function_call`, the adapter validates/parses arguments, invokes the matching goatLLM tool through its normal `execute(..., { toolCallId })` path, appends `function_call` plus `function_call_output` items, and continues the same turn.

## Error Handling

- Missing goatLLM ChatGPT auth: return a user-facing error telling the user to sign in from Settings.
- Login callback unavailable: show the authorization URL and allow pasting the redirect URL or code if the localhost callback cannot be captured.
- 401/403: surface as signed-out or entitlement/auth errors and point the user at the Settings Codex card.
- 429/usage-limit messages: keep provider detail but rewrite known limit shapes into concise user-facing messages.
- Abort: call a Tauri cancel command for the run id and finish the goatLLM stream without leaving the bubble stuck.

## Testing

- Unit test Responses request serialization from mixed role/content messages.
- Unit test SSE event normalization for output text, reasoning deltas, usage, completion, and errors.
- Unit test Responses function-tool schema conversion and function-call event normalization.
- Unit test tool execution plus continuation input with `function_call` and `function_call_output` items.
- Unit test registry exposure and chat-store config for the built-in provider.
- Run focused tests, typecheck, and Rust checks.

## Later

Add WebSocket transport, connection reuse, richer retry policy, and service-tier controls after the SSE path proves stable.
