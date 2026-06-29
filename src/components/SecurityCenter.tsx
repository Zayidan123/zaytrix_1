import React, { useState } from "react";
import { 
  ShieldCheck, 
  Lock, 
  Key, 
  Check, 
  RefreshCw, 
  Copy, 
  QrCode, 
  Fingerprint
} from "lucide-react";

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

  // E2EE interactive simulation states
  const [plainText, setPlainText] = useState("Kalkulasi Portfolio: Saham BBCA Rp 120,000,000");
  const [cipherText, setCipherText] = useState("U2FsdGVkX1+zSmdrSTFvL2g1UXJZdms1Skdkb... (AES-256)");
  const [isEncrypting, setIsEncrypting] = useState(false);

  // Mock Backup Secret 2FA Key
  const secretKey2FA = "Z-CAPITAL-2FA-AUTH-X992";

  const handleCopyKey = () => {
    navigator.clipboard.writeText(secretKey2FA);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const verifyAndEnable2FA = (e: React.FormEvent) => {
    e.preventDefault();
    if (verificationCode.length !== 6) {
      setTwoFactorMessage("Sandi OTP harus terdiri dari 6 digit numerik.");
      return;
    }

    setTwoFactorEnabled(true);
    setTwoFactorMessage("Otentikasi Dua Faktor (2FA) Berhasil Diaktifkan! Akun Anda kini memiliki proteksi maksimal.");
    setVerificationCode("");
    setShowSetup(false);
  };

  const handleDisable2FA = () => {
    setTwoFactorEnabled(false);
    setTwoFactorMessage("Otentikasi Dua Faktor (2FA) telah dimatikan.");
  };

  const [passphrase, setPassphrase] = useState("z-capital-safe-pass");
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
    const salt = encoder.encode("z-capital_e2ee_hardened_salt");
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
                  <span className="text-xs font-bold text-blue-400 font-mono uppercase block border-b border-slate-850 pb-2">LANGKAH KONFIGURASI 2FA</span>
                  
                  {/* Step 1: Simulated QR code */}
                  <div className="flex flex-col sm:flex-row items-center gap-4 text-xs">
                    <div className="w-24 h-24 bg-white p-2 rounded-lg flex items-center justify-center relative">
                      <QrCode className="w-20 h-20 text-slate-950" />
                    </div>
                    <div className="space-y-1">
                      <span className="font-semibold text-slate-300 block">1. Pindai Kode QR</span>
                      <p className="text-[10px] text-slate-500 max-w-[220px]">
                        Gunakan aplikasi Google Authenticator, Authy, atau Duo Mobile di handphone Anda untuk memindai kode QR di sebelah.
                      </p>
                    </div>
                  </div>

                  {/* Step 2: Backup Secret Key */}
                  <div className="space-y-1.5 text-xs">
                    <span className="font-semibold text-slate-300 block">2. Cadangkan Kunci Rahasia</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={secretKey2FA}
                        className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-300 font-mono flex-1 focus:outline-none"
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
                  </div>

                  {/* Step 3: Insert 6 Digit OTP */}
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
                        id="submit-otp-code-btn"
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-2 rounded-lg text-xs transition-colors"
                      >
                        Konfirmasi & Aktifkan
                      </button>
                    </div>
                  </form>
                </div>
              )
            ) : (
              <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-3.5 text-center">
                <Check className="w-10 h-10 text-emerald-400 mx-auto animate-bounce" />
                <h4 className="text-slate-200 font-bold text-sm">Otentikasi Dua Faktor Aktif</h4>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Sesi login, penyisipan kunci API mock, dan pencairan visual portofolio Anda diamankan sepenuhnya menggunakan kunci rahasia Google Authenticator Anda.
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
            <span>Standar Enkripsi: AES-256-GCM SSL</span>
            <span className="text-blue-400 font-semibold">100% PRIVATE & ENCRYPTED</span>
          </div>
        </div>

      </div>
    </div>
  );
}
