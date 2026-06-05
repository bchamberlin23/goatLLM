import type { ToolCallEntry } from "../stores/chat";

export function isInternalSkillToolCall(tc: Pick<ToolCallEntry, "toolName">): boolean {
  return tc.toolName === "load_skill";
}

export function shouldShowToolCall(
  tc: Pick<ToolCallEntry, "toolName">,
  mode: "chat" | "agent" | "design",
): boolean {
  return mode !== "chat" || !isInternalSkillToolCall(tc);
}
