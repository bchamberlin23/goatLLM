import { useCallback, useState, type ReactNode } from "react";
import { Image as ImageIcon, X } from "lucide-react";
import type { ImageGenSettings, ProviderConfig } from "../../stores/chat";

interface ImageGenModalProps {
  providerConfigs: Record<string, ProviderConfig>;
  imageGenSettings: ImageGenSettings;
  activeId: string | null;
  addImageArtifact: (conversationId: string, title: string, dataUrl: string) => string;
  children: (controls: { open: () => void; close: () => void }) => ReactNode;
}

export function ImageGenModal({ providerConfigs, imageGenSettings, activeId, addImageArtifact, children }: ImageGenModalProps) {
  const [showImageGen, setShowImageGen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageGenLoading, setImageGenLoading] = useState(false);
  const [imageGenResult, setImageGenResult] = useState<string | null>(null);
  const [imageGenError, setImageGenError] = useState<string | null>(null);

  const open = useCallback(() => {
    setImagePrompt("");
    setImageGenResult(null);
    setImageGenError(null);
    setShowImageGen(true);
  }, []);

  const close = useCallback(() => {
    setShowImageGen(false);
  }, []);

  const handleGenerateImage = useCallback(async () => {
    const prompt = imagePrompt.trim();
    if (!prompt || imageGenLoading) return;
    setImageGenLoading(true);
    setImageGenError(null);
    setImageGenResult(null);
    try {
      const provider = imageGenSettings.provider;
      if (provider === "openai") {
        const cfg = providerConfigs.openai;
        if (!cfg?.apiKey) throw new Error("Configure an OpenAI API key in Settings first.");
        const baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
        const res = await fetch(baseUrl + "/images/generations", {
          method: "POST",
          headers: { Authorization: "Bearer " + cfg.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ model: imageGenSettings.model || "gpt-image-1.5", prompt, size: imageGenSettings.size || "1024x1024", quality: "auto", background: "auto" }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || "Image request failed (" + res.status + ").");
        const first = json?.data?.[0];
        const base64 = first?.b64_json ?? first?.url;
        const dataUrl = base64?.startsWith("data:") ? base64 : "data:image/png;base64," + base64;
        setImageGenResult(dataUrl);
        if (activeId) addImageArtifact(activeId, prompt.slice(0, 64) || "Generated Image", dataUrl);
      } else if (provider === "ollama") {
        const cfg = providerConfigs.ollama;
        const baseUrl = (cfg?.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
        const res = await fetch(baseUrl + "/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: imageGenSettings.model || "flux2-klein:4b", prompt, stream: false }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Ollama request failed (" + res.status + ").");
        const imageData = json?.images?.[0] ?? json?.image;
        if (!imageData) throw new Error("Ollama response did not contain image data. Make sure flux2-klein is installed (ollama pull flux2-klein:4b).");
        const dataUrl = "data:image/png;base64," + imageData;
        setImageGenResult(dataUrl);
        if (activeId) addImageArtifact(activeId, prompt.slice(0, 64) || "Generated Image", dataUrl);
      } else {
        const endpoint = imageGenSettings.customEndpoint;
        if (!endpoint) throw new Error("Configure a custom endpoint URL in Settings for this provider.");
        const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, provider, model: imageGenSettings.model }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || "Image request failed (" + res.status + ").");
        const first = json?.data?.[0] ?? json?.images?.[0] ?? json;
        const base64 = first?.b64_json ?? first?.b64 ?? first?.image ?? first?.url ?? first?.data;
        const dataUrl = base64?.startsWith("data:") ? base64 : typeof base64 === "string" ? "data:image/png;base64," + base64 : JSON.stringify(json);
        setImageGenResult(dataUrl);
        if (activeId) addImageArtifact(activeId, prompt.slice(0, 64) || "Generated Image", dataUrl);
      }
    } catch (error) {
      setImageGenError(error instanceof Error ? error.message : String(error));
    } finally {
      setImageGenLoading(false);
    }
  }, [activeId, addImageArtifact, imageGenLoading, imageGenSettings, imagePrompt, providerConfigs]);

  return (
    <>
      {children({ open, close })}
      {showImageGen && (
        <div className="motion-reveal fixed inset-0 z-[250] flex items-center justify-center bg-[#111112]/70 backdrop-blur-md" onClick={close}>
          <div className="modal-surface motion-surface-in w-[420px] max-w-[90vw] rounded-2xl overflow-hidden" role="dialog" aria-modal="true" aria-label="Generate image" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2"><ImageIcon size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" /><h3 className="text-[14px] font-semibold text-[#ececec]">Generate Image</h3></div>
              <button onClick={close} className="control-icon w-7 h-7 flex items-center justify-center rounded-md" aria-label="Close" type="button"><X size={14} strokeWidth={2} /></button>
            </div>
            <div className="p-5">
              <p className="text-[12px] text-[#a0a0a0] mb-3">Describe the image you want to generate. Images are added to the conversation as artifacts.</p>
              <textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="A majestic mountain landscape at sunset..." rows={3} className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-[13px] text-[#ececec] placeholder:text-text-4 resize-none outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 mb-3" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleGenerateImage(); } }} />
              {imageGenLoading && <div className="motion-reveal flex items-center justify-center gap-2 py-8 text-[13px] text-[#a0a0a0]"><div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-accent animate-spin" />Generating image...</div>}
              {imageGenError && <div className="motion-reveal rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 mb-3 text-[12px] text-red-400">{imageGenError}</div>}
              {imageGenResult && <div className="motion-reveal mb-3"><img src={imageGenResult} alt={imagePrompt} className="w-full rounded-xl border border-white/10" /></div>}
              <div className="flex justify-end gap-2">
                <button onClick={close} className="control-pill px-4 py-2 rounded-lg text-[12.5px] transition-colors" type="button">Close</button>
                <button onClick={handleGenerateImage} disabled={!imagePrompt.trim() || imageGenLoading} className="primary-action px-4 py-2 rounded-lg text-[12.5px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed" type="button">{imageGenLoading ? "Generating..." : "Generate"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
