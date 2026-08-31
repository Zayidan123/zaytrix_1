// ZAYTRIX backend security middleware (SEC-BACKEND + SEC2-AUTH).
//
// applySecurityMiddleware(app) installs, in order:
//   1. trust proxy (so req.ip / x-forwarded-for is correct behind Caddy)
//   2. helmet with a tightened CSP (SEC-16)
//   3. cors with an EXPLICIT allowlist (SEC-7 — no reflect-any)
//   4. cookie-parser (reads the `zaytrix_session` JWT cookie)
//   5. a general rate limiter (500 req / 15 min / IP) for everything EXCEPT
//      high-frequency read-only polling endpoints (FUNC-7)
//   6. a generous polling rate limiter (3000 req / 15 min / IP) for those
//      polling endpoints (FUNC-7 — the app itself polls /api/assets every
//      2s ≈ 450 req/15min, which previously self-DoS'd the general limiter)
//   7. csrfMiddleware — FULL double-submit enforcement (SEC-6)
//
// attachAuthRateLimiter(app) mounts the strict auth limiter separately so the
// auth router can sit under /api/auth and still benefit from the strict
// limiter without affecting public market-data routes.
//
// sanitizeError(err, req, res, next) is the FINAL error handler — it never leaks
// err.message to the client in production. In dev (NODE_ENV !== "production")
// the message is included for debugging convenience.
//
// All exports are safe to call multiple times (idempotent-ish — Express will
// just register middleware in order).

import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { recordRateLimitHit } from "./alerting";

// ---------------------------------------------------------------------------
// FUNC-7: high-frequency read-only polling endpoints.
// The SPA polls these on 2-10s intervals from every open dashboard:
//   /api/assets every 2s ≈ 450 req/15min from ONE tab — with the old single
//   500/15min general limiter the app DoS'd ITSELF after ~13 minutes.
// Solution: GET/HEAD requests to these paths skip the general limiter and get
// their own generous limit (3000/15min/IP). Mutations on the same prefixes
// (e.g. POST /api/assets/register) still count against the general limiter.
// ---------------------------------------------------------------------------
const POLLING_EXACT_PATHS = new Set<string>([
  "/api/assets",
  "/api/news",
  "/api/trading-signals/history",
]);
const POLLING_PATH_PREFIXES = [
  "/api/onchain",
  "/api/live",
  "/api/coins",
  "/api/fx",
  "/api/health",
];

function isPollingPath(url: string): boolean {
  if (POLLING_EXACT_PATHS.has(url)) return true;
  return POLLING_PATH_PREFIXES.some((p) => url === p || url.startsWith(p + "/") || url.startsWith(p + "?"));
}

function isReadOnlyMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

// ---------------------------------------------------------------------------
// 1. General rate limiter — 500 requests per 15 min per IP.
//    Skips the SPA shell / Vite HMR / static assets, and (FUNC-7) skips
//    read-only polling requests which are handled by pollLimiter below.
// ---------------------------------------------------------------------------
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 req / 15 min per IP for non-polling traffic
  standardHeaders: true,
  legacyHeaders: false,
  // FIX-ALL H4: record a rate-limit-hit metric whenever a request is throttled
  // (drives the `rate_limit_abuse` alert rule).
  handler: (_req: Request, _res: Response, _next: NextFunction) => {
    try { recordRateLimitHit(); } catch {}
    _res.status(429).json({ success: false, error: "Terlalu banyak permintaan. Coba lagi dalam beberapa menit." });
  },
  // FIX-ALL M8: skip rate limiting entirely when running the vitest suite so
  // integration tests against the running dev server are not throttled.
  skip: (req: Request) => {
    if (process.env.NODE_ENV === "test") return true;
    const url = req.path || req.url || "";
    // Don't limit the SPA HTML / Vite HMR / static assets.
    if (url === "/" || url.startsWith("/@") || url.startsWith("/src/") || url.startsWith("/node_modules/")) {
      return true;
    }
    // FUNC-7: read-only polling traffic gets its own (generous) limiter.
    if (isReadOnlyMethod((req.method || "GET").toUpperCase()) && isPollingPath(url)) {
      return true;
    }
    return false;
  },
  message: { success: false, error: "Terlalu banyak permintaan. Coba lagi dalam beberapa menit." },
});

