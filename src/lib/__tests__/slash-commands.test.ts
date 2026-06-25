import { describe, expect, it, vi } from "vitest";

import {
  buildSlashCommandRegistry,
  executeSlashCommand,
  filterSlashCommands,
  getSlashCommandQuery,
  parseSlashCommandInvocation,
  type SlashCommandActions,
  type SlashCommandDefinition,
} from "../slash-commands";

function actions(overrides: Partial<SlashCommandActions> = {}): SlashCommandActions {
  return {
    attachFile: vi.fn(),
    clearComposer: vi.fn(),
    compactConversation: vi.fn(),
    focusComposer: vi.fn(),
    openImageGenerator: vi.fn(),
    openSettings: vi.fn(),
    openSkills: vi.fn(),
    sendMessage: vi.fn(),
    setAgentMode: vi.fn(),
    setComposerValue: vi.fn(),
    setDesignMode: vi.fn(),
    setError: vi.fn(),
    setPlanMode: vi.fn(),
    setPursueGoalMode: vi.fn(),
    setResearchMode: vi.fn(),
    setSteerPayload: vi.fn(),
    setSystemPrompt: vi.fn(),
    cancelStreaming: vi.fn(),
    ...overrides,
  };
}

function commandByName(commands: SlashCommandDefinition[], name: string): SlashCommandDefinition {
  const command = commands.find((item) => item.name === name);
  if (!command) throw new Error(`Missing /${name} command`);
  return command;
}

describe("slash command registry", () => {
  it("detects a command query only at the start of the composer text", () => {
    expect(getSlashCommandQuery("/", 1)).toEqual({ query: "", range: { start: 0, end: 1 } });
    expect(getSlashCommandQuery("/go", 3)).toEqual({ query: "go", range: { start: 0, end: 3 } });
    expect(getSlashCommandQuery("hello /go", 9)).toBeNull();
    expect(getSlashCommandQuery("/goal write tests\nmore", 17)).toBeNull();
  });

  it("filters commands by name, description, keywords, and mode availability", () => {
    const registry = buildSlashCommandRegistry({
      activeId: "c1",
      agentMode: true,
      designMode: false,
      featureFlags: { imageGeneration: true, pursueGoal: true },
      hasSearch: true,
      hasSkills: true,
      isStreaming: true,
      planMode: false,
      researchMode: false,
      activeSkillNames: [],
      skills: [],
    });

    expect(filterSlashCommands(registry, "go").map((command) => command.name)).toContain("goal");
    expect(filterSlashCommands(registry, "summarize").map((command) => command.name)).toContain(
      "compact",
    );
    expect(filterSlashCommands(registry, "interrupt").map((command) => command.name)).toContain(
      "steer",
    );
    expect(filterSlashCommands(registry, "skill").map((command) => command.name)).toContain(
      "skills",
    );
  });

  it("parses slash invocations with arguments", () => {
    expect(parseSlashCommandInvocation("/compact focus on auth")).toEqual({
      name: "compact",
      args: "focus on auth",
    });
    expect(parseSlashCommandInvocation("/goal")).toEqual({ name: "goal", args: "" });
    expect(parseSlashCommandInvocation(" /goal nope")).toBeNull();
  });

  it("executes /compact without sending a message", async () => {
    const commandActions = actions();
    const registry = buildSlashCommandRegistry({
      activeId: "c1",
      agentMode: true,
      designMode: false,
      featureFlags: { imageGeneration: true, pursueGoal: true },
      hasSearch: true,
      hasSkills: false,
      isStreaming: false,
      planMode: false,
      researchMode: false,
      activeSkillNames: [],
      skills: [],
    });
    const command = commandByName(registry, "compact");

    await executeSlashCommand(command, "focus on the failing tests", commandActions);

    expect(commandActions.compactConversation).toHaveBeenCalledWith("focus on the failing tests");
    expect(commandActions.sendMessage).not.toHaveBeenCalled();
    expect(commandActions.clearComposer).toHaveBeenCalled();
  });

  it("executes /goal with args as an autonomous goal run", async () => {
    const commandActions = actions();
    const registry = buildSlashCommandRegistry({
      activeId: "c1",
      agentMode: false,
      designMode: false,
      featureFlags: { imageGeneration: true, pursueGoal: true },
      hasSearch: true,
      hasSkills: false,
      isStreaming: false,
      planMode: false,
      researchMode: false,
      activeSkillNames: [],
      skills: [],
    });
    const command = commandByName(registry, "goal");

    await executeSlashCommand(command, "ship slash commands", commandActions);

    expect(commandActions.setPursueGoalMode).toHaveBeenCalledWith(true);
    expect(commandActions.setPlanMode).toHaveBeenCalledWith(false);
    expect(commandActions.sendMessage).toHaveBeenCalledWith("ship slash commands");
    expect(commandActions.clearComposer).toHaveBeenCalled();
  });

  it("executes /steer by interrupting the current stream", async () => {
    const commandActions = actions();
    const registry = buildSlashCommandRegistry({
      activeId: "c1",
      agentMode: true,
      designMode: false,
      featureFlags: { imageGeneration: true, pursueGoal: true },
      hasSearch: true,
      hasSkills: false,
      isStreaming: true,
      planMode: false,
      researchMode: false,
      activeSkillNames: [],
      skills: [],
    });
    const command = commandByName(registry, "steer");

    await executeSlashCommand(command, "stop and run tests first", commandActions);

    expect(commandActions.cancelStreaming).toHaveBeenCalled();
    expect(commandActions.setSteerPayload).toHaveBeenCalledWith({
      content: "stop and run tests first",
      steered: true,
    });
    expect(commandActions.clearComposer).toHaveBeenCalled();
  });
});
