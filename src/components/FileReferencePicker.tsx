import { useState, useEffect, useRef, useMemo } from "react";
import { File, Folder, Search } from "lucide-react";

interface FileEntry {
  path: string;
  isDir: boolean;
}

interface FileReferencePickerProps {
  workspace: string;
  query: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

/**
 * Dropdown picker for @ file references. Shows when user types @ in the input.
 * Fuzzy-searches workspace files and inserts the selected path.
 */
export function FileReferencePicker({
  workspace,
  query,
  onSelect,
  onClose,
  position,
}: FileReferencePickerProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Load files from workspace
  useEffect(() => {
    let cancelled = false;
    const loadFiles = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{ files: string[] }>("list_dir", {
          workspace,
          path: ".",
          recursive: true,
        });
        if (cancelled) return;
        const entries: FileEntry[] = (result.files ?? [])
          .filter((f) => !f.startsWith("node_modules/") && !f.startsWith(".git/"))
          .map((f) => ({
            path: f,
            isDir: false,
          }));
        setFiles(entries);
      } catch {
        setFiles([]);
      } finally {
        setLoading(false);
      }
    };
    loadFiles();
    return () => { cancelled = true; };
  }, [workspace]);

  // Filter files by query
  const filtered = useMemo(() => {
    if (!query) return files.slice(0, 20);
    const lower = query.toLowerCase();
    return files
      .filter((f) => f.path.toLowerCase().includes(lower))
      .sort((a, b) => {
        // Prefer matches at the start
        const aStart = a.path.toLowerCase().startsWith(lower) ? 0 : 1;
        const bStart = b.path.toLowerCase().startsWith(lower) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return a.path.localeCompare(b.path);
      })
      .slice(0, 20);
  }, [files, query]);

  // Reset selection when filtered changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].path);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, selectedIndex, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (filtered.length === 0 && !loading) return null;

  return (
    <div
      className="popover-surface fixed z-[150] w-[320px] max-h-[240px] overflow-hidden rounded-xl animate-[fadeIn_100ms_ease]"
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <Search size={12} className="text-[#9a9a9a] shrink-0" />
        <span className="text-[11px] text-[#9a9a9a]">
          {loading ? "Loading files…" : `Files matching "${query || '*'}"`}
        </span>
      </div>
      <div ref={listRef} className="overflow-y-auto max-h-[200px] py-1">
        {filtered.map((file, i) => (
          <button
            key={file.path}
            className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-[12.5px] transition-colors ${
              i === selectedIndex
                ? "bg-white/[0.08] text-[#ececec]"
                : "text-[#d5d5d5] hover:bg-white/[0.05]"
            }`}
            onClick={() => onSelect(file.path)}
            onMouseEnter={() => setSelectedIndex(i)}
          >
            {file.isDir ? (
              <Folder size={13} className="text-[#a0a0a0] shrink-0" />
            ) : (
              <File size={13} className="text-[#a0a0a0] shrink-0" />
            )}
            <span className="truncate">{file.path}</span>
          </button>
        ))}
      </div>
      <div className="px-3 py-1.5 border-t border-white/[0.06] bg-white/[0.02]">
        <span className="text-[10px] text-[#888]">
          ↑↓ navigate · Tab/Enter select · Esc dismiss
        </span>
      </div>
    </div>
  );
}
