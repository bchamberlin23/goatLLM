import { useChatStore, LOCAL_PROVIDERS } from "../../stores/chat";
import { LocalModelsSection } from "../LocalModelsSection";
import { ProviderCard } from "./ProviderCard";
import { LocalProviderCard } from "./LocalProviderCard";
import { CustomProviderSection } from "./CustomProviderSection";
import { SettingsGroup } from "./SettingsGroup";

const CLOUD_PROVIDERS = [
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { id: "mimo", name: "MiMo", baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "opencode-go", name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
];

export function ProvidersTab() {
  const providerConfigs = useChatStore((s) => s.providerConfigs);
  const configureProvider = useChatStore((s) => s.configureProvider);
  const removeProvider = useChatStore((s) => s.removeProvider);
  const setEnabledModels = useChatStore((s) => s.setEnabledModels);

  return (
    <>
      <SettingsGroup
        title="Cloud providers"
        description="API keys stored locally. Choose which models appear in the picker."
      >
        <div className="flex flex-col gap-2">
          {CLOUD_PROVIDERS.map((provider) => {
            const cfg = providerConfigs[provider.id] ?? null;
            return (
              <ProviderCard
                key={provider.id}
                provider={provider}
                config={cfg}
                onSave={(apiKey) => configureProvider(provider.id, { ...(cfg ?? {}), apiKey })}
                onRemove={() => removeProvider(provider.id)}
                onSetEnabled={(ids) => setEnabledModels(provider.id, ids)}
              />
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Local models"
        description="Run open-source models via Ollama — install, pull, and enable from here."
      >
        <LocalModelsSection />
      </SettingsGroup>

      <SettingsGroup
        title="Local providers"
        description="Point at any OpenAI-compatible server (LM Studio, custom Ollama host)."
        defaultOpen={false}
      >
        <div className="flex flex-col gap-2">
          {LOCAL_PROVIDERS.map((provider) => (
            <LocalProviderCard
              key={provider.id}
              providerId={provider.id}
              name={provider.name}
              defaultBaseUrl={provider.defaultBaseUrl}
              docs={provider.docs}
            />
          ))}
        </div>
      </SettingsGroup>

      <CustomProviderSection embedded />
    </>
  );
}
