import { X } from "lucide-react";

interface ComposerErrorBannerProps {
  message: string | null;
  onDismiss: () => void;
}

export function ComposerErrorBanner({ message, onDismiss }: ComposerErrorBannerProps) {
  if (!message) return null;

  return (
    <div className="motion-reveal flex items-center gap-2 mb-3 px-3 py-2 bg-[#f87171]/[0.055] border border-[#f87171]/20 rounded-lg text-[12.5px] text-[#fca5a5]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#f87171] shrink-0" aria-hidden="true" />
      <span className="flex-1 leading-relaxed">{message}</span>
      <button onClick={onDismiss} className="control-icon p-1 rounded transition-colors" aria-label="Dismiss" type="button">
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  );
}
