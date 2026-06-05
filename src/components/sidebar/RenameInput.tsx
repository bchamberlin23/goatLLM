import type { KeyboardEvent } from "react";

interface RenameInputProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  textSize?: "sm" | "md";
}

export function RenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
  textSize = "md",
}: RenameInputProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onCommit();
    if (event.key === "Escape") onCancel();
  };

  return (
    <div className="px-2 py-1">
      <input
        className={`h-8 w-full rounded-md border border-hairline bg-sunken px-2 text-text-1 outline-none transition-colors focus:border-hairline-strong ${textSize === "sm" ? "text-[12px]" : "text-[13px]"}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleKeyDown}
        autoFocus
      />
    </div>
  );
}
