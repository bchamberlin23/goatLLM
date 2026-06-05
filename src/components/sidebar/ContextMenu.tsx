import type { ReactNode } from "react";
import { Archive, ArrowRightLeft, ChevronDown, Copy, ExternalLink, FileDown, Folder, Pencil, SquarePen, Trash2 } from "lucide-react";
import type { Conversation } from "../../stores/chat";
import type { Notebook } from "../../lib/canvas";
import { useContextMenuStore, type SidebarScope } from "./stores/ui-store";

type ExportFormat = "markdown" | "json";

interface ContextMenuProps {
  conversations: Conversation[];
  notebooks: Notebook[];
  workspaces: string[];
  onExportConversation: (id: string, format: ExportFormat) => void;
  onDeleteConversation: (id: string) => void;
  onToggleArchiveConversation: (id: string, archived: boolean) => void;
  onMoveConversation: (id: string, workspacePath: string | null) => void;
  onSelectWorkspace: (path: string) => void;
  onNewInWorkspace: (path: string) => void;
  onRevealWorkspace: (path: string) => void;
  onCopyWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
  onDeleteNotebook: (id: string) => void;
}

function labels(scope: SidebarScope) {
  if (scope === "design") {
    return {
      move: "Move to design folder...",
      personal: "Personal (no design folder)",
      none: "No design folders yet.",
      newHere: "New design here",
      remove: "Remove project",
      removeHint: "Designs will move to Personal",
    };
  }
  return {
    move: "Move to project...",
    personal: "Personal (no project)",
    none: "No projects yet.",
    newHere: "New chat here",
    remove: "Remove project",
    removeHint: "Chats will move to Personal",
  };
}

