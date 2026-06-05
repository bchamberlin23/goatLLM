import { useState, useCallback } from "react";
import { Plus, Check, EyeOff, Eye, X } from "lucide-react";

export function TavilyKeyRow({
  apiKey,
  onSave,
  onRemove,
  serviceName = "Tavily Search",
  host = "api.tavily.com",
  placeholder = "tvly-...",
}: {
  apiKey: string;
  onSave: (key: string) => void;
  onRemove: () => void;
  serviceName?: string;
  host?: string;
  placeholder?: string;
}) {
  const [key, setKey] = useState(apiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const hasKey = !!apiKey;
  const trimmed = key.trim();
  const isDirty = trimmed !== (apiKey ?? "");
  const canSave = trimmed.length > 0 && isDirty;

  const handleSave = useCallback(() => {
    const t = key.trim();
    if (!t) return;
    onSave(t);
    setIsEditing(false);
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1200);
  }, [key, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") { setKey(apiKey ?? ""); setIsEditing(false); }
  }, [handleSave, apiKey]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").trim();
    if (pasted && pasted !== (apiKey ?? "")) {
      e.preventDefault();
      setKey(pasted);
      onSave(pasted);
      setIsEditing(false);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1200);
    }
  }, [apiKey, onSave]);

  return (
    <div className={`flex items-center justify-between gap-3 p-3.5 bg-surface-3 border rounded-xl transition-colors ${hasKey ? "border-green-500/20" : "border-white/5"}`}>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-medium text-text-1">{serviceName}</span>
          <span className={`flex items-center gap-1.5 text-[11px] ${hasKey ? "text-success" : "text-text-3"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${hasKey ? "bg-success" : "bg-text-4"}`} />
            {justSaved ? "Saved" : hasKey ? "Configured" : "Not configured"}
          </span>
        </div>
        <span className="text-[11px] text-text-3 font-mono">{host}</span>
      </div>

      <div className="shrink-0">
        {!hasKey && !isEditing ? (
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-text-2 bg-white/5 rounded-lg hover:bg-white/10 hover:text-text-1 transition-colors" onClick={() => setIsEditing(true)}>
            <Plus size={12} strokeWidth={2} />
            Add Key
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type={showKey ? "text" : "password"}
              className="w-[200px] h-[30px] px-2.5 bg-surface-2 border border-white/5 rounded-md text-[12px] text-text-1 font-mono outline-none focus:border-white/15"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              autoFocus={isEditing}
              aria-label={`${serviceName} API key`}
            />
            <button
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${canSave ? "text-success hover:bg-success/10" : "text-text-4 cursor-not-allowed"}`}
              onClick={handleSave}
              disabled={!canSave}
              aria-label={`Save ${serviceName} key`}
              title="Save (Enter)"
            >
              <Check size={14} strokeWidth={2.2} aria-hidden="true" />
            </button>
            <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-text-1 hover:bg-white/5 transition-colors" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? `Hide ${serviceName} key` : `Show ${serviceName} key`}>
              {showKey ? <EyeOff size={14} strokeWidth={1.5} aria-hidden="true" /> : <Eye size={14} strokeWidth={1.5} aria-hidden="true" />}
            </button>
            <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-3 hover:text-error hover:bg-red-500/10 transition-colors" onClick={() => { setKey(""); onRemove(); setIsEditing(false); }} aria-label={`Remove ${serviceName} key`}>
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
