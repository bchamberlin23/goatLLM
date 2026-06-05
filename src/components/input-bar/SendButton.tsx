import { ArrowUp, Square } from "lucide-react";

interface SendButtonProps {
  value: string;
  canSend: boolean;
  isStreaming: boolean;
  onSend: () => void;
  onCancel: () => void;
}

export function SendButton({ value, canSend, isStreaming, onSend, onCancel }: SendButtonProps) {
  const hasInput = value.trim().length > 0;
  const showStop = isStreaming && !hasInput;
  const disabled = !isStreaming && !canSend;

  return (
    <button onClick={showStop ? onCancel : onSend} disabled={disabled} aria-label={showStop ? "Stop generating" : "Send message"} className={["ml-1 w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-all duration-200", showStop ? "bg-text-1 hover:bg-[#f4f0e9] scale-100" : disabled ? "bg-white/[0.08] border border-white/[0.06] cursor-not-allowed scale-95 opacity-70" : "primary-action hover:scale-[1.04] active:scale-95"].join(" ")} type="button">
      {showStop ? <Square size={11} strokeWidth={2.5} className="text-[#2d2d2d]" aria-hidden="true" /> : <ArrowUp size={16} strokeWidth={2.4} className={disabled ? "text-[#a0a0a0]" : "text-[#1a1a1c]"} aria-hidden="true" />}
    </button>
  );
}
