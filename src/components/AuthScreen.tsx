import React, { useState, useEffect } from "react";
import {
  loginUser,
  registerUser,
  loginWith2FA,
  forgotPassword,
  resetPassword,
  verifyEmail,
  type AuthUser,
} from "../lib/auth";
import { useGlobalStore } from "../store";
import { Shield, Mail, Lock, Phone, Chrome, AlertCircle, CheckCircle, ShieldAlert, KeyRound, ArrowLeft } from "lucide-react";

interface AuthScreenProps {
  onAuthSuccess: (user: AuthUser) => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const addExecutionLog = useGlobalStore(state => state.addExecutionLog);

  // Form toggles
  const [authMode, setAuthMode] = useState<"login" | "register" | "phone">("login");

  // SEC2-AUTH: alternate screen flows for 2FA challenge, password-reset
  // request, and password-reset entry (token from URL). When set, the main
  // auth card is replaced by the corresponding flow UI. The user can always
  // go back via a "Kembali" link.
  const [altFlow, setAltFlow] = useState<null | "2fa" | "forgot" | "reset" | "verify-email">(null);
  const [twoFactorTempToken, setTwoFactorTempToken] = useState<string | null>(null);
  const [twoFactorEmail, setTwoFactorEmail] = useState<string>("");

  // Input fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  // SEC2-AUTH: 2FA code input + password-reset token (from URL ?token=…).
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // Loading & error states
  const [loading, setLoading] = useState(false);
  const [errMessage, setErrMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Phone Auth flow state — kept for UI tab compatibility (phone auth is disabled
  // in this build; server-side phone OTP not yet implemented).
  const [confirmationResult, setConfirmationResult] = useState<any | null>(null);

  // SEC2-AUTH: detect ?token=… in the URL on mount to drive the reset-password
  // and verify-email alternate flows. We also pick up ?oauth_error=… to surface
  // OAuth callback failures from the server-side redirect.
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
      const oauthErr = params.get("oauth_error");
      if (oauthErr) {
        setErrMessage("Login Google gagal: " + oauthErr + ". Silakan coba Email & Kata Sandi.");
        // Clean the URL so the error doesn't persist across reloads.
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch {}
      }
    } catch {}
  }, []);

  useEffect(() => {
    // No-op cleanup — reCAPTCHA/phone auth disabled in this build.
    return () => {};
  }, [authMode]);

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
      const result = await loginUser(email, password);
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
        // Backend returns friendly Indonesian error strings; fall back to a generic message.
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
      const result = await registerUser(email, password, displayName);
      if (result.success && result.user) {
        addExecutionLog(`[SECURITY] Pendaftaran akun baru diverifikasi untuk: ${email}`);
        setSuccessMessage("Akun berhasil dibuat! Mengalihkan ke Dashboard ZAYTRIX...");
        onAuthSuccess(result.user);
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
  const handleGoogleSignIn = () => {
    setErrMessage(null);
    setSuccessMessage("Mengarahkan ke Google...");
    addExecutionLog(`[SECURITY] Memulai aliran OAuth Google.`);
    window.location.assign("/api/auth/google");
  };

  // Handle Phone Number Submit (Send OTP SMS) — disabled gracefully.
  // Server-side phone OTP not yet implemented; UI retained for visual continuity.
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMessage("Otentikasi telepon akan segera tersedia. Silakan gunakan Email & Kata Sandi untuk saat ini.");
    setSuccessMessage(null);
  };

  // Handle Code verification (Confirm OTP) — disabled gracefully.
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMessage("Otentikasi telepon akan segera tersedia. Silakan gunakan Email & Kata Sandi untuk saat ini.");
    setSuccessMessage(null);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden" id="auth-main-card">
      {/* Visual Background Details */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />
      
      <div className="w-full max-w-md bg-[#0B1329]/90 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl relative z-10 space-y-6">
        
        {/* Banner Title */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-20 h-20 flex items-center justify-center rounded-xl shadow-lg shadow-amber-500/15">
            <img src="/logo.png" alt="ZAYTRIX Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-black tracking-tight font-sans bg-clip-text text-transparent bg-gradient-to-r from-slate-100 via-slate-200 to-amber-400">
            ZAYTRIX
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Gerbang Multi-Sistem Otentikasi Militer & Real-Time Security
          </p>
        </div>

        {/* Tab Controls — hidden when an alternate flow (2FA, forgot, reset, verify-email) is active. */}
        {!altFlow && (
        <div className="grid grid-cols-3 bg-[#111A36] p-1 rounded-lg border border-slate-800">
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
          <button
            onClick={() => { setAuthMode("phone"); setErrMessage(null); setSuccessMessage(null); }}
            className={`py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
              authMode === "phone" 
                ? "bg-amber-600 text-white shadow animate-pulse" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            OTP Seluler
          </button>
        </div>
        )}

        {/* Feedback Alert Banners */}
        {errMessage && (
          <div className="bg-red-950/50 border border-red-500/50 rounded-lg p-3 flex gap-2.5 items-start">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200 leading-normal font-mono">{errMessage}</p>
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-950/50 border border-emerald-500/50 rounded-lg p-3 flex gap-2.5 items-start">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-emerald-200 leading-normal font-mono">{successMessage}</p>
          </div>
        )}

        {/* Form rendering */}
        {authMode === "login" && !altFlow && (
          <form onSubmit={handleEmailLogin} className="space-y-4">
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
                className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-blue-500 font-mono text-slate-100"
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
                className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-blue-500 font-mono text-slate-100"
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
          </form>
        )}

        {/* SEC2-AUTH: 2FA challenge flow — shown when loginUser() returns requiresTwoFactor. */}
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

        {authMode === "phone" && !altFlow && (
          <div className="space-y-4">
            {!confirmationResult ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-mono font-bold text-slate-400 flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Nomor Seluler Seluruh Dunia
                  </label>
                  <input
                    type="tel"
                    required
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+628123456789"
                    className="w-full bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-amber-500 font-mono text-slate-100 placeholder:opacity-50"
                  />
                  <span className="block text-[9px] text-slate-500 leading-normal font-mono">
                    Wajib diawali dengan kode negara (e.g. +62 ...). Sistem akan mentransmisikan token keamanan secara real-time via pesan SMS.
                  </span>
                </div>

                {/* Visible standard reCAPTCHA Box */}
                <div id="recaptcha-container" className="flex justify-center my-2 p-1.5 bg-[#0A0F1D] border border-slate-800 rounded-lg"></div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-amber-600 to-orange-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-amber-500/20 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {loading ? "Menyiapkan Validasi Bot..." : "PANASAKAN & KIRIM TOKEN OTP SMS"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-mono font-bold text-slate-400">
                    Masukkan Kode Verifikasi Komando OTP (6 Digit)
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="123456"
                    className="w-full text-center bg-[#0A0F1D] border border-slate-800 rounded-lg px-3 py-3 text-lg tracking-[0.5em] font-black outline-none focus:border-amber-500 font-mono text-slate-100"
                  />
                  <span className="block text-[9px] text-slate-500 leading-normal font-mono text-center">
                    Cek SMS pada handphone Anda. Kode OTP hanya valid selama 5 menit.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#22C55E] to-[#15803D] disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98] transition-all cursor-pointer"
                >
                  {loading ? "Uji Validasi OTP..." : "VERIFIKASI OTP & LOGIN AMAN"}
                </button>

                <button
                  type="button"
                  onClick={() => { setConfirmationResult(null); setOtpCode(""); }}
                  className="w-full text-center text-xs text-slate-400 hover:text-slate-200 cursor-pointer pt-2 underline block font-mono"
                >
                  Ganti nomor seluler atau kirim ulang
                </button>
              </form>
            )}
          </div>
        )}

        {/* Separator — hidden during alternate flows */}
        {!altFlow && (
        <div className="relative py-2 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-800"></div>
          </div>
          <span className="relative bg-[#0B1329] px-3 text-[10px] uppercase font-mono text-slate-500 font-bold">
            Atau login cepat
          </span>
        </div>
        )}

        {/* Google Authentication Button — hidden during alternate flows */}
        {!altFlow && (
        <button
          type="button"
          disabled={loading}
          onClick={handleGoogleSignIn}
          className="w-full flex items-center justify-center gap-2 border border-slate-800 hover:border-slate-700 bg-[#090F1E] hover:bg-[#111A31] py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm text-slate-200 font-sans"
        >
          <Chrome className="w-4 h-4 text-orange-500" />
          Masuk dengan Akun Google
        </button>
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
  );
}
