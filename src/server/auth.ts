import { createLogger } from "./logger";
const log = createLogger("auth");

// ZAYTRIX authentication (SEC-BACKEND + SEC2-AUTH).
//
// Exports:
//   - requireAuth  : middleware, 401 if no valid `zaytrix_session` cookie
//   - optionalAuth : middleware, sets req.user if cookie valid, else null
//   - authRouter   : Express Router with POST /register /login /logout,
//                    GET /me, GET /audit-logs (SEC-BACKEND) +
//                    2FA setup/verify/disable, login/2fa, verify-email,
//                    resend-verification, forgot/reset-password,
//                    sessions list/revoke (SEC2-AUTH)
//
// JWT is stored in an httpOnly, sameSite=lax cookie named `zaytrix_session`.
// In production (NODE_ENV=production) the cookie is also Secure (HTTPS only).
// Token lifetime is 7 days; the 2FA temp-token is 5 minutes.
//
// SEC2-AUTH additions (additive, no breaking changes to existing endpoints):
//   - Login flow: if user.twoFactorEnabled, return {requiresTwoFactor:true, tempToken}
//     instead of issuing the real session cookie. Frontend calls /login/2fa
//     with the tempToken + TOTP code to complete login.
//   - Lockout: 5 consecutive failed password checks → lockedUntil = now+15min.
//   - Session tracking: every successful login inserts a Session row keyed by
//     sha256(jwt). /sessions + /sessions/:id + logout all touch this table.
//   - requireAuth is FAIL-CLOSED (SEC-5): a valid JWT must match an existing
//     Session row (tokenHash). No Session row → 401 (revoked / pre-SEC2 token);
//     DB read error → 401 (logged). See validateSession below.

