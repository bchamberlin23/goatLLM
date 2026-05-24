import { useEffect } from "react";
import { X } from "lucide-react";
import { useChatStore, LOCAL_PROVIDERS } from "../stores/chat";
import { LocalModelsSection } from "./LocalModelsSection";
import { ProviderCard } from "./settings/ProviderCard";
import { LocalProviderCard } from "./settings/LocalProviderCard";
import { ArtifactToggleRow } from "./settings/ArtifactToggleRow";
import { FreeWebSearchRow } from "./settings/FreeWebSearchRow";
import { ChatCodeExecRow } from "./settings/ChatCodeExecRow";
import { TavilyKeyRow } from "./settings/TavilyKeyRow";
import { SemanticIndexSection } from "./settings/SemanticIndexSection";
import { SystemPromptSection } from "./settings/SystemPromptSection";
import { DenylistSection } from "./settings/DenylistSection";
import { SkillsSection } from "./settings/SkillsSection";

const CLOUD_PROVIDERS = [
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "opencode-go", name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
];

interface Props { onClose: () => void; }

export function Settings({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm animate-[fadeIn_150ms_ease]" onClick={onClose}>
      <div className="w-[600px] max-w-[92vw] h-[640px] max-h-[88vh] bg-[#2a2a2c] border border-white/10 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden animate-[contextMenuIn_180ms_ease]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
          <h2 className="text-[15px] font-semibold text-[#ececec] tracking-[-0.015em]">Settings</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <SettingsContent />
      </div>
    </div>
  );
}

function SettingsContent() {
  const providerConfigs = useChatStore((s) => s.providerConfigs);
  const configureProvider = useChatStore((s) => s.configureProvider);
  const removeProvider = useChatStore((s) => s.removeProvider);
  const setEnabledModels = useChatStore((s) => s.setEnabledModels);
  const tavilyApiKey = useChatStore((s) => s.tavilyApiKey);
  const setTavilyApiKey = useChatStore((s) => s.setTavilyApiKey);
  const freeWebSearch = useChatStore((s) => s.freeWebSearch);
  const setFreeWebSearch = useChatStore((s) => s.setFreeWebSearch);
  const chatCodeExec = useChatStore((s) => s.chatCodeExec);
  const setChatCodeExec = useChatStore((s) => s.setChatCodeExec);
  const autoArtifacts = useChatStore((s) => s.autoArtifacts);
  const setAutoArtifacts = useChatStore((s) => s.setAutoArtifacts);
  const officeArtifacts = useChatStore((s) => s.officeArtifacts);
  const setOfficeArtifacts = useChatStore((s) => s.setOfficeArtifacts);

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">Cloud providers</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          Add an API key, then choose which models appear in the model picker. Keys are stored locally on your machine.
        </p>
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
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">Local models</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          Run open-source models on your own machine through Ollama. We'll install it for you, look at your hardware, and recommend models that will actually fit. No setup, no terminal.
        </p>
        <LocalModelsSection />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">Local providers</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          Advanced: point at any OpenAI-compatible local server (LM Studio, a custom Ollama host, llama.cpp). Models are discovered live from the server.
        </p>
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
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">Web Search</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          Pick a backend for the agent's web_search tool. Free Web Search needs no key. Tavily is more structured but requires an API key.
        </p>
        <FreeWebSearchRow enabled={freeWebSearch} onToggle={setFreeWebSearch} />
        <ChatCodeExecRow enabled={chatCodeExec} onToggle={setChatCodeExec} />
        <TavilyKeyRow apiKey={tavilyApiKey} onSave={setTavilyApiKey} onRemove={() => setTavilyApiKey("")} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">Semantic Index</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          Local vector index over the active workspace. Lets the agent answer "find the auth flow" when the code says "login handler". Uses Ollama for embeddings — install it and pull the embedding model first.
        </p>
        <SemanticIndexSection />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">Skills</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          Agent Skills for reusable on-demand capabilities. goatLLM ships a small built-in set in <code className="text-[#c9c9c9] bg-white/5 px-1 py-0.5 rounded text-[12px]">~/.goat/agent/skills/</code>. Toggle any off to remove it from the agent's context. To pull in skills from pi, Claude Code, or anywhere else, add the directory below.
        </p>
        <SkillsSection />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">System Prompt</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          A system prompt sets the model's behavior for the active conversation. Leave empty for default behavior.
        </p>
        <SystemPromptSection />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">Artifacts</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          The side-panel canvas renders substantial outputs (HTML pages, Python scripts, LaTeX documents, Office files) so chat replies stay short. Turn this off to keep every code block inline in the chat instead. Edits and the canvas itself still work — you just see the raw code on first output.
        </p>
        <ArtifactToggleRow
          enabled={autoArtifacts}
          onToggle={setAutoArtifacts}
          title="Auto-render artifacts in canvas"
          description="On: HTML, Python, LaTeX, and Office fences open in the side panel and the chat shows a reference card. Off: every fence stays inline as a regular code block."
        />
        <ArtifactToggleRow
          enabled={officeArtifacts}
          onToggle={setOfficeArtifacts}
          title="Office tooling (Word, PowerPoint, Excel)"
          description="On: docx / pptx / xlsx fences render as real documents you can download. Off: those formats are removed from the model's instructions and any office fences fall back to inline code."
          dimmedWhen={!autoArtifacts}
          dimmedHint={!autoArtifacts ? "Auto-render is off, so office formats render inline either way." : undefined}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">File Denylist</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          Glob patterns that prevent the agent from reading or writing matching files in the active workspace. Built-in patterns (.env, credentials) are always enforced.
        </p>
        <DenylistSection />
      </section>
    </div>
  );
}
