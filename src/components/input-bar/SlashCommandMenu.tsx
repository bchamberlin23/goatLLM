export interface SlashCommandItem {
  id: string;
  label: string;
  description?: string;
  onSelect: () => void;
}

interface SlashCommandMenuProps {
  commands: SlashCommandItem[];
}

export function SlashCommandMenu({ commands }: SlashCommandMenuProps) {
  if (commands.length === 0) return null;

  return (
    <div className="popover-surface motion-popover-in absolute bottom-full left-5 mb-2 w-64 rounded-xl p-1.5 z-[90] origin-bottom-left">
      {commands.map((command) => (
        <button key={command.id} onClick={command.onSelect} className="motion-row flex w-full flex-col rounded-md px-2.5 py-2 text-left text-[13px] text-[#ececec] hover:bg-white/[0.065]" type="button">
          <span>{command.label}</span>
          {command.description && <span className="mt-0.5 truncate text-[11px] leading-tight text-[#b4b4b4]">{command.description}</span>}
        </button>
      ))}
    </div>
  );
}
