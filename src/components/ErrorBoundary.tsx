import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

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
      <div className="w-full h-screen flex items-center justify-center bg-bg text-text-1 p-6">
        <div className="modal-surface max-w-[520px] w-full flex flex-col gap-4 rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error/15 border border-error/25 flex items-center justify-center text-error">
              <TriangleAlert size={20} strokeWidth={1.9} aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h1 className="text-[16px] font-semibold">Something went wrong</h1>
              <p className="text-[12.5px] text-text-3 leading-relaxed">
                A render error caused this part of the app to stop. Your conversations are safe — they're saved on disk.
              </p>
            </div>
          </div>

          <pre className="text-[11.5px] font-mono text-error bg-sunken border border-error/15 rounded-lg px-3 py-2.5 overflow-auto max-h-[160px] whitespace-pre-wrap break-words">
            {message}
          </pre>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={this.handleCopy}
              className="control-pill px-3 py-1.5 rounded-md text-[12.5px] transition-colors"
            >
              Copy report
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="primary-action px-3.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
