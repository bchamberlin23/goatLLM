import { useChatStore } from "../stores/chat";
import { InputBar } from "./InputBar";
import { MessageList } from "./MessageList";
import { WorkspacePicker } from "./WorkspacePicker";
import { ModeToggle } from "./ModeToggle";
import { ArtifactPanel } from "./ArtifactPanel";
import { TopBar } from "./TopBar";
import { Settings as SettingsIcon, ArrowRight } from "lucide-react";

export function ChatView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const rawMessages = useChatStore((s) =>
    s.activeId ? s.messages[s.activeId] : undefined
  );
  const messages = rawMessages ?? [];
  const agentMode = useChatStore((s) => s.agentMode);
  const artifactPanelOpen = useChatStore((s) => s.artifactPanelOpen);
  const getModels = useChatStore((s) => s.getModels);
  const _hydrated = useChatStore((s) => s._hydrated);
  const isEmpty = messages.length === 0;
  const availableModels = getModels().filter((m) => m.isAvailable);
  const needsSetup = _hydrated && availableModels.length === 0;

  return (
    <div className="flex flex-col h-full">
      <TopBar />
      {!isEmpty && (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden relative">
            <MessageList />
          </div>
          {artifactPanelOpen && (
            <div className="basis-[58%] grow-0 shrink-0 min-h-0 border-l border-white/5 flex flex-col overflow-hidden">
              <ArtifactPanel />
            </div>
          )}
        </div>
      )}

      <div
        className={`shrink-0 flex flex-col items-center gap-3 px-6 pb-6 w-full ${
          isEmpty ? "flex-1 justify-center gap-4" : "pt-2"
        }`}
      >
        {isEmpty && (
          <div className="flex flex-col items-center text-center mb-2 animate-[fadeIn_320ms_ease]">
            {!needsSetup && (
              <p className="mt-2 text-[13.5px] text-[#a0a0a0]">
                Type below or use <kbd className="font-mono text-[11px] px-1.5 py-px rounded bg-white/[0.06] border border-white/[0.06] text-[#b4b4b4]">⌘N</kbd> for a fresh chat.
              </p>
            )}
          </div>
        )}

        {isEmpty && needsSetup && (
          <div className="flex flex-col items-center gap-2 max-w-[480px] text-center animate-[fadeIn_320ms_ease]">
            <p className="text-[13px] text-[#a0a0a0] leading-relaxed">
              No models configured yet. Add an API key in Settings to start chatting.
            </p>
            <button
              onClick={onOpenSettings}
              className="group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#f59e42]/12 border border-[#f59e42]/25 text-[#f59e42] text-[12.5px] font-medium hover:bg-[#f59e42]/18 hover:border-[#f59e42]/40 transition-colors"
              aria-label="Open Settings to add a provider"
            >
              <SettingsIcon size={13} strokeWidth={2} aria-hidden="true" />
              Open Settings
              <ArrowRight size={13} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </div>
        )}

        <InputBar />

        {(isEmpty || agentMode) && (
          <div className="flex items-center flex-wrap gap-1.5 w-full max-w-[720px] px-1">
            {isEmpty && <ModeToggle />}
            {agentMode && <WorkspacePicker />}
          </div>
        )}
      </div>
    </div>
  );
}
