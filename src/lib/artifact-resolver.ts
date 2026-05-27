/**
 * Resolve external file references in artifacts.
 *
 * When a file references external resources (CSS, JS, images, imports, etc.)
 * via relative paths, we inline them so the preview works without a server.
 * Only files within the workspace are resolved — http(s) and data: URIs
 * are left untouched.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Extract file extension from a path or URL.
 */
function getExtension(path: string): string {
  const clean = path.split("?")[0].split("#")[0];
  const parts = clean.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

/**
 * Check if a path looks like an external URL, data URI, or absolute path.
 */
function isExternalOrData(path: string): boolean {
  const trimmed = path.trim();
  // External protocols
  if (/^(https?:|data:|blob:|mailto:|tel:|javascript:)/i.test(trimmed)) return true;
  // Absolute paths from root
  if (trimmed.startsWith("/")) return true;
  // Fragment-only
  if (trimmed.startsWith("#")) return true;
  // Node modules / package imports (don't try to resolve these)
  if (/^[@a-zA-Z]/.test(trimmed) && !trimmed.startsWith("./") && !trimmed.startsWith("../")) return true;
  return false;
}

/**
 * Normalize a relative path against a base directory.
 */
function resolveRelativePath(basePath: string, relativePath: string): string {
  // Get the directory of the base file
  const baseDir = basePath.includes("/")
    ? basePath.substring(0, basePath.lastIndexOf("/"))
    : "";

  // Combine base directory with relative path
  const combined = baseDir ? `${baseDir}/${relativePath}` : relativePath;

  // Normalize path (resolve .. and . segments)
  const parts = combined.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== ".") {
      resolved.push(part);
    }
  }

  return resolved.join("/");
}

/**
 * Try to read a file from the workspace.
 */
