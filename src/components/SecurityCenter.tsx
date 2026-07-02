import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  Lock,
  Key,
  Check,
  RefreshCw,
  Copy,
  Fingerprint,
  AlertTriangle,
  Mail,
  MailCheck,
} from "lucide-react";
import { setup2FA, verify2FA, disable2FA, resendVerification } from "../lib/auth";
import { useGlobalStore } from "../store";

// ===== Real TOTP (RFC 6238) helpers — Web Crypto API based =====
// Base32 (RFC 4648) encoding/decoding — required because TOTP secrets are
// exchanged as base32 strings with authenticator apps (Google Authenticator,
// Authy, etc.).
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32Encode = (bytes: Uint8Array): string => {
  let output = "";
  let bits = 0;
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
};

const base32Decode = (b32: string): Uint8Array => {
  const cleaned = b32.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
};

// Generate a real per-user TOTP secret — 20 random bytes via Web Crypto,
// base32-encoded. This is unique per browser and stored in localStorage.
const generateTotpSecret = (): string => {
  const bytes = new Uint8Array(20);
  window.crypto.getRandomValues(bytes);
  return base32Encode(bytes);
};

// RFC 6238 TOTP computation using Web Crypto HMAC-SHA1.
const computeTotp = async (secretB32: string, unixTimeSec: number, stepSec = 30, digits = 6): Promise<string> => {
  const keyBytes = base32Decode(secretB32);
  const counter = Math.floor(unixTimeSec / stepSec);
  // 8-byte big-endian counter buffer
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await window.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const hmacBuf = await window.crypto.subtle.sign("HMAC", key, counterBuf);
  const hmac = new Uint8Array(hmacBuf);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated = ((hmac[offset] & 0x7f) << 24) |
                    ((hmac[offset + 1] & 0xff) << 16) |
                    ((hmac[offset + 2] & 0xff) << 8) |
                    (hmac[offset + 3] & 0xff);
  const token = truncated % Math.pow(10, digits);
  return token.toString().padStart(digits, "0");
};
// ===== End TOTP helpers =====

interface SecurityCenterProps {
  twoFactorEnabled: boolean;
  setTwoFactorEnabled: (enabled: boolean) => void;
}

