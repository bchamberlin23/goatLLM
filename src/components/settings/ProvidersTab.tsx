import { useChatStore, LOCAL_PROVIDERS } from "../../stores/chat";
import { LocalModelsSection } from "../LocalModelsSection";
import { ProviderCard } from "./ProviderCard";
import { LocalProviderCard } from "./LocalProviderCard";
import { CustomProviderSection } from "./CustomProviderSection";
import { SettingsGroup } from "./SettingsGroup";
import { getCloudProviders } from "../../lib/providers";
import { CodexSubscriptionCard } from "./CodexSubscriptionCard";

/**
 * Cloud providers shown in the Settings tab. Derived from the unified
 * registry in `src/lib/model-registry.ts` so adding a provider there
 * automatically surfaces it here. Mirrors pi-ai's
 * `BUILT_IN_PROVIDER_DISPLAY_NAMES` approach: the catalog is the
 * single source of truth.
 */
const CLOUD_PROVIDERS = getCloudProviders();

export function ProvidersTab() {
  const providerConfigs = useChatStore((s) => s.providerConfigs);
  const configureProvider = useChatStore((s) => s.configureProvider);
  const removeProvider = useChatStore((s) => s.removeProvider);
  const setEnabledModels = useChatStore((s) => s.setEnabledModels);

  return (
    <>
      <SettingsGroup
        title="Subscription providers"
        description="ChatGPT Plus/Pro entitlement, separate from API-key billing."
      >
        <CodexSubscriptionCard />
      </SettingsGroup>

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
