import { StrictMode, Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import './index.css';

// FIX-ALL P0-4: Previously this file overrode window.alert/confirm/prompt with
// no-op / always-true stubs "for iframe friendliness". That silently disabled
// every destructive-action confirmation in the app (revoke session, revoke all
// sessions, delete Firebase account, GDPR "right to be forgotten" → real
// deleteUser + deleteDoc, etc.). Those overrides have been REMOVED. If an
// iframe sandbox blocks the native dialogs, the proper fix is in-app modal
// components (the codebase already has motion + AnimatePresence available).
// The error swallowers for ResizeObserver / "script error" noise are kept
// because they are genuinely safe to mute (browser noise unrelated to app logic).

if (typeof window !== "undefined") {
  window.onerror = function (message, _source, _lineno, _colno, _error) {
    const msg = String(message || "").toLowerCase();
    if (
      msg.includes("script error") ||
      msg.includes("resizeobserver") ||
      msg.includes("loop limit") ||
      msg.includes("undelivered notifications") ||
      msg === "script error" ||
      msg === "script error."
    ) {
      console.warn("Suppressed main.tsx script/resize error:", message);
      return true;
    }
    return false;
  };

  window.addEventListener("error", (event) => {
    const msg = String(event.message || "").toLowerCase();
    if (
      msg.includes("script error") ||
      msg.includes("resizeobserver") ||
      msg.includes("loop limit") ||
      msg.includes("undelivered notifications") ||
      msg === "script error" ||
      msg === "script error."
    ) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (reason) {
      const rStr = typeof reason === "string" ? reason : (reason.message || "");
      const msg = String(rStr).toLowerCase();
      if (
        msg.includes("script error") ||
        msg.includes("resizeobserver") ||
        msg.includes("loop limit") ||
        msg.includes("undelivered notifications") ||
        msg === "script error" ||
        msg === "script error."
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }
  }, true);
}

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an uncaught exception:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl space-y-4">
            <h1 className="text-xl font-bold text-red-400">Peringatan Sistem</h1>
            <p className="text-sm text-slate-400">
              Aplikasi mendeteksi interupsi minor dalam merender visual. Silakan tekan tombol di bawah untuk menyegarkan tampilan.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition cursor-pointer"
            >
              Segarkan Halaman
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // FIX-D-7: staleTime was 5s + refetchOnWindowFocus was true → combined with
      // per-component polls (Dashboard 8s/60s/600s, OnChainData 8s, App assets 2s)
      // this caused excessive API calls on every tab switch. Bumped to 30s and
      // disabled window-focus refetch (override per-query when genuinely needed).
      refetchOnWindowFocus: false,
      retry: 2,
      staleTime: 30 * 1000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