// ---------------------------------------------------------------------------
// FUNC-7: polling rate limiter — 3000 requests / 15 min / IP for the
// high-frequency read-only dashboard endpoints. Applies ONLY to GET/HEAD
// requests on the polling paths (everything else is skipped, so it never
// accidentally covers auth/mutation routes).
// ---------------------------------------------------------------------------
const pollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3000, // generous: 450 req/15min per polling tab + headroom
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, _next: NextFunction) => {
    try { recordRateLimitHit(); } catch {}
    _res.status(429).json({ success: false, error: "Terlalu banyak permintaan polling. Coba lagi dalam beberapa menit." });
  },
  skip: (req: Request) => {
    if (process.env.NODE_ENV === "test") return true;
    const url = req.path || req.url || "";
    // Only count read-only polling traffic.
    if (!isReadOnlyMethod((req.method || "GET").toUpperCase())) return true;
    return !isPollingPath(url);
  },
  message: { success: false, error: "Terlalu banyak permintaan polling. Coba lagi dalam beberapa menit." },
});

// ---------------------------------------------------------------------------
// 2. Auth rate limiter — 5 attempts per minute per IP for /api/auth/*.
//    Prevents brute-force login/register attacks.
// ---------------------------------------------------------------------------
export const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 auth attempts per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  // FIX-ALL H4: record a rate-limit-hit metric whenever an auth request is throttled.
  handler: (_req: Request, _res: Response, _next: NextFunction) => {
    try { recordRateLimitHit(); } catch {}
    _res.status(429).json({ success: false, error: "Terlalu banyak percobaan autentikasi. Coba lagi dalam 1 menit." });
  },
  // FIX-ALL M8: skip rate limiting entirely in vitest runs so auth integration
  // tests (which fire >5 requests to /api/auth/* within 60s) don't all 429.
  skip: () => process.env.NODE_ENV === "test",
  message: { success: false, error: "Terlalu banyak percobaan autentikasi. Coba lagi dalam 1 menit." },
});

// ---------------------------------------------------------------------------
// 3. Helmet with a TIGHTENED CSP (SEC-16).
//    The dashboard fetches market data from a known, auditable set of public
//    APIs (verified by grepping server.ts + src/** for every fetch/WS host).
//    Changes vs the old policy:
//      - scriptSrc: 'unsafe-eval' REMOVED in production (Vite HMR needs it in
//        dev only). 'unsafe-inline' is kept because index.html contains a real
//        inline <script> (the error-shield in <head>) — removing it would break
//        the SPA shell.
//      - connectSrc: the old "https:" + "wss:" allowed exfiltration to ANY
//        host (e.g. an XSS could beacon to attacker.com). Now restricted to
//        the actual upstreams this app talks to.
// ---------------------------------------------------------------------------
const CSP_CONNECT_UPSTREAMS = [
  "'self'",
  // Binance market data (client WS streams + REST + futures REST/WS)
  "wss://stream.binance.com",
  "wss://fstream.binance.com",
  "https://api.binance.com",
  "https://fapi.binance.com",
  // Market-data aggregates (server-side + client-side)
  "https://api.coingecko.com",
  "https://api.coinpaprika.com",
  "https://api.alternative.me",
  // BTC on-chain (server cache + whale tracker)
  "https://mempool.space",
  "https://api-mempool.space",
  "https://blockstream.info",
  "https://api.blockchain.info",
  "https://blockchain.info",
  // Equities / macro / FX
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
  "https://min-api.cryptocompare.com",
  "https://open.er-api.com",
  // News feeds
  "https://production.api.coindesk.com",
  "https://www.coindesk.com",
  "https://feeds.simplecast.com",
  "https://cointelegraph.com",
  // AI providers (Gemini — also reachable directly from the browser)
  "https://api.gemini.google.com",
  "https://generativelanguage.googleapis.com",
  // Exchange REST APIs called directly from the browser (Settings ping,
  // HYPE fallback ticker in App.tsx)
  "https://api.bybit.com",
  "https://api.gateio.ws",
  "https://api.kucoin.com",
];