export default function SecurityCenter({ twoFactorEnabled, setTwoFactorEnabled }: SecurityCenterProps) {
  // 2FA setup steps states
  const [showSetup, setShowSetup] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);
  const [twoFactorMessage, setTwoFactorMessage] = useState("");
  const [totpVerifying, setTotpVerifying] = useState(false);

  // SEC2-AUTH: server-side 2FA state. The server is the PREFERRED source of
  // truth — when the user clicks "Enable 2FA" we call setup2FA() which returns
  // a fresh encrypted-at-rest secret + otpauthUri. The client-side TOTP secret
  // (localStorage) is kept as a fallback for offline / single-device use, but
  // server-side verification takes precedence in verifyAndEnable2FA().
  const [serverSecret, setServerSecret] = useState<string>("");
  const [serverOtpauthUri, setServerOtpauthUri] = useState<string>("");
  const [serverSetupLoading, setServerSetupLoading] = useState(false);
  const [serverSetupError, setServerSetupError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // SEC2-AUTH: email verification status — read from the global store's user
  // object (set by App.tsx from /api/auth/me). Falls back to false when the
  // user object doesn't have emailVerified (e.g. legacy shape).
  const user = useGlobalStore(state => state.user);
  const addExecutionLog = useGlobalStore(state => state.addExecutionLog);
  const emailVerified: boolean = !!(user as any)?.emailVerified;
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  // E2EE interactive simulation states
  const [plainText, setPlainText] = useState("Kalkulasi Portfolio: Saham BBCA Rp 120,000,000");
  const [cipherText, setCipherText] = useState("");
  const [isEncrypting, setIsEncrypting] = useState(false);

  // REAL per-user TOTP secret. Previously this was a hardcoded shared
  // "ZAYTRIX-2FA-AUTH-X992" string — same for every user, not a valid
  // base32 TOTP secret. We now generate 20 truly-random bytes via Web Crypto
  // and base32-encode them; the secret persists in localStorage and is
  // unique per browser. The verification step uses real HMAC-SHA1 TOTP.
  const [secretKey2FA, setSecretKey2FA] = useState<string>(() => {
    try {
      const existing = localStorage.getItem("zaytrix_totp_secret");
      if (existing && existing.length >= 16) return existing;
    } catch {}
    const fresh = generateTotpSecret();
    try { localStorage.setItem("zaytrix_totp_secret", fresh); } catch {}
    return fresh;
  });

  const handleCopyKey = () => {
    // SEC2-AUTH: prefer copying the server-issued secret (the one the user
    // actually added to their authenticator app); fall back to the client-side
    // localStorage secret if server setup hasn't completed.
    const toCopy = serverSecret || secretKey2FA;
    navigator.clipboard.writeText(toCopy);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleRegenerateSecret = () => {
    if (twoFactorEnabled) {
      setTwoFactorMessage("Nonaktifkan 2FA terlebih dahulu sebelum membuat ulang kunci rahasia TOTP.");
      return;
    }
    // SEC2-AUTH: regenerate the SERVER-side secret (preferred). Also regenerate
    // the client-side fallback so both stay in sync.
    setServerSetupLoading(true);
    setServerSetupError(null);
    setup2FA()
      .then((res) => {
        if (res.success && res.secret) {
          setServerSecret(res.secret);
          setServerOtpauthUri(res.otpauthUri || "");
          // Also regenerate the client-side fallback so the displayed secret
          // is consistent if the user later toggles between modes.
          const fresh = generateTotpSecret();
          try { localStorage.setItem("zaytrix_totp_secret", fresh); } catch {}
          setSecretKey2FA(fresh);
          setTwoFactorMessage("Kunci rahasia TOTP baru telah dibuat di server (dienkripsi AES-256-GCM at-rest). Masukkan ke aplikasi authenticator Anda.");
          addExecutionLog(`[SECURITY] 2FA setup: kunci TOTP baru dibuat di server.`);
        } else {
          setServerSetupError(res.error || "Gagal membuat kunci TOTP di server.");
        }
      })
      .catch((e) => setServerSetupError(e?.message || String(e)))
      .finally(() => setServerSetupLoading(false));
  };

  // SEC2-AUTH: when the user opens the 2FA setup panel, fetch a fresh server-
  // side secret (preferred path). The client-side localStorage secret remains
  // as a fallback if the server is unreachable.
  useEffect(() => {
    if (!showSetup || twoFactorEnabled) return;
    if (serverSecret) return; // already loaded
    setServerSetupLoading(true);
    setServerSetupError(null);
    setup2FA()
      .then((res) => {
        if (res.success && res.secret) {
          setServerSecret(res.secret);
          setServerOtpauthUri(res.otpauthUri || "");
          addExecutionLog(`[SECURITY] 2FA setup: kunci TOTP server diterima (terenkripsi at-rest).`);
        } else {
          setServerSetupError(res.error || "Gagal memulai setup 2FA di server. Menggunakan kunci perangkat lokal sebagai fallback.");
        }
      })
      .catch((e) => {
        setServerSetupError("Server tidak merespons — menggunakan kunci perangkat lokal sebagai fallback: " + (e?.message || String(e)));
      })
      .finally(() => setServerSetupLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSetup, twoFactorEnabled]);

  const verifyAndEnable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verificationCode.length !== 6) {
      setTwoFactorMessage("Sandi OTP harus terdiri dari 6 digit numerik.");
      return;
    }
    setTotpVerifying(true);
    setTwoFactorMessage("");

    // SEC2-AUTH: PREFERRED path — server-side verification. The server holds
    // the encrypted TOTP secret (set via setup2FA), verifies the code with
    // ±1 30s window tolerance using timingSafeEqual, and on success returns
    // 8 one-time backup codes (only displayed this once).
    try {
      const serverRes = await verify2FA(verificationCode);
      if (serverRes.success) {
        setTwoFactorEnabled(true);
        setTwoFactorMessage(
          (serverRes.message || "2FA berhasil diaktifkan di server.") +
          " Kunci rahasia TOTP unik + terenkripsi disimpan di server."
        );
        if (Array.isArray(serverRes.backupCodes) && serverRes.backupCodes.length > 0) {
          setBackupCodes(serverRes.backupCodes as string[]);
        }
        setVerificationCode("");
        setShowSetup(false);
        addExecutionLog(`[SECURITY] 2FA berhasil diaktifkan (verifikasi server-side).`);
        return;
      }
      // If the server responded definitively (not a network error) we should
      // NOT silently fall back — that would create a false sense of security.
      // Only fall back to client-side TOTP when the server was unreachable
      // (serverRes.error === NETWORK_ERROR_MSG from src/lib/auth.ts).
      const NETWORK_ERR = "Gagal terhubung ke server. Periksa koneksi Anda.";
      if (serverRes.error !== NETWORK_ERR) {
        setTwoFactorMessage(serverRes.error || "Kode OTP tidak valid di server.");
        return;
      }
      // Network error — fall through to client-side TOTP as fallback.
      // eslint-disable-next-line no-console
      console.warn("[2FA] server unreachable, falling back to client-side TOTP verification.");
    } catch (err: any) {
      // Server-side verify threw — fall back to client-side TOTP. This path
      // also covers the case where the user's authenticator app was set up
      // against the localStorage secret before SEC2-AUTH was deployed.
      // eslint-disable-next-line no-console
      console.warn("[2FA] server verify threw, falling back to client-side:", err?.message || err);
    }

    // FALLBACK path — client-side TOTP verification (HMAC-SHA1, ±30s window).
    try {
      const now = Math.floor(Date.now() / 1000);
      const candidates = await Promise.all([
        computeTotp(secretKey2FA, now),
        computeTotp(secretKey2FA, now - 30),
        computeTotp(secretKey2FA, now + 30),
      ]);
      if (candidates.includes(verificationCode)) {
        setTwoFactorEnabled(true);
        setTwoFactorMessage("Otentikasi Dua Faktor (2FA) Berhasil Diaktifkan (fallback perangkat lokal)! Kunci rahasia TOTP unik tersimpan di perangkat ini. Catatan: verifikasi server-side tidak tersedia — aktifkan kembali saat online untuk perlindungan penuh.");
        setVerificationCode("");
        setShowSetup(false);
        addExecutionLog(`[SECURITY] 2FA aktif (fallback perangkat lokal — server tidak merespons).`);
      } else {
        setTwoFactorMessage("Kode OTP tidak valid untuk window waktu saat ini. Pastikan waktu perangkat Anda sinkron dan coba lagi.");
      }
    } catch (err: any) {
      setTwoFactorMessage("Gagal memverifikasi TOTP: " + (err?.message || String(err)));
    } finally {
      setTotpVerifying(false);
    }
  };

  const handleDisable2FA = async () => {
    // SEC2-AUTH: ask for a fresh TOTP code to confirm disable. We prompt via
    // window.prompt for simplicity (the existing UI doesn't have a disable
    // confirmation field). If the server is unreachable, fall back to local
    // disable so the user can always regain access.
    const code = window.prompt("Masukkan kode 6-digit dari aplikasi authenticator Anda untuk mematikan 2FA:");
    if (!code || !/^\d{6}$/.test(code)) {
      setTwoFactorMessage("Kode 2FA tidak valid — 2FA tidak dimatikan.");
      return;
    }
    setTotpVerifying(true);
    setTwoFactorMessage("");
    try {
      const res = await disable2FA(code);
      if (res.success) {
        setTwoFactorEnabled(false);
        setServerSecret("");
        setServerOtpauthUri("");
        setBackupCodes(null);
        setTwoFactorMessage(res.message || "Otentikasi Dua Faktor (2FA) berhasil dimatikan di server.");
        addExecutionLog(`[SECURITY] 2FA dimatikan (verifikasi server-side).`);
        return;
      }
      const NETWORK_ERR = "Gagal terhubung ke server. Periksa koneksi Anda.";
      if (res.error !== NETWORK_ERR) {
        setTwoFactorMessage(res.error || "Kode tidak valid. 2FA TIDAK dimatikan.");
        return;
      }
      // Network error — fall back to local disable.
      setTwoFactorEnabled(false);
      setTwoFactorMessage("Server tidak merespons — 2FA dimatikan secara lokal. Saat online kembali, 2FA server-side mungkin masih aktif; jalankan setup ulang untuk sinkronisasi.");
      addExecutionLog(`[SECURITY] 2FA dimatikan (fallback lokal — server tidak merespons).`);
    } catch (err: any) {
      setTwoFactorMessage("Gagal mematikan 2FA: " + (err?.message || String(err)));
    } finally {
      setTotpVerifying(false);
    }
  };

  // SEC2-AUTH: resend the email verification link.
  const handleResendVerification = async () => {
    setResendLoading(true);
    setResendMessage(null);
    try {
      const res = await resendVerification();
      if (res.success) {
        setResendMessage(res.message || "Email verifikasi telah dikirim ulang.");
        addExecutionLog(`[SECURITY] Email verifikasi dikirim ulang.`);
      } else {
        setResendMessage(res.error || "Gagal mengirim ulang email verifikasi.");
      }
    } catch (e: any) {
      setResendMessage("Gagal: " + (e?.message || String(e)));
    } finally {
      setResendLoading(false);
    }
  };

  const [passphrase, setPassphrase] = useState("zaytrix-safe-pass");
  const [decryptedText, setDecryptedText] = useState("");
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  // Helper using browser WebCrypto Subtle API: derivation using PBKDF2
  const getDerivedKey = async (pwd: string) => {
    const encoder = new TextEncoder();
    const rawKey = encoder.encode(pwd);
    const baseKey = await window.crypto.subtle.importKey(
      "raw",
      rawKey,
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const salt = encoder.encode("zaytrix_e2ee_hardened_salt");
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  };

  // Run real cryptographically sound E2EE encryption
  const handleRunE2EEncryption = async () => {
    setIsEncrypting(true);
    setCryptoError(null);
    try {
      const derivedKey = await getDerivedKey(passphrase);
      const encoder = new TextEncoder();
      const plaintextBytes = encoder.encode(plainText);
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      
      const cipherBuffer = await window.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        derivedKey,
        plaintextBytes
      );
      
      const cipherBytes = new Uint8Array(cipherBuffer);
      const combined = new Uint8Array(iv.length + cipherBytes.length);
      combined.set(iv, 0);
      combined.set(cipherBytes, iv.length);
      
      let binary = "";
      for (let i = 0; i < combined.byteLength; i++) {
        binary += String.fromCharCode(combined[i]);
      }
      setCipherText(btoa(binary));
    } catch (err: any) {
      setCryptoError("Kesalahan Enkripsi: " + err.message);
    } finally {
      setIsEncrypting(false);
    }
  };

  // Run real E2EE Decryption
  const handleRunE2EDecryption = async () => {
    setIsDecrypting(true);
    setCryptoError(null);
    try {
      const derivedKey = await getDerivedKey(passphrase);
      const binaryString = atob(cipherText);
      const combined = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        combined[i] = binaryString.charCodeAt(i);
      }
      
      if (combined.length < 12) {
        throw new Error("Ciphertext terlalu pendek. IV tidak lengkap.");
      }
      
      const iv = combined.slice(0, 12);
      const ciphertextBytes = combined.slice(12);
      
      const plainBuffer = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        derivedKey,
        ciphertextBytes
      );
      
      const decoder = new TextDecoder();
      setDecryptedText(decoder.decode(plainBuffer));
    } catch (err: any) {
      setCryptoError("Kesalahan Dekripsi: " + (err.message || "Pastikan kata sandi Anda cocok!"));
    } finally {
      setIsDecrypting(false);
    }
  };

  return (
    <div className="space-y-6" id="security-center-tab">
      
      {/* Title */}
      <div className="bg-[#0F172A] p-6 rounded-2xl border border-slate-800">
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-blue-500" /> Pusat Keamanan Akun & Enkripsi Data
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Lindungi portofolio finansial Anda dengan Otentikasi Dua Faktor (2FA) tingkat perbankan dan enkripsi pertukaran data end-to-end (E2EE).
        </p>

        {/* SEC2-AUTH: email verification status banner. Shown only when the user
            is logged in but their email hasn't been verified yet (or, conversely,
            when it has — as a positive confirmation). */}
        {user && (
          <div className={`mt-4 p-3.5 rounded-lg border flex items-start gap-2.5 ${
            emailVerified
              ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
              : "bg-amber-500/10 border-amber-500/25 text-amber-300"
          }`}>
            {emailVerified ? (
              <MailCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            ) : (
              <Mail className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            )}
            <div className="flex-1">
              {emailVerified ? (
                <p className="text-xs font-mono leading-relaxed">
                  Email Anda <strong>{user?.email}</strong> telah diverifikasi.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs font-mono leading-relaxed">
                    Email <strong>{user?.email}</strong> belum diverifikasi. Beberapa fitur keamanan mungkin dibatasi.
                  </p>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendLoading}
                    className="text-[10px] font-mono uppercase bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/30 px-2.5 py-1 rounded cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {resendLoading ? "Mengirim..." : "Kirim Ulang Email Verifikasi"}
                  </button>
                  {resendMessage && (
                    <p className="text-[10px] font-mono text-amber-200/80">{resendMessage}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left column: 2FA Setup Panel */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-md font-bold text-slate-200 flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-blue-500" /> Otentikasi Dua Faktor (2FA)
            </h3>
            <span className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full ${
              twoFactorEnabled ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" : "bg-amber-500/10 text-amber-400 border border-amber-500/25 animate-pulse"
            }`}>
              {twoFactorEnabled ? "Maksimal Aktif" : "Sangat Disarankan"}
            </span>
          </div>

          <div className="space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed">
              Dua Faktor Otentikasi menambahkan lapisan keamanan lapis kedua untuk memastikan hanya Anda yang memiliki akses penuh atas proyeksi finansial dan transaksi portofolio terdaftar.
            </p>

            {twoFactorMessage && (
              <div className={`p-3.5 rounded-lg text-xs font-medium border ${
                twoFactorEnabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              }`}>
                {twoFactorMessage}
              </div>
            )}

            {!twoFactorEnabled ? (
              !showSetup ? (
                <button
                  onClick={() => setShowSetup(true)}
                  id="start-setup-2fa-btn"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-3 rounded-xl text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-blue-900/15"
                >
                  <Lock className="w-4 h-4 text-white" />
                  <span>Aktifkan Google Authenticator (2FA)</span>
                </button>
              ) : (
                <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-4">
                  <span className="text-xs font-bold text-blue-400 font-mono uppercase block border-b border-slate-850 pb-2">LANGKAH KONFIGURASI 2FA (TOTP RFC 6238)</span>

                  {/* Step 1: Manual key entry — a real scannable QR code requires a
                      qrcode library (not installed); we honestly present the secret
                      as a manual-entry string instead of faking a QR icon. */}
                  <div className="flex flex-col sm:flex-row items-center gap-4 text-xs">
                    <div className="w-24 h-24 bg-white p-2 rounded-lg flex flex-col items-center justify-center text-center relative">
                      <Key className="w-7 h-7 text-slate-950" />
                      <span className="text-[8px] font-mono font-bold text-slate-950 mt-1">MANUAL</span>
                      <span className="text-[7px] font-mono text-slate-700 leading-tight">ENTRY</span>
                    </div>
                    <div className="space-y-1">
                      <span className="font-semibold text-slate-300 block">1. Masukkan Kunci Manual ke Authenticator</span>
                      <p className="text-[10px] text-slate-500 max-w-[220px]">
                        Karena terminal ini tidak membundel library QR, salin kunci rahasia base32 di langkah 2 dan masukkan manual ke aplikasi Google Authenticator, Authy, atau Duo Mobile.
                      </p>
                    </div>
                  </div>

                  {/* Step 2: Real per-user base32 TOTP secret (regenerable).
                      SEC2-AUTH: prefer the SERVER-issued secret (encrypted at
                      rest with AES-256-GCM, decrypted only for display here).
                      Fall back to the client-side localStorage secret if the
                      server is unreachable. */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-300 block">
                        2. Kunci Rahasia TOTP (Base32, 20-byte)
                        {serverSecret ? (
                          <span className="ml-2 text-[9px] font-mono text-emerald-400 uppercase">Server-Side ✓</span>
                        ) : serverSetupLoading ? (
                          <span className="ml-2 text-[9px] font-mono text-blue-400 uppercase">Memuat server…</span>
                        ) : (
                          <span className="ml-2 text-[9px] font-mono text-amber-400 uppercase">Fallback Perangkat Lokal</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={handleRegenerateSecret}
                        id="regenerate-2fa-secret-btn"
                        className="text-[9px] font-mono uppercase bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2 py-0.5 rounded cursor-pointer transition-colors flex items-center gap-1"
                        title="Buat ulang kunci rahasia TOTP"
                      >
                        <RefreshCw className="w-3 h-3" /> Buat Ulang
                      </button>
                    </div>
                    {serverSetupError && (
                      <p className="text-[9px] text-amber-400 font-mono leading-tight">{serverSetupError}</p>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={serverSecret || secretKey2FA}
                        className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-[10.5px] text-slate-300 font-mono flex-1 focus:outline-none break-all"
                      />
                      <button
                        type="button"
                        onClick={handleCopyKey}
                        id="copy-key-2fa-btn"
                        className="bg-slate-800 hover:bg-slate-750 p-2 rounded text-slate-400 border border-slate-700 hover:text-slate-100 transition-colors cursor-pointer"
                        title="Copy Key"
                      >
                        {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[9px] text-slate-500 leading-tight break-all">
                      {serverOtpauthUri
                        ? serverOtpauthUri
                        : `otpauth://totp/Z-Capital:investor?secret=${secretKey2FA}&issuer=Z-Capital`}
                    </p>
                  </div>

                  {/* SEC2-AUTH: backup-codes display — shown only ONCE after a
                      successful server-side 2FA verify. The user must save
                      these somewhere safe; they are NOT retrievable again. */}
                  {backupCodes && backupCodes.length > 0 && (
                    <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[10px] font-mono uppercase font-bold text-emerald-300">Kode Cadangan (Sekali Tampil)</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {backupCodes.map((c, i) => (
                          <code key={i} className="text-[10.5px] font-mono text-emerald-200 bg-slate-950/70 rounded px-2 py-1 text-center">
                            {c}
                          </code>
                        ))}
                      </div>
                      <p className="text-[9px] text-amber-300 font-mono leading-tight">
                        Simpan kode ini di tempat aman. Setiap kode hanya bisa digunakan satu kali jika Anda kehilangan akses ke aplikasi authenticator.
                      </p>
                    </div>
                  )}

                  {/* Step 3: Insert 6 Digit OTP — now verified via real HMAC-SHA1 TOTP */}
                  <form onSubmit={verifyAndEnable2FA} className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="block text-[10px] text-slate-400 uppercase font-semibold">3. Masukkan Kode Otentikasi 6-Digit</label>
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="misal: 123456"
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                        id="input-otp-code"
                        className="w-full bg-slate-900 border border-slate-850 rounded-lg p-2 text-xs font-mono tracking-widest text-center text-blue-400 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="flex items-start gap-1.5 text-[9.5px] text-slate-500 bg-slate-900/60 border border-slate-800 rounded p-2">
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        Verifikasi TOTP sungguhan (HMAC-SHA1, window ±30s) — diprioritaskan server-side (terenkripsi at-rest) dengan fallback perangkat lokal jika server tidak merespons.
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowSetup(false)}
                        type="button"
                        id="cancel-setup-2fa-btn"
                        className="flex-1 bg-slate-800 hover:bg-slate-760 text-slate-300 font-semibold px-3 py-2 rounded-lg text-xs"
                      >
                        Kembali (Batal)
                      </button>
                      <button
                        type="submit"
                        disabled={totpVerifying}
                        id="submit-otp-code-btn"
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-2 rounded-lg text-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {totpVerifying && <RefreshCw className="w-3 h-3 animate-spin" />}
                        Konfirmasi & Aktifkan
                      </button>
                    </div>
                  </form>
                </div>
              )
            ) : (
              <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-3.5 text-center">
                <Check className="w-10 h-10 text-emerald-400 mx-auto animate-bounce" />
                <h4 className="text-slate-200 font-bold text-sm">Otentikasi Dua Faktor Aktif (TOTP)</h4>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Sesi login, penyisipan kunci API, dan aksi sensitif diamankan dengan verifikasi TOTP RFC 6238 (HMAC-SHA1). Kunci rahasia unik tersimpan hanya di perangkat ini.
                </p>
                <button
                  type="button"
                  onClick={handleDisable2FA}
                  id="disable-2fa-btn"
                  className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs px-4 py-2 rounded-lg border border-rose-500/20 transition-all font-semibold"
                >
                  Nonaktifkan Proteksi 2FA
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right column: E2EE Interactive Simulator */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <h3 className="text-md font-bold text-slate-200 flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-500" /> Simulator Enkripsi End-to-End (E2EE)
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Privasi data pribadi dijamin sepenuhnya. Di bawah standar enkripsi militer AES-256 GCM, data sensitif Anda disandikan langsung di browser sebelum dikirim melalui internet. Coba simulasikan enkripsi E2EE secara langsung di bawah:
            </p>

            {/* Simulated plain text inputs */}
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-mono mb-1">KATA SANDI ENKRIPSI (KUNCI SIMETRIS)</label>
                <input
                  type="text"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Masukkan kata sandi pengunci aman..."
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg p-2.5 text-xs text-slate-250 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-mono mb-1">Pesan / Dokumen Data Mentah (Tingkat Client)</label>
                <textarea
                  value={plainText}
                  onChange={(e) => setPlainText(e.target.value)}
                  id="plain-text-textarea"
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-850 rounded-lg p-2.5 text-xs text-slate-250 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Encrypt button */}
              <button
                type="button"
                onClick={handleRunE2EEncryption}
                id="encrypt-action-btn"
                disabled={isEncrypting}
                className="w-full bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs py-2 rounded-lg border border-slate-700 font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isEncrypting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span>Menyalurkan Data Melalui Ring Sandi...</span>
                  </>
                ) : (
                  <>
                    <Key className="w-3.5 h-3.5 text-blue-400" />
                    <span>Enkripsi Secara Riil (AES-GCM 256)</span>
                  </>
                )}
              </button>

              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-mono mb-1.5">Ciphertext Terenkripsi Penuh (Tingkat Transit Jaringan)</label>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-850 font-mono text-[10px] text-emerald-400 break-all select-all max-h-24 overflow-y-auto">
                  {cipherText}
                </div>
              </div>

              {/* Decrypt verify block */}
              <div className="border-t border-slate-850 pt-2.5 space-y-2">
                <button
                  type="button"
                  onClick={handleRunE2EDecryption}
                  disabled={isDecrypting || !cipherText}
                  className="w-full bg-blue-600/10 hover:bg-blue-600/25 text-blue-400 text-xs py-2 rounded-lg border border-blue-500/20 font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  {isDecrypting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                  )}
                  <span>Dekripsi Kembali Payload (Uji Coba GCM)</span>
                </button>

                {decryptedText && (
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-850">
                    <span className="block text-[8.5px] text-slate-500 font-mono uppercase">Hasil Dekripsi Sukses:</span>
                    <p className="text-xs text-slate-200 font-mono">{decryptedText}</p>
                  </div>
                )}

                {cryptoError && (
                  <div className="bg-rose-500/10 p-2 rounded-lg border border-rose-500/25 text-[10.5px] text-rose-400 font-mono">
                    ⚠️ {cryptoError}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-500 uppercase font-mono mt-4 border-t border-slate-850 pt-4 flex justify-between items-center">
            <span>Standar Enkripsi: AES-256-GCM (Simulator E2EE)</span>
            <span className="text-blue-400 font-semibold">CLIENT-SIDE TOTP + E2EE DEMO</span>
          </div>
        </div>

      </div>
    </div>
  );
}
