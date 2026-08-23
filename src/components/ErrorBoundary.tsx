import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: 24,
  textAlign: "center",
  fontFamily: "system-ui, sans-serif"
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 8,
  border: "none",
  background: "#e31b23",
  color: "#fff",
  fontSize: 16,
  cursor: "pointer"
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled app error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={shellStyle} role="alert">
        <h1 style={{ fontSize: 22, margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: 0, maxWidth: 420 }}>
          The app failed to load. This can happen after an update — reloading usually fixes it.
        </p>
        <p lang="or" style={{ margin: 0, maxWidth: 420 }}>
          ଆପ୍ ଲୋଡ୍ ହେବାରେ ସମସ୍ୟା ହେଲା। ଦୟାକରି ପୁଣି ଥରେ ଚେଷ୍ଟା କରନ୍ତୁ।
        </p>
        <button type="button" style={buttonStyle} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
