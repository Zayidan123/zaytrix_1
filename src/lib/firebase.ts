// Firebase Client SDK — SEC3-AUTH: single auth source.
// Initialize Firebase client for login/register via Firebase Auth providers
// (email/password, Google, GitHub, Apple, phone). After sign-in, the client
// sends the ID token to /api/auth/firebase/verify, which verifies it via
// Firebase Admin SDK, syncs the user to the DB, and issues the
// zaytrix_session cookie (identical to the legacy email/password flow).
//
// Config is injected via VITE_* env vars (Vite replaces at build/dev time).
// If any required value is missing, isConfigured() returns false and the
// AuthScreen shows an honest error instead of silently failing.

import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  FacebookAuthProvider,
  GithubAuthProvider,
  AppleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  RecaptchaVerifier,
  type Auth,
  type UserCredential,
} from "firebase/auth";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readEnv(): FirebaseConfig {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  };
}

let _app: ReturnType<typeof initializeApp> | null = null;
let _auth: Auth | null = null;

export function isConfigured(): boolean {
  const c = readEnv();
  return !!c.apiKey && !!c.authDomain && !!c.projectId && !!c.appId;
}

export function getFirebaseApp() {
  if (_app) return _app;
  if (!isConfigured()) return null;
  const config: FirebaseOptions = {
    apiKey: readEnv().apiKey,
    authDomain: readEnv().authDomain,
    projectId: readEnv().projectId,
    storageBucket: readEnv().storageBucket,
    messagingSenderId: readEnv().messagingSenderId,
    appId: readEnv().appId,
  };
  _app = initializeApp(config);
  return _app;
}

export function getFirebaseAuth(): Auth | null {
  if (_auth) return _auth;
  const app = getFirebaseApp();
  if (!app) return null;
  _auth = getAuth(app);
  return _auth;
}

/** Sign in with Google via Firebase popup. */
export async function signInWithGoogle(): Promise<UserCredential | null> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase tidak dikonfigurasi.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

/** Sign in with email + password via Firebase. */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<UserCredential | null> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase tidak dikonfigurasi.");
  return signInWithEmailAndPassword(auth, email, password);
}

/** Register a new user with email + password via Firebase. */
export async function registerWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<UserCredential | null> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase tidak dikonfigurasi.");
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  return cred;
}

/** Sign out the current Firebase user (client-side). */
export async function signOutFirebase(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) return;
  await signOut(auth);
}

/** Send email verification to the current user. */
export async function sendEmailVerification(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth || !auth.currentUser) return;
  await sendEmailVerification(auth.currentUser);
}

/** Send a password reset email. */
export async function resetPassword(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) return;
  await sendPasswordResetEmail(auth, email);
}

/** Get the current Firebase ID token (for server verification). */
export async function getIdToken(): Promise<string | null> {
  const auth = getFirebaseAuth();
  if (!auth || !auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}

/** Initialize reCAPTCHA verifier for phone auth (if needed later). */
export function initRecaptcha(containerId: string): RecaptchaVerifier | null {
  if (typeof window === "undefined") return null;
  const auth = getFirebaseAuth();
  if (!auth) return null;
  try {
    return new RecaptchaVerifier(containerId, {
      size: "normal",
      theme: "dark",
      callback: () => {},
    }, auth);
  } catch {
    return null;
  }
}