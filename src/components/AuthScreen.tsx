import React, { useState, useEffect } from "react";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  updateProfile 
} from "firebase/auth";
import { auth, googleProvider, RecaptchaVerifier, signInWithPhoneNumber } from "../lib/firebase";
import { useGlobalStore } from "../store";
import { Shield, Mail, Lock, Phone, Chrome, AlertCircle, CheckCircle, ShieldAlert } from "lucide-react";

export default function AuthScreen() {
  const setUser = useGlobalStore(state => state.setUser);
  const addExecutionLog = useGlobalStore(state => state.addExecutionLog);

  // Form toggles
  const [authMode, setAuthMode] = useState<"login" | "register" | "phone">("login");
  
  // Input fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  
  // Loading & error states
  const [loading, setLoading] = useState(false);
  const [errMessage, setErrMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Phone Auth flow state
  const [confirmationResult, setConfirmationResult] = useState<any | null>(null);
  const [recaptchaVerifier, setRecaptchaVerifier] = useState<any | null>(null);

  useEffect(() => {
    // Cleanup Google reCAPTCHA widget if switching auth view modes
    return () => {
      if (recaptchaVerifier) {
        try {
          recaptchaVerifier.clear();
        } catch (e) {
          console.log("reCAPTCHA clear ignored", e);
        }
      }
    };
  }, [authMode, recaptchaVerifier]);

  // Handle traditional Email Password login
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
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      setUser(userCredential.user);
      addExecutionLog(`[SECURITY] Sesi otentikasi aman terjalin untuk user: ${userCredential.user.email}`);
    } catch (err: any) {
      console.error(err);
      let localizedError = "Kredensial salah atau pengguna tidak terdaftar.";
      if (err.code === "auth/invalid-credential") localizedError = "KATA SANDI atau EMAIL SALAH. Periksa kembali kredensial Anda.";
      if (err.code === "auth/user-not-found") localizedError = "Akun email tidak ditemukan. Silakan mendaftar terlebih dahulu.";
      if (err.code === "auth/wrong-password") localizedError = "Sandi yang dimasukkan salah. Harap coba lagi.";
      if (err.code === "auth/too-many-requests") localizedError = "Aktivitas mencurigakan diblokir sementara. Coba lagi nanti.";
      if (err.code === "auth/operation-not-allowed") {
        localizedError = "Metode masuk Email/Sandi belum diaktifkan di Firebase Console. Silakan aktifkan di menu 'Authentication > Sign-in method', atau gunakan tombol 'Masuk dengan Akun Google' di bawah yang sudah terkonfigurasi secara otomatis.";
      }
      setErrMessage(localizedError);
    } finally {
      setLoading(false);
      const isMobile = window.innerWidth < 768;
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
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName });
      
      // Force user refresh to pick up displayName
      setUser({ ...userCredential.user, displayName });
      addExecutionLog(`[SECURITY] Pendaftaran akun baru diverifikasi untuk: ${email}`);
      setSuccessMessage("Akun berhasil dibuat! Mengalihkan ke Dashboard Z-CAPITAL...");
    } catch (err: any) {
      console.error(err);
      let localizedError = "Gagal memproses pendaftaran akun.";
      if (err.code === "auth/email-already-in-use") localizedError = "Alamat email ini sudah terdaftar di database utama.";
      if (err.code === "auth/invalid-email") localizedError = "Format alamat email tidak sah.";
      if (err.code === "auth/weak-password") localizedError = "Sandi terlalu lemah (wajib minimal 6 karakter).";
      if (err.code === "auth/operation-not-allowed") {
        localizedError = "Metode pendaftaran Email/Sandi belum diaktifkan di Firebase Console Anda. Silakan buka menu 'Authentication > Sign-in method' di Firebase Console lalu aktifkan 'Email/Password', atau masuk langsung secara instan dengan menggunakan tombol 'Masuk dengan Akun Google' di bawah.";
      }
      setErrMessage(localizedError);
    } finally {
      setLoading(false);
    }
  };

  // Handle Google OAuth Sign-In
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      setUser(result.user);
      addExecutionLog(`[SECURITY] Otentikasi Google Single Sign-On berhasil untuk user: ${result.user.email}`);
    } catch (err: any) {
      console.error(err);
      if (err.code !== "auth/popup-closed-by-user") {
        setErrMessage("Gagal menghubungkan otentikasi Google Account.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Helper to initialize recaptcha in the window safely
  const setupRecaptcha = () => {
    try {
      const verifier = new RecaptchaVerifier(auth, "recaptcha-container", {
        size: "normal",
        callback: (response: any) => {
          console.log("reCAPTCHA solved!", response);
        },
        "expired-callback": () => {
          setErrMessage("reCAPTCHA kedaluwarsa. Silakan muat ulang proses verifikasi.");
        }
      });
      setRecaptchaVerifier(verifier);
      return verifier;
    } catch (err: any) {
      console.error("reCAPTCHA setup error", err);
      setErrMessage("Gagal inisialisasi modul anti-bot reCAPTCHA: " + err.message);
      return null;
    }
  };

  // Handle Phone Number Submit (Send OTP SMS)
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.startsWith("+")) {
      setErrMessage("Format nomor wajib menggunakan kode negara (e.g. +628123456789).");
      return;
    }
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);

    try {
      // Setup the invisible or normal recaptcha solver if not already instantiated
      const verifier = recaptchaVerifier || setupRecaptcha();
      if (!verifier) {
        setLoading(false);
        return;
      }

      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, verifier);
      setConfirmationResult(confirmation);
      addExecutionLog(`[SECURITY] Token OTP dikirim melalui SMS ke rute nomor ponsel: ${phoneNumber}`);
      setSuccessMessage("SMS berkode OTP berlantai keamanan ganda berhasil ditransmisikan!");
    } catch (err: any) {
      console.error(err);
      let msg = "Gagal memproses nomor ponsel. Pastikan format nomor diawali '+' dan kode negara.";
      if (err.code === "auth/invalid-phone-number") msg = "Nomor handphone yang Anda masukkan tidak valid.";
      if (err.code === "auth/too-many-requests") msg = "Batas panggilan OTP tercapai. Diblokir sementara untuk menjaga keamanan sistem.";
      setErrMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  // Handle Code verification (Confirm OTP)
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || !confirmationResult) return;
    
    setLoading(true);
    setErrMessage(null);
    setSuccessMessage(null);

    try {
      const result = await confirmationResult.confirm(otpCode);
      setUser(result.user);
      addExecutionLog(`[SECURITY] Verifikasi multi-faktor ponsel disetujui. Ponsel terhubung: ${result.user.phoneNumber}`);
    } catch (err: any) {
      console.error(err);
      setErrMessage("KODE OTP SALAH atau kedaluwarsa. Silakan periksa kembali pesan masuk SMS Anda.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden" id="auth-main-card">
      {/* Visual Background Details */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />
      
      <div className="w-full max-w-md bg-[#0B1329]/90 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl relative z-10 space-y-6">
        
        {/* Banner Title */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-gradient-to-tr from-amber-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/15">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight font-sans bg-clip-text text-transparent bg-gradient-to-r from-slate-100 via-slate-200 to-amber-400">
            Z-CAPITAL
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Gerbang Multi-Sistem Otentikasi Militer & Real-Time Security
          </p>
        </div>

        {/* Tab Controls */}
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
        {authMode === "login" && (
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
                placeholder="namadepan@z-capital.com"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer"
            >
              {loading ? "Memvalidasi Kredensial..." : "MASUK KE TERMINAL UTAMA"}
            </button>
          </form>
        )}

        {authMode === "register" && (
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
                placeholder="zayidan@z-capital.com"
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

        {authMode === "phone" && (
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

        {/* Separator */}
        <div className="relative py-2 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-800"></div>
          </div>
          <span className="relative bg-[#0B1329] px-3 text-[10px] uppercase font-mono text-slate-500 font-bold">
            Atau login cepat
          </span>
        </div>

        {/* Google Authentication Button */}
        <button
          type="button"
          disabled={loading}
          onClick={handleGoogleSignIn}
          className="w-full flex items-center justify-center gap-2 border border-slate-800 hover:border-slate-700 bg-[#090F1E] hover:bg-[#111A31] py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm text-slate-200 font-sans"
        >
          <Chrome className="w-4 h-4 text-orange-500" />
          Masuk dengan Akun Google
        </button>

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
