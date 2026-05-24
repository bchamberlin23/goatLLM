import { useState, useEffect, useCallback, useRef } from "react";
import { useChatStore, type Attachment } from "../stores/chat";
import { ChevronRight, Folder, FolderOpen, File as FileIcon, FileCode, FileText, Image as ImageIcon, Loader2, RefreshCw, AlertCircle } from "lucide-react";

// ── Directory entry from Tauri list_dir ──

interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

/** Best-effort MIME type from extension, frontend mirror of the Rust fn. */
function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "bmp": return "image/bmp";
    case "ico": return "image/x-icon";
    case "avif": return "image/avif";
    case "pdf": return "application/pdf";
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "ogg": return "audio/ogg";
    case "mp4": return "video/mp4";
    case "webm": return "video/webm";
    case "mov": return "video/quicktime";
    case "woff": return "font/woff";
    case "woff2": return "font/woff2";
    case "ttf": return "font/ttf";
    case "otf": return "font/otf";
    case "html": case "htm": return "text/html";
    case "css": return "text/css";
    case "js": return "application/javascript";
    case "json": return "application/json";
    case "xml": return "application/xml";
    case "yaml": case "yml": return "application/yaml";
    case "md": case "markdown": return "text/markdown";
    case "py": return "text/x-python";
    case "rs": return "text/x-rust";
    case "go": return "text/x-go";
    case "ts": case "tsx": return "text/typescript";
    case "java": return "text/x-java";
    case "c": return "text/x-c";
    case "h": case "hpp": case "cpp": case "cc": return "text/x-c++";
    default: return "application/octet-stream";
  }
}

function getFileIcon(filename: string, isDir: boolean) {
  if (isDir) return Folder;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
  if (imageExts.has(ext)) return ImageIcon;
  if (ext === "pdf") return FileText;
  const codeExts = new Set(["ts", "tsx", "js", "jsx", "json", "py", "rs", "go", "rb", "java", "c", "cpp", "h", "hpp", "css", "scss", "html", "htm", "xml", "yaml", "yml", "toml", "md", "sh", "sql", "swift", "kt"]);
  if (codeExts.has(ext)) return FileCode;
  const docExts = new Set(["md", "markdown", "txt", "log", "csv"]);
  if (docExts.has(ext)) return FileText;
  return FileIcon;
}

