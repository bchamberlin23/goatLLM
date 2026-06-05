import { Component } from "react";
import { ArtifactPanel } from "./ArtifactPanel";

interface Props {
  resetKey?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary wrapper for ArtifactPanel.
 * Catches render errors and keeps a visible canvas fallback mounted.
 */
export class SafeArtifactPanel extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Log but don't crash the app
    console.warn("[SafeArtifactPanel] Caught error:", error.message);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="liquid-surface flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden">
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-[360px]">
              <div className="text-[13px] font-medium text-[#ececec]">Canvas could not render this artifact.</div>
              <div className="mt-1.5 text-[12px] text-[#a0a0a0] leading-relaxed">
                Select another artifact or close and reopen the canvas.
              </div>
            </div>
          </div>
        </div>
      );
    }
    return <ArtifactPanel />;
  }
}
