import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { loginWith2FA,
  fetchCurrentUser,
  forgotPassword,
  resetPassword,
  verifyEmail,
  type AuthUser,
} from "../lib/auth";
import { firebaseLogin, firebaseRegister, firebaseGoogleLogin } from "../lib/firebaseAuth";
import { useGlobalStore } from "../store";
import { Shield, Mail, Lock, Chrome, AlertCircle, CheckCircle, KeyRound, ArrowLeft, ShieldCheck, Fingerprint, Zap, LifeBuoy } from "lucide-react";

interface AuthScreenProps {
  onAuthSuccess: (user: AuthUser) => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const addExecutionLog = useGlobalStore(state => state.addExecutionLog);

  // Form toggles — FUNC-11: the "phone" (OTP Seluler) tab was REMOVED. The
  // server has no phone/SMS auth endpoint — the old tab was a decorative stub
  // that only ever showed "akan segera tersedia" errors. Honest removal: only
  // login + register remain.
  const [authMode, setAuthMode] = useState<"login" | "register">("login");

  // SEC2-AUTH: alternate screen flows for 2FA challenge, backup-code login,
  // password-reset request, and password-reset entry (token from URL). When
  // set, the main auth card is replaced by the corresponding flow UI. The user
  // can always go back via a "Kembali" link.
  const [altFlow, setAltFlow] = useState<null | "2fa" | "backup" | "forgot" | "reset" | "verify-email" | "oauth-2fa">(null);
  const [twoFactorTempToken, setTwoFactorTempToken] = useState<string | null>(null);
  const [twoFactorEmail, setTwoFactorEmail] = useState<string>("");
  // FUNC-9: backup-code login input (8×4 hex groups with dashes, e.g.
  // "a1b2-c3d4-…" — the server strips dashes + lowercases before hashing).
  const [backupCode, setBackupCode] = useState("");