async function tryReadFile(workspace: string, path: string): Promise<string | null> {
  try {
    const content = await invoke<string>("read_file", {
      workspace,
      path,
      offset: null,
      limit: null,
    });
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

/**
 * Convert image/binary content to a data URI.
 */
async function imageToDataUri(content: string, ext: string): Promise<string> {
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    svg: "image/svg+xml",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    eot: "application/vnd.ms-fontobject",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    webm: "video/webm",
    json: "application/json",
  };

  const mime = mimeTypes[ext] || "application/octet-stream";

  // For SVG, inline as text
  if (ext === "svg") {
    return `data:image/svg+xml,${encodeURIComponent(content)}`;
  }

  // For JSON and other text-based assets
  if (["json", "xml", "txt"].includes(ext)) {
    return `data:${mime},${encodeURIComponent(content)}`;
  }

  // For binary content - assume content might be base64 or needs encoding
  if (/^[A-Za-z0-9+/=\s]+$/.test(content)) {
    return `data:${mime};base64,${content.replace(/\s/g, "")}`;
  }

  // Fallback: encode as base64
  try {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const base64 = btoa(String.fromCharCode(...bytes));
    return `data:${mime};base64,${base64}`;
  } catch {
    return `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="50%" y="50%" text-anchor="middle" fill="%23999">?</text></svg>')}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FINDERS - Extract references from different file types
// ═══════════════════════════════════════════════════════════════════════════

interface Reference {
  original: string;  // Full matched string
  path: string;      // Extracted path
}

/**
 * Find CSS stylesheet links in HTML.
 * <link rel="stylesheet" href="..."> or <link href="..." rel="stylesheet">
 */
function findCssLinks(html: string): Reference[] {
  const results: Reference[] = [];
  // Match both orderings of rel and href attributes
  const regex = /<link\s+[^>]*?(?:rel\s*=\s*["']stylesheet["'][^>]*?href\s*=\s*["']([^"']+)["']|href\s*=\s*["']([^"']+)["'][^>]*?rel\s*=\s*["']stylesheet["'])[^>]*>/gi;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1] || match[2];
    if (href && !isExternalOrData(href)) {
      results.push({ original: match[0], path: href });
    }
  }
  return results;
}

/**
 * Find script src references in HTML.
 */
function findScriptSrcs(html: string): Reference[] {
  const results: Reference[] = [];
  // External scripts: <script src="...">
  const externalRegex = /<script\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>[\s]*<\/script>/gi;

  let match;
  while ((match = externalRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !isExternalOrData(src)) {
      results.push({ original: match[0], path: src });
    }
  }

  // Dynamic imports in inline scripts: import("./path") or import('./path')
  const importRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/gi;
  while ((match = importRegex.exec(html)) !== null) {
    const path = match[1];
    if (path && !isExternalOrData(path)) {
      results.push({ original: match[0], path });
    }
  }

  return results;
}

/**
 * Find image src references in HTML.
 * <img src="...">, <source src="...">, <video poster="...">
 */
function findImageSrcs(html: string): Reference[] {
  const results: Reference[] = [];

  // <img src="...">
  const imgRegex = /<img\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !isExternalOrData(src)) {
      results.push({ original: match[0], path: src });
    }
  }

  // <source src="...">
  const sourceRegex = /<source\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = sourceRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !isExternalOrData(src)) {
      results.push({ original: match[0], path: src });
    }
  }

  // <video poster="...">
  const videoRegex = /<video\s+[^>]*?poster\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = videoRegex.exec(html)) !== null) {
    const poster = match[1];
    if (poster && !isExternalOrData(poster)) {
      results.push({ original: match[0], path: poster });
    }
  }

  return results;
}

/**
 * Find SVG references: <use href="...">, <use xlink:href="...">, <image href="...">
 */
function findSvgRefs(html: string): Reference[] {
  const results: Reference[] = [];

  // <use href="..."> or <use xlink:href="...">
  const useRegex = /<use\s+[^>]*?(?:xlink:)?href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = useRegex.exec(html)) !== null) {
    const href = match[1];
    if (href && !href.startsWith("#") && !isExternalOrData(href)) {
      results.push({ original: match[0], path: href });
    }
  }

  // <image href="..."> (SVG image element)
  const imageRegex = /<image\s+[^>]*?(?:xlink:)?href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = imageRegex.exec(html)) !== null) {
    const href = match[1];
    if (href && !isExternalOrData(href)) {
      results.push({ original: match[0], path: href });
    }
  }

  return results;
}

/**
 * Find CSS @import and url() references.
 */
function findCssRefs(css: string): Reference[] {
  const results: Reference[] = [];

  // @import "path" or @import url("path")
  const importRegex = /@import\s+(?:url\s*\(\s*)?["']?([^"');\s]+)["']?\s*\)?[^;]*;/gi;
  let match;
  while ((match = importRegex.exec(css)) !== null) {
    const path = match[1];
    if (path && !isExternalOrData(path)) {
      results.push({ original: match[0], path });
    }
  }

  // url("path") - for backgrounds, fonts, etc.
  const urlRegex = /url\s*\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
  while ((match = urlRegex.exec(css)) !== null) {
    const url = match[1];
    if (url && !isExternalOrData(url)) {
      results.push({ original: match[0], path: url });
    }
  }

  return results;
}

/**
 * Find JavaScript/TypeScript import statements.
 */
function findJsImports(code: string): Reference[] {
  const results: Reference[] = [];

  // import ... from "path" or 'path'
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?["']([^"']+)["']/gi;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const path = match[1];
    if (path && !isExternalOrData(path)) {
      results.push({ original: match[0], path });
    }
  }

  // require("path") or require('path')
  const requireRegex = /require\s*\(\s*["']([^"']+)["']\s*\)/gi;
  while ((match = requireRegex.exec(code)) !== null) {
    const path = match[1];
    if (path && !isExternalOrData(path)) {
      results.push({ original: match[0], path });
    }
  }

  // import("path") dynamic imports
  const dynamicImportRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/gi;
  while ((match = dynamicImportRegex.exec(code)) !== null) {
    const path = match[1];
    if (path && !isExternalOrData(path)) {
      results.push({ original: match[0], path });
    }
  }

  // export ... from "path"
  const exportRegex = /export\s+(?:(?:\{[^}]*\}|\*)\s+from\s+)?["']([^"']+)["']/gi;
  while ((match = exportRegex.exec(code)) !== null) {
    const path = match[1];
    if (path && !isExternalOrData(path)) {
      results.push({ original: match[0], path });
    }
  }

  return results;
}

/**
 * Find Python import statements.
 */
function findPythonImports(code: string): Reference[] {
  const results: Reference[] = [];

  // from .module import something (relative imports)
  const fromRegex = /from\s+(\.[\w.]*)\s+import/gi;
  let match;
  while ((match = fromRegex.exec(code)) !== null) {
    const path = match[1];
    // Convert Python module path to file path: .module -> ./module.py
    const filePath = path.replace(/\./g, "/") + ".py";
    results.push({ original: match[0], path: filePath });
  }

  // from . import module
  const fromDotRegex = /from\s+\.\s+import\s+(\w+)/gi;
  while ((match = fromDotRegex.exec(code)) !== null) {
    const module = match[1];
    results.push({ original: match[0], path: `./${module}.py` });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RESOLVER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve all external references in a file.
 *
 * @param content - The file content to process
 * @param filePath - Path of the file (for resolving relative paths)
 * @param workspace - Workspace root path
 * @returns Processed content with inlined resources
 */
export async function resolveArtifactReferences(
  content: string,
  filePath: string | null,
  workspace: string | null,
): Promise<string> {
  if (!workspace || !filePath) {
    return content;
  }

  const ext = getExtension(filePath);
  let processed = content;
  const resolvedCache = new Map<string, string | null>();

  // Helper to get file content with caching
  const getFile = async (path: string): Promise<string | null> => {
    if (resolvedCache.has(path)) return resolvedCache.get(path)!;
    const data = await tryReadFile(workspace, path);
    resolvedCache.set(path, data);
    return data;
  };

  // Helper to inline a file reference
  const inlineReference = async (ref: Reference, inliner: (content: string, path: string) => string | Promise<string>) => {
    const resolvedPath = resolveRelativePath(filePath, ref.path);
    const fileContent = await getFile(resolvedPath);
    if (fileContent !== null) {
      const inlined = await inliner(fileContent, resolvedPath);
      processed = processed.replace(ref.original, inlined);
    }
  };

  // Process based on file type
  if (["html", "htm"].includes(ext)) {
    // HTML files - inline CSS, JS, images, SVG refs, etc.

    // Inline CSS stylesheets
    for (const ref of findCssLinks(content)) {
      await inlineReference(ref, async (css, cssPath) => {
        // Recursively resolve CSS references (images, fonts, @imports)
        let processedCss = css;
        for (const cssRef of findCssRefs(css)) {
          const imgPath = resolveRelativePath(cssPath, cssRef.path);
          const imgExt = getExtension(imgPath);
          const imgContent = await getFile(imgPath);
          if (imgContent !== null) {
            const dataUri = await imageToDataUri(imgContent, imgExt);
            processedCss = processedCss.replace(cssRef.original, cssRef.original.replace(cssRef.path, dataUri));
          }
        }
        return `<style /* inlined from ${ref.path} */>\n${processedCss}\n</style>`;
      });
    }

    // Inline JavaScript files
    for (const ref of findScriptSrcs(content)) {
      await inlineReference(ref, (js) =>
        `<script /* inlined from ${ref.path} */>\n${js}\n</script>`
      );
    }

    // Convert images to data URIs
    for (const ref of findImageSrcs(content)) {
      await inlineReference(ref, async (img, imgPath) => {
        const imgExt = getExtension(imgPath);
        const dataUri = await imageToDataUri(img, imgExt);
        return ref.original.replace(ref.path, dataUri);
      });
    }

    // Handle SVG refs
    for (const ref of findSvgRefs(content)) {
      await inlineReference(ref, async (svgContent, svgPath) => {
        const svgExt = getExtension(svgPath);
        const dataUri = await imageToDataUri(svgContent, svgExt);
        return ref.original.replace(ref.path, dataUri);
      });
    }

  } else if (["css", "scss", "less"].includes(ext)) {
    // CSS files - inline @imports and url() references
    for (const ref of findCssRefs(content)) {
      await inlineReference(ref, async (refContent, refPath) => {
        const refExt = getExtension(refPath);

        // For CSS @imports, inline the CSS content
        if (ref.original.startsWith("@import")) {
          return `/* inlined from ${ref.path} */\n${refContent}\n/* end inlined */`;
        }

        // For url() references, convert to data URI
        return imageToDataUri(refContent, refExt);
      });
    }

  } else if (["js", "jsx", "ts", "tsx", "mjs"].includes(ext)) {
    // JavaScript/TypeScript - inline relative imports
    for (const ref of findJsImports(content)) {
      await inlineReference(ref, (jsContent) => {
        // For JS, we'd ideally bundle but for preview we can inline simple cases
        // This is a simplified approach - just comment out the import and add the code
        return `/* inlined from ${ref.path} */\n${jsContent}\n/* end inlined */`;
      });
    }

  } else if (ext === "py") {
    // Python - inline relative imports
    for (const ref of findPythonImports(content)) {
      await inlineReference(ref, (pyContent) => {
        return `# inlined from ${ref.path}\n${pyContent}\n# end inlined`;
      });
    }

  } else if (ext === "svg") {
    // SVG files - inline references
    for (const ref of findSvgRefs(content)) {
      await inlineReference(ref, async (refContent, refPath) => {
        const refExt = getExtension(refPath);
        return imageToDataUri(refContent, refExt);
      });
    }

    // Also handle CSS within <style> tags in SVG
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let styleMatch;
    while ((styleMatch = styleRegex.exec(content)) !== null) {
      const css = styleMatch[1];
      let processedCss = css;

      for (const ref of findCssRefs(css)) {
        const refPath = resolveRelativePath(filePath, ref.path);
        const refExt = getExtension(refPath);
        const refContent = await getFile(refPath);
        if (refContent !== null) {
          const dataUri = await imageToDataUri(refContent, refExt);
          processedCss = processedCss.replace(ref.original, ref.original.replace(ref.path, dataUri));
        }
      }

      if (processedCss !== css) {
        processed = processed.replace(styleMatch[0], `<style>${processedCss}</style>`);
      }
    }
  }

  return processed;
}

