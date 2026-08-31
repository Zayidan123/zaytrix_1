import React, { useState, useEffect } from "react";
import { useGlobalStore } from "../store";
import { sendAlertSecurely } from "../services/webhookService";
import {
  Cpu,
  Key,
  Terminal,
  RefreshCw,
  Zap,
  Lock,
  Eye,
  EyeOff,
  ShieldAlert,
  Server,
  Wifi,
  WifiOff,
  Send,
  MessageSquare
} from "lucide-react";

export default function ApiAutomation() {
  const [useSandbox, setUseSandbox] = useState(true);
  const [selectedExchange, setSelectedExchange] = useState("Binance");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [exchangePassphrase, setExchangePassphrase] = useState("");
  const [webHookUrl, setWebHookUrl] = useState("https://api.zaytrix.co/v1/webhook");

  // User-configurable trade parameters (previously hardcoded BTC 0.05).
  const [tradeSymbol, setTradeSymbol] = useState("BTC");
  const [tradeAmount, setTradeAmount] = useState("0.05");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  
  const [showSecretField, setShowSecretField] = useState(false);
  // FUNC-4: server-side encrypted key store (AES-256-GCM via /api/user/api-keys).
  // The old client-side "E2EE" localStorage flow was removed — it never fed
  // the trade executor (server only reads DB-stored keys), and its marketing
  // claims ("terenkripsi mutlak di browser") were false since keys were
  // decrypted in the browser and sent as plaintext JSON.
  const [storedKeys, setStoredKeys] = useState<Array<{ id: string; exchange: string; label: string; keyMasked: string; hasPassphrase: boolean; createdAt: string }>>([]);
  const [savingKeys, setSavingKeys] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  
  // Real-time API Key Reachability and Connection Status States
  const [connectionStatus, setConnectionStatus] = useState<"not_tested" | "checking" | "connected" | "failed">("not_tested");
  const [statusDetails, setStatusDetails] = useState<string>("");
  const [lastCheckLatency, setLastCheckLatency] = useState<number | null>(null);

  // Telegram Config & Testing States
  const notificationConfig = useGlobalStore(state => state.notificationConfig);
  const updateNotificationConfig = useGlobalStore(state => state.updateNotificationConfig);
  
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<string>("");

  const TestTelegramBot = async () => {
    const token = notificationConfig.telegramBotToken?.trim();
    const chatId = notificationConfig.telegramChatId?.trim();

    if (!token || !chatId) {
      setTelegramStatus("Gagal: Bot Token atau Chat ID belum dikonfigurasi.");
      setExecutionLogs(prev => [
        ...prev,
        "[!] TELEGRAM ERROR: Bot Token atau Chat ID kosong. Sila konfigurasikan terlebih dahulu."
      ]);
      return;
    }

    setTelegramLoading(true);
    setTelegramStatus("Mengirim pesan 'Hello World'...");
    setExecutionLogs(prev => [
      ...prev,
      `[PING] Mengirimkan pesan uji coba 'Hello World' ke Telegram Chat ID: ${chatId}...`
    ]);

    try {
      const data = await sendAlertSecurely({
        telegramEnabled: true,
        telegramBotToken: token,
        telegramChatId: chatId,
        discordEnabled: false,
        discordWebhookUrl: "",
        whatsappEnabled: false,
        whatsappWebhookUrl: "",
        whatsappPhoneNumber: "",
        messageText: "Hello World! Sinyal uji coba sukses terkirim dari Terminal Otomasi Z-Capital."
      });

      if (data.success && data.results?.telegram?.success) {
        setTelegramStatus("Sukses Terkirim!");
        setExecutionLogs(prev => [
          ...prev,
          "[STATUS] TELEGRAM SUCCESS: Pesan 'Hello World' berhasil tersalurkan oleh bot jabat tangan."
        ]);
      } else {
        const errorMsg = data.results?.telegram?.error || data.error || "Gagal mentransmisikan pesan.";
        setTelegramStatus(`Gagal: ${errorMsg}`);
        setExecutionLogs(prev => [
          ...prev,
          `[!] TELEGRAM ERROR: Gagal mengirim. Detail: ${errorMsg}`
        ]);
      }
    } catch (err: any) {
      console.error("TestTelegramBot network error:", err);
      const errText = err.message || String(err);
      setTelegramStatus(`Kesalahan Jaringan: ${errText}`);
      setExecutionLogs(prev => [
        ...prev,
        `[!] TELEGRAM NETWORK ERROR: Gagal menghubungi relay server. Detail: ${errText}`
      ]);
    } finally {
      setTelegramLoading(false);
    }
  };
  
  const [executionLogs, setExecutionLogs] = useState<string[]>([
    `[SYSTEM] Otentikasi Workspace Terintegrasi. Inisialisasi Terminal API Tanggal: ${new Date().toISOString()}`,
    "[SECURITY] API key bursa disimpan terenkripsi AES-256-GCM di server (ENCRYPTION_KEY) — hanya dipakai untuk menandatangani order Anda.",
    "[STATUS] Pemantauan Gateway Bursa: Menggunakan Mode Sandboxing Utama.",
    "[STATUS] Kunci tersimpan tampil ter-masked (••••) dan dapat dihapus kapan saja."
  ]);

  const appendLog = (line: string) => setExecutionLogs(prev => [...prev, line]);

  // FUNC-4: load the server-side encrypted key store (masked list) on mount
  // and whenever the selected exchange changes.
  const loadStoredKeys = async () => {
    try {
      const res = await fetch("/api/user/api-keys", { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && Array.isArray(data.keys)) {
        setStoredKeys(data.keys);
        const mine = data.keys.find((k: any) => k.exchange.toLowerCase() === selectedExchange.toLowerCase() && k.label === "default");
        if (mine) {
          appendLog(`[SECURITY] Kunci ${selectedExchange} (label "default", tampil ${mine.keyMasked}) ditemukan terenkripsi di server — order real AKTIF.`);
        }
      }
    } catch {
      // Non-fatal — key store unavailable; sandbox still works.
    }
  };

  useEffect(() => {
    // Reset connection status on configuration change for authentic real-time validation
    setConnectionStatus("not_tested");
    setStatusDetails("");
    setLastCheckLatency(null);
    loadStoredKeys();
  }, [selectedExchange, useSandbox]);

  // FUNC-4: save exchange keys to the SERVER-side encrypted store
  // (POST /api/user/api-keys with label "default" — this is what the trade
  // executor actually reads). Keys are AES-256-GCM encrypted server-side.
  const handleSaveKeysToServer = async () => {
    if (!apiKey || !apiSecret) {
      appendLog("[!] ERROR: Isikan API Key & Secret Key sebelum menyimpan ke vault server.");
      return;
    }
    setSavingKeys(true);
    appendLog(`[SECURITY] Mengenkripsi kunci ${selectedExchange} (AES-256-GCM) dan menyimpan ke vault server...`);
    try {
      const res = await fetch("/api/user/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          exchange: selectedExchange,
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          passphrase: exchangePassphrase.trim() || undefined,
          label: "default"
        })
      });
      const reply = await res.json().catch(() => null);
      if (res.ok && reply?.success) {
        appendLog(`[SECURITY] SUCCESS: Kunci ${selectedExchange} tersimpan terenkripsi di server (tampil: ${reply.key?.keyMasked || "••••"}). Order real kini AKTIF.`);
        setApiKey("");
        setApiSecret("");
        setExchangePassphrase("");
        await loadStoredKeys();
      } else {
        appendLog(`[!] ERROR: ${reply?.error || "Gagal menyimpan kunci ke server."}`);
      }
    } catch (err: any) {
      appendLog(`[!] ERROR JARINGAN: ${err?.message || err}`);
    } finally {
      setSavingKeys(false);
    }
  };

  // FUNC-4: delete a stored key from the server-side vault
  const handleDeleteServerKey = async (id: string, exchange: string) => {
    try {
      const res = await fetch(`/api/user/api-keys/${id}`, {
        method: "DELETE",
        credentials: "include"
      });
      const reply = await res.json().catch(() => null);
      if (res.ok && reply?.success) {
        appendLog(`[SECURITY] Kunci ${exchange} dihapus dari vault server — order untuk bursa ini kembali ke mode simulasi.`);
        await loadStoredKeys();
      } else {
        appendLog(`[!] ERROR: ${reply?.error || "Gagal menghapus kunci."}`);
      }
    } catch (err: any) {
      appendLog(`[!] ERROR JARINGAN: ${err?.message || err}`);
    }
  };

  // FUNC-4: probe a stored key via the server (decrypt + real exchange auth test)
  const handleTestServerKey = async (id: string, exchange: string) => {
    appendLog(`[PING] Menguji otentikasi kunci ${exchange} (id ${id}) ke bursa...`);
    try {
      const res = await fetch(`/api/user/api-keys/${id}/test`, {
        method: "POST",
        credentials: "include"
      });
      const reply = await res.json().catch(() => null);
      if (res.ok && reply?.success && reply.probe?.ok) {
        appendLog(`[STATUS] Kunci ${exchange} VALID — bursa menerima otentikasi (${reply.probe.detail || "OK"}).`);
      } else {
        appendLog(`[!] Kunci ${exchange} ditolak bursa: ${reply?.probe?.error || reply?.error || "tidak diketahui"}. Kunci tetap tersimpan terenkripsi.`);
      }
    } catch (err: any) {
      appendLog(`[!] ERROR JARINGAN: ${err?.message || err}`);
    }
  };

  // Perform real-world verification & proxy sync query to server config
  const handleTriggerSync = async () => {
    setIsSyncing(true);
    setConnectionStatus("checking");
    setStatusDetails("Menghubungi proxy & menguji otentikasi bursa...");
    const testStartTime = performance.now();

    setExecutionLogs(prev => [
      ...prev,
      `[PING] Menghubungi proxy server pusat untuk verifikasi koneksi ${selectedExchange} API...`
    ]);

    try {
      // FUNC-4: the server resolves keys from its own encrypted vault
      // (label "default") — the browser never ships plaintext secrets here.
      const payloadBody = {
        exchange: selectedExchange,
        useSandbox
      };

      const res = await fetch("/api/trade/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payloadBody)
      });

      const latency = Math.round(performance.now() - testStartTime);
      setLastCheckLatency(latency);

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Status HTTP ${res.status}`);
      }

      const reply = await res.json();
      
      if (reply.success && !reply.error) {
        setConnectionStatus("connected");
        setStatusDetails(`Sah Terhubung (${latency}ms)`);
        // Honest balance-source labeling per IMPL-S server contract.
        // FIX-B-7: balance may be null with `balanceSource: "unavailable"` when
        // the real-balance fetch fails — we no longer fabricate $4250.75.
        const balanceSourceLabel =
          reply.balanceSource === "live" ? "live" :
          reply.balanceSource === "sandbox" ? "sandbox" :
          reply.balanceSource === "unavailable" ? "tidak tersedia" :
          reply.balanceSource === "estimated" ? "estimasi" : "estimasi";
        const balanceStr = reply.balance === null || reply.balance === undefined
          ? "N/A"
          : `$${Number(reply.balance).toLocaleString()}`;
        setExecutionLogs(prev => [
          ...prev,
          `[STATUS] KONEKSI ONLINE: Berhasil sinkronisasi status bursa ${selectedExchange}.`,
          `[SYSTEM] Real Order Book Price: $${reply.tickerPrice.toLocaleString()} - Saldo Portofolio Terkait: ${balanceStr} USDT [sumber: ${balanceSourceLabel}].`,
          `[SECURITY] Kunci diambil dari vault terenkripsi server (AES-256-GCM) untuk bursa ${selectedExchange} — browser tidak menyimpan kunci plaintext.`
        ]);
      } else {
        setConnectionStatus("failed");
        setStatusDetails(reply.error || "Gagal otentikasi bursa");
        setExecutionLogs(prev => [
          ...prev,
          `[!] ALERT KONEKSI: ${reply.error || "Gagal otentikasi kunci bursa."}`
        ]);
      }
    } catch (err: any) {
      const latency = Math.round(performance.now() - testStartTime);
      setLastCheckLatency(latency);
      setConnectionStatus("failed");
      
      let parsedErr = err.message;
      try {
        const parsedJson = JSON.parse(err.message);
        if (parsedJson.error) parsedErr = parsedJson.error;
      } catch(_) {}

      setStatusDetails(parsedErr || "Kesalahan jaringan");
      setExecutionLogs(prev => [
        ...prev,
        `[!] ERROR KONEKSI: Gagal menjangkau API bursa ${selectedExchange}. Detail: ${parsedErr}`
      ]);
    } finally {
      setIsSyncing(false);
    }
  };

  // Trade Executor Action using the real live bursa state
  const handleExecuteTrade = async () => {
    setIsExecuting(true);
    setExecutionLogs(prev => [
      ...prev,
      `[EXECUTE] Menyiapkan sinyal otomasi untuk bursa ${selectedExchange} secara real-time...`
    ]);

    try {
      // FUNC-4: keys are resolved server-side from the encrypted vault.
      // Sandbox mode = simulation; with stored keys = REAL signed order.
      const res = await fetch("/api/trade/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          exchange: selectedExchange,
          symbol: tradeSymbol.trim() || "BTC",
          amount: parseFloat(tradeAmount) || 0,
          side: tradeSide,
          useSandbox
        })
      });

      const reply = await res.json();
      if (reply.success) {
        // Honest simulation labeling: server (IMPL-S) now returns isSimulation + simulationNote.
        // We no longer claim "Real order terisi secara aman" when no real order was placed.
        const isSim = reply.isSimulation === true;
        const note = reply.simulationNote || (isSim
          ? "SIMULASI — order tidak dieksekusi di bursa sungguhan"
          : "Order terisi");
        setExecutionLogs(prev => [
          ...prev,
          `[SECURITY] Order ditandatangani HMAC server-side dengan kunci terenkripsi dari vault ${selectedExchange}.`,
          isSim
            ? `[ORDER] SIMULASI: ${tradeSide.toUpperCase()} ${tradeAmount} ${tradeSymbol.toUpperCase()} diproses pada harga live (TIDAK dieksekusi di bursa sungguhan).`
            : `[ORDER] SUCCESS: Real order ${tradeSide.toUpperCase()} ${tradeAmount} ${tradeSymbol.toUpperCase()} terisi secara aman!`,
          `[BROKER] Exchange Gateway: Harga live $${reply.executedPrice.toLocaleString()} USD. No Resi: ${reply.txRef}`,
          `[INFO] ${note}`
        ]);
      } else {
        setExecutionLogs(prev => [
          ...prev,
          `[!] ORDER REJECTED: ${reply.error}`
        ]);
      }
    } catch (err: any) {
      setExecutionLogs(prev => [
        ...prev,
        `[!] SYSTEM ERROR: Gagal memproses order bursa. Detail: ${err.message}`
      ]);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-6" id="api-automation-tab">
      
      {/* Title block */}
      <div className="bg-[#0F172A] p-6 rounded-2xl border border-slate-800">
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-blue-500" /> Integrasi API Bursa Saham & Kripto Riil
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
          Hubungkan portofolio trading Anda langsung dengan bursa kripto global terkemuka (**Binance, KuCoin, Bybit**). Kunci API Anda disimpan di server dengan enkripsi **AES-256-GCM** (ENCRYPTION_KEY) dan hanya digunakan untuk menandatangani order — browser tidak pernah menyimpan kunci plaintext.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left column config parameters */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-md font-bold text-slate-200">Konfigurasi Konektor API Bursa</h3>
            <span className={`text-[10px] font-mono border px-2.5 py-0.5 rounded-full select-none ${
              useSandbox ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            }`}>
              {useSandbox ? "Mode Sandbox Aktif" : "LIVE EXCHANGE API READY"}
            </span>
          </div>

          {/* Real-Time Visual Connection-Status Badge & Reachability Indicator Panel */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 font-sans tracking-wide">Status Jangkauan Kunci API</span>
              
              {/* Status Badge */}
              {connectionStatus === "not_tested" && (
                <div id="status-badge-not-tested" className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-full text-[10px] text-slate-400 font-mono font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-600 animate-pulse" />
                  BELUM DIUJI
                </div>
              )}
              {connectionStatus === "checking" && (
                <div id="status-badge-checking" className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/25 px-2.5 py-1 rounded-full text-[10px] text-blue-400 font-mono font-medium animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                  MEMVERIFIKASI...
                </div>
              )}
              {connectionStatus === "connected" && (
                <div id="status-badge-connected" className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full text-[10px] text-emerald-400 font-mono font-semibold shadow-sm shadow-emerald-950/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
                  SAH TERHUBUNG
                </div>
              )}
              {connectionStatus === "failed" && (
                <div id="status-badge-failed" className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-full text-[10px] text-rose-400 font-mono font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  GAGAL TERJANGKAU
                </div>
              )}
            </div>

            {/* Dynamic diagnostic feed */}
            <div className="flex items-start gap-2.5 bg-[#0F172A]/85 p-3 rounded-lg border border-slate-800/80">
              <div className="mt-0.5 shrink-0 select-none">
                {connectionStatus === "not_tested" && <WifiOff className="w-4 h-4 text-slate-500" />}
                {connectionStatus === "checking" && <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />}
                {connectionStatus === "connected" && <Wifi className="w-4 h-4 text-emerald-400" />}
                {connectionStatus === "failed" && <ShieldAlert className="w-4 h-4 text-rose-400" />}
              </div>
              <div className="space-y-0.5 flex-1">
                <p className="text-[11px] font-mono font-medium text-slate-300">
                  {connectionStatus === "not_tested" && "Konek atau Enkripsikan Kunci"}
                  {connectionStatus === "checking" && "Menguji responsivitas jabat tangan..."}
                  {connectionStatus === "connected" && `Koneksi Tervalidasi (${selectedExchange})`}
                  {connectionStatus === "failed" && "Konektivitas / Kunci Tidak Sah"}
                </p>
                <p className="text-[10px] text-slate-400 leading-normal">
                  {connectionStatus === "not_tested" && "Kunci (bila tersimpan) berada terenkripsi di vault server AES-256-GCM. Klik tombol verifikasi untuk menguji ticker & saldo bursa."}
                  {connectionStatus === "checking" && "Mengirimkan hash bertanda tangan SHA256 melintasi proxy bursa riil..."}
                  {connectionStatus === "connected" && (statusDetails || "Otentikasi sukses. Ticker harga & saldo saat ini telah disinkronkan.")}
                  {connectionStatus === "failed" && (statusDetails || "Pastikan kunci sandi Master PIN Anda benar dan bursa mengizinkan pemanggilan.")}
                </p>
              </div>
            </div>
          </div>

          {/* Sandbox Toggle */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-200 block">Jalankan Portfolio Simulasi (Sandbox Mode)</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Nyalakan opsi ini untuk mengabaikan input kunci bursa asli dan menggunakan akun demo.</span>
              </div>
              <button
                type="button"
                onClick={() => setUseSandbox(!useSandbox)}
                id="sandbox-toggle"
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  useSandbox ? "bg-blue-600" : "bg-slate-800"
                }`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-slate-950 shadow ring-0 transition duration-200 ease-in-out ${
                  useSandbox ? "translate-x-5" : "translate-x-0"
                }`} />
              </button>
            </div>

            {useSandbox && (
              <div className="bg-[#0F172A]/70 p-3 rounded text-[11px] text-amber-400 border border-amber-500/10 font-mono">
                ✓ Menggunakan akun internal rekayasa trading sandbox. API nyata tidak dipanggil agar data pribadi tetap aman.
              </div>
            )}
          </div>

          {/* Setup Inputs Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">PILIH BURSA / EXCHANGE TARGET</label>
              <select
                value={selectedExchange}
                onChange={(e) => setSelectedExchange(e.target.value)}
                id="exchange-select"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-sans"
              >
                <option value="Binance">Binance Exchange (Crypto Global)</option>
                <option value="KuCoin">KuCoin Exchange (Crypto Global)</option>
                <option value="Bybit">Bybit Exchange (Crypto Global)</option>
                <option value="BingX">BingX Exchange (Crypto Global)</option>
                <option value="MEXC">MEXC Global (Crypto Global)</option>
                <option value="Stockbit">Stockbit Sekuritas (Saham Indonesia)</option>
              </select>
            </div>

            {!useSandbox && (
              <>
                {/* FUNC-4: server vault status */}
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400 font-mono uppercase">
                    <Lock className="w-3.5 h-3.5 text-blue-400" />
                    Vault Kunci Terenkripsi Server (AES-256-GCM)
                  </div>
                  {storedKeys.filter(k => k.exchange.toLowerCase() === selectedExchange.toLowerCase()).length === 0 ? (
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      Belum ada kunci {selectedExchange} yang tersimpan. Simpan kunci di bawah agar order real aktif — tanpa kunci, semua order berjalan dalam mode simulasi harga live.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {storedKeys.filter(k => k.exchange.toLowerCase() === selectedExchange.toLowerCase()).map(k => (
                        <div key={k.id} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                          <div className="text-[10px] font-mono text-slate-300">
                            <span className="text-emerald-400 font-bold">{k.exchange}</span>
                            <span className="text-slate-500"> • {k.label} • </span>
                            <span className="text-slate-400">{k.keyMasked}</span>
                            <span className="text-slate-600"> • {new Date(k.createdAt).toLocaleDateString("id-ID")}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleTestServerKey(k.id, k.exchange)}
                              className="text-[9px] font-mono uppercase bg-sky-500/10 border border-sky-500/25 text-sky-400 px-2 py-1 rounded hover:bg-sky-500/20 cursor-pointer"
                            >
                              Uji Kunci
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteServerKey(k.id, k.exchange)}
                              className="text-[9px] font-mono uppercase bg-rose-500/10 border border-rose-500/25 text-rose-400 px-2 py-1 rounded hover:bg-rose-500/20 cursor-pointer"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">Third-Party API Key</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Masukkan Kode API Key bursa terdaftar..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      id="api-key-input"
                      autoComplete="off"
                      className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg pl-10 pr-4 py-2.5 w-full focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">API Secret Key</label>
                    <div className="relative">
                      <input
                        type={showSecretField ? "text" : "password"}
                        placeholder="Masukkan API Secret..."
                        autoComplete="off"
                        value={apiSecret}
                        onChange={(e) => setApiSecret(e.target.value)}
                        className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-4 py-2.5 w-full focus:outline-none focus:border-blue-500 font-mono text-justify"
                      />
                      <button 
                        type="button" 
                        onClick={() => setShowSecretField(!showSecretField)} 
                        className="absolute right-3 top-3 text-slate-500 hover:text-slate-300"
                      >
                        {showSecretField ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">Passphrase (wajib untuk KuCoin)</label>
                    <input
                      type="text"
                      placeholder="Passphrase KuCoin..."
                      autoComplete="off"
                      value={exchangePassphrase}
                      onChange={(e) => setExchangePassphrase(e.target.value)}
                      className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-4 py-2.5 w-full focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveKeysToServer}
                  disabled={savingKeys || apiKey.length === 0 || apiSecret.length === 0}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold p-2.5 rounded-lg text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-blue-900/10 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {savingKeys ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" /> : <Lock className="w-3.5 h-3.5 text-white" />}
                  <span>Simpan & Enkripsi Kredensial di Vault Server</span>
                </button>
                <p className="text-[9.5px] text-slate-500 font-mono leading-snug">
                  Kunci dikirim sekali via HTTPS, dienkripsi AES-256-GCM di server, lalu field di atas dikosongkan. Order real otomatis aktif untuk bursa ini.
                </p>
              </>
            )}

            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">WEBHOOK ENDPOINT URL</label>
              <input
                type="text"
                value={webHookUrl}
                onChange={(e) => setWebHookUrl(e.target.value)}
                id="webhook-input"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            {/* Telegram Bot Automation Panel */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400 font-mono uppercase">
                <MessageSquare className="w-3.5 h-3.5" />
                INTEGRASI TELEGRAM BOT & SINYAL
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono uppercase mb-1">Telegram Bot Token</span>
                  <input
                    type="password"
                    value={notificationConfig.telegramBotToken || ""}
                    onChange={(e) => updateNotificationConfig({ telegramBotToken: e.target.value })}
                    placeholder="Masukkan Bot Token Anda..."
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono uppercase mb-1">Telegram Chat ID</span>
                  <input
                    type="text"
                    value={notificationConfig.telegramChatId || ""}
                    onChange={(e) => updateNotificationConfig({ telegramChatId: e.target.value })}
                    placeholder="Masukkan/Ubah Chat ID..."
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              {/* Panduan Mengatasi Chat Not Found */}
              <div className="bg-amber-950/20 border border-amber-900/30 p-2 text-[9px] space-y-1 text-amber-300 font-mono">
                <div className="font-bold text-amber-400 uppercase">💡 INFO TELEGRAM &quot;CHAT NOT FOUND&quot;:</div>
                <div className="text-slate-300 leading-relaxed">
                  Harap buka bot Anda di Telegram dan ketik/klik <strong className="text-amber-300">/start</strong> agar bot diizinkan mengirim pesan ke Anda. Jika Anda belum menyapa bot Anda terlebih dahulu di Telegram, Telegram API akan menolak pengiriman dengan pesan error tersebut.
                </div>
              </div>

              {telegramStatus && (
                <div className={`text-[10px] font-mono p-2 rounded ${
                  telegramStatus.startsWith("Sukses") 
                    ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/30" 
                    : "bg-amber-950/40 text-amber-400 border border-amber-900/10"
                }`}>
                  {telegramStatus}
                </div>
              )}

              <button
                type="button"
                onClick={TestTelegramBot}
                disabled={telegramLoading}
                className="w-full bg-[#1e293b] hover:bg-slate-800 border border-slate-700 disabled:opacity-50 text-slate-200 font-bold p-2 rounded text-[11px] font-mono uppercase transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {telegramLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                ) : (
                  <Send className="w-3 text-sky-400" />
                )}
                <span>Kirim Sinyal Uji (Hello World)</span>
              </button>
            </div>
          </div>

          {/* Trade configuration inputs — previously hardcoded BTC 0.05 (AUDIT-3 high-severity bug). */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 font-sans tracking-wide">Konfigurasi Eksekusi Order</span>
              <span className={`text-[9px] font-mono ${useSandbox ? "text-amber-400" : "text-emerald-400"}`}>
                {useSandbox
                  ? "MODE SANDBOX (simulasi harga live)"
                  : storedKeys.some(k => k.exchange.toLowerCase() === selectedExchange.toLowerCase() && k.label === "default")
                    ? "MODE LIVE (order real ditandatangani & dikirim)"
                    : "TANPA KUNCI (order akan disimulasikan)"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[9px] text-slate-400 font-mono uppercase mb-1">SIMBOL</label>
                <input
                  type="text"
                  value={tradeSymbol}
                  onChange={(e) => setTradeSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  placeholder="BTC"
                  id="trade-symbol-input"
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[9px] text-slate-400 font-mono uppercase mb-1">JUMLAH</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0.05"
                  id="trade-amount-input"
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[9px] text-slate-400 font-mono uppercase mb-1">ARAH</label>
                <select
                  value={tradeSide}
                  onChange={(e) => setTradeSide(e.target.value as "buy" | "sell")}
                  id="trade-side-select"
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                >
                  <option value="buy">BUY</option>
                  <option value="sell">SELL</option>
                </select>
              </div>
            </div>
            <p className="text-[9.5px] text-slate-500 leading-snug">
              Mode Sandbox = simulasi harga live (order tidak diteruskan). Dengan kunci tersimpan di vault server = order REAL ditandatangani HMAC dan dikirim ke bursa (dibatasi MAX_ORDER_NOTIONAL_USD).
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={handleTriggerSync}
              id="sync-portfolio-btn"
              disabled={isSyncing}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold px-4 py-2.5 rounded-lg text-xs border border-slate-700 transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Verifikasi & Ambil Saldo Riil</span>
            </button>
            <button
              onClick={handleExecuteTrade}
              id="test-order-btn"
              disabled={isExecuting}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2.5 rounded-lg text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-blue-900/10"
            >
              <Zap className={`w-3.5 h-3.5 fill-white stroke-none ${isExecuting ? 'animate-bounce' : ''}`} />
              <span>Eksekusi Transmisi Riil</span>
            </button>
          </div>
        </div>

        {/* Right side command log console terminal */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-md font-bold text-slate-200 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-blue-500" /> Audit Log & Telekomunikasi Bursa
              </h3>
              <button
                onClick={() => setExecutionLogs([])}
                id="clear-logs-btn"
                className="text-[10px] text-slate-400 hover:text-slate-100 uppercase font-mono border border-slate-800 px-2 py-0.5 rounded cursor-pointer transition-colors"
              >
                Clear Log
              </button>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 h-[380px] overflow-y-auto font-mono text-[10.5px] leading-relaxed text-slate-300 space-y-2.5">
              {executionLogs.map((log, idx) => {
                let colorClass = "text-slate-400";
                if (log.includes("[STATUS]")) colorClass = "text-emerald-400 font-semibold";
                if (log.includes("[SYSTEM]")) colorClass = "text-blue-400";
                if (log.includes("[ORDER]")) colorClass = "text-purple-400 font-semibold";
                if (log.includes("[EXECUTE]")) colorClass = "text-amber-400 animate-pulse";
                if (log.includes("[PING]")) colorClass = "text-sky-400";
                if (log.includes("[SECURITY]")) colorClass = "text-cyan-400 font-semibold";
                if (log.includes("[!]")) colorClass = "text-rose-400 font-semibold bg-rose-950/20 px-1 py-0.5 rounded border border-rose-950/40";
                return (
                  <div key={idx} className={colorClass}>
                    {log}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 border-t border-slate-800/85 pt-4 flex flex-col sm:flex-row justify-between items-start sm:items-center text-[10px] font-mono text-slate-500 gap-2">
            <div>
              Vault: <span className={`font-bold ${storedKeys.length > 0 ? "text-emerald-400" : "text-amber-400"}`}>
                {storedKeys.length > 0 ? `${storedKeys.length} kunci terenkripsi AES-256-GCM` : "belum ada kunci tersimpan"}
              </span>
            </div>
            <div>
              Trade Mode: <span className={`font-bold ${useSandbox ? "text-amber-400" : "text-emerald-400"}`}>
                {useSandbox ? "SANDBOX (SIMULASI)" : "LIVE (ORDER REAL)"}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
