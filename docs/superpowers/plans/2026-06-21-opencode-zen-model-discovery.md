# OpenCode Zen Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover the complete current OpenCode Go and bundled Zen free model catalogs at runtime, without hardcoding Zen model names.

**Architecture:** Mark the built-in Zen free provider as discovery-capable. The existing chat-store discovery action resolves either a configured provider key or the Zen built-in credential, persists the normalized result through the current dual-write cache, and merges the free discovery cache into the built-in picker list.

**Tech Stack:** TypeScript, Zustand, Vitest, OpenAI-compatible fetch adapter, localStorage, Tauri SQLite.

---

## File Structure

- Modify: `src/lib/model-registry.ts` — opt the built-in Zen provider into discovery.
- Modify: `src/__tests__/model-registry.test.ts` — prove that the registry exposes its discovery capability.
- Modify: `src/stores/chat.ts` — build discovery targets from configured and built-in providers, authenticate the built-in request, and merge the discovered cache in the built-in picker.
- Modify: `src/__tests__/chat-store.test.ts` — prove refresh targeting and picker merging.

### Task 1: Register Zen free discovery

**Files:**
- Modify: `src/__tests__/model-registry.test.ts:70-91`
- Modify: `src/lib/model-registry.ts:76-105`

- [ ] **Step 1: Write the failing registry test**

```ts
it("flags both OpenCode Go catalogs as supporting /v1/models discovery", () => {
  expect(providerSupportsDiscovery("opencode-go")).toBe(true);
  expect(providerSupportsDiscovery("opencode-go-free")).toBe(true);
});
```

- [ ] **Step 2: Verify the failure**

Run: `npm test -- src/__tests__/model-registry.test.ts`

Expected: FAIL because the free provider currently returns `false`.

- [ ] **Step 3: Implement the registry flag**

```ts
{
  id: "opencode-go-free",
  name: "Free Models",
  baseUrl: "https://opencode.ai/zen/v1",
  supportsDiscovery: true,
  models: [/* existing fallback catalog */],
}
```

- [ ] **Step 4: Verify the passing test**

Run: `npm test -- src/__tests__/model-registry.test.ts`

Expected: PASS.

### Task 2: Discover and display Zen models

**Files:**
- Modify: `src/__tests__/chat-store.test.ts:239-313`
- Modify: `src/stores/chat.ts:4467-4536`
- Modify: `src/stores/chat.ts:4674-4754`

- [ ] **Step 1: Write failing refresh-target and picker-merge tests**

```ts
expect(discoverCloudModels).toHaveBeenCalledWith("opencode-go-free");

useChatStore.setState((state) => ({
  discoveredModels: {
    ...state.discoveredModels,
    "opencode-go-free": [
      { id: "big-pickle-free", name: "Big Pickle", contextWindow: 128_000 },
    ],
  },
}));
expect(useChatStore.getState().getModels()).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: "opencode-go-free:big-pickle-free", name: "Big Pickle" }),
  expect.objectContaining({ id: "opencode-go-free:deepseek-v4-flash-free" }),
]));
```

- [ ] **Step 2: Verify the failure**

Run: `npm test -- src/__tests__/chat-store.test.ts`

Expected: FAIL because cloud refresh excludes built-ins and the built-in picker ignores discovered entries.

- [ ] **Step 3: Implement de-duplicated discovery targets**

```ts
const configured = Object.keys(providerConfigs).filter(providerSupportsDiscovery);
const builtIn = BUILTIN_PROVIDERS
  .filter((provider) => providerSupportsDiscovery(provider.id))
  .map((provider) => provider.id);
const targets = [...new Set([...configured, ...builtIn])];
```

- [ ] **Step 4: Implement built-in credentials and URLs**

```ts
const builtin = BUILTIN_PROVIDERS.find((provider) => provider.id === providerId);
const baseUrl = builtin?.baseUrl ?? CLOUD_PROVIDER_BASE_URLS[providerId];
const apiKey = builtin
  ? providerId === ZEN_FREE_PROVIDER_ID ? getZenCredential() : null
  : get().providerConfigs[providerId]?.apiKey?.trim();
```

Keep the non-built-in missing-key error and existing `normalizeProviderModels` plus `persistDiscoveredModels` calls unchanged.

- [ ] **Step 5: Merge discovery results into built-in models**

```ts
const sourceModels = providerSupportsDiscovery(bp.id)
  ? mergeDiscoveredModels(bp.models, discoveredModels[bp.id] ?? [])
  : bp.models;
for (const m of sourceModels) {
  const combinedId = `${bp.id}:${m.id}`;
  models.push({
    id: combinedId,
    name: m.name,
    providerId: bp.id,
    isAvailable: providerOnline,
    contextWindow: applyOverride(combinedId, m.contextWindow),
    vision: m.vision,
    reasoning: m.reasoning,
    thinkingLevelMap: m.thinkingLevelMap,
    thinkingBudgets: m.thinkingBudgets,
  });
}
```

- [ ] **Step 6: Verify the passing chat-store tests**

Run: `npm test -- src/__tests__/chat-store.test.ts`

Expected: PASS.

### Task 3: Verify and commit

**Files:**
- Verify: `src/__tests__/model-registry.test.ts`
- Verify: `src/__tests__/chat-store.test.ts`
- Verify: `src/lib/__tests__/discovered-models.test.ts`

- [ ] **Step 1: Verify focused discovery, picker, and dual-write-cache behavior**

Run: `npm test -- src/__tests__/model-registry.test.ts src/__tests__/chat-store.test.ts src/lib/__tests__/discovered-models.test.ts`

Expected: PASS.

- [ ] **Step 2: Verify static checks**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Review the implementation diff**

Run: `git diff --check && git diff -- src/lib/model-registry.ts src/stores/chat.ts src/__tests__/model-registry.test.ts src/__tests__/chat-store.test.ts`

Expected: no whitespace errors and no new hardcoded Zen model names outside test fixtures.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/lib/model-registry.ts src/stores/chat.ts src/__tests__/model-registry.test.ts src/__tests__/chat-store.test.ts
git commit -m "feat: discover OpenCode Zen free models"
```
