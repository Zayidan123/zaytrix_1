// ZAYTRIX monitoring & alerting (SEC2-INFRA).
// Sentry SDK integration for error tracking + performance monitoring.
// In dev mode (no SENTRY_DSN), logs errors to console only.
// In production, set SENTRY_DSN env var to enable real Sentry reporting.

import * as Sentry from "@sentry/node";

let initialized = false;

export function initMonitoring() {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (dsn && dsn.length > 10) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: 0.1, // 10% of transactions traced
      profilesSampleRate: 0.1,
    });
    console.log("[monitoring] Sentry initialized (DSN configured).");
  } else {
    console.log("[monitoring] Sentry NOT initialized (no SENTRY_DSN). Errors logged to console only.");
  }
}

// Manual error capture helper
export function captureError(error: Error | string, context?: Record<string, any>) {
  if (process.env.SENTRY_DSN && process.env.SENTRY_DSN.length > 10) {
    if (context) Sentry.setContext("detail", context);
    Sentry.captureException(error);
  }
  // Always log to console
  console.error("[monitoring] error captured:", error, context ? JSON.stringify(context) : "");
}

// Express error handler middleware (should be last, before the 404)
export function sentryErrorHandler() {
  if (process.env.SENTRY_DSN && process.env.SENTRY_DSN.length > 10) {
    return Sentry.setupExpressErrorHandler();
  }
  // No-op if Sentry not configured
  return (_err: any, _req: any, _res: any, next: any) => next(_err);
}
