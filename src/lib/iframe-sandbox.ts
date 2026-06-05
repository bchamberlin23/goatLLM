/**
 * Centralized iframe `sandbox` attribute values.
 *
 * The various preview surfaces in the app each need a slightly different
 * mix of sandbox tokens — chat artifacts need scripts + same-origin so the
 * iframe can use the parent's storage for blobs, PDF previews need to be
 * fully locked down, attachment HTML needs forms so <form> elements work,
 * and so on. Scattering those literals across components makes it easy to
 * accidentally loosen a sandbox (security regression) or to drift between
 * surfaces that should behave the same.
 *
 * This helper is the single source of truth. Add a new mode here, not in
 * the component that needs it.
 *
 * Modes:
 *   - "design-html"     : ManualEditPanel preview. Same-origin so the
 *                         iframe can resolve blob URLs the parent hands
 *                         it; popups for `target="_blank"` links.
 *   - "chat-html"        : ArtifactPanel chat artifacts. Scripts + same-
 *                         origin so the artifact can reach the parent's
 *                         blob: / object: URLs and storage; popups for
 *                         external links the artifact may open.
 *   - "office-preview"   : Office docs (docx/xlsx/pptx rendered to HTML).
 *                         Scripts only — the renderer is self-contained.
 *   - "pdf"              : PDF preview. Fully locked down. PDFs do not
 *                         need scripts; this also keeps the viewer
 *                         contained if a hostile doc tries to escape.
 *   - "attachment"       : AttachmentPanel HTML preview. Forms so the
 *                         attached page can submit; popups for links;
 *                         scripts because arbitrary user HTML is expected
 *                         to behave naturally. Same-origin is *not*
 *                         granted so the page can't reach local app
 *                         storage.
 */

export type SandboxMode =
  | "design-html"
  | "chat-html"
  | "office-preview"
  | "pdf"
  | "attachment";

const SANDBOX_PRESETS: Record<SandboxMode, string> = {
  "design-html": "allow-same-origin allow-popups",
  "chat-html": "allow-scripts allow-same-origin allow-popups",
  "office-preview": "allow-scripts",
  "pdf": "",
  "attachment": "allow-scripts allow-forms allow-popups",
};

/**
 * Return the `sandbox` attribute string for the given preview mode.
 *
 * The empty string is a valid (and intentional) result — it means
 * "fully sandboxed, no permissions." That's what the browser defaults
 * to with no tokens, so an empty string is the safest possible value.
 */
export function sandboxFor(mode: SandboxMode): string {
  return SANDBOX_PRESETS[mode];
}
