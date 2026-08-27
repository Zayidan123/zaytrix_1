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
      // OPT-1f: scrub PII from Sentry events before they leave the process.
      // Removes Authorization/Cookie headers, strips query params (which may
      // carry tokens) from request URLs, and redacts any extra context keys
      // whose name looks like a secret (token/password/secret/key/email/api).
      beforeSend(event) {
        try {
          if (event.request) {
            if (event.request.headers) {
              delete event.request.headers.authorization;
              delete event.request.headers.Authorization;
              delete event.request.headers.cookie;
              delete event.request.headers.Cookie;
            }
            if (event.request.url) {
              // drop query string — may contain access tokens / API keys
              event.request.url = String(event.request.url).split("?")[0];
            }
            if (event.request.query_string) {
              event.request.query_string = "";
            }
          }
          if (event.extra && typeof event.extra === "object") {
            const scrubbed: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(event.extra)) {
              if (/token|password|secret|key|email|api/i.test(key)) {
                scrubbed[key] = "[REDACTED]";
              } else {
                scrubbed[key] = value;
              }
            }
            event.extra = scrubbed;
          }
        } catch {
          // Never let the scrubber itself drop an event — return as-is.
        }
        return event;
      },
    });
    console.log("[monitoring] Sentry initialized (DSN configured, PII scrubbing on).");
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
// FIX-ALL M3: accept the Express `app` instance so Sentry's Express error
// handler can correctly instrument request isolation / tracing data. The
// previous version called Sentry.setupExpressErrorHandler() with no args,
// which (per the Sentry Node SDK docs) requires the app to be passed in.
//
// Sentry's setupExpressErrorHandler(app) REGISTERS its own error handler on
// the app and returns void — it is NOT itself an Express middleware. So this
// function returns a no-op pass-through middleware for callers that still
// want to `app.use(sentryErrorHandler(app))`; the real Sentry capture is
// performed as a side effect of the call.
export function sentryErrorHandler(app?: any) {
  if (process.env.SENTRY_DSN && process.env.SENTRY_DSN.length > 10) {
    try {
      // Sentry v10+ requires the Express `app` instance — without it we can't
      // register the error handler. If no app is passed we log + skip.
      if (app) {
        Sentry.setupExpressErrorHandler(app);
      } else {
        console.warn("[monitoring] sentryErrorHandler called without app — Sentry Express error handler NOT registered.");
      }
    } catch (e: any) {
      console.error("[monitoring] Sentry setupExpressErrorHandler failed:", e?.message || e);
    }
  }
  // Always return a no-op pass-through so callers can mount this with
  // app.use(sentryErrorHandler(app)) without Sentry being configured.
  return (_err: any, _req: any, _res: any, next: any) => next(_err);
}
