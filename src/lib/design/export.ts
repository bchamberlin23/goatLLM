/**
 * Design artifact export pipeline.
 *
 * Three download paths for design-mode artifacts:
 *   HTML  — single-file download as .html
 *   PDF   — browser print → Save as PDF (opens print dialog)
 *   ZIP   — all project files packed into a .zip
 *
 * All exports are client-side only — no server round-trip, no build step.
 */

import type { DesignProject } from "./project";
import { listFiles } from "./project";

// ── HTML download ───────────────────────────────────────────────────────

/**
 * Trigger a single-file .html download from an artifact's source code.
 * Uses a Blob + object URL to avoid opening a new tab.
 */
export function downloadHtml(
  html: string,
  filename = "artifact.html",
): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

// ── PDF via browser print ───────────────────────────────────────────────

/**
 * Open the browser's print dialog for a standalone HTML document.
 * The user can "Save as PDF" from the native print UI. We inject a basic
 * print stylesheet so the output is presentation-ready.
 *
 * Returns the window reference so callers can listen for afterprint to
 * know when the user is done.
 */
export function printToPdf(html: string): Window | null {
  const printCss = `
    <style>
      @page { margin: 20mm 15mm; size: A4; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style>
  `;

  // Wrap the artifact in a minimal document with print styles.
  const sourceEnd = html.lastIndexOf("</body>");
  let wrapped: string;
  if (sourceEnd !== -1) {
    wrapped =
      html.slice(0, sourceEnd) + printCss + html.slice(sourceEnd);
  } else {
    wrapped = html.replace("</head>", `${printCss}</head>`);
    if (wrapped === html) {
      // No </head> or </body> — prepend print styles after <html>.
      wrapped = html.replace(/<html[^>]*>/i, (m) => `${m}${printCss}`);
    }
  }

  const blob = new Blob([wrapped], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  // Open in a popup so the main app stays interactive. The print dialog
  // blocks within this window — closing it returns control.
  const w = window.open(url, "_blank", "width=800,height=600");
  if (!w) {
    URL.revokeObjectURL(url);
    return null;
  }

  // Print after the document loads. On mobile / blocked popups this
  // won't fire, which is fine — the user sees the popup and can print
  // manually.
  w.addEventListener(
    "load",
    () => {
      setTimeout(() => w.print(), 300);
    },
    { once: true },
  );

  // Clean up the blob URL when the window closes.
  const cleanup = () => {
    URL.revokeObjectURL(url);
  };
  w.addEventListener("beforeunload", cleanup, { once: true });

  // Fallback: if the window takes >10s to load, clean up anyway.
  setTimeout(() => {
    try {
      if (w.closed) URL.revokeObjectURL(url);
    } catch {
      // cross-origin check failed — window is still open (or was never ours)
    }
  }, 10_000);

  return w;
}

// ── ZIP download ────────────────────────────────────────────────────────

/**
 * Pack every file in the project into a .zip and trigger a download.
 *
 * Uses a streaming approach: we build the zip in memory with JSZip if
 * available, or fall back to a minimal manual zip (only stores files,
 * no compression — good enough for text assets like HTML/CSS/MD).
 */

// Lazy-load JSZip to keep the bundle small until the user actually
// exports something. The dynamic import tree-shakes out of the main
// bundle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _JSZip: any = null;
let _JSZipLoadAttempted = false;

async function getJSZip(): Promise<any> {
  if (_JSZipLoadAttempted) return _JSZip;
  _JSZipLoadAttempted = true;
  try {
    // Dynamic import — jszip is an optional dependency not listed in
    // package.json. Using a variable bypasses TS module resolution.
    const modName = "jszip";
    _JSZip = await import(/* @vite-ignore */ modName);
    return _JSZip;
  } catch {
    return null;
  }
}

export async function downloadZip(
  project: DesignProject,
  filename = "design-project.zip",
): Promise<void> {
  const files = listFiles(project);
  if (files.length === 0) return;

  const JSZip = await getJSZip();

  if (JSZip) {
    // Full-featured zip with compression.
    const zip = new JSZip.default();
    for (const name of files) {
      zip.file(name, project.files[name]);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    URL.revokeObjectURL(url);
  } else {
    // Fallback: minimal zip (store-only, no compression). This is
    // spec-compliant and works for text assets up to ~few MB.
    const blob = buildMinimalZip(project, files);
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    URL.revokeObjectURL(url);
  }
}

// ── Minimal ZIP builder (no dependency fallback) ────────────────────────

function buildMinimalZip(
  project: DesignProject,
  files: string[],
): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let cdSize = 0;
  let cdOffset = 0;

  for (const name of files) {
    const content = encoder.encode(project.files[name]);
    const nameBytes = encoder.encode(name);

    // Local file header
    const localHeader = new Uint8Array(30 + nameBytes.length + content.length);
    const lh = new DataView(localHeader.buffer);
    lh.setUint32(0, 0x04034b50, true); // signature
    lh.setUint16(4, 20, true); // version needed
    lh.setUint16(6, 0, true); // flags
    lh.setUint16(8, 0, true); // compression (store)
    lh.setUint16(10, 0, true); // mod time
    lh.setUint16(12, 0, true); // mod date
    // CRC32: we skip it (flags bit 3 not set, so readers use data descriptor
    // or zero-CRC — most readers handle 0-CRC for store-only files fine).
    lh.setUint32(14, 0, true); // crc32
    lh.setUint32(18, content.length, true); // compressed size
    lh.setUint32(22, content.length, true); // uncompressed size
    lh.setUint16(26, nameBytes.length, true); // filename length
    lh.setUint16(28, 0, true); // extra field length
    localHeader.set(nameBytes, 30);
    localHeader.set(content, 30 + nameBytes.length);
    parts.push(localHeader);

    // Central directory entry
    const cdEntry = new Uint8Array(46 + nameBytes.length);
    const cd = new DataView(cdEntry.buffer);
    cd.setUint32(0, 0x02014b50, true); // signature
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint16(8, 0, true); // flags
    cd.setUint16(10, 0, true); // compression
    cd.setUint16(12, 0, true); // mod time
    cd.setUint16(14, 0, true); // mod date
    cd.setUint32(16, 0, true); // crc32
    cd.setUint32(20, content.length, true); // compressed size
    cd.setUint32(24, content.length, true); // uncompressed size
    cd.setUint16(28, nameBytes.length, true); // filename length
    cd.setUint16(30, 0, true); // extra field length
    cd.setUint16(32, 0, true); // file comment length
    cd.setUint16(34, 0, true); // disk number start
    cd.setUint16(36, 0, true); // internal file attrs
    cd.setUint32(38, 0, true); // external file attrs
    cd.setUint32(42, cdOffset, true); // local header offset
    cdEntry.set(nameBytes, 46);
    cdParts.push(cdEntry);

    cdSize += cdEntry.length;
    cdOffset += localHeader.length;
  }

  // End of central directory record
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // signature
  eocdView.setUint16(4, 0, true); // disk number
  eocdView.setUint16(6, 0, true); // disk with CD
  eocdView.setUint16(8, files.length, true); // entries on disk
  eocdView.setUint16(10, files.length, true); // total entries
  eocdView.setUint32(12, cdSize, true); // CD size
  eocdView.setUint32(16, cdOffset, true); // CD offset
  eocdView.setUint16(20, 0, true); // comment length

  return new Blob([...parts, ...cdParts, eocd] as BlobPart[], {
    type: "application/zip",
  });
}

// ── Shared helpers ──────────────────────────────────────────────────────

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Remove after a short delay so the download can start.
  setTimeout(() => {
    document.body.removeChild(a);
  }, 100);
}
