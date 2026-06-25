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
  const notebookEnabled = useChatStore((s) => s.featureFlags.notebookMode);
  const setFeatureFlag = useChatStore((s) => s.setFeatureFlag);
  const usageSettings = useChatStore((s) => s.usageSettings);
  const setUsageSettings = useChatStore((s) => s.setUsageSettings);
  const compactionSettings = usageSettings.compactionSettings;
  const updateCompactionSetting = (
    updates: Partial<typeof compactionSettings>,
  ) => {
    setUsageSettings({
      ...usageSettings,
      compactionSettings: {
        ...compactionSettings,
        ...updates,
      },
    });
  };

  return (
    <>
      <SettingsGroup
        title="Interface"
        description="Choose which workspace modes appear in the main mode switcher."
      >
        <ToggleRow
          enabled={notebookEnabled}
          onToggle={(enabled) => setFeatureFlag("notebookMode", enabled)}
          title="Notebook mode"
          description="Show Notebook: sources, saved notes, chat, and a canvas with runnable Python panels."
        />
      </SettingsGroup>

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
        title="Context & memory"
        description="Control when older conversation history is summarized for the model."
      >
        <ToggleRow
          enabled={compactionSettings.enabled}
          onToggle={(enabled) => updateCompactionSetting({ enabled })}
          title="Auto-compact"
          description="Summarize older context when provider usage approaches the model window."
        />
        <div className="soft-card grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl">
          <NumberField
            label="Reserve tokens"
            value={compactionSettings.reserveTokens}
            min={1024}
            step={1024}
            onChange={(reserveTokens) => updateCompactionSetting({ reserveTokens })}
          />
          <NumberField
            label="Keep recent tokens"
            value={compactionSettings.keepRecentTokens}
            min={1024}
            step={1024}
            onChange={(keepRecentTokens) => updateCompactionSetting({ keepRecentTokens })}
          />
        </div>
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

function NumberField({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-2">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.max(min, Math.round(next)));
        }}
        className="w-full rounded-md border border-hairline bg-surface-1 px-2.5 py-1.5 text-[12.5px] text-text-1 outline-none transition-colors focus:border-hairline-strong focus:shadow-[0_0_0_3px_var(--accent-soft)]"
      />
    </label>
  );
}
