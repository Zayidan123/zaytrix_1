import { createLogger } from "./logger";
const log = createLogger("oauth");

// ZAYTRIX Google OAuth (SEC2-AUTH).
//
// Manual OAuth 2.0 Authorization Code flow (no Passport dependency) — keeps
// the dependency surface small + the flow easy to audit. Endpoints:
//
//   GET  /api/auth/google           → redirect to Google consent screen
//                                      (FUNC-12: redirects to
//                                      /?oauth_error=oauth_tidak_dikonfigurasi
//                                      when unconfigured — browser-friendly,
//                                      not a raw 503 JSON blob)
//   GET  /api/auth/google/callback  → exchange code → tokens → user profile,
//                                      find-or-create User (oauthProvider=google),
//                                      issue the same `zaytrix_session` JWT
//                                      cookie that the email/password flow uses,
//                                      then redirect to "/" so the SPA boots.
//                                      SEC-9: when the user has 2FA enabled,
//                                      the 5-min tempToken now goes into a
//                                      short-lived httpOnly cookie
//                                      (`zaytrix_oauth2fa`) and the browser is
//                                      redirected to /?oauth_2fa=1 — NEVER into
//                                      the URL (browser history / referer leak).
//   POST /api/auth/google/2fa       → body {totp}; reads the cookie, verifies
//                                      the temp token + TOTP, issues the session
//                                      cookie, clears the oauth2fa cookie.
//
// If GOOGLE_CLIENT_ID is unset, /google redirects with an error flag so the
// SPA can display "belum dikonfigurasi" honestly. The callback is also guarded.
//
// This router is mounted INSIDE authRouter (auth.ts: authRouter.use(oauthRouter))
// so the routes are reachable at /api/auth/google without server.ts changes.

import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "./db";
import { logAudit } from "./audit";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { verifyTotp, decryptTotpSecret } from "./totp";

// Re-use the same JWT signing + cookie helpers from auth.ts. To avoid a
// circular import (auth.ts imports oauthRouter, oauth.ts would import from
// auth.ts), we duplicate the small set of helpers we need here. This is
// acceptable because the helpers are pure + stable.
import jwt from "jsonwebtoken";

const COOKIE_NAME = "zaytrix_session";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_TTL_MS = TOKEN_TTL_SECONDS * 1000;
const BCRYPT_ROUNDS = 10;

// SEC-13: JWT claim constants — must stay in sync with auth.ts.
const JWT_ISSUER = "zaytrix";
const JWT_AUDIENCE = "zaytrix-app";

// Lockout policy for the OAuth 2FA step — mirrors auth.ts (5 fails → 15 min).
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("[oauth] SESSION_SECRET is not set.");
  return secret;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieRequired(),
    path: "/",
    maxAge: TOKEN_TTL_MS,
  });
}

