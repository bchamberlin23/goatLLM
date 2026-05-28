import { useChatStore } from "../../stores/chat";
import { ToggleRow } from "./ToggleRow";
import { SystemPromptSection } from "./SystemPromptSection";
import { SettingsGroup } from "./SettingsGroup";

export function InterfaceTab() {
  const autoArtifacts = useChatStore((s) => s.autoArtifacts);
  const setAutoArtifacts = useChatStore((s) => s.setAutoArtifacts);
  const officeArtifacts = useChatStore((s) => s.officeArtifacts);
  const setOfficeArtifacts = useChatStore((s) => s.setOfficeArtifacts);
  const showDesignCritique = useChatStore((s) => s.showDesignCritique);
  const setShowDesignCritique = useChatStore((s) => s.setShowDesignCritique);
  const completionSound = useChatStore((s) => s.completionSound);
  const setCompletionSound = useChatStore((s) => s.setCompletionSound);

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
