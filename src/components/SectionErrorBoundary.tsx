// OPT-2b: per-section error boundary — isolates crashes to the failing section.
//
// Background: src/main.tsx has ONE global ErrorBoundary wrapping the entire
// <App />. A render-time throw in ANY widget (e.g. Recharts undefined data,
// motion variant crash, optional-chaining typo) blanks the whole dashboard.
// This SectionErrorBoundary wraps individual widgets so that a crash only
// surfaces as an inline "Widget Error" card with a "Coba Lagi" retry button,
// while the rest of the dashboard keeps rendering.
//
// Usage:
//   <SectionErrorBoundary sectionName="Risk Score">
//     <RiskScoreWidget />
//   </SectionErrorBoundary>
import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  sectionName: string;
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[${this.props.sectionName}] section error:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-slate-900/50 border border-red-800/40 rounded-2xl p-6 text-center">
          <p className="text-sm font-bold text-red-400 mb-2">⚠️ {this.props.sectionName} Error</p>
          <p className="text-xs text-slate-400 mb-3">{this.state.error?.message || "Komponen gagal dimuat"}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 text-xs rounded-lg border border-red-700/40 transition-colors"
          >
            Coba Lagi
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
