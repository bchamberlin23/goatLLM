/**
 * tools.ts — thin re-export shim.
 *
 * The real definitions live under src/lib/tools/. This file preserves the
 * public surface so existing imports (`from "../lib/tools"` /
 * `from "./lib/tools"`) keep working without churn.
 *
 * Layout:
 * - tools/_helpers.ts            workspace + invoke + temp-file helpers
 * - tools/approval.ts            approval gate, write-tool registry, modes
 * - tools/builtins/read.ts       READ_ONLY_TOOLS
 * - tools/builtins/write.ts      WRITE_TOOLS
 * - tools/registry.ts            ALL_TOOLS, PLAN_TOOLS, RESEARCH_TOOLS, CHAT_TOOLS
 */
export {
  isWriteTool,
  shouldAutoApprove,
  approveExecution,
  denyExecution,
  type PermissionMode,
} from "./tools/approval";

export {
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
  ALL_TOOLS,
  DESIGN_TOOLS,
  RESEARCH_TOOLS,
  PLAN_TOOLS,
  CHAT_TOOLS,
  ATTACHMENT_TOOLS,
  CODE_EXEC_TOOLS,
} from "./tools/registry";
