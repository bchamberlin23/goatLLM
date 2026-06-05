import type { RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import { Search, SquarePen, X } from "lucide-react";

interface SidebarHeaderProps {
  actionLabel: string;
  actionAriaLabel?: string;
  onAction: () => void;
  actionIcon?: LucideIcon;
  shortcutLabel?: string;
  search?: {
    value: string;
    focused: boolean;
    inputRef: RefObject<HTMLInputElement | null>;
    ariaLabel: string;
    placeholder: string;
    onChange: (value: string) => void;
    onClear: () => void;
    onFocusChange: (focused: boolean) => void;
  };
}

export function SidebarHeader({
  actionLabel,
  actionAriaLabel,
  onAction,
  actionIcon: ActionIcon = SquarePen,
  shortcutLabel = "⌘N",
  search,
}: SidebarHeaderProps) {
  const hasQuery = !!search?.value.trim();

  return (
    <>
      <div className="h-[46px] shrink-0" data-tauri-drag-region />
      <div className="flex flex-col gap-[1px] px-2">
        <button
          onClick={onAction}
          className="sidebar-action group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[#ececec] transition-all"
          aria-label={actionAriaLabel ?? actionLabel}
          title={actionAriaLabel ?? actionLabel}
        >
          <ActionIcon
            size={15}
            strokeWidth={1.75}
            className="text-[#c9c9c9] transition-colors group-hover:text-[#ececec]"
            aria-hidden="true"
          />
          <span className="flex-1 text-left text-[13px]">{actionLabel}</span>
          <span className="text-[10.5px] font-medium tracking-wide text-text-3">{shortcutLabel}</span>
        </button>
      </div>
      {search && (
        <div className="mt-2 px-2">
          <div className="sidebar-search flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all duration-150">
            <Search
              size={13}
              strokeWidth={1.75}
              className={`shrink-0 transition-colors ${search.focused || hasQuery ? "text-text-1" : "text-text-3"}`}
              aria-hidden="true"
            />
            <input
              ref={search.inputRef}
              type="text"
              role="searchbox"
              aria-label={search.ariaLabel}
              className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              placeholder={search.placeholder}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              onFocus={() => search.onFocusChange(true)}
              onBlur={() => search.onFocusChange(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  if (search.value) search.onClear();
                  else search.inputRef.current?.blur();
                }
              }}
            />
            {hasQuery ? (
              <button
                className="control-icon rounded p-0.5 transition-colors"
                onClick={search.onClear}
                aria-label="Clear search"
                title="Clear"
              >
                <X size={12} strokeWidth={2} />
              </button>
            ) : (
              <span className="tabular-nums text-[10px] font-medium tracking-wide text-text-3">⌘F</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
