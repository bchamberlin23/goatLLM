import type { MouseEvent, ReactNode } from "react";
import { ChevronDown, Folder, FolderOpen, MoreHorizontal, SquarePen } from "lucide-react";

export function formatTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0" aria-label="Generating" title="Generating response">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="sidebar-theme-accent" />
      </svg>
    </span>
  );
}

function Title({ title, generating }: { title: string; generating?: boolean }) {
  if (generating && title === "New Conversation") {
    return (
      <span aria-label="Generating title" className="relative inline-block h-[10px] w-[110px] overflow-hidden rounded-[3px] bg-white/[0.05]">
        <span aria-hidden className="absolute inset-0 -translate-x-full animate-[title-shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </span>
    );
  }
  return title;
}

interface TreeItemProps {
  title: string;
  active?: boolean;
  inset?: boolean;
  metadata?: ReactNode;
  isStreaming?: boolean;
  isGeneratingTitle?: boolean;
  menuLabel: string;
  onClick: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onMenuClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function TreeItem({
  title,
  active = false,
  inset = false,
  metadata,
  isStreaming = false,
  isGeneratingTitle = false,
  menuLabel,
  onClick,
  onContextMenu,
  onMenuClick,
}: TreeItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`sidebar-action group relative flex h-8 w-full cursor-pointer items-center justify-between rounded-md py-1 text-left text-[13px] transition-all duration-150 ${inset ? "pl-2 pr-2" : "pl-6 pr-2"} ${active ? "sidebar-action-active" : "text-[#d5d5d5] hover:text-text-1"}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onContextMenu={onContextMenu}
    >
      {active && !inset && <span aria-hidden className="sidebar-active-marker absolute left-2 top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full" />}
      <span className="min-w-0 flex-1 truncate">
        <Title title={title} generating={isGeneratingTitle} />
      </span>
      <div className="ml-2 flex shrink-0 items-center gap-1">
        {isStreaming ? <Spinner /> : <span className="tabular-nums text-[11px] text-text-3 group-hover:hidden">{metadata}</span>}
        <button
          className="control-icon hidden rounded p-1 transition-colors group-hover:flex"
          onClick={onMenuClick}
          aria-label={menuLabel}
          title="More"
        >
          <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface WorkspaceTreeItemProps {
  name: string;
  path: string;
  active: boolean;
  expanded: boolean;
  count: number;
  lastActivity?: number;
  onSelect: () => void;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  onNew: (event: MouseEvent<HTMLButtonElement>) => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  newLabel: string;
}

export function WorkspaceTreeItem({
  name,
  path,
  active,
  expanded,
  count,
  lastActivity,
  onSelect,
  onToggle,
  onNew,
  onMenu,
  onContextMenu,
  newLabel,
}: WorkspaceTreeItemProps) {
  const Icon = expanded ? FolderOpen : Folder;

  return (
    <div
      className={`group/proj flex h-8 cursor-pointer items-center gap-2 rounded-md py-1.5 pl-2 pr-1 transition-colors ${active ? "sidebar-action-active" : "sidebar-action hover:text-text-1"}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={path}
    >
      <button
        type="button"
        className="control-icon -ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors"
        onClick={onToggle}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
        aria-expanded={expanded}
        title={expanded ? "Collapse" : "Expand"}
      >
        <ChevronDown size={11} strokeWidth={2} className={`text-text-4 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden="true" />
      </button>
      <Icon size={14} strokeWidth={1.5} className={`shrink-0 ${active ? "sidebar-theme-accent" : "text-text-4"}`} aria-hidden="true" />
      <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? "font-medium text-text-1" : "text-[#d5d5d5]"}`}>
        {name}
      </span>
      {count > 0 && (
        <span
          className="tabular-nums shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-text-4 group-hover/proj:hidden"
          title={`${count} chat${count === 1 ? "" : "s"}${lastActivity ? ` · last ${formatTimestamp(lastActivity)}` : ""}`}
        >
          {count}
        </span>
      )}
      <div className="hidden shrink-0 items-center gap-0.5 group-hover/proj:flex">
        <button className="control-icon flex h-5 w-5 items-center justify-center rounded transition-colors" onClick={onNew} aria-label={newLabel} title={newLabel}>
          <SquarePen size={12} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button className="control-icon flex h-5 w-5 items-center justify-center rounded transition-colors" onClick={onMenu} aria-label={`Project actions for ${name}`} title="More">
          <MoreHorizontal size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
