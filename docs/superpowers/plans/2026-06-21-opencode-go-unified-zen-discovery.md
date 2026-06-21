# OpenCode Go Unified Zen Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make configured OpenCode Go Discover fetch Zen free models and show them in the same OpenCode Go picker.

**Architecture:** The configured OpenCode Go model list merges its paid and Zen discovery caches. The OpenCode Go settings card dispatches discovery for both provider IDs, leaving the generic single-provider discovery action unchanged.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Testing Library.

---

### Task 1: Add failing unified-picker and Discover-action tests

**Files:**
- Modify: `src/__tests__/chat-store.test.ts:263-293`
- Create: `src/__tests__/provider-card.test.tsx`

- [x] **Step 1: Write the failing configured-picker test**

```ts
useChatStore.getState().configureProvider("opencode-go", { apiKey: "sk-test" });
useChatStore.setState((state) => ({
  discoveredModels: {
    ...state.discoveredModels,
    "opencode-go-free": [{ id: "big-pickle-free", name: "Big Pickle", contextWindow: 128_000 }],
  },
}));
expect(useChatStore.getState().getModels()).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: "opencode-go:big-pickle-free", name: "Big Pickle" }),
]));
```

- [x] **Step 2: Write the failing Discover-button test**

```tsx
fireEvent.click(screen.getByRole("button", { name: "Discover OpenCode Go models" }));
expect(discoverCloudModels).toHaveBeenCalledWith("opencode-go");
expect(discoverCloudModels).toHaveBeenCalledWith("opencode-go-free");
```

- [x] **Step 3: Verify RED**

Run: `npm test -- src/__tests__/chat-store.test.ts src/__tests__/provider-card.test.tsx`

Expected: FAIL because configured OpenCode Go ignores Zen discoveries and its button invokes one discovery action.

### Task 2: Merge the catalogs and refresh both endpoints

**Files:**
- Modify: `src/stores/chat.ts:4728-4743`
- Modify: `src/components/settings/ProviderCard.tsx:141-146`

- [x] **Step 1: Merge the Zen cache into configured OpenCode Go source models**

```ts
const zenFreeModels = providerId === "opencode-go"
  ? discoveredModels[ZEN_FREE_PROVIDER_ID] ?? []
  : [];
const sourceModels = providerSupportsDiscovery(providerId)
  ? mergeDiscoveredModels(
      mergeDiscoveredModels(CLOUD_PROVIDER_MODELS[providerId] ?? [], discoveredModels[providerId] ?? []),
      zenFreeModels,
    )
  : CLOUD_PROVIDER_MODELS[providerId] ?? [];
```

- [x] **Step 2: Refresh both catalogs from the OpenCode Go Discover button**

```tsx
onClick={(event) => {
  event.stopPropagation();
  if (!canDiscover) return;
  void Promise.all([
    discoverCloudModels(provider.id),
    ...(provider.id === "opencode-go" ? [discoverCloudModels("opencode-go-free")] : []),
  ]);
}}
```

- [x] **Step 3: Verify GREEN**

Run: `npm test -- src/__tests__/chat-store.test.ts src/__tests__/provider-card.test.tsx`

Expected: PASS.

### Task 3: Verify and ship

**Files:**
- Verify: `src/__tests__/chat-store.test.ts`
- Verify: `src/__tests__/provider-card.test.tsx`

- [x] **Step 1: Run the full suite and production build**

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS.

- [x] **Step 2: Commit and push main**

Run: `git add docs/superpowers/specs/2026-06-21-opencode-go-unified-zen-discovery-design.md docs/superpowers/plans/2026-06-21-opencode-go-unified-zen-discovery.md src/stores/chat.ts src/components/settings/ProviderCard.tsx src/__tests__/chat-store.test.ts src/__tests__/provider-card.test.tsx && git commit -m "fix: show Zen free models in OpenCode Go" && git push origin main`

Expected: the committed main branch is pushed to `origin/main`.
