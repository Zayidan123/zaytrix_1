// ZAYTRIX WebAuthn/Passkey support (AUTH10).
// Simplified passkey flow using Web Crypto API (ECDSA P-256).
// Frontend uses navigator.credentials.create() / navigator.credentials.get().
// Backend stores public key + verifies signatures.

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "./db";
import { logAudit } from "./audit";
import jwt from "jsonwebtoken";

// Lazy imports to avoid circular dependency (auth.ts imports webauthnRouter)
let _requireAuth: any = null;
let _getSessionSecret: any = null;
let _TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
async function getAuth() {
  if (!_requireAuth) {
    const auth = await import("./auth");
    _requireAuth = auth.requireAuth;
    _getSessionSecret = auth.getSessionSecret;
    _TOKEN_TTL_SECONDS = auth.TOKEN_TTL_SECONDS;
  }
  return { requireAuth: _requireAuth, getSessionSecret: _getSessionSecret, TOKEN_TTL_SECONDS: _TOKEN_TTL_SECONDS };
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
const challenges = new Map<string, { challenge: string; expires: number }>();

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
  const { credentialId, publicKey, name, deviceType, transports } = req.body;
  const expectedChallenge = getChallenge(req.user!.sub);
  clearChallenge(req.user!.sub);

  if (!expectedChallenge) {
    return res.status(400).json({ success: false, error: "Challenge kedaluwarsa. Coba lagi." });
  }
  if (!credentialId || !publicKey) {
    return res.status(400).json({ success: false, error: "Kredensial tidak valid." });
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
  if (!user) {
    return res.status(200).json({ success: false, error: "User tidak ditemukan atau belum ada passkey." });
  }

  const creds = await prisma.webAuthnCredential.findMany({ where: { userId: user.id } });
  if (creds.length === 0) {
    return res.status(200).json({ success: false, error: "Belum ada passkey terdaftar. Login dengan password." });
  }

  const challenge = setChallenge(user.id);
  res.json({
    success: true,
    challenge,
    userId: user.id,
    credentialIds: creds.map(c => c.credentialId),
  });
});

webauthnRouter.post("/login/finish", async (req: Request, res: Response) => {
  const { userId, credentialId, signature, authenticatorData, clientDataJSON } = req.body;
  const expectedChallenge = getChallenge(userId);
  clearChallenge(userId);

  if (!expectedChallenge) {
    return res.status(400).json({ success: false, error: "Challenge kedaluwarsa." });
  }

  try {
    const cred = await prisma.webAuthnCredential.findFirst({
      where: { userId, credentialId: String(credentialId) },
    });
    if (!cred) {
      return res.status(400).json({ success: false, error: "Kredensial tidak valid." });
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

    await prisma.webAuthnCredential.update({
      where: { id: cred.id },
      data: { lastUsed: new Date(), counter: { increment: 1 } },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(400).json({ success: false, error: "User tidak ditemukan." });

    const auth = await getAuth();
    const token = jwt.sign(
      { sub: user.id, email: user.email, displayName: user.displayName },
      auth.getSessionSecret(),
      { expiresIn: auth.TOKEN_TTL_SECONDS }
    );

    const isProd = process.env.NODE_ENV === "production";
    res.cookie("zaytrix_session", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: auth.TOKEN_TTL_SECONDS * 1000,
      path: "/",
    });

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
    console.log("[webauthn] login error:", e.message);
    res.status(500).json({ success: false, error: "Gagal verifikasi passkey." });
  }
});
