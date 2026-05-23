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
        className={`shrink-0 flex flex-col items-center w-full ${
          isEmpty ? "flex-1 justify-center px-6 pb-6 gap-3" : "pt-2 px-6 pb-6 gap-3"
        }`}
      >
        {isEmpty && (
          <div className="flex flex-col items-center text-center animate-[fadeIn_320ms_ease]">
            <div className="mb-3 flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-[#f59e42]/15 to-[#f59e42]/5 border border-[#f59e42]/15 shadow-[0_8px_24px_-12px_rgba(245,158,66,0.4)]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e42" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-1.5L12 2z" />
              </svg>
            </div>
            <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em] bg-gradient-to-b from-[#ffffff] to-[#b8b8b8] bg-clip-text text-transparent">
              goatLLM
            </h1>
            {needsSetup ? (
              <div className="mt-3 flex flex-col items-center gap-2 max-w-[480px]">
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
            ) : (
              <p className="mt-2 text-[13.5px] text-[#a0a0a0]">
                Type below or use <kbd className="font-mono text-[11px] px-1.5 py-px rounded bg-white/[0.06] border border-white/[0.06] text-[#b4b4b4] tabular-nums">⌘N</kbd> for a fresh chat.
              </p>
            )}
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
