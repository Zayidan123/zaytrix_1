// ===========================================================================
// ZAYTRIX Firebase Auth Router (SEC3-AUTH)
// ===========================================================================
// Endpoints for Firebase Client SDK authentication:
//
//   POST /api/auth/firebase/verify
//     Body: { idToken: string }
//     1. Verify Firebase ID token server-side via Firebase Admin SDK.
//     2. Find or create user in Prisma.
//     3. Issue zaytrix_session JWT cookie (identical to email/password flow).
//     4. Return user profile.
//
//     Response: { success: true, user, isNew } | { success: false, error }
//
//   POST /api/auth/firebase/status
//     Returns: { configured: boolean } — honest status of Firebase integration.
//
// This module is mounted inside authRouter (auth.ts: authRouter.use(firebaseAuth)).
// Routes are reachable at /api/auth/firebase/*.
// ===========================================================================

import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyFirebaseIdToken, findOrCreateUser, isFirebaseConfigured } from "./firebaseAdmin";
import { getSessionSecret, setSessionCookie, TOKEN_TTL_SECONDS, JWT_ISSUER, JWT_AUDIENCE } from "./authConfig";
import { prisma } from "./db";
import { logAudit } from "./audit";
import { recordSession } from "./auth";

export const firebaseAuthRouter = Router();

// POST /api/auth/firebase/verify
firebaseAuthRouter.post("/verify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isFirebaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: "Firebase Authentication belum dikonfigurasi. Hubungi administrator.",
      });
    }

    const idToken: string = typeof req.body?.idToken === "string" ? req.body.idToken : "";
    if (!idToken) {
      return res.status(400).json({ success: false, error: "idToken wajib diisi." });
    }

    const firebaseUser = await verifyFirebaseIdToken(idToken);
    if (!firebaseUser) {
      logAudit(null, "FIREBASE_LOGIN", req, false, { reason: "invalid_token" });
      return res.status(401).json({ success: false, error: "Token Firebase tidak valid atau kedaluwarsa." });
    }

    const { user, created } = await findOrCreateUser(firebaseUser) || { user: null, created: false };
    if (!user) {
      logAudit(null, "FIREBASE_LOGIN", req, false, { reason: "user_create_failed", email: firebaseUser.email });
      return res.status(500).json({ success: false, error: "Gagal memproses akun Firebase." });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      getSessionSecret(),
      {
        expiresIn: TOKEN_TTL_SECONDS,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }
    );

    setSessionCookie(res, token);
    await recordSession(req, user.id, token);
    await logAudit(user.id, "LOGIN", req, true, { provider: "firebase", isNew: created });

    // Public user shape matches auth.ts publicUser() for consistency.
    const publicUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      twoFactorEnabled: user.twoFactorEnabled,
      emailVerified: !!user.emailVerified,
      oauthProvider: user.oauthProvider || null,
      isNew: created,
    };

    return res.json({ success: true, user: publicUser });
  } catch (err: any) {
    next(err);
  }
});

// POST /api/auth/firebase/status
firebaseAuthRouter.post("/status", async (req: Request, res: Response) => {
  return res.json({ configured: isFirebaseConfigured() });
});

// GET /api/auth/firebase/config-check
// Returns whether Firebase is configured without revealing secrets.
firebaseAuthRouter.get("/config-check", async (req: Request, res: Response) => {
  return res.json({ configured: isFirebaseConfigured() });
});
