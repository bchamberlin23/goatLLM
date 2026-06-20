import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDiscoveredModels,
  loadDiscoveredModelsFromJournal,
  persistDiscoveredModels,
} from "../discovered-models";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("discovered model cache", () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
  });

  it("restores models from the crash-safe journal immediately", () => {
    localStorage.setItem("goatllm-discovered-models", JSON.stringify({
      openrouter: [{ id: "vendor/new-model", name: "New Model", contextWindow: 128_000 }],
    }));

    expect(loadDiscoveredModelsFromJournal()).toEqual({
      openrouter: [{ id: "vendor/new-model", name: "New Model", contextWindow: 128_000 }],
    });
  });

  it("writes discoveries to the journal before mirroring them to SQLite", async () => {
    invoke.mockResolvedValue(undefined);
    const models = { groq: [{ id: "llama-new", name: "Llama New" }] };

    persistDiscoveredModels(models);

    expect(JSON.parse(localStorage.getItem("goatllm-discovered-models") || "{}"))
      .toEqual(models);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("discovered_models_save", { models }));
  });

  it("merges SQLite entries that the journal does not have", async () => {
    localStorage.setItem("goatllm-discovered-models", JSON.stringify({
      openrouter: [{ id: "journal-model", name: "Journal Model" }],
    }));
    invoke.mockResolvedValue({
      openrouter: [{ id: "stale-sqlite-model", name: "Stale SQLite Model" }],
      groq: [{ id: "sqlite-model", name: "SQLite Model" }],
    });

    await expect(loadDiscoveredModels()).resolves.toEqual({
      openrouter: [{ id: "journal-model", name: "Journal Model" }],
      groq: [{ id: "sqlite-model", name: "SQLite Model" }],
    });
  });
});
