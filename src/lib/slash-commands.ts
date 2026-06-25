import type { Skill } from "./skills";

export interface SlashCommandState {
  activeId: string | null;
  agentMode: boolean;
  designMode: boolean;
  featureFlags: {
    imageGeneration?: boolean;
    pursueGoal?: boolean;
  };
  hasSearch: boolean;
  hasSkills: boolean;
  isStreaming: boolean;
  planMode: boolean;
  researchMode: boolean;
  activeSkillNames: string[];
  skills: Skill[];
}

export interface SlashCommandActions {
  attachFile: () => void;
  cancelStreaming: () => void;
  clearComposer: () => void;
  compactConversation: (instructions: string) => void | Promise<void>;
  focusComposer: () => void;
  openImageGenerator: () => void;
  openSettings: () => void;
  openSkills: () => void;
  sendMessage: (content: string) => void | Promise<void>;
  setAgentMode: (enabled: boolean) => void;
  setComposerValue: (value: string) => void;
  setDesignMode: (enabled: boolean) => void;
  setError: (message: string | null) => void;
  setPlanMode: (enabled: boolean) => void;
  setPursueGoalMode: (enabled: boolean) => void;
  setResearchMode: (enabled: boolean) => void;
  setSteerPayload: (payload: { content: string; steered: boolean }) => void;
  setSystemPrompt: (prompt: string) => void;
}

export interface SlashCommandDefinition {
  name: string;
  label: string;
  description: string;
  argumentHint?: string;
  keywords: string[];
  execute: (args: string, actions: SlashCommandActions) => void | Promise<void>;
}

export interface SlashCommandQuery {
  query: string;
  range: { start: number; end: number };
}

function command(
  definition: Omit<SlashCommandDefinition, "label"> & { label?: string },
): SlashCommandDefinition {
  return {
    ...definition,
    label: definition.label ?? `/${definition.name}`,
  };
}

export function getSlashCommandQuery(
  value: string,
  cursorPosition: number,
): SlashCommandQuery | null {
  const beforeCursor = value.slice(0, cursorPosition);
  if (!beforeCursor.startsWith("/")) return null;
  if (beforeCursor.includes("\n")) return null;
  if (/\s/.test(beforeCursor)) return null;
  return {
    query: beforeCursor.slice(1),
    range: { start: 0, end: cursorPosition },
  };
}

export function parseSlashCommandInvocation(value: string): { name: string; args: string } | null {
  const match = /^\/([A-Za-z0-9_:.-]+)(?:\s+([\s\S]*))?$/.exec(value);
  if (!match) return null;
  const rawArgs: string | undefined = match[2];
  return {
    name: match[1].toLowerCase(),
    args: rawArgs ? rawArgs.trim() : "",
  };
}

