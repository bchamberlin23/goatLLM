import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Top-level error boundary. Catches render-time errors from anywhere in the
 * tree and presents a recovery surface so the app does not whitescreen.
 *
 * The user can:
 *   - Reload the app (refreshes the renderer; their conversations persist
 *     because they live in SQLite, not in-memory state).
 *   - Copy the error to clipboard so they can paste it into a bug report.
 *
 * Logs to console as well so the issue can be inspected via the Tauri
 * inspector or browser devtools when running `pnpm dev`.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Render error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleCopy = async () => {
    const { error, errorInfo } = this.state;
    const text = [
      "goatLLM error report",
      `Date: ${new Date().toISOString()}`,
      `URL: ${window.location.href}`,
      `User-Agent: ${navigator.userAgent}`,
      "",
      "--- Error ---",
      String(error?.stack ?? error ?? "(no error)"),
      "",
      "--- Component stack ---",
      String(errorInfo?.componentStack ?? "(no component stack)"),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: open a window with the text the user can copy manually.
      const w = window.open("", "_blank");
      if (w) {
        w.document.body.innerText = text;
      }
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.error?.message || "An unknown error occurred";

    return (
      <div className="w-full h-screen flex items-center justify-center bg-[#1a1a1c] text-[#ececec] p-6">
        <div className="max-w-[520px] w-full flex flex-col gap-4 bg-[#2a2a2c] border border-white/10 rounded-2xl p-6 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#f87171]/15 border border-[#f87171]/25 flex items-center justify-center text-[#f87171]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="flex-1">
              <h1 className="text-[16px] font-semibold tracking-[-0.01em]">Something went wrong</h1>
              <p className="text-[12.5px] text-[#a0a0a0] leading-relaxed">
                A render error caused this part of the app to stop. Your conversations are safe — they're saved on disk.
              </p>
            </div>
          </div>

          <pre className="text-[11.5px] font-mono text-[#fca5a5] bg-[#1a1a1c] border border-[#f87171]/15 rounded-lg px-3 py-2.5 overflow-auto max-h-[160px] whitespace-pre-wrap break-words">
            {message}
          </pre>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={this.handleCopy}
              className="px-3 py-1.5 rounded-md text-[12.5px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
            >
              Copy report
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-3.5 py-1.5 rounded-md text-[12.5px] font-medium bg-[#f59e42] hover:bg-[#f0903a] text-[#1a1a1c] transition-colors"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
