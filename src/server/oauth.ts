// ZAYTRIX Google OAuth (SEC2-AUTH).
//
// Manual OAuth 2.0 Authorization Code flow (no Passport dependency) — keeps
// the dependency surface small + the flow easy to audit. Endpoints:
//
//   GET  /api/auth/google           → redirect to Google consent screen
//   GET  /api/auth/google/callback  → exchange code → tokens → user profile,
//                                     find-or-create User (oauthProvider=google),
//                                     issue the same `zaytrix_session` JWT
//                                     cookie that the email/password flow uses,
//                                     then redirect to "/" so the SPA boots.
//
// If GOOGLE_CLIENT_ID is unset, /google returns a JSON error so the frontend
// can display "belum dikonfigurasi" honestly. The callback is also guarded.
//
// This router is mounted INSIDE authRouter (auth.ts: authRouter.use(oauthRouter))
// so the routes are reachable at /api/auth/google without server.ts changes.

import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "./db";
import { logAudit } from "./audit";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Re-use the same JWT signing + cookie helpers from auth.ts. To avoid a
// circular import (auth.ts imports oauthRouter, oauth.ts would import from
// auth.ts), we duplicate the small set of helpers we need here. This is
// acceptable because the helpers are pure + stable.
import jwt from "jsonwebtoken";

const COOKIE_NAME = "zaytrix_session";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_TTL_MS = TOKEN_TTL_SECONDS * 1000;
const BCRYPT_ROUNDS = 10;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("[oauth] SESSION_SECRET is not set.");
  return secret;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOKEN_TTL_MS,
  });
}

function signToken(payload: { sub: string; email: string; displayName: string }): string {
  return jwt.sign(payload, getSessionSecret(), { expiresIn: TOKEN_TTL_SECONDS });
}

// FIX-P1-D: temp token for OAuth→2FA handoff (5 min TTL, same as auth.ts).
function signTempToken(payload: { sub: string; email: string; displayName: string }): string {
  return jwt.sign(payload, getSessionSecret(), { expiresIn: 5 * 60 });
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
    console.error("[oauth] recordSession failed:", e?.message || e);
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

function setStateCookie(res: Response, state: string): void {
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60 * 1000, // 10 minutes — plenty for the OAuth round-trip
  });
}

function clearStateCookie(res: Response): void {
  res.clearCookie(STATE_COOKIE, { path: "/" });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const oauthRouter = Router();

// GET /api/auth/google — redirect to Google consent screen
oauthRouter.get("/google", (req: Request, res: Response) => {
  if (!googleConfigured()) {
    return res.status(503).json({
      success: false,
      error: "Google OAuth belum dikonfigurasi. Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET di .env.",
    });
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
      console.error("[oauth] token exchange failed:", tokenRes.status, errBody);
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
      console.error("[oauth] missing google sub or email in profile:", profile);
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
    //    Now we redirect to the 2FA challenge screen with a tempToken
    //    (same flow as password login with 2FA). The AuthScreen picks up
    //    ?oauth_2fa_required=email and switches to the 2FA flow.
    if (user.twoFactorEnabled) {
      const tempToken = signTempToken({ sub: user.id, email: user.email, displayName: user.displayName });
      await logAudit(user.id, "OAUTH_GOOGLE_2FA_REQUIRED", req, true, { googleSub, email });
      return res.redirect(302, `${frontendBaseUrl()}/?oauth_2fa_required=${encodeURIComponent(email)}&temp_token=${encodeURIComponent(tempToken)}`);
    }

    await logAudit(user.id, "OAUTH_GOOGLE_LOGIN", req, true, { googleSub, email });
    const token = signToken({ sub: user.id, email: user.email, displayName: user.displayName });
    setSessionCookie(res, token);
    await recordSession(req, user.id, token);

    // 5. Redirect to the SPA root — the SPA's /api/auth/me check will pick up
    //    the cookie and render the dashboard.
    return res.redirect(302, frontendBaseUrl() + "/");
  } catch (err) {
    console.error("[oauth] callback error:", err);
    return res.redirect(302, `${frontendBaseUrl()}/?oauth_error=server_error`);
  }
});
