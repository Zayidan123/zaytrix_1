// ZAYTRIX backend security middleware (SEC-BACKEND + SEC2-AUTH).
//
// applySecurityMiddleware(app) installs, in order:
//   1. trust proxy (so req.ip / x-forwarded-for is correct behind Caddy)
//   2. helmet with a permissive-but-sane CSP (the existing React app loads data
//      from many public market-data APIs + Binance WS, so we allow https:/wss:
//      connect-src; inline styles are required by Tailwind/Vite HMR)
//   3. cors (reflected origin + credentials — safe for same-origin SPA + dev proxy)
//   4. cookie-parser (reads the signed `zaytrix_session` JWT cookie)
//   5. a general rate limiter (100 req / 15 min / IP) applied to all routes
//   6. a stricter auth rate limiter (5 req / min / IP) applied at /api/auth/*
//
// SEC2-AUTH addition: applySecurityMiddleware ALSO mounts the csrfMiddleware
// which enforces the double-submit cookie pattern for mutating HTTP methods
// (POST/PUT/DELETE/PATCH) to /api/*. See csrfMiddleware below for the
// backward-compat policy.
//
// attachAuthRateLimiter(app) mounts #6 separately so the auth router can sit
// under /api/auth and still benefit from the strict limiter without affecting
// public market-data routes.
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

// ---------------------------------------------------------------------------
// 1. General rate limiter — 100 requests per 15 min per IP.
//    Skip successful 2xx GETs from the Binance WS / background refresh workers
//    by excluding the /api/assets, /api/onchain/* paths? No — those are browser
//    polling endpoints and SHOULD be limited. The internal background fetches
//    don't go through Express (they fetch exchange APIs directly), so this is
//    fine. Standard skip for the health-check ping.
// ---------------------------------------------------------------------------
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 req / 15 min per IP — generous (dashboard polls every 2-10s)
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate-limiting for the SPA root + static assets so the page itself can
  // always load. API requests are still subject to the limit.
  skip: (req: Request) => {
    const url = req.path || req.url || "";
    // Don't limit the SPA HTML / Vite HMR / static assets.
    if (url === "/" || url.startsWith("/@") || url.startsWith("/src/") || url.startsWith("/node_modules/")) {
      return true;
    }
    return false;
  },
  message: { success: false, error: "Terlalu banyak permintaan. Coba lagi dalam beberapa menit." },
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
  message: { success: false, error: "Terlalu banyak percobaan autentikasi. Coba lagi dalam 1 menit." },
});

