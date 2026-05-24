import { useState, useEffect, useCallback } from "react";
import { useChatStore } from "../../stores/chat";

export function SystemPromptSection() {
  const activeId = useChatStore((s) => s.activeId);
  const conversation = useChatStore((s) =>
    activeId ? s.conversations.find((c) => c.id === activeId) : null
  );
  const setSystemPrompt = useChatStore((s) => s.setSystemPrompt);
  const defaultSystemPrompt = useChatStore((s) => s.defaultSystemPrompt);
  const setDefaultSystemPrompt = useChatStore((s) => s.setDefaultSystemPrompt);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (activeId && conversation) {
      setDraft(conversation.systemPrompt ?? "");
    } else {
      setDraft(defaultSystemPrompt);
    }
    setSaved(false);
  }, [activeId, conversation?.systemPrompt, defaultSystemPrompt]);

  const handleSave = useCallback(() => {
    if (activeId) {
      setSystemPrompt(activeId, draft);
    } else {
      setDefaultSystemPrompt(draft);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [activeId, draft, setSystemPrompt, setDefaultSystemPrompt]);

  const label = activeId
    ? "System prompt for this conversation"
    : "Default system prompt for new conversations";

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="w-full bg-[#212122] border border-white/5 rounded-xl text-[13px] text-[#ececec] p-3.5 outline-none resize-none min-h-[80px] focus:border-white/10 placeholder:text-[#a0a0a0]"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="You are a helpful assistant…"
        rows={3}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#a0a0a0]">
          {label} · {draft.length > 0 ? `${draft.length} chars` : "Empty"}
        </span>
        <button
          onClick={handleSave}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
            saved
              ? "bg-[#34d399]/10 text-[#34d399]"
              : "bg-white text-black hover:bg-[#e5e5e5]"
          }`}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}
