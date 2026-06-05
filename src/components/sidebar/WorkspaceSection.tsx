import { useMemo, type MouseEvent } from "react";
import { Folder, Plus, SquarePen } from "lucide-react";
import type { Conversation } from "../../stores/chat";
import { RenameInput } from "./RenameInput";
import { TreeItem, WorkspaceTreeItem, formatTimestamp } from "./TreeItem";
import { useContextMenuStore, type SidebarScope } from "./stores/ui-store";

type WorkspaceScope = Exclude<SidebarScope, "chat">;

interface WorkspaceSectionProps {
  scope: WorkspaceScope;
  workspaces: string[];
  conversations: Conversation[];
  activeWorkspacePath: string | null;
  activeConversationId: string | null;
  streamingControllers: Record<string, AbortController>;
  query: string;
  adding: boolean;
  onAddWorkspace: () => void;
  onSelectWorkspace: (path: string) => void;
  onSelectConversation: (id: string, workspacePath: string) => void;
  onNewInWorkspace: (path: string) => void;
  onRenameConversation: (id: string, title: string) => void;
}

function copy(scope: WorkspaceScope) {
  return scope === "design"
    ? {
        section: "Designs",
        add: "Add design workspace",
        empty: "No design folders yet",
        emptyAction: "Add a design folder",
        noMatches: "No designs match",
        newItem: "New design",
      }
    : {
        section: "Projects",
        add: "Add project",
        empty: "No projects yet",
        emptyAction: "Add a project",
        noMatches: "No chats match",
        newItem: "New chat",
      };
}

function menuPoint(event: { clientX: number; clientY: number }, width: number, height: number) {
  return {
    x: Math.min(event.clientX, window.innerWidth - width - 8),
    y: Math.min(event.clientY, window.innerHeight - height - 8),
  };
}

function menuFromButton(event: MouseEvent<HTMLElement>, width: number, height: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(rect.left, window.innerWidth - width - 8),
    y: Math.min(rect.bottom + 4, window.innerHeight - height - 8),
  };
}

