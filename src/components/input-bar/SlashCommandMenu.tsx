import type { SlashCommandDefinition } from "../../lib/slash-commands";

interface SlashCommandMenuProps {
  commands: SlashCommandDefinition[];
  activeIndex: number;
  onSelect: (command: SlashCommandDefinition) => void;
}

export function SlashCommandMenu({ commands, activeIndex, onSelect }: SlashCommandMenuProps) {
  if (commands.length === 0) return null;

  return (
    <div
      aria-label="Slash commands"
      className="popover-surface motion-popover-in absolute bottom-full left-5 mb-2 w-72 rounded-xl p-1.5 z-[90] origin-bottom-left"
      role="listbox"
    >
      {commands.map((command, index) => {
        const selected = index === activeIndex;
        return (
          <button
            key={command.name}
            aria-selected={selected}
            className={[
              "motion-row flex w-full items-start justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors duration-[120ms]",
              selected ? "bg-white/[0.075] text-text-1" : "text-text-1 hover:bg-white/[0.065]",
            ].join(" ")}
            onClick={() => {
              onSelect(command);
            }}
            role="option"
            type="button"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{command.label}</span>
              <span className="mt-0.5 block truncate text-[11px] leading-tight text-text-2">
                {command.description}
              </span>
            </span>
            {command.argumentHint && (
              <span className="mt-0.5 shrink-0 rounded-sm border border-hairline bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-text-3">
                {command.argumentHint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