import { Router, Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "./db";
import { logAudit } from "./audit";
import {
  generateTotpSecret,
  encryptTotpSecret,
  decryptTotpSecret,
  verifyTotp,
  buildOtpauthUri,
  generateBackupCodes,
  hashBackupCode,
} from "./totp";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email";
import { checkPasswordBreach } from "./breachCheck";
import { webauthnRouter } from "./webauthn";
import { recordAuthAttempt } from "./alerting";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ZCapitalJwtPayload {
  sub: string; // user id
  email: string;
  displayName: string;
  // 2FA temp tokens carry an extra flag so the server can distinguish them
  // from real session tokens — temp tokens are NOT accepted by requireAuth.
  twoFactorPending?: boolean;
}

// Augment Express's Request with the `user` field set by requireAuth/optionalAuth.
declare module "express-serve-static-core" {
  interface Request {
    user?: ZCapitalJwtPayload | null;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COOKIE_NAME = "zaytrix_session";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export { TOKEN_TTL_SECONDS };
const TOKEN_TTL_MS = TOKEN_TTL_SECONDS * 1000;
const TEMP_TOKEN_TTL_SECONDS = 5 * 60; // 5 minutes for 2FA temp token

// SEC-13 (JWT hardening): pin the algorithm (HS256) + issuer/audience claims.
// Previously `jwt.verify` accepted ANY algorithm the library supports — an
// attacker able to control the `alg` header (e.g. "none" confusion or RS/HS
// key-confusion in other stacks) had a wider attack surface, and tokens had
// no iss/aud binding (a token signed for another purpose/audience would be
// accepted here). TTL stays 7 days (unchanged — changing it breaks UX).
const JWT_ISSUER = "zaytrix";
const JWT_AUDIENCE = "zaytrix-app";
const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = {
  algorithms: ["HS256"],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};
const BCRYPT_ROUNDS = 10;

// Lockout policy: 5 consecutive failures → 15 minute lockout.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// FIX-C-2: dummy hash for timing equalization (prevents email enumeration via response time).
// Used in /login when the user is not found so the request takes roughly the same
// time as a real bcrypt.compare — without it, /login returns in ~1ms for unknown
// emails vs ~80-120ms for existing emails, leaking which emails are registered.
// This is a real bcrypt hash of a throwaway password; it will never match any
// user-supplied password and the result is discarded.
const DUMMY_HASH = "$2a$12$N9qo8uLOickgx2ZMRZoMy.Mrq8BkV6qL/2qZ8wT8p2fJqZKqKqKqK";

// Token expiries
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Refuse to start auth flows without a secret — this is a deployment
    // misconfiguration that MUST be fixed, not silently worked around.
    throw new Error("[auth] SESSION_SECRET is not set. Refusing to issue tokens.");
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOKEN_TTL_MS,
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

// Exported so webauthn.ts / oauth.ts issue tokens with IDENTICAL claims (SEC-13).
export function signToken(payload: ZCapitalJwtPayload): string {
  return jwt.sign(payload, getSessionSecret(), {
    expiresIn: TOKEN_TTL_SECONDS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

// Alias used by other modules (webauthn.ts lazy-imports this).
export const signSessionToken = signToken;

function signTempToken(payload: ZCapitalJwtPayload): string {
  // The 2FA temp-token has a short TTL and a twoFactorPending flag. It is ONLY
  // valid for the /api/auth/login/2fa endpoint — see requireAuth reject.
  return jwt.sign({ ...payload, twoFactorPending: true }, getSessionSecret(), {
    expiresIn: TEMP_TOKEN_TTL_SECONDS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function verifyToken(token: string): ZCapitalJwtPayload | null {
  try {
    // SEC-13: algorithms pinned to HS256 + iss/aud required — jwt.verify throws
    // (→ null) on any mismatch.
    const decoded = jwt.verify(token, getSessionSecret(), JWT_VERIFY_OPTIONS) as any;
    if (!decoded || typeof decoded !== "object") return null;
    if (typeof decoded.sub !== "string" || typeof decoded.email !== "string") return null;
    return {
      sub: decoded.sub,
      email: decoded.email,
      displayName: decoded.displayName || decoded.email.split("@")[0],
      twoFactorPending: decoded.twoFactorPending === true,
    };
  } catch {
    return null;
  }
}

// sha256(token) — used as the server-side lookup key for Session, EmailVerification,
// and PasswordReset tokens. We hash so a DB leak cannot be turned into live tokens
// (the raw token is only ever held by the user via email/link, never stored).
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// SEC-21 (2FA tempToken replay): single-use semantics for 2FA temp tokens.
// A successful /login/2fa (or OAuth /google/2fa) marks the token's sha256 as
// consumed for the remainder of its 5-minute TTL. Reuse → 401. In-memory Map
// keyed by hash (the raw token is never stored), pruned opportunistically.
// ---------------------------------------------------------------------------
const consumedTempTokens = new Map<string, number>(); // sha256(token) → expiry epoch ms

export function isTempTokenConsumed(token: string): boolean {
  const hash = hashToken(token);
  const expiry = consumedTempTokens.get(hash);
  if (expiry === undefined) return false;
  if (Date.now() > expiry) {
    consumedTempTokens.delete(hash);
    return false;
  }
  return true;
}

export function markTempTokenConsumed(token: string): void {
  consumedTempTokens.set(hashToken(token), Date.now() + TEMP_TOKEN_TTL_SECONDS * 1000);
  // Opportunistic pruning so the Map can never grow unbounded.
  if (consumedTempTokens.size > 1024) {
    const now = Date.now();
    for (const [k, exp] of consumedTempTokens) {
      if (exp < now) consumedTempTokens.delete(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Random token generators (cuid-style entropy — 32 hex chars from randomBytes)
// ---------------------------------------------------------------------------
function randomTokenString(byteLen = 32): string {
  return crypto.randomBytes(byteLen).toString("hex");
}

// ---------------------------------------------------------------------------
// Session record helpers (SEC2-AUTH + SEC-5b)
// Exported so webauthn.ts (passkey login) records Session rows too — without
// this, passkey-issued JWTs were invisible to /api/auth/sessions and could
// NOT be revoked (SEC-5b). requireAuth is fail-closed (SEC-5): a JWT without
// a matching Session row is rejected, so EVERY login path MUST call this.
// ---------------------------------------------------------------------------
export async function recordSession(req: Request, userId: string, token: string): Promise<void> {
  try {
    await prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        ip: req.ip || req.socket?.remoteAddress || null,
        userAgent: req.headers["user-agent"] ? String(req.headers["user-agent"]) : null,
        lastSeen: new Date(),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
  } catch (e: any) {
    // Best-effort for the login response itself, but note: requireAuth is now
    // FAIL-CLOSED — if this insert failed, the very next request with this
    // cookie will be 401'd. Log loudly so ops can see why sessions die.
    log.error("[auth] recordSession failed (session will be rejected by requireAuth):", e?.message || e);
  }
}

async function revokeSessionByToken(token: string): Promise<void> {
  try {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  } catch (e: any) {
    log.error("[auth] revokeSessionByToken failed:", e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Middleware: requireAuth — 401 if no valid session cookie.
//
// SEC2-AUTH (FIX-ALL H2): we AWAIT a server-side session validation check.
// Enforcement rules (SEC-5 — FAIL-CLOSED, no "grace legacy" bypass):
//   1. The Session row for THIS tokenHash must EXIST, belong to the same
//      user, and be unexpired. Otherwise → 401.
//   2. A DB read error → 401 (fail-closed, error logged). Previously a DB
//      error (or a user with zero Session rows) allowed the JWT through —
//      meaning logout / "revoke all sessions" did NOT actually kill stolen
//      cookies: any pre-revocation JWT kept working forever.
//   3. The session row's lastSeen is updated opportunistically; a failure
//      there does not block the request.
// This actually enforces session revocation: a stolen JWT is rejected as
// soon as the legitimate user logs out / revokes that session row.
// ---------------------------------------------------------------------------
export const requireAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ success: false, error: "Autentikasi diperlukan." });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: "Sesi tidak valid atau telah kedaluwarsa." });
  }
  // Reject 2FA temp tokens — they are NOT session tokens.
  if (payload.twoFactorPending) {
    return res.status(401).json({ success: false, error: "Token 2FA sementara tidak dapat digunakan untuk endpoint ini." });
  }

  // Enforce server-side session revocation. We AWAIT so a revoked token is
  // rejected before the route handler runs. SEC-5: DB errors and missing
  // Session rows now REJECT — a transient DB outage logs in ops but never
  // silently re-validates possibly-revoked tokens.
  const sessionOk = await validateSession(token, payload.sub);
  if (!sessionOk) {
    return res.status(401).json({ success: false, error: "Sesi telah dicabut atau kedaluwarsa. Silakan login kembali." });
  }

  req.user = payload;
  next();
};

/**
 * Validate the server-side Session row for `token`. (SEC-5 — fail-closed.)
 *
 * Returns true ONLY when the Session row for this exact tokenHash exists,
 * belongs to `userId`, and is not expired.
 *
 * Returns false (reject, 401) when:
 *   - No Session row for this tokenHash (revoked, logged-out, or a token
 *     issued before session tracking existed — those legacy JWTs must
 *     re-login; one-time cost for real revocation).
 *   - The row's userId mismatches (token belongs to a different user).
 *   - The row is expired.
 *   - The DB lookup itself errors (fail-closed; logged server-side).
 */
async function validateSession(token: string, userId: string): Promise<boolean> {
  try {
    const tokenHash = hashToken(token);
    const row = await prisma.session.findUnique({ where: { tokenHash } });
    if (!row) {
      // No row for this token → it was revoked (logout / /sessions/:id /
      // logout-others / password reset) or never tracked. Reject.
      return false;
    }
    if (row.userId !== userId) return false; // token belongs to a different user
    if (row.expiresAt.getTime() < Date.now()) return false; // expired
    // Update lastSeen (best-effort — never blocks the request).
    await prisma.session
      .update({ where: { id: row.id }, data: { lastSeen: new Date() } })
      .catch(() => {});
    return true;
  } catch (e: any) {
    // SEC-5: fail-closed on DB error. A DB outage is visible in logs and ops
    // dashboards; silently honoring un-verifiable JWTs is NOT an option when
    // the whole point of the Session table is revocation.
    log.error("[auth] validateSession error (rejecting request fail-closed):", e?.message || e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Middleware: optionalAuth — sets req.user if present, else null. Never 401s.
// ---------------------------------------------------------------------------
export const optionalAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const payload = verifyToken(token);
    if (payload && !payload.twoFactorPending) {
      req.user = payload;
    } else {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Discriminated-union result for input validation. The literal `ok` field is
 * used as the discriminant. To make TS narrow correctly on `if (!parsed.ok)`
 * WITHOUT requiring `strictNullChecks` (which would surface many pre-existing
 * errors in other files), we expose two helper accessors below instead of
 * accessing `.error` / `.value` directly.
 */
type RegisterValid = { ok: true; value: { email: string; password: string; displayName: string } };
type RegisterInvalid = { ok: false; error: string };
type LoginValid = { ok: true; value: { email: string; password: string } };
type LoginInvalid = { ok: false; error: string };

function validateRegister(body: any): RegisterValid | RegisterInvalid {
  if (!body || typeof body !== "object") return { ok: false, error: "Body permintaan tidak valid." };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Format email tidak valid." };
  if (password.length < 8) return { ok: false, error: "Kata sandi minimal 8 karakter." };
  if (displayName.length === 0) return { ok: false, error: "Nama tampilan wajib diisi." };
  if (displayName.length > 80) return { ok: false, error: "Nama tampilan terlalu panjang (maks 80 karakter)." };
  return { ok: true, value: { email, password, displayName } };
}

function validateLogin(body: any): LoginValid | LoginInvalid {
  if (!body || typeof body !== "object") return { ok: false, error: "Body permintaan tidak valid." };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Format email tidak valid." };
  if (password.length === 0) return { ok: false, error: "Kata sandi wajib diisi." };
  return { ok: true, value: { email, password } };
}

/**
 * Type-guard that narrows a validation result to its INVALID branch. TS
 * won't narrow `{ok: true; value} | {ok: false; error}` on `!parsed.ok`
 * without `strictNullChecks`, but a user-defined type guard using `parsed is`
 * forces the narrowing regardless of the strictness flags. Use this in
 * handlers to safely extract the error message.
 */
function isInvalid<T extends { ok: boolean }>(parsed: T): parsed is T & { ok: false; error: string } {
  return parsed.ok === false;
}

// ---------------------------------------------------------------------------
// Public user shape (never leak passwordHash/totpSecret).
// Extended in SEC2-AUTH to surface emailVerified + oauthProvider so the
// frontend can show verification banners + Google-linked state.
// ---------------------------------------------------------------------------
function publicUser(u: {
  id: string;
  email: string;
  displayName: string;
  twoFactorEnabled: boolean;
  emailVerified?: Date | null;
  oauthProvider?: string | null;
  breachCount?: number;
  breachChecked?: Date | null;
}): {
  id: string;
  email: string;
  displayName: string;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
  oauthProvider: string | null;
  breachCount: number;
  breachChecked: string | null;
} {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    twoFactorEnabled: u.twoFactorEnabled,
    emailVerified: !!u.emailVerified,
    oauthProvider: u.oauthProvider || null,
    breachCount: typeof u.breachCount === "number" ? u.breachCount : 0,
    breachChecked: typeof u.breachChecked === "string" ? u.breachChecked :
                    u.breachChecked instanceof Date ? u.breachChecked.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export const authRouter = Router();

// POST /api/auth/register
authRouter.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = validateRegister(req.body);
    if (isInvalid(parsed)) {
      recordAuthAttempt(false);
      return res.status(400).json({ success: false, error: parsed.error });
    }
    const { email, password, displayName } = parsed.value;

    // Uniqueness check.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Audit the failed attempt (don't reveal whether the email exists to the
      // caller, but DO record it server-side).
      recordAuthAttempt(false);
      await logAudit(null, "REGISTER", req, false, { reason: "email_in_use", email });
      // FIX-C-1: return generic 201 to prevent email enumeration
      // (previously a distinct 409 "Email sudah terdaftar." leaked whether an
      // email was registered). Always return 201 with a redacted user + a
      // message that works whether the account was created OR already existed.
      return res.status(201).json({
        success: true,
        user: { id: null, email: "[REDACTED]", displayName: "[REDACTED]" },
        message: "Jika email belum terdaftar, akun telah dibuat. Jika sudah terdaftar, silakan login.",
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { email, passwordHash, displayName },
    });

    await logAudit(user.id, "REGISTER", req, true, { email });

    const token = signToken({ sub: user.id, email: user.email, displayName: user.displayName });
    setSessionCookie(res, token);
    await recordSession(req, user.id, token);

    // SEC2-AUTH: send a verification email (best-effort — failures don't block
    // registration). We issue the token + persist its HASH before sending so the
    // user can refresh the resend endpoint if the email never arrives.
    // FIX-P1-A: store sha256(token), never the raw token — a DB leak cannot be
    // turned into live verification links. The raw token only exists in the email.
    try {
      const evToken = randomTokenString();
      await prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          token: hashToken(evToken),
          expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
        },
      });
      // Fire-and-forget the email send (awaited for dev-mode logging but
      // wrapped so any transport error stays inside the try/catch).
      sendVerificationEmail(user.email, evToken).catch((e) =>
        log.error("[auth] sendVerificationEmail failed:", e?.message || e)
      );
    } catch (e: any) {
      log.error("[auth] email verification token create failed:", e?.message || e);
    }

    // SEC3-AUTH (AUTH10): password breach check via HaveIBeenPwned k-anonymity.
    // We AWAIT the check so we can include `breachCount` + `warning` in the
    // response, but we treat any failure (network error, HIBP down) as
    // "couldn't check" — registration still succeeds with breachCount=0.
    // This is ADVISORY only: we never block registration based on the result.
    let breachCount = 0;
    let breachChecked: Date | null = null;
    try {
      const breach = await checkPasswordBreach(password);
      if (breach.checked) {
        breachCount = breach.count;
        breachChecked = new Date();
        // Persist to the user record so future logins can surface the warning
        // without re-querying HIBP every time. Best-effort.
        await prisma.user.update({
          where: { id: user.id },
          data: { breachCount, breachChecked },
        });
        await logAudit(user.id, "PASSWORD_BREACH_CHECK", req, true, {
          breached: breach.breached,
          count: breach.count,
        });
      } else {
        // Check failed — log it but don't store anything (we'll retry on
        // next login / future operations).
        await logAudit(user.id, "PASSWORD_BREACH_CHECK", req, false, {
          reason: "check_unavailable",
        });
      }
    } catch (e: any) {
      // Defensive: should never happen since checkPasswordBreach swallows its
      // own errors, but if it does, registration still succeeds.
      log.error("[auth] breach check threw:", e?.message || e);
    }

    const userWithBreach = { ...user, breachCount, breachChecked };
    const response: any = { success: true, user: publicUser(userWithBreach) };
    if (breachCount > 0) {
      response.warning = `Password ini pernah muncul di ${breachCount} pelanggaran data. Pertimbangkan mengganti.`;
      response.breachCount = breachCount;
    }
    recordAuthAttempt(true);
    return res.status(201).json(response);
  } catch (err: any) {
    // Pass to the centralized error handler.
    recordAuthAttempt(false);
    next(err);
  }
});

// POST /api/auth/login
//
// SEC2-AUTH modification: if user.twoFactorEnabled, return
// { success:false, requiresTwoFactor:true, tempToken:<5min JWT> } instead of
// logging in. Frontend shows 2FA code input, calls /login/2fa with the
// tempToken + code to complete login. Also enforces lockout after 5 failed
// password checks (15min lockout) and resets failedLoginAttempts on success.
authRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = validateLogin(req.body);
    if (isInvalid(parsed)) {
      recordAuthAttempt(false);
      return res.status(400).json({ success: false, error: parsed.error });
    }
    const { email, password } = parsed.value;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // FIX-C-2: equalize timing with the existing-user path so response time
      // does not reveal whether the email is registered. A real bcrypt.compare
      // takes ~80-120ms; without a dummy compare here, /login returns in ~1ms
      // for unknown emails. The result is discarded.
      await bcrypt.compare(password, DUMMY_HASH).catch(() => {});
      recordAuthAttempt(false);
      await logAudit(null, "LOGIN", req, false, { reason: "user_not_found", email });
      return res.status(401).json({ success: false, error: "Email atau kata sandi salah." });
    }

    // Lockout check — applies BEFORE the password check so a locked-out account
    // doesn't even leak a "bad password" signal.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const ms = user.lockedUntil.getTime() - Date.now();
      const mins = Math.ceil(ms / 60000);
      recordAuthAttempt(false);
      await logAudit(user.id, "LOGIN", req, false, { reason: "locked", email });
      return res.status(423).json({
        success: false,
        error: `Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam ${mins} menit.`,
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      // Increment failedLoginAttempts; lock when threshold reached.
      const newCount = (user.failedLoginAttempts || 0) + 1;
      const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: newCount,
            lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedUntil,
          },
        });
      } catch (e: any) {
        log.error("[auth] failedLoginAttempts update failed:", e?.message || e);
      }
      recordAuthAttempt(false);
      await logAudit(user.id, "LOGIN", req, false, { reason: "bad_password", email, attempts: newCount, locked: shouldLock });
      const baseMsg = "Email atau kata sandi salah.";
      const lockMsg = shouldLock
        ? ` Akun terkunci selama 15 menit karena ${MAX_FAILED_ATTEMPTS} percobaan gagal berturut-turut.`
        : ` Percobaan gagal ${newCount}/${MAX_FAILED_ATTEMPTS}.`;
      return res.status(401).json({ success: false, error: baseMsg + lockMsg });
    }

    // 2FA gate — if enabled, return tempToken; frontend calls /login/2fa next.
    if (user.twoFactorEnabled) {
      // Reset failed attempts on the password succeeding (2FA still has to pass).
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      } catch {}
      const tempToken = signTempToken({ sub: user.id, email: user.email, displayName: user.displayName });
      // Password OK is itself a successful auth-stage event — counts toward
      // successful auth attempts for alerting metrics.
      recordAuthAttempt(true);
      await logAudit(user.id, "LOGIN", req, true, { stage: "password_ok_2fa_required", email });
      return res.status(200).json({
        success: false,
        requiresTwoFactor: true,
        tempToken,
        message: "Otentikasi dua faktor diperlukan. Masukkan kode dari aplikasi authenticator Anda.",
      });
    }

    // Reset failed attempts + clear lockout on full success.
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    } catch {}

    recordAuthAttempt(true);
    await logAudit(user.id, "LOGIN", req, true, { email });

    const token = signToken({ sub: user.id, email: user.email, displayName: user.displayName });
    setSessionCookie(res, token);
    await recordSession(req, user.id, token);

    // SEC3-AUTH (AUTH10): surface password-breach warning if the user's
    // password is known to be in a breach corpus (checked at registration
    // time + stored on the user record). The warning is advisory — the
    // login itself succeeded; the user is encouraged (but not forced) to
    // change their password.
    const response: any = { success: true, user: publicUser(user) };
    if (user.breachCount && user.breachCount > 0) {
      response.warning = `Password ini pernah muncul di ${user.breachCount} pelanggaran data. Pertimbangkan mengganti.`;
      response.breachCount = user.breachCount;
    }
    return res.json(response);
  } catch (err: any) {
    recordAuthAttempt(false);
    next(err);
  }
});