export function WorkspaceSection({
  scope,
  workspaces,
  conversations,
  activeWorkspacePath,
  activeConversationId,
  streamingControllers,
  query,
  adding,
  onAddWorkspace,
  onSelectWorkspace,
  onSelectConversation,
  onNewInWorkspace,
  onRenameConversation,
}: WorkspaceSectionProps) {
  const labels = copy(scope);
  const expanded = useContextMenuStore((state) => state.expanded);
  const toggleExpanded = useContextMenuStore((state) => state.toggleExpanded);
  const openConversationMenu = useContextMenuStore((state) => state.openConversationMenu);
  const openWorkspaceMenu = useContextMenuStore((state) => state.openWorkspaceMenu);
  const renaming = useContextMenuStore((state) => state.renaming);
  const updateRenameValue = useContextMenuStore((state) => state.updateRenameValue);
  const cancelRenaming = useContextMenuStore((state) => state.cancelRenaming);

  const trimmedQuery = query.trim().toLowerCase();
  const hasQuery = trimmedQuery.length > 0;

  const visibleConversations = useMemo(
    () =>
      conversations.filter((conversation) =>
        conversation.workspacePath && (scope === "design" ? conversation.mode === "design" : conversation.mode !== "design")
      ),
    [conversations, scope],
  );

  const { byWorkspace, totals, lastActivity, totalMatches } = useMemo(() => {
    const grouped: Record<string, Conversation[]> = {};
    const counts: Record<string, number> = {};
    const activity: Record<string, number> = {};
    let matches = 0;

    for (const conversation of visibleConversations) {
      const workspace = conversation.workspacePath;
      if (!workspace) continue;
      counts[workspace] = (counts[workspace] ?? 0) + 1;
      if ((activity[workspace] ?? 0) < conversation.lastMessageAt) activity[workspace] = conversation.lastMessageAt;

      const isMatch =
        !hasQuery ||
        conversation.title.toLowerCase().includes(trimmedQuery) ||
        conversation.lastMessagePreview?.toLowerCase().includes(trimmedQuery);
      if (!isMatch) continue;
      (grouped[workspace] ||= []).push(conversation);
      matches += 1;
    }

    for (const list of Object.values(grouped)) list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return { byWorkspace: grouped, totals: counts, lastActivity: activity, totalMatches: matches };
  }, [hasQuery, trimmedQuery, visibleConversations]);

  const commitRename = () => {
    if (!renaming || renaming.type !== "conversation") return;
    onRenameConversation(renaming.id, renaming.value);
    cancelRenaming();
  };

  const openChatMenu = (event: MouseEvent<HTMLElement>, conversationId: string, fromButton = false) => {
    event.preventDefault();
    event.stopPropagation();
    openConversationMenu({
      type: "conversation",
      conversationId,
      scope,
      ...(fromButton ? menuFromButton(event, 220, 260) : menuPoint(event, 220, 260)),
    });
  };

  const openProjectMenu = (event: MouseEvent<HTMLElement>, workspacePath: string, fromButton = false) => {
    event.preventDefault();
    event.stopPropagation();
    openWorkspaceMenu({
      type: "workspace",
      workspacePath,
      scope,
      ...(fromButton ? menuFromButton(event, 220, 200) : menuPoint(event, 220, 200)),
    });
  };

  return (
    <>
      <div className="mt-3 flex items-center justify-between px-4 pb-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-text-4">{labels.section}</span>
        <button
          onClick={onAddWorkspace}
          disabled={adding}
          className="control-icon flex h-5 w-5 items-center justify-center rounded-md transition-colors disabled:opacity-50"
          aria-label={labels.add}
          title={labels.add}
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
        {workspaces.length === 0 && !hasQuery && (
          <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04]">
              <Folder size={15} strokeWidth={1.5} className="text-text-3" aria-hidden="true" />
            </div>
            <p className="text-[12px] text-text-3">{labels.empty}</p>
            <button onClick={onAddWorkspace} className="control-pill rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors">
              {labels.emptyAction}
            </button>
          </div>
        )}
        {hasQuery && totalMatches === 0 && (
          <p className="px-2.5 py-3 text-[11.5px] leading-relaxed text-text-3">
            {labels.noMatches} <span className="text-text-1">"{query.trim()}"</span>
          </p>
        )}
        {workspaces.map((workspace) => {
          const name = workspace.split("/").pop() || workspace;
          const chats = byWorkspace[workspace] ?? [];
          if (hasQuery && chats.length === 0) return null;
          const isExpanded = hasQuery || (expanded[workspace] ?? false);
          const isActiveWorkspace = activeWorkspacePath === workspace;

          return (
            <div key={workspace} className="mb-1 flex flex-col">
              <WorkspaceTreeItem
                name={name}
                path={workspace}
                active={isActiveWorkspace}
                expanded={isExpanded}
                count={totals[workspace] ?? 0}
                lastActivity={lastActivity[workspace]}
                onSelect={() => onSelectWorkspace(workspace)}
                onToggle={(event) => {
                  event.stopPropagation();
                  toggleExpanded(workspace);
                }}
                onNew={(event) => {
                  event.stopPropagation();
                  onNewInWorkspace(workspace);
                }}
                onMenu={(event) => openProjectMenu(event, workspace, true)}
                onContextMenu={(event) => openProjectMenu(event, workspace)}
                newLabel={`${labels.newItem} in ${name}`}
              />
              {isExpanded && (
                <div className="ml-3 mt-0.5 flex flex-col border-l border-white/[0.04] pl-2">
                  {chats.length === 0 ? (
                    <button
                      className="sidebar-action flex h-8 items-center gap-2 rounded-md px-2 text-[12px] text-text-3 transition-colors hover:text-text-1"
                      onClick={() => onNewInWorkspace(workspace)}
                    >
                      <SquarePen size={11} strokeWidth={1.75} aria-hidden="true" />
                      {labels.newItem}
                    </button>
                  ) : (
                    chats.map((conversation) => {
                      if (renaming?.type === "conversation" && renaming.id === conversation.id) {
                        return (
                          <RenameInput
                            key={conversation.id}
                            value={renaming.value}
                            onChange={updateRenameValue}
                            onCommit={commitRename}
                            onCancel={cancelRenaming}
                            textSize="sm"
                          />
                        );
                      }
                      return (
                        <TreeItem
                          key={conversation.id}
                          inset
                          title={conversation.title}
                          active={activeConversationId === conversation.id}
                          metadata={formatTimestamp(conversation.lastMessageAt)}
                          isStreaming={!!streamingControllers[conversation.id]}
                          isGeneratingTitle={conversation.isGeneratingTitle}
                          menuLabel="Chat actions"
                          onClick={() => onSelectConversation(conversation.id, workspace)}
                          onContextMenu={(event) => openChatMenu(event, conversation.id)}
                          onMenuClick={(event) => openChatMenu(event, conversation.id, true)}
                        />
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
