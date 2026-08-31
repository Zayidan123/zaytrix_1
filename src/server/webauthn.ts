import { createLogger } from "./logger";
const log = createLogger("webauthn");

// ZAYTRIX WebAuthn/Passkey support (AUTH10).
// Simplified passkey flow using Web Crypto API (ECDSA P-256).
// Frontend uses navigator.credentials.create() / navigator.credentials.get().
// Backend stores public key + verifies signatures.

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "./db";
import { logAudit } from "./audit";

// Lazy imports to avoid circular dependency (auth.ts imports webauthnRouter)
let _requireAuth: any = null;
let _getSessionSecret: any = null;
let _TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
let _recordSession: any = null;
let _signSessionToken: any = null;
let _setSessionCookie: any = null;
async function getAuth() {
  if (!_requireAuth) {
    const auth = await import("./auth");
    _requireAuth = auth.requireAuth;
    _getSessionSecret = auth.getSessionSecret;
    _TOKEN_TTL_SECONDS = auth.TOKEN_TTL_SECONDS;
    // SEC-5b / SEC-13: reuse auth.ts helpers so passkey sessions are recorded
    // in the Session table (revocable) and carry identical JWT claims.
    _recordSession = auth.recordSession;
    _signSessionToken = auth.signSessionToken;
    _setSessionCookie = auth.setSessionCookie;
  }
  return {
    requireAuth: _requireAuth,
    getSessionSecret: _getSessionSecret,
    TOKEN_TTL_SECONDS: _TOKEN_TTL_SECONDS,
    recordSession: _recordSession,
    signSessionToken: _signSessionToken,
    setSessionCookie: _setSessionCookie,
  };
}

// Middleware wrapper for lazy requireAuth
async function authMiddleware(req: Request, res: Response): Promise<boolean> {
  const { requireAuth } = await getAuth();
  return new Promise((resolve) => {
    requireAuth(req, res, (err: any) => {
      if (err) resolve(false);
      else resolve(true);
    });
  });
}

export const webauthnRouter = Router();

// Temporary challenge store (in-memory, 5-min expiry)
// REGISTRATION challenges stay keyed by userId (register/begin is authed and
// the user identity is already established by requireAuth).
const challenges = new Map<string, { challenge: string; expires: number }>();

// SEC-10: LOGIN challenges are keyed by an opaque random `loginId`
// (crypto.randomUUID) instead of userId. The client only ever sees
// { loginId, challenge } — the server keeps userId + the allowed credential
// IDs server-side. Previously /login/begin returned `userId` (internal cuid)
// AND the raw credential ID list, leaking which emails have passkeys and
// giving an attacker the allowList needed to craft assertions.
interface LoginChallengeEntry {
  challenge: string;
  userId: string;
  allowedCredentialIds: string[];
  expires: number;
}
const loginChallenges = new Map<string, LoginChallengeEntry>();

function generateChallenge(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function setChallenge(userId: string): string {
  const challenge = generateChallenge();
  challenges.set(userId, { challenge, expires: Date.now() + 5 * 60 * 1000 });
  return challenge;
}

function getChallenge(userId: string): string | null {
  const entry = challenges.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    challenges.delete(userId);
    return null;
  }
  return entry.challenge;
}

function clearChallenge(userId: string) {
  challenges.delete(userId);
}

// ─── REGISTRATION ────────────────────────────────────────────────────

webauthnRouter.post("/register/begin", async (req: Request, res: Response) => {
  const ok = await authMiddleware(req, res);
  if (!ok) return; // requireAuth already sent 401
  const challenge = setChallenge(req.user!.sub);
  res.json({
    success: true,
    challenge,
    rp: { name: "ZAYTRIX", id: req.headers.host?.split(":")[0] || "localhost" },
    user: { id: req.user!.sub, name: req.user!.email, displayName: req.user!.displayName },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 60000,
  });
});