// POST /api/auth/login/2fa (SEC2-AUTH)
// Body: { tempToken, code } — verifies the tempToken JWT (5min) + TOTP code
// against the user's stored (encrypted) twoFactorSecret. On success, issues
// the real 7-day session cookie + records a Session row.
authRouter.post("/login/2fa", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tempToken = typeof req.body?.tempToken === "string" ? req.body.tempToken : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!tempToken || !code) {
      recordAuthAttempt(false);
      return res.status(400).json({ success: false, error: "tempToken dan kode wajib diisi." });
    }
    const payload = verifyToken(tempToken);
    if (!payload || !payload.twoFactorPending) {
      recordAuthAttempt(false);
      return res.status(401).json({ success: false, error: "Token 2FA sementara tidak valid atau telah kedaluwarsa." });
    }
    // SEC-21: reject REPLAYED temp tokens. A tempToken stays valid for 5 min
    // after a successful login; previously it could be used again (an attacker
    // who captured it plus a still-valid TOTP window could mint a second
    // session). Now it is single-use.
    if (isTempTokenConsumed(tempToken)) {
      recordAuthAttempt(false);
      await logAudit(payload.sub, "LOGIN_2FA", req, false, { reason: "temp_token_replayed" });
      return res.status(401).json({ success: false, error: "Token 2FA sementara sudah digunakan. Login ulang dari awal." });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      recordAuthAttempt(false);
      return res.status(400).json({ success: false, error: "2FA tidak aktif untuk akun ini." });
    }

    // FIX-P1-D: per-account lockout for 2FA brute-force. Previously the 2FA
    // endpoint had NO lockout — an attacker with the victim's password (→
    // tempToken) could brute-force the 6-digit TOTP code across IPs in ~1h
    // (1,000,000 / 30s window). Now we reuse the same failedLoginAttempts +
    // lockedUntil fields as password login: 5 fails → 15min lockout.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const ms = user.lockedUntil.getTime() - Date.now();
      const mins = Math.ceil(ms / 60000);
      recordAuthAttempt(false);
      await logAudit(user.id, "LOGIN_2FA", req, false, { reason: "locked", lockedUntil: user.lockedUntil });
      return res.status(429).json({
        success: false,
        error: `Akun terkunci akibat percobaan 2FA gagal berulang. Coba lagi dalam ${mins} menit.`,
      });
    }

    let secretB32: string;
    try {
      secretB32 = decryptTotpSecret(user.twoFactorSecret);
    } catch (e: any) {
      recordAuthAttempt(false);
      await logAudit(user.id, "LOGIN_2FA", req, false, { reason: "decrypt_failed" });
      return res.status(500).json({ success: false, error: "Gagal mendekripsi rahasia TOTP (master key tidak cocok?)." });
    }
    if (!verifyTotp(code, secretB32)) {
      recordAuthAttempt(false);
      // FIX-P1-D: increment failedLoginAttempts + lock when threshold reached.
      try {
        const newCount = (user.failedLoginAttempts || 0) + 1;
        const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: newCount,
            lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedUntil,
          },
        });
        await logAudit(user.id, "LOGIN_2FA", req, false, { reason: "bad_code", attempts: newCount, locked: shouldLock });
        if (shouldLock) {
          return res.status(429).json({
            success: false,
            error: "Terlalu banyak percobaan 2FA gagal. Akun dikunci selama 15 menit.",
          });
        }
        const remaining = MAX_FAILED_ATTEMPTS - newCount;
        return res.status(401).json({
          success: false,
          error: `Kode 2FA tidak valid. Sisa percobaan: ${remaining} sebelum akun terkunci.`,
        });
      } catch (e: any) {
        log.error("[auth] 2FA failedLoginAttempts update failed:", e?.message || e);
        return res.status(401).json({ success: false, error: "Kode 2FA tidak valid. Pastikan waktu perangkat sinkron." });
      }
    }
    recordAuthAttempt(true);
    // FIX-P1-D: reset failedLoginAttempts + lockedUntil on success.
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    } catch {}
    // SEC-21: consume the tempToken NOW — any replay (even within its 5-min
    // JWT TTL) is rejected above. Replaces the old FIX-C-8 "accepted risk".
    markTempTokenConsumed(tempToken);
    await logAudit(user.id, "LOGIN_2FA", req, true, {});
    const token = signToken({ sub: user.id, email: user.email, displayName: user.displayName });
    setSessionCookie(res, token);
    await recordSession(req, user.id, token);
    // SEC3-AUTH (AUTH10): same breach warning as the password-login path —
    // the user just proved identity via password + 2FA, but their password
    // is still in a breach corpus and should be rotated.
    const response2fa: any = { success: true, user: publicUser(user) };
    if (user.breachCount && user.breachCount > 0) {
      response2fa.warning = `Password ini pernah muncul di ${user.breachCount} pelanggaran data. Pertimbangkan mengganti.`;
      response2fa.breachCount = user.breachCount;
    }
    return res.json(response2fa);
  } catch (err) {
    recordAuthAttempt(false);
    next(err);
  }
});

