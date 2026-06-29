import { useState } from "react";
import { useChatStore } from "../../stores/chat";
import { ToggleRow } from "./ToggleRow";
import { SystemPromptSection } from "./SystemPromptSection";
import { SettingsGroup } from "./SettingsGroup";
import {
  Upload,
  Target,
  Image as ImageIcon,
  ListChecks,
  Telescope,
  Wand2
} from "lucide-react";

const PLUS_ITEMS = [
  { key: "upload", label: "Upload File", description: "Attach files to the prompt.", modes: ["chat", "agent"], icon: Upload },
  { key: "pursueGoal", label: "Pursue Goal", description: "Launch autonomous multi-step goal execution.", modes: ["agent"], icon: Target },
  { key: "image", label: "Generate Image", description: "Generate images from a prompt.", modes: ["chat", "agent"], icon: ImageIcon },
  { key: "plan", label: "Plan Mode", description: "Toggle read-only planning mode.", modes: ["agent"], icon: ListChecks },
  { key: "research", label: "Deep Research", description: "Toggle sequential web research.", modes: ["chat", "agent"], icon: Telescope },
  { key: "skills", label: "Choose Skills", description: "Pick custom system-prompt skills.", modes: ["chat", "agent"], icon: Wand2 },
];

const THEMES = [
  { key: "amber", name: "Amber", hex: "#f59e42", rgb: "245, 158, 66" },
  { key: "blue", name: "Blue", hex: "#3b82f6", rgb: "59, 130, 246" },
  { key: "emerald", name: "Emerald", hex: "#10b981", rgb: "16, 185, 129" },
  { key: "rose", name: "Rose", hex: "#f43f5e", rgb: "244, 63, 94" },
  { key: "violet", name: "Violet", hex: "#8b5cf6", rgb: "139, 92, 246" },
] as const;

