/**
 * Built-in credential for the bundled free tier.
 *
 * The string below is XOR-folded against a per-build pad and base64'd so it
 * isn't grep-able as a plain `sk-...` token in the bundle. It's not real
 * crypto — anyone with a debugger can pull it out — but it stops casual
 * scraping of the source/dist artifacts. Treat the decoded value as a
 * shared, rate-limited key, not a secret.
 *
 * Used by the OpenCode Go free-tier integration in src/stores/chat.ts so
 * the bundled DeepSeek V4 (Free) model is usable out of the box without
 * the user having to paste a key.
 */

const ENC =
  "FFtMABFZBi5+AlI4RVVANQRZOSMcAglIAyJGNSUrVTkiCXwTHwkEQTMtKUsEZhARVwpVHUQ0FyNXFjwpUUYFCCsoAQ==";
const PAD = "g0at!llm/zen.free.tier";

let cached: string | null = null;

function decodeBase64(input: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(input);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node fallback for tests / SSR.
  const g = globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } };
  if (g.Buffer) return new Uint8Array(g.Buffer.from(input, "base64"));
  throw new Error("No base64 decoder available");
}

export function getZenCredential(): string {
  if (cached !== null) return cached;
  const buf = decodeBase64(ENC);
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    out += String.fromCharCode(buf[i] ^ PAD.charCodeAt(i % PAD.length));
  }
  cached = out;
  return out;
}

/** Built-in provider id that uses the bundled free credential. */
export const ZEN_FREE_PROVIDER_ID = "opencode-go-free";

/** Zen's catalog also contains paid models. Only entries explicitly marked
 * free belong in the bundled free-tier catalog shown alongside OpenCode Go. */
export function isZenFreeModel(model: { id: string; name: string }): boolean {
  return `${model.id} ${model.name}`.toLowerCase().includes("free");
}
