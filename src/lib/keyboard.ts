/**
 * Global keyboard shortcut handler. Wired into App.tsx so shortcuts
 * are available regardless of which component has focus (with sane
 * exceptions for typing in inputs/textareas).
 *
 * Shortcuts:
 *   ⌘N        — New chat
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
}

export function useKeyboardShortcuts({
  onOpenSettings,
  onCloseSettings,
  isSettingsOpen,
}: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

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

      // ⌘N — new chat. Skip when typing so users can type lowercase n freely.
      if (e.key === "n" && !e.shiftKey && !isTyping) {
        e.preventDefault();
        useChatStore.getState().setActiveConversation(null);
        return;
      }

      // ⌘B — toggle sidebar. Works while typing too — common pattern.
      if (e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        useChatStore.getState().toggleSidebar();
        return;
      }

      // ⌘\ — toggle agent mode. Skip when typing.
      if (e.key === "\\" && !isTyping) {
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

      // ⌘1..9 — switch to conversation N. Skip when typing.
      if (!isTyping && /^[1-9]$/.test(e.key)) {
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
  }, [onOpenSettings, onCloseSettings, isSettingsOpen]);
}
