import { useState, useEffect, useCallback } from "react";
import { Sparkles, AlertCircle, X, Zap } from "lucide-react";
import { useChatStore } from "../../stores/chat";

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

  return (
    <div className={`flex flex-col gap-3 ${embedded ? "pt-2 border-t border-white/5" : ""}`}>
      {!embedded && (
        <>
          <h3 className="text-[11px] font-semibold text-text-3 uppercase tracking-wider">Skills</h3>
          <p className="text-[13px] text-text-3 leading-relaxed mb-2">
            Reusable agent capabilities from <code className="text-text-2 bg-white/5 px-1 py-0.5 rounded text-[12px]">~/.goat/agent/skills/</code>. Toggle off to remove from context, or add external directories.
          </p>
        </>
      )}
      {embedded && (
        <span className="text-[12px] font-medium text-text-3">Skills</span>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[#a0a0a0]">
          {discoveredSkills.length} skill{discoveredSkills.length === 1 ? "" : "s"} discovered
        </span>
        <button
          onClick={() => setCreatingSkill((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
            creatingSkill
              ? "bg-white/10 text-[#ececec]"
              : "bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.06] text-text-2"
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
        <p className="text-[13px] text-[#a0a0a0] px-1">
          No skills discovered. Skills in <code className="text-[#c9c9c9] bg-white/5 px-1 py-0.5 rounded text-[12px]">~/.goat/agent/skills/</code> will appear here.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {visible.map((skill) => {
              const isDisabled = disabledSkills.has(skill.name);
              const isAutoTrigger = autoTriggerSkills.has(skill.name);
              return (
                <div key={skill.name} className="flex flex-col gap-2 p-2.5 bg-[#212122] border border-white/5 rounded-lg">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-[#d5d5d5] truncate">{skill.name}</span>
                        <span
                          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium text-text-3 bg-white/[0.06]"
                          title={
                            skill.mode === "agent"
                              ? "Available in Agent mode only"
                              : skill.mode === "chat"
                                ? "Available in Chat mode only"
                                : "Available in both modes"
                          }
                        >
                          {skill.mode}
                        </span>
                        {isAutoTrigger && (
                          <span className="shrink-0 text-[10px] text-text-3 bg-white/[0.06] px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Zap size={10} className="text-accent" />
                            auto
                          </span>
                        )}
                        {isDisabled && (
                          <span className="shrink-0 text-[10px] text-[#a0a0a0] bg-white/5 px-1.5 py-0.5 rounded">disabled</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#a0a0a0] truncate mt-0.5" title={skill.description}>
                        {skill.description.length > 100 ? skill.description.slice(0, 100) + "…" : skill.description}
                      </div>
                      <div className="text-[10px] text-[#888888] mt-0.5">{skill.source}</div>
                    </div>
                    <button
                      className={`shrink-0 w-9 h-5 rounded-full relative transition-colors ${
                        isDisabled ? "bg-white/10" : "bg-accent"
                      }`}
                      onClick={() => setSkillEnabled(skill.name, !!isDisabled)}
                      aria-label={`${isDisabled ? "Enable" : "Disable"} ${skill.name}`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          isDisabled ? "left-0.5" : "left-[calc(100%-1.125rem)]"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-between pl-0.5">
                    <div className="flex items-center gap-1.5">
                      <Zap size={10} className="text-text-3" />
                      <span className="text-[10.5px] text-[#888]">
                        Auto-load every turn
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
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
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
              className="text-[12px] text-[#a0a0a0] hover:text-[#d5d5d5] transition-colors self-start"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? "Show less" : `Show all ${discoveredSkills.length} skills`}
            </button>
          )}
        </>
      )}

      <div className="mt-2">
        <h4 className="text-[12px] font-medium text-[#a0a0a0] mb-2">Custom skill directories</h4>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="~/projects/my-skills"
            className="flex-1 bg-[#1a1a1c] border border-white/5 rounded-lg px-3 py-1.5 text-[13px] text-[#d5d5d5] placeholder:text-[#6a6a6c] focus:outline-none focus:border-white/10 transition-colors"
          />
          <button
            className="px-3 py-1.5 bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.06] text-text-2 text-[12px] font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={!newPath.trim()}
            onClick={() => {
              const trimmed = newPath.trim();
              if (trimmed) { addSkillPath(trimmed); setNewPath(""); }
            }}
          >
            Add
          </button>
        </div>
        {skillPaths.length > 0 && (
          <div className="flex flex-col gap-1">
            {skillPaths.map((p) => (
              <div key={p} className="flex items-center justify-between gap-2 p-2 bg-[#212122] border border-white/5 rounded-lg">
                <span className="text-[12px] font-mono text-[#d5d5d5] truncate">{p}</span>
                <button
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[#a0a0a0] hover:text-[#f87171] hover:bg-red-500/10 transition-colors"
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

  return (
    <div className="flex flex-col gap-3 p-3.5 bg-[#1a1a1c] border border-white/[0.06] rounded-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-[#ececec]">New skill</h4>
          <p className="text-[11px] text-[#a0a0a0] leading-relaxed mt-0.5">
            Skills are reusable prompts. Saved to <code className="text-[#c9c9c9] bg-white/5 px-1 py-0.5 rounded">~/.goat/agent/skills/&lt;name&gt;/SKILL.md</code>.
          </p>
        </div>
        <button
          onClick={() => setShowHelp((v) => !v)}
          className="shrink-0 text-[11px] text-[#a0a0a0] hover:text-[#ececec] transition-colors underline-offset-2 hover:underline"
        >
          {showHelp ? "Hide guide" : "How it works"}
        </button>
      </div>

      {showHelp && (
        <div className="flex flex-col gap-2 p-3 bg-[#212122] border border-white/5 rounded-lg text-[11.5px] text-[#b4b4b4] leading-relaxed">
          <p><strong className="text-[#ececec]">Name</strong> — short, kebab-case (e.g. <code className="bg-white/5 px-1 rounded">detail-mode</code>). Becomes the folder name.</p>
          <p><strong className="text-[#ececec]">Description</strong> — one or two sentences describing <em>when</em> to use the skill. The model reads this to decide whether to activate it.</p>
          <p><strong className="text-[#ececec]">Mode</strong> — <code className="bg-white/5 px-1 rounded">chat</code> shows it only in plain chat, <code className="bg-white/5 px-1 rounded">agent</code> only when tools are on, <code className="bg-white/5 px-1 rounded">both</code> in either.</p>
          <p><strong className="text-[#ececec]">Body</strong> — the actual instructions. Use plain markdown. Address the model directly: "You answer in plain prose…". Examples beat abstractions.</p>
          <p className="text-[#888]">Tip: keep it under ~30 lines. Long skills crowd the model's attention.</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[#a0a0a0]">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="detail-mode"
          maxLength={80}
          className="bg-[#1a1a1c] border border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-[#d5d5d5] placeholder:text-[#6a6a6c] focus:outline-none focus:border-white/10 transition-colors"
        />
        {name && slug !== name && (
          <span className="text-[10.5px] text-[#888]">Saved as <code className="bg-white/5 px-1 rounded">{slug}</code></span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[#a0a0a0]">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Use when the user wants longer, more detailed explanations with worked examples."
          rows={2}
          className="bg-[#1a1a1c] border border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-[#d5d5d5] placeholder:text-[#6a6a6c] focus:outline-none focus:border-white/10 transition-colors resize-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[#a0a0a0]">Mode</label>
        <div className="flex gap-1.5">
          {(["chat", "agent", "both"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                mode === m
                  ? "bg-accent/10 text-text-1 border border-accent/30"
                  : "bg-white/[0.04] text-[#a0a0a0] border border-white/5 hover:text-[#ececec] hover:bg-white/[0.06]"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[#a0a0a0]">Body (markdown)</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"You answer with thorough, well-structured explanations.\n\nRules:\n- Lead with the answer, then expand.\n- Include at least one worked example for non-trivial questions.\n- Use headings only when the response has multiple distinct sections."}
          rows={8}
          className="bg-[#1a1a1c] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-[#d5d5d5] placeholder:text-[#6a6a6c] focus:outline-none focus:border-white/10 transition-colors font-mono resize-y leading-relaxed"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[11.5px] text-[#fca5a5]">
          <AlertCircle size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-[12.5px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !description.trim() || !body.trim()}
          className="px-3.5 py-1.5 bg-accent text-bg text-[12.5px] font-medium rounded-lg hover:bg-[#f0903a] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Create skill"}
        </button>
      </div>
    </div>
  );
}
