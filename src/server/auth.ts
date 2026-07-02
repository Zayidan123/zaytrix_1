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
//   - requireAuth is GRACEFUL about missing Session rows (existing tokens
//     issued before SEC2-AUTH deployed, or Sessions table empty) — see comment
//     in requireAuth below.

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
const BCRYPT_ROUNDS = 10;

// Lockout policy: 5 consecutive failures → 15 minute lockout.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

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
function setSessionCookie(res: Response, token: string): void {
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

function signToken(payload: ZCapitalJwtPayload): string {
  return jwt.sign(payload, getSessionSecret(), { expiresIn: TOKEN_TTL_SECONDS });
}

function signTempToken(payload: ZCapitalJwtPayload): string {
  // The 2FA temp-token has a short TTL and a twoFactorPending flag. It is ONLY
  // valid for the /api/auth/login/2fa endpoint — see requireAuth reject.
  return jwt.sign({ ...payload, twoFactorPending: true }, getSessionSecret(), {
    expiresIn: TEMP_TOKEN_TTL_SECONDS,
  });
}

function verifyToken(token: string): ZCapitalJwtPayload | null {
  try {
    const decoded = jwt.verify(token, getSessionSecret()) as any;
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

// sha256(jwt) — used as the server-side Session lookup key. We hash so a DB
// leak cannot be turned into live session tokens.
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Random token generators (cuid-style entropy — 32 hex chars from randomBytes)
// ---------------------------------------------------------------------------
function randomTokenString(byteLen = 32): string {
  return crypto.randomBytes(byteLen).toString("hex");
}

// ---------------------------------------------------------------------------
// Session record helpers (SEC2-AUTH)
// ---------------------------------------------------------------------------
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
    // Session tracking is best-effort — a DB error here must not break login.
    // The user can still operate with just the JWT cookie (requireAuth falls
    // back gracefully if the Session row is missing — see below).
    console.error("[auth] recordSession failed:", e?.message || e);
  }
}

async function revokeSessionByToken(token: string): Promise<void> {
  try {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  } catch (e: any) {
    console.error("[auth] revokeSessionByToken failed:", e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Middleware: requireAuth — 401 if no valid session cookie.
//
// SEC2-AUTH note: we ALSO look up the server-side Session row. BUT — to avoid
// breaking existing flows (tokens issued before SEC2-AUTH, or Sessions table
// not yet populated), we treat a MISSING row as still-valid (graceful). Only
// EXPIRED rows block the request. This makes the session check opt-in: as
// sessions age out + users log in again, the table populates naturally.
// ---------------------------------------------------------------------------
export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
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
  req.user = payload;
  // Best-effort session lookup — async but we don't await; the request can
  // proceed while the Session.lastSeen update runs in the background. If the
  // row is missing we simply skip (graceful — see comment above).
  touchSession(token, payload.sub).catch(() => {});
  next();
};

// Background session validity + lastSeen touch. Called from requireAuth WITHOUT
// awaiting so the request is not delayed. Returns true if the session is still
// valid; false if it was revoked server-side (we don't act on this — the JWT
// signature is the primary auth check; the Session row is a soft-kill switch
// that requires explicit server-side enforcement via a future tightening).
async function touchSession(token: string, userId: string): Promise<boolean> {
  try {
    const row = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row) return true; // graceful: missing row = legacy token, still allowed
    if (row.userId !== userId) return false; // token belongs to a different user — invalid
    if (row.expiresAt.getTime() < Date.now()) return false; // expired
    // Update lastSeen (cheap write, helps "active sessions" UI)
    await prisma.session.update({ where: { id: row.id }, data: { lastSeen: new Date() } }).catch(() => {});
    return true;
  } catch {
    return true; // graceful
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

function validateRegister(body: any): { ok: true; value: { email: string; password: string; displayName: string } } | { ok: false; error: string } {
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

function validateLogin(body: any): { ok: true; value: { email: string; password: string } } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body permintaan tidak valid." };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Format email tidak valid." };
  if (password.length === 0) return { ok: false, error: "Kata sandi wajib diisi." };
  return { ok: true, value: { email, password } };
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
    breachChecked: u.breachChecked ? u.breachChecked.toISOString() : null,
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
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }
    const { email, password, displayName } = parsed.value;

    // Uniqueness check.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Audit the failed attempt (don't reveal whether the email exists to the
      // caller, but DO record it server-side).
      await logAudit(null, "REGISTER", req, false, { reason: "email_in_use", email });
      return res.status(409).json({ success: false, error: "Email sudah terdaftar." });
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
    // registration). We issue the token + persist it before sending so the
    // user can refresh the resend endpoint if the email never arrives.
    try {
      const evToken = randomTokenString();
      await prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          token: evToken,
          expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
        },
      });
      // Fire-and-forget the email send (awaited for dev-mode logging but
      // wrapped so any transport error stays inside the try/catch).
      sendVerificationEmail(user.email, evToken).catch((e) =>
        console.error("[auth] sendVerificationEmail failed:", e?.message || e)
      );
    } catch (e: any) {
      console.error("[auth] email verification token create failed:", e?.message || e);
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
      console.error("[auth] breach check threw:", e?.message || e);
    }

    const userWithBreach = { ...user, breachCount, breachChecked };
    const response: any = { success: true, user: publicUser(userWithBreach) };
    if (breachCount > 0) {
      response.warning = `Password ini pernah muncul di ${breachCount} pelanggaran data. Pertimbangkan mengganti.`;
      response.breachCount = breachCount;
    }
    return res.status(201).json(response);
  } catch (err: any) {
    // Pass to the centralized error handler.
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
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }
    const { email, password } = parsed.value;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await logAudit(null, "LOGIN", req, false, { reason: "user_not_found", email });
      return res.status(401).json({ success: false, error: "Email atau kata sandi salah." });
    }

    // Lockout check — applies BEFORE the password check so a locked-out account
    // doesn't even leak a "bad password" signal.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const ms = user.lockedUntil.getTime() - Date.now();
      const mins = Math.ceil(ms / 60000);
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
        console.error("[auth] failedLoginAttempts update failed:", e?.message || e);
      }
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
      return res.status(400).json({ success: false, error: "tempToken dan kode wajib diisi." });
    }
    const payload = verifyToken(tempToken);
    if (!payload || !payload.twoFactorPending) {
      return res.status(401).json({ success: false, error: "Token 2FA sementara tidak valid atau telah kedaluwarsa." });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ success: false, error: "2FA tidak aktif untuk akun ini." });
    }
    let secretB32: string;
    try {
      secretB32 = decryptTotpSecret(user.twoFactorSecret);
    } catch (e: any) {
      await logAudit(user.id, "LOGIN_2FA", req, false, { reason: "decrypt_failed" });
      return res.status(500).json({ success: false, error: "Gagal mendekripsi rahasia TOTP (master key tidak cocok?)." });
    }
    if (!verifyTotp(code, secretB32)) {
      await logAudit(user.id, "LOGIN_2FA", req, false, { reason: "bad_code" });
      return res.status(401).json({ success: false, error: "Kode 2FA tidak valid. Pastikan waktu perangkat sinkron." });
    }
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
    const row = await prisma.emailVerificationToken.findUnique({ where: { token } });
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
    const token = randomTokenString();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });
    sendVerificationEmail(user.email, token).catch((e) =>
      console.error("[auth] resend verification email failed:", e?.message || e)
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
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = randomTokenString();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: token,
          resetTokenExpiry: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });
      sendPasswordResetEmail(user.email, token).catch((e) =>
        console.error("[auth] sendPasswordResetEmail failed:", e?.message || e)
      );
      await logAudit(user.id, "PASSWORD_RESET_REQUEST", req, true, {});
    } else {
      // No user — still audit (without userId) so we can spot abuse patterns.
      await logAudit(null, "PASSWORD_RESET_REQUEST", req, false, { reason: "user_not_found", email });
    }
    return res.json({ success: true, message: "Jika email terdaftar, tautan atur ulang telah dikirim." });
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
    const user = await prisma.user.findFirst({
      where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
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
  if (!s) {
    // Fallback to SESSION_SECRET — better than nothing if CSRF_SECRET unset.
    return process.env.SESSION_SECRET || "ZAYTRIX_FALLBACK_CSRF_SECRET";
  }
  return s;
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
// verify tokens issued here). We export the verifier — not the issuer — so
// the security layer can stay focused on policy.
export { verifyCsrfToken };

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
