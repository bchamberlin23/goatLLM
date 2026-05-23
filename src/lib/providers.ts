export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  models: ModelConfig[];
}

export interface ModelConfig {
  id: string;
  name: string;
  contextWindow: number;
}

export function getBuiltInProviders(): ProviderConfig[] {
  return [];
}

export function getModelDisplayName(providerId: string, modelId: string): string {
  const providers = getBuiltInProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return modelId;
  const model = provider.models.find((m) => m.id === modelId);
  return model?.name ?? modelId;
}