function buildCspDirectives(): Record<string, (string | boolean)[]> {
  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = isProd
    ? ["'self'", "'unsafe-inline'"] // index.html has a real inline <script> — required
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'"]; // dev: Vite HMR / deps optimizer need eval
  const connectSrc = isProd
    ? CSP_CONNECT_UPSTREAMS
    : [...CSP_CONNECT_UPSTREAMS, "ws:", "wss:", "http://localhost", "http://127.0.0.1"]; // dev: Vite HMR ws + local tooling
  return {
    defaultSrc: ["'self'"],
    scriptSrc,
    scriptSrcAttr: ["'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    imgSrc: ["'self'", "data:", "https:", "blob:"],
    fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
    connectSrc,
    frameSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
}

// ---------------------------------------------------------------------------
// SEC-7: CORS allowlist. The old `origin: process.env.APP_URL || true`
// reflected ANY request origin back with credentials:true — a classic
// CORS misconfiguration (any malicious site could read authenticated
// responses cross-origin). Now:
//   - APP_URL is parsed as a comma-separated allowlist.
//   - localhost/127.0.0.1 dev origins are allowed in non-production only.
//   - Only allowlisted origins get CORS headers; anything else (and requests
//     with no Origin header) get NO CORS headers — the browser blocks them.
//   - credentials:true stays (cookie-based auth needs it).
// Built lazily on the first request because this module is imported BEFORE
// dotenv.config() runs in server.ts (APP_URL comes from .env).
// ---------------------------------------------------------------------------
let corsAllowlistCache: Set<string> | null = null;
function getCorsAllowlist(): Set<string> {
  if (corsAllowlistCache) return corsAllowlistCache;
  const origins = new Set<string>();
  const raw = process.env.APP_URL || "";
  // APP_URL may be a single URL or a comma-separated list of allowed origins.
  for (const part of raw.split(",")) {
    const o = part.trim().replace(/\/+$/, "");
    if (o) origins.add(o);
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://localhost:4173");
    origins.add("http://127.0.0.1:3000");
  }
  corsAllowlistCache = origins;
  return origins;
}

// ---------------------------------------------------------------------------
// 4. applySecurityMiddleware — call once, right after express.json/urlencoded.
// ---------------------------------------------------------------------------
export function applySecurityMiddleware(app: any): void {
  // Behind Caddy (and most reverse proxies) — trust the first proxy hop so
  // req.ip reads the real client IP from X-Forwarded-For. This is also what
  // rate-limit uses for keying.
  app.set("trust proxy", 1);

  // Helmet — sane defaults plus the tightened CSP above. We DISABLE the strict
  // crossOrigin* policies (COEP/CORP) because the dashboard loads market data
  // + images from many third-party origins that don't send CORP headers.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: buildCspDirectives() as any },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: false,
      // Keep the X-Frame-Options equivalent (frameAncestors 'none' in CSP) but
      // also send the legacy header for older browsers.
      frameguard: { action: "deny" },
      // Allow mixed-content passthrough during dev (Caddy terminates TLS in prod).
      noSniff: true,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    })
  );

  // CORS (SEC-7) — explicit allowlist, never reflect-any.
  app.use(
    cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // No Origin header (same-origin request / curl / server-to-server) →
        // no CORS headers needed at all.
        if (!origin) return callback(null, false);
        return callback(null, getCorsAllowlist().has(origin));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Gemini-Key", "X-CSRF-Token"],
    })
  );

  // Cookie parser — required to read the `zaytrix_session` JWT cookie.
  // Cookies are NOT signed at the parser layer (we use a JWT signature instead).
  app.use(cookieParser());

  // General rate limiter — applies to every request not skipped above.
  app.use(generalLimiter);

  // FUNC-7: generous limiter for high-frequency read-only polling endpoints.
  app.use(pollLimiter);

  // SEC-6: CSRF protection — full double-submit cookie pattern. See
  // csrfMiddleware below.
  app.use(csrfMiddleware);
}