export function InterfaceTab() {
  const autoArtifacts = useChatStore((s) => s.autoArtifacts);
  const setAutoArtifacts = useChatStore((s) => s.setAutoArtifacts);
  const officeArtifacts = useChatStore((s) => s.officeArtifacts);
  const setOfficeArtifacts = useChatStore((s) => s.setOfficeArtifacts);
  const advancedArtifacts = useChatStore((s) => s.advancedArtifacts);
  const setAdvancedArtifacts = useChatStore((s) => s.setAdvancedArtifacts);
  const showDesignCritique = useChatStore((s) => s.showDesignCritique);
  const setShowDesignCritique = useChatStore((s) => s.setShowDesignCritique);
  const completionSound = useChatStore((s) => s.completionSound);
  const setCompletionSound = useChatStore((s) => s.setCompletionSound);
  const glowBackgroundEnabled = useChatStore((s) => s.glowBackgroundEnabled);
  const setGlowBackgroundEnabled = useChatStore((s) => s.setGlowBackgroundEnabled);
  const animatedBorderEnabled = useChatStore((s) => s.animatedBorderEnabled);
  const setAnimatedBorderEnabled = useChatStore((s) => s.setAnimatedBorderEnabled);
  const glowBackgroundMode = useChatStore((s) => s.glowBackgroundMode);
  const setGlowBackgroundMode = useChatStore((s) => s.setGlowBackgroundMode);
  const themeColor = useChatStore((s) => s.themeColor);
  const setThemeColor = useChatStore((s) => s.setThemeColor);
  const plusMenuVisibility = useChatStore((s) => s.plusMenuVisibility);
  const setPlusMenuItemVisible = useChatStore((s) => s.setPlusMenuItemVisible);
  const [customModeTab, setCustomModeTab] = useState<"chat" | "agent">("chat");

  return (
    <>
      <SettingsGroup title="Theme Color" description="Choose the primary accent color for the interface.">
        <div className="flex gap-6 mt-1 mb-2 items-center">
          {THEMES.map((theme) => {
            const isSelected = themeColor === theme.key;
            return (
              <button
                key={theme.key}
                type="button"
                onClick={() => setThemeColor(theme.key)}
                className="flex flex-col items-center gap-2 group cursor-pointer"
              >
                <div
                  className={`w-9 h-9 rounded-full relative flex items-center justify-center transition-all duration-200 ${
                    isSelected
                      ? "scale-105 ring-2 ring-white/30"
                      : "hover:scale-105 hover:ring-1 hover:ring-white/10"
                  }`}
                  style={{
                    backgroundColor: theme.hex,
                    boxShadow: isSelected
                      ? `0 0 16px rgba(${theme.rgb}, 0.6)`
                      : `0 4px 10px rgba(0, 0, 0, 0.3)`,
                  }}
                >
                  {isSelected && (
                    <div className="w-2.5 h-2.5 rounded-full bg-bg shadow-sm" />
                  )}
                </div>
                <span
                  className={`text-[11px] font-medium transition-colors ${
                    isSelected ? "text-text-1" : "text-text-3 group-hover:text-text-2"
                  }`}
                >
                  {theme.name}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Ambient Effects" description="Visual highlights and responsive lighting.">
        <ToggleRow
          enabled={glowBackgroundEnabled}
          onToggle={setGlowBackgroundEnabled}
          title="Enable dynamic background"
          description="Render a responsive ambient glow gradient that moves with your mouse."
        />
        <ToggleRow
          enabled={animatedBorderEnabled}
          onToggle={setAnimatedBorderEnabled}
          title="Working input glow"
          description="Breathe a warm highlight around the message input while the model is thinking or responding."
        />
        {glowBackgroundEnabled && (
          <div className="mt-3 flex flex-col gap-1.5 pl-1">
            <span className="text-[12px] font-medium text-text-2">Glow Mode</span>
            <div className="grid grid-cols-4 gap-2 mt-1 sm:grid-cols-7">
              {(["match", "mesh", "lavender", "fluid", "aurora", "cyberpunk", "nebula"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setGlowBackgroundMode(mode)}
                  className={`px-1.5 py-1.5 rounded-lg border text-center text-[10px] sm:text-[11px] capitalize font-medium transition-all ${
                    glowBackgroundMode === mode
                      ? "border-accent/35 bg-accent/15 text-accent shadow-[0_4px_12px_-4px_rgba(var(--theme-accent-rgb),0.3)]"
                      : "border-hairline bg-white/[0.02] text-text-3 hover:border-hairline-strong hover:bg-white/5 hover:text-text-2"
                  }`}
                >
                  {mode === "match" ? "Match Theme" : mode}
                </button>
              ))}
            </div>
            <span className="text-[11px] leading-relaxed text-text-4 mt-1">
              {glowBackgroundMode === "match" && "Seamlessly mirrors your current theme color as a dynamic ambient gradient."}
              {glowBackgroundMode === "mesh" && "Your theme color with a subtle tech mesh grid overlay."}
              {glowBackgroundMode === "lavender" && "Extremely soft lavender/indigo blending for minimal distraction."}
              {glowBackgroundMode === "fluid" && "Active lava-lamp liquid flow with floating blobs that follow the cursor."}
              {glowBackgroundMode === "aurora" && "Diagonal waves of green, teal, and purple northern lights."}
              {glowBackgroundMode === "cyberpunk" && "Neon pink and blue pulse with a low-res scanline overlay."}
              {glowBackgroundMode === "nebula" && "Deep space magenta and gold cosmic clouds with twinkling stars."}
            </span>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Canvas & Artifacts" description="Side-panel canvas, inline widgets, and workflow preferences.">
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
        <ToggleRow
          enabled={advancedArtifacts}
          onToggle={setAdvancedArtifacts}
          title="Advanced inline artifacts"
          description="Let the model render live HTML/CSS/JS widgets — charts, diagrams, animations, interactive demos — right inside the reply. Runs sandboxed, isolated from the app."
        />
        <ToggleRow
          enabled={showDesignCritique}
          onToggle={setShowDesignCritique}
          title="Show critique scores"
          description="Display 5-dimension scores in design messages. Off by default."
        />
      </SettingsGroup>

      <SettingsGroup title="Quick Actions" description="Configure which shortcuts are visible in the input bar's '+' menu for each mode.">
        <div className="flex flex-col gap-4">
          <div className="flex gap-1.5 p-1 rounded-xl bg-black/30 border border-hairline w-fit">
            {(["chat", "agent"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setCustomModeTab(mode)}
                className={`px-4 py-1.5 rounded-lg text-center text-[11px] capitalize font-medium transition-all ${
                  customModeTab === mode
                    ? "bg-white/5 text-text-1 shadow-[0_2px_8px_rgba(0,0,0,0.2)] border border-hairline"
                    : "text-text-3 border border-transparent hover:text-text-2 hover:bg-white/[0.02]"
                }`}
              >
                {mode} Mode
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PLUS_ITEMS.map((item) => {
              const isSupported = item.modes.includes(customModeTab);
              const isVisible = isSupported && (plusMenuVisibility[customModeTab]?.[item.key] ?? false);
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  disabled={!isSupported}
                  onClick={() => setPlusMenuItemVisible(customModeTab, item.key, !isVisible)}
                  className={`flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border text-left transition-all duration-200 focus:outline-none ${
                    !isSupported
                      ? "border-hairline bg-black/15 opacity-40 cursor-not-allowed"
                      : isVisible
                        ? "border-accent/30 bg-accent/[0.04] text-text-1 shadow-[0_8px_20px_-12px_rgba(var(--theme-accent-rgb),0.25)] -translate-y-px cursor-pointer"
                        : "border-hairline bg-white/[0.01] text-text-3 hover:border-hairline-strong hover:bg-white/[0.03] hover:-translate-y-px cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className={`p-2 rounded-lg shrink-0 transition-colors duration-200 ${
                      !isSupported
                        ? "bg-white/[0.02] text-text-4"
                        : isVisible 
                          ? "bg-accent/10 text-accent" 
                          : "bg-white/5 text-text-3"
                    }`}>
                      <Icon size={14} strokeWidth={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-medium leading-none text-text-1">{item.label}</span>
                        {isVisible && (
                          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                        )}
                      </div>
                      <div className="text-[10px] text-text-4 truncate mt-1 leading-normal max-w-full">{item.description}</div>
                    </div>
                  </div>
                  
                  {/* Compact toggle indicator */}
                  <div className="shrink-0">
                    {isSupported ? (
                      <div className={`relative w-8 h-4.5 rounded-full border transition-all ${
                        isVisible ? "bg-accent border-accent" : "bg-white/5 border-hairline"
                      }`}>
                        <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-bg transition-transform duration-200 ${
                          isVisible ? "translate-x-3.5" : "translate-x-0"
                        }`} />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.03] border border-hairline text-[9.5px] font-medium text-text-4 select-none">
                        <span>Agent Only</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Sound & Feedback">
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
