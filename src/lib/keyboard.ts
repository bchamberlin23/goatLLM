/**
 * Global keyboard shortcut handler. Wired into App.tsx so shortcuts
 * are available regardless of which component has focus — including
 * when typing in the chat textarea.
 *
 * Shortcuts:
 *   ⌘N        — New chat
 *   ⌘F        — Focus chat input
 *   ⌘B        — Toggle sidebar
 *   ⌘,        — Open settings
 *   ⌘1..9     — Switch to conversation N
 *   ⌘\        — Toggle agent mode
 *   ⌘.        — Stop streaming (active conversation)
 */

import { useEffect } from "react";
import { useChatStore } from "../stores/chat";

interface Options {
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  isSettingsOpen: boolean;
  onFocusInput?: () => void;
}

export function useKeyboardShortcuts({
  onOpenSettings,
  onCloseSettings,
  isSettingsOpen,
  onFocusInput,
}: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // Esc — closes settings if open. (Settings.tsx already binds this
      // when mounted; we keep it here as a backstop for safety.)
      if (e.key === "Escape" && isSettingsOpen) {
        e.preventDefault();
        onCloseSettings();
        return;
      }

      // All other shortcuts require Cmd/Ctrl.
      if (!meta) return;

      // ⌘, — open settings (works even while typing).
      if (e.key === ",") {
        e.preventDefault();
        if (isSettingsOpen) onCloseSettings();
        else onOpenSettings();
        return;
      }

      // ⌘N — new chat. Works everywhere including while typing.
      if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        useChatStore.getState().setActiveConversation(null);
        return;
      }

      // ⌘F — focus chat input. Always available.
      if (e.key === "f" && !e.shiftKey) {
        e.preventDefault();
        onFocusInput?.();
        return;
      }

      // ⌘B — toggle sidebar.
      if (e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        useChatStore.getState().toggleSidebar();
        return;
      }

      // ⌘\ — toggle agent mode.
      if (e.key === "\\") {
        e.preventDefault();
        useChatStore.getState().toggleAgentMode();
        return;
      }

      // ⌘. — stop streaming. Always available.
      if (e.key === ".") {
        e.preventDefault();
        useChatStore.getState().cancelStreaming();
        return;
      }

      // ⌘1..9 — switch to conversation N. Works everywhere.
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const convs = useChatStore.getState().conversations;
        if (convs[idx]) {
          useChatStore.getState().setActiveConversation(convs[idx].id);
        }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenSettings, onCloseSettings, isSettingsOpen, onFocusInput]);
}
