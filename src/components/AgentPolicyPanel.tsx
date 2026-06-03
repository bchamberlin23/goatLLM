import { Shield, X } from "lucide-react";
import { useState } from "react";
import { applyBudgetControls, evaluatePathPermission } from "../lib/agent-session";
import { useChatStore } from "../stores/chat";

const profiles: Array<{ id: "strict" | "default" | "fast"; label: string }> = [
  { id: "strict", label: "Manual" },
  { id: "default", label: "Balanced" },
  { id: "fast", label: "Full auto" },
];

export function AgentPolicyPanel({ embedded = false }: { embedded?: boolean }) {
  const policy = useChatStore((s) => s.verificationPolicy);
  const setPolicy = useChatStore((s) => s.setVerificationPolicy);
  const profile = useChatStore((s) => s.permissionProfile);
  const setProfile = useChatStore((s) => s.setPermissionProfile);
  const pathRules = useChatStore((s) => s.pathPermissionRules);
  const budget = useChatStore((s) => s.agentBudgetControls);
  const setBudget = useChatStore((s) => s.setAgentBudgetControls);
  const projectCheckMemory = useChatStore((s) => s.projectCheckMemory);
  const setProjectCheckMemory = useChatStore((s) => s.setProjectCheckMemory);
  const [customCommand, setCustomCommand] = useState("");

  const addCustomCommand = () => {
    const command = customCommand.trim();
    if (!command || policy.customCommands.includes(command)) return;
    setPolicy({ ...policy, customCommands: [...policy.customCommands, command] });
    setCustomCommand("");
  };

  return (
    <div className={embedded ? "w-full rounded-xl border border-white/5 bg-surface-3 p-3.5" : "w-full max-w-[720px] rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2"}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Shield size={13} strokeWidth={1.8} className="shrink-0 text-text-4" aria-hidden />
          {!embedded && <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Agent policy</span>}
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-md border border-white/[0.08]">
          {profiles.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setProfile(item.id)}
              className={`px-2 py-1 text-[10.5px] font-medium transition-colors ${
                profile === item.id ? "bg-white text-black" : "bg-transparent text-text-3 hover:bg-white/[0.06]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-text-3">
          <input
            type="checkbox"
            checked={policy.requireBuildForWeb}
            onChange={(event) => setPolicy({ ...policy, requireBuildForWeb: event.currentTarget.checked })}
          />
          Require build after web changes
        </label>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-text-3">
          <input
            type="checkbox"
            checked={policy.requireRustTests}
            onChange={(event) => setPolicy({ ...policy, requireRustTests: event.currentTarget.checked })}
          />
          Require Rust tests
        </label>
      </div>
      <div className="mt-2 flex min-w-0 gap-1.5">
        <input
          value={customCommand}
          onChange={(event) => setCustomCommand(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustomCommand();
            }
          }}
          placeholder="Add required check"
          className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-[11px] text-text-2 outline-none placeholder:text-text-4"
        />
        <button
          type="button"
          onClick={addCustomCommand}
          className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-text-3 transition-colors hover:bg-white/[0.07]"
        >
          Add
        </button>
      </div>
      {policy.customCommands.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {policy.customCommands.map((command) => (
            <span key={command} className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] text-text-3">
              {command}
              <button
                type="button"
                aria-label={`Remove ${command}`}
                onClick={() => setPolicy({ ...policy, customCommands: policy.customCommands.filter((item) => item !== command) })}
                className="rounded-sm p-0.5 text-text-4 hover:bg-white/10 hover:text-text-2"
              >
                <X size={9} strokeWidth={2} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      {projectCheckMemory.successfulCommands.length > 0 && (
        <div className="mt-2 grid gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.025] p-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-text-4">Learned checks</div>
          <div className="flex flex-wrap gap-1">
            {projectCheckMemory.successfulCommands.map((command) => (
              <span key={command} className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] text-text-3">
                {command}
                <button
                  type="button"
                  aria-label={`Forget ${command}`}
                  onClick={() => setProjectCheckMemory({
                    ...projectCheckMemory,
                    successfulCommands: projectCheckMemory.successfulCommands.filter((item) => item !== command),
                  })}
                  className="rounded-sm p-0.5 text-text-4 hover:bg-white/10 hover:text-text-2"
                >
                  <X size={9} strokeWidth={2} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="mt-2 grid gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.025] p-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-text-4">Path rules</div>
        <div className="flex flex-wrap gap-1">
          {pathRules.map((rule) => (
            <span key={`${rule.pattern}-${rule.action}`} className="rounded-md border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] text-text-3">
              {rule.pattern}: {rule.action}
            </span>
          ))}
        </div>
        <div className="text-[10.5px] text-text-4">
          `src/App.tsx` currently: {evaluatePathPermission("src/App.tsx", pathRules)}
        </div>
      </div>
      <div className="mt-2 grid gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.025] p-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-text-4">Run budget</div>
        <div className="grid grid-cols-3 gap-1.5">
          <input
            aria-label="Max tool calls"
            type="number"
            min={1}
            value={budget.maxToolCalls}
            onChange={(event) => setBudget({ ...budget, maxToolCalls: Number(event.currentTarget.value) || 1 })}
            className="min-w-0 rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-[11px] text-text-2 outline-none"
          />
          <input
            aria-label="Max subagents"
            type="number"
            min={0}
            value={budget.maxSubagents}
            onChange={(event) => setBudget({ ...budget, maxSubagents: Number(event.currentTarget.value) || 0 })}
            className="min-w-0 rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-[11px] text-text-2 outline-none"
          />
          <input
            aria-label="Max minutes"
            type="number"
            min={1}
            value={budget.maxMinutes}
            onChange={(event) => setBudget({ ...budget, maxMinutes: Number(event.currentTarget.value) || 1 })}
            className="min-w-0 rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-[11px] text-text-2 outline-none"
          />
        </div>
        <div className="text-[10.5px] text-text-4">{applyBudgetControls(budget)}</div>
      </div>
    </div>
  );
}