function MenuButton({
  children,
  destructive = false,
  onClick,
}: {
  children: ReactNode;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${destructive ? "text-text-2 hover:bg-red-500/10 hover:text-error" : "text-text-2 hover:bg-white/5 hover:text-text-1"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ContextMenu({
  conversations,
  notebooks,
  workspaces,
  onExportConversation,
  onDeleteConversation,
  onToggleArchiveConversation,
  onMoveConversation,
  onSelectWorkspace,
  onNewInWorkspace,
  onRevealWorkspace,
  onCopyWorkspace,
  onRemoveWorkspace,
  onDeleteNotebook,
}: ContextMenuProps) {
  const menu = useContextMenuStore((state) => state.menu);
  const moveMenuFor = useContextMenuStore((state) => state.moveMenuFor);
  const closeMenu = useContextMenuStore((state) => state.closeMenu);
  const toggleMoveMenu = useContextMenuStore((state) => state.toggleMoveMenu);
  const startRenaming = useContextMenuStore((state) => state.startRenaming);
  const expand = useContextMenuStore((state) => state.expand);

  if (!menu) return null;

  const close = () => closeMenu();

  return (
    <>
      <div
        className="fixed inset-0 z-[100]"
        onClick={close}
        onContextMenu={(event) => {
          event.preventDefault();
          close();
        }}
      />
      {menu.type === "conversation" && (() => {
        const conv = conversations.find((item) => item.id === menu.conversationId);
        const currentWorkspace = conv?.workspacePath ?? null;
        const canMove = menu.scope !== "chat";
        const moveOpen = moveMenuFor === menu.conversationId;
        const copy = labels(menu.scope);

        return (
          <div className="popover-surface motion-menu-in fixed z-[101] min-w-[200px] rounded-xl p-1.5" style={{ left: menu.x, top: menu.y }}>
            <MenuButton
              onClick={() => {
                if (conv) startRenaming({ type: "conversation", id: conv.id, value: conv.title });
              }}
            >
              <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
              Rename
            </MenuButton>
            {canMove && (
              <div className="relative">
                <MenuButton onClick={() => toggleMoveMenu(menu.conversationId)}>
                  <ArrowRightLeft size={13} strokeWidth={1.75} aria-hidden="true" />
                  <span className="flex-1 text-left">{copy.move}</span>
                  <ChevronDown size={11} strokeWidth={2} className={`text-text-4 transition-transform ${moveOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </MenuButton>
                {moveOpen && (
                  <div className="mb-1 ml-3 mr-1 mt-0.5 flex flex-col border-l border-white/5 pl-1.5">
                    <button
                      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] transition-colors ${currentWorkspace === null ? "bg-white/[0.06] text-text-1" : "text-text-2 hover:bg-white/5 hover:text-text-1"}`}
                      onClick={() => {
                        onMoveConversation(menu.conversationId, null);
                        close();
                      }}
                    >
                      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
                        <span className="h-1.5 w-1.5 rounded-full bg-text-4" />
                      </span>
                      {copy.personal}
                    </button>
                    {workspaces.length === 0 && <p className="px-2.5 py-1.5 text-[11px] text-text-4">{copy.none}</p>}
                    {workspaces.map((workspace) => {
                      const isCurrent = currentWorkspace === workspace;
                      return (
                        <button
                          key={workspace}
                          className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] transition-colors ${isCurrent ? "bg-white/[0.06] text-text-1" : "text-text-2 hover:bg-white/5 hover:text-text-1"}`}
                          onClick={() => {
                            onMoveConversation(menu.conversationId, workspace);
                            onSelectWorkspace(workspace);
                            expand(workspace);
                            close();
                          }}
                        >
                          <Folder size={11} strokeWidth={1.75} className="shrink-0 text-text-4" aria-hidden="true" />
                          <span className="truncate">{workspace.split("/").pop() || workspace}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <MenuButton onClick={() => onExportConversation(menu.conversationId, "markdown")}>
              <FileDown size={13} strokeWidth={1.75} aria-hidden="true" />
              Export as Markdown
            </MenuButton>
            <MenuButton onClick={() => onExportConversation(menu.conversationId, "json")}>
              <FileDown size={13} strokeWidth={1.75} aria-hidden="true" />
              Export as JSON
            </MenuButton>
            <div className="mx-1 my-1 h-px bg-white/5" />
            {canMove && conv && (
              <MenuButton
                onClick={() => {
                  onToggleArchiveConversation(menu.conversationId, !conv.archived);
                  close();
                }}
              >
                <Archive size={13} strokeWidth={1.75} aria-hidden="true" />
                {conv.archived ? "Unarchive" : "Archive"}
              </MenuButton>
            )}
            <MenuButton
              destructive
              onClick={() => {
                const ok = menu.scope === "chat" || window.confirm(`Delete "${conv?.title ?? "this chat"}"? This can't be undone.`);
                if (!ok) return;
                onDeleteConversation(menu.conversationId);
                close();
              }}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Delete chat
            </MenuButton>
          </div>
        );
      })()}
      {menu.type === "workspace" && (() => {
        const copy = labels(menu.scope);
        const total = conversations.filter((conv) =>
          conv.workspacePath === menu.workspacePath && (menu.scope === "design" ? conv.mode === "design" : conv.mode !== "design")
        ).length;

        return (
          <div className="popover-surface motion-menu-in fixed z-[101] min-w-[210px] rounded-xl p-1.5" style={{ left: menu.x, top: menu.y }}>
            <MenuButton
              onClick={() => {
                onNewInWorkspace(menu.workspacePath);
                close();
              }}
            >
              <SquarePen size={13} strokeWidth={1.75} aria-hidden="true" />
              {copy.newHere}
            </MenuButton>
            <MenuButton onClick={() => onRevealWorkspace(menu.workspacePath)}>
              <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
              Reveal in Finder
            </MenuButton>
            <MenuButton onClick={() => onCopyWorkspace(menu.workspacePath)}>
              <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
              Copy path
            </MenuButton>
            <div className="mx-1 my-1 h-px bg-white/5" />
            <MenuButton destructive onClick={() => onRemoveWorkspace(menu.workspacePath)}>
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              {copy.remove}
              {total > 0 && <span className="ml-auto text-[10px] text-text-4" title={copy.removeHint}>{total} chat{total === 1 ? "" : "s"}</span>}
            </MenuButton>
          </div>
        );
      })()}
      {menu.type === "notebook" && (() => {
        const notebook = notebooks.find((item) => item.id === menu.notebookId);
        return (
          <div className="popover-surface motion-menu-in fixed z-[101] min-w-[160px] rounded-xl p-1.5" style={{ left: menu.x, top: menu.y }}>
            <MenuButton
              onClick={() => {
                if (notebook) startRenaming({ type: "notebook", id: notebook.id, value: notebook.name });
              }}
            >
              <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
              Rename
            </MenuButton>
            <div className="mx-1 my-1 h-px bg-white/5" />
            <MenuButton
              destructive
              onClick={() => {
                onDeleteNotebook(menu.notebookId);
                close();
              }}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Delete
            </MenuButton>
          </div>
        );
      })()}
    </>
  );
}