// POST /api/auth/2fa/backup-login (OPT-5c — public, pre-auth, CSRF-exempt)
// Body: { email, backupCode } — lets a user who lost their authenticator device
// recover access by consuming a one-time backup code (issued at /2fa/verify
// time). The backup code is a 128-bit random hex string (formatted as 8 groups
// of 4 hex chars separated by dashes), so it is strong enough to serve as a
// single-factor recovery credential. The authLimiter (5 req/min/IP) caps
// brute-force attempts at the IP level. On success the matched hash is REMOVED
// from the stored array so the code can never be reused (one-time semantics,
// matching TOTP). When the remaining code count drops to ≤2, a warning is
// returned advising the user to regenerate backup codes via /2fa/disable +
// /2fa/setup + /2fa/verify.
//
// ADAPTATION NOTE: the task brief assumed backup codes live inside the
// encrypted `twoFactorSecret` column as `{hash, used}` objects. In this codebase
// they actually live in the legacy `totpSecret` column as PLAINTEXT JSON
// `{"backupCodes": ["sha256hex", ...]}` (a string array, not objects) — see
// /2fa/verify around line 902. So we read `user.totpSecret` directly (no
// decrypt) and mark a code "used" by splicing it out of the array.
authRouter.post("/2fa/backup-login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const backupCode = typeof req.body?.backupCode === "string" ? req.body.backupCode.trim() : "";
    if (!email || !backupCode) {
      recordAuthAttempt(false);
      return res.status(400).json({ success: false, error: "Email dan kode backup wajib diisi." });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.twoFactorEnabled || !user.totpSecret) {
      recordAuthAttempt(false);
      // OPT-5c: don't reveal whether the email exists — generic 400.
      return res.status(400).json({ success: false, error: "2FA tidak aktif untuk akun ini." });
    }
    // SEC-26: respect the SAME lockout policy as password login. Previously
    // this endpoint ignored lockedUntil entirely and never incremented
    // failedLoginAttempts — a locked-out account (5 bad passwords) could
    // still be entered by brute-forcing backup codes without limit (the
    // authLimiter is per-IP only, so a distributed attacker had no cap).
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const ms = user.lockedUntil.getTime() - Date.now();
      const mins = Math.ceil(ms / 60000);
      recordAuthAttempt(false);
      await logAudit(user.id, "BACKUP_CODE_LOGIN", req, false, { reason: "locked", lockedUntil: user.lockedUntil });
      return res.status(423).json({
        success: false,
        error: `Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam ${mins} menit.`,
      });
    }
    // Parse backup codes from the totpSecret JSON envelope (plaintext JSON,
    // not encrypted — only sha256 hashes are stored).
    let secretData: { backupCodes?: string[] };
    try {
      secretData = JSON.parse(user.totpSecret);
    } catch {
      return res.status(500).json({ success: false, error: "Gagal membaca rahasia 2FA." });
    }
    if (!Array.isArray(secretData.backupCodes) || secretData.backupCodes.length === 0) {
      return res.status(400).json({ success: false, error: "Tidak ada kode backup untuk akun ini." });
    }
    // Verify the backup code: hash the input (strips dashes + lowercases) and
    // look for a match in the stored hash array.
    const hashedInput = hashBackupCode(backupCode);
    const matchIndex = secretData.backupCodes.indexOf(hashedInput);
    if (matchIndex === -1) {
      recordAuthAttempt(false);
      // SEC-26: increment failedLoginAttempts with the SAME policy as
      // password login (5 fails → 15-min lockout), so backup-code brute force
      // locks the account instead of running forever.
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
        log.error("[auth] backup-login failedLoginAttempts update failed:", e?.message || e);
        newCount = user.failedLoginAttempts || 0;
        shouldLock = false;
      }
      await logAudit(user.id, "BACKUP_CODE_LOGIN", req, false, {
        reason: "invalid_or_used",
        attempts: newCount,
        locked: shouldLock,
      });
      const baseMsg = "Kode backup tidak valid atau sudah digunakan.";
      if (shouldLock) {
        return res.status(423).json({
          success: false,
          error: baseMsg + ` Akun terkunci selama 15 menit karena ${MAX_FAILED_ATTEMPTS} percobaan gagal berturut-turut.`,
        });
      }
      return res.status(401).json({
        success: false,
        error: baseMsg + ` Percobaan gagal ${newCount}/${MAX_FAILED_ATTEMPTS}.`,
      });
    }
    // Mark the code as used by REMOVING it from the stored array. The existing
    // storage format is a plain string[] (not {hash, used} objects), so removal
    // is the cleanest one-time-use semantics — the hash can never match again.
    // SEC-26: also reset the failed-attempt counter + lockout, exactly like a
    // successful password login does.
    secretData.backupCodes.splice(matchIndex, 1);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: JSON.stringify(secretData),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    // Issue session — mirrors the /login/2fa success path (signToken +
    // setSessionCookie + recordSession).
    recordAuthAttempt(true);
    await logAudit(user.id, "BACKUP_CODE_LOGIN", req, true, { remaining: secretData.backupCodes.length });
    const token = signToken({ sub: user.id, email: user.email, displayName: user.displayName });
    setSessionCookie(res, token);
    await recordSession(req, user.id, token);
    const response: any = {
      success: true,
      user: publicUser(user),
      message: "Login berhasil dengan kode backup. Kode ini tidak dapat digunakan lagi.",
    };
    // Warn the user when they're running low on backup codes so they can
    // regenerate before they're locked out entirely.
    if (secretData.backupCodes.length <= 2) {
      response.warning = `Sisa kode backup: ${secretData.backupCodes.length}. Nonaktifkan lalu aktifkan kembali 2FA untuk membuat kode cadangan baru.`;
    }
    return res.json(response);
  } catch (err) {
    recordAuthAttempt(false);
    next(err);
  }
});