// ---------------------------------------------------------------------------
// SEC-6: CSRF middleware — FULL double-submit cookie pattern.
//
// CONTRACT (for the frontend fetch wrapper — agent 3-c):
//   - Cookie:  `zaytrix_csrf`  (httpOnly:false — JS must read it via
//     document.cookie; sameSite:lax; path:/; 24h max-age)
//   - Header:  `X-CSRF-Token`  (must equal the cookie value; the value is also
//     HMAC-SHA256 signed by the server, so it cannot be forged)
//   - This middleware auto-sets the cookie on ANY response that lacks it
//     (including the SPA HTML on first load), so a fresh page load always has
//     a valid token before the first mutation.
//   - On 403 {"error":"CSRF token tidak valid"} the client should GET
//     /api/auth/csrf-token (refreshes the cookie) and retry once.
//
// Policy:
//   1. ONLY state-changing methods (POST/PUT/PATCH/DELETE) are checked.
//      GET/HEAD/OPTIONS pass (idempotent — no CSRF risk).
//   2. ONLY /api/* paths are checked. SPA HTML / Vite HMR / static assets pass.
//   3. EXEMPT paths (pre-session login/recovery flows + OAuth redirect flows +
//      health probes): listed below. These endpoints have no session cookie to
//      ride, so CSRF adds nothing there (they are protected by the auth rate
//      limiter + their own anti-abuse logic).
//   4. Everything else state-changing MUST present a matching X-CSRF-Token
//      header; mismatch/absence → 403. (Previously the middleware allowed any
//      mutation without a cookie — enforcement was opt-in and therefore off.)
//   5. NODE_ENV === "test" bypasses enforcement entirely (vitest suites).
// ---------------------------------------------------------------------------
const CSRF_COOKIE_NAME = "zaytrix_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

const CSRF_EXEMPT_PATHS = new Set<string>([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/login/2fa",
  "/api/auth/2fa/backup-login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/auth/google", // GET redirect flow
  "/api/auth/google/callback", // GET redirect flow
  "/api/auth/google/2fa", // pre-session 2FA completion (reads short-lived cookie)
]);
const CSRF_EXEMPT_PREFIXES = [
  "/api/auth/webauthn/", // passkey register/login ceremonies (pre-session login)
  "/api/health", // /api/health + /api/health/detailed probes
];

function isCsrfExempt(url: string): boolean {
  if (CSRF_EXEMPT_PATHS.has(url)) return true;
  return CSRF_EXEMPT_PREFIXES.some((p) => url.startsWith(p));
}

// Timing-safe string equality (cookie ↔ header) — defense in depth.
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

// Lazy import to avoid a circular dependency at module-load time (auth.ts
// imports security.ts indirectly via the server boot sequence; we only need
// the issuer/verifier at request time, so a dynamic import is safe — and it
// also guarantees auth.ts is loaded AFTER dotenv.config() has run, when
// SESSION_SECRET/CSRF_SECRET from .env are visible).
interface CsrfTokenModule {
  makeCsrfToken: () => string;
  verifyCsrfToken: (token: string) => boolean;
}
let _csrfTokenModule: CsrfTokenModule | null = null;
async function getCsrfTokenModule(): Promise<CsrfTokenModule> {
  if (_csrfTokenModule) return _csrfTokenModule;
  try {
    const mod: any = await import("./auth");
    _csrfTokenModule = {
      makeCsrfToken: mod.makeCsrfToken,
      verifyCsrfToken: mod.verifyCsrfToken,
    };
    return _csrfTokenModule;
  } catch (e: any) {
    console.error("[csrf] failed to load CSRF token helpers from auth.ts:", e?.message || e);
    // Fail-closed fallback: nothing can be issued or verified.
    _csrfTokenModule = {
      makeCsrfToken: () => {
        throw new Error("CSRF issuer unavailable");
      },
      verifyCsrfToken: () => false,
    };
    return _csrfTokenModule;
  }
}

