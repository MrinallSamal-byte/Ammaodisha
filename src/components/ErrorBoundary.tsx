import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * App-wide crash containment. Without this, any render error unmounts the
 * whole tree and leaves citizens on a white screen — with no way back other
 * than editing the URL. Shows a branded recovery screen instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No external telemetry service is wired up — keep the evidence in the
    // console so support can reproduce from a single screenshot.
    console.error("Amma Odisha crashed:", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleHome = () => {
    // Full navigation clears the broken React tree and resets router state.
    window.location.assign("/");
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="loading-state error-boundary" role="alert">
        <img src="/logo.png" alt="Amma Odisha" />
        <h1>Something went wrong</h1>
        <p>
          Amma Odisha hit an unexpected error. Your reports are safe — this is only the screen.
          <br />
          <small>{error.message}</small>
        </p>
        <div className="error-boundary-actions">
          <button type="button" onClick={this.handleReload}>
            Reload Amma Odisha
          </button>
          <button type="button" className="secondary-inline" onClick={this.handleHome}>
            Back to the map
          </button>
        </div>
      </main>
    );
  }
}
