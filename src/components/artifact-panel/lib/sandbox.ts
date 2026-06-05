export type SandboxKind =
  | "html"
  | "html-design"
  | "office"
  | "browser"
  | "none";

const SANDBOX_BY_KIND: Record<SandboxKind, string> = {
  html: "allow-scripts allow-same-origin allow-popups",
  "html-design": "allow-same-origin allow-popups",
  office: "allow-scripts",
  browser: "allow-scripts allow-same-origin allow-forms allow-popups",
  none: "",
};

export function getSandboxAttribute(kind: SandboxKind) {
  return SANDBOX_BY_KIND[kind];
}
