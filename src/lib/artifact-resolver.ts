/**
 * Resolve external file references in HTML artifacts.
 *
 * When an HTML file references external resources (CSS, JS, images) via
 * relative paths, we inline them so the preview works without a server.
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
 * Check if a path looks like an external URL or data URI.
 */
function isExternalOrData(path: string): boolean {
  return /^(https?:|data:|blob:|mailto:|tel:|javascript:|#|\/)/i.test(path.trim());
}

/**
 * Normalize a relative path against a base directory.
 * E.g., resolveRelativePath("pages/index.html", "../css/style.css") => "css/style.css"
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
 * Returns null if the file doesn't exist or can't be read.
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
 * Convert image content to a data URI.
 */
async function imageToDataUri(content: string, ext: string): Promise<string> {
  // For SVG, we can inline directly
  if (ext === "svg") {
    const encoded = encodeURIComponent(content);
    return `data:image/svg+xml,${encoded}`;
  }

  // For other images, we need to check if content is already base64
  // or if we need to encode binary content
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
  };

  const mime = mimeTypes[ext] || "application/octet-stream";

  // If content looks like base64, use it directly
  if (/^[A-Za-z0-9+/]+=*$/.test(content.replace(/\s/g, ""))) {
    return `data:${mime};base64,${content.replace(/\s/g, "")}`;
  }

  // Otherwise, encode as base64
  try {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const base64 = btoa(String.fromCharCode(...bytes));
    return `data:${mime};base64,${base64}`;
  } catch {
    // Fallback: return as SVG placeholder
    return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23999">Image unavailable</text></svg>`;
  }
}

/**
 * Find all CSS link references in HTML.
 * Matches: <link rel="stylesheet" href="..."> and <link href="..." rel="stylesheet">
 */
function findCssLinks(html: string): { original: string; href: string }[] {
  const results: { original: string; href: string }[] = [];
  const linkRegex = /<link\s+[^>]*?(?:rel\s*=\s*["']stylesheet["'][^>]*?href\s*=\s*["']([^"']+)["']|href\s*=\s*["']([^"']+)["'][^>]*?rel\s*=\s*["']stylesheet["'])[^>]*>/gi;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1] || match[2];
    if (href && !isExternalOrData(href)) {
      results.push({ original: match[0], href });
    }
  }

  return results;
}

/**
 * Find all script src references in HTML.
 * Matches: <script src="..."> (not inline scripts)
 */
function findScriptSrcs(html: string): { original: string; src: string }[] {
  const results: { original: string; src: string }[] = [];
  const scriptRegex = /<script\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;

  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !isExternalOrData(src)) {
      results.push({ original: match[0], src });
    }
  }

  return results;
}

/**
 * Find all image src references in HTML.
 * Matches: <img src="..."> and srcset (simplified - just first URL)
 */
function findImageSrcs(html: string): { original: string; src: string }[] {
  const results: { original: string; src: string }[] = [];
  const imgRegex = /<img\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !isExternalOrData(src)) {
      results.push({ original: match[0], src });
    }
  }

  return results;
}

/**
 * Find CSS url() references (for background images, fonts, etc.)
 * Matches: url("path") or url('path') or url(path)
 */
function findCssUrls(css: string): { original: string; url: string }[] {
  const results: { original: string; url: string }[] = [];
  const urlRegex = /url\s*\(\s*["']?([^"')]+?)["']?\s*\)/gi;

  let match;
  while ((match = urlRegex.exec(css)) !== null) {
    const url = match[1];
    if (url && !isExternalOrData(url)) {
      results.push({ original: match[0], url });
    }
  }

  return results;
}

/**
 * Resolve all external references in an HTML artifact.
 *
 * @param html - The HTML content to process
 * @param artifactPath - Path of the artifact file (for resolving relative paths)
 * @param workspace - Workspace root path
 * @returns Processed HTML with inlined resources
 */
export async function resolveArtifactReferences(
  html: string,
  artifactPath: string | null,
  workspace: string | null,
): Promise<string> {
  if (!workspace || !artifactPath) {
    return html;
  }

  let processed = html;
  const resolvedCache = new Map<string, string | null>();

  // Helper to get content with caching
  const getCachedContent = async (path: string): Promise<string | null> => {
    if (resolvedCache.has(path)) {
      return resolvedCache.get(path)!;
    }
    const content = await tryReadFile(workspace, path);
    resolvedCache.set(path, content);
    return content;
  };

  // 1. Inline CSS files
  const cssLinks = findCssLinks(html);
  for (const link of cssLinks) {
    const resolvedPath = resolveRelativePath(artifactPath, link.href);
    const content = await getCachedContent(resolvedPath);

    if (content !== null) {
      // Also resolve any url() references within the CSS
      let processedCss = content;
      const cssUrls = findCssUrls(content);

      for (const cssUrl of cssUrls) {
        const resolvedUrl = resolveRelativePath(resolvedPath, cssUrl.url);
        const ext = getExtension(resolvedUrl);

        if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext)) {
          const imgContent = await getCachedContent(resolvedUrl);
          if (imgContent !== null) {
            const dataUri = await imageToDataUri(imgContent, ext);
            processedCss = processedCss.replace(cssUrl.original, `url("${dataUri}")`);
          }
        }
      }

      processed = processed.replace(
        link.original,
        `<style /* inlined from ${link.href} */>\n${processedCss}\n</style>`,
      );
    }
  }

  // 2. Inline JavaScript files
  const scriptSrcs = findScriptSrcs(html);
  for (const script of scriptSrcs) {
    const resolvedPath = resolveRelativePath(artifactPath, script.src);
    const content = await getCachedContent(resolvedPath);

    if (content !== null) {
      processed = processed.replace(
        script.original,
        `<script /* inlined from ${script.src} */>\n${content}\n</script>`,
      );
    }
  }

  // 3. Convert images to data URIs
  const imageSrcs = findImageSrcs(html);
  for (const img of imageSrcs) {
    const resolvedPath = resolveRelativePath(artifactPath, img.src);
    const ext = getExtension(resolvedPath);
    const content = await getCachedContent(resolvedPath);

    if (content !== null) {
      const dataUri = await imageToDataUri(content, ext);
      processed = processed.replace(
        img.original,
        img.original.replace(img.src, dataUri),
      );
    }
  }

  return processed;
}

/**
 * Check if an HTML string likely contains external references that could be resolved.
 */
export function hasResolvableReferences(html: string): boolean {
  const cssLinks = findCssLinks(html);
  const scriptSrcs = findScriptSrcs(html);
  const imageSrcs = findImageSrcs(html);

  return cssLinks.length > 0 || scriptSrcs.length > 0 || imageSrcs.length > 0;
}

/**
 * Get a summary of external references found in HTML.
 */
export function getReferenceSummary(html: string): {
  cssFiles: string[];
  jsFiles: string[];
  images: string[];
} {
  return {
    cssFiles: findCssLinks(html).map((l) => l.href),
    jsFiles: findScriptSrcs(html).map((s) => s.src),
    images: findImageSrcs(html).map((i) => i.src),
  };
}
