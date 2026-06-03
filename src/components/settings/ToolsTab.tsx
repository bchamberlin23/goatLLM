import { useChatStore } from "../../stores/chat";
import { ToggleRow } from "./ToggleRow";
import { TavilyKeyRow } from "./TavilyKeyRow";
import { SemanticIndexSection } from "./SemanticIndexSection";
import { McpSettingsSection } from "./McpSettingsSection";
import { SkillsSection } from "./SkillsSection";
import { SettingsGroup } from "./SettingsGroup";
import { AgentPolicyPanel } from "../AgentPolicyPanel";

export function ToolsTab() {
  const tavilyApiKey = useChatStore((s) => s.tavilyApiKey);
  const setTavilyApiKey = useChatStore((s) => s.setTavilyApiKey);
  const freeWebSearch = useChatStore((s) => s.freeWebSearch);
  const setFreeWebSearch = useChatStore((s) => s.setFreeWebSearch);
  const chatCodeExec = useChatStore((s) => s.chatCodeExec);
  const setChatCodeExec = useChatStore((s) => s.setChatCodeExec);
  const subagentsEnabled = useChatStore((s) => s.subagentsEnabled);
  const setSubagentsEnabled = useChatStore((s) => s.setSubagentsEnabled);

  return (
    <>
      <SettingsGroup title="Search" description="Backends for the agent's web_search tool.">
        <ToggleRow
          enabled={freeWebSearch}
          onToggle={setFreeWebSearch}
          title="Free Web Search"
          description="No API key. Takes priority over Tavily when enabled."
        />
        <TavilyKeyRow
          apiKey={tavilyApiKey}
          onSave={setTavilyApiKey}
          onRemove={() => setTavilyApiKey("")}
        />
      </SettingsGroup>

      <SettingsGroup title="Execution" description="What the agent can run beyond chat.">
        <ToggleRow
          enabled={chatCodeExec}
          onToggle={setChatCodeExec}
          title="Code execution in Chat"
          description="Python and JavaScript snippets in chat mode. Each run asks for approval."
        />
        <ToggleRow
          enabled={subagentsEnabled}
          onToggle={setSubagentsEnabled}
          title="Subagents"
          description="Spawn child agents for parallel work in Agent and Design modes only."
        />
      </SettingsGroup>

      <SettingsGroup title="Agent policy" description="Verification, permission, path, and budget defaults for agent mode.">
        <AgentPolicyPanel embedded />
      </SettingsGroup>

      <SettingsGroup title="Integrations" description="External tools and reusable agent capabilities.">
        <McpSettingsSection embedded />
        <SkillsSection embedded />
      </SettingsGroup>

      <SettingsGroup title="Workspace" description="Semantic search over the active project.">
        <SemanticIndexSection />
      </SettingsGroup>
    </>
  );
}
