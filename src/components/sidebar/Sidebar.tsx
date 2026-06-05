import { useEffect, useMemo, useRef, useState } from "react";
import { NotebookPen } from "lucide-react";
import { useChatStore, type Conversation } from "../../stores/chat";
import { downloadExport } from "../../lib/export";
import { SidebarHeader } from "./SidebarHeader";
import { ConversationsSection } from "./ConversationsSection";
import { WorkspaceSection } from "./WorkspaceSection";
import { NotebooksSection } from "./NotebooksSection";
import { SettingsFooter } from "./SettingsFooter";
import { ContextMenu } from "./ContextMenu";
import { useContextMenuStore, type SidebarScope } from "./stores/ui-store";

interface SidebarProps {
  onOpenSettings: () => void;
}

function useAgentWorkspaces() {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const refresh = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setWorkspaces(await invoke<string[]>("list_workspaces"));
    } catch {
      setWorkspaces([]);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  return { workspaces, refresh };
}

function filterChat(conversations: Conversation[], messages: ReturnType<typeof useChatStore.getState>["messages"], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return conversations;
  return conversations
    .map((conversation) => {
      let score = 0;
      if (conversation.title.toLowerCase().includes(q)) score += 100;
      if (conversation.lastMessagePreview.toLowerCase().includes(q)) score += 10;
      for (const message of messages[conversation.id] ?? []) {
        if (message.content.toLowerCase().includes(q)) score += 1;
      }
      return { conversation, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.conversation.lastMessageAt - a.conversation.lastMessageAt)
    .map((item) => item.conversation);
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const {
    conversations, messages, activeId, streamingAbortControllers: streamingControllers,
    agentMode, designMode, notebookMode, workspacePath, designWorkspacePath, designWorkspaces,
    notebooks, activeNotebookId, messageSearchResults, messageSearchLoading,
    setActiveConversation, deleteConversation, renameConversation, setConversationArchived,
    moveConversationToWorkspace, setWorkspace, setDesignWorkspace, addDesignWorkspace,
    removeDesignWorkspace, createNotebook, renameNotebook, deleteNotebook, setActiveNotebook,
    setSearchQuery, performMessageSearch, clearMessageSearch,
  } = useChatStore();
  const agentWorkspaces = useAgentWorkspaces();
  const [searchInput, setSearchInput] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const scope: SidebarScope | "notebook" = notebookMode ? "notebook" : agentMode ? "agent" : designMode ? "design" : "chat";
  const activeWorkspace = scope === "design" ? designWorkspacePath : scope === "agent" ? workspacePath : null;
  const currentWorkspaces = scope === "design" ? designWorkspaces : scope === "agent" ? agentWorkspaces.workspaces : [];
  const chatConversations = useMemo(() => conversations.filter((c) => !c.workspacePath && c.mode !== "design"), [conversations]);
  const filteredChat = useMemo(() => filterChat(chatConversations, messages, searchInput), [chatConversations, messages, searchInput]);

  useEffect(() => {
    if (activeWorkspace) useContextMenuStore.getState().expand(activeWorkspace);
  }, [activeWorkspace]);

  useEffect(() => {
    useContextMenuStore.getState().closeMenu();
  }, [scope]);

  useEffect(() => {
    if (scope !== "chat") return;
    setSearchQuery(searchInput);
    const timer = window.setTimeout(() => {
      if (searchInput.trim()) void performMessageSearch(searchInput);
      else clearMessageSearch();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [clearMessageSearch, performMessageSearch, scope, searchInput, setSearchQuery]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "f" && scope !== "notebook") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (event.key.toLowerCase() === "n" && scope === "notebook") {
        event.preventDefault();
        createNotebook();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNotebook, scope]);

  const closeMenu = () => useContextMenuStore.getState().closeMenu();
  const newInWorkspace = (path: string) => {
    if (scope === "design") setDesignWorkspace(path);
    else setWorkspace(path);
    setActiveConversation(null);
  };
  const selectWorkspace = (path: string) => {
    if (scope === "design") {
      setDesignWorkspace(path);
      if (activeId) moveConversationToWorkspace(activeId, path);
    } else setWorkspace(path);
  };
  const addWorkspace = async () => {
    if (scope !== "agent" && scope !== "design") return;
    setAdding(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, title: scope === "design" ? "Select design directory" : "Select project directory" });
      if (!picked || typeof picked !== "string") return;
      if (scope === "design") {
        addDesignWorkspace(picked);
        setDesignWorkspace(picked);
        if (activeId) moveConversationToWorkspace(activeId, picked);
      } else {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("add_workspace", { path: picked });
        setWorkspace(picked);
        await agentWorkspaces.refresh();
      }
      useContextMenuStore.getState().expand(picked);
    } finally {
      setAdding(false);
    }
  };
  const removeWorkspace = async (path: string) => {
    const scoped = conversations.filter((c) => c.workspacePath === path && (scope === "design" ? c.mode === "design" : c.mode !== "design"));
    if (scoped.length && !window.confirm(`Remove "${path.split("/").pop()}"?\n\n${scoped.length} chat${scoped.length === 1 ? "" : "s"} will move to Personal.`)) return;
    scoped.forEach((conversation) => moveConversationToWorkspace(conversation.id, null));
    if (scope === "design") removeDesignWorkspace(path);
    else {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("remove_workspace", { path });
      if (workspacePath === path) setWorkspace(null);
      await agentWorkspaces.refresh();
    }
    closeMenu();
  };
  const revealWorkspace = async (path: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugin:shell|open", { path });
    } catch {
      try { await navigator.clipboard.writeText(path); } catch {}
    }
    closeMenu();
  };
  const copyWorkspace = async (path: string) => {
    try { await navigator.clipboard.writeText(path); } catch {}
    closeMenu();
  };
  const exportConversation = (id: string, format: "markdown" | "json") => {
    const conversation = conversations.find((item) => item.id === id);
    if (conversation) downloadExport(conversation, messages[id] ?? [], format);
    closeMenu();
  };

  return (
    <>
      <aside className="sidebar-surface relative flex h-full w-[244px] shrink-0 flex-col">
        <SidebarHeader
          actionLabel={scope === "notebook" ? "New notebook" : scope === "design" ? "New design" : "New chat"}
          actionIcon={scope === "notebook" ? NotebookPen : undefined}
          onAction={() => (scope === "notebook" ? createNotebook() : activeWorkspace ? newInWorkspace(activeWorkspace) : setActiveConversation(null))}
          search={scope === "notebook" ? undefined : {
            value: searchInput,
            focused: searchFocused,
            inputRef: searchRef,
            ariaLabel: scope === "chat" ? "Search conversations and messages" : scope === "design" ? "Search designs" : "Search project chats",
            placeholder: "Search conversations...",
            onChange: setSearchInput,
            onClear: () => setSearchInput(""),
            onFocusChange: setSearchFocused,
          }}
        />
        {scope === "chat" && <ConversationsSection conversations={filteredChat} activeId={activeId} streamingControllers={streamingControllers} searchQuery={searchInput} messageSearchResults={messageSearchResults} messageSearchLoading={messageSearchLoading} onSelectConversation={setActiveConversation} onRenameConversation={renameConversation} onNewChat={() => setActiveConversation(null)} />}
        {(scope === "agent" || scope === "design") && <WorkspaceSection scope={scope} workspaces={currentWorkspaces} conversations={conversations} activeWorkspacePath={activeWorkspace} activeConversationId={activeId} streamingControllers={streamingControllers} query={searchInput} adding={adding} onAddWorkspace={addWorkspace} onSelectWorkspace={selectWorkspace} onSelectConversation={(id, path) => { selectWorkspace(path); setActiveConversation(id); }} onNewInWorkspace={newInWorkspace} onRenameConversation={renameConversation} />}
        {scope === "notebook" && <NotebooksSection notebooks={notebooks} activeNotebookId={activeNotebookId} onSelectNotebook={setActiveNotebook} onRenameNotebook={renameNotebook} onNewNotebook={createNotebook} />}
        <SettingsFooter onOpenSettings={onOpenSettings} />
      </aside>
      <ContextMenu conversations={conversations} notebooks={notebooks} workspaces={currentWorkspaces} onExportConversation={exportConversation} onDeleteConversation={deleteConversation} onToggleArchiveConversation={setConversationArchived} onMoveConversation={moveConversationToWorkspace} onSelectWorkspace={selectWorkspace} onNewInWorkspace={newInWorkspace} onRevealWorkspace={revealWorkspace} onCopyWorkspace={copyWorkspace} onRemoveWorkspace={removeWorkspace} onDeleteNotebook={deleteNotebook} />
    </>
  );
}
