import { useChatStore } from "../../stores/chat";
import { ToggleRow } from "./ToggleRow";
import { DenylistSection } from "./DenylistSection";
import { SettingsGroup } from "./SettingsGroup";

export function AdvancedTab() {
  const jjagent = useChatStore((s) => s.jjagent);
  const setJjAgent = useChatStore((s) => s.setJjAgent);

  return (
    <>
      <SettingsGroup
        title="Version control"
        description="Isolate agent edits with jj for easy review and rollback."
      >
        <ToggleRow
          enabled={jjagent}
          onToggle={setJjAgent}
          title="jjagent — edit isolation"
          description="Each agent turn gets its own jj change, squashed on completion. Requires jj in a jj workspace."
        />
      </SettingsGroup>

      <SettingsGroup
        title="File denylist"
        description="Glob patterns the agent cannot read or write. Built-in secrets patterns always apply."
      >
        <DenylistSection />
      </SettingsGroup>
    </>
  );
}