  // Input fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  // SEC2-AUTH: 2FA code input + password-reset token (from URL ?token=…).
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // Loading & error states
  const [loading, setLoading] = useState(false);
  const [errMessage, setErrMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // (FUNC-11: phone-auth state + handlers removed — the server has no SMS auth.)
  // SEC2-AUTH: detect ?token=… in the URL on mount to drive the reset-password
  // and verify-email alternate flows. We also pick up:
  //   • ?oauth_error=…  → OAuth callback failures from the server-side redirect
  //     (FUNC-24: mapped to friendly Indonesian messages instead of raw codes,
  //     including the new `oauth_tidak_dikonfigurasi` value — "Google OAuth
  //     belum dikonfigurasi di server").
  //   • ?oauth_2fa=1 / ?oauth_2fa_required=email (+ optional &temp_token=…)
  //     → OAuth login hit a 2FA-protected account: show the TOTP challenge
  //     (SEC-9 contract — verified via POST /api/auth/google/2fa).
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("token");
      if (t) {
        const path = window.location.pathname || "";
        if (path.includes("/reset-password")) {
          setResetToken(t);
          setAltFlow("reset");
        } else if (path.includes("/verify-email")) {
          setResetToken(t); // reuse the same state slot
          setAltFlow("verify-email");
        }
      }

      // OAuth 2FA challenge (SEC-9): server redirects back with either
      // `?oauth_2fa=1` (coordination contract) or the current oauth.ts shape
      // `?oauth_2fa_required=<email>&temp_token=<token>`. Both are handled.
      const oauth2faFlag = params.get("oauth_2fa");
      const oauth2faEmail = params.get("oauth_2fa_required");
      const oauthTempToken = params.get("temp_token");
      if (oauth2faFlag === "1" || oauth2faFlag === "true" || oauth2faEmail) {
        setAltFlow("oauth-2fa");
        setTwoFactorEmail(oauth2faEmail || "");
        setTwoFactorTempToken(oauthTempToken || null);
        setTwoFactorCode("");
        setErrMessage(null);
        setSuccessMessage("Login Google berhasil diverifikasi, namun akun Anda terlindungi 2FA. Masukkan kode 6-digit dari aplikasi authenticator Anda.");
        // Clean the URL so a refresh doesn't re-trigger the flow.
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch {}
      }

      const oauthErr = params.get("oauth_error");
      if (oauthErr) {
        // FUNC-24: friendly per-code mapping (raw server codes are cryptic).
        const friendly: Record<string, string> = {
          oauth_tidak_dikonfigurasi: "Google OAuth belum dikonfigurasi di server. Silakan gunakan Email & Kata Sandi.",
          token_exchange_failed: "Gagal menukar token Google. Silakan coba lagi.",
          no_tokens: "Google tidak mengembalikan token akses. Silakan coba lagi.",
          missing_profile: "Profil Google tidak lengkap (email wajib). Silakan coba akun lain.",
          email_not_verified: "Email Google Anda belum terverifikasi di sisi Google. Verifikasi email Google Anda dulu.",
          two_factor_protected: "Akun email ini terlindungi 2FA. Nonaktifkan 2FA atau login dengan kata sandi untuk menautkan Google.",
          server_error: "Kesalahan server saat proses login Google. Silakan coba lagi.",
        };
        setErrMessage(friendly[oauthErr] || `Login Google gagal: ${oauthErr}. Silakan coba Email & Kata Sandi.`);
        // Clean the URL so the error doesn't persist across reloads.
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch {}
      }
    } catch {}
  }, []);

  // Handle traditional Email Password login. SEC2-AUTH: if the server responds
  // with requiresTwoFactor=true, switch to the 2FA challenge screen instead of
  // completing login. The tempToken is stored in component state (NOT in a
  // cookie) and sent back to /api/auth/login/2fa along with the user's code.
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrMessage("Harap lengkapi semua bidang isian email dan kata sandi.");
      return;
    }
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);

    try {
      const result = await firebaseLogin(email, password);
      if (result.success && result.user) {
        addExecutionLog(`[SECURITY] Sesi otentikasi aman terjalin untuk user: ${result.user.email}`);
        onAuthSuccess(result.user);
      } else if (result.requiresTwoFactor && result.tempToken) {
        // SEC2-AUTH: server confirmed password OK but 2FA required.
        setTwoFactorTempToken(result.tempToken);
        setTwoFactorEmail(email);
        setAltFlow("2fa");
        setTwoFactorCode("");
        setErrMessage(null);
        setSuccessMessage(result.message || "Masukkan kode 6-digit dari aplikasi authenticator Anda.");
        addExecutionLog(`[SECURITY] 2FA diperlukan untuk user: ${email}`);
      } else {
        setErrMessage(result.error || "Email atau kata sandi salah. Periksa kembali kredensial Anda.");
      }
    } catch (err: any) {
      console.error(err);
      setErrMessage("Gagal terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  // SEC2-AUTH: handle the 2FA challenge — call loginWith2FA(tempToken, code).
  const handleTwoFactorVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorTempToken) {
      setErrMessage("Sesi 2FA kedaluwarsa. Silakan login ulang.");
      setAltFlow(null);
      return;
    }
    if (!/^\d{6}$/.test(twoFactorCode)) {
      setErrMessage("Kode 2FA harus 6 digit numerik.");
      return;
    }
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);
    try {
      const result = await loginWith2FA(twoFactorTempToken, twoFactorCode);
      if (result.success && result.user) {
        addExecutionLog(`[SECURITY] Login 2FA berhasil untuk user: ${result.user.email}`);
        onAuthSuccess(result.user);
      } else {
        setErrMessage(result.error || "Kode 2FA tidak valid.");
      }
    } catch (err: any) {
      console.error(err);
      setErrMessage("Gagal terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  // SEC2-AUTH: forgot-password request — always returns success (no user enum).
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setErrMessage("Masukkan email akun Anda terlebih dahulu.");
      return;
    }
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);
    try {
      const result = await forgotPassword(email);
      if (result.success) {
        setSuccessMessage(result.message || "Jika email terdaftar, tautan atur ulang telah dikirim.");
        addExecutionLog(`[SECURITY] Permintaan reset kata sandi dikirim untuk: ${email}`);
      } else {
        setErrMessage(result.error || "Gagal memproses permintaan.");
      }
    } catch (err: any) {
      console.error(err);
      setErrMessage("Gagal terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  // SEC2-AUTH: reset-password form (token from URL ?token=…).
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken) {
      setErrMessage("Token atur ulang tidak ditemukan. Buka tautan dari email Anda.");
      return;
    }
    if (newPassword.length < 8) {
      setErrMessage("Kata sandi baru minimal 8 karakter.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrMessage("Konfirmasi kata sandi tidak cocok.");
      return;
    }
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);
    try {
      const result = await resetPassword(resetToken, newPassword);
      if (result.success) {
        setSuccessMessage((result.message || "Kata sandi berhasil diatur ulang.") + " Mengalihkan ke layar login...");
        addExecutionLog(`[SECURITY] Kata sandi berhasil diatur ulang via token email.`);
        // Clean the URL + return to the login screen after a short delay.
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch {}
        setTimeout(() => {
          setAltFlow(null);
          setResetToken("");
          setNewPassword("");
          setConfirmNewPassword("");
          setSuccessMessage(null);
          setAuthMode("login");
        }, 1800);
      } else {
        setErrMessage(result.error || "Gagal mengatur ulang kata sandi.");
      }
    } catch (err: any) {
      console.error(err);
      setErrMessage("Gagal terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  // SEC2-AUTH: verify-email (token from URL). Auto-runs on mount when the
  // user lands on /verify-email?token=…; we also expose a manual button.
  const handleVerifyEmailToken = async () => {
    if (!resetToken) {
      setErrMessage("Token verifikasi tidak ditemukan.");
      return;
    }
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);
    try {
      const result = await verifyEmail(resetToken);
      if (result.success) {
        setSuccessMessage((result.message || "Email berhasil diverifikasi.") + " Mengalihkan ke layar login...");
        addExecutionLog(`[SECURITY] Email berhasil diverifikasi via token.`);
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch {}
        setTimeout(() => {
          setAltFlow(null);
          setResetToken("");
          setSuccessMessage(null);
          setAuthMode("login");
        }, 1800);
      } else {
        setErrMessage(result.error || "Token verifikasi tidak valid.");
      }
    } catch (err: any) {
      console.error(err);
      setErrMessage("Gagal terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  // Handle Email Password registration
  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !displayName) {
      setErrMessage("Harap isi Nama Lengkap, Email, dan Kata Sandi untuk mendaftar.");
      return;
    }
    if (password.length < 6) {
      setErrMessage("Tingkat keamanan rendah: Kata sandi wajib minimal berisi 6 karakter.");
      return;
    }
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);

    try {
      const result = await firebaseRegister(email, password, displayName);
      if (result.success && result.user && result.user.id) {
        addExecutionLog(`[SECURITY] Pendaftaran akun baru diverifikasi untuk: ${email}`);
        setSuccessMessage("Akun sudah dibuat! Masukkan email dan kata sandi untuk masuk.");
        setAuthMode("login");
      } else if (result.success && result.user && result.user.id === null) {
        addExecutionLog(`[SECURITY] Registrasi diproses — lanjutkan dengan login: ${email}`);
        setSuccessMessage(result.message || "Silakan masuk dengan email dan kata sandi Anda.");
        setAuthMode("login");
        setEmail(email);
      } else {
        setErrMessage(result.error || "Gagal memproses pendaftaran akun.");
      }
    } catch (err: any) {
      console.error(err);
      setErrMessage("Gagal terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  // SEC2-AUTH: Google OAuth — now actually wired. The button redirects the
  // browser to /api/auth/google, which redirects to Google's consent screen,
  // and the callback eventually redirects back to / with the session cookie
  // set. We use window.location.assign so the browser handles the redirects
  // natively (no CORS issues — same origin).
  const handleGoogleSignIn = async () => {
    setErrMessage(null);
    setSuccessMessage("Mengarahkan ke Google via Firebase...");
    setLoading(true);
    try {
      const result = await firebaseGoogleLogin();
      if (result.success && result.user) {
        addExecutionLog(`[SECURITY] Login Google berhasil untuk: ${result.user.email}`);
        onAuthSuccess(result.user);
      } else {
        setErrMessage(result.error || "Gagal login dengan Google. Silakan coba lagi.");
      }
    } catch (err: any) {
      console.error(err);
      setErrMessage("Gagal terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  // FUNC-9 (backup-code login): recover access with a one-time 8-group backup
  // code when the authenticator device is lost. Server contract (src/server/auth.ts ~751):
  //   POST /api/auth/2fa/backup-login  { email, backupCode }
  //   → 200 { success:true, user, message?, warning? }  (session cookie set)
  //   → 400 { success:false, error } (2FA not active / no codes / bad input)
  //   → 401 { success:false, error } (invalid or already-used code)
  // The code hashes are single-use — a successful login consumes the code.
  const handleBackupCodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = (twoFactorEmail || email || "").trim().toLowerCase();
    const trimmedCode = backupCode.trim();
    if (!trimmedEmail) {
      setErrMessage("Masukkan email akun Anda untuk login dengan kode cadangan.");
      return;
    }
    if (trimmedCode.replace(/[^a-zA-Z0-9]/g, "").length < 8) {
      setErrMessage("Kode cadangan tidak valid — salin lengkap dari daftar kode cadangan Anda (contoh: a1b2-c3d4-…).");
      return;
    }
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch("/api/auth/2fa/backup-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: trimmedEmail, backupCode: trimmedCode }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.user) {
        addExecutionLog(`[SECURITY] Login berhasil dengan kode cadangan untuk: ${data.user.email}`);
        if (data.warning) {
          // Low on backup codes — surface but proceed.
          setSuccessMessage(`${data.message || "Login berhasil."} ${data.warning}`);
        }
        onAuthSuccess(data.user as AuthUser);
      } else {
        setErrMessage(data?.error || "Kode cadangan tidak valid atau sudah digunakan.");
      }
    } catch (err: any) {
      console.error(err);
      setErrMessage("Gagal terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  // SEC-9 (OAuth 2FA): complete a Google OAuth login on a 2FA-protected
  // account. Server contract (src/server/oauth.ts + coordination brief):
  //   POST /api/auth/google/2fa  { totp, tempToken? }
  //   → 200 { success:true }   (session cookie set → verify via /api/auth/me)
  //   → 401 { success:false }  → "Kode 2FA salah."
  // The tempToken comes from the redirect URL (?temp_token=…); we also send it
  // in the body so the backend can bind the verification to the pending login.
  const handleOAuthTwoFactorVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(twoFactorCode)) {
      setErrMessage("Kode 2FA harus 6 digit numerik.");
      return;
    }
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch("/api/auth/google/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ totp: twoFactorCode, tempToken: twoFactorTempToken || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        // Session cookie is set — fetch the canonical user from /api/auth/me.
        const me = await fetchCurrentUser();
        if (me) {
          addExecutionLog(`[SECURITY] Login Google 2FA berhasil untuk: ${me.email}`);
          onAuthSuccess(me);
        } else {
          // Cookie set but /me failed — hard reload to re-run the boot auth check.
          window.location.reload();
        }
      } else if (res.status === 401) {
        setErrMessage("Kode 2FA salah.");
      } else {
        setErrMessage(data?.error || "Verifikasi 2FA Google gagal. Silakan coba login ulang.");
      }
    } catch (err: any) {
      console.error(err);
      setErrMessage("Gagal terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden" id="auth-main-card">
      {/* STYLING UPGRADE: layered animated background — 3 floating orbs + grid overlay */}
      <motion.div
        aria-hidden
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"
        animate={{ x: [0, 30, 0], y: [0, -20, 0], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-600/10 rounded-full blur-3xl pointer-events-none"
        animate={{ x: [0, -30, 0], y: [0, 20, 0], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />
      <motion.div
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-600/5 rounded-full blur-3xl pointer-events-none"
        animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 4 }}
      />
      {/* Subtle grid overlay */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,1) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,1) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md relative z-10"
      >
        {/* STYLING UPGRADE: animated gradient border wrapper */}
        <div className="relative bg-[#0B1329]/90 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden">
          {/* Animated gradient border */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{
              padding: "1px",
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.6), rgba(245,158,11,0.4), rgba(16,185,129,0.5), rgba(59,130,246,0.6))",
              backgroundSize: "300% 300%",
              animation: "zaytrix-border-flow 8s ease infinite",
              WebkitMask:
                "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
              WebkitMaskComposite: "xor",
              maskComposite: "exclude",
            }}
          />
          <style>{`
            @keyframes zaytrix-border-flow {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            @keyframes zaytrix-logo-pulse {
              0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4), 0 0 30px 0 rgba(245, 158, 11, 0.15); }
              50% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0), 0 0 40px 4px rgba(245, 158, 11, 0.25); }
            }
          `}</style>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Banner Title */}
            <div className="text-center space-y-2">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
                className="mx-auto w-20 h-20 flex items-center justify-center rounded-xl shadow-lg"
                style={{ animation: "zaytrix-logo-pulse 3s ease-in-out infinite" }}
              >
                <img src="/logo.png" alt="ZAYTRIX Logo" className="w-full h-full object-contain" />
              </motion.div>
              <h1 className="text-2xl font-black tracking-tight font-sans bg-clip-text text-transparent bg-gradient-to-r from-slate-100 via-slate-200 to-amber-400">
                ZAYTRIX
              </h1>
              <p className="text-xs text-slate-400 font-mono">
                Gerbang Multi-Sistem Otentikasi Militer &amp; Real-Time Security
              </p>

              {/* STYLING UPGRADE: security feature badges */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-700/40 text-[9px] font-mono font-bold text-emerald-300">
                  <ShieldCheck className="w-2.5 h-2.5" /> AES-256
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-950/60 border border-blue-700/40 text-[9px] font-mono font-bold text-blue-300">
                  <Fingerprint className="w-2.5 h-2.5" /> JWT httpOnly
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-700/40 text-[9px] font-mono font-bold text-amber-300">
                  <Zap className="w-2.5 h-2.5" /> WAF Protected
                </span>
              </div>
            </div>

            {/* Tab Controls — hidden when an alternate flow (2FA, backup, oauth-2fa,
                forgot, reset, verify-email) is active. FUNC-11: the "OTP Seluler"
                tab was REMOVED (server has no phone auth — honest removal). */}
            {!altFlow && (
            <div className="grid grid-cols-2 bg-[#111A36] p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => { setAuthMode("login"); setErrMessage(null); setSuccessMessage(null); }}
                className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  authMode === "login"
                    ? "bg-blue-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Masuk
              </button>
              <button
                onClick={() => { setAuthMode("register"); setErrMessage(null); setSuccessMessage(null); }}
                className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  authMode === "register"
                    ? "bg-blue-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Daftar Akun
              </button>
            </div>
            )}

            {/* Feedback Alert Banners */}
            <AnimatePresence>
              {errMessage && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: "auto", marginBottom: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="bg-red-950/50 border border-red-500/50 rounded-lg p-3 flex gap-2.5 items-start">
                    <motion.div
                      initial={{ scale: 0, rotate: -30 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ delay: 0.1, type: "spring", stiffness: 300 }}
                    >
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    </motion.div>
                    <p className="text-[11px] text-red-200 leading-normal font-mono">{errMessage}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {successMessage && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: "auto", marginBottom: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="bg-emerald-950/50 border border-emerald-500/50 rounded-lg p-3 flex gap-2.5 items-start">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1, type: "spring", stiffness: 300 }}
                    >
                      <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    </motion.div>
                    <p className="text-[11px] text-emerald-200 leading-normal font-mono">{successMessage}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Form rendering */}
            {authMode === "login" && !altFlow && (
              <>
              <motion.form
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                onSubmit={handleEmailLogin}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Email Bergaransi Keamanan
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="namadepan@zaytrix.com"
                    className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all font-mono text-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Kata Sandi Enkripsi
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all font-mono text-slate-100"
                  />
                </div>

                {/* SEC2-AUTH: "Lupa Kata Sandi?" link — switches to the forgot-password flow. */}
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setAltFlow("forgot");
                      setErrMessage(null);
                      setSuccessMessage(null);
                    }}
                    className="text-[10px] text-slate-400 hover:text-amber-400 font-mono cursor-pointer underline"
                  >
                    Lupa Kata Sandi?
                  </button>
                </div>

                <button
                  type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? "Memvalidasi Kredensial..." : "MASUK KE TERMINAL UTAMA"}
            </button>
          </motion.form>

          {/* SEC2-AUTH: Google OAuth login — backend route manages
              the config state honestly (redirects with
              ?oauth_error=oauth_tidak_dikonfigurasi when unconfigured). */}
          <button
            type="button"
            onClick={() => void handleGoogleSignIn()}
            className="w-full bg-slate-800/80 border border-slate-700 hover:bg-slate-700/80 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <Chrome className="w-4 h-4" /> Masuk dengan Google Akun
          </button>
          </>
          )}

        {/* SEC2-AUTH: 2FA challenge flow — shown when login returns requiresTwoFactor. */}
        {altFlow === "2fa" && (
          <form onSubmit={handleTwoFactorVerify} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                <KeyRound className="w-3 h-3" /> Kode Otentikasi 6-Digit
              </label>
              <input
                type="text"
                required
                inputMode="numeric"
                maxLength={6}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full text-center bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-3 text-lg tracking-[0.5em] font-black outline-none focus:border-blue-500 font-mono text-slate-100"
              />
              <span className="block text-[9px] text-slate-500 leading-normal font-mono text-center">
                Masukkan kode dari aplikasi authenticator Anda (Google Authenticator, Authy, dll).
              </span>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? "Memverifikasi Kode..." : "VERIFIKASI & MASUK"}
            </button>

            {/* FUNC-9: recovery path for users who lost their authenticator device. */}
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setAltFlow("backup");
                  setBackupCode("");
                  setErrMessage(null);
                  setSuccessMessage(null);
                }}
                className="text-[10px] text-slate-400 hover:text-amber-400 font-mono cursor-pointer underline inline-flex items-center gap-1"
              >
                <LifeBuoy className="w-3 h-3" />
                Masuk dengan kode cadangan
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setAltFlow(null);
                setTwoFactorTempToken(null);
                setTwoFactorCode("");
                setErrMessage(null);
                setSuccessMessage(null);
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 cursor-pointer pt-2 underline block font-mono"
            >
              <ArrowLeft className="inline w-3 h-3 mr-1" /> Kembali ke Login
            </button>
          </form>
        )}

        {/* FUNC-9: backup-code login flow (POST /api/auth/2fa/backup-login).
            One-time 8-group hex codes issued when 2FA was enabled — each code
            can be used exactly once. */}
        {altFlow === "backup" && (
          <form onSubmit={handleBackupCodeLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                <LifeBuoy className="w-3 h-3" /> Email Akun
              </label>
              <input
                type="email"
                required
                value={twoFactorEmail || email}
                onChange={(e) => {
                  setTwoFactorEmail(e.target.value);
                  setEmail(e.target.value);
                }}
                placeholder="namadepan@zaytrix.com"
                className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-amber-500 font-mono text-slate-100"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                <KeyRound className="w-3 h-3" /> Kode Cadangan Sekali Pakai
              </label>
              <input
                type="text"
                required
                autoComplete="one-time-code"
                spellCheck={false}
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value)}
                placeholder="a1b2-c3d4-e5f6-…"
                className="w-full text-center bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-3 text-sm tracking-[0.2em] font-black outline-none focus:border-amber-500 font-mono text-slate-100"
              />
              <span className="block text-[9px] text-slate-500 leading-normal font-mono text-center">
                Salin satu kode cadangan dari daftar yang Anda simpan saat mengaktifkan 2FA. Kode hanya bisa digunakan sekali.
              </span>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-amber-600 to-orange-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-amber-500/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? "Memverifikasi Kode Cadangan..." : "MASUK DENGAN KODE CADANGAN"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAltFlow("2fa");
                setBackupCode("");
                setErrMessage(null);
                setSuccessMessage(null);
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 cursor-pointer pt-2 underline block font-mono"
            >
              <ArrowLeft className="inline w-3 h-3 mr-1" /> Kembali ke Kode 2FA
            </button>
          </form>
        )}

        {/* SEC-9: OAuth (Google) 2FA challenge — the OAuth callback redirected
            back with ?oauth_2fa=1 / ?oauth_2fa_required=email&temp_token=…
            because the account is 2FA-protected. Verified via
            POST /api/auth/google/2fa { totp, tempToken }. */}
        {altFlow === "oauth-2fa" && (
          <form onSubmit={handleOAuthTwoFactorVerify} className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Chrome className="w-4 h-4 text-orange-500" />
              <span className="text-[10px] uppercase font-mono font-bold text-slate-400">
                Verifikasi 2FA — Login Google
              </span>
            </div>
            {twoFactorEmail && (
              <span className="block text-[9px] text-slate-500 font-mono">
                Akun: {twoFactorEmail}
              </span>
            )}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                <KeyRound className="w-3 h-3" /> Kode Otentikasi 6-Digit
              </label>
              <input
                type="text"
                required
                inputMode="numeric"
                maxLength={6}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full text-center bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-3 text-lg tracking-[0.5em] font-black outline-none focus:border-blue-500 font-mono text-slate-100"
              />
              <span className="block text-[9px] text-slate-500 leading-normal font-mono text-center">
                Akun Anda dilindungi 2FA. Masukkan kode dari aplikasi authenticator Anda untuk menyelesaikan login Google.
              </span>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? "Memverifikasi Kode..." : "VERIFIKASI & SELESAIKAN LOGIN GOOGLE"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAltFlow(null);
                setTwoFactorTempToken(null);
                setTwoFactorCode("");
                setErrMessage(null);
                setSuccessMessage(null);
                setAuthMode("login");
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 cursor-pointer pt-2 underline block font-mono"
            >
              <ArrowLeft className="inline w-3 h-3 mr-1" /> Batal & Login dengan Email
            </button>
          </form>
        )}

        {/* SEC2-AUTH: forgot-password request flow. */}
        {altFlow === "forgot" && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                <Mail className="w-3 h-3" /> Email Akun Terdaftar
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="namadepan@zaytrix.com"
                className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-amber-500 font-mono text-slate-100"
              />
              <span className="block text-[9px] text-slate-500 leading-normal font-mono">
                Tautan atur ulang kata sandi akan dikirim ke email ini jika akun terdaftar.
              </span>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-amber-600 to-orange-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-amber-500/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? "Mengirim Tautan..." : "KIRIM TAUTAN ATUR ULANG SANDI"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAltFlow(null);
                setErrMessage(null);
                setSuccessMessage(null);
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 cursor-pointer pt-2 underline block font-mono"
            >
              <ArrowLeft className="inline w-3 h-3 mr-1" /> Kembali ke Login
            </button>
          </form>
        )}

        {/* SEC2-AUTH: reset-password entry flow (token from URL ?token=…). */}
        {altFlow === "reset" && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Kata Sandi Baru (Min 8 Karakter)
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-amber-500 font-mono text-slate-100"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Konfirmasi Kata Sandi Baru
              </label>
              <input
                type="password"
                required
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-amber-500 font-mono text-slate-100"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-amber-600 to-orange-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-amber-500/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? "Mengatur Ulang..." : "ATUR ULANG KATA SANDI"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAltFlow(null);
                setResetToken("");
                setNewPassword("");
                setConfirmNewPassword("");
                setErrMessage(null);
                setSuccessMessage(null);
                setAuthMode("login");
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 cursor-pointer pt-2 underline block font-mono"
            >
              <ArrowLeft className="inline w-3 h-3 mr-1" /> Kembali ke Login
            </button>
          </form>
        )}

        {/* SEC2-AUTH: verify-email flow (token from URL ?token=…). Auto-runs on mount. */}
        {altFlow === "verify-email" && (
          <div className="space-y-4">
            <div className="bg-blue-950/40 border border-blue-500/40 rounded-lg p-4 space-y-2">
              <CheckCircle className="w-6 h-6 text-blue-400 mx-auto" />
              <p className="text-xs text-blue-200 text-center font-mono leading-relaxed">
                Memverifikasi alamat email Anda dengan token yang dikirim via email...
              </p>
            </div>
            <button
              type="button"
              onClick={handleVerifyEmailToken}
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? "Memverifikasi..." : "VERIFIKASI EMAIL SEKARANG"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAltFlow(null);
                setResetToken("");
                setErrMessage(null);
                setSuccessMessage(null);
                setAuthMode("login");
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 cursor-pointer pt-2 underline block font-mono"
            >
              <ArrowLeft className="inline w-3 h-3 mr-1" /> Kembali ke Login
            </button>
          </div>
        )}

        {authMode === "register" && !altFlow && (
          <form onSubmit={handleEmailRegister} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400">
                Nama Lengkap Pengguna (Sesuai ID)
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Irwan Zayidan"
                className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-blue-500 font-mono text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                <Mail className="w-3 h-3" /> Alamat Email Utama
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="zayidan@zaytrix.com"
                className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-blue-500 font-mono text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Sandi Rahasia Enkripsi (Min 6 Karakter)
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-blue-500 font-mono text-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-teal-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-teal-500/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? "Menyinkronkan Rekaman Akun..." : "DAFTAR SEBELUM AKSES"}
            </button>
          </form>
        )}

        {/* Interactive security credential banner */}
        <div className="text-center pt-2">
          <p className="text-[9px] text-slate-500 flex items-center justify-center gap-1.5 font-mono">
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            Terproteksi Enkripsi AES-256 militer - ISO 27001 Certified Security
          </p>
        </div>

          </div>
        </div>
      </motion.div>
    </div>
  );
}
