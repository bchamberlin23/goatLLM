# Ambient Glow and Sidebar Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ambient glow follow the pointer anywhere in the app window and make every sidebar accent inherit the selected glow mode.

**Architecture:** Move the pointer subscription into a small React hook that writes the current pointer position directly to the main panel’s CSS variables. The shell keeps the active `mode-*` class as the source of truth for `--theme-glow-rgb`; CSS consumes that token for sidebar surfaces, selected items, focus rings, and the active-marker utility.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS custom properties.

---

### Task 1: Cover global pointer tracking

**Files:**

- Create: `src/lib/ambient-glow.ts`
- Create: `src/__tests__/ambient-glow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("updates the glow variables from pointer movement anywhere in the window", () => {
  render(<GlowProbe />);
  const field = screen.getByTestId("glow-probe");
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue({
    left: 200,
    top: 100,
    width: 800,
    height: 600,
  } as DOMRect);

  fireEvent.pointerMove(window, { clientX: 600, clientY: 400 });

  expect(field.style.getPropertyValue("--glow-x")).toBe("50%");
  expect(field.style.getPropertyValue("--glow-y")).toBe("50%");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/__tests__/ambient-glow.test.tsx`

Expected: FAIL because `useAmbientGlowPosition` has not been implemented.

- [ ] **Step 3: Write the minimal implementation**

```ts
export function useAmbientGlowPosition(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const update = (event: PointerEvent) => {
      const element = ref.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      element.style.setProperty(
        "--glow-x",
        `${clamp(((event.clientX - rect.left) / rect.width) * 100)}%`,
      );
      element.style.setProperty(
        "--glow-y",
        `${clamp(((event.clientY - rect.top) / rect.height) * 100)}%`,
      );
    };
    window.addEventListener("pointermove", update, { passive: true });
    return () => window.removeEventListener("pointermove", update);
  }, [ref]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/__tests__/ambient-glow.test.tsx`

Expected: PASS with one passing test.

### Task 2: Connect the app shell and make the sidebar theme complete

**Files:**

- Modify: `src/App.tsx:1-180`
- Modify: `src/index.css:493-951`
- Modify: `src/components/Sidebar.tsx:391-2043`

- [ ] **Step 1: Replace the local main-only handler with the tested hook**

```tsx
const mainRef = useRef<HTMLElement>(null);
useAmbientGlowPosition(mainRef, glowBackgroundEnabled);

<main ref={mainRef} className="flex-1 h-full flex flex-col relative overflow-hidden" />;
```

- [ ] **Step 2: Make the glow layer map directly to the measured panel and preserve non-interactivity**

```css
.liquid-glow-field {
  inset: 0;
  pointer-events: none;
  will-change: background;
}

.sidebar-theme-accent {
  color: rgb(var(--theme-glow-rgb));
}

.sidebar-active-marker {
  background: rgb(var(--theme-glow-rgb));
}
```

- [ ] **Step 3: Replace sidebar-only hard-coded amber accents with the shared theme utilities**

```tsx
<FolderOpen className={isActiveProject ? "sidebar-theme-accent" : "text-[#888]"} />
<span className="sidebar-active-marker absolute left-2 top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full" />
<path stroke="currentColor" className="sidebar-theme-accent" />
```

- [ ] **Step 4: Verify the unit test and focused visual source assertions**

Run: `npm test -- src/__tests__/ambient-glow.test.tsx && npm run typecheck`

Expected: PASS with the ambient hook test green and no TypeScript errors.

### Task 3: Verify and ship

**Files:**

- Verify: `src/App.tsx`
- Verify: `src/index.css`
- Verify: `src/components/Sidebar.tsx`
- Verify: `src/__tests__/ambient-glow.test.tsx`

- [ ] **Step 1: Run full verification**

Run: `npm test && npm run lint && npm run build && npm run format:check`

Expected: all commands exit with code 0.

- [ ] **Step 2: Inspect the app at `http://127.0.0.1:1420`**

Confirm: moving the pointer over both the sidebar and main panel updates `--glow-x` and `--glow-y`; switching Mesh, Lavender, Aurora, Cyberpunk, and Nebula changes the sidebar tint, selected-row fill, active marker, and search focus ring.

- [ ] **Step 3: Commit and push from `main`**

```bash
git add src/App.tsx src/index.css src/components/Sidebar.tsx src/lib/ambient-glow.ts src/__tests__/ambient-glow.test.tsx docs/superpowers/plans/2026-06-20-ambient-glow-sidebar-theme.md
git commit -m "fix: sync ambient glow and sidebar theme"
git push origin main
```