webauthnRouter.post("/register/finish", async (req: Request, res: Response) => {
  const ok = await authMiddleware(req, res);
  if (!ok) return;
  const { credentialId, publicKey, name, deviceType, transports, clientDataJSON: regClientData } = req.body;
  const expectedChallenge = getChallenge(req.user!.sub);
  clearChallenge(req.user!.sub);

  if (!expectedChallenge) {
    return res.status(400).json({ success: false, error: "Challenge kedaluwarsa. Coba lagi." });
  }
  if (!credentialId || !publicKey) {
    return res.status(400).json({ success: false, error: "Kredensial tidak valid." });
  }

  // FIX-P1-C: verify the registration ceremony's clientDataJSON challenge matches
  // the expected challenge we issued. Without this, an attacker could replay a
  // registration from a different RP or session. Also verify origin + type.
  if (regClientData) {
    try {
      const cd = JSON.parse(Buffer.from(String(regClientData), "base64url").toString("utf-8"));
      const cdChallenge = cd.challenge; // base64url string
      const cdOrigin = cd.origin;
      const cdType = cd.type;
      if (cdType !== "webauthn.create") {
        return res.status(400).json({ success: false, error: "Tipe clientDataJSON tidak valid untuk registrasi." });
      }
      // Constant-time challenge comparison.
      const expectedB64 = Buffer.from(expectedChallenge, "utf-8").toString("base64url");
      const a = Buffer.from(cdChallenge || "");
      const b = Buffer.from(expectedB64);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        await logAudit(req.user!.sub, "WEBAUTHN_REGISTER", req, false, { reason: "challenge_mismatch" });
        return res.status(400).json({ success: false, error: "Challenge registrasi tidak cocok." });
      }
      // Origin check (allow localhost variants for dev + the configured APP_URL).
      const allowedOrigins = [
        process.env.APP_URL,
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
      ].filter(Boolean);
      if (cdOrigin && !allowedOrigins.includes(cdOrigin)) {
        await logAudit(req.user!.sub, "WEBAUTHN_REGISTER", req, false, { reason: "origin_mismatch", origin: cdOrigin });
        return res.status(400).json({ success: false, error: "Origin tidak diizinkan." });
      }
    } catch (e: any) {
      return res.status(400).json({ success: false, error: "clientDataJSON tidak valid." });
    }
  }

  try {
    const cred = await prisma.webAuthnCredential.create({
      data: {
        userId: req.user!.sub,
        credentialId: String(credentialId),
        publicKey: String(publicKey),
        name: name || "Passkey",
        deviceType: deviceType || null,
        transports: transports ? JSON.stringify(transports) : null,
      },
    });
    await logAudit(req.user!.sub, "WEBAUTHN_REGISTER", req, true, { credentialId: cred.id });
    res.json({ success: true, credential: { id: cred.id, name: cred.name } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal menyimpan passkey." });
  }
});

webauthnRouter.get("/credentials", async (req: Request, res: Response) => {
  const ok = await authMiddleware(req, res);
  if (!ok) return;
  const creds = await prisma.webAuthnCredential.findMany({
    where: { userId: req.user!.sub },
    select: { id: true, name: true, deviceType: true, createdAt: true, lastUsed: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ success: true, credentials: creds });
});

webauthnRouter.delete("/credentials/:id", async (req: Request, res: Response) => {
  const ok = await authMiddleware(req, res);
  if (!ok) return;
  try {
    await prisma.webAuthnCredential.delete({
      where: { id: req.params.id, userId: req.user!.sub },
    });
    await logAudit(req.user!.sub, "WEBAUTHN_DELETE", req, true, { id: req.params.id });
    res.json({ success: true });
  } catch {
    res.status(404).json({ success: false, error: "Passkey tidak ditemukan." });
  }
});

// ─── LOGIN (passwordless) ────────────────────────────────────────────

webauthnRouter.post("/login/begin", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: "Email wajib diisi." });

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  const creds = user ? await prisma.webAuthnCredential.findMany({ where: { userId: user.id } }) : [];

  // SEC-10 + anti-enumeration: the response shape is IDENTICAL whether the
  // user exists, has no passkey, or has passkeys — always { loginId, challenge }.
  // For an unknown user / no passkey we return a freshly-generated random
  // loginId + a FAKE challenge that is never stored, so /login/finish will
  // reject with the same "challenge expired" error as any other unknown
  // loginId. No userId, no credential list, no timing-observable difference.
  if (!user || creds.length === 0) {
    const dummyLoginId = crypto.randomUUID();
    const dummyChallenge = generateChallenge();
    return res.json({
      success: true,
      loginId: dummyLoginId,
      challenge: dummyChallenge,
    });
  }

  // Real flow: store the challenge + allowed credentials under an opaque
  // loginId. The client sends { loginId, assertion } to /login/finish; the
  // server resolves userId + allowList internally.
  const loginId = crypto.randomUUID();
  const challenge = generateChallenge();
  loginChallenges.set(loginId, {
    challenge,
    userId: user.id,
    allowedCredentialIds: creds.map((c) => c.credentialId),
    expires: Date.now() + 5 * 60 * 1000,
  });
  res.json({
    success: true,
    loginId,
    challenge,
  });
});

