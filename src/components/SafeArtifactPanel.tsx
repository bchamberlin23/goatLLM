import { Component, type ReactNode, type ErrorInfo } from "react";
import { ArtifactPanel } from "./ArtifactPanel";

interface State {
  hasError: boolean;
}

/**
 * Error boundary wrapper for ArtifactPanel.
 * Catches render errors and silently unmounts the panel instead of crashing the app.
 */
export class SafeArtifactPanel extends Component<{}, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log but don't crash the app
    console.warn("[SafeArtifactPanel] Caught error:", error.message);
  }

  componentDidUpdate(prevProps: {}) {
    // Reset error state when props change (e.g., new artifact selected)
    if (this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return null;
    return <ArtifactPanel />;
  }
}
