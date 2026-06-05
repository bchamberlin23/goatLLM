import { useState, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import { ProviderCard } from "./ProviderCard";
import { SettingsGroup } from "./SettingsGroup";

interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
}

const CUSTOM_PROVIDERS_KEY = "goatllm-custom-providers";

function loadCustomProviders(): CustomProvider[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PROVIDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomProviders(providers: CustomProvider[]) {
  localStorage.setItem(CUSTOM_PROVIDERS_KEY, JSON.stringify(providers));
}

export function CustomProviderSection({ embedded = false }: { embedded?: boolean }) {
  const providerConfigs = useChatStore((s) => s.providerConfigs);
  const configureProvider = useChatStore((s) => s.configureProvider);
  const removeProvider = useChatStore((s) => s.removeProvider);
  const setEnabledModels = useChatStore((s) => s.setEnabledModels);

  const [customProviders, setCustomProviders] = useState<CustomProvider[]>(loadCustomProviders);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState("");

  const handleAdd = useCallback(() => {
    const name = newName.trim();
    const baseUrl = newBaseUrl.trim();
    const apiKey = newApiKey.trim();

    if (!name || !baseUrl) return;

    // Generate ID from name
    const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`;

    const provider: CustomProvider = { id, name, baseUrl };
    const updated = [...customProviders, provider];
    setCustomProviders(updated);
    saveCustomProviders(updated);

    // Save the API key if provided
    if (apiKey) {
      configureProvider(id, { apiKey, baseUrl });
    } else {
      configureProvider(id, { apiKey: "", baseUrl });
    }

    // Reset form
    setNewName("");
    setNewBaseUrl("");
    setNewApiKey("");
    setShowAdd(false);
  }, [newName, newBaseUrl, newApiKey, customProviders, configureProvider]);

  const handleRemove = useCallback((id: string) => {
    const updated = customProviders.filter((p) => p.id !== id);
    setCustomProviders(updated);
    saveCustomProviders(updated);
    removeProvider(id);
  }, [customProviders, removeProvider]);

  const body = (
    <>
      <div className="flex flex-col gap-2">
        {customProviders.map((provider) => {
          const cfg = providerConfigs[provider.id] ?? null;
          return (
            <div key={provider.id} className="relative">
              <ProviderCard
                provider={{ ...provider, noKey: false }}
                config={cfg ? { apiKey: cfg.apiKey ?? "", enabledModels: cfg.enabledModels } : null}
                onSave={(apiKey) => configureProvider(provider.id, { ...(cfg ?? {}), apiKey, baseUrl: provider.baseUrl })}
                onRemove={() => handleRemove(provider.id)}
                onSetEnabled={(ids) => setEnabledModels(provider.id, ids)}
              />
            </div>
          );
        })}
      </div>

      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="control-pill flex items-center gap-2 px-3 py-2 rounded-lg border-dashed text-[12.5px] transition-colors"
        >
          <Plus size={14} strokeWidth={1.75} />
          Add custom provider
        </button>
      ) : (
        <div className="soft-card p-4 rounded-xl flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-text-1">New custom provider</span>
            <button
              onClick={() => { setShowAdd(false); setNewName(""); setNewBaseUrl(""); setNewApiKey(""); }}
              className="control-icon flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              aria-label="Cancel custom provider"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-medium text-text-2">Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., Together AI"
              className="px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-[13px] text-text-1 placeholder:text-text-4 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-medium text-text-2">Base URL</span>
            <input
              type="text"
              value={newBaseUrl}
              onChange={(e) => setNewBaseUrl(e.target.value)}
              placeholder="https://api.together.xyz/v1"
              className="px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-[13px] text-text-1 placeholder:text-text-4 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 font-mono text-[12px]"
            />
            <span className="text-[10px] text-text-4">Must be OpenAI-compatible (/v1/chat/completions)</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-medium text-text-2">API Key (optional)</span>
            <input
              type="password"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              placeholder="sk-..."
              className="px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-[13px] text-text-1 placeholder:text-text-4 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 font-mono text-[12px]"
            />
          </label>

          <div className="flex gap-2 mt-1">
            <button
              onClick={() => { setShowAdd(false); setNewName(""); setNewBaseUrl(""); setNewApiKey(""); }}
              className="control-pill flex-1 py-1.5 rounded-md text-[12.5px] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || !newBaseUrl.trim()}
              className="primary-action flex-1 py-1.5 rounded-md text-[12.5px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add provider
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <SettingsGroup
        title="Custom providers"
        description="Any OpenAI-compatible API — LiteLLM, vLLM, Together AI, etc."
        defaultOpen={false}
      >
        {body}
      </SettingsGroup>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold text-text-3 uppercase tracking-wider">Custom providers</h3>
      <p className="text-[13px] text-text-3 leading-relaxed mb-2">
        Add any OpenAI-compatible API (LiteLLM, vLLM, Together AI, Fireworks, etc.). Enter the base URL and API key.
      </p>
      {body}
    </section>
  );
}