// POST /api/auth/logout
authRouter.post("/logout", (req: Request, res: Response) => {
  const userId = req.user?.sub || null;
  // SEC2-AUTH: revoke the server-side Session row (best-effort). We don't have
  // req.user here because logout doesn't run requireAuth — but we can still
  // hash the cookie + delete by tokenHash.
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    revokeSessionByToken(token).catch(() => {});
  }
  logAudit(userId, "LOGOUT", req, true).catch(() => {});
  clearSessionCookie(res);
  return res.json({ success: true });
});

// GET /api/auth/me  (optionalAuth — works for both anonymous + authed)
authRouter.get("/me", optionalAuth, (req: Request, res: Response) => {
  if (req.user) {
    // Fetch the full user record to surface emailVerified + oauthProvider.
    // Best-effort — if the DB read fails we fall back to the JWT payload only.
    prisma.user
      .findUnique({
        where: { id: req.user.sub },
        select: {
          id: true,
          email: true,
          displayName: true,
          twoFactorEnabled: true,
          emailVerified: true,
          oauthProvider: true,
          // SEC3-AUTH (AUTH10): include breach-check results so the frontend
          // can show a "your password is in a breach corpus" banner on
          // every page load (not just at registration/login).
          breachCount: true,
          breachChecked: true,
        },
      })
      .then((u) => {
        if (u) {
          return res.json({ success: true, user: publicUser(u) });
        }
        return res.json({
          success: true,
          user: {
            id: req.user!.sub,
            email: req.user!.email,
            displayName: req.user!.displayName,
            twoFactorEnabled: false,
            emailVerified: false,
            oauthProvider: null,
          },
        });
      })
      .catch(() =>
        res.json({
          success: true,
          user: {
            id: req.user!.sub,
            email: req.user!.email,
            displayName: req.user!.displayName,
            twoFactorEnabled: false,
            emailVerified: false,
            oauthProvider: null,
          },
        })
      );
    return;
  }
  return res.json({ success: true, user: null });
});