function signToken(payload: { sub: string; email: string; displayName: string }): string {
  // SEC-13: same claims as auth.ts signToken — HS256 pinned + iss/aud.
  return jwt.sign(payload, getSessionSecret(), {
    expiresIn: TOKEN_TTL_SECONDS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

// FIX-P1-D + SEC-13: temp token for OAuth→2FA handoff (5 min TTL, same claims
// as auth.ts signTempToken — including the twoFactorPending flag so requireAuth
// rejects it as a session token).
function signTempToken(payload: { sub: string; email: string; displayName: string }): string {
  return jwt.sign({ ...payload, twoFactorPending: true }, getSessionSecret(), {
    expiresIn: 5 * 60,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

// SEC-13: verification mirrors auth.ts verifyToken (HS256 only + iss/aud).
function verifyTempToken(token: string): { sub: string; email: string; displayName: string } | null {
  try {
    const decoded = jwt.verify(token, getSessionSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as any;
    if (!decoded || typeof decoded !== "object") return null;
    if (decoded.twoFactorPending !== true) return null; // must be a temp token
    if (typeof decoded.sub !== "string" || typeof decoded.email !== "string") return null;
    return {
      sub: decoded.sub,
      email: decoded.email,
      displayName: decoded.displayName || decoded.email.split("@")[0],
    };
  } catch {
    return null;
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function recordSession(req: Request, userId: string, token: string): Promise<void> {
  try {
    await prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        ip: req.ip || req.socket?.remoteAddress || null,
        userAgent: req.headers["user-agent"] ? String(req.headers["user-agent"]) : null,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
  } catch (e: any) {
    log.error("[oauth] recordSession failed:", e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/api/auth/google/callback"
  );
}

function frontendBaseUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// State cookie helpers — protect the OAuth round-trip from CSRF. We generate
// a random state, set it as a short-lived cookie, and pass it as a query
// parameter to Google. On callback, we compare cookie ↔ query; mismatch (or
// missing cookie) → 400. The cookie is httpOnly + sameSite=lax so it survives
// the cross-origin redirect back from Google.
// ---------------------------------------------------------------------------
const STATE_COOKIE = "zaytrix_oauth_state";

function isSecureCookieRequired(): boolean {
  // Only set the Secure flag when the app is actually served over HTTPS.
  // For local/HTTP deployment (even production builds behind a non-TLS proxy),
  // forcing Secure would silently drop the session cookie in the browser.
  return (
    process.env.NODE_ENV === "production" &&
    (process.env.APP_URL || "").startsWith("https://")
  );
}

function setStateCookie(res: Response, state: string): void {
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieRequired(),
    path: "/",
    maxAge: 10 * 60 * 1000, // 10 minutes — plenty for the OAuth round-trip
  });
}

function clearStateCookie(res: Response): void {
  res.clearCookie(STATE_COOKIE, { path: "/" });
}

// ---------------------------------------------------------------------------
// SEC-9: OAuth→2FA handoff cookie. The 5-minute tempToken lives in an
// httpOnly, sameSite=lax cookie instead of the redirect URL (URLs leak via
// browser history, Referer headers, and shared links — a captured tempToken
// + a TOTP code was enough to mint a session).
// ---------------------------------------------------------------------------
const OAUTH_2FA_COOKIE = "zaytrix_oauth2fa";
const OAUTH_2FA_COOKIE_TTL_MS = 5 * 60 * 1000; // 5 minutes — same as the tempToken

function setOAuth2faCookie(res: Response, tempToken: string): void {
  res.cookie(OAUTH_2FA_COOKIE, tempToken, {
    httpOnly: true, // JS must NOT read the temp token
    sameSite: "lax", // survives the redirect back from Google
    secure: isSecureCookieRequired(),
    path: "/",
    maxAge: OAUTH_2FA_COOKIE_TTL_MS,
  });
}

function clearOAuth2faCookie(res: Response): void {
  res.clearCookie(OAUTH_2FA_COOKIE, { path: "/" });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const oauthRouter = Router();

// GET /api/auth/google — redirect to Google consent screen
oauthRouter.get("/google", (req: Request, res: Response) => {
  if (!googleConfigured()) {
    // FUNC-12: previously a raw 503 JSON — useless in a browser (the user
    // lands on a wall of JSON after clicking "Login with Google"). Redirect
    // to the SPA with a machine-readable error flag instead.
    return res.redirect(302, `${frontendBaseUrl()}/?oauth_error=oauth_tidak_dikonfigurasi`);
  }
  const state = crypto.randomBytes(16).toString("hex");
  setStateCookie(res, state);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline", // ask for a refresh token (we don't currently store it)
    prompt: "consent", // forces the consent screen even if the user already granted
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return res.redirect(302, url);
});

// GET /api/auth/google/callback — exchange code → user profile → JWT cookie
oauthRouter.get("/google/callback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!googleConfigured()) {
      return res.status(503).json({
        success: false,
        error: "Google OAuth belum dikonfigurasi.",
      });
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookieState = req.cookies?.[STATE_COOKIE] || "";
    if (!code || !state || !cookieState || state !== cookieState) {
      clearStateCookie(res);
      return res.status(400).json({ success: false, error: "State OAuth tidak valid (kemungkinan CSRF)." });
    }
    clearStateCookie(res);

    // 1. Exchange the authorization code for tokens.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      log.error("[oauth] token exchange failed:", tokenRes.status, errBody);
      return res.redirect(302, `${frontendBaseUrl()}/?oauth_error=token_exchange_failed`);
    }
    const tokenJson = (await tokenRes.json()) as any;
    const accessToken: string | undefined = tokenJson?.access_token;
    const idToken: string | undefined = tokenJson?.id_token;
    if (!accessToken && !idToken) {
      return res.redirect(302, `${frontendBaseUrl()}/?oauth_error=no_tokens`);
    }

    // 2. Fetch the user profile. Prefer the id_token (JWT) which contains
    //    sub/email/name without an extra round-trip — but verify it via the
    //    userinfo endpoint if we want strong assurance. We use userinfo for
    //    simplicity + freshness.
    let profile: { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string } = {};
    if (accessToken) {
      const ures = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (ures.ok) {
        profile = (await ures.json()) as any;
      }
    }
    if (!profile.sub && idToken) {
      // Decode the id_token payload (no verification — we trust the token
      // endpoint we just received it from over HTTPS).
      try {
        const payloadB64 = idToken.split(".")[1];
        const payloadJson = Buffer.from(payloadB64, "base64").toString("utf8");
        const decoded = JSON.parse(payloadJson);
        profile = { ...profile, ...decoded };
      } catch {}
    }
    const googleSub = profile.sub;
    const email = (profile.email || "").trim().toLowerCase();
    const name = profile.name || (email ? email.split("@")[0] : "Pengguna Google");
    if (!googleSub || !email) {
      log.error("[oauth] missing google sub or email in profile:", profile);
      return res.redirect(302, `${frontendBaseUrl()}/?oauth_error=missing_profile`);
    }

    // 3. Find-or-create the User. We look up by oauthId first, then by email.
    //    FIX-P1-D: Previously, if a user with the same email existed but was
    //    created via email/password, we LINKED the OAuth identity to it
    //    WITHOUT verifying profile.email_verified. An attacker who can make
    //    Google issue an OAuth callback for the victim's email (e.g. via a
    //    Google account with a verified-but-unconfirmed email) would take
    //    over the victim's account. Now we REQUIRE profile.email_verified
    //    before any linking, AND we require the victim's account to NOT have
    //    a stronger auth method (2FA) configured — if it does, we refuse
    //    silent linking and redirect to the login page with an error so the
    //    legitimate owner must authenticate first.
    let user = await prisma.user.findFirst({ where: { oauthProvider: "google", oauthId: googleSub } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        // FIX-P1-D: refuse silent linking unless Google says the email is verified.
        if (!profile.email_verified) {
          await logAudit(user.id, "OAUTH_LINK_REFUSED", req, false, { reason: "email_not_verified_by_google", googleSub });
          return res.redirect(302, `${frontendBaseUrl()}/?oauth_error=email_not_verified`);
        }
        // FIX-P1-D: refuse silent linking if the existing account has 2FA enabled —
        // the legitimate owner must prove they have the password + TOTP before we
        // attach a new Google identity. Otherwise an attacker who compromises a
        // Google account sharing the victim's email could bypass 2FA via OAuth.
        if (user.twoFactorEnabled) {
          await logAudit(user.id, "OAUTH_LINK_REFUSED", req, false, { reason: "two_factor_enabled", googleSub });
          return res.redirect(302, `${frontendBaseUrl()}/?oauth_error=two_factor_protected`);
        }
        // Safe to link — the email is verified by Google AND the account has no 2FA.
        user = await prisma.user.update({
          where: { id: user.id },
          data: { oauthProvider: "google", oauthId: googleSub, emailVerified: user.emailVerified || new Date() },
        });
      } else {
        // Create a fresh account. We set a random password hash (the user
        // cannot log in via password — they must use Google) so the passwordHash
        // column is never null. oauthProvider=google gates the login UI.
        const randomPassword = crypto.randomBytes(32).toString("hex");
        const passwordHash = await bcrypt.hash(randomPassword, BCRYPT_ROUNDS);
        user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            displayName: name,
            oauthProvider: "google",
            oauthId: googleSub,
            emailVerified: profile.email_verified ? new Date() : null,
          },
        });
      }
    }

    // 4. Issue the JWT + cookie — same envelope as the email/password login.
    //    FIX-P1-D: if the user has 2FA enabled, OAuth MUST NOT bypass it.
    //    Previously we issued the session cookie immediately, letting an
    //    attacker who compromised a victim's Google account skip TOTP.
    //    SEC-9: the tempToken now goes into a short-lived httpOnly cookie and
    //    the SPA is redirected to /?oauth_2fa=1 (previously the tempToken was
    //    put in the redirect URL — leaked via history/Referer). The SPA shows
    //    the TOTP input and POSTs /api/auth/google/2fa {totp}.
    if (user.twoFactorEnabled) {
      const tempToken = signTempToken({ sub: user.id, email: user.email, displayName: user.displayName });
      await logAudit(user.id, "OAUTH_GOOGLE_2FA_REQUIRED", req, true, { googleSub, email });
      setOAuth2faCookie(res, tempToken);
      return res.redirect(302, `${frontendBaseUrl()}/?oauth_2fa=1`);
    }

    await logAudit(user.id, "OAUTH_GOOGLE_LOGIN", req, true, { googleSub, email });
    const token = signToken({ sub: user.id, email: user.email, displayName: user.displayName });
    setSessionCookie(res, token);
    await recordSession(req, user.id, token);

    // 5. Redirect to the SPA root — the SPA's /api/auth/me check will pick up
    //    the cookie and render the dashboard.
    return res.redirect(302, frontendBaseUrl() + "/");
  } catch (err) {
    log.error("[oauth] callback error:", err);
    return res.redirect(302, `${frontendBaseUrl()}/?oauth_error=server_error`);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/google/2fa (SEC-9) — completes an OAuth login that requires
// 2FA. This is a PRE-SESSION endpoint (requireAuth intentionally NOT used —
// the caller only holds the 5-min `zaytrix_oauth2fa` temp-token cookie):
//
//   FRONTEND CONTRACT: the SPA sees `?oauth_2fa=1` after the Google redirect,
//   shows its TOTP input, and POSTs { totp: "123456" } here (credentials
//   include cookies). On { success: true } the `zaytrix_session` cookie is
//   set — re-check /api/auth/me. On 401/423 the code was wrong / the account
//   is locked. This endpoint is CSRF-EXEMPT in security.ts (no session yet).
//
// Verification chain: cookie tempToken (jwt: HS256 + iss/aud + single-use
// via auth.ts's consumed-token registry, SEC-21) → user lookup → lockout
// check (SEC-26-style: 5 fails → 15 min) → decryptTotpSecret + verifyTotp →
// issue session + recordSession (SEC-5b: revocable) → clear oauth2fa cookie.
// ---------------------------------------------------------------------------
oauthRouter.post("/google/2fa", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const totp = typeof req.body?.totp === "string" ? req.body.totp.trim() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : totp; // accept both keys
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: "Kode 2FA wajib 6 digit." });
    }

    const tempToken = (req.cookies as Record<string, string> | undefined)?.[OAUTH_2FA_COOKIE];
    if (!tempToken) {
      return res.status(401).json({
        success: false,
        error: "Sesi 2FA OAuth tidak ditemukan atau telah kedaluwarsa. Mulai login ulang.",
      });
    }

    // SEC-13: verify the temp token (HS256 pinned + iss/aud + twoFactorPending).
    const payload = verifyTempToken(tempToken);
    if (!payload) {
      clearOAuth2faCookie(res); // dead token — remove it
      return res.status(401).json({
        success: false,
        error: "Token 2FA OAuth tidak valid atau telah kedaluwarsa. Mulai login ulang.",
      });
    }

    // SEC-21: single-use temp tokens (shares auth.ts's in-memory registry so a
    // token consumed by /login/2fa can't be replayed here and vice versa).
    // Dynamic import — auth.ts imports this module, so a static import cycles.
    const { isTempTokenConsumed, markTempTokenConsumed } = await import("./auth");
    if (isTempTokenConsumed(tempToken)) {
      clearOAuth2faCookie(res);
      await logAudit(payload.sub, "OAUTH_GOOGLE_2FA", req, false, { reason: "temp_token_replayed" });
      return res.status(401).json({ success: false, error: "Token 2FA OAuth sudah digunakan." });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      clearOAuth2faCookie(res);
      return res.status(400).json({ success: false, error: "2FA tidak aktif untuk akun ini." });
    }

    // Lockout check (same policy as /login/2fa).
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      await logAudit(user.id, "OAUTH_GOOGLE_2FA", req, false, { reason: "locked", lockedUntil: user.lockedUntil });
      return res.status(429).json({
        success: false,
        error: `Akun terkunci akibat percobaan 2FA gagal berulang. Coba lagi dalam ${mins} menit.`,
      });
    }

    let secretB32: string;
    try {
      secretB32 = decryptTotpSecret(user.twoFactorSecret);
    } catch {
      await logAudit(user.id, "OAUTH_GOOGLE_2FA", req, false, { reason: "decrypt_failed" });
      return res.status(500).json({ success: false, error: "Gagal mendekripsi rahasia TOTP." });
    }

    if (!verifyTotp(code, secretB32)) {
      // Increment failedLoginAttempts + lock when threshold reached (SEC-26 policy).
      let newCount = (user.failedLoginAttempts || 0) + 1;
      let shouldLock = newCount >= MAX_FAILED_ATTEMPTS;
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: newCount,
            lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedUntil,
          },
        });
      } catch (e: any) {
        log.error("[oauth] 2fa failedLoginAttempts update failed:", e?.message || e);
        newCount = user.failedLoginAttempts || 0;
        shouldLock = false;
      }
      await logAudit(user.id, "OAUTH_GOOGLE_2FA", req, false, {
        reason: "bad_code",
        attempts: newCount,
        locked: shouldLock,
      });
      if (shouldLock) {
        return res.status(429).json({
          success: false,
          error: "Terlalu banyak percobaan 2FA gagal. Akun dikunci selama 15 menit.",
        });
      }
      return res.status(401).json({
        success: false,
        error: `Kode 2FA tidak valid. Sisa percobaan: ${MAX_FAILED_ATTEMPTS - newCount} sebelum akun terkunci.`,
      });
    }

    // Success: reset attempts, consume the temp token, issue the session.
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    } catch {}
    markTempTokenConsumed(tempToken);
    clearOAuth2faCookie(res);

    await logAudit(user.id, "OAUTH_GOOGLE_2FA", req, true, {});
    const token = signToken({ sub: user.id, email: user.email, displayName: user.displayName });
    setSessionCookie(res, token);
    await recordSession(req, user.id, token); // SEC-5b: revocable session row

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    });
  } catch (err) {
    next(err);
  }
});
