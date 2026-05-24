/**
 * Chat-mode code-execution toggle. Off by default since enabling it surfaces
 * `run_python` (shells to python3 on the user's machine) and `run_javascript`
 * (sandboxed Function eval) as approved tools available to the model.
 *
 * Same approval-gate behavior as agent mode: every call still pops the
 * approval dialog, so the model can suggest computation but the user has to
 * green-light each one.
 */
export function ChatCodeExecRow({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 p-3.5 bg-[#212122] border rounded-xl transition-colors ${
        enabled ? "border-blue-500/20" : "border-white/5"
      }`}
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-medium text-[#ececec]">
            Code Execution in Chat
          </span>
          <span
            className={`flex items-center gap-1.5 text-[11px] ${
              enabled ? "text-[#60a5fa]" : "text-[#a0a0a0]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                enabled ? "bg-[#60a5fa]" : "bg-[#4a4a4a]"
              }`}
            />
            {enabled ? "On" : "Off"}
          </span>
        </div>
        <span className="text-[11px] text-[#a0a0a0] leading-relaxed">
          Lets the model run short Python (via system <code>python3</code>) and
          JavaScript snippets to compute, plot, or transform data. Each call
          asks for your approval first.
        </span>
      </div>

      <div className="shrink-0">
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
          className={`relative w-10 h-6 rounded-full transition-colors ${
            enabled ? "bg-[#60a5fa]" : "bg-[#3a3a3a]"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
