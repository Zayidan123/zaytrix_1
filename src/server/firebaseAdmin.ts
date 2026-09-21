// ===========================================================================
// ZAYTRIX Firebase Admin SDK (SEC3-AUTH: OAuth Provider Integration)
// ===========================================================================
// Initialize Firebase Admin SDK for server-side verification of Firebase
// ID tokens. Used by /api/auth/firebase/verify to authenticate users who
// sign in via Firebase Client SDK (email/password, Google, GitHub, Apple,
// phone). On success, the user is synced to the Prisma User table and the
// existing zaytrix_session JWT cookie is issued — seamless integration
// with the current auth flow.
//
// Configured via env vars:
//   FIREBASE_PROJECT_ID    — Firebase project ID (e.g. "my-proj")
//   FIREBASE_CLIENT_EMAIL  — Service account client email
//   FIREBASE_PRIVATE_KEY   — Service account private key (PEM, with \n)
//
// If any of these are unset, Firebase is treated as NOT CONFIGURED and
// the verify endpoint returns 503 with an honest error message.
// ===========================================================================

import type { UserRecord } from "firebase-admin/auth";
import { getApp, initializeApp, cert, AppOptions } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const log = (msg: string, ...data: any[]) =>
  console.info(`[firebaseAdmin] ${msg}`, ...data);

let _auth: ReturnType<typeof getAuth> | null = null;
let _initialized = false;

export function isFirebaseConfigured(): boolean {
  return (
    !!process.env.FIREBASE_PROJECT_ID &&
    !!process.env.FIREBASE_CLIENT_EMAIL &&
    !!process.env.FIREBASE_PRIVATE_KEY
  );
}

export function getFirebaseAuth(): ReturnType<typeof getAuth> | null {
  if (_auth && _initialized) return _auth;
  if (!isFirebaseConfigured()) return null;

  try {
    const existingApp = getApp();
    _auth = getAuth(existingApp);
    _initialized = true;
    log("initialized via existing app");
    return _auth;
  } catch {
    // No existing app — create one.
  }

  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(
      /\\n/g,
      "\n"
    );
    const options: AppOptions = {
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    };
    initializeApp(options);
    _auth = getAuth();
    _initialized = true;
    log("initialized with project:", process.env.FIREBASE_PROJECT_ID);
    return _auth;
  } catch (err: any) {
    log("INITIALIZATION FAILED:", err?.message || "unknown error");
    return null;
  }
}

export async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email: string | null; displayName: string | null; providerId: string } | null> {
  const auth = getFirebaseAuth();
  if (!auth) return null;

  try {
    const decoded = await auth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email || null,
      displayName: decoded.name || decoded.email || null,
      providerId: decoded.firebase?.sign_in_provider || "unknown",
    };
  } catch (err: any) {
    log("token verification failed:", err?.message || "unknown");
    return null;
  }
}

export async function findOrCreateUser(
  firebaseUser: { uid: string; email: string | null; displayName: string | null; providerId: string }
): Promise<{ user: any; created: boolean } | null> {
  const { prisma } = await import("./db");
  if (!firebaseUser.email) return null;

  try {
    let user = await prisma.user.findUnique({ where: { email: firebaseUser.email } });
    if (user) {
      // Update oauth fields if they were set via another provider.
      if (!user.oauthProvider || user.oauthProvider !== "firebase") {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            oauthProvider: "firebase",
            oauthId: firebaseUser.uid,
            displayName: firebaseUser.displayName || user.displayName,
          },
        });
        user = await prisma.user.findUnique({ where: { id: user.id } });
      }
      return { user, created: false };
    }

    user = await prisma.user.create({
      data: {
        email: firebaseUser.email,
        passwordHash: "", // no password — Firebase auth only
        displayName: firebaseUser.displayName || firebaseUser.email.split("@")[0],
        oauthProvider: "firebase",
        oauthId: firebaseUser.uid,
      },
    });
    return { user, created: true };
  } catch (err: any) {
    log("findOrCreateUser failed:", err?.message || "unknown");
    return null;
  }
}
