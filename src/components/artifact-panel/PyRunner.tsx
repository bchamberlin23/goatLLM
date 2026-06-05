interface PyRunnerProps {
  error: string | null;
  output: string | null;
  running: boolean;
  onRun: () => void;
}

export function PyRunner({ error, output, running, onRun }: PyRunnerProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-4 py-2 bg-[#161618] shrink-0 border-b border-white/5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#a0a0a0]">
          Output
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
            running ? "control-pill opacity-70" : "primary-action"
          }`}
        >
          {running ? "Running..." : "Run"}
        </button>
      </div>
      {output !== null && (
        <pre className="flex-1 p-4 text-[13px] font-mono text-[#d5d5d5] whitespace-pre-wrap overflow-auto m-0">
          {output}
        </pre>
      )}
      {error && (
        <div className="p-3 text-[12px] text-[#f87171] whitespace-pre-wrap border-t border-white/5">
          {error}
        </div>
      )}
      {output === null && !running && !error && (
        <p className="flex-1 flex items-center justify-center text-[12px] text-[#a0a0a0]">
          Click Run to execute.
        </p>
      )}
    </div>
  );
}