webauthnRouter.post("/login/finish", async (req: Request, res: Response) => {
  // SEC-10: the client sends the opaque loginId (NOT userId). userId + the
  // allowed credential list live only in the server-side challenge entry.
  const { loginId, credentialId, signature, authenticatorData, clientDataJSON } = req.body;

  const entry = typeof loginId === "string" ? loginChallenges.get(loginId) : undefined;
  if (entry) loginChallenges.delete(loginId); // single-use challenge

  if (!entry || Date.now() > entry.expires) {
    // Covers: unknown loginId (fake begin for unknown user), expired, or
    // replayed loginId. Same generic error for all → no information leak.
    return res.status(400).json({ success: false, error: "Challenge kedaluwarsa." });
  }
  const userId = entry.userId;
  const expectedChallenge = entry.challenge;

  // The presented credential MUST be one of the credentials bound to this
  // login attempt (the allowList never left the server — SEC-10).
  if (!credentialId || !entry.allowedCredentialIds.includes(String(credentialId))) {
    await logAudit(userId, "WEBAUTHN_LOGIN", req, false, { reason: "credential_not_allowed" });
    return res.status(400).json({ success: false, error: "Kredensial tidak valid." });
  }

  try {
    const cred = await prisma.webAuthnCredential.findFirst({
      where: { userId, credentialId: String(credentialId) },
    });
    if (!cred) {
      return res.status(400).json({ success: false, error: "Kredensial tidak valid." });
    }

    // FIX-P1-C: VERIFY CHALLENGE + ORIGIN + TYPE before checking signature.
    // Previously the expectedChallenge was fetched but NEVER compared to the
    // challenge inside clientDataJSON, making passkey login replayable with
    // any captured assertion. Now we strictly verify:
    //   1. clientData.type === "webauthn.get"
    //   2. clientData.challenge === expectedChallenge (constant-time, base64url)
    //   3. clientData.origin is in the allowed list
    try {
      const cd = JSON.parse(Buffer.from(String(clientDataJSON), "base64url").toString("utf-8"));
      if (cd.type !== "webauthn.get") {
        await logAudit(userId, "WEBAUTHN_LOGIN", req, false, { reason: "wrong_client_data_type" });
        return res.status(400).json({ success: false, error: "Tipe clientDataJSON tidak valid untuk login." });
      }
      const expectedB64 = Buffer.from(expectedChallenge, "utf-8").toString("base64url");
      const a = Buffer.from(cd.challenge || "");
      const b = Buffer.from(expectedB64);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        await logAudit(userId, "WEBAUTHN_LOGIN", req, false, { reason: "challenge_mismatch" });
        return res.status(401).json({ success: false, error: "Challenge login tidak cocok (replay ditolak)." });
      }
      const allowedOrigins = [
        process.env.APP_URL,
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
      ].filter(Boolean);
      if (cd.origin && !allowedOrigins.includes(cd.origin)) {
        await logAudit(userId, "WEBAUTHN_LOGIN", req, false, { reason: "origin_mismatch", origin: cd.origin });
        return res.status(401).json({ success: false, error: "Origin tidak diizinkan." });
      }
    } catch (e: any) {
      await logAudit(userId, "WEBAUTHN_LOGIN", req, false, { reason: "invalid_client_data" });
      return res.status(400).json({ success: false, error: "clientDataJSON tidak valid." });
    }

    // Verify signature using stored public key
    const pubKeyBuf = Buffer.from(cred.publicKey, "base64url");
    const sigBuf = Buffer.from(String(signature), "base64url");
    const authDataBuf = Buffer.from(String(authenticatorData), "base64url");
    const clientDataBuf = Buffer.from(String(clientDataJSON), "base64url");
    const signedData = Buffer.concat([authDataBuf, crypto.createHash("sha256").update(clientDataBuf).digest()]);

    const verify = crypto.createVerify("sha256");
    verify.update(signedData);
    let valid = false;
    try {
      valid = verify.verify({ key: pubKeyBuf, format: "der", type: "spki" }, sigBuf);
    } catch {
      valid = false;
    }

    if (!valid) {
      await logAudit(userId, "WEBAUTHN_LOGIN", req, false, { reason: "invalid_signature" });
      return res.status(401).json({ success: false, error: "Verifikasi passkey gagal." });
    }

    // FIX-P1-C: counter clone-detection. Per WebAuthn spec, the authenticator
    // sign-count MUST monotonically increase. If the incoming counter equals
    // the stored counter (and is non-zero), the credential may have been
    // cloned — refuse login and audit the anomaly.
    const authDataView = new DataView(authDataBuf.buffer, authDataBuf.byteOffset, authDataBuf.byteLength);
    // rpIdHash (32) + flags (1) + signCount (4 BE) at offset 33
    const incomingCounter = authDataBuf.length >= 37 ? authDataView.getUint32(33, false) : 0;
    if (cred.counter > 0 && incomingCounter > 0 && incomingCounter <= cred.counter) {
      await logAudit(userId, "WEBAUTHN_LOGIN", req, false, { reason: "counter_replay", stored: cred.counter, incoming: incomingCounter });
      return res.status(401).json({ success: false, error: "Counter passkey tidak monotik — kemungkinan kloning. Login ditolak." });
    }

    await prisma.webAuthnCredential.update({
      where: { id: cred.id },
      data: { lastUsed: new Date(), counter: { increment: 1 } },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(400).json({ success: false, error: "User tidak ditemukan." });

    // SEC-13 + SEC-5b: issue the session via the SAME auth.ts helpers used by
    // password/2FA/OAuth login — identical JWT claims (HS256 pinned, iss/aud)
    // and, critically, a Session row so the passkey session is LISTED in
    // /api/auth/sessions and can be REVOKED (previously passkey JWTs were
    // invisible to the revocation system — SEC-5b). requireAuth is fail-closed
    // (SEC-5), so without recordSession the cookie would be rejected on the
    // very next request.
    const auth = await getAuth();
    const token = auth.signSessionToken({
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
    });
    auth.setSessionCookie(res, token);
    await auth.recordSession(req, user.id, token);

    await logAudit(user.id, "WEBAUTHN_LOGIN", req, true);
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    });
  } catch (e: any) {
    log.info("[webauthn] login error:", e.message);
    res.status(500).json({ success: false, error: "Gagal verifikasi passkey." });
  }
});