export const csrfMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  // (a) Seed the double-submit cookie on ANY response that lacks it. The SPA
  //     reads document.cookie and echoes the value in the X-CSRF-Token header.
  //     httpOnly MUST stay false — that's the whole point of double-submit.
  const existingCookie = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE_NAME];
  if (!existingCookie) {
    try {
      const mod = await getCsrfTokenModule();
      const token = mod.makeCsrfToken();
      res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: CSRF_COOKIE_MAX_AGE_MS,
      });
    } catch (e: any) {
      // Missing SESSION_SECRET/CSRF_SECRET — auth flows will refuse to work
      // anyway (auth.ts throws). Never block the response for the seed itself.
      console.error("[csrf] failed to seed CSRF cookie:", e?.message || e);
    }
  }

  // (b) Enforcement — only state-changing methods.
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }
  // Test bypass (vitest).
  if (process.env.NODE_ENV === "test") {
    return next();
  }
  // Only /api/* paths.
  const url = req.path || req.url || "";
  if (!url.startsWith("/api/")) {
    return next();
  }
  // Exempt pre-auth endpoints + GET redirect flows.
  if (isCsrfExempt(url)) {
    return next();
  }
  // Full double-submit: cookie MUST exist AND header MUST match it AND the
  // token signature MUST be valid (server-issued).
  const cookieVal = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE_NAME];
  const headerRaw = req.headers[CSRF_HEADER_NAME];
  const headerVal = typeof headerRaw === "string" ? headerRaw : Array.isArray(headerRaw) ? headerRaw[0] : "";
  if (!cookieVal || !headerVal || !timingSafeEqualStr(headerVal, cookieVal)) {
    return res.status(403).json({ success: false, error: "CSRF token tidak valid" });
  }
  const mod = await getCsrfTokenModule();
  if (!mod.verifyCsrfToken(headerVal)) {
    return res.status(403).json({ success: false, error: "CSRF token tidak valid" });
  }
  return next();
};

// ---------------------------------------------------------------------------
// 5. sanitizeError — FINAL error handler. Mount LAST (after every route +
//    the Vite/static catch-all). Returns a generic Indonesian error message
//    to the client without leaking err.message, EXCEPT in dev.
// ---------------------------------------------------------------------------
export const sanitizeError: ErrorRequestHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Log the real error server-side for debugging / incident response.
  console.error("[sanitizeError]", {
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip,
    message: err?.message,
    stack: err?.stack?.split("\n").slice(0, 5).join(" | "),
  });

  const isApi =
    (req.originalUrl || req.url || "").startsWith("/api/") ||
    (req.xhr || (req.headers.accept || "").includes("application/json"));

  const isProd = process.env.NODE_ENV === "production";

  if (isApi) {
    return res.status(err?.status || err?.statusCode || 500).json({
      success: false,
      error: isProd
        ? "Terjadi kesalahan internal. Tim telah diberi tahu."
        : err?.message || "Terjadi kesalahan internal.",
    });
  }

  // Non-API (e.g. SPA route) — return a plain 500 so the SPA shell can still
  // render. In dev, include the message for visibility.
  return res.status(err?.status || err?.statusCode || 500).send(
    isProd
      ? "Internal Server Error"
      : `Internal Server Error: ${err?.message || String(err)}`
  );
};

// Convenience: a 404 handler for unmatched /api/* routes (mounted BEFORE the
// SPA catch-all). Returns JSON instead of the SPA HTML for unknown API calls.
export const apiNotFound: RequestHandler = (req, res) => {
  res.status(404).json({ success: false, error: "Endpoint tidak ditemukan." });
};