function getIconColor(filename: string, isDir: boolean): string {
  if (isDir) return "#60a5fa";
  if (filename.endsWith(".html") || filename.endsWith(".htm")) return "#f59e42";
  if (filename.endsWith(".css") || filename.endsWith(".scss")) return "#60a5fa";
  if (filename.endsWith(".py")) return "#34d399";
  if (filename.endsWith(".rs")) return "#f59e42";
  if (filename.endsWith(".ts") || filename.endsWith(".tsx") || filename.endsWith(".js")) return "#a78bfa";
  if (filename.endsWith(".json")) return "#fbbf24";
  if (filename.endsWith(".md")) return "#60a5fa";
  return "#a0a0a0";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Tree node ──

interface TreeNode {
  path: string;   // relative to workspace
  name: string;
  isDir: boolean;
  size: number;
  children?: TreeNode[];
  loaded: boolean;
  loading: boolean;
  error?: string;
}

function buildRootNode(entries: DirEntry[], relPath: string): TreeNode[] {
  return entries.map((e) => ({
    path: relPath ? `${relPath}/${e.name}` : e.name,
    name: e.name,
    isDir: e.is_dir,
    size: e.size,
    loaded: !e.is_dir,
    loading: false,
  }));
}

// ── Component ──

interface WorkspaceFileTreeProps {
  /** Called when the user clicks a file to open it in the side panel. */
  onOpenFile: (a: Attachment) => void;
}

export function WorkspaceFileTree({ onOpenFile }: WorkspaceFileTreeProps) {
  const workspacePath = useChatStore((s) => s.workspacePath);
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
      const { invoke } = await import("@tauri-apps/api/core");
      const entries: DirEntry[] = await invoke("list_dir", { workspace: workspacePath, path: "" });
      if (!mountedRef.current) return;
      setRoots(buildRootNode(entries, ""));
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    setRoots([]);
    setExpanded(new Set());
    if (workspacePath) loadRoot();
  }, [workspacePath, loadRoot]);

  const toggleExpand = useCallback(async (nodePath: string) => {
    // Expanded → collapse
    if (expanded.has(nodePath)) {
      setExpanded((prev) => { const n = new Set(prev); n.delete(nodePath); return n; });
      return;
    }
    // Collapsed → fetch children then expand
    setExpanded((prev) => new Set(prev).add(nodePath));
    // Inject children into the tree
    setRoots((prev) => toggleAndLoadChildren(prev, nodePath, workspacePath!, mountedRef));
  }, [expanded, workspacePath]);

  /**
   * Avoids races: load children for a path inside the root tree, marking the
   * node as loading then loaded. Returns the updated tree.
   */
  function toggleAndLoadChildren(
    tree: TreeNode[],
    targetPath: string,
    ws: string,
    mounted: React.MutableRefObject<boolean>,
  ): TreeNode[] {
    return tree.map((node) => {
      if (node.path !== targetPath) {
        if (node.isDir && node.loaded && node.children) {
          return { ...node, children: toggleAndLoadChildren(node.children, targetPath, ws, mounted) };
        }
        return node;
      }
      // Found the target. If already loaded, no-op.
      if (node.loaded) return node;
      // Kick off an async load and mark as loading.
      (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const entries: DirEntry[] = await invoke("list_dir", { workspace: ws, path: node.path });
          if (!mounted.current) return;
          setRoots((prev) => injectChildren(prev, node.path, buildRootNode(entries, node.path)));
        } catch (e) {
          if (!mounted.current) return;
          const errMsg = e instanceof Error ? e.message : String(e);
          setRoots((prev) => injectError(prev, node.path, errMsg));
        }
      })();
      return { ...node, loading: true };
    });
  }

  function injectChildren(tree: TreeNode[], targetPath: string, children: TreeNode[]): TreeNode[] {
    return tree.map((n) => {
      if (n.path !== targetPath) {
        if (n.children) return { ...n, children: injectChildren(n.children, targetPath, children) };
        return n;
      }
      return { ...n, loading: false, loaded: true, children };
    });
  }

  function injectError(tree: TreeNode[], targetPath: string, err: string): TreeNode[] {
    return tree.map((n) => {
      if (n.path !== targetPath) {
        if (n.children) return { ...n, children: injectError(n.children, targetPath, err) };
        return n;
      }
      return { ...n, loading: false, loaded: true, error: err };
    });
  }

  const handleOpenFile = useCallback(async (node: TreeNode) => {
    if (node.isDir) {
      toggleExpand(node.path);
      return;
    }
    // Open the file in the attachment panel.
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const mime = guessMimeType(node.name);

      if (mime.startsWith("image/") || mime === "application/pdf" ||
          mime.startsWith("audio/") || mime.startsWith("video/") ||
          mime.startsWith("font/")) {
        // Binary file — use read_file_bytes which returns a base64 data URL.
        const dataUrl: string = await invoke("read_file_bytes", { workspace: workspacePath, path: node.path });
        onOpenFile({
          filename: node.name,
          mimeType: mime,
          dataUrl,
          sizeBytes: node.size,
        });
      } else {
        // Text-like file — read as string, convert to data URL.
        const content: string = await invoke("read_file", { workspace: workspacePath, path: node.path, offset: null, limit: null });
        const dataUrl = `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
        onOpenFile({
          filename: node.name,
          mimeType: mime,
          dataUrl,
          sizeBytes: new Blob([content]).size,
        });
      }
    } catch (e) {
      console.warn(`[WorkspaceFileTree] Failed to open ${node.path}:`, e);
    }
  }, [workspacePath, onOpenFile, toggleExpand]);

  if (!workspacePath) return null;

  return (
    <div className="p-1.5">
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="text-[10.5px] uppercase tracking-wider text-[#8e8e8e] font-semibold">
          Workspace files
        </span>
        <button
          onClick={loadRoot}
          disabled={loading}
          className="p-0.5 rounded text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={11} strokeWidth={2} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && roots.length === 0 && (
        <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-[#a0a0a0]">
          <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          Loading…
        </div>
      )}

      {error && roots.length === 0 && (
        <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-[#f87171]">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {roots.length === 0 && !loading && !error && (
        <div className="px-2.5 py-2 text-[11px] text-[#a0a0a0]">Empty workspace</div>
      )}

      {roots.length > 0 && (
        <div className="space-y-0.5">
          {roots.map((node) => (
            <FileTreeRow
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggleExpand}
              onOpen={handleOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recursive row ──

function FileTreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (node: TreeNode) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const Icon = getFileIcon(node.name, node.isDir);
  const color = getIconColor(node.name, node.isDir);
  const padLeft = 12 + depth * 14;

  return (
    <>
      <button
        onClick={() => node.isDir ? onToggle(node.path) : onOpen({ ...node })}
        className={`flex items-center gap-1.5 w-full rounded-md text-left hover:bg-white/[0.06] transition-colors py-1.5`}
        style={{ paddingLeft: padLeft, paddingRight: 10 }}
      >
        {/* Expand/collapse chevron for directories */}
        {node.isDir ? (
          <ChevronRight
            size={10}
            strokeWidth={2.5}
            className={`shrink-0 text-[#666] transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
        ) : (
          <span className="w-[10px] shrink-0" />
        )}
        {/* Loading spinner */}
        {node.loading ? (
          <Loader2 size={12} strokeWidth={2} className="animate-spin shrink-0 text-[#a0a0a0]" />
        ) : node.isDir && isExpanded ? (
          <FolderOpen size={13} strokeWidth={1.5} style={{ color }} className="shrink-0" />
        ) : (
          <Icon size={13} strokeWidth={1.5} style={{ color }} className="shrink-0" />
        )}
        <span className="text-[12px] text-[#d5d5d5] truncate flex-1 leading-tight">{node.name}</span>
        {!node.isDir && node.size > 0 && (
          <span className="text-[9.5px] text-[#666] shrink-0 tabular-nums">{formatSize(node.size)}</span>
        )}
      </button>
      {/* Error indicator */}
      {node.error && (
        <div
          className="flex items-center gap-1.5 py-1 text-[10px] text-[#f87171]"
          style={{ paddingLeft: padLeft + 18 }}
        >
          <AlertCircle size={10} />
          {node.error}
        </div>
      )}
      {/* Expanded children */}
      {node.isDir && isExpanded && node.children && (
        <>
          {node.children.map((child) => (
            <FileTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </>
      )}
    </>
  );
}
