import React, { useState, useEffect } from "react";
import Markdown from "react-markdown";
import { 
  Sparkles, 
  TrendingUp, 
  TrendingDown, 
  Database,
  Cpu,
  RefreshCw,
  Clock,
  ArrowRightLeft,
  Activity,
  AlertTriangle,
  Info,
  BarChart2,
  ArrowUpRight,
  Search,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  ArrowUpDown,
  AlertCircle
} from "lucide-react";
import { Asset } from "../types";
import { useGlobalStore } from "../store";

interface OnChainPayload {
  recommendation: "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL";
  confidence: number;
  onchainHealth: string;
  analysis: string;
  isFallback?: boolean;
  errorReason?: string;
  metrics: {
    activeAddresses: number;
    exchangeNetflow24h: number;
    smartMoneyAction: string;
    onchainHealthScore: number;
    averageGasFee: string;
    whaleTransactions24h: number;
    socialSentiment: string;
    scrapedSource: string;
  };
  asset: any;
}

interface AiSignalsProps {
  assets: Asset[];
}

export default function AiSignals({ assets }: AiSignalsProps) {
  const settings = useGlobalStore(state => state.settings);
  // Only display cryptocurrencies for our specialized onchain analysis terminal
  const cryptoAssets = assets.filter(a => a.category === "crypto");
  
  const [selectedSymbol, setSelectedSymbol] = useState("BTC");
  const [customFocus, setCustomFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OnChainPayload | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshIntervalSecs, setRefreshIntervalSecs] = useState(60); // Less hyperactive! Default to 60 seconds
  const [lastScrapedAt, setLastScrapedAt] = useState<string>("");
  
  // Client-side cache to persist expert recommendations per symbol so navigation is lag-free and safe
  const [cache, setCache] = useState<Record<string, { data: OnChainPayload; timestamp: number }>>({});

  // Types for live trading signal performance ledger tracking
  interface SignalHistoryEntry {
    id: string;
    symbol: string;
    category: "crypto" | "stock";
    recommendation: "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL";
    confidence: number;
    entryPrice: number;
    currentPrice: number;
    tpPrice: number;
    slPrice: number;
    status: "PENDING" | "TARGET HIT (TP)" | "STOP LOSS (SL)";
    timestamp: string;
    timeframe: "intraday" | "daily" | "weekly";
  }

  interface SignalMetrics {
    totalSignals: number;
    completedSignals: number;
    totalTp: number;
    totalSl: number;
    totalPending: number;
    winRate: number;
    timeframeRecap: {
      intraday: { total: number; tp: number; sl: number; pending: number; winRate: number };
      daily: { total: number; tp: number; sl: number; pending: number; winRate: number };
      weekly: { total: number; tp: number; sl: number; pending: number; winRate: number };
    };
  }

  // Interactive filters & states
  const [historyList, setHistoryList] = useState<SignalHistoryEntry[]>([]);
  const [metrics, setMetrics] = useState<SignalMetrics | null>(null);
  const [timeframeFilter, setTimeframeFilter] = useState<string>("all");
  const [symbolFilter, setSymbolFilter] = useState<string>("all");
  
  // Premium performance optimization filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("timestamp-desc");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Manual Trigger Simulation states
  const [simulating, setSimulating] = useState<boolean>(false);
  const [simRecommendation, setSimRecommendation] = useState<"STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL">("STRONG BUY");
  const [simConfidence, setSimConfidence] = useState<number>(85);
  const [simSuccessMsg, setSimSuccessMsg] = useState<string | null>(null);

  const fetchHistoryAndMetrics = async () => {
    try {
      const res = await fetch("/api/trading-signals/history");
      if (res.ok) {
        const payload = await res.json();
        setHistoryList(payload.signals || []);
        setMetrics(payload.metrics || null);
      }
    } catch (err) {
      console.error("Gagal sinkronisasi data riwayat sinyal:", err);
    }
  };

  const handleSimulateSignal = async () => {
    setSimulating(true);
    setSimSuccessMsg(null);
    try {
      // Resolve the live asset price for the currently selected symbol so the
      // manually-simulated signal carries a realistic entryPrice. Falls back
      // to the most recent signal history entry price if no live asset match.
      const liveAsset = cryptoAssets.find(a => a.symbol === selectedSymbol);
      const fallbackFromHistory = historyList.find(s => s.symbol === selectedSymbol);
      const basePrice =
        (liveAsset && typeof liveAsset.price === "number" && liveAsset.price > 0)
          ? liveAsset.price
          : (fallbackFromHistory ? fallbackFromHistory.entryPrice : 0);

      if (!(basePrice > 0)) {
        setSimSuccessMsg(`Gagal: tidak ada harga live tersedia untuk ${selectedSymbol}. Pilih aset lain atau tunggu data live tersedia.`);
        setTimeout(() => setSimSuccessMsg(null), 6000);
        return;
      }

      // Compute sensible TP/SL levels based on the chosen direction:
      // - BUY-side: TP above entry, SL below entry.
      // - SELL-side: TP below entry, SL above entry.
      // - HOLD: symmetric tight band (informational only).
      const isBuy = simRecommendation === "STRONG BUY" || simRecommendation === "BUY";
      const isSell = simRecommendation === "STRONG SELL" || simRecommendation === "SELL";
      const tpMultiplier = isBuy ? 1.05 : isSell ? 0.95 : 1.02;
      const slMultiplier = isBuy ? 0.97 : isSell ? 1.03 : 0.98;

      const payload = {
        symbol: selectedSymbol,
        direction: simRecommendation, // server field is `direction`, NOT `recommendation`
        entryPrice: basePrice,
        tpPrice: parseFloat((basePrice * tpMultiplier).toFixed(2)),
        slPrice: parseFloat((basePrice * slMultiplier).toFixed(2)),
        timeframe: "intraday" as "intraday" | "daily" | "weekly",
        notes: `Simulasi manual (confidence target ${Number(simConfidence)}%)`
      };

      const res = await fetch("/api/trading-signals/generate-manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        setSimSuccessMsg(`Sinyal ${data.signal.recommendation} baru untuk ${data.signal.symbol} berhasil disimulasikan dan beredar secara live!`);
        fetchHistoryAndMetrics();
        // Reset to first page so the freshly generated signal shows at the top immediately
        setCurrentPage(1);
        setTimeout(() => setSimSuccessMsg(null), 4000);
      } else {
        let serverMsg = "Respons server tidak valid.";
        try {
          const errorData = await res.json();
          serverMsg = errorData?.error || serverMsg;
        } catch {
          /* keep default message */
        }
        // Surface failure to the user instead of silently console.log-ing.
        setSimSuccessMsg(`Gagal mensimulasikan sinyal: ${serverMsg}`);
        setTimeout(() => setSimSuccessMsg(null), 6000);
      }
    } catch (err: any) {
      const msg = err?.message || String(err) || "Kesalahan jaringan tidak diketahui.";
      setSimSuccessMsg(`Gagal koneksi ke server simulasi sinyal: ${msg}`);
      setTimeout(() => setSimSuccessMsg(null), 6000);
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    fetchHistoryAndMetrics();
    const interval = setInterval(() => {
      fetchHistoryAndMetrics();
    }, 5000); // Poll every 5s for dynamic interactive price monitoring & triggers
    return () => clearInterval(interval);
  }, []);

  const handleAnalyze = async (symbolToAnalyze: string, force = false) => {
    const now = Date.now();
    const cacheKey = `${symbolToAnalyze}_${customFocus.trim()}`;
    const cachedEntry = cache[cacheKey];
    
    // Serve from local cache if available and not forced & newer than 3 minutes (180,000 ms)
    if (!force && cachedEntry && (now - cachedEntry.timestamp < 180000)) {
      setData(cachedEntry.data);
      setLastScrapedAt(new Date(cachedEntry.timestamp).toLocaleTimeString());
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (settings.geminiKey) {
        headers["X-Gemini-Key"] = settings.geminiKey;
      }

      const res = await fetch("/api/gemini/trading-signals/analyze", {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          symbol: symbolToAnalyze, 
          category: "crypto",
          customFocus: customFocus.trim() || undefined,
          aiTone: settings.aiTone,
          aiTemperature: settings.aiTemperature,
          aiMaxTokens: settings.aiMaxTokens,
          aiThinkingMode: settings.aiThinkingMode || "high"
        })
      });

      if (!res.ok) {
        throw new Error(`Gagal memuat rekomendasi. Server merespon dengan kode ${res.status}`);
      }

      const payload = await res.json() as OnChainPayload;
      setData(payload);
      
      const currentTime = Date.now();
      setCache(prev => ({
        ...prev,
        [cacheKey]: { data: payload, timestamp: currentTime }
      }));
      setLastScrapedAt(new Date(currentTime).toLocaleTimeString());

      // Pull latest history trace immediately
      fetchHistoryAndMetrics();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Gagal menghubungi server analitik.");
    } finally {
      setLoading(false);
    }
  };

  // Run automatically when selected coin changes
  useEffect(() => {
    handleAnalyze(selectedSymbol, false);
  }, [selectedSymbol]);

  // Handle ticking auto-refresh for simulating live data feeds with customizable intervals
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      // Refresh current active token telemetry silently in the background (forcing update of cache)
      if (!loading) {
        handleAnalyze(selectedSymbol, true);
      }
    }, refreshIntervalSecs * 1000);
    return () => clearInterval(interval);
  }, [selectedSymbol, autoRefresh, loading, refreshIntervalSecs]);

  // Reset page to 1 when filters or criteria change
  useEffect(() => {
    setCurrentPage(1);
  }, [symbolFilter, timeframeFilter, statusFilter, actionFilter, searchQuery, sortBy, pageSize]);

  // Memoized advanced signal processing pipeline
  const processedSignals = React.useMemo(() => {
    let result = [...historyList];

    // 1. Symbol Filter
    if (symbolFilter !== "all") {
      result = result.filter(sig => sig.symbol === symbolFilter);
    }

    // 2. Timeframe Filter
    if (timeframeFilter !== "all") {
      result = result.filter(sig => sig.timeframe === timeframeFilter);
    }

    // 3. Status Filter
    if (statusFilter !== "all") {
      result = result.filter(sig => sig.status === statusFilter);
    }

    // 4. Action/Type Filter
    if (actionFilter !== "all") {
      result = result.filter(sig => {
        if (actionFilter === "BUY") return sig.recommendation.includes("BUY");
        if (actionFilter === "SELL") return sig.recommendation.includes("SELL");
        if (actionFilter === "HOLD") return sig.recommendation === "HOLD";
        return true;
      });
    }

    // 5. Text Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(sig => 
        sig.symbol.toLowerCase().includes(q) ||
        sig.recommendation.toLowerCase().includes(q) ||
        sig.status.toLowerCase().includes(q) ||
        sig.entryPrice.toString().includes(q) ||
        sig.tpPrice.toString().includes(q) ||
        sig.slPrice.toString().includes(q)
      );
    }

    // 6. Sorting
    result.sort((a, b) => {
      if (sortBy === "timestamp-desc") {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      }
      if (sortBy === "timestamp-asc") {
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      }
      if (sortBy === "confidence-desc") {
        return b.confidence - a.confidence;
      }
      if (sortBy === "confidence-asc") {
        return a.confidence - b.confidence;
      }
      if (sortBy === "price-desc") {
        return b.entryPrice - a.entryPrice;
      }
      if (sortBy === "price-asc") {
        return a.entryPrice - b.entryPrice;
      }
      return 0;
    });

    return result;
  }, [historyList, symbolFilter, timeframeFilter, statusFilter, actionFilter, searchQuery, sortBy]);

  const totalPagesSignals = React.useMemo(() => {
    return Math.max(1, Math.ceil(processedSignals.length / pageSize));
  }, [processedSignals.length, pageSize]);

  const activePageSignals = React.useMemo(() => {
    return Math.min(currentPage, totalPagesSignals) || 1;
  }, [currentPage, totalPagesSignals]);

  const paginatedSignals = React.useMemo(() => {
    const startIndex = (activePageSignals - 1) * pageSize;
    return processedSignals.slice(startIndex, startIndex + pageSize);
  }, [processedSignals, activePageSignals, pageSize]);

  // Color theme mapper for signal recommendation
  const getRecommendationStyle = (rec: string) => {
    switch (rec) {
      case "STRONG BUY":
        return {
          bg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
          glow: "shadow-emerald-500/10 border-emerald-500",
          text: "text-emerald-400",
          badge: "bg-emerald-500 text-slate-950"
        };
      case "BUY":
        return {
          bg: "bg-green-500/10 border-green-500/30 text-green-400",
          glow: "shadow-green-500/10 border-green-500",
          text: "text-green-400",
          badge: "bg-green-500 text-slate-950"
        };
      case "HOLD":
        return {
          bg: "bg-amber-500/10 border-amber-500/30 text-amber-400",
          glow: "shadow-amber-500/10 border-amber-500",
          text: "text-amber-400",
          badge: "bg-amber-500 text-slate-950"
        };
      case "SELL":
        return {
          bg: "bg-orange-500/10 border-orange-500/30 text-orange-400",
          glow: "shadow-orange-500/10 border-orange-500",
          text: "text-orange-400",
          badge: "bg-orange-500 text-white"
        };
      case "STRONG SELL":
        return {
          bg: "bg-rose-500/10 border-rose-500/30 text-rose-400",
          glow: "shadow-rose-500/10 border-rose-500",
          text: "text-rose-400",
          badge: "bg-rose-500 text-slate-950"
        };
      default:
        return {
          bg: "bg-slate-500/10 border-slate-500/30 text-slate-400",
          glow: "shadow-slate-500/10 border-slate-500",
          text: "text-slate-400",
          badge: "bg-slate-500 text-white"
        };
    }
  };

  const activeAssetStyle = data ? getRecommendationStyle(data.recommendation) : getRecommendationStyle("HOLD");

  return (
    <div className="space-y-6" id="ai-signals-panel">
      
      {/* Upper Status Announcement Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              Sinyal AI & On-Chain Telemetry Tracker
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Sistem pengawasan dan ramalan perdagangan yang mengikis (scrape) data ledger Blockchain harian 
            lalu diolah menggunakan Google Gemini AI untuk mendeteksi konvergensi bursa, akumulasi paus, dan momentum sinyal trading optimal.
          </p>
        </div>

        <div className="flex items-center space-x-3 self-stretch md:self-auto justify-between md:justify-end border-t border-slate-800/60 md:border-t-0 pt-3 md:pt-0">
          <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800/80">
            <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Scraper: Active</span>
          </div>
          
          <button
            onClick={() => handleAnalyze(selectedSymbol)}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold rounded-lg text-xs transition-colors cursor-pointer"
            title="Muat ulang scraping onchain"
            id="force-scraping-btn"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Force Scrape</span>
          </button>
        </div>
      </div>

      {/* Main Analytical Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Side: Real-time Coin selector with live fluctuating quotes and trend tickers */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-amber-500" />
                Crypto Exchange
              </span>
              <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded font-mono font-bold">LIVE APIS</span>
            </div>

            <div className="space-y-1">
              {cryptoAssets.map((asset) => {
                const isSelected = selectedSymbol === asset.symbol;
                const isPositive = asset.change24h >= 0;

                return (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedSymbol(asset.symbol)}
                    className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? "bg-amber-500/10 border-amber-500/60 text-slate-100"
                        : "bg-slate-950/40 border-slate-850 text-slate-400 hover:bg-slate-850 hover:text-slate-200"
                    }`}
                  >
                    <div>
                      <div className="flex items-center space-x-1.5">
                        <span className="font-bold text-xs">{asset.symbol}</span>
                        <span className="text-[9px] text-slate-500 uppercase font-mono">{asset.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Vol: ${(asset.volume24h / 1000000).toFixed(1)}M
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-mono text-xs font-bold text-slate-200">
                        ${asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}
                      </div>
                      <div className={`text-[10px] font-mono font-semibold flex items-center justify-end ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
                        {isPositive ? <TrendingUp className="w-3 h-3 mr-0.5 inline" /> : <TrendingDown className="w-3 h-3 mr-0.5 inline" />}
                        {isPositive ? "+" : ""}{asset.change24h}%
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Auto refresh control switches with customizable interval options */}
            <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2 text-xs text-slate-500">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium text-slate-400">
                  <Clock className="w-3 h-3 text-amber-500 animate-pulse" />
                  Auto-scrape On-Chain
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="sr-only peer" 
                  />
                  <div className="w-7 h-4 bg-slate-950 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-3 after:width-3 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950" />
                </label>
              </div>

              {autoRefresh && (
                <div className="space-y-1.5 bg-slate-950/40 p-2 rounded border border-slate-850/60 mt-1">
                  <span className="text-[10px] text-slate-400 block font-mono">Interval Pembaruan:</span>
                  <div className="grid grid-cols-4 gap-1">
                    {[30, 60, 180, 300].map((sec) => (
                      <button
                        key={sec}
                        onClick={() => setRefreshIntervalSecs(sec)}
                        className={`text-[9px] py-1 rounded font-mono text-center font-bold tracking-tight transition-all cursor-pointer ${
                          refreshIntervalSecs === sec
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                            : "bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300"
                        }`}
                      >
                        {sec >= 60 ? `${sec / 60}m` : `${sec}s`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-[9px] text-emerald-500/80 font-mono pt-1">
                <span>⚡ Caching Navigasi Aktif</span>
                <span>3m Masa Berlaku</span>
              </div>
            </div>
          </div>

          {/* Custom Focus Prompt Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Fokus Isu Analisis AI
            </span>
            <p className="text-[10px] text-slate-500 leading-normal">
              Masukkan petunjuk atau isu khusus agar analisis kecerdasan buatan Gemini AI fokus membedah aspek tersebut.
            </p>
            <textarea
              value={customFocus}
              onChange={(e) => setCustomFocus(e.target.value)}
              placeholder="Contoh: Fokus analisis volatilitas tinggi / risiko likuidasi bursa jangka pendek / ketahanan biaya gas fee..."
              className="w-full h-20 bg-slate-950 border border-[#1E293B] rounded-lg p-2 text-[11px] text-slate-200 focus:outline-none focus:border-amber-500 placeholder:text-slate-600 resize-none leading-relaxed"
            />
            <button
              onClick={() => handleAnalyze(selectedSymbol, true)}
              disabled={loading}
              className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-[10px] font-bold tracking-wide uppercase transition-colors cursor-pointer"
            >
              Terapkan & Analisis AI
            </button>
          </div>

          {/* Scaper Disclaimer box */}
          <div className="bg-slate-950/60 border border-slate-850 p-3 rounded-lg text-[11px] text-slate-500 leading-relaxed">
            <Info className="w-3.5 h-3.5 text-blue-400 inline mr-1.5 float-left" />
            <span>
              Sistem scraping on-chain menggunakan kueri deterministik RPC ledger publik untuk mensimulasikan integrasi real-time. Data ini disinkronisasikan langsung dengan pergerakan harga global bursa Binance.
            </span>
          </div>
        </div>

        {/* Right Side / Content: AI Analysis Results, telemetry meters, and recommendations */}
        <div className="lg:col-span-3 space-y-6">
          
          {loading && !data ? (
            /* First loading placeholder */
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center flex flex-col items-center justify-center space-y-4">
              <Cpu className="w-12 h-12 text-amber-500 animate-spin" />
              <div>
                <p className="text-slate-200 font-bold">Menghubungkan Scraper Onchain Ledger...</p>
                <p className="text-xs text-slate-500 mt-1">Mengumpulkan volume bursa, netflow exchange, & mengaktifkan penasihat kuantitatif Google Gemini AI...</p>
              </div>
            </div>
          ) : error ? (
            /* Error Fallback box */
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-6 flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              <div>
                <h4 className="text-sm font-semibold text-rose-300">Gagal Mengumpulkan Analitik Realpoint</h4>
                <p className="text-xs text-slate-400 mt-1">{error}</p>
                <button 
                  onClick={() => handleAnalyze(selectedSymbol)} 
                  className="mt-3 text-xs bg-rose-500/20 text-rose-300 px-3 py-1.5 rounded hover:bg-rose-500/30 font-semibold cursor-pointer"
                >
                  Coba Scraping Ulang
                </button>
              </div>
            </div>
          ) : data ? (
            /* Content successfully loaded */
            <div className="space-y-6">
              
              {/* Telemetry Dashboard Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Gauge Indicator Ring - Big Signal Recommendation badge */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-amber-500/5 to-transparent rounded-bl-full pointer-events-none" />
                  
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
                      Trading Recommendation Indicator
                    </span>
                    <h3 className="text-slate-400 text-xs flex items-center gap-1 font-mono">
                      <Cpu className="w-3.5 h-3.5 text-blue-400" />
                      AI Consensus Match
                    </h3>
                  </div>

                  <div className="my-5 text-center">
                    <span className={`text-2xl font-black tracking-tighter uppercase px-3 py-1.5 rounded-lg border shadow-lg ${activeAssetStyle.glow} ${activeAssetStyle.bg}`}>
                      {data.recommendation}
                    </span>
                    
                    <div className="mt-4 flex items-center justify-center space-x-2">
                      <div className="text-xs text-slate-400">Tingkat Keyakinan:</div>
                      <div className="text-sm font-black text-slate-100">{data.confidence}%</div>
                    </div>

                    {/* Simple confidence bar */}
                    <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden border border-slate-850">
                      <div 
                        className="bg-gradient-to-r from-amber-600 to-amber-400 h-full rounded-full transition-all duration-1000" 
                        style={{ width: `${data.confidence}%` }}
                      />
                    </div>
                  </div>

                  <div className="text-[10px] text-slate-500 border-t border-slate-850 pt-2 flex justify-between items-center">
                    <span>Target Timeframe: 24h-48h</span>
                    <span className="text-emerald-400 font-bold">Active Signal</span>
                  </div>
                </div>

                {/* On-chain Ledger Heath Metric details */}
                <div className="bg-slate-900 border border-slate-850 rounded-xl p-5 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
                      On-Chain Health Sentiment
                    </span>
                    <h3 className="text-slate-400 text-xs flex items-center gap-1 font-mono">
                      <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                      Ledger Health Score
                    </h3>
                  </div>

                  <div className="my-3 flex items-center justify-center space-x-4">
                    <div className="relative w-16 h-16 flex items-center justify-center rounded-full bg-slate-950 border border-slate-800">
                      {/* SVG Circle meter */}
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.915" fill="none" stroke="#1e293b" strokeWidth="2" />
                        <circle 
                          cx="18" cy="18" r="15.915" 
                          fill="none" 
                          stroke={data.metrics.onchainHealthScore >= 75 ? "#10b981" : data.metrics.onchainHealthScore >= 50 ? "#f59e0b" : "#ef4444"} 
                          strokeWidth="2.5" 
                          strokeDasharray={`${data.metrics.onchainHealthScore} 100`} 
                          strokeLinecap="round"
                          className="transition-all duration-1000"
                        />
                      </svg>
                      <span className="absolute text-sm font-black text-slate-200">
                        {data.metrics.onchainHealthScore}
                      </span>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500">Status Sentimen:</div>
                      <div className="text-sm font-bold text-slate-100">{data.onchainHealth}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">Large Transfers Active</div>
                    </div>
                  </div>

                  <div className="text-[10px] text-slate-500 border-t border-slate-850 pt-2 flex justify-between items-center">
                    <span>Liquidity Flow:</span>
                    <span className="text-amber-500 font-mono font-semibold">{data.metrics.smartMoneyAction}</span>
                  </div>
                </div>

                {/* Flow Direction Indicator Status */}
                <div className="bg-slate-900 border border-slate-850 rounded-xl p-5 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
                      Exchange Inflow vs Outflow
                    </span>
                    <h3 className="text-slate-400 text-xs flex items-center gap-1 font-mono">
                      <ArrowRightLeft className="w-3.5 h-3.5 text-blue-400" />
                      Netflow Index (24h)
                    </h3>
                  </div>

                  <div className="my-4 text-center">
                    <div className="flex items-center justify-center space-x-1.5">
                      {data.metrics.exchangeNetflow24h < 0 ? (
                        <TrendingDown className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <TrendingUp className="w-5 h-5 text-rose-400" />
                      )}
                      <span className={`text-xl font-mono font-black ${data.metrics.exchangeNetflow24h < 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {data.metrics.exchangeNetflow24h > 0 ? "+" : ""}{data.metrics.exchangeNetflow24h.toLocaleString()} {selectedSymbol}
                      </span>
                    </div>
                    
                    <p className="text-[10px] text-slate-400 mt-1 max-w-[200px] mx-auto text-center">
                      {data.metrics.exchangeNetflow24h < 0 
                        ? "Penarikan koin ke dompet pribadi terdeteksi (BULLISH)."
                        : "Koin dikirim ke bursa utama untuk potensi aksi likuidasi (BEARISH)."}
                    </p>
                  </div>

                  <div className="text-[10px] text-slate-500 border-t border-slate-850 pt-2 flex justify-between items-center">
                    <span>Active Addresses:</span>
                    <span className="text-slate-300 font-mono">{data.metrics.activeAddresses.toLocaleString()}</span>
                  </div>
                </div>

              </div>

              {/* On-Chain Scraping Ledger Details HUD details table */}
              <div className="bg-slate-950 border border-slate-850 rounded-xl p-4 sm:p-5">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Database className="w-4 h-4 text-amber-500" />
                  Mangkas Telemetri On-Chain Ledger ({selectedSymbol})
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-semibold">
                  
                  <div className="bg-slate-900/60 border border-slate-850 p-3 rounded-lg">
                    <div className="text-slate-500 mb-1">Transaksi Besar Institusi (&gt;$100k)</div>
                    <div className="text-slate-200 text-sm font-mono font-bold flex items-center justify-between">
                      <span>{data.metrics.whaleTransactions24h} kali</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                  </div>

                  <div className="bg-slate-900/60 border border-slate-850 p-3 rounded-lg">
                    <div className="text-slate-500 mb-1">Biaya Gas / Biaya Transaksi</div>
                    <div className="text-slate-200 text-sm font-mono font-bold flex items-center justify-between">
                      <span>{data.metrics.averageGasFee}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-bold">Ledger</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/60 border border-slate-850 p-3 rounded-lg">
                    <div className="text-slate-500 mb-1">Sentimen Diskusi Sosial</div>
                    <div className="text-slate-200 text-sm font-mono font-bold flex items-center justify-between">
                      <span>{data.metrics.socialSentiment}</span>
                      <span className="text-[9px] text-emerald-400 font-bold">Positive</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/60 border border-slate-850 p-3 rounded-lg">
                    <div className="text-slate-500 mb-1">Scraped Source Nodes</div>
                    <div className="text-slate-400 text-[10px] font-mono leading-tight hover:text-slate-200 transition-colors">
                      {data.metrics.scrapedSource}
                    </div>
                  </div>

                </div>
              </div>

              {/* AI Expert Analysis Explanation report output from Gemini */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                <div className="px-5 py-4 bg-gradient-to-r from-slate-900 to-slate-950 border-b border-slate-850 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-bold text-slate-100 uppercase tracking-wider font-sans">
                      Hasil Evaluasi Kuantitatif & Sinyal AI Gemini
                    </span>
                  </div>
                  
                  <div className="text-[9px] text-slate-500 font-mono">
                    Scraped: {lastScrapedAt || "Active Feed"} UTC
                  </div>
                </div>

                <div className="p-5 sm:p-6 prose prose-invert max-w-none text-slate-300 text-xs sm:text-xs leading-relaxed space-y-4">
                  {loading && (
                    <div className="inline-flex items-center space-x-2 text-amber-400 mb-2 font-semibold">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Scraper menyerap input baru di latar belakang...</span>
                    </div>
                  )}

                  {data?.isFallback && (
                    <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg flex items-start gap-2.5 text-[10.5px]">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                      <div>
                        <strong className="font-bold">Mode Prediksi Kuantitatif Lokal Aktif</strong>
                        <p className="mt-0.5 leading-relaxed text-slate-300">
                          Kuota API gratis Gemini Anda sedang penuh hari ini. Sistem kami mengaktifkan Model Simulasi Perdagangan CFA on-chain hibrida lokal berdensitas tinggi agar audit sinyal dan taktis stop-loss tetap terbit seketika tanpa jeda delay!
                        </p>
                      </div>
                    </div>
                  )}
                  
                  <div className="markdown-body">
                    <Markdown>{data.analysis}</Markdown>
                  </div>
                </div>
              </div>

            </div>
          ) : (
            <div className="text-center bg-slate-900 border border-slate-800 rounded-xl p-12 text-slate-400 text-xs">
              Membangun data analitik. Klik koin untuk memulai.
            </div>
          )}

        </div>

      </div>

      {/* METRICS & HISTORY SECTION: REKAP KINERJA & RIWAYAT SINYAL AI REAL-TIME */}
      <div className="mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-6" id="ai-performance-ledger-tracking">
        
        {/* Section Header */}
        <div className="border-b border-slate-800 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-amber-500" />
              Rekap Kinerja & Riwayat Sinyal AI Terkini
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Pelacakan akurasi sinyal terbitan AI secara live. Status sinyal berpindah ke <span className="text-emerald-400 font-semibold">TARGET HIT (TP)</span> atau <span className="text-rose-400 font-semibold">STOP LOSS (SL)</span> ketika harga running menyentuh batas di pasar bursa.
            </p>
          </div>
          
          <div className="flex items-center space-x-2 self-start md:self-auto text-[10px] bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800/60 font-mono text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            <span>Memonitor Harga & Triggers (5s)</span>
          </div>
        </div>

        {/* Global Summary Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Card 1: Win Rate */}
          <div className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Tingkat Akurasi (Win-Rate)</span>
            <div className="my-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-mono font-black text-emerald-400">{metrics?.winRate != null ? `${metrics.winRate}%` : "—"}</span>
              <span className="text-[10px] text-slate-500 font-mono">CFA Target &gt;70%</span>
            </div>
            <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-emerald-500 h-full rounded-full transition-all duration-1000" 
                style={{ width: `${metrics?.winRate ?? 0}%` }}
              />
            </div>
          </div>

          {/* Card 2: TP Success */}
          <div className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Target TP Terpenuhi</span>
            <div className="my-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-mono font-black text-slate-100">{metrics?.totalTp ?? "—"}</span>
              <span className="text-xs text-emerald-500 font-semibold">Sinyal Profit</span>
            </div>
            <p className="text-[9px] text-slate-500 font-mono leading-none">Mencapai Target Take Profit Utama</p>
          </div>

          {/* Card 3: SL Triggered */}
          <div className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Stop Loss (SL) Terpicu</span>
            <div className="my-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-mono font-black text-rose-400">{metrics?.totalSl ?? "—"}</span>
              <span className="text-xs text-rose-500 font-semibold">Batas Proteksi</span>
            </div>
            <p className="text-[9px] text-slate-500 font-mono leading-none">Mengaktifkan Fitur Batas Risiko Defensif</p>
          </div>

          {/* Card 4: Active Pending */}
          <div className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Sinyal Berjalan (Live)</span>
            <div className="my-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-mono font-black text-amber-500 animate-pulse">{metrics?.totalPending ?? "—"}</span>
              <span className="text-xs text-amber-500 font-semibold">Pending</span>
            </div>
            <p className="text-[9px] text-slate-500 font-mono leading-none">Menunggu Sentuhan Batas TP / SL</p>
          </div>

        </div>

        {/* Timeframe Performance Breakdown (Intraday, Harian, Mingguan Recap) */}
        <div>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-blue-400" />
            Rekap Kinerja berdasarkan Rentang Waktu (Timeframe Recap)
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* INTRADAY */}
            <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3">
              <div className="flex justify-between items-center border-b border-slate-800/55 pb-2">
                <span className="text-xs font-bold text-slate-200">⏱️ Intraday (Menit - Jam)</span>
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  WR {metrics?.timeframeRecap?.intraday?.winRate != null ? `${metrics.timeframeRecap.intraday.winRate}%` : "—"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-mono font-medium">
                <div className="bg-slate-900/40 p-1.5 rounded">
                  <div className="text-slate-500 font-sans">Total</div>
                  <div className="text-slate-300 font-bold">{metrics?.timeframeRecap?.intraday?.total ?? "—"}</div>
                </div>
                <div className="bg-emerald-950/20 p-1.5 rounded text-emerald-400">
                  <div className="text-slate-500 font-sans">TP Hit</div>
                  <div className="text-emerald-400 font-bold">{metrics?.timeframeRecap?.intraday?.tp ?? "—"}</div>
                </div>
                <div className="bg-rose-950/20 p-1.5 rounded text-rose-400">
                  <div className="text-slate-500 font-sans">SL Hit</div>
                  <div className="text-rose-400 font-bold">{metrics?.timeframeRecap?.intraday?.sl ?? "—"}</div>
                </div>
                <div className="bg-amber-950/20 p-1.5 rounded text-amber-500">
                  <div className="text-slate-500 font-sans">Aktif</div>
                  <div className="text-amber-500 font-bold">{metrics?.timeframeRecap?.intraday?.pending ?? "—"}</div>
                </div>
              </div>
              <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full" style={{ width: `${metrics?.timeframeRecap?.intraday?.winRate ?? 0}%` }} />
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">Ideal untuk strategi Scalping cepat berdaya volatilitas tinggi harian bursa.</p>
            </div>

            {/* HARIAN */}
            <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3">
              <div className="flex justify-between items-center border-b border-slate-800/55 pb-2">
                <span className="text-xs font-bold text-slate-200">📅 Harian (Swing 1-3 Hari)</span>
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  WR {metrics?.timeframeRecap?.daily?.winRate != null ? `${metrics.timeframeRecap.daily.winRate}%` : "—"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-mono font-medium">
                <div className="bg-slate-900/40 p-1.5 rounded">
                  <div className="text-slate-500 font-sans">Total</div>
                  <div className="text-slate-300 font-bold">{metrics?.timeframeRecap?.daily?.total ?? "—"}</div>
                </div>
                <div className="bg-emerald-950/20 p-1.5 rounded text-emerald-400">
                  <div className="text-slate-500 font-sans">TP Hit</div>
                  <div className="text-emerald-400 font-bold">{metrics?.timeframeRecap?.daily?.tp ?? "—"}</div>
                </div>
                <div className="bg-rose-950/20 p-1.5 rounded text-rose-400">
                  <div className="text-slate-500 font-sans">SL Hit</div>
                  <div className="text-rose-400 font-bold">{metrics?.timeframeRecap?.daily?.sl ?? "—"}</div>
                </div>
                <div className="bg-amber-950/20 p-1.5 rounded text-amber-500">
                  <div className="text-slate-500 font-sans">Aktif</div>
                  <div className="text-amber-500 font-bold">{metrics?.timeframeRecap?.daily?.pending ?? "—"}</div>
                </div>
              </div>
              <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full" style={{ width: `${metrics?.timeframeRecap?.daily?.winRate ?? 0}%` }} />
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">Strategi Swing momentum mengejar likuiditas onchain dari paus jangka pendek.</p>
            </div>

            {/* MINGGUAN */}
            <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl space-y-3">
              <div className="flex justify-between items-center border-b border-slate-800/55 pb-2">
                <span className="text-xs font-bold text-slate-200">🛡️ Mingguan (Trend Ayunan)</span>
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  WR {metrics?.timeframeRecap?.weekly?.winRate != null ? `${metrics.timeframeRecap.weekly.winRate}%` : "—"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-mono font-medium">
                <div className="bg-slate-900/40 p-1.5 rounded">
                  <div className="text-slate-500 font-sans">Total</div>
                  <div className="text-slate-300 font-bold">{metrics?.timeframeRecap?.weekly?.total ?? "—"}</div>
                </div>
                <div className="bg-emerald-950/20 p-1.5 rounded text-emerald-400">
                  <div className="text-slate-500 font-sans">TP Hit</div>
                  <div className="text-emerald-400 font-bold">{metrics?.timeframeRecap?.weekly?.tp ?? "—"}</div>
                </div>
                <div className="bg-rose-950/20 p-1.5 rounded text-rose-400">
                  <div className="text-slate-500 font-sans">SL Hit</div>
                  <div className="text-rose-400 font-bold">{metrics?.timeframeRecap?.weekly?.sl ?? "—"}</div>
                </div>
                <div className="bg-amber-950/20 p-1.5 rounded text-amber-500">
                  <div className="text-slate-500 font-sans">Aktif</div>
                  <div className="text-amber-500 font-bold">{metrics?.timeframeRecap?.weekly?.pending ?? "—"}</div>
                </div>
              </div>
              <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full" style={{ width: `${metrics?.timeframeRecap?.weekly?.winRate ?? 0}%` }} />
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">Kompatibel untuk mengawal siklus akumulasi fundamental makro investor bursa.</p>
            </div>

          </div>
        </div>

        {/* Live Signal History Ledger list with advanced filters */}
        <div className="border-t border-slate-800/80 pt-5 space-y-4">
          
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-850 space-y-4">
            
            {/* Upper filter bar row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-amber-500 animate-pulse" />
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-widest font-sans">
                  Saring dan Temukan Log Riwayat Sinyal AI Terkini
                </h4>
              </div>

              {/* Dynamic Size & Reset Indicators */}
              <div className="flex items-center space-x-3 text-[11px] font-mono text-slate-400 select-none">
                <div className="flex items-center space-x-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                  <span>Baris per halaman:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-amber-500 cursor-pointer text-center font-bold"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Structured filter options and dropdown selects */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
              
              {/* Option 1: Symbol selector */}
              <div className="space-y-1">
                <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block font-mono">Aset Koin:</label>
                <select
                  value={symbolFilter}
                  onChange={(e) => setSymbolFilter(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500 cursor-pointer font-semibold transition-colors"
                >
                  <option value="all">Semua Koin</option>
                  <option value="BTC">BTC (Bitcoin)</option>
                  <option value="ETH">ETH (Ethereum)</option>
                  <option value="SOL">SOL (Solana)</option>
                  <option value="BNB">BNB (Binance)</option>
                  <option value="DOGE">DOGE (Dogecoin)</option>
                  <option value="ADA">ADA (Cardano)</option>
                </select>
              </div>

              {/* Option 2: Timeframe selector */}
              <div className="space-y-1">
                <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block font-mono">Rentang Waktu:</label>
                <select
                  value={timeframeFilter}
                  onChange={(e) => setTimeframeFilter(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500 cursor-pointer font-semibold transition-colors"
                >
                  <option value="all">Semua Rentang</option>
                  <option value="intraday">Intraday</option>
                  <option value="daily">Harian</option>
                  <option value="weekly">Mingguan</option>
                </select>
              </div>

              {/* Option 3: Status Selector */}
              <div className="space-y-1">
                <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block font-mono">Status Sinyal:</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500 cursor-pointer font-semibold transition-colors"
                >
                  <option value="all">Semua Status</option>
                  <option value="PENDING">PENDING (Live)</option>
                  <option value="TARGET HIT (TP)">TARGET TP HIT (Profit)</option>
                  <option value="STOP LOSS (SL)">STOP LOSS SL (Risk Hit)</option>
                </select>
              </div>

              {/* Option 4: Buy / Sell Action Selector */}
              <div className="space-y-1">
                <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block font-mono">Sifat Rekomendasi:</label>
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500 cursor-pointer font-semibold transition-colors"
                >
                  <option value="all">Semua Jenis</option>
                  <option value="BUY">BUY / Sinyal Beli 🟢</option>
                  <option value="SELL">SELL / Sinyal Jual 🔴</option>
                  <option value="HOLD">HOLD / Menahan Saja 🟡</option>
                </select>
              </div>

              {/* Option 5: Sorting column handler */}
              <div className="space-y-1 col-span-2 lg:col-span-1">
                <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block font-mono">Urutkan Sesuai:</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none">
                    <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  </span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500 cursor-pointer font-semibold transition-colors"
                  >
                    <option value="timestamp-desc">Waktu (Terbaru)</option>
                    <option value="timestamp-asc">Waktu (Terlama)</option>
                    <option value="confidence-desc">Confidence (Tertinggi)</option>
                    <option value="confidence-asc">Confidence (Terendah)</option>
                    <option value="price-desc">Harga Entri (Tertinggi)</option>
                    <option value="price-asc">Harga Entri (Terendah)</option>
                  </select>
                </div>
              </div>

            </div>

            {/* Keyword Search Filter line input */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search className="w-4 h-4 text-slate-500" />
              </span>
              <input
                type="text"
                placeholder="Cari berdasarkan nama aset koin, status atau keyword nilai target harga..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800/80 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono transition-colors"
              />
            </div>

          </div>

          {/* Render Signal Items using Virtualized Paginated List */}
          <div className="space-y-2.5 overflow-y-auto max-h-[500px] pr-1">
            {paginatedSignals.length === 0 ? (
              <div className="text-center bg-slate-950/40 border border-dashed border-slate-850 p-10 rounded-xl text-slate-500 text-xs font-mono">
                {historyList.length === 0
                  ? "Tidak ada data sinyal AI yang terdeteksi saat ini."
                  : "Tidak ada data riwayat sinyal yang cocok dengan filter kriteria penyaringan Anda."}
              </div>
            ) : (
              paginatedSignals.map((sig) => {
                const isBuy = sig.recommendation.includes("BUY");
                const isSell = sig.recommendation.includes("SELL");
                
                // Style configurations inside local map
                const getStatusLabel = (status: string) => {
                  switch (status) {
                    case "TARGET HIT (TP)":
                      return (
                        <span className="inline-flex items-center gap-1.5 text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/25">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          PROFIT HIT (TP)
                        </span>
                      );
                    case "STOP LOSS (SL)":
                      return (
                        <span className="inline-flex items-center gap-1.5 text-[9px] font-mono font-bold bg-rose-500/10 text-rose-400 px-2 py-1 rounded border border-rose-500/25">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                          RISIKO BATAS SL (OUT)
                        </span>
                      );
                    default:
                      return (
                        <span className="inline-flex items-center gap-1.5 text-[9px] font-mono font-bold bg-amber-500/10 text-amber-400 px-2 py-1 rounded border border-amber-500/25 animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          AKTIF MEMONITOR
                        </span>
                      );
                  }
                };

                const getRecBadge = (rec: string) => {
                   if (rec.startsWith("STRONG BUY")) return "bg-emerald-500 text-slate-950 font-sans font-black text-[9px] px-1.5 py-0.5 rounded shadow-sm";
                   if (rec.startsWith("BUY")) return "bg-green-500/10 text-green-400 border border-green-500/30 text-[9px] px-1.5 py-0.5 rounded font-bold";
                   if (rec.startsWith("STRONG SELL")) return "bg-rose-500 text-slate-950 font-sans font-black text-[9px] px-1.5 py-0.5 rounded shadow-sm";
                   if (rec.startsWith("SELL")) return "bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[9px] px-1.5 py-0.5 rounded font-bold";
                   return "bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[9px] px-1.5 py-0.5 rounded font-bold";
                };

                const getRelativeTimeString = (iso: string) => {
                  try {
                    const diffMs = Date.now() - new Date(iso).getTime();
                    const secs = Math.floor(diffMs / 1000);
                    const mins = Math.floor(secs / 60);
                    const hours = Math.floor(mins / 60);
                    const days = Math.floor(hours / 24);

                    if (secs < 60) return "Baru saja";
                    if (mins < 60) return `${mins}m lalu`;
                    if (hours < 24) return `${hours}j lalu`;
                    return `${days}h lalu`;
                  } catch {
                    return "Baru saja";
                  }
                };

                const formatVal = (val: number) => {
                  if (val >= 1000) return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  if (val >= 1) return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
                  return val.toFixed(4);
                };

                return (
                  <div 
                    key={sig.id} 
                    className="bg-slate-950/40 border border-slate-850 hover:border-slate-800 hover:bg-slate-900/15 transition-all p-3.5 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    {/* Left side Metadata info details */}
                    <div className="flex items-center space-x-3">
                      <div className={`p-2.5 rounded-lg shrink-0 ${isBuy ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                        {isBuy ? (
                          <TrendingUp className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-rose-400" />
                        )}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-slate-100">{sig.symbol}</span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            ({sig.timeframe === "intraday" ? "Intraday" : sig.timeframe === "daily" ? "Harian" : "Mingguan"})
                          </span>
                          <span className={getRecBadge(sig.recommendation)}>{sig.recommendation}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                          Diterbitkan: <span className="text-slate-400">{getRelativeTimeString(sig.timestamp)}</span> • Akurasi AI: <span className="text-slate-300 font-bold">{sig.confidence}%</span>
                        </p>
                      </div>
                    </div>

                    {/* Middle pricing targets ledger details */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-950/80 px-4 py-2.5 rounded-xl border border-slate-900/60 font-mono text-xs max-w-full lg:max-w-xl self-start lg:self-auto w-full lg:w-auto">
                      <div>
                        <span className="text-[8px] text-slate-500 block">HARGA ENTRI</span>
                        <span className="text-slate-200 font-bold">${formatVal(sig.entryPrice)}</span>
                      </div>

                      <div>
                        <span className="text-[8px] text-emerald-500 block">TARGET TP</span>
                        <span className="text-emerald-400 font-bold">${formatVal(sig.tpPrice)}</span>
                      </div>

                      <div>
                        <span className="text-[8px] text-rose-400/80 block">STOP LOSS (SL)</span>
                        <span className="text-rose-400 font-bold">${formatVal(sig.slPrice)}</span>
                      </div>

                      <div>
                        <span className="text-[8px] text-slate-500 block">RUNNING PRICE</span>
                        <span className={`font-bold transition-all duration-300 ${sig.status === "TARGET HIT (TP)" ? "text-emerald-400" : sig.status === "STOP LOSS (SL)" ? "text-rose-400" : "text-amber-400"}`}>
                          ${formatVal(sig.currentPrice)}
                        </span>
                      </div>
                    </div>

                    {/* Right side status tags */}
                    <div className="flex items-center justify-between lg:justify-end gap-2 shrink-0 border-t border-slate-900/60 lg:border-t-0 pt-2.5 lg:pt-0">
                      {getStatusLabel(sig.status)}
                    </div>

                  </div>
                );
              })
            )}
          </div>

          {/* Table Sliding Pagination Navigation control footer bar */}
          {processedSignals.length > 0 && (
            <div className="p-4 bg-slate-950/60 border border-slate-850 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[11px] font-mono text-slate-400">
              <div>
                Menampilkan <span className="text-slate-200 font-semibold">{Math.min((activePageSignals - 1) * pageSize + 1, processedSignals.length)}</span> s/d{" "}
                <span className="text-slate-200 font-semibold">{Math.min(activePageSignals * pageSize, processedSignals.length)}</span> dari{" "}
                <span className="text-slate-200 font-semibold">{processedSignals.length}</span> sinyal{" "}
                {processedSignals.length !== historyList.length && (
                  <span>(disaring dari total {historyList.length})</span>
                )}
              </div>

              <div className="flex items-center space-x-1.5 select-none self-end sm:self-auto">
                <button
                  onClick={() => setCurrentPage(activePageSignals - 1)}
                  disabled={activePageSignals === 1}
                  className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer disabled:cursor-not-allowed transition-all"
                  title="Halaman Sebelumnya"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {/* Styled Page Numbers Ellipsis list */}
                <div className="flex items-center space-x-1">
                  {Array.from({ length: totalPagesSignals }, (_, i) => i + 1)
                    .filter((p) => {
                      return p === 1 || p === totalPagesSignals || Math.abs(p - activePageSignals) <= 1;
                    })
                    .map((p, index, arr) => {
                      const isSelected = p === activePageSignals;
                      const showEllipsisBefore = index > 0 && p - arr[index - 1] > 1;

                      return (
                        <React.Fragment key={p}>
                          {showEllipsisBefore && <span className="text-slate-700 px-0.5 font-sans">...</span>}
                          <button
                            onClick={() => setCurrentPage(p)}
                            className={`min-w-6 h-6 px-1.5 rounded transition-all font-semibold font-mono text-[10px] cursor-pointer ${
                              isSelected
                                ? "bg-amber-500 text-slate-950 font-bold"
                                : "bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white"
                            }`}
                          >
                            {p}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                <button
                  onClick={() => setCurrentPage(activePageSignals + 1)}
                  disabled={activePageSignals === totalPagesSignals}
                  className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer disabled:cursor-not-allowed transition-all"
                  title="Halaman Selanjutnya"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