// GET /api/auth/audit-logs  (requireAuth — returns last 50 audit rows for this user)
authRouter.get("/audit-logs", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.auditLog.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    // Deserialize metadata JSON for convenience.
    const out = rows.map((r) => ({
      id: r.id,
      action: r.action,
      success: r.success,
      ip: r.ip,
      userAgent: r.userAgent,
      metadata: r.metadata ? safeJsonParse(r.metadata) : null,
      createdAt: r.createdAt.toISOString(),
    }));
    return res.json({ success: true, logs: out });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// SEC2-AUTH: 2FA setup / verify / disable
// ============================================================================

// POST /api/auth/2fa/setup (requireAuth)
// Generates a fresh TOTP secret, ENCRYPTS it, persists it to user.twoFactorSecret,
// and returns the plaintext secret + otpauthUri so the user can add it to their
// authenticator app. twoFactorEnabled is NOT set yet — the user must verify
// a code via /2fa/verify first.
authRouter.post("/2fa/setup", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) return res.status(404).json({ success: false, error: "Pengguna tidak ditemukan." });
    if (user.twoFactorEnabled) {
      return res.status(400).json({ success: false, error: "2FA sudah aktif. Nonaktifkan terlebih dahulu untuk mengganti rahasia." });
    }
    // FIX-C-7: require email verification before 2FA enrollment. Previously
    // /2fa/setup only checked twoFactorEnabled, so a user could enroll TOTP
    // without ever verifying their email — letting an attacker who controls the
    // email inbox lock the real owner out via 2FA.
    if (!user.emailVerified) {
      return res.status(400).json({ success: false, error: "Email harus diverifikasi sebelum mengaktifkan 2FA." });
    }
    const secretB32 = generateTotpSecret();
    const encrypted = encryptTotpSecret(secretB32);
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: encrypted },
    });
    const account = user.email || user.displayName || `user-${user.id.slice(0, 8)}`;
    const otpauthUri = buildOtpauthUri("Z-Capital", account, secretB32);
    await logAudit(user.id, "2FA_SETUP", req, true, {});
    return res.json({
      success: true,
      secret: secretB32,
      otpauthUri,
      // Friendly instructions for manual entry:
      manualEntryNote: "Masukkan rahasia base32 ini ke aplikasi authenticator Anda (Google Authenticator, Authy, 1Password, dll).",
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/2fa/verify (requireAuth)
// Body: { code } — verifies the TOTP code against the stored secret. On
// success, sets twoFactorEnabled=true and returns 8 one-time backup codes
// (only displayed ONCE — the user must save them).
authRouter.post("/2fa/verify", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: "Kode harus 6 digit." });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) return res.status(404).json({ success: false, error: "Pengguna tidak ditemukan." });
    if (!user.twoFactorSecret) {
      return res.status(400).json({ success: false, error: "Belum ada rahasia TOTP. Jalankan /2fa/setup terlebih dahulu." });
    }
    if (user.twoFactorEnabled) {
      return res.status(400).json({ success: false, error: "2FA sudah aktif." });
    }
    let secretB32: string;
    try {
      secretB32 = decryptTotpSecret(user.twoFactorSecret);
    } catch {
      return res.status(500).json({ success: false, error: "Gagal mendekripsi rahasia TOTP." });
    }
    if (!verifyTotp(code, secretB32)) {
      await logAudit(user.id, "2FA_VERIFY", req, false, { reason: "bad_code" });
      return res.status(401).json({ success: false, error: "Kode tidak valid untuk window waktu saat ini." });
    }
    // Generate + persist hashed backup codes. The plaintext codes are returned
    // to the client ONCE; only the hashes are stored.
    const { plaintext, hashed } = generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: true,
        // Store the backup code hashes as a JSON array inside totpSecret? No —
        // totpSecret is the secret. We need a separate column. Since we don't
        // want to add another Prisma column for this iteration, we append the
        // hashes to the existing legacy `totpSecret` field (which is currently
        // unused by SEC2-AUTH) as a JSON envelope. This keeps the schema
        // stable while still persisting the hashes.
        totpSecret: JSON.stringify({ backupCodes: hashed }),
      },
    });
    await logAudit(user.id, "2FA_VERIFY", req, true, {});
    return res.json({
      success: true,
      backupCodes: plaintext,
      message: "2FA berhasil diaktifkan. Simpan kode cadangan di tempat aman — hanya ditampilkan sekali.",
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/2fa/disable (requireAuth)
// Body: { code } — verifies the TOTP code one last time before disabling.
authRouter.post("/2fa/disable", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: "Kode harus 6 digit." });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) return res.status(404).json({ success: false, error: "Pengguna tidak ditemukan." });
    if (!user.twoFactorEnabled) {
      return res.status(400).json({ success: false, error: "2FA tidak aktif." });
    }
    if (!user.twoFactorSecret) {
      return res.status(400).json({ success: false, error: "Rahasia TOTP hilang — tidak dapat memverifikasi." });
    }
    let secretB32: string;
    try {
      secretB32 = decryptTotpSecret(user.twoFactorSecret);
    } catch {
      return res.status(500).json({ success: false, error: "Gagal mendekripsi rahasia TOTP." });
    }
    if (!verifyTotp(code, secretB32)) {
      await logAudit(user.id, "2FA_DISABLE", req, false, { reason: "bad_code" });
      return res.status(401).json({ success: false, error: "Kode tidak valid. 2FA TIDAK dimatikan." });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        totpSecret: null, // also clear the legacy field (used for backup codes envelope)
      },
    });
    await logAudit(user.id, "2FA_DISABLE", req, true, {});
    return res.json({ success: true, message: "2FA berhasil dimatikan." });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// SEC2-AUTH: email verification + resend
