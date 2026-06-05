import { useMemo, type MouseEvent } from "react";
import { Notebook as NotebookIcon } from "lucide-react";
import type { Notebook } from "../../lib/canvas";
import { RenameInput } from "./RenameInput";
import { TreeItem, formatTimestamp } from "./TreeItem";
import { useContextMenuStore } from "./stores/ui-store";

interface NotebooksSectionProps {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  onSelectNotebook: (id: string) => void;
  onRenameNotebook: (id: string, name: string) => void;
  onNewNotebook: () => void;
}

function menuPoint(event: { clientX: number; clientY: number }, width: number, height: number) {
  return {
    x: Math.min(event.clientX, window.innerWidth - width - 8),
    y: Math.min(event.clientY, window.innerHeight - height - 8),
  };
}

function menuFromButton(event: MouseEvent<HTMLElement>, width: number, height: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(rect.left, window.innerWidth - width - 8),
    y: Math.min(rect.bottom + 4, window.innerHeight - height - 8),
  };
}

export function NotebooksSection({
  notebooks,
  activeNotebookId,
  onSelectNotebook,
  onRenameNotebook,
  onNewNotebook,
}: NotebooksSectionProps) {
  const openNotebookMenu = useContextMenuStore((state) => state.openNotebookMenu);
  const renaming = useContextMenuStore((state) => state.renaming);
  const updateRenameValue = useContextMenuStore((state) => state.updateRenameValue);
  const cancelRenaming = useContextMenuStore((state) => state.cancelRenaming);

  const sorted = useMemo(() => [...notebooks].sort((a, b) => b.updatedAt - a.updatedAt), [notebooks]);

  const commitRename = () => {
    if (!renaming || renaming.type !== "notebook") return;
    onRenameNotebook(renaming.id, renaming.value);
    cancelRenaming();
  };

  const openMenu = (event: MouseEvent<HTMLElement>, notebookId: string, fromButton = false) => {
    event.preventDefault();
    event.stopPropagation();
    openNotebookMenu({
      type: "notebook",
      notebookId,
      ...(fromButton ? menuFromButton(event, 180, 100) : menuPoint(event, 180, 100)),
    });
  };

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04]">
            <NotebookIcon size={15} strokeWidth={1.5} className="text-text-3" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-[12.5px] font-medium text-text-3">No notebooks yet</p>
            <p className="text-[11px] leading-relaxed text-text-3">Create one to start a board</p>
          </div>
          <button onClick={onNewNotebook} className="control-pill mt-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors">
            Create notebook
          </button>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="px-2.5 py-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-text-4">Notebooks</span>
          </div>
          {sorted.map((notebook) => {
            if (renaming?.type === "notebook" && renaming.id === notebook.id) {
              return (
                <RenameInput
                  key={notebook.id}
                  value={renaming.value}
                  onChange={updateRenameValue}
                  onCommit={commitRename}
                  onCancel={cancelRenaming}
                />
              );
            }
            const panelCount = notebook.panels.length;
            return (
              <TreeItem
                key={notebook.id}
                title={notebook.name}
                active={activeNotebookId === notebook.id}
                metadata={panelCount === 0 ? formatTimestamp(notebook.updatedAt) : `${panelCount} panel${panelCount === 1 ? "" : "s"}`}
                menuLabel="Notebook actions"
                onClick={() => onSelectNotebook(notebook.id)}
                onContextMenu={(event) => openMenu(event, notebook.id)}
                onMenuClick={(event) => openMenu(event, notebook.id, true)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
