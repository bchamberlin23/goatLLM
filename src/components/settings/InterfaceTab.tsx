import { useChatStore } from "../../stores/chat";
import { ToggleRow } from "./ToggleRow";
import { SystemPromptSection } from "./SystemPromptSection";
import { SettingsGroup } from "./SettingsGroup";

const PLUS_ITEMS = [
  { key: "upload", label: "Upload File", description: "Attach files to the prompt.", modes: ["chat", "design", "agent"] },
  { key: "pursueGoal", label: "Pursue Goal", description: "Launch autonomous multi-step goal execution.", modes: ["chat", "design", "agent"] },
  { key: "usage", label: "Usage Dashboard", description: "Open panel for token count, latency, and cost details.", modes: ["chat", "design", "agent"] },
  { key: "compare", label: "Compare Models", description: "Compare responses from multiple models in parallel.", modes: ["chat", "design", "agent"] },
  { key: "notebook", label: "Notebook Mode", description: "Open interactive scratchpad with runnable code cells.", modes: ["chat", "design", "agent"] },
  { key: "browser", label: "Browser Panel", description: "Open local browser screen for agent actions.", modes: ["chat", "design", "agent"] },
  { key: "image", label: "Generate Image", description: "Input prompt to generate images directly.", modes: ["chat", "design", "agent"] },
  { key: "plan", label: "Plan Mode", description: "Toggle read-only planning mode.", modes: ["agent"] },
  { key: "research", label: "Deep Research", description: "Toggle sequential multi-step web research.", modes: ["chat", "design", "agent"] },
  { key: "skills", label: "Choose Skills", description: "Pick custom system-prompt skills for the chat session.", modes: ["chat", "design", "agent"] },
];