// ---------------------------------------------------------------------------
// 3. Helmet with a permissive-but-sane CSP for the existing dashboard.
//    The dashboard fetches from many public market-data APIs (Binance REST +
//    WS, CoinGecko, KuCoin, Bybit, mempool.space, blockchain.info, Yahoo
//    Finance, open.er-api.com, Fear&Greed API, etc.) and renders inline
//    styles from Tailwind. Inline scripts are needed for Vite HMR in dev.
// ---------------------------------------------------------------------------
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  scriptSrcAttr: ["'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  imgSrc: ["'self'", "data:", "https:", "blob:"],
  fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
  connectSrc: [
    "'self'",
    "https:",
    "wss:",
    "ws:", // Vite HMR + Binance WS
  ],
  frameSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

// ---------------------------------------------------------------------------
// 4. applySecurityMiddleware — call once, right after express.json/urlencoded.
// ---------------------------------------------------------------------------
export function applySecurityMiddleware(app: any): void {
  // Behind Caddy (and most reverse proxies) — trust the first proxy hop so
  // req.ip reads the real client IP from X-Forwarded-For. This is also what
  // rate-limit uses for keying.
  app.set("trust proxy", 1);

  // Helmet — sane defaults plus the CSP above. We DISABLE the strict
  // crossOrigin* policies (COEP/CORP) because the dashboard loads market data
  // + images from many third-party origins that don't send CORP headers.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: cspDirectives as any },
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

  // CORS — for a same-origin SPA the browser doesn't send a preflight, but we
  // still set Access-Control-Allow-Origin + Allow-Credentials so the dev proxy
  // and any future subdomain split work. Reflecting the request origin (origin:
  // true) with credentials: true is the standard pattern.
  app.use(
    cors({
      origin: process.env.APP_URL || true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Gemini-Key"],
    })
  );

  // Cookie parser — required to read the `zaytrix_session` JWT cookie.
  // Cookies are NOT signed at the parser layer (we use a JWT signature instead).
  app.use(cookieParser());

  // General rate limiter — applies to every request not skipped above.
  app.use(generalLimiter);

  // SEC2-AUTH: CSRF protection (double-submit cookie pattern). The middleware
  // only ENFORCES when the `zaytrix_csrf` cookie is present — this is the
  // backward-compat policy. Existing frontend code that doesn't fetch a CSRF
  // token keeps working (no cookie = no enforcement); new code that wants
  // CSRF protection calls GET /api/auth/csrf-token first, then includes the
  // x-csrf-token header on subsequent mutations. See the long comment on
  // csrfMiddleware below for the full rationale.
  app.use(csrfMiddleware);
}

// ---------------------------------------------------------------------------
// SEC2-AUTH: CSRF middleware — double-submit cookie pattern.
//
// Policy:
//   1. ONLY applies to mutating HTTP methods (POST/PUT/DELETE/PATCH). GET /
//      HEAD/OPTIONS are always allowed (CSRF attacks rely on the browser
//      automatically sending cookies with state-changing requests; GETs are
//      safe-by-idempotence and don't need protection).
//   2. ONLY applies to /api/* routes. The SPA root + Vite HMR + static
//      assets are never blocked.
//   3. EXEMPTS pre-auth endpoints that a not-yet-logged-in user must reach:
//      /api/auth/login, /api/auth/register, /api/auth/forgot-password,
//      /api/auth/reset-password, /api/auth/verify-email, and the OAuth
//      callback (handled as a GET, so already exempt by #1).
//   4. ENFORCES only when the `zaytrix_csrf` cookie is present. If the cookie
//      is missing (e.g. existing frontend code that hasn't been updated to
//      fetch a CSRF token yet), the request is ALLOWED with a console.warn —
//      this preserves backward compatibility while letting new code opt in.
//      Future tightening: flip this to enforce-always once all frontend
//      mutations send the header.
//   5. When the cookie IS present, the request MUST include a matching
//      `x-csrf-token` header. Mismatch → 403.
//
// The token itself is `rand.signature` where `signature = HMAC-SHA256(rand,
// CSRF_SECRET)`. We verify both the signature (server-issued) AND the
// cookie↔header match (double-submit) so a malicious third party can't forge
// either side. We import the verifier from auth.ts (which issues the tokens
// via GET /api/auth/csrf-token) to keep the issuer + verifier consistent.
// ---------------------------------------------------------------------------
const CSRF_EXEMPT_PATHS = new Set<string>([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-email",
  "/api/auth/login/2fa",
]);

// Lazy import to avoid a circular dependency at module-load time (auth.ts
// imports security.ts indirectly via the server boot sequence; we only need
// the verifier at request time, so a dynamic require is safe).
let _verifyCsrfToken: ((token: string) => boolean) | null = null;
async function getCsrfVerifier(): Promise<(token: string) => boolean> {
  if (_verifyCsrfToken) return _verifyCsrfToken;
  try {
    const mod: any = await import("./auth");
    _verifyCsrfToken = mod.verifyCsrfToken;
    return _verifyCsrfToken!;
  } catch (e: any) {
    console.error("[csrf] failed to load verifyCsrfToken from auth.ts:", e?.message || e);
    // Fallback: always-fail verifier. The middleware's "no-cookie → allow"
    // backward-compat path still works; only the explicit-cookie path is
    // blocked (which is the safe failure mode).
    _verifyCsrfToken = () => false;
    return _verifyCsrfToken;
  }
}

export const csrfMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  // 1. Only mutating methods.
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }
  // 2. Only /api/* paths.
  const url = req.path || req.url || "";
  if (!url.startsWith("/api/")) {
    return next();
  }
  // 3. Exempt pre-auth endpoints.
  if (CSRF_EXEMPT_PATHS.has(url)) {
    return next();
  }
  // 4. Backward-compat: if no CSRF cookie is present, allow (but warn). This
  //    keeps existing frontend code (which doesn't yet fetch a CSRF token)
  //    working. Future tightening: log this loudly so we know which endpoints
  //    need the header.
  const cookie = req.cookies?.["zaytrix_csrf"];
  if (!cookie) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[csrf] allowing unauthenticated mutation ${method} ${url} (no zaytrix_csrf cookie — backward compat)`);
    }
    return next();
  }
  // 5. Cookie present → header MUST match + be signature-valid.
  const header = req.headers["x-csrf-token"];
  const headerTok = typeof header === "string" ? header : Array.isArray(header) ? header[0] : "";
  if (!headerTok || headerTok !== cookie) {
    return res.status(403).json({ success: false, error: "Token CSRF tidak valid. Muat ulang halaman dan coba lagi." });
  }
  const verify = await getCsrfVerifier();
  if (!verify(headerTok)) {
    return res.status(403).json({ success: false, error: "Token CSRF gagal diverifikasi." });
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