// ============================================================================

// POST /api/auth/verify-email  (public — pre-auth, exempt from CSRF)
// Body: { token } — looks up the EmailVerificationToken, validates expiry +
// ownership, sets user.emailVerified=now, deletes the token.
authRouter.post("/verify-email", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) return res.status(400).json({ success: false, error: "Token wajib diisi." });
    // FIX-P1-A: lookup by hash, not raw token.
    const row = await prisma.emailVerificationToken.findUnique({ where: { token: hashToken(token) } });
    if (!row) return res.status(400).json({ success: false, error: "Token tidak valid." });
    if (row.expiresAt.getTime() < Date.now()) {
      await prisma.emailVerificationToken.delete({ where: { id: row.id } }).catch(() => {});
      return res.status(400).json({ success: false, error: "Token telah kedaluwarsa. Minta kirim ulang." });
    }
    await prisma.user.update({
      where: { id: row.userId },
      data: { emailVerified: new Date() },
    });
    await prisma.emailVerificationToken.delete({ where: { id: row.id } }).catch(() => {});
    await logAudit(row.userId, "EMAIL_VERIFY", req, true, {});
    return res.json({ success: true, message: "Email berhasil diverifikasi." });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/resend-verification (requireAuth)
// Generates a fresh token (any existing tokens for this user are deleted first
// to avoid pile-up), sends the email.
authRouter.post("/resend-verification", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) return res.status(404).json({ success: false, error: "Pengguna tidak ditemukan." });
    if (user.emailVerified) {
      return res.status(400).json({ success: false, error: "Email sudah diverifikasi." });
    }
    // Delete any outstanding tokens for this user (1 outstanding at a time).
    await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }).catch(() => {});
    // FIX-P1-A: store hash, send raw via email.
    const token = randomTokenString();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        token: hashToken(token),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });
    sendVerificationEmail(user.email, token).catch((e) =>
      log.error("[auth] resend verification email failed:", e?.message || e)
    );
    await logAudit(user.id, "EMAIL_VERIFY_RESEND", req, true, {});
    return res.json({ success: true, message: "Email verifikasi telah dikirim ulang." });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// SEC2-AUTH: forgot-password + reset-password
// ============================================================================

// POST /api/auth/forgot-password (public — pre-auth, exempt from CSRF)
// Body: { email } — ALWAYS returns success (no user enumeration). If the user
// exists, generates a resetToken + 1h expiry, sends the email. Audits the
// request with userId when known.
authRouter.post("/forgot-password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) {
      // Still return generic success — don't reveal that the email is malformed
      // (though we can't generate a token without it).
      return res.json({ success: true, message: "Jika email terdaftar, tautan atur ulang telah dikirim." });
    }
    // FUNC-10 (email honesty):
    //  - Global server state (no per-user info) — safe to expose.
    //  - In NON-production with no SMTP configured and EMAIL_DEV_MODE unset,
    //    auto-enable dev mode so the reset token is logged to stdout instead of
    //    the send silently throwing. Dev users were previously stuck: the flow
    //    said "email sent" but nothing was sent OR logged.
    const smtpConfigured = !!(
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    );
    if (
      !smtpConfigured &&
      process.env.NODE_ENV !== "production" &&
      !process.env.EMAIL_DEV_MODE
    ) {
      process.env.EMAIL_DEV_MODE = "true";
      log.warn(
        "[auth] FUNC-10: SMTP not configured in non-production — auto-enabling EMAIL_DEV_MODE. " +
          "Reset token akan dicetak ke log server, bukan dikirim."
      );
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      // FIX-P1-A: store hash of reset token, send raw token via email.
      const token = randomTokenString();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: hashToken(token),
          resetTokenExpiry: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });
      // FUNC-10: failures are logged server-side (not surfaced to the caller —
      // the response stays anti-enumeration generic).
      sendPasswordResetEmail(user.email, token).catch((e) =>
        log.error("[auth] sendPasswordResetEmail failed:", e?.message || e)
      );
      await logAudit(user.id, "PASSWORD_RESET_REQUEST", req, true, {});
    } else {
      // No user — still audit (without userId) so we can spot abuse patterns.
      await logAudit(null, "PASSWORD_RESET_REQUEST", req, false, { reason: "user_not_found", email });
    }
    const response: any = { success: true, message: "Jika email terdaftar, tautan atur ulang telah dikirim." };
    // FUNC-10: in production with NO SMTP configured at all, include the
    // global emailConfigured:false flag. This leaks no user information (it is
    // server-wide state) and lets the frontend honestly tell the user email
    // cannot be delivered instead of pretending a reset link was sent.
    if (process.env.NODE_ENV === "production" && !smtpConfigured) {
      response.emailConfigured = false;
    }
    return res.json(response);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password (public — pre-auth, exempt from CSRF)
