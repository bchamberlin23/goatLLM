import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Message } from "../stores/chat";
import { useChatStore } from "../stores/chat";
import { ApprovalQueue } from "../components/ApprovalQueue";
import { AgentRecoveryPanel } from "../components/AgentRecoveryPanel";
import { AgentPolicyPanel } from "../components/AgentPolicyPanel";
import { WorkspaceHealthPanel } from "../components/WorkspaceHealthPanel";
import { ToolsTab } from "../components/settings/ToolsTab";
import { AttachmentPanel } from "../components/AttachmentPanel";
import { approveExecution, denyExecution, requestSuggestedCheckApproval } from "../lib/tools/approval";

const convId = "conv-trust";

function resetStore(messages: Message[] = []) {
  useChatStore.setState({
    conversations: [
      {
        id: convId,
        title: "Trust",
        lastMessagePreview: "",
        lastMessageAt: 1,
        createdAt: 1,
        modelId: null,
        systemPrompt: "",
        workspacePath: "/workspace",
      },
    ],
    activeId: convId,
    messages: { [convId]: messages },
    workspacePath: "/workspace",
    isStreaming: false,
    streamingConversationId: null,
    streamingAbortControllers: {},
    verificationPolicy: {
      requireBuildForWeb: true,
      requireRustTests: true,
      customCommands: [],
    },
    projectCheckMemory: { successfulCommands: [] },
    permissionProfile: "default",
  });
}

function assistantMessage(partial: Partial<Message>): Message {
  return {
    id: "msg-1",
    conversationId: convId,
    role: "assistant",
    content: "",
    createdAt: 1,
    ...partial,
  };
}

describe("agent trust surfaces", () => {
  it("queues suggested verification as a pending approval tool call", () => {
    resetStore([assistantMessage({ id: "msg-check" })]);

    const toolCallId = requestSuggestedCheckApproval({
      conversationId: convId,
      messageId: "msg-check",
      command: "pnpm test",
    });

    const toolCall = useChatStore
      .getState()
      .messages[convId][0]
      .toolCalls?.find((tc) => tc.toolCallId === toolCallId);

    expect(toolCall).toMatchObject({
      toolName: "bash",
      input: { command: "pnpm test" },
      state: "pending_approval",
      dangerLevel: "safe",
    });
  });

  it("removes suggested verification approval after denial", () => {
    resetStore([assistantMessage({ id: "msg-check" })]);
    const toolCallId = requestSuggestedCheckApproval({
      conversationId: convId,
      messageId: "msg-check",
      command: "pnpm test",
    });

    denyExecution(toolCallId);
    approveExecution(toolCallId);

    const toolCall = useChatStore
      .getState()
      .messages[convId][0]
      .toolCalls?.find((tc) => tc.toolCallId === toolCallId);

    expect(toolCall?.state).toBe("done");
    expect(toolCall?.output).toMatch(/denied/i);
  });

  it("renders a compact approval queue", () => {
    resetStore([
      assistantMessage({
        toolCalls: [
          {
            toolCallId: "cmd-1",
            toolName: "bash",
            input: { command: "pnpm test" },
            state: "pending_approval",
          },
        ],
      }),
    ]);

    render(<ApprovalQueue />);

    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
  });

  it("hides workspace health when the latest agent turn is healthy", () => {
    resetStore([
      assistantMessage({
        editedFiles: ["src/App.tsx"],
        toolCalls: [
          {
            toolCallId: "test-1",
            toolName: "bash",
            input: { command: "pnpm test" },
            state: "done",
          },
        ],
      }),
    ]);

    render(<WorkspaceHealthPanel />);

    expect(screen.queryByText("Workspace health")).not.toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    expect(screen.queryByText("1 file changed")).not.toBeInTheDocument();
    expect(screen.queryByText(/Replay this request/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending approvals/i)).not.toBeInTheDocument();
  });

  it("offers runnable verification checks when the latest turn is blocked", () => {
    resetStore([
      assistantMessage({
        id: "msg-blocked",
        editedFiles: ["src/App.tsx"],
        toolCalls: [
          {
            toolCallId: "edit-1",
            toolName: "edit_file",
            input: { path: "src/App.tsx" },
            state: "done",
          },
        ],
      }),
    ]);

    render(<WorkspaceHealthPanel />);

    expect(screen.getByText("Blocked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));

    const toolCalls = useChatStore.getState().messages[convId][0].toolCalls ?? [];
    expect(toolCalls.some((tc) => {
      const input = tc.input as Record<string, unknown>;
      return tc.toolName === "bash" && input.command === "pnpm test" && tc.state === "pending_approval";
    })).toBe(true);
  });

  it("renders checkpoint browser and session export controls", () => {
    resetStore([
      assistantMessage({
        id: "turn-1",
        editedFiles: ["src/App.tsx"],
        toolCalls: [
          {
            toolCallId: "edit-1",
            toolName: "edit_file",
            input: { path: "src/App.tsx", content: "after" },
            state: "done",
            rollbackSnapshot: {
              path: "src/App.tsx",
              existed: true,
              content: "before",
              capturedAt: 1,
            },
          },
        ],
      }),
    ]);

    render(<AgentRecoveryPanel />);

    expect(screen.getByRole("button", { name: /recovery/i })).toBeInTheDocument();
    expect(screen.queryByText("Checkpoints")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /recovery/i }));
    expect(screen.getByText("Checkpoints")).toBeInTheDocument();
    expect(screen.getAllByText("src/App.tsx").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Copy audit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download audit" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Name checkpoint")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rename checkpoint" }));
    expect(screen.getByPlaceholderText("Name checkpoint")).toBeInTheDocument();
  });

  it("updates verification policy and permission profile from the policy panel", () => {
    resetStore();

    render(<AgentPolicyPanel />);

    fireEvent.click(screen.getByLabelText("Require build after web changes"));
    fireEvent.click(screen.getByRole("button", { name: "Full auto" }));

    const state = useChatStore.getState();
    expect(state.verificationPolicy.requireBuildForWeb).toBe(false);
    expect(state.permissionProfile).toBe("fast");
  });

  it("lets users forget learned check commands from the policy panel", () => {
    resetStore();
    useChatStore.setState({
      projectCheckMemory: { successfulCommands: ["pnpm test", "pnpm build"] },
    });

    render(<AgentPolicyPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Forget pnpm build" }));

    expect(useChatStore.getState().projectCheckMemory.successfulCommands).toEqual(["pnpm test"]);
  });

  it("places agent policy controls in settings tools tab", () => {
    resetStore();

    render(<ToolsTab />);

    expect(screen.getByText("Agent policy")).toBeInTheDocument();
    expect(screen.getByLabelText("Require build after web changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full auto" })).toBeInTheDocument();
  });

  it("previews SVG attachments inside a sandboxed frame", async () => {
    resetStore();
    useChatStore.getState().setActiveAttachment({
      filename: "unsafe.svg",
      mimeType: "image/svg+xml",
      dataUrl: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20onload%3D%22window.top.pwned%3Dtrue%22%3E%3C%2Fsvg%3E",
      sizeBytes: 96,
    });

    const { container } = render(<AttachmentPanel />);
    fireEvent.click(screen.getByRole("button", { name: /view preview/i }));

    await waitFor(() => {
      const frame = container.querySelector("iframe[title='unsafe.svg']");
      expect(frame).toBeInTheDocument();
      expect(frame).toHaveAttribute("sandbox", "");
    });
  });
});
