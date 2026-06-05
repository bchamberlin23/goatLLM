import { useState, useEffect, useCallback } from "react";
import { Sparkles, AlertCircle, X, Zap, Wand2, FolderOpen, Plus } from "lucide-react";
import { useChatStore } from "../../stores/chat";

// Mode badge colors: chat = cool blue, agent = warm amber, both = soft purple
function ModeBadge({ mode }: { mode: string }) {
  const styles =
    mode === "agent"
      ? "text-accent bg-accent/10 border-accent/20"
      : mode === "chat"
        ? "text-[#7eb8f7] bg-[#3b82f6]/10 border-[#3b82f6]/20"
        : "text-[#b4a0f7] bg-[#8b5cf6]/10 border-[#8b5cf6]/20";
  const label =
    mode === "agent"
      ? "agent"
      : mode === "chat"
        ? "chat"
        : "both";
  const title =
    mode === "agent"
      ? "Available in Agent mode only"
      : mode === "chat"
        ? "Available in Chat mode only"
        : "Available in both modes";

  return (
    <span
      className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-medium leading-none ${styles}`}
      title={title}
    >
      {label}
    </span>
  );
}

export function SkillsSection({ embedded = false }: { embedded?: boolean }) {
  const discoveredSkills = useChatStore((s) => s.discoveredSkills);
  const disabledSkills = useChatStore((s) => s.disabledSkills);
  const autoTriggerSkills = useChatStore((s) => s.autoTriggerSkills);
  const setSkillEnabled = useChatStore((s) => s.setSkillEnabled);
  const setAutoTriggerSkill = useChatStore((s) => s.setAutoTriggerSkill);
  const skillPaths = useChatStore((s) => s.skillPaths);
  const addSkillPath = useChatStore((s) => s.addSkillPath);
  const removeSkillPath = useChatStore((s) => s.removeSkillPath);
  const setDiscoveredSkills = useChatStore((s) => s.setDiscoveredSkills);
  const [newPath, setNewPath] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [creatingSkill, setCreatingSkill] = useState(false);

  const refreshDiscovered = useCallback(async () => {
    const { loadAllSkills } = await import("../../lib/skills");
    const { skills } = await loadAllSkills({
      customPaths: skillPaths,
      includeDefaults: true,
    });
    setDiscoveredSkills(skills);
  }, [skillPaths, setDiscoveredSkills]);

  useEffect(() => {
    refreshDiscovered();
  }, [refreshDiscovered]);

  const visible = discoveredSkills.slice(0, expanded ? undefined : 5);
  const activeCount = discoveredSkills.filter((s) => !disabledSkills.has(s.name)).length;
  const autoCount = autoTriggerSkills.size;

  return (
    <div className={`flex flex-col gap-3 ${embedded ? "pt-2 border-t border-white/5" : ""}`}>
      {!embedded && (
        <>
          <h3 className="text-[11px] font-semibold text-text-3 uppercase tracking-wider">Skills</h3>
          <p className="text-[13px] text-text-3 leading-relaxed mb-2">
            Reusable agent capabilities from{" "}
            <code className="text-text-2 bg-white/5 px-1 py-0.5 rounded text-[12px]">
              ~/.goat/agent/skills/
            </code>
            . Toggle off to remove from context, or add external directories.
          </p>
        </>
      )}
      {embedded && (
        <span className="text-[12px] font-medium text-text-3">Skills</span>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {discoveredSkills.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-text-2">
                {activeCount} active
              </span>
              <span className="text-[10px] text-text-3">·</span>
              <span className="text-[11.5px] text-text-3">
                {discoveredSkills.length} discovered
              </span>
              {autoCount > 0 && (
                <>
                  <span className="text-[10px] text-text-3">·</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-accent">
                    <Zap size={10} strokeWidth={2} />
                    {autoCount} auto
                  </span>
                </>
              )}
            </div>
          ) : (
            <span className="text-[12px] text-text-3">No skills loaded</span>
          )}
        </div>
        <button
          onClick={() => setCreatingSkill((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
            creatingSkill
              ? "bg-white/10 text-text-1"
              : "bg-white/5 hover:bg-white/5 border border-hairline text-text-2"
          }`}
        >
          <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
          {creatingSkill ? "Close" : "Create skill"}
        </button>
      </div>

      {creatingSkill && (
        <CreateSkillForm
          existingNames={new Set(discoveredSkills.map((s) => s.name.toLowerCase()))}
          onClose={() => setCreatingSkill(false)}
          onCreated={async () => {
            setCreatingSkill(false);
            await refreshDiscovered();
          }}
        />
      )}

      {discoveredSkills.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 px-4 rounded-xl bg-white/[0.02] border border-hairline">
          <div className="w-9 h-9 rounded-full bg-white/5 border border-hairline flex items-center justify-center">
            <Wand2 size={17} strokeWidth={1.5} className="text-text-3" />
          </div>
          <div className="text-center">
            <p className="text-[13px] text-text-2 font-medium">No skills discovered</p>
            <p className="text-[11.5px] text-text-3 mt-0.5 leading-relaxed">
              Skills in{" "}
              <code className="text-text-2 bg-white/5 px-1 py-0.5 rounded text-[11px]">
                ~/.goat/agent/skills/
              </code>{" "}
              will appear here.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {visible.map((skill) => {
              const isDisabled = disabledSkills.has(skill.name);
              const isAutoTrigger = autoTriggerSkills.has(skill.name);
              return (
                <div
                  key={skill.name}
                  className={`flex flex-col gap-0 rounded-xl border transition-all duration-150 ${
                    isAutoTrigger && !isDisabled
                      ? "bg-accent/[0.05] border-accent/[0.18] hover:border-accent/30"
                      : isDisabled
                        ? "bg-white/[0.02] border-hairline opacity-60"
                        : "bg-surface-3 border-hairline hover:border-hairline-strong hover:bg-surface-3"
                  }`}
                >
                  {/* Main row */}
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-text-2 truncate">{skill.name}</span>
                        <ModeBadge mode={skill.mode} />
                        {isAutoTrigger && !isDisabled && (
                          <span className="shrink-0 text-[9px] text-accent bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded flex items-center gap-1 font-medium leading-none">
                            <Zap size={8} strokeWidth={2.5} />
                            auto
                          </span>
                        )}
                      </div>
                      <div
                        className="text-[11px] text-text-3 truncate mt-0.5 leading-relaxed"
                        title={skill.description}
                      >
                        {skill.description.length > 100
                          ? skill.description.slice(0, 100) + "…"
                          : skill.description}
                      </div>
                      <div className="text-[10px] text-text-4 mt-0.5 font-mono">{skill.source}</div>
                    </div>
                    {/* Enable toggle */}
                    <button
                      className={`shrink-0 w-9 h-5 rounded-full relative transition-colors ${
                        isDisabled ? "bg-white/10" : "bg-accent"
                      }`}
                      onClick={() => setSkillEnabled(skill.name, !!isDisabled)}
                      aria-label={`${isDisabled ? "Enable" : "Disable"} ${skill.name}`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${
                          isDisabled ? "left-0.5" : "left-[calc(100%-1.125rem)]"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Auto-trigger row */}
                  <div className={`flex items-center justify-between px-3 pb-2.5 ${isDisabled ? "pointer-events-none" : ""}`}>
                    <div className="flex items-center gap-1.5">
                      <Zap size={10} className={isAutoTrigger && !isDisabled ? "text-accent" : "text-text-3"} />
                      <span className="text-[11px] text-text-3">
                        Inject every turn
                      </span>
                    </div>
                    <button
                      className={`shrink-0 w-7 h-4 rounded-full relative transition-colors ${
                        isAutoTrigger ? "bg-accent" : "bg-white/10"
                      } ${isDisabled ? "opacity-30 cursor-not-allowed" : ""}`}
                      disabled={isDisabled}
                      onClick={() => setAutoTriggerSkill(skill.name, !isAutoTrigger)}
                      aria-label={`${isAutoTrigger ? "Disable" : "Enable"} auto-trigger for ${skill.name}`}
                    >
                      <span
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${
                          isAutoTrigger ? "left-[calc(100%-0.875rem)]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {discoveredSkills.length > 5 && (
            <button
              className="text-[12px] text-text-3 hover:text-text-2 transition-colors self-start"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? "Show less" : `Show all ${discoveredSkills.length} skills`}
            </button>
          )}
        </>
      )}

      {/* Custom skill directories */}
      <div className="mt-1">
        <div className="flex items-center gap-1.5 mb-2">
          <FolderOpen size={11} strokeWidth={1.75} className="text-text-3" />
          <h4 className="text-[11.5px] font-medium text-text-3">Custom skill directories</h4>
        </div>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = newPath.trim();
                if (trimmed) { addSkillPath(trimmed); setNewPath(""); }
              }
            }}
            placeholder="~/projects/my-skills"
            className="flex-1 bg-bg border border-hairline rounded-lg px-3 py-1.5 text-[13px] text-text-2 placeholder:text-text-4 focus:outline-none focus:border-white/[0.14] transition-colors font-mono text-[12px]"
          />
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/5 border border-hairline text-text-2 text-[12px] font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={!newPath.trim()}
            onClick={() => {
              const trimmed = newPath.trim();
              if (trimmed) { addSkillPath(trimmed); setNewPath(""); }
            }}
          >
            <Plus size={12} strokeWidth={2.5} />
            Add
          </button>
        </div>
        {skillPaths.length > 0 && (
          <div className="flex flex-col gap-1">
            {skillPaths.map((p) => (
              <div
                key={p}
                className="group flex items-center justify-between gap-2 px-3 py-2 bg-surface-3 border border-hairline rounded-lg hover:border-hairline-strong transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen size={11} strokeWidth={1.5} className="text-text-3 shrink-0" />
                  <span className="text-[12px] font-mono text-text-2 truncate">{p}</span>
                </div>
                <button
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-3 hover:text-error hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                  onClick={() => removeSkillPath(p)}
                  aria-label={`Remove ${p}`}
                >
                  <X size={10} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create skill form ──
function CreateSkillForm({
  existingNames,
  onClose,
  onCreated,
}: {
  existingNames: Set<string>;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"chat" | "agent" | "both">("chat");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const slugify = (s: string) =>
    s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const slug = slugify(name);

  const validate = (): string | null => {
    if (!slug) return "Pick a name (letters and numbers, e.g. \u201cdetail-mode\u201d).";
    if (slug.length > 60) return "Name is too long (max 60 chars).";
    if (existingNames.has(slug)) return `A skill named \u201c${slug}\u201d already exists.`;
    if (!description.trim()) return "Add a description so the model knows when to use this skill.";
    if (description.length > 500) return "Description is too long (max 500 chars).";
    if (!body.trim()) return "The skill body is empty. Tell the model what to do.";
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setSaving(true);
    try {
      const safeDescription = description.trim().replace(/"/g, '\\"');
      const frontmatter =
        `---\n` +
        `name: ${slug}\n` +
        `description: "${safeDescription}"\n` +
        `mode: ${mode}\n` +
        `---\n\n`;
      const content = frontmatter + body.trim() + "\n";
      const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
      await tauriInvoke<string>("write_skill_file", {
        relativePath: `${slug}/SKILL.md`,
        content,
      });
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const modeOptions: { value: "chat" | "agent" | "both"; label: string; color: string }[] = [
    { value: "chat", label: "chat", color: "text-[#7eb8f7] border-[#3b82f6]/40 bg-[#3b82f6]/15" },
    { value: "agent", label: "agent", color: "text-accent border-accent/40 bg-accent/15" },
    { value: "both", label: "both", color: "text-[#b4a0f7] border-[#8b5cf6]/40 bg-[#8b5cf6]/15" },
  ];

  return (
    <div className="flex flex-col gap-3 p-3.5 bg-bg border border-hairline-strong rounded-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-text-1">New skill</h4>
          <p className="text-[11px] text-text-3 leading-relaxed mt-0.5">
            Skills are reusable prompts. Saved to{" "}
            <code className="text-text-2 bg-white/5 px-1 py-0.5 rounded">
              ~/.goat/agent/skills/&lt;name&gt;/SKILL.md
            </code>
            .
          </p>
        </div>
        <button
          onClick={() => setShowHelp((v) => !v)}
          className="shrink-0 text-[11px] text-text-3 hover:text-text-1 transition-colors underline-offset-2 hover:underline"
        >
          {showHelp ? "Hide guide" : "How it works"}
        </button>
      </div>

      {showHelp && (
        <div className="flex flex-col gap-2 p-3 bg-surface-3 border border-hairline rounded-lg text-[11.5px] text-text-2 leading-relaxed">
          <p><strong className="text-text-1">Name</strong> — short, kebab-case (e.g. <code className="bg-white/5 px-1 rounded">detail-mode</code>). Becomes the folder name.</p>
          <p><strong className="text-text-1">Description</strong> — one or two sentences describing <em>when</em> to use the skill. The model reads this to decide whether to activate it.</p>
          <p><strong className="text-text-1">Mode</strong> — <code className="bg-white/5 px-1 rounded">chat</code> shows it only in plain chat, <code className="bg-white/5 px-1 rounded">agent</code> only when tools are on, <code className="bg-white/5 px-1 rounded">both</code> in either.</p>
          <p><strong className="text-text-1">Body</strong> — the actual instructions. Use plain markdown. Address the model directly: &ldquo;You answer in plain prose&hellip;&rdquo;. Examples beat abstractions.</p>
          <p className="text-text-4">Tip: keep it under ~30 lines. Long skills crowd the model&rsquo;s attention.</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-text-3">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="detail-mode"
          maxLength={80}
          className="bg-sunken border border-hairline-strong rounded-lg px-3 py-1.5 text-[13px] text-text-2 placeholder:text-text-4 focus:outline-none focus:border-white/[0.16] transition-colors"
        />
        {name && slug !== name && (
          <span className="text-[10.5px] text-text-4">
            Saved as <code className="bg-white/5 px-1 rounded">{slug}</code>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-text-3">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Use when the user wants longer, more detailed explanations with worked examples."
          rows={2}
          className="bg-sunken border border-hairline-strong rounded-lg px-3 py-1.5 text-[13px] text-text-2 placeholder:text-text-4 focus:outline-none focus:border-white/[0.16] transition-colors resize-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-text-3">Mode</label>
        <div className="flex gap-1.5">
          {modeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={`flex-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all border ${
                mode === opt.value
                  ? opt.color
                  : "bg-white/[0.03] text-text-4 border-hairline hover:text-text-1 hover:bg-white/5 hover:border-hairline-strong"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-text-3">Body (markdown)</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"You answer with thorough, well-structured explanations.\n\nRules:\n- Lead with the answer, then expand.\n- Include at least one worked example for non-trivial questions.\n- Use headings only when the response has multiple distinct sections."}
          rows={8}
          className="bg-sunken border border-hairline-strong rounded-lg px-3 py-2 text-[13px] text-text-2 placeholder:text-text-4 focus:outline-none focus:border-white/[0.16] transition-colors font-mono resize-y leading-relaxed"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[11.5px] text-error">
          <AlertCircle size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-[12.5px] text-text-2 hover:bg-white/5 hover:text-text-1 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !description.trim() || !body.trim()}
          className="px-3.5 py-1.5 bg-accent text-bg text-[12.5px] font-medium rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Create skill"}
        </button>
      </div>
    </div>
  );
}
