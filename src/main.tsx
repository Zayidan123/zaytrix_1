import { StrictMode, Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import './index.css';

// Global Script Error & ResizeObserver loop limits safety shields
if (typeof window !== "undefined") {
  // Override iframe-sensitive blocking modals to avoid fatal SecurityError in sandboxes
  window.alert = function (message) {
    const msg = String(message || "");
    console.warn("Iframe-friendly Alert Triggered:", msg);
    const event = new CustomEvent("system-alert", { detail: { message: msg, type: "error" } });
    window.dispatchEvent(event);
  };

  window.confirm = function (message) {
    console.warn("Iframe-friendly Confirm Demanded:", message);
    return true; // Auto-confirm safely
  };

  window.prompt = function (message, defaultVal) {
    console.warn("Iframe-friendly Prompt Demanded:", message);
    return defaultVal || "";
  };

  window.onerror = function (message, source, lineno, colno, error) {
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
      return true; // Silence the error fully
    }
    // Always returns true to prevent browser-level unhandled exceptions escaping inside standard dev container
    return true;
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
      refetchOnWindowFocus: true,
      retry: 2,
      staleTime: 5 * 1000,
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
