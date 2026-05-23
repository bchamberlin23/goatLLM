import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock localStorage
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  get length() { return store.size; },
  key: (index: number) => [...store.keys()][index] ?? null,
};

// Mock @tauri-apps/api/core for SQLite DB calls in tests
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "load_all_data") {
      return { conversations: [], messages: [] };
    }
    // All other commands (save/delete) are fire-and-forget, no-op in tests
    return undefined;
  }),
}));
