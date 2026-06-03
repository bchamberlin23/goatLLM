/** Providers that accept native PDF file parts on vision-capable models. */
export function providerSupportsNativePdf(provider: string): boolean {
  return provider === "anthropic" || provider === "openai" || provider === "google";
}
