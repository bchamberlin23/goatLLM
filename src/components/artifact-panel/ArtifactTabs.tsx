export type ArtifactPanelView = "preview" | "code" | "browser";

interface ArtifactTabsProps {
  view: "preview" | "code";
  onChange: (view: "preview" | "code") => void;
}

export function ArtifactTabs({ view, onChange }: ArtifactTabsProps) {
  return (
    <div className="segmented-shell flex items-center gap-0.5 p-0.5 rounded-full">
      <button
        type="button"
        onClick={() => onChange("code")}
        aria-pressed={view === "code"}
        className={`motion-feedback px-2.5 py-0.5 text-[11.5px] font-medium rounded-full transition-[background,border-color,color,transform] ${
          view === "code"
            ? "bg-accent/10 text-[#ececec] border border-accent/20"
            : "text-[#a0a0a0] border border-transparent hover:text-[#ececec] hover:bg-white/[0.055]"
        }`}
      >
        Code
      </button>
      <button
        type="button"
        onClick={() => onChange("preview")}
        aria-pressed={view === "preview"}
        className={`motion-feedback px-2.5 py-0.5 text-[11.5px] font-medium rounded-full transition-[background,border-color,color,transform] ${
          view === "preview"
            ? "bg-accent/10 text-[#ececec] border border-accent/20"
            : "text-[#a0a0a0] border border-transparent hover:text-[#ececec] hover:bg-white/[0.055]"
        }`}
      >
        Preview
      </button>
    </div>
  );
}
