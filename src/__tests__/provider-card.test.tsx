import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderCard } from "../components/settings/ProviderCard";
import { useChatStore } from "../stores/chat";

describe("ProviderCard", () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.setState({
      providerConfigs: {},
      discoveredModels: {},
      discoveryStatus: {},
      discoveryError: {},
    });
  });

  it("refreshes both OpenCode Go and Zen free catalogs from Discover", () => {
    const discoverCloudModels = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ discoverCloudModels });

    render(
      <ProviderCard
        provider={{
          id: "opencode-go",
          name: "OpenCode Go",
          baseUrl: "https://opencode.ai/zen/go/v1",
          supportsDiscovery: true,
        }}
        config={{ apiKey: "sk-test" }}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onSetEnabled={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Discover OpenCode Go models" }));

    expect(discoverCloudModels).toHaveBeenCalledWith("opencode-go");
    expect(discoverCloudModels).toHaveBeenCalledWith("opencode-go-free");
  });

  it("lists discovered Zen free models in the OpenCode Go card", () => {
    useChatStore.setState({
      discoveredModels: {
        "opencode-go-free": [
          { id: "big-pickle-free", name: "Big Pickle", contextWindow: 128_000 },
        ],
      },
    });

    render(
      <ProviderCard
        provider={{
          id: "opencode-go",
          name: "OpenCode Go",
          baseUrl: "https://opencode.ai/zen/go/v1",
          supportsDiscovery: true,
        }}
        config={{ apiKey: "sk-test" }}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onSetEnabled={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("OpenCode Go"));

    expect(screen.getByText("Big Pickle")).toBeInTheDocument();
  });
});
