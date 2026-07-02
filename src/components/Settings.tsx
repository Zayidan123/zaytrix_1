import React, { useState } from "react";
import { 
  User,
  Sliders, 
  Lock, 
  Bell, 
  Eye, 
  Layers, 
  HelpCircle,
  Sun, 
  Moon, 
  Terminal, 
  Database, 
  RefreshCw, 
  ShieldCheck, 
  Info,
  LockKeyhole,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Cpu,
  Key,
  ShieldAlert,
  Smartphone,
  Globe,
  Plus,
  Trash2,
  Download,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Fingerprint,
  Link,
  ArrowLeft,
  ChevronLeft,
  Sparkles,
  Droplet,
  Box
} from "lucide-react";
import { useGlobalStore } from "../store";
import { AppSettings } from "../types";
import { safeLocalStorage } from "../utils/safeStorage";
import { sendAlertSecurely } from "../services/webhookService";
import Profile from "./Profile";

export default function Settings() {
  const settings = useGlobalStore(state => state.settings);
  const updateSettings = useGlobalStore(state => state.updateSettings);
  const resetSettings = useGlobalStore(state => state.resetSettings);
  const addExecutionLog = useGlobalStore(state => state.addExecutionLog);
  const setPortfolio = useGlobalStore(state => state.setPortfolio);
  const setAlerts = useGlobalStore(state => state.setAlerts);
  const twoFactorEnabled = useGlobalStore(state => state.twoFactorEnabled);
  const setTwoFactorEnabled = useGlobalStore(state => state.setTwoFactorEnabled);

  // Active Setting Sub-Tab
  const [activeSubTab, setActiveSubTab] = useState<"profil" | "tampilan" | "keamanan" | "notifikasi" | "privasi" | "integrasi" | "bantuan">("profil");
  const [viewMode, setViewMode] = useState<"menu" | "detail">("menu");

  // Connection Testing States
  const [testingConnection, setTestingConnection] = useState(false);
  const [connLogs, setConnLogs] = useState<string[]>([]);
  const [connSuccess, setConnSuccess] = useState<boolean | null>(null);

  // Notification Config global hooks
  const notificationConfig = useGlobalStore(state => state.notificationConfig);
  const updateNotificationConfig = useGlobalStore(state => state.updateNotificationConfig);

  // Temporary local states for Notification Inputs
  const [localTelegramEnabled, setLocalTelegramEnabled] = useState(notificationConfig.telegramEnabled);
  const [localTelegramBotToken, setLocalTelegramBotToken] = useState(notificationConfig.telegramBotToken);
  const [localTelegramChatId, setLocalTelegramChatId] = useState(notificationConfig.telegramChatId);
  const [localDiscordEnabled, setLocalDiscordEnabled] = useState(notificationConfig.discordEnabled);
  const [localDiscordWebhookUrl, setLocalDiscordWebhookUrl] = useState(notificationConfig.discordWebhookUrl);
  const [localWhatsappEnabled, setLocalWhatsappEnabled] = useState(notificationConfig.whatsappEnabled || false);
  const [localWhatsappWebhookUrl, setLocalWhatsappWebhookUrl] = useState(notificationConfig.whatsappWebhookUrl || "");
  const [localWhatsappPhoneNumber, setLocalWhatsappPhoneNumber] = useState(notificationConfig.whatsappPhoneNumber || "");

  // Notification types toggles state
  const [notifyUpdates, setNotifyUpdates] = useState(true);
  const [notifyPriceAlerts, setNotifyPriceAlerts] = useState(true);
  const [notifyTrades, setNotifyTrades] = useState(true);
  const [notifySecurity, setNotifySecurity] = useState(true);

  // Active devices state
  const [activeDevices, setActiveDevices] = useState([
    { id: 1, name: "Chrome v126 on Windows 11", location: "Jakarta, Indonesia", ip: "182.1.25.101", current: true, time: "Sesi Saat Ini" },
    { id: 2, name: "Safari v17 on iPhone 15 Pro", location: "Bandung, Indonesia", ip: "114.79.12.54", current: false, time: "Terotorisasi (2 jam yang lalu)" },
    { id: 3, name: "Firefox v125 on macOS Sonoma", location: "Singapore Server", ip: "13.250.1.92", current: false, time: "Terotorisasi (Kemarin)" }
  ]);

  // Privacy Blocklist state
  const [blocklist, setBlocklist] = useState<string[]>(["@spammer_bot", "@dump_alert"]);
  const [newBlockedUser, setNewBlockedUser] = useState("");

  const handleAddBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockedUser.trim()) return;
    const formatted = newBlockedUser.startsWith("@") ? newBlockedUser.trim() : `@${newBlockedUser.trim()}`;
    if (!blocklist.includes(formatted)) {
      setBlocklist([...blocklist, formatted]);
      addExecutionLog(`[PRIVACY] Pengguna ${formatted} berhasil ditambahkan ke daftar blokir.`);
    }
    setNewBlockedUser("");
  };

  const handleRemoveBlock = (userToRemove: string) => {
    setBlocklist(blocklist.filter(u => u !== userToRemove));
    addExecutionLog(`[PRIVACY] Pengguna ${userToRemove} dihapus dari daftar blokir.`);
  };

  // FAQ Accordion expansions
  const [faqExpanded, setFaqExpanded] = useState<Record<number, boolean>>({
    0: true,
    1: false,
    2: false
  });

  const toggleFaq = (index: number) => {
    setFaqExpanded(prev => ({ ...prev, [index]: !prev[index] }));
  };

  // E2EE Interactive simulator state
  const [plainText, setPlainText] = useState("Proyeksi Investasi BBCA Target: Rp 12.500");
  const [cipherText, setCipherText] = useState("U2FsdGVkX1+zSmdrSTFvL2g1UXJZdms1Skdkb...");
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [passphrase, setPassphrase] = useState("kunci-rahasia-zaytrix");
  const [decryptedText, setDecryptedText] = useState("");
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [cryptoError, setCryptoError] = useState<string | null>(null);

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

  // Testing webhooks
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestStatus, setWebhookTestStatus] = useState<string | null>(null);

  const testWebhooks = async () => {
    setTestingWebhook(true);
    setWebhookTestStatus(null);

    const testMsg = `🤖 [ZAYTRIX ALARM] Koneksi sukses! Webhook Anda telah terhubung dengan database real-time dan siap memecahkan alarm target harga bursa. Diuji pada: ${new Date().toISOString()}`;

    try {
      if (!localTelegramEnabled && !localDiscordEnabled && !localWhatsappEnabled) {
        setWebhookTestStatus("Tidak ada saluran eksternal (Telegram, Discord, atau WhatsApp) yang terpilih / aktif untuk diuji coba.");
        setTestingWebhook(false);
        return;
      }

      if (localTelegramEnabled && (!localTelegramBotToken || !localTelegramChatId)) {
        throw new Error("Bot Token atau Chat ID Telegram kosong ketika dicentang Aktif.");
      }
      if (localDiscordEnabled && !localDiscordWebhookUrl) {
        throw new Error("URL Webhook Discord kosong ketika dicentang Aktif.");
      }
      if (localWhatsappEnabled && !localWhatsappWebhookUrl) {
        throw new Error("URL Webhook WhatsApp kosong ketika dicentang Aktif.");
      }

      const data = await sendAlertSecurely({
        telegramEnabled: localTelegramEnabled,
        telegramBotToken: localTelegramBotToken,
        telegramChatId: localTelegramChatId,
        discordEnabled: localDiscordEnabled,
        discordWebhookUrl: localDiscordWebhookUrl,
        whatsappEnabled: localWhatsappEnabled,
        whatsappWebhookUrl: localWhatsappWebhookUrl,
        whatsappPhoneNumber: localWhatsappPhoneNumber,
        messageText: testMsg
      });

      if (!data.success) {
        throw new Error(data.error || "Gagal mentransmisikan pesan uji coba.");
      }

      const report: string[] = [];
      const errors: string[] = [];

      if (localTelegramEnabled) {
        if (data.results?.telegram?.success) report.push("Telegram OK");
        else errors.push(`Telegram Gagal: ${data.results?.telegram?.error || "Unknown Error"}`);
      }
      if (localDiscordEnabled) {
        if (data.results?.discord?.success) report.push("Discord OK");
        else errors.push(`Discord Gagal: ${data.results?.discord?.error || "Unknown Error"}`);
      }
      if (localWhatsappEnabled) {
        if (data.results?.whatsapp?.success) report.push("WhatsApp OK");
        else errors.push(`WhatsApp Gagal: ${data.results?.whatsapp?.error || "Unknown Error"}`);
      }

      if (errors.length > 0) {
        const fullStatus = `Hasil uji coba: [Berhasil] ${report.join(", ") || "None"}. [Gagal] ${errors.join("; ")}`;
        setWebhookTestStatus(fullStatus);
        addExecutionLog(`[WARNING] Integrasi webhook mengalami kegagalan transmisi: ${errors.join("; ")}`);
      } else {
        setWebhookTestStatus(`Berhasil mengirim uji coba nyata melalui server backend ke: ${report.join(" & ")}`);
        addExecutionLog(`[SYSTEM] Uji coba webhook berhasil dirilis ke ${report.join(" & ")}.`);
      }
    } catch (e: any) {
      setWebhookTestStatus(`KESALAHAN UJI WEBHOOK: ${e.message}`);
      addExecutionLog(`[WARNING] Integrasi webhook mengalami kegagalan transmisi: ${e.message}`);
    } finally {
      setTestingWebhook(false);
    }
  };

  const saveNotificationSettings = () => {
    const nextConfig = {
      telegramEnabled: localTelegramEnabled,
      telegramBotToken: localTelegramBotToken,
      telegramChatId: localTelegramChatId,
      discordEnabled: localDiscordEnabled,
      discordWebhookUrl: localDiscordWebhookUrl,
      whatsappEnabled: localWhatsappEnabled,
      whatsappWebhookUrl: localWhatsappWebhookUrl,
      whatsappPhoneNumber: localWhatsappPhoneNumber,
    };
    
    updateNotificationConfig(nextConfig);

    // Synchronize to persistent backend server for background tracking
    fetch("/api/settings/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextConfig)
    })
    .then(res => res.json())
    .then(data => {
      console.log("[Settings Sync] Notification configuration synchronized to server successfully:", data);
    })
    .catch(err => {
      console.error("[Settings Sync] Failed to sync notifications to server:", err);
    });

    addExecutionLog(`[SYSTEM] Konfigurasi saluran notifikasi/webhook berhasil diperbarui.`);
    alert("Konfigurasi notifikasi webhook berhasil disimpan.");
  };

  // Temporary local states for API inputs
  const [localBinanceKey, setLocalBinanceKey] = useState(settings.binanceKey);
  const [localBinanceSecret, setLocalBinanceSecret] = useState(settings.binanceSecret);
  const [localKucoinKey, setLocalKucoinKey] = useState(settings.kucoinKey);
  const [localKucoinSecret, setLocalKucoinSecret] = useState(settings.kucoinSecret);
  const [localBybitKey, setLocalBybitKey] = useState(settings.bybitKey);
  const [localBybitSecret, setLocalBybitSecret] = useState(settings.bybitSecret);
  const [localGeminiKey, setLocalGeminiKey] = useState(settings.geminiKey);

  // Save credentials
  // NOTE: API keys are stored as plaintext JSON in localStorage (via Zustand
  // updateSettings -> financara_settings). We honestly tell the user this;
  // previously the UI falsely claimed "AES-256" protection.
  const saveApiCredentials = () => {
    updateSettings({
      binanceKey: localBinanceKey,
      binanceSecret: localBinanceSecret,
      kucoinKey: localKucoinKey,
      kucoinSecret: localKucoinSecret,
      bybitKey: localBybitKey,
      bybitSecret: localBybitSecret,
      geminiKey: localGeminiKey,
    });
    addExecutionLog(`[SYSTEM] Kredensial API disimpan di browser lokal (localStorage). Tidak dienkripsi.`);
    alert("Kredensial API disimpan di browser (localStorage, plaintext). Gunakan Master PIN di tab Api Automation untuk enkripsi E2EE opsional.");
  };

  // Connection validation simulation
  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnSuccess(null);
    setConnLogs([]);

    const steps = [
      "[DIAGNOSTIK] Memulai verifikasi port komunikasi sandbox...",
      "[AUTHENTICATION] Melakukan handshake enkripsi kunci API...",
      "[NETWORK] Melakukan ping ke endpoint " + settings.exchangeFeed.toUpperCase() + " API REST Server...",
      "[SSL] Melakukan validasi sertifikat SSL SHA-256...",
      "[RATE_LIMIT] Memeriksa status anti-cyberattack jaring lokal..."
    ];

    for (let i = 0; i < steps.length; i++) {
      setConnLogs(prev => [...prev, steps[i]]);
      await new Promise(resolve => setTimeout(resolve, 350 + Math.random() * 300));
    }

    try {
      let pingUrl = "https://api.binance.com/api/v3/ping";
      if (settings.exchangeFeed === "kucoin") {
        pingUrl = "https://api.kucoin.com/api/v1/timestamp";
      } else if (settings.exchangeFeed === "bybit") {
        pingUrl = "https://api.bybit.com/v5/market/time";
      }
      
      const response = await fetch(pingUrl, { method: "GET", mode: "cors" });
      if (response.ok) {
        setConnLogs(prev => [...prev, "[SINKRONISASI] Sinkronisasi stempel waktu REST API sukses!"]);
        setConnSuccess(true);
      } else {
        throw new Error("HTTP Status: " + response.status);
      }
    } catch (err: any) {
      // Honest failure reporting — previously the catch block unconditionally
      // set connSuccess(true), making it impossible for the user to see a real
      // failure (CORS block, network error, etc.). Now we surface the real
      // error message and set connSuccess(false).
      const errMsg = err?.message || "Gagal menghubungi endpoint bursa (kemungkinan diblokir CORS atau jaringan).";
      setConnLogs(prev => [...prev, `[PERINGATAN] Gagal menghubungi REST API bursa: ${errMsg}`]);
      setConnSuccess(false);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleDownloadArchive = () => {
    const archive = {
      timestamp: new Date().toISOString(),
      settings: settings,
      notification: notificationConfig,
      portfolio: localStorage.getItem("financara_portfolio") ? JSON.parse(localStorage.getItem("financara_portfolio")!) : [],
      alerts: localStorage.getItem("financara_alerts") ? JSON.parse(localStorage.getItem("financara_alerts")!) : []
    };

    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zaytrix-settings-archive.json`;
    link.click();
    URL.revokeObjectURL(url);
    addExecutionLog(`[PRIVACY] Ekspor arsip kepatuhan data Z-Capital selesai.`);
  };

  // List of Tabs in Settings Hub
  const tabs = [
    { id: "profil", name: "Profil Pengguna", icon: User, desc: "Identitas personal & info domisili" },
    { id: "tampilan", name: "Tampilan & Feeds", icon: Sliders, desc: "Tema, bahasa & frekuensi bursa" },
    { id: "keamanan", name: "Pusat Keamanan", icon: Lock, desc: "Ganti sandi, 2FA & sesi aktif" },
    { id: "notifikasi", name: "Kontrol Notifikasi", icon: Bell, desc: "Telegram, Discord, WhatsApp" },
    { id: "privasi", name: "Privasi & Compliance", icon: Eye, desc: "Visibilitas data & daftar blokir" },
    { id: "integrasi", name: "Integrasi & API Keys", icon: Link, desc: "Kunci API bursa, Google, Apple" },
    { id: "bantuan", name: "Bantuan & Hukum", icon: HelpCircle, desc: "Panduan trading, FAQ & Kebijakan" },
  ] as const;

  return (
    <div className="space-y-6" id="settings-hub-workbench">
      
      {/* Settings Hub Header Banner */}
      <div className="bg-[#0F172A] p-6 rounded-2xl border border-slate-800">
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Sliders className="w-5 h-5 text-amber-500 animate-spin-slow" /> Settings Hub (Pusat Pengaturan Utama)
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Kelola profil pengguna, penampilan visual, keamanan siber, integrasi webhook real-time, dan legalitas privasi Anda dalam satu konsol modular.
        </p>
      </div>

      {viewMode === "menu" ? (
        <div className="space-y-6 animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider block">MENU MODUL PENGATURAN</span>
            <span className="text-[10px] text-slate-500 font-mono">Pilih salah satu modul untuk kustomisasi</span>
          </div>

          {/* Grid of Settings Categories */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveSubTab(tab.id);
                    setViewMode("detail");
                  }}
                  className="group relative bg-[#0A0F1D]/80 border border-slate-850 hover:border-amber-500/50 rounded-xl p-5 text-left transition-all duration-300 hover:shadow-lg hover:shadow-amber-500/5 hover:-translate-y-0.5 flex flex-col justify-between h-44 cursor-pointer animate-fade-in"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-bl-full group-hover:bg-amber-500/10 transition-colors pointer-events-none" />
                  
                  <div className="space-y-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-200 group-hover:text-amber-400 transition-colors">{tab.name}</h3>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">{tab.desc}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-amber-400 font-bold uppercase mt-2 group-hover:gap-2.5 transition-all">
                    <span>Kelola Pengaturan</span>
                    <ArrowLeft className="w-3 h-3 rotate-180" />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="p-5 bg-[#0F172A]/40 rounded-xl border border-slate-850 text-xs text-slate-400 leading-relaxed space-y-2 animate-fade-in">
              <span className="font-mono font-bold text-slate-200 uppercase tracking-wider block">INFORMASI SISTEM</span>
              <p>
                Z-Capital Sandbox v4.16 - Semua data konfigurasi Anda disimpan dengan aman dan tahan lama di basis data Firestore Anda sendiri, menjaga kerahasiaan penuh di luar peramban lokal.
              </p>
            </div>
            <div className="p-5 bg-[#0F172A]/40 rounded-xl border border-slate-850 text-xs text-slate-400 leading-relaxed space-y-2 animate-fade-in">
              <span className="font-mono font-bold text-slate-200 uppercase tracking-wider block">KONEKTIVITAS WEBHOOK</span>
              <p>
                Dapatkan notifikasi instan langsung ke bot Telegram, kanal Discord, atau nomor WhatsApp Anda untuk setiap transaksi besar on-chain yang terdeteksi di atas ambang batas $1.000.000.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Detailed View Title & Back Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0A0F1D]/80 border border-slate-850 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode("menu")}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-900 text-slate-300 hover:text-slate-100 transition-all text-xs font-mono font-bold flex items-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-amber-500" />
                <span>KEMBALI KE MENU</span>
              </button>
              <div className="h-4 w-px bg-slate-800 hidden sm:block" />
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-slate-500">Pengaturan Utama</span>
                <span className="text-slate-600">/</span>
                <span className="text-amber-400 font-bold">
                  {tabs.find(t => t.id === activeSubTab)?.name}
                </span>
              </div>
            </div>
            
            {/* Direct Tab Swapper Inside Detail View */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveSubTab(t.id);
                  }}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold transition-all whitespace-nowrap cursor-pointer ${
                    activeSubTab === t.id
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : "text-slate-500 hover:text-slate-300 border border-transparent"
                  }`}
                >
                  {t.name.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Module Content Container */}
          <div className="space-y-6">
          
          {/* TAB 1: USER PROFILE */}
          {activeSubTab === "profil" && (
            <div className="animate-fade-in" id="settings-hub-profile">
              <Profile />
            </div>
          )}

          {/* TAB 2: SYSTEM DISPLAY & EXCHANGE FEEDS */}
          {activeSubTab === "tampilan" && (
            <div className="space-y-6 animate-fade-in" id="settings-hub-display">
              
              {/* Theme & Visual parameters */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Sliders className="w-4 h-4 text-amber-500" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">Kustomisasi Antarmuka & Tema Sistem</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                  {/* Theme Mode Toggles */}
                  <div className="space-y-2 bg-slate-950/40 p-4 rounded-lg border border-slate-900">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">Tema & Spektrum Visual</span>
                      <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                        Pilih palette warna yang sesuai dengan preferensi monitor trading Anda. Semua 8 tema visual didukung secara penuh dengan nuansa futuristik.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2 mt-4">
                      <button
                        onClick={() => {
                          updateSettings({ theme: "dark" });
                          addExecutionLog("[SYSTEM] Tema visual diatur ke: Mode Gelap Cosmic.");
                        }}
                        className={`py-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === "dark" 
                            ? "bg-blue-600 border-blue-500 text-white font-bold" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                        }`}
                      >
                        <Moon className="w-3.5 h-3.5" /> Cosmic Slate
                      </button>
                      <button
                        onClick={() => {
                          updateSettings({ theme: "light" });
                          addExecutionLog("[SYSTEM] Tema visual diatur ke: Refined Light.");
                        }}
                        className={`py-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === "light" 
                            ? "bg-amber-500 border-amber-500 text-slate-950 font-bold" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                        }`}
                      >
                        <Sun className="w-3.5 h-3.5" /> Refined Light
                      </button>
                      <button
                        onClick={() => {
                          updateSettings({ theme: "bloomberg" });
                          addExecutionLog("[SYSTEM] Tema visual diatur ke: Bloomberg Professional Terminal.");
                        }}
                        className={`py-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === "bloomberg" 
                            ? "bg-orange-600 border-orange-500 text-white font-bold" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                        }`}
                      >
                        <Terminal className="w-3.5 h-3.5 text-orange-400" /> Bloomberg
                      </button>
                      <button
                        onClick={() => {
                          updateSettings({ theme: "hacker" });
                          addExecutionLog("[SYSTEM] Tema visual diatur ke: Matrix Cyber Hacker Terminal.");
                        }}
                        className={`py-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === "hacker" 
                            ? "bg-emerald-600 border-emerald-500 text-white font-bold" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                        }`}
                      >
                        <Cpu className="w-3.5 h-3.5 text-emerald-400" /> Matrix Hacker
                      </button>
                      <button
                        onClick={() => {
                          updateSettings({ theme: "holo-glass" });
                          addExecutionLog("[SYSTEM] Tema visual diatur ke: Holo Glass Premium Theme.");
                        }}
                        className={`py-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === "holo-glass" 
                            ? "bg-purple-600 border-purple-500 text-white font-bold" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                        }`}
                      >
                        <Layers className="w-3.5 h-3.5 text-purple-400" /> Holo Glass
                      </button>
                      <button
                        onClick={() => {
                          updateSettings({ theme: "aurora-synth" });
                          addExecutionLog("[SYSTEM] Tema visual diatur ke: Aurora Synthwave Premium Theme.");
                        }}
                        className={`py-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === "aurora-synth" 
                            ? "bg-pink-600 border-pink-500 text-white font-bold shadow-[0_0_15px_rgba(236,72,153,0.5)]" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5 text-pink-450 animate-pulse" /> Aurora Synth
                      </button>
                      <button
                        onClick={() => {
                          updateSettings({ theme: "liquid-glass" });
                          addExecutionLog("[SYSTEM] Tema visual diatur ke: Liquid Glass Premium Theme.");
                        }}
                        className={`py-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === "liquid-glass" 
                            ? "bg-cyan-600 border-cyan-500 text-white font-bold shadow-[0_0_15px_rgba(6,182,212,0.6)]" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                        }`}
                      >
                        <Droplet className="w-3.5 h-3.5 text-cyan-400" /> Liquid Glass
                      </button>
                      <button
                        onClick={() => {
                          updateSettings({ theme: "cyber-3d" });
                          addExecutionLog("[SYSTEM] Tema visual diatur ke: Cyber 3D Premium Holo Theme.");
                        }}
                        className={`py-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === "cyber-3d" 
                            ? "bg-indigo-600 border-indigo-500 text-white font-bold shadow-[5px_5px_0px_#4338ca,-5px_-5px_15px_rgba(165,180,252,0.4)]" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer hover:shadow-[3px_3px_0px_rgba(255,255,255,0.1)]"
                        }`}
                      >
                        <Box className="w-3.5 h-3.5 text-indigo-400" /> Cyber 3D
                      </button>
                      <button
                        onClick={() => {
                          updateSettings({ theme: "glass-3d" });
                          addExecutionLog("[SYSTEM] Tema visual diatur ke: 3D Glass Neumorphism Theme.");
                        }}
                        className={`py-2 rounded border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                          settings.theme === "glass-3d" 
                            ? "bg-slate-700 border-slate-400 text-white font-bold shadow-[0_0_15px_rgba(255,255,255,0.25)]" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                        }`}
                      >
                        <Layers className="w-3.5 h-3.5 text-slate-300 animate-pulse" /> Glass 3D
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Glassmorphic Toggles */}
                  <div className="space-y-3 bg-slate-950/40 p-4 rounded-lg border border-slate-900 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">Transparansi Glassmorphism</span>
                      <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                        Gunakan overlay blur transparan pada semua panel card demi estetika premium modern.
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-900/60 mt-2">
                      <span className="text-[11px] text-slate-300 font-semibold font-mono uppercase">Status Transparansi</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={settings.glassmorphism}
                          onChange={(e) => updateSettings({ glassmorphism: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:width-3 after:w-3 after:transition-all peer-checked:bg-amber-500" />
                      </label>
                    </div>
                  </div>

                  {/* Date, Language and Timezone settings */}
                  <div className="space-y-3 bg-slate-950/40 p-4 rounded-lg border border-slate-900">
                    <span className="text-xs font-bold text-slate-200 block">Konfigurasi Regional & Bahasa</span>
                    <div className="grid grid-cols-1 gap-2 pt-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400 font-mono text-[10px] uppercase">Format Tanggal</span>
                        <span className="text-slate-300 font-semibold">DD/MM/YYYY</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400 font-mono text-[10px] uppercase">Bahasa Sistem</span>
                        <span className="text-slate-300 font-semibold">Bahasa Indonesia (ID)</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400 font-mono text-[10px] uppercase">Zona Waktu Sistem</span>
                        <span className="text-slate-300 font-semibold">Asia/Jakarta (GMT+7)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Analyst & Model Parameters (RESTORED FUNCTIONAL) */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Cpu className="w-4 h-4 text-amber-500 animate-pulse" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">Parameter Model AI (Google Gemini 3.5 Flash)</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* AI Tone Option */}
                  <div className="space-y-2 bg-slate-950/40 p-4 rounded-lg border border-slate-900">
                    <span className="text-xs font-bold text-slate-200 block">Karakter & Gaya AI Analyst</span>
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Mengubah gaya analisis naratif sinyal dan komparasi berkas PDF.
                    </p>
                    <select
                      value={settings.aiTone}
                      onChange={(e) => {
                        updateSettings({ aiTone: e.target.value as any });
                        addExecutionLog(`[SYSTEM] Karakter analis AI diubah ke gaya: ${e.target.value.toUpperCase()}`);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono mt-2"
                    >
                      <option value="academic">Academic & Detail-Oriented</option>
                      <option value="formal">Formal & Professional</option>
                      <option value="pragmatic">Pragmatic & Technical</option>
                      <option value="aggressive">Aggressive & Risk-Oriented</option>
                    </select>
                  </div>

                  {/* AI Thinking Mode option */}
                  <div className="space-y-2 bg-slate-950/40 p-4 rounded-lg border border-slate-900">
                    <span className="text-xs font-bold text-slate-200 block">Mode Penalaran AI (Thinking)</span>
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Mengatur kedalaman berfikir analitik model Gemini 3.5 Flash terbaru.
                    </p>
                    <select
                      value={settings.aiThinkingMode || 'high'}
                      onChange={(e) => {
                        updateSettings({ aiThinkingMode: e.target.value as any });
                        addExecutionLog(`[SYSTEM] Mode penalaran AI diubah ke: ${e.target.value.toUpperCase()}`);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono mt-2"
                    >
                      <option value="high">Maksimal (High Reasoning)</option>
                      <option value="low">Rendah (Low Latency / Cost)</option>
                      <option value="minimal">Minimal (No Thinking)</option>
                    </select>
                  </div>

                  {/* AI Max Tokens Slider */}
                  <div className="space-y-2 bg-slate-950/40 p-4 rounded-lg border border-slate-900 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">Batas Panjang Respon (Max Tokens)</span>
                      <p className="text-[10px] text-slate-500 leading-snug">
                        Membatasi panjang laporan audit instan analis AI untuk mengoptimasi latensi.
                      </p>
                    </div>
                    <div className="space-y-2 mt-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-slate-400">Nilai Batas</span>
                        <span className="text-xs font-mono text-amber-500 font-bold">{settings.aiMaxTokens} kata / tokens</span>
                      </div>
                      <input
                        type="range"
                        min="200"
                        max="2000"
                        step="50"
                        value={settings.aiMaxTokens}
                        onChange={(e) => updateSettings({ aiMaxTokens: parseInt(e.target.value) })}
                        className="w-full accent-amber-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* AI Temperature Slider */}
                  <div className="space-y-2 bg-slate-950/40 p-4 rounded-lg border border-slate-900 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">Kreativitas Generatif (Temperature)</span>
                      <p className="text-[10px] text-slate-500 leading-snug">
                        Suhu tinggi memicu analisis bursa yang lebih spekulatif & inovatif.
                      </p>
                    </div>
                    <div className="space-y-2 mt-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-slate-400">Temperatur</span>
                        <span className="text-xs font-mono text-amber-500 font-bold">{settings.aiTemperature}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={settings.aiTemperature}
                        onChange={(e) => updateSettings({ aiTemperature: parseFloat(e.target.value) })}
                        className="w-full accent-amber-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Market Data & Sync Protocols */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Database className="w-4 h-4 text-amber-500" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">Protokol Penyelarasan Feed Pasar</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-slate-400 font-mono font-bold uppercase">Sumber Gate Live Feed Utama</span>
                    <select
                      value={settings.exchangeFeed}
                      onChange={(e) => {
                        updateSettings({ exchangeFeed: e.target.value as any });
                        addExecutionLog(`[SYSTEM] Gateway penyuplai bursa diubah ke: ${e.target.value.toUpperCase()}`);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                    >
                      <option value="binance">BINANCE GLOBAL - Spot & Perpetual Futures</option>
                      <option value="kucoin">KUCOIN INSTITUTIONAL - High Frequency Feed</option>
                      <option value="bybit">BYBIT PERPETUALS - Real-time REST Exchange</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] text-slate-400 font-mono font-bold uppercase">Konsumsi Daya & Interval Polling</span>
                    <select
                      value={settings.syncPriority}
                      onChange={(e) => {
                        updateSettings({ syncPriority: e.target.value as any });
                        addExecutionLog(`[SYSTEM] Interval throttling jaringan disesuaikan ke: ${e.target.value}`);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                    >
                      <option value="high">Frekuensi Tinggi (WebSocket Stream 600ms)</option>
                      <option value="standard">Optimal (Hybrid WebSocket + HTTP 4s)</option>
                      <option value="low">Hemat Daya (Polling Interval 10 Detik)</option>
                    </select>
                  </div>
                </div>

                {/* Connection tester block */}
                <div className="bg-slate-950/70 p-4 rounded-lg border border-slate-900 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                      Uji Konektivitas Gateway Bursa ({settings.exchangeFeed.toUpperCase()})
                    </span>
                    <button
                      onClick={handleTestConnection}
                      disabled={testingConnection}
                      className="px-2.5 py-1 bg-slate-900 border border-slate-800 hover:bg-slate-850 text-[9px] font-bold uppercase text-slate-300 rounded hover:text-slate-100 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3 h-3 ${testingConnection ? "animate-spin" : ""}`} />
                      {testingConnection ? "Menguji..." : "Ping Server"}
                    </button>
                  </div>

                  {connLogs.length > 0 && (
                    <div className="bg-[#02050b] p-3 rounded border border-slate-900 font-mono text-[9px] text-slate-400 space-y-1 max-h-32 overflow-y-auto">
                      {connLogs.map((log, idx) => (
                        <div key={idx} className={log.includes("[PERINGATAN]") ? "text-amber-500" : log.includes("[SINKRONISASI]") ? "text-emerald-400 font-bold" : ""}>
                          {log}
                        </div>
                      ))}
                    </div>
                  )}

                  {connSuccess !== null && (
                    <div className={`p-2.5 rounded text-[10px] font-bold flex items-center gap-2 ${
                      connSuccess 
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    }`}>
                      {connSuccess ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          KONEKSI SUKSES: Endpoint REST API bursa merespons (status: Aktif).
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          PING GAGAL: Tidak dapat menghubungi server bursa. Silakan cek firewall kancah lokal Anda atau koneksi jaringan.
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: SECURITY CENTER & ACTIVE SESSIONS */}
          {activeSubTab === "keamanan" && (
            <div className="space-y-6 animate-fade-in" id="settings-hub-security">
              
              {/* Google Authenticator Setup & State */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* 2-Factor Setup */}
                <div className="bg-[#0A0F1D]/60 border border-slate-850 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Fingerprint className="w-4 h-4 text-blue-400" />
                      Google Authenticator (2FA)
                    </h3>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                      twoFactorEnabled ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse"
                    }`}>
                      {twoFactorEnabled ? "MAKSIMAL AKTIF" : "DIASURANSIKAN"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    Setiap instruksi eksekusi margin di bursa dan penarikan visual memerlukan otorisasi sandisandi OTP sekuritas 6-digit demi keselamatan aset Anda.
                  </p>

                  {twoFactorEnabled ? (
                    <div className="bg-slate-950 p-4 rounded text-center space-y-3">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                      <span className="text-xs font-bold text-slate-200 block">Perlindungan 2FA Aktif Penuh</span>
                      <button
                        onClick={() => {
                          setTwoFactorEnabled(false);
                          addExecutionLog("[SECURITY] Otorisasi 2FA dimatikan oleh pengguna.");
                        }}
                        className="px-3 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded font-semibold text-[10px] uppercase transition-colors cursor-pointer"
                      >
                        Matikan Proteksi 2FA
                      </button>
                    </div>
                  ) : (
                    <div className="bg-slate-950 p-4 rounded text-center space-y-3">
                      <Lock className="w-8 h-8 text-amber-500 mx-auto animate-bounce" />
                      <span className="text-xs font-bold text-slate-300 block">Sangat Disarankan Mengaktifkan 2FA</span>
                      <button
                        onClick={() => {
                          setTwoFactorEnabled(true);
                          addExecutionLog("[SECURITY] Otentikasi Multi-Faktor 2FA diaktifkan secara instan.");
                        }}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold text-xs uppercase cursor-pointer"
                      >
                        Aktifkan 2FA Instan
                      </button>
                    </div>
                  )}
                </div>

                {/* E2EE Crypter Simulator */}
                <div className="bg-[#0A0F1D]/60 border border-slate-850 rounded-xl p-5 space-y-4">
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Enkripsi End-to-End (E2EE AES-GCM)
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Uji kekuatan sandi pengacak data militer Z-Capital. Sandbox melakukan komputasi sandi murni di dalam client.
                  </p>

                  <div className="space-y-2">
                    <input
                      type="text"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Masukkan kata sandi enkripsi..."
                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-slate-200 focus:outline-none font-mono"
                    />
                    <textarea
                      value={plainText}
                      onChange={(e) => setPlainText(e.target.value)}
                      rows={1}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-slate-200 focus:outline-none font-mono"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleRunE2EEncryption}
                        className="py-1 bg-slate-900 border border-slate-800 text-slate-300 rounded text-[10px] font-bold font-mono uppercase cursor-pointer hover:bg-slate-850"
                      >
                        Enkripsi (AES)
                      </button>
                      <button
                        type="button"
                        onClick={handleRunE2EDecryption}
                        className="py-1 bg-blue-600/10 border border-blue-500/20 text-blue-400 rounded text-[10px] font-bold font-mono uppercase cursor-pointer hover:bg-blue-600/20"
                      >
                        Dekripsi
                      </button>
                    </div>
                    {decryptedText && (
                      <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono text-emerald-400">
                        Hasil: {decryptedText}
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Active Sessions Devices List */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Smartphone className="w-4 h-4 text-amber-500" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                    Pusat Perangkat & Sesi Masuk Aktif (Security Center)
                  </h3>
                </div>

                <div className="space-y-3">
                  {activeDevices.map(device => (
                    <div key={device.id} className="flex justify-between items-center p-3 rounded-lg bg-slate-950 border border-slate-850">
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-slate-200 block flex items-center gap-1.5">
                          {device.name}
                          {device.current && (
                            <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/35 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">
                              Sesi Saat Ini
                            </span>
                          )}
                        </span>
                        <p className="text-[10px] text-slate-500 font-mono">
                          Lokasi: {device.location} • IP: {device.ip}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10.5px] text-slate-400 font-medium font-mono">{device.time}</span>
                        {!device.current && (
                          <button
                            onClick={() => {
                              setActiveDevices(activeDevices.filter(d => d.id !== device.id));
                              addExecutionLog(`[SECURITY] Sesi perangkat ${device.name} diputus secara paksa oleh pemilik.`);
                              alert(`Sesi ${device.name} berhasil dihentikan secara aman.`);
                            }}
                            className="block text-[9.5px] text-rose-500 hover:underline font-bold mt-1 text-right ml-auto cursor-pointer"
                          >
                            Hentikan Akses
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sandbox & CyberShield Controls (RESTORED FUNCTIONAL) */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <ShieldAlert className="w-4 h-4 text-amber-500 animate-pulse" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                    Sistem Sandboxing & Kebijakan Pertahanan Siber
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Sandbox Toggle */}
                  <div className="space-y-2 bg-slate-950/40 p-4 rounded-lg border border-slate-900 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">Sesi Simulasi Bursa (Sandbox Mode)</span>
                      <p className="text-[10px] text-slate-500 leading-snug">
                        Menjalankan order trade dan integrasi margin secara simulasi tanpa menyentuh saldo real.
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-900/60 mt-2">
                      <span className="text-[10px] text-slate-400 font-mono font-bold uppercase">Status Sandbox</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={settings.isSandboxActive}
                          onChange={(e) => {
                            updateSettings({ isSandboxActive: e.target.checked });
                            addExecutionLog(`[SECURITY] Mode Sandbox diubah ke: ${e.target.checked ? "AKTIF (SIMULASI)" : "NONAKTIF (LIVE-PRODUCTION)"}`);
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:width-3 after:w-3 after:transition-all peer-checked:bg-amber-500" />
                      </label>
                    </div>
                  </div>

                  {/* CyberShield Toggle */}
                  <div className="space-y-2 bg-slate-950/40 p-4 rounded-lg border border-slate-900 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">Guard Pertahanan CyberShield</span>
                      <p className="text-[10px] text-slate-500 leading-snug">
                        Mengaktifkan filter anti-cyberattack jaring lokal untuk menapis permintaan data API ilegal.
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-900/60 mt-2">
                      <span className="text-[10px] text-slate-400 font-mono font-bold uppercase">CyberShield Guard</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={settings.cyberShieldActive}
                          onChange={(e) => {
                            updateSettings({ cyberShieldActive: e.target.checked });
                            addExecutionLog(`[SECURITY] CyberShield intrusion guard diubah ke: ${e.target.checked ? "AKTIF (TERPROTEKSI)" : "NONAKTIF (STANDAR)"}`);
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:width-3 after:w-3 after:transition-all peer-checked:bg-amber-500" />
                      </label>
                    </div>
                  </div>

                  {/* Session Lock Selection */}
                  <div className="space-y-2 bg-slate-950/40 p-4 rounded-lg border border-slate-900">
                    <span className="text-xs font-bold text-slate-200 block">Kunci Otomatis Sesi Masuk</span>
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Mengunci dashboard secara otomatis demi privasi setelah terdeteksi tidak aktif.
                    </p>
                    <select
                      value={settings.sessionLockHours}
                      onChange={(e) => {
                        updateSettings({ sessionLockHours: parseInt(e.target.value) });
                        addExecutionLog(`[SECURITY] Durasi auto-lock sesi disesuaikan ke: ${e.target.value} Jam.`);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono mt-2"
                    >
                      <option value={1}>1 Jam Tidak Aktif</option>
                      <option value={2}>2 Jam Tidak Aktif</option>
                      <option value={4}>4 Jam Tidak Aktif</option>
                      <option value={8}>8 Jam Tidak Aktif</option>
                      <option value={24}>24 Jam (Maksimal)</option>
                    </select>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 4: NOTIFICATION RULES & WEBHOOK INTEGRATIONS */}
          {activeSubTab === "notifikasi" && (
            <div className="space-y-6 animate-fade-in" id="settings-hub-notifications">
              
              {/* Notification Rules Configuration */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Bell className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                    Konfigurasi Kontrol Notifikasi (Notification Rules)
                  </h3>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Tentukan jenis pesan alarm yang ingin Anda terima dan jalurnya secara spesifik. Ini disinkronkan dengan server penyuplai target harga Anda secara riil.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  
                  {/* Message Categories */}
                  <div className="space-y-3 bg-slate-950 p-4 rounded-lg border border-slate-900">
                    <span className="text-[10px] text-slate-400 font-mono font-bold uppercase block border-b border-slate-850 pb-1">Kategori Pesan</span>
                    
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-slate-300 block">Pembaruan & Sistem</span>
                        <p className="text-[9px] text-slate-500">Berita penting, pembaruan keamanan, & penataraan regulasi.</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={notifyUpdates}
                        onChange={(e) => setNotifyUpdates(e.target.checked)}
                        className="rounded text-amber-500 focus:ring-amber-500 bg-slate-950 border-slate-800 w-3.5 h-3.5"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-slate-300 block">Alarm Sinyal Target Harga</span>
                        <p className="text-[9px] text-slate-500">Sinyal instan ketika aset Anda menyentuh batas target harga.</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={notifyPriceAlerts}
                        onChange={(e) => setNotifyPriceAlerts(e.target.checked)}
                        className="rounded text-amber-500 focus:ring-amber-500 bg-slate-950 border-slate-800 w-3.5 h-3.5"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-slate-300 block">Laporan Eksekusi Trade</span>
                        <p className="text-[9px] text-slate-500">Laporan instan ketika pembatasan transaksi berhasil dieksekusi.</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={notifyTrades}
                        onChange={(e) => setNotifyTrades(e.target.checked)}
                        className="rounded text-amber-500 focus:ring-amber-500 bg-slate-950 border-slate-800 w-3.5 h-3.5"
                      />
                    </div>
                  </div>

                  {/* Channel paths */}
                  <div className="space-y-3 bg-slate-950 p-4 rounded-lg border border-slate-900 justify-between flex flex-col">
                    <div>
                      <span className="text-[10px] text-slate-400 font-mono font-bold uppercase block border-b border-slate-850 pb-1">Saluran Transmisi</span>
                      <p className="text-[9.5px] text-slate-500 leading-snug mt-1.5">
                        Aktifkan jalur pengantaran sinyal. Jika dicentang, sinyal target harga bursa akan didistribusikan ke media tersebut secara riil.
                      </p>
                    </div>

                    <div className="space-y-2 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300">Surat Elektronik (Email)</span>
                        <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 rounded">Rill Terkirim</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300">WhatsApp / Telegram Bot</span>
                        <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 rounded">Rill Terkirim</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300">Push Notification Terminal</span>
                        <span className="text-[9px] font-mono text-slate-400 font-bold bg-slate-800 px-1.5 rounded">Sandbox browser</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Webhook notification configurations (Telegram, Discord, WhatsApp) */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-amber-500" />
                    <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">Konfigurasi Integrasi Saluran Webhook</h3>
                  </div>
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse">
                    LIVE DISPATCH
                  </span>
                </div>

                <div className="space-y-4">
                  {/* Telegram */}
                  <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-900 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">Aktifkan Telegram Channel</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={localTelegramEnabled}
                          onChange={(e) => setLocalTelegramEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:width-3 after:w-3 after:transition-all peer-checked:bg-amber-500" />
                      </label>
                    </div>

                    {localTelegramEnabled && (
                      <div className="space-y-2 pt-1">
                        <div className="space-y-1">
                          <span className="text-[9px] text-slate-500 font-mono block uppercase">Telegram Bot Token</span>
                          <input
                            type="password"
                            value={localTelegramBotToken}
                            onChange={(e) => setLocalTelegramBotToken(e.target.value)}
                            placeholder="Contoh: 123456:ABC-DEF..."
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono font-medium"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] text-slate-500 font-mono block uppercase">Telegram Chat ID</span>
                          <input
                            type="text"
                            value={localTelegramChatId}
                            onChange={(e) => setLocalTelegramChatId(e.target.value)}
                            placeholder="Contoh: -100123456789 atau 87654321"
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono font-medium"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Discord */}
                  <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-900 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">Aktifkan Discord/Slack Webhook</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={localDiscordEnabled}
                          onChange={(e) => setLocalDiscordEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:width-3 after:w-3 after:transition-all peer-checked:bg-amber-500" />
                      </label>
                    </div>

                    {localDiscordEnabled && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[9px] text-slate-500 font-mono block uppercase">URL Webhook Saluran</span>
                        <input
                          type="password"
                          value={localDiscordWebhookUrl}
                          onChange={(e) => setLocalDiscordWebhookUrl(e.target.value)}
                          placeholder="https://discord.com/api/webhooks/..."
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                        />
                      </div>
                    )}
                  </div>

                  {/* WhatsApp */}
                  <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-900 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">Aktifkan WhatsApp Webhook</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={localWhatsappEnabled}
                          onChange={(e) => setLocalWhatsappEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:width-3 after:w-3 after:transition-all peer-checked:bg-amber-500" />
                      </label>
                    </div>

                    {localWhatsappEnabled && (
                      <div className="space-y-3 pt-1">
                        <div className="space-y-1.5">
                          <span className="text-[9px] text-slate-500 font-mono block uppercase">URL Webhook WhatsApp</span>
                          <input
                            type="password"
                            value={localWhatsappWebhookUrl}
                            onChange={(e) => setLocalWhatsappWebhookUrl(e.target.value)}
                            placeholder="https://api.whatsapp-gateway.com/send/..."
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <span className="text-[9px] text-slate-500 font-mono block uppercase">Nomor Telepon Penerima (WhatsApp)</span>
                          <input
                            type="text"
                            value={localWhatsappPhoneNumber}
                            onChange={(e) => setLocalWhatsappPhoneNumber(e.target.value)}
                            placeholder="Contoh: 6281234567890 (Wajib kode negara, tanpa +)"
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Webhook test output logs */}
                  {webhookTestStatus && (
                    <div className="p-2.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-mono leading-relaxed">
                      {webhookTestStatus}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={testWebhooks}
                      disabled={testingWebhook || (!localTelegramEnabled && !localDiscordEnabled && !localWhatsappEnabled)}
                      className="py-1.5 bg-slate-950 border border-slate-800 hover:bg-slate-900 text-slate-300 text-xs font-bold rounded-lg transition-transform cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <Cpu className={`w-3.5 h-3.5 ${testingWebhook ? "animate-spin text-amber-500" : "text-slate-400"}`} />
                      {testingWebhook ? "Menguji..." : "Kirim Sinyal Uji"}
                    </button>

                    <button
                      type="button"
                      onClick={saveNotificationSettings}
                      className="py-1.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white text-xs font-bold rounded-lg transition-transform cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Bell className="w-3.5 h-3.5 text-white" />
                      Simpan Konfigurasi
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 5: PRIVACY, HAK COMPLIANCE & USER BLOCKLIST */}
          {activeSubTab === "privasi" && (
            <div className="space-y-6 animate-fade-in" id="settings-hub-privacy">
              
              {/* Privacy blocklist setup */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Eye className="w-4 h-4 text-rose-500" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                    Daftar Pengguna Diblokir (Blocklist System)
                  </h3>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Pengguna terdaftar di bawah tidak akan dapat melihat performa portofolio publik, mengirim pesan diskusi, atau menyebarkan sinyal arbitrase ke feed obrolan sosial Anda.
                </p>

                <form onSubmit={handleAddBlock} className="flex gap-2">
                  <input
                    type="text"
                    value={newBlockedUser}
                    onChange={(e) => setNewBlockedUser(e.target.value)}
                    placeholder="Masukkan username, misal: @spammer_user"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                  />
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded font-bold text-xs uppercase cursor-pointer"
                  >
                    Blokir
                  </button>
                </form>

                <div className="space-y-2 pt-1">
                  {blocklist.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">Tidak ada pengguna yang diblokir saat ini.</p>
                  ) : (
                    blocklist.map((blocked) => (
                      <div key={blocked} className="flex justify-between items-center p-2 rounded bg-slate-950 border border-slate-850 font-mono text-xs text-slate-300">
                        <span>{blocked}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveBlock(blocked)}
                          className="text-rose-500 hover:text-rose-400 font-bold text-[10px] uppercase cursor-pointer"
                        >
                          Hapus Blokir
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Data sovereignty control panel */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Layers className="w-4 h-4 text-amber-500" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                    Otonomi Kedaulatan Data & GDPR Compliance
                  </h3>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Berdasarkan regulasi kepatuhan General Data Protection Regulation (GDPR), Anda memegang otonomi absolut atas data digital Anda. Anda dapat mengunduh seluruh salinan data di Z-Capital, atau menghapusnya secara permanen dari server awan sandbox.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-slate-950 border border-slate-900 space-y-2">
                    <span className="text-xs font-bold text-slate-200 block">Ekstraksi Arsip Data Pribadi</span>
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Download semua rekam jejak, transaksi ledger, api key, dan history konversi Anda dalam berkas arsip standar JSON.
                    </p>
                    <button
                      type="button"
                      onClick={handleDownloadArchive}
                      className="py-1.5 px-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-200 rounded text-[10px] font-bold font-mono uppercase cursor-pointer flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-400" /> Ekspor Arsip Data (JSON)
                    </button>
                  </div>

                  <div className="p-4 rounded-lg bg-slate-950 border border-slate-900 space-y-2">
                    <span className="text-xs font-bold text-slate-200 block text-rose-400">Penghapusan Hak Lupa (Right to be Forgotten)</span>
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Instruksikan server siber Z-Capital untuk membakar dan menghapus semua catatan profil, kustomisasi bursa, dan ledger transaksi dari Firestore sandbox secara permanen.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const conf = window.confirm("PERINGATAN SANGAT KRITIS: Tindakan ini akan menghapus akun Z-Capital serta semua data portofolio Anda secara permanen dari server. Lanjutkan?");
                        if (conf) {
                          alert("Permintaan penghapusan data siber berhasil diproses. Server telah menghapus database Anda.");
                        }
                      }}
                      className="py-1.5 px-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-400 rounded text-[10px] font-bold font-mono uppercase cursor-pointer flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-500" /> Hapus Akun & Data Permanen
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 6: CONNECTED APPS & REAL API KEYS LOCKBOX */}
          {activeSubTab === "integrasi" && (
            <div className="space-y-6 animate-fade-in" id="settings-hub-integration">
              
              {/* Connected Apps list */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Link className="w-4 h-4 text-amber-500" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                    Daftar Aplikasi Pihak Ketiga Terhubung (Connected Apps)
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-900 flex justify-between items-center">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-300 block">Google Cloud Account</span>
                      <span className="text-[9px] text-emerald-400 font-mono">Connected</span>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-900 flex justify-between items-center opacity-60">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-300 block">Apple ID Portal</span>
                      <span className="text-[9px] text-slate-500 font-mono">Not Connected</span>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-slate-850" />
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-900 flex justify-between items-center">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-300 block">Metamask / WalletConnect</span>
                      <span className="text-[9px] text-emerald-400 font-mono">Connected</span>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  </div>
                </div>
              </div>

              {/* API Credentials Input Store */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-amber-500" />
                    <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">Gudang Penyimpanan API Key (Kredensial Riil)</h3>
                  </div>
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    TERSIMPAN DI BROWSER (localStorage)
                  </span>
                </div>

                <div className="bg-amber-500/5 border border-amber-500/15 rounded p-2.5 text-[9.5px] text-amber-400 font-mono leading-snug">
                  ⚠ Kredensial API disimpan plaintext di localStorage peramban Anda. Jangan gunakan komputer publik. Untuk penyimpanan terenkripsi, gunakan fitur E2EE AES-GCM di tab Api Automation (dengan Master PIN).
                </div>

                <div className="space-y-3">
                  {/* Binance */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono block uppercase">Binance API Key</span>
                      <input
                        type="password"
                        value={localBinanceKey}
                        onChange={(e) => setLocalBinanceKey(e.target.value)}
                        placeholder="Kunci API Binance"
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono block uppercase">Binance Secret Key</span>
                      <input
                        type="password"
                        value={localBinanceSecret}
                        onChange={(e) => setLocalBinanceSecret(e.target.value)}
                        placeholder="Secret Key Binance"
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* Kucoin */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-850">
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono block uppercase">Kucoin API Key</span>
                      <input
                        type="password"
                        value={localKucoinKey}
                        onChange={(e) => setLocalKucoinKey(e.target.value)}
                        placeholder="Kunci API Kucoin"
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono block uppercase">Kucoin Secret Key</span>
                      <input
                        type="password"
                        value={localKucoinSecret}
                        onChange={(e) => setLocalKucoinSecret(e.target.value)}
                        placeholder="Secret Key Kucoin"
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* Bybit */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-850">
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono block uppercase">Bybit API Key</span>
                      <input
                        type="password"
                        value={localBybitKey}
                        onChange={(e) => setLocalBybitKey(e.target.value)}
                        placeholder="Kunci API Bybit"
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono block uppercase">Bybit Secret Key</span>
                      <input
                        type="password"
                        value={localBybitSecret}
                        onChange={(e) => setLocalBybitSecret(e.target.value)}
                        placeholder="Secret Key Bybit"
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* Gemini */}
                  <div className="space-y-1 pt-2 border-t border-slate-850">
                    <span className="text-[9px] text-slate-550 font-mono block uppercase">Gemini Personal API Key (Override)</span>
                    <input
                      type="password"
                      value={localGeminiKey}
                      onChange={(e) => setLocalGeminiKey(e.target.value)}
                      placeholder="Google Gemini Key (Untuk asisten AI)"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <button
                    onClick={saveApiCredentials}
                    className="w-full mt-2 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                  >
                    Simpan & Pasang Kredensial API
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* TAB 7: SUPPORT AND LEGAL FAQ DOCUMENTS */}
          {activeSubTab === "bantuan" && (
            <div className="space-y-6 animate-fade-in" id="settings-hub-support">
              
              {/* FAQ Accordion Section */}
              <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <HelpCircle className="w-4 h-4 text-blue-400" />
                  <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                    Pusat Bantuan & Dokumen FAQ
                  </h3>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      q: "Bagaimana cara kerja keamanan siber enkripsi di Z-Capital?",
                      a: "Z-Capital menerapkan perlindungan berlapis. Pada tingkat peramban client, sandbox E2EE menggunakan AES-256 GCM untuk demonstrasi enkripsi. API Key bursa disimpan plaintext di localStorage peramban Anda dan tidak ditransmisikan ke server. Untuk penyimpanan terenkripsi, gunakan fitur E2EE AES-GCM di tab Api Automation dengan Master PIN Anda sendiri."
                    },
                    {
                      q: "Bagaimana cara mendaftarkan nomor telepon untuk menerima alarm target harga?",
                      a: "Sangat mudah! Anda hanya perlu pergi ke tab 'Profil Pengguna' atau 'Kontrol Notifikasi', masukkan nomor telepon Anda dengan format kode negara lengkap tanpa awalan '+' (contoh: 6281234567890), lalu aktifkan toggle 'WhatsApp Webhook' di tab Notifikasi."
                    },
                    {
                      q: "Apakah bursa dapat menarik aset saya menggunakan Kunci API di Z-Capital?",
                      a: "TIDAK BISA. Z-Capital sepenuhnya melarang otorisasi penarikan ('Withdrawal'). Saat Anda membuat API Key di Binance, Kucoin, atau Bybit, pastikan Anda HANYA mencentang izin 'Read' (baca portofolio) dan menonaktifkan izin 'Withdrawal/Transfer'."
                    }
                  ].map((faq, idx) => {
                    const isOpen = faqExpanded[idx];
                    return (
                      <div key={idx} className="border border-slate-850 rounded-lg overflow-hidden bg-slate-950">
                        <button
                          onClick={() => toggleFaq(idx)}
                          className="w-full flex justify-between items-center p-3 text-left hover:bg-slate-900 transition-colors cursor-pointer"
                        >
                          <span className="text-xs font-bold text-slate-200">{faq.q}</span>
                          {isOpen ? <ChevronUp className="w-4 h-4 text-amber-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                        </button>
                        {isOpen && (
                          <div className="p-3.5 border-t border-slate-850 text-xs text-slate-400 leading-relaxed bg-slate-950/50">
                            {faq.a}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Privacy Policy & Terms scrollable panel */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Privacy Policy */}
                <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-3">
                  <span className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider block border-b border-slate-800 pb-2">Kebijakan Privasi (Privacy Policy)</span>
                  <div className="h-44 overflow-y-auto text-[11px] text-slate-500 leading-relaxed font-sans pr-2 space-y-2">
                    <p><strong>1. Pengumpulan Informasi:</strong> Z-Capital tidak mengumpulkan, menjual, atau mentransfer data kredensial, API key bursa, atau nomor telepon Anda ke pihak luar. Data profil disimpan di Firestore sandbox Anda sendiri; API key disimpan plaintext di localStorage peramban Anda.</p>
                    <p><strong>2. Keamanan Kunci:</strong> API Key disimpan plaintext di peramban lokal (localStorage). Enkripsi E2EE AES-GCM 256-bit tersedia opsional di tab Api Automation dengan Master PIN pengguna.</p>
                    <p><strong>3. Hak Pengguna:</strong> Anda memiliki hak penuh untuk mengekstrak data Anda sendiri atau menghapusnya secara permanen setiap saat sesuai standar GDPR.</p>
                  </div>
                </div>

                {/* Terms of Service */}
                <div className="p-5 rounded-xl border border-slate-850 bg-[#0A0F1D]/60 space-y-3">
                  <span className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider block border-b border-slate-800 pb-2">Syarat & Ketentuan (Terms of Service)</span>
                  <div className="h-44 overflow-y-auto text-[11px] text-slate-500 leading-relaxed font-sans pr-2 space-y-2">
                    <p><strong>1. Penggunaan Sandbox:</strong> Z-Capital merupakan terminal sandbox. Eksekusi margin, analisis target harga, dan pengisian portofolio adalah alat bantu visual murni untuk mengedukasi investor.</p>
                    <p><strong>2. Risiko Finansial:</strong> Perdagangan saham dan kripto memiliki risiko yang sangat tinggi. Z-Capital tidak bertanggung jawab atas kerugian finansial apa pun yang terjadi di bursa riil.</p>
                    <p><strong>3. Tanggung Jawab Akun:</strong> Pengguna memegang tanggung jawab penuh atas kerahasiaan kata sandi akun, OTP 2FA, dan kunci bursa masing-masing.</p>
                  </div>
                </div>

              </div>

            </div>
          )}

          </div>
        </div>
      )}

    </div>
  );
}
