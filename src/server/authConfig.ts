// Shared auth configuration constants + helpers — no circular imports.
// Both auth.ts and firebaseAuth.ts import from here instead of importing
// each other, which caused a circular dependency at boot time.

import jwt from "jsonwebtoken";

export const COOKIE_NAME = "zaytrix_session";
export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const TOKEN_TTL_MS = TOKEN_TTL_SECONDS * 1000;
export const JWT_ISSUER = "zaytrix";
export const JWT_AUDIENCE = "zaytrix-app";

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("[auth] SESSION_SECRET is not set. Refusing to issue tokens.");
  }
  return secret;
}

/**
 * Only set the Secure cookie flag when the app is actually served over HTTPS.
 * For local / HTTP deployment (even production builds behind a non-TLS proxy),
 * forcing Secure would silently drop the session cookie in the browser.
 */
export function isSecureCookieRequired(): boolean {
  const appUrl = process.env.APP_URL || "";
  return process.env.NODE_ENV === "production" && appUrl.startsWith("https://");
}

export function setSessionCookie(res: any, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieRequired(),
    path: "/",
    maxAge: TOKEN_TTL_MS,
  });
}

export function signToken(payload: { sub: string; email: string; displayName: string }): string {
  return jwt.sign(payload, getSessionSecret(), {
    expiresIn: TOKEN_TTL_SECONDS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}