/**
 * Check if content likely contains external references that could be resolved.
 */
export function hasResolvableReferences(content: string, fileType?: string): boolean {
  const ext = fileType?.toLowerCase() || "";

  if (["html", "htm"].includes(ext)) {
    return findCssLinks(content).length > 0 ||
           findScriptSrcs(content).length > 0 ||
           findImageSrcs(content).length > 0 ||
           findSvgRefs(content).length > 0;
  }

  if (["css", "scss", "less"].includes(ext)) {
    return findCssRefs(content).length > 0;
  }

  if (["js", "jsx", "ts", "tsx", "mjs"].includes(ext)) {
    return findJsImports(content).length > 0;
  }

  if (ext === "py") {
    return findPythonImports(content).length > 0;
  }

  if (ext === "svg") {
    return findSvgRefs(content).length > 0;
  }

  return false;
}

/**
 * Get a summary of external references found in content.
 */
export function getReferenceSummary(content: string, fileType?: string): {
  stylesheets: string[];
  scripts: string[];
  images: string[];
  imports: string[];
  other: string[];
} {
  const ext = fileType?.toLowerCase() || "";
  const result = {
    stylesheets: [] as string[],
    scripts: [] as string[],
    images: [] as string[],
    imports: [] as string[],
    other: [] as string[],
  };

  if (["html", "htm"].includes(ext)) {
    result.stylesheets = findCssLinks(content).map((r) => r.path);
    result.scripts = findScriptSrcs(content).map((r) => r.path);
    result.images = [
      ...findImageSrcs(content).map((r) => r.path),
      ...findSvgRefs(content).map((r) => r.path),
    ];
  } else if (["css", "scss", "less"].includes(ext)) {
    const refs = findCssRefs(content);
    result.imports = refs.filter((r) => r.original.startsWith("@import")).map((r) => r.path);
    result.images = refs.filter((r) => r.original.includes("url")).map((r) => r.path);
  } else if (["js", "jsx", "ts", "tsx", "mjs"].includes(ext)) {
    result.imports = findJsImports(content).map((r) => r.path);
  } else if (ext === "py") {
    result.imports = findPythonImports(content).map((r) => r.path);
  }

  return result;
}
