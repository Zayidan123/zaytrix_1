// Firebase Auth Client Wrapper
// Handles all login/register/logout via Firebase Client SDK, then verifies
// the ID token server-side at /api/auth/firebase/verify to get the
// zaytrix_session cookie (identical to the legacy email/password flow).
// This is the single source of truth for client-side auth.

import { type AuthUser } from "./auth";
import {
  signInWithEmail as fbSignInWithEmail,
  registerWithEmail as fbRegisterWithEmail,
  signInWithGoogle as fbSignInWithGoogle,
  signOutFirebase as fbSignOut,
  getIdToken,
  resetPassword as fbResetPassword,
  sendEmailVerification as fbSendEmailVerification,
  isConfigured,
} from "./firebase";

export interface AuthResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
  message?: string;
  requiresTwoFactor?: boolean;
  tempToken?: string;
}

/**
 * Verify the Firebase ID token with our backend.
 * On success the server sets the `zaytrix_session` httpOnly cookie and
 * returns the public user object.
 */
async function verifyIdToken(idToken: string): Promise<AuthResult> {
  try {
    const res = await fetch("/api/auth/firebase/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    return data as AuthResult;
  } catch {
    return { success: false, error: "Gagal terhubung ke server. Periksa koneksi Anda." };
  }
}

/**
 * Login with email + password using Firebase, then verify with our backend.
 */
export async function firebaseLogin(email: string, password: string): Promise<AuthResult> {
  if (!isConfigured()) {
    return { success: false, error: "Firebase belum dikonfigurasi. Hubungi admin." };
  }
  try {
    const cred = await fbSignInWithEmail(email, password);
    if (!cred) {
      return { success: false, error: "Gagal login dengan email & kata sandi." };
    }
    const token = await getIdToken();
    if (!token) {
      return { success: false, error: "Gagal mendapatkan token autentikasi." };
    }
    return await verifyIdToken(token);
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("auth/user-not-found")) {
      return { success: false, error: "Email tidak terdaftar. Silakan daftar terlebih dahulu." };
    }
    if (msg.includes("auth/wrong-password")) {
      return { success: false, error: "Kata sandi salah. Periksa kembali." };
    }
    if (msg.includes("auth/invalid-credential")) {
      return { success: false, error: "Email atau kata sandi tidak valid." };
    }
    if (msg.includes("auth/too-many-requests")) {
      return { success: false, error: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." };
    }
    return { success: false, error: msg || "Gagal login. Silakan coba lagi." };
  }
}

/**
 * Register with email + password using Firebase, then verify with our backend.
 */
export async function firebaseRegister(
  email: string,
  password: string,
  displayName: string
): Promise<AuthResult> {
  if (!isConfigured()) {
    return { success: false, error: "Firebase belum dikonfigurasi. Hubungi admin." };
  }
  try {
    const cred = await fbRegisterWithEmail(email, password, displayName);
    if (!cred) {
      return { success: false, error: "Gagal mendaftar." };
    }
    const token = await getIdToken();
    if (!token) {
      return { success: false, error: "Gagal mendapatkan token autentikasi." };
    }
    const result = await verifyIdToken(token);
    if (result.success) {
      return { ...result, message: "Akun berhasil dibuat! Silakan masuk." };
    }
    return result;
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("auth/email-already-in-use")) {
      return { success: false, error: "Email sudah terdaftar. Silakan masuk atau gunakan email lain." };
    }
    if (msg.includes("auth/weak-password")) {
      return { success: false, error: "Kata sandi terlalu lemah. Gunakan minimal 8 karakter." };
    }
    return { success: false, error: msg || "Gagal mendaftar. Silakan coba lagi." };
  }
}

/**
 * Login with Google using Firebase popup, then verify with our backend.
 */
export async function firebaseGoogleLogin(): Promise<AuthResult> {
  if (!isConfigured()) {
    return { success: false, error: "Firebase belum dikonfigurasi. Hubungi admin." };
  }
  try {
    const cred = await fbSignInWithGoogle();
    if (!cred) {
      return { success: false, error: "Gagal login dengan Google." };
    }
    const token = await getIdToken();
    if (!token) {
      return { success: false, error: "Gagal mendapatkan token autentikasi." };
    }
    return await verifyIdToken(token);
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("auth/popup-closed-by-user")) {
      return { success: false, error: "Login Google dibatalkan oleh pengguna." };
    }
    if (msg.includes("auth/popup-blocked")) {
      return { success: false, error: "Popup diblokir browser. Izinkan popup untuk situs ini." };
    }
    if (msg.includes("auth/account-exists-with-different-credential")) {
      return { success: false, error: "Akun ini sudah terdaftar dengan metode login lain." };
    }
    return { success: false, error: msg || "Gagal login dengan Google. Silakan coba lagi." };
  }
}

/**
 * Logout: sign out from Firebase + clear server session cookie.
 */
export async function firebaseLogout(): Promise<void> {
  try {
    await fbSignOut();
  } catch { /* ignored */ }
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch { /* ignored — fire-and-forget */ }
}

/**
 * Send password reset email via Firebase.
 */
export async function firebaseResetPassword(email: string): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isConfigured()) {
    return { success: false, error: "Firebase belum dikonfigurasi." };
  }
  try {
    await fbResetPassword(email);
    return { success: true, message: "Tautan atur ulang sandi telah dikirim ke email Anda." };
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("auth/user-not-found")) {
      // Don't reveal user existence
      return { success: true, message: "Jika email terdaftar, tautan atur ulang telah dikirim." };
    }
    return { success: false, error: msg || "Gagal mengirim tautan atur ulang." };
  }
}

/**
 * Send email verification via Firebase.
 */
export async function firebaseVerifyEmail(): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    await fbSendEmailVerification();
    return { success: true, message: "Email verifikasi telah dikirim." };
  } catch (err: any) {
    return { success: false, error: err?.message || "Gagal mengirim email verifikasi." };
  }
}