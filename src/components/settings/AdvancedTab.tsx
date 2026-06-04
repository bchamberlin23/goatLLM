import { useChatStore } from "../../stores/chat";
import { ToggleRow } from "./ToggleRow";
import { DenylistSection } from "./DenylistSection";
import { SettingsGroup } from "./SettingsGroup";

export function AdvancedTab() {
  const jjagent = useChatStore((s) => s.jjagent);
  const setJjAgent = useChatStore((s) => s.setJjAgent);
  const workspaceHealthEnabled = useChatStore((s) => s.workspaceHealthEnabled);
  const setWorkspaceHealthEnabled = useChatStore((s) => s.setWorkspaceHealthEnabled);
  const manualTasksEnabled = useChatStore((s) => s.manualTasksEnabled);
  const setManualTasksEnabled = useChatStore((s) => s.setManualTasksEnabled);

  return (
    <>
      <SettingsGroup
        title="Workspace health"
        description="Verify changes and check git workspace status after actions."
      >
        <ToggleRow
          enabled={workspaceHealthEnabled}
          onToggle={setWorkspaceHealthEnabled}
          title="Workspace health panel"
          description="Display workspace contract integrity status after agent runs. Off by default."
        />
      </SettingsGroup>

      <SettingsGroup
        title="Tasks"
        description="Configure manual task planning and completion settings."
      >
        <ToggleRow
          enabled={manualTasksEnabled}
          onToggle={setManualTasksEnabled}
          title="Manual task editing"
          description="Allow manually adding, editing, deleting, and checking off tasks in the Tasks widget. Off by default."
        />
      </SettingsGroup>

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