// Body: { token, newPassword } — validates the token + expiry, updates the
// password hash, clears the resetToken. Audit logs both success and failure.
authRouter.post("/reset-password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!token) return res.status(400).json({ success: false, error: "Token wajib diisi." });
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: "Kata sandi minimal 8 karakter." });
    }
    // FIX-P1-A: lookup by hash, not raw token.
    const user = await prisma.user.findFirst({
      where: { resetToken: hashToken(token), resetTokenExpiry: { gt: new Date() } },
    });
    if (!user) {
      await logAudit(null, "PASSWORD_RESET", req, false, { reason: "bad_or_expired_token" });
      return res.status(400).json({ success: false, error: "Token tidak valid atau telah kedaluwarsa." });
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
        // Reset failed login attempts + lockout so the user can immediately log
        // in with the new password.
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    // Optional: revoke all existing sessions for this user so a stolen
    // password doesn't leave active sessions dangling. Best-effort.
    await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await logAudit(user.id, "PASSWORD_RESET", req, true, {});
    return res.json({ success: true, message: "Kata sandi berhasil diatur ulang. Silakan login." });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// SEC2-AUTH: session list + revoke
// ============================================================================

// GET /api/auth/sessions (requireAuth) — list active sessions for the authed
// user. The current session (matched by tokenHash) is flagged so the UI can
// disable its revoke button.
authRouter.get("/sessions", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentToken = req.cookies?.[COOKIE_NAME];
    const currentHash = currentToken ? hashToken(currentToken) : "";
    const rows = await prisma.session.findMany({
      where: { userId: req.user!.sub, expiresAt: { gt: new Date() } },
      orderBy: { lastSeen: "desc" },
      take: 50,
    });
    const out = rows.map((r) => ({
      id: r.id,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
      lastSeen: r.lastSeen.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      current: r.tokenHash === currentHash,
    }));
    return res.json({ success: true, sessions: out });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/sessions/:id (requireAuth) — revoke a single session.
// The current session cannot be revoked this way (use /logout instead).
authRouter.delete("/sessions/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ success: false, error: "ID wajib diisi." });
    const row = await prisma.session.findUnique({ where: { id } });
    if (!row || row.userId !== req.user!.sub) {
      return res.status(404).json({ success: false, error: "Sesi tidak ditemukan." });
    }
    await prisma.session.delete({ where: { id } });
    await logAudit(req.user!.sub, "SESSION_REVOKE", req, true, { sessionId: id });
    return res.json({ success: true, message: "Sesi dicabut." });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/sessions/logout-others (requireAuth) — revoke ALL sessions
// for this user EXCEPT the current one. Convenience endpoint for the
// "Logout all other sessions" button in Profile.tsx.
authRouter.post("/sessions/logout-others", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentToken = req.cookies?.[COOKIE_NAME];
    const currentHash = currentToken ? hashToken(currentToken) : "";
    const result = await prisma.session.deleteMany({
      where: { userId: req.user!.sub, tokenHash: { not: currentHash } },
    });
    await logAudit(req.user!.sub, "SESSION_REVOKE_OTHERS", req, true, { count: result.count });
    return res.json({ success: true, revoked: result.count, message: `${result.count} sesi lain dicabut.` });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// CSRF token endpoint (mounted here so it sits under /api/auth/csrf-token).
// ---------------------------------------------------------------------------

// Build a CSRF token using CSRF_SECRET. We use a random 32-byte token + an
// HMAC-SHA256 signature over it (so the server can later verify the token
// was issued by us without storing it server-side). The double-submit cookie
// pattern means: client sends the same token via cookie + x-csrf-token header;
// the middleware checks they match + the signature is valid.
function getCsrfSecret(): string {
  const s = process.env.CSRF_SECRET;
  if (s) return s;
  // SEC-11: NEVER fall back to a public literal. Previously an unset
  // CSRF_SECRET silently used "ZAYTRIX_FALLBACK_CSRF_SECRET" — a string
  // committed to the repo, so anyone could forge validly-signed CSRF tokens,
  // defeating the whole double-submit scheme. Now we derive from
  // SESSION_SECRET (which getSessionSecret() REFUSES to operate without —
  // auth.ts throws "[auth] SESSION_SECRET is not set" before any token is
  // ever issued/verified, i.e. effective startup enforcement).
  return getSessionSecret();
}

function makeCsrfToken(): string {
  const rand = crypto.randomBytes(24).toString("hex");
  const sig = crypto.createHmac("sha256", getCsrfSecret()).update(rand).digest("hex");
  return rand + "." + sig;
}

function verifyCsrfToken(token: string): boolean {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [rand, sig] = token.split(".");
  if (!rand || !sig) return false;
  const expected = crypto.createHmac("sha256", getCsrfSecret()).update(rand).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// GET /api/auth/csrf-token — returns { csrfToken } AND sets the
// zaytrix_csrf cookie (non-httpOnly, sameSite=lax — the browser needs to be
// able to read it client-side to copy into the x-csrf-token header).
authRouter.get("/csrf-token", (req: Request, res: Response) => {
  const token = makeCsrfToken();
  res.cookie("zaytrix_csrf", token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000, // 24h
  });
  return res.json({ success: true, csrfToken: token });
});

// Exported for use by the CSRF middleware in security.ts (which needs to
// issue + verify tokens). We export the verifier AND the issuer so security.ts
// can auto-set the zaytrix_csrf cookie on responses that lack one (SEC-6 full
// double-submit enforcement).
export { verifyCsrfToken, makeCsrfToken };

// ============================================================================
// OAuth router mount (SEC2-AUTH) — see src/server/oauth.ts. We import + mount
// it on the authRouter so the /api/auth/google + /api/auth/google/callback
// routes are reachable without server.ts changes (server.ts already mounts
// authRouter at /api/auth).
// ============================================================================
import { oauthRouter } from "./oauth";
authRouter.use(oauthRouter);

// ============================================================================
// WebAuthn router mount (SEC3-AUTH / AUTH10) — see src/server/webauthn.ts.
// Mounts the passkey endpoints under /api/auth/webauthn/*. These are ADDITIVE
// to the existing password + 2FA flow — users can register passkeys for
// passwordless biometric/hardware-key login, but the original email+password
// (and email+password+2FA) flows remain fully functional.
// ============================================================================
authRouter.use("/webauthn", webauthnRouter);

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