export function filterSlashCommands(
  commands: SlashCommandDefinition[],
  query: string,
): SlashCommandDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;

  const scored = commands
    .map((item) => {
      const name = item.name.toLowerCase();
      const description = item.description.toLowerCase();
      const keywords = item.keywords.join(" ").toLowerCase();
      let score = 0;
      if (name === normalized) score = 100;
      else if (name.startsWith(normalized)) score = 80;
      else if (name.includes(normalized)) score = 60;
      else if (keywords.includes(normalized)) score = 40;
      else if (description.includes(normalized)) score = 20;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  return scored.map((entry) => entry.item);
}

export async function executeSlashCommand(
  commandDefinition: SlashCommandDefinition,
  args: string,
  actions: SlashCommandActions,
) {
  await commandDefinition.execute(args.trim(), actions);
}

export function buildSlashCommandRegistry(state: SlashCommandState): SlashCommandDefinition[] {
  const commands: SlashCommandDefinition[] = [
    command({
      name: "chat",
      description: "Switch to plain chat mode.",
      keywords: ["mode", "conversation"],
      execute: (_args, actions) => {
        actions.setAgentMode(false);
        actions.setDesignMode(false);
        actions.clearComposer();
      },
    }),
    command({
      name: "agent",
      description: "Switch to agent mode with workspace tools.",
      keywords: ["mode", "tools", "code"],
      execute: (_args, actions) => {
        actions.setAgentMode(true);
        actions.clearComposer();
      },
    }),
    command({
      name: "design",
      description: "Switch to design mode.",
      keywords: ["mode", "artifact", "visual"],
      execute: (_args, actions) => {
        actions.setDesignMode(true);
        actions.clearComposer();
      },
    }),
    command({
      name: "attach",
      description: "Attach a file to the next message.",
      keywords: ["upload", "file"],
      execute: (_args, actions) => {
        actions.attachFile();
        actions.clearComposer();
      },
    }),
    command({
      name: "settings",
      description: "Open settings.",
      keywords: ["preferences", "providers", "models"],
      execute: (_args, actions) => {
        actions.openSettings();
        actions.clearComposer();
      },
    }),
    command({
      name: "system",
      description: "Set this conversation's steering/system prompt.",
      argumentHint: "<instructions>",
      keywords: ["steer", "prompt", "instruction"],
      execute: (args, actions) => {
        if (!args) {
          actions.setError("Add instructions after /system.");
          actions.focusComposer();
          return;
        }
        actions.setSystemPrompt(args);
        actions.clearComposer();
      },
    }),
  ];

  if (state.featureFlags.pursueGoal !== false) {
    commands.push(
      command({
        name: "goal",
        description: "Run autonomously until a goal is handled.",
        argumentHint: "<goal>",
        keywords: ["pursue", "autonomous", "target"],
        execute: async (args, actions) => {
          actions.setPursueGoalMode(true);
          actions.setPlanMode(false);
          if (!args) {
            actions.setComposerValue("");
            actions.focusComposer();
            return;
          }
          await actions.sendMessage(args);
          actions.clearComposer();
        },
      }),
    );
  }

  if (state.activeId) {
    commands.push(
      command({
        name: "compact",
        description: "Summarize older context now.",
        argumentHint: "[focus]",
        keywords: ["summarize", "context", "memory"],
        execute: async (args, actions) => {
          await actions.compactConversation(args);
          actions.clearComposer();
        },
      }),
      command({
        name: "steer",
        description: "Interrupt and redirect the current response.",
        argumentHint: "<message>",
        keywords: ["interrupt", "redirect", "queue"],
        execute: (args, actions) => {
          if (!args) {
            actions.setError("Add a steering message after /steer.");
            actions.focusComposer();
            return;
          }
          if (!state.isStreaming) {
            actions.setError("/steer is available while a response is running.");
            actions.focusComposer();
            return;
          }
          actions.cancelStreaming();
          actions.setSteerPayload({ content: args, steered: true });
          actions.clearComposer();
        },
      }),
    );
  }

  if (state.agentMode) {
    commands.push(
      command({
        name: "plan",
        description: state.planMode ? "Turn plan mode off." : "Turn plan mode on.",
        keywords: ["readonly", "investigate"],
        execute: (_args, actions) => {
          actions.setPlanMode(!state.planMode);
          actions.clearComposer();
        },
      }),
    );
  }

  if (state.agentMode || state.hasSearch) {
    commands.push(
      command({
        name: "research",
        description: state.researchMode ? "Turn deep research off." : "Turn deep research on.",
        keywords: ["web", "citations", "search"],
        execute: (_args, actions) => {
          actions.setResearchMode(!state.researchMode);
          actions.clearComposer();
        },
      }),
    );
  }

  if (state.featureFlags.imageGeneration !== false) {
    commands.push(
      command({
        name: "image",
        description: "Open image generation.",
        argumentHint: "[prompt]",
        keywords: ["generate", "picture", "artifact"],
        execute: (args, actions) => {
          if (args) actions.setComposerValue(args);
          actions.openImageGenerator();
        },
      }),
    );
  }

  if (state.hasSkills) {
    commands.push(
      command({
        name: "skills",
        description: "Open the skill picker.",
        keywords: ["skill", "persona", "workflow"],
        execute: (_args, actions) => {
          actions.openSkills();
          actions.clearComposer();
        },
      }),
    );
  }

  for (const skill of state.skills) {
    commands.push(
      command({
        name: `skill:${skill.name}`,
        label: `/skill:${skill.name}`,
        description: skill.description || `Use the ${skill.name} skill.`,
        argumentHint: "[message]",
        keywords: ["skill", skill.mode],
        execute: (args, actions) => {
          actions.setComposerValue(`/skill:${skill.name}${args ? ` ${args}` : " "}`);
          actions.focusComposer();
        },
      }),
    );
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name));
}
