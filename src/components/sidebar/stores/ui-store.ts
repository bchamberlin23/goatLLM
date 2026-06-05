import { create } from "zustand";

export type SidebarScope = "chat" | "agent" | "design";

export interface MenuPosition {
  x: number;
  y: number;
}

export type SidebarMenu =
  | ({ type: "conversation"; conversationId: string; scope: SidebarScope } & MenuPosition)
  | ({ type: "workspace"; workspacePath: string; scope: Exclude<SidebarScope, "chat"> } & MenuPosition)
  | ({ type: "notebook"; notebookId: string } & MenuPosition);

export type RenameTarget =
  | { type: "conversation"; id: string; value: string }
  | { type: "notebook"; id: string; value: string };

interface ContextMenuStore {
  expanded: Record<string, boolean>;
  menu: SidebarMenu | null;
  moveMenuFor: string | null;
  renaming: RenameTarget | null;
  toggleExpanded: (key: string) => void;
  expand: (key: string) => void;
  openConversationMenu: (menu: Extract<SidebarMenu, { type: "conversation" }>) => void;
  openWorkspaceMenu: (menu: Extract<SidebarMenu, { type: "workspace" }>) => void;
  openNotebookMenu: (menu: Extract<SidebarMenu, { type: "notebook" }>) => void;
  closeMenu: () => void;
  toggleMoveMenu: (conversationId: string) => void;
  startRenaming: (target: RenameTarget) => void;
  updateRenameValue: (value: string) => void;
  cancelRenaming: () => void;
  reset: () => void;
}

export const useContextMenuStore = create<ContextMenuStore>((set) => ({
  expanded: {},
  menu: null,
  moveMenuFor: null,
  renaming: null,
  toggleExpanded: (key) =>
    set((state) => ({ expanded: { ...state.expanded, [key]: !state.expanded[key] } })),
  expand: (key) =>
    set((state) => (state.expanded[key] ? state : { expanded: { ...state.expanded, [key]: true } })),
  openConversationMenu: (menu) => set({ menu, moveMenuFor: null }),
  openWorkspaceMenu: (menu) => set({ menu, moveMenuFor: null }),
  openNotebookMenu: (menu) => set({ menu, moveMenuFor: null }),
  closeMenu: () => set({ menu: null, moveMenuFor: null }),
  toggleMoveMenu: (conversationId) =>
    set((state) => ({ moveMenuFor: state.moveMenuFor === conversationId ? null : conversationId })),
  startRenaming: (target) => set({ renaming: target, menu: null, moveMenuFor: null }),
  updateRenameValue: (value) =>
    set((state) => (state.renaming ? { renaming: { ...state.renaming, value } } : state)),
  cancelRenaming: () => set({ renaming: null }),
  reset: () => set({ expanded: {}, menu: null, moveMenuFor: null, renaming: null }),
}));
