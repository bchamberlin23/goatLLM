import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "../stores/chat";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  File as FileIcon,
  FileCode,
  RefreshCw,
} from "lucide-react";

// ── Types ──

interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

interface FileTreeNode {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  loaded: boolean;
  loading: boolean;
  children?: FileTreeNode[];
}

// ── Helpers ──

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["html", "htm", "css", "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "h", "cpp", "rb", "php", "swift", "kt"].includes(ext)) return FileCode;
  return FileIcon;
}

function buildTree(entries: DirEntry[], parentPath: string): FileTreeNode[] {
  return entries.map((e) => ({
    path: parentPath ? `${parentPath}/${e.name}` : e.name,
    name: e.name,
    isDir: e.is_dir,
    size: e.size,
    loaded: !e.is_dir,
    loading: false,
  }));
}

function injectChildren(tree: FileTreeNode[], targetPath: string, children: FileTreeNode[]): FileTreeNode[] {
  return tree.map((node) => {
    if (node.path === targetPath) return { ...node, children, loaded: true, loading: false };
    if (node.isDir && node.children) {
      return { ...node, children: injectChildren(node.children, targetPath, children) };
    }
    return node;
  });
}

function markLoading(tree: FileTreeNode[], targetPath: string): FileTreeNode[] {
  return tree.map((node) => {
    if (node.path === targetPath) return { ...node, loading: true };
    if (node.isDir && node.children) {
      return { ...node, children: markLoading(node.children, targetPath) };
    }
    return node;
  });
}

// ── FileTreeNode renderer ──

function FileNode({
  node,
  depth,
  expanded,
  onToggle,
  onSelect,
  selectedPath,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string, name: string) => void;
  selectedPath: string | null;
}) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const Icon = node.isDir
    ? isExpanded ? FolderOpen : Folder
    : fileIcon(node.name);

  return (
    <>
      <button
        type="button"
        onClick={() => node.isDir ? onToggle(node.path) : onSelect(node.path, node.name)}
        className={`flex items-center gap-1.5 w-full text-left py-[3px] px-2 rounded-md text-[12px] transition-colors ${
          isSelected
            ? "bg-accent/10 text-accent"
            : "text-text-2 hover:bg-white/5 hover:text-text-1"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.isDir && (
          <ChevronRight
            size={10}
            strokeWidth={2}
            className={`shrink-0 text-text-4 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
          />
        )}
        <Icon size={13} strokeWidth={1.75} className={node.isDir ? "text-text-4 shrink-0" : "text-text-4 shrink-0"} />
        <span className="truncate">{node.name}</span>
        {node.loading && <span className="text-[10px] text-text-4 ml-auto">…</span>}
      </button>
      {isExpanded && node.children && node.children.map((child) => (
        <FileNode
          key={child.path}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          selectedPath={selectedPath}
        />
      ))}
    </>
  );
}

// ── Main exported component ──

interface WorkspaceFileBrowserProps {
  onFileContent: (path: string, name: string, content: string) => void;
  refreshKey?: number;
}

export function WorkspaceFileBrowser({ onFileContent, refreshKey }: WorkspaceFileBrowserProps) {
  const workspacePath = useChatStore((s) =>
    s.designMode ? s.designWorkspacePath : s.workspacePath
  );
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadRoot = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    setError(null);
    try {
      const entries: DirEntry[] = await invoke("list_dir", { workspace: workspacePath, path: "" });
      if (!mountedRef.current) return;
      setTree(buildTree(entries, ""));
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    setTree([]);
    setExpanded(new Set());
    setSelectedPath(null);
    if (workspacePath) loadRoot();
  }, [workspacePath, loadRoot]);

  // Refresh when refreshKey changes (tool calls modify files)
  useEffect(() => {
    if (refreshKey && workspacePath) loadRoot();
  }, [refreshKey, workspacePath, loadRoot]);

  const toggleExpand = useCallback(async (path: string) => {
    if (expanded.has(path)) {
      setExpanded((prev) => { const n = new Set(prev); n.delete(path); return n; });
      return;
    }
    setExpanded((prev) => new Set(prev).add(path));
    const findNode = (nodes: FileTreeNode[]): FileTreeNode | undefined => {
      for (const n of nodes) {
        if (n.path === path) return n;
        if (n.children) { const found = findNode(n.children); if (found) return found; }
      }
      return undefined;
    };
    const node = findNode(tree);
    if (node && !node.loaded && !node.loading) {
      setTree((prev) => markLoading(prev, path));
      try {
        const entries: DirEntry[] = await invoke("list_dir", { workspace: workspacePath!, path });
        if (!mountedRef.current) return;
        setTree((prev) => injectChildren(prev, path, buildTree(entries, path)));
      } catch {
        if (mountedRef.current) setTree((prev) => injectChildren(prev, path, []));
      }
    }
  }, [expanded, tree, workspacePath]);

  const selectFile = useCallback(async (path: string, name: string) => {
    if (!workspacePath) return;
    setSelectedPath(path);
    try {
      const content = await invoke<string>("read_file", { workspace: workspacePath, path });
      onFileContent(path, name, content);
    } catch (e) {
      console.warn("[WorkspaceFileBrowser] Failed to read", path, e);
    }
  }, [workspacePath, onFileContent]);

  if (!workspacePath) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-text-4 px-4 text-center">
        Select a workspace to browse files
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-hairline">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-text-4 font-semibold">
          Files
        </span>
        <button
          onClick={loadRoot}
          disabled={loading}
          className="p-1 rounded text-text-4 hover:text-text-1 hover:bg-white/5 transition-colors"
          aria-label="Refresh file tree"
        >
          <RefreshCw size={11} strokeWidth={2} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {error && (
          <div className="px-2 py-1.5 text-[11px] text-error">{error}</div>
        )}
        {tree.length === 0 && !loading && !error && (
          <div className="px-2 py-3 text-[11px] text-text-4">Empty workspace</div>
        )}
        {tree.map((node) => (
          <FileNode
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggleExpand}
            onSelect={selectFile}
            selectedPath={selectedPath}
          />
        ))}
      </div>
    </div>
  );
}
