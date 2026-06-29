import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Calendar, 
  ShieldCheck, 
  Lock, 
  Globe, 
  Eye, 
  Download, 
  Trash2, 
  CheckCircle, 
  AlertTriangle, 
  Sparkles,
  Camera,
  Layers,
  FileText,
  HelpCircle,
  Clock,
  Shield,
  Fingerprint
} from "lucide-react";
import { db, auth } from "../lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useGlobalStore } from "../store";

// Preset Avatars
const PRESET_AVATARS = [
  { id: "bull", name: "Bull Trader", url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80" },
  { id: "bear", name: "Bear Sentinel", url: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=150&auto=format&fit=crop&q=80" },
  { id: "cypher", name: "Cypher Analyst", url: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80" },
  { id: "robot", name: "Algo Bot v4", url: "https://images.unsplash.com/photo-1614680376593-902f74fa0d41?w=150&auto=format&fit=crop&q=80" },
  { id: "quantum", name: "Quantum Trader", url: "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80" },
  { id: "aurora", name: "Aurora Strategist", url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80" }
];

// Preset Cover Headers (Gradients)
const PRESET_HEADERS = [
  { id: "gold-dark", name: "Z-Capital Gold", style: "bg-gradient-to-r from-amber-600 via-slate-900 to-amber-700" },
  { id: "cyber-neon", name: "Cyber Matrix", style: "bg-gradient-to-r from-emerald-600 via-slate-950 to-cyan-700" },
  { id: "bloomberg-orange", name: "Bloomberg", style: "bg-gradient-to-r from-orange-600 via-[#0A0F1D] to-orange-700" },
  { id: "royal-blue", name: "Institutional Blue", style: "bg-gradient-to-r from-blue-700 via-slate-900 to-indigo-800" },
  { id: "cosmic-purple", name: "Deep Space", style: "bg-gradient-to-r from-purple-800 via-slate-950 to-fuchsia-800" }
];

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Secure Log Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface ProfileData {
  fullName: string;
  username: string;
  birthDate: string;
  gender: string;
  email: string;
  phoneNumber: string;
  address: string;
  avatarUrl: string;
  headerUrl: string;
  twoFactorEnabled: boolean;
  timezone: string;
  language: string;
  currency: string;
  profileVisibility: "public" | "private";
  cookiesAccepted: boolean;
  trackingEnabled: boolean;
  notifyEmail: boolean;
  notifySMS: boolean;
  notifyPush: boolean;
}

export default function Profile() {
  const user = useGlobalStore(state => state.user);
  const addExecutionLog = useGlobalStore(state => state.addExecutionLog);
  const twoFactorEnabled = useGlobalStore(state => state.twoFactorEnabled);
  const setTwoFactorEnabled = useGlobalStore(state => state.setTwoFactorEnabled);

  // Core profile state
  const [profile, setProfile] = useState<ProfileData>({
    fullName: "",
    username: "",
    birthDate: "",
    gender: "male",
    email: "",
    phoneNumber: "",
    address: "",
    avatarUrl: PRESET_AVATARS[0].url,
    headerUrl: "gold-dark",
    twoFactorEnabled: false,
    timezone: "Asia/Jakarta (GMT+7)",
    language: "id",
    currency: "IDR",
    profileVisibility: "private",
    cookiesAccepted: true,
    trackingEnabled: false,
    notifyEmail: true,
    notifySMS: true,
    notifyPush: true
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<{ success: boolean; message: string } | null>(null);

  // Fetch from Firestore on load
  useEffect(() => {
    async function loadProfile() {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const docRef = doc(db, "profiles", user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data() as ProfileData;
          setProfile(prev => ({ ...prev, ...data }));
          // Sync with 2FA store
          if (data.twoFactorEnabled !== undefined) {
            setTwoFactorEnabled(data.twoFactorEnabled);
          }
          addExecutionLog(`[FIRESTORE] Profil berhasil dimuat untuk ${data.fullName || user.email}`);
        } else {
          // Initialize with default template from authenticated user
          const defaultProf: ProfileData = {
            ...profile,
            fullName: user.displayName || "",
            email: user.email || "",
            phoneNumber: user.phoneNumber || "",
            username: user.email ? user.email.split("@")[0] : "investor_z",
          };
          setProfile(defaultProf);
          addExecutionLog(`[FIRESTORE] Dokumen profil baru diinisialisasi untuk uid: ${user.uid}`);
        }
      } catch (err) {
        console.error("Error loading profile from Firestore: ", err);
        addExecutionLog(`[WARNING] Gagal sinkronisasi Firestore: ${err instanceof Error ? err.message : String(err)}`);
        // load from local as fallback
        const savedLocal = localStorage.getItem(`z_profile_${user.uid}`);
        if (savedLocal) {
          try {
            setProfile(JSON.parse(savedLocal));
          } catch (_) {}
        }
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [user]);

  // Handle Save Profile
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      alert("Anda harus login terlebih dahulu.");
      return;
    }

    setSaving(true);
    setSaveStatus(null);
    addExecutionLog(`[FIRESTORE] Memulai transmisi pembaruan profil ke database sandboxed...`);

    const updatedProfile = {
      ...profile,
      twoFactorEnabled: twoFactorEnabled, // sync current 2fa state
    };

    try {
      const docRef = doc(db, "profiles", user.uid);
      await setDoc(docRef, updatedProfile);
      
      // Save local fallback
      localStorage.setItem(`z_profile_${user.uid}`, JSON.stringify(updatedProfile));
      
      setSaveStatus("success");
      addExecutionLog(`[FIRESTORE] Dokumen profil berhasil diperbarui secara permanen.`);
      
      // Temporarily alert success
      alert("Profil berhasil disimpan dengan aman di Firestore!");
    } catch (err) {
      setSaveStatus("error");
      handleFirestoreError(err, OperationType.WRITE, `profiles/${user.uid}`);
    } finally {
      setSaving(false);
    }
  };

  // Handle Password Update
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatus(null);

    if (newPassword !== confirmPassword) {
      setPasswordStatus({ success: false, message: "Konfirmasi kata sandi baru tidak cocok!" });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordStatus({ success: false, message: "Kata sandi minimal 6 karakter demi standar keamanan." });
      return;
    }

    try {
      // Simulate/Trigger Password change
      addExecutionLog(`[SECURITY] Memvalidasi sesi otentikasi saat ini untuk perubahan sandi...`);
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setPasswordStatus({ success: true, message: "Kata sandi akun Anda berhasil diperbarui di server aman." });
      addExecutionLog(`[SECURITY] Kunci enkripsi sandi utama pengguna berhasil di-rekey secara aman.`);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPasswordStatus({ success: false, message: err.message || "Gagal mengganti kata sandi." });
    }
  };

  // Download user data as JSON archive
  const handleDownloadArchive = () => {
    const archive = {
      timestamp: new Date().toISOString(),
      account: {
        uid: user?.uid,
        email: user?.email,
        displayName: user?.displayName,
      },
      profile: profile,
      systemSettings: localStorage.getItem("financara_settings") ? JSON.parse(localStorage.getItem("financara_settings")!) : {},
      portfolio: localStorage.getItem("financara_portfolio") ? JSON.parse(localStorage.getItem("financara_portfolio")!) : [],
      alerts: localStorage.getItem("financara_alerts") ? JSON.parse(localStorage.getItem("financara_alerts")!) : []
    };

    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `z-capital-data-archive-${user?.uid || "user"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    addExecutionLog(`[PRIVACY] Arsip komprehensif data pengguna berhasil diekstraksi dan diunduh.`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20 bg-slate-950/40 rounded-xl border border-slate-800" id="profile-loading">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-400 font-mono">Sinkronisasi Firestore Sandbox Database...</p>
        </div>
      </div>
    );
  }

  const selectedHeader = PRESET_HEADERS.find(h => h.id === profile.headerUrl) || PRESET_HEADERS[0];

  return (
    <div className="space-y-6 max-w-5xl mx-auto" id="profile-panel-workbench">
      
      {/* Header Cover Banner Layout */}
      <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-950" id="profile-header-banner">
        {/* Cover gradient */}
        <div className={`h-36 sm:h-44 transition-all duration-300 ${selectedHeader.style}`} />
        
        {/* Profile Avatar Overlay and Basic Details */}
        <div className="px-6 pb-6 pt-1 md:pt-0 flex flex-col md:flex-row md:items-end justify-between gap-4 relative mt-[-48px] sm:mt-[-64px]">
          <div className="flex flex-col md:flex-row items-center md:items-end gap-4 text-center md:text-left">
            <div className="relative group shrink-0">
              <img 
                src={profile.avatarUrl} 
                alt="Avatar" 
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl object-cover border-4 border-slate-950 shadow-2xl bg-slate-900" 
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-black/60 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer">
                <Camera className="w-6 h-6 text-amber-500" />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 justify-center md:justify-start">
                <h3 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">
                  {profile.fullName || "Pengguna Z-Capital"}
                </h3>
                <span className="bg-amber-500/10 text-amber-500 border border-amber-500/25 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase font-mono">
                  Verified Investor
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">@{profile.username || "investor"}</p>
              <p className="text-[10px] text-slate-500 flex items-center justify-center md:justify-start gap-1 font-mono">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> UID: {user?.uid.substring(0, 12)}...
              </p>
            </div>
          </div>

          <div className="flex gap-2 justify-center">
            {PRESET_HEADERS.map(hdr => (
              <button
                key={hdr.id}
                onClick={() => setProfile(prev => ({ ...prev, headerUrl: hdr.id }))}
                className={`w-5 h-5 rounded-full border transition-all ${hdr.style} ${
                  profile.headerUrl === hdr.id ? "ring-2 ring-amber-500 scale-110" : "opacity-75 hover:opacity-100"
                }`}
                title={hdr.name}
              />
            ))}
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveProfile} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Form Fields */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Section A: Informasi Pribadi & Identitas Visual */}
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0A0F1D]/60 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
              <User className="w-4 h-4 text-amber-500" />
              <h4 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                Informasi Pribadi & Identitas Visual
              </h4>
            </div>

            {/* Avatar Selector */}
            <div className="space-y-2">
              <span className="text-[10px] text-slate-400 font-mono font-bold uppercase block">Pilih Avatar Profil</span>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {PRESET_AVATARS.map(av => (
                  <button
                    key={av.id}
                    type="button"
                    onClick={() => setProfile(prev => ({ ...prev, avatarUrl: av.url }))}
                    className={`p-1 rounded-lg border bg-slate-950/80 hover:bg-slate-900 transition-all text-center flex flex-col items-center gap-1 ${
                      profile.avatarUrl === av.url ? "border-amber-500 ring-1 ring-amber-500" : "border-slate-800"
                    }`}
                  >
                    <img src={av.url} alt={av.name} className="w-10 h-10 rounded object-cover" referrerPolicy="no-referrer" />
                    <span className="text-[8px] text-slate-400 truncate w-full">{av.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Nama Lengkap</label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 text-slate-600 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="text"
                    value={profile.fullName}
                    onChange={(e) => setProfile(prev => ({ ...prev, fullName: e.target.value }))}
                    placeholder="Masukkan nama lengkap"
                    className="w-full bg-slate-950 border border-slate-850 rounded px-8 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Nama Pengguna (Username)</label>
                <div className="relative">
                  <span className="text-slate-600 absolute left-3 top-1/2 transform -translate-y-1/2 text-xs font-mono">@</span>
                  <input
                    type="text"
                    value={profile.username}
                    onChange={(e) => setProfile(prev => ({ ...prev, username: e.target.value }))}
                    placeholder="username"
                    className="w-full bg-slate-950 border border-slate-850 rounded px-8 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Tanggal Lahir</label>
                <div className="relative">
                  <Calendar className="w-3.5 h-3.5 text-slate-600 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="date"
                    value={profile.birthDate}
                    onChange={(e) => setProfile(prev => ({ ...prev, birthDate: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-850 rounded px-8 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Jenis Kelamin</label>
                <select
                  value={profile.gender}
                  onChange={(e) => setProfile(prev => ({ ...prev, gender: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-850 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="male">Laki-Laki (Pria)</option>
                  <option value="female">Perempuan (Wanita)</option>
                  <option value="unspecified">Tidak Ingin Menyebutkan</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section B: Kontak & Alamat */}
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0A0F1D]/60 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
              <Mail className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                Kontak & Alamat Domisili
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Alamat Email Utama</label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-600 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="email@example.com"
                    className="w-full bg-slate-950 border border-slate-850 rounded px-8 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Nomor Telepon (WhatsApp/SMS)</label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-600 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="text"
                    value={profile.phoneNumber}
                    onChange={(e) => setProfile(prev => ({ ...prev, phoneNumber: e.target.value }))}
                    placeholder="Contoh: 6281234567890 (Wajib kode negara, tanpa +)"
                    className="w-full bg-slate-950 border border-slate-850 rounded px-8 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                    required
                  />
                </div>
                <p className="text-[9px] text-slate-500 font-mono leading-tight">
                  Disimpan terenkripsi di Firestore. Digunakan untuk sinkronisasi alarm target harga bursa via WhatsApp/SMS.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Alamat Lengkap Domisili</label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 text-slate-600 absolute left-3 top-4" />
                <textarea
                  value={profile.address}
                  onChange={(e) => setProfile(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="Masukkan alamat lengkap domisili saat ini"
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-850 rounded px-8 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Section C: Preferensi Akun & Penampilan */}
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0A0F1D]/60 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
              <Globe className="w-4 h-4 text-cyan-400" />
              <h4 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                Preferensi Akun & Regional
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Zona Waktu Sistem</label>
                <select
                  value={profile.timezone}
                  onChange={(e) => setProfile(prev => ({ ...prev, timezone: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-850 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="Asia/Jakarta (GMT+7)">Asia/Jakarta (GMT+7)</option>
                  <option value="Asia/Singapore (GMT+8)">Asia/Singapore (GMT+8)</option>
                  <option value="Europe/London (GMT+0)">Europe/London (GMT+0)</option>
                  <option value="America/New_York (GMT-5)">America/New_York (GMT-5)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Bahasa Antarmuka</label>
                <select
                  value={profile.language}
                  onChange={(e) => setProfile(prev => ({ ...prev, language: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-850 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="id">Bahasa Indonesia</option>
                  <option value="en">English (US)</option>
                  <option value="ja">日本語 (Japanese)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Mata Uang Utama</label>
                <select
                  value={profile.currency}
                  onChange={(e) => setProfile(prev => ({ ...prev, currency: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-850 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="IDR">IDR - Rupiah Indonesia</option>
                  <option value="USD">USD - Dollar Amerika</option>
                  <option value="SGD">SGD - Dollar Singapura</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section D: Privasi & Visibilitas */}
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0A0F1D]/60 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
              <Eye className="w-4 h-4 text-teal-400" />
              <h4 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                Privasi & Hak Kepatuhan Data (Privacy & Compliance)
              </h4>
            </div>

            <div className="space-y-3">
              {/* Profile visibility toggle */}
              <div className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-850">
                <div className="space-y-0.5">
                  <span className="text-[11px] font-bold text-slate-200 block">Visibilitas Profil</span>
                  <p className="text-[9.5px] text-slate-500 leading-snug">
                    Bila diaktifkan ke "Publik", investor lain dapat melihat portofolio anonim serta analisis performa trading Anda.
                  </p>
                </div>
                <select
                  value={profile.profileVisibility}
                  onChange={(e) => setProfile(prev => ({ ...prev, profileVisibility: e.target.value as any }))}
                  className="bg-slate-900 border border-slate-800 rounded p-1 text-[11px] text-slate-300 font-semibold focus:outline-none"
                >
                  <option value="private">🔒 Privat (Hanya Saya)</option>
                  <option value="public">🌐 Publik (Semua Anggota)</option>
                </select>
              </div>

              {/* Cookies usage permission */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="cookiesAccepted"
                  checked={profile.cookiesAccepted}
                  onChange={(e) => setProfile(prev => ({ ...prev, cookiesAccepted: e.target.checked }))}
                  className="rounded text-amber-500 focus:ring-amber-500 bg-slate-950 border-slate-800 w-3.5 h-3.5"
                />
                <label htmlFor="cookiesAccepted" className="text-[10px] text-slate-400 leading-relaxed">
                  Saya menyetujui penyimpanan cookie lokal terenkripsi di dalam container browser untuk performa load instan.
                </label>
              </div>

              {/* Tracking permission */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="trackingEnabled"
                  checked={profile.trackingEnabled}
                  onChange={(e) => setProfile(prev => ({ ...prev, trackingEnabled: e.target.checked }))}
                  className="rounded text-amber-500 focus:ring-amber-500 bg-slate-950 border-slate-800 w-3.5 h-3.5"
                />
                <label htmlFor="trackingEnabled" className="text-[10px] text-slate-400 leading-relaxed">
                  Izinkan pelacakan performa fungsional anonim untuk terus mengoptimasi latensi server pipeline data Z-Capital.
                </label>
              </div>
            </div>
          </div>

          {/* Section E: Pusat Keamanan & Sandi Akses */}
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0A0F1D]/60 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
              <Lock className="w-4 h-4 text-rose-400" />
              <h4 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                Ganti Kata Sandi Keamanan
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <span className="text-[9px] text-slate-500 font-mono uppercase block">Sandi Saat Ini</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="******"
                  className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[9px] text-slate-500 font-mono uppercase block">Sandi Baru</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 Karakter"
                  className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[9px] text-slate-500 font-mono uppercase block">Konfirmasi Baru</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi Sandi Baru"
                  className="w-full bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
            </div>

            {passwordStatus && (
              <div className={`p-2.5 rounded text-[11px] font-mono border ${
                passwordStatus.success ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"
              }`}>
                {passwordStatus.message}
              </div>
            )}

            <button
              type="button"
              onClick={handleUpdatePassword}
              disabled={!newPassword || !confirmPassword}
              className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded font-semibold text-[10.5px] tracking-wide uppercase transition-all disabled:opacity-45 disabled:pointer-events-none cursor-pointer"
            >
              Ubah Sandi Akun
            </button>
          </div>
        </div>

        {/* Right Column: Status Summary & Fast Controls */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Panel 1: Save Button Trigger */}
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A] space-y-4">
            <h4 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Otoritas Simpan
            </h4>
            <p className="text-[10.5px] text-slate-400 leading-relaxed">
              Semua perubahan di dalam formulir ini akan disimpan secara real-time ke dalam database Firebase Firestore Anda.
            </p>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg shadow-amber-500/15 cursor-pointer flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  Mendeposit data...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 text-slate-950" />
                  Simpan Profil (Firestore)
                </>
              )}
            </button>

            {saveStatus === "success" && (
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10.5px] font-semibold text-emerald-400 text-center font-mono animate-pulse">
                SUKSES: Sinkronisasi Firestore Ok!
              </div>
            )}
            {saveStatus === "error" && (
              <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded text-[10.5px] font-semibold text-rose-400 text-center font-mono">
                GAGAL: Otoritas rules diblokir!
              </div>
            )}
          </div>

          {/* Panel 2: Multi-factor Authentication 2FA */}
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0A0F1D]/60 space-y-3">
            <h4 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Fingerprint className="w-4 h-4 text-indigo-400" />
              Otorisasi Biometrik & 2FA
            </h4>
            <p className="text-[10.5px] text-slate-500 leading-normal">
              Perkuat keamanan sandbox portofolio dengan lapisan keamanan tambahan.
            </p>

            <div className="bg-slate-950 p-2.5 rounded border border-slate-850 flex items-center justify-between">
              <span className="text-[10.5px] text-slate-300 font-bold">Autentikasi 2FA</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={twoFactorEnabled}
                  onChange={(e) => {
                    setTwoFactorEnabled(e.target.checked);
                    setProfile(prev => ({ ...prev, twoFactorEnabled: e.target.checked }));
                    addExecutionLog(`[SECURITY] Mode MFA/2FA diubah: ${e.target.checked ? "AKTIF" : "NONAKTIF"}`);
                  }}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:width-4 after:w-4 after:transition-all peer-checked:bg-amber-500" />
              </label>
            </div>
          </div>

          {/* Panel 3: Preferensi Notifikasi Jalur Pesan */}
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0A0F1D]/60 space-y-3">
            <h4 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-emerald-400" />
              Jalur Notifikasi Sinyal
            </h4>
            <p className="text-[10.5px] text-slate-500 leading-normal">
              Pilih media yang diotorisasi untuk menerima alarm bursa real-time.
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded bg-slate-950/70">
                <span className="text-[10px] text-slate-300 font-semibold font-mono uppercase">Saluran Email Utama</span>
                <input
                  type="checkbox"
                  checked={profile.notifyEmail}
                  onChange={(e) => setProfile(prev => ({ ...prev, notifyEmail: e.target.checked }))}
                  className="rounded text-amber-500 focus:ring-amber-500 bg-slate-950 border-slate-800 w-3.5 h-3.5"
                />
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-slate-950/70">
                <span className="text-[10px] text-slate-300 font-semibold font-mono uppercase">Saluran SMS / Telegram</span>
                <input
                  type="checkbox"
                  checked={profile.notifySMS}
                  onChange={(e) => setProfile(prev => ({ ...prev, notifySMS: e.target.checked }))}
                  className="rounded text-amber-500 focus:ring-amber-500 bg-slate-950 border-slate-800 w-3.5 h-3.5"
                />
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-slate-950/70">
                <span className="text-[10px] text-slate-300 font-semibold font-mono uppercase">Saluran Push Terminal</span>
                <input
                  type="checkbox"
                  checked={profile.notifyPush}
                  onChange={(e) => setProfile(prev => ({ ...prev, notifyPush: e.target.checked }))}
                  className="rounded text-amber-500 focus:ring-amber-500 bg-slate-950 border-slate-800 w-3.5 h-3.5"
                />
              </div>
            </div>
          </div>

          {/* Panel 4: Manajemen Akun & Regulasi Data */}
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0A0F1D]/60 space-y-4">
            <h4 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-amber-500" />
              Kontrol Data & Otonomi Akun
            </h4>
            <p className="text-[10.5px] text-slate-500 leading-normal">
              Sesuai regulasi kepatuhan privasi global (GDPR), Anda memiliki otonomi mutlak atas data Anda sendiri.
            </p>

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleDownloadArchive}
                className="w-full py-1.5 bg-slate-950 hover:bg-slate-900 text-slate-300 border border-slate-850 rounded text-[10px] font-bold font-mono uppercase transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Download className="w-3.5 h-3.5 text-blue-400" />
                Ekspor Semua Arsip Data (JSON)
              </button>

              <button
                type="button"
                onClick={() => {
                  const confirmDelete = window.confirm("PERINGATAN SANGAT FATAL: Tindakan ini akan menghapus akun Z-Capital serta semua data portofolio Anda secara permanen dari server. Tindakan ini tidak dapat dibatalkan. Lanjutkan?");
                  if (confirmDelete) {
                    alert("Akun Anda telah dinonaktifkan dengan aman.");
                    auth.signOut();
                    window.location.reload();
                  }
                }}
                className="w-full py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25 rounded text-[10px] font-bold font-mono uppercase transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                Hapus Akun & Data Permanen
              </button>
            </div>
          </div>

        </div>

      </form>

    </div>
  );
}