export function InterfaceTab() {
  const autoArtifacts = useChatStore((s) => s.autoArtifacts);
  const setAutoArtifacts = useChatStore((s) => s.setAutoArtifacts);
  const officeArtifacts = useChatStore((s) => s.officeArtifacts);
  const setOfficeArtifacts = useChatStore((s) => s.setOfficeArtifacts);
  const showDesignCritique = useChatStore((s) => s.showDesignCritique);
  const setShowDesignCritique = useChatStore((s) => s.setShowDesignCritique);
  const completionSound = useChatStore((s) => s.completionSound);
  const setCompletionSound = useChatStore((s) => s.setCompletionSound);
  const glowBackgroundEnabled = useChatStore((s) => s.glowBackgroundEnabled);
  const setGlowBackgroundEnabled = useChatStore((s) => s.setGlowBackgroundEnabled);
  const glowBackgroundMode = useChatStore((s) => s.glowBackgroundMode);
  const setGlowBackgroundMode = useChatStore((s) => s.setGlowBackgroundMode);
  const plusMenuVisibility = useChatStore((s) => s.plusMenuVisibility);
  const setPlusMenuItemVisible = useChatStore((s) => s.setPlusMenuItemVisible);

  return (
    <>
      <SettingsGroup title="Artifacts" description="Side-panel canvas for substantial outputs.">
        <ToggleRow
          enabled={autoArtifacts}
          onToggle={setAutoArtifacts}
          title="Auto-render in canvas"
          description="HTML, Python, LaTeX, and Office fences open in the side panel instead of inline."
        />
        <ToggleRow
          enabled={officeArtifacts}
          onToggle={setOfficeArtifacts}
          title="Office tooling"
          description="Render docx, pptx, and xlsx as downloadable documents."
          dimmedWhen={!autoArtifacts}
          dimmedHint={!autoArtifacts ? "Auto-render is off — office formats stay inline." : undefined}
        />
      </SettingsGroup>

      <SettingsGroup title="Design mode" description="Design artifact workflow preferences.">
        <ToggleRow
          enabled={showDesignCritique}
          onToggle={setShowDesignCritique}
          title="Show critique scores"
          description="Display 5-dimension scores in design messages. Off by default."
        />
      </SettingsGroup>

      <SettingsGroup title="Ambient Glow" description="Dynamic ambient lighting effects in the main panel.">
        <ToggleRow
          enabled={glowBackgroundEnabled}
          onToggle={setGlowBackgroundEnabled}
          title="Enable dynamic background"
          description="Render a responsive ambient glow gradient that moves with your mouse."
        />
        {glowBackgroundEnabled && (
          <div className="mt-3 flex flex-col gap-1.5 pl-1">
            <span className="text-[12px] font-medium text-text-2">Glow Mode</span>
            <div className="grid grid-cols-3 gap-2 mt-1 sm:grid-cols-6">
              {(["blocky", "smooth", "fluid", "aurora", "cyberpunk", "nebula"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setGlowBackgroundMode(mode)}
                  className={`px-2 py-1.5 rounded-lg border text-center text-[11px] capitalize font-medium transition-all ${
                    glowBackgroundMode === mode
                      ? "border-accent/35 bg-accent/15 text-accent shadow-[0_4px_12px_-4px_rgba(245,158,66,0.3)]"
                      : "border-white/[0.06] bg-white/[0.02] text-text-3 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-text-2"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <span className="text-[11px] leading-relaxed text-text-4 mt-1">
              {glowBackgroundMode === "blocky" && "Original classic tri-gradient with tech mesh grid overlay."}
              {glowBackgroundMode === "smooth" && "Extremely soft lavender/indigo blending for minimal distraction."}
              {glowBackgroundMode === "fluid" && "Active lava-lamp liquid flow with floating blobs that follow the cursor."}
              {glowBackgroundMode === "aurora" && "Diagonal waves of green, teal, and purple northern lights."}
              {glowBackgroundMode === "cyberpunk" && "Neon pink and blue pulse with a low-res scanline overlay."}
              {glowBackgroundMode === "nebula" && "Deep space magenta and gold cosmic clouds with twinkling stars."}
            </span>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Plus (+) Menu Customization" description="Configure which shortcuts are visible in the input bar's '+' menu for each mode.">
        <div className="w-full border border-white/[0.06] rounded-xl bg-black/10 overflow-hidden">
          <table className="w-full text-left border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02] text-text-3 font-medium">
                <th className="py-2.5 px-4 font-semibold text-text-2">Shortcut Item</th>
                <th className="py-2.5 px-3 text-center font-semibold text-text-2 w-16">Chat</th>
                <th className="py-2.5 px-3 text-center font-semibold text-text-2 w-16">Design</th>
                <th className="py-2.5 px-3 text-center font-semibold text-text-2 w-16">Agent</th>
              </tr>
            </thead>
            <tbody>
              {PLUS_ITEMS.map((item) => (
                <tr key={item.key} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.01] transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-medium text-text-1">{item.label}</div>
                    <div className="text-[10.5px] text-text-4 mt-0.5 leading-relaxed">{item.description}</div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    {item.modes.includes("chat") ? (
                      <input
                        type="checkbox"
                        checked={plusMenuVisibility.chat?.[item.key] ?? false}
                        onChange={(e) => setPlusMenuItemVisible("chat", item.key, e.target.checked)}
                        className="accent-accent cursor-pointer h-4 w-4 bg-[#1a1a1c] border-white/10 rounded focus:ring-0 focus:ring-offset-0 focus:outline-none"
                      />
                    ) : (
                      <span className="text-text-4 text-[11px]">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {item.modes.includes("design") ? (
                      <input
                        type="checkbox"
                        checked={plusMenuVisibility.design?.[item.key] ?? false}
                        onChange={(e) => setPlusMenuItemVisible("design", item.key, e.target.checked)}
                        className="accent-accent cursor-pointer h-4 w-4 bg-[#1a1a1c] border-white/10 rounded focus:ring-0 focus:ring-offset-0 focus:outline-none"
                      />
                    ) : (
                      <span className="text-text-4 text-[11px]">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {item.modes.includes("agent") ? (
                      <input
                        type="checkbox"
                        checked={plusMenuVisibility.agent?.[item.key] ?? false}
                        onChange={(e) => setPlusMenuItemVisible("agent", item.key, e.target.checked)}
                        className="accent-accent cursor-pointer h-4 w-4 bg-[#1a1a1c] border-white/10 rounded focus:ring-0 focus:ring-offset-0 focus:outline-none"
                      />
                    ) : (
                      <span className="text-text-4 text-[11px]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Notifications">
        <ToggleRow
          enabled={completionSound}
          onToggle={setCompletionSound}
          title="Completion sound"
          description="Subtle click when an agent or design turn finishes."
        />
      </SettingsGroup>

      <SettingsGroup title="System prompt" description="Behavior instructions for the model.">
        <SystemPromptSection />
      </SettingsGroup>
    </>
  );
}
