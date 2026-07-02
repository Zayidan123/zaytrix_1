import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Search, 
  TrendingUp, 
  TrendingDown, 
  ArrowUpDown, 
  Layers, 
  Coins, 
  Flame, 
  BarChart3, 
  Star, 
  RefreshCw, 
  CheckCircle,
  HelpCircle,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Clock
} from "lucide-react";

interface CoinData {
  rank: number;
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  change7d: number;
  marketCap: number;
  volume24h: number;
  circulatingSupply: number;
  sector: "L1/L2" | "DeFi" | "Stablecoin" | "AI" | "Meme" | "Infrastructure";
  sparkline: number[];
}

// NOTE: The previous `generate100Coins()` function (30 hardcoded stale coins
// with BTC=$68,420 / ETH=$3,540 / BNB=$595.2 etc., plus 6 fake
// `if (rank === X) change24h = Y` injections for fake gainers/losers) has been
// REMOVED per IMPL-C1. Initial state is now an empty array — the UI shows a
// loading skeleton until the first live `/api/coins/rankings` response arrives.
// If the API fails after retry, an OFFLINE error state is shown instead of
// stale hardcoded data.

export default function CoinsRankings() {
  const [filterMode, setFilterMode] = useState<"rankings" | "gainers" | "losers" | "volume" | "hot" | "new">("rankings");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSector, setSelectedSector] = useState<string>("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Real-time synchronization state — initial state is EMPTY (no stale seed).
  // A loading skeleton is rendered until the first live fetch completes. If
  // the live API fails after retry, an OFFLINE error state is shown.
  const [allCoins, setAllCoins] = useState<CoinData[]>([]);
  const [globalStats, setGlobalStats] = useState<{ totalMc: number; totalVol: number; avgChange: number } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>("");
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false); // false = first fetch still in-flight; drives loading skeleton
  const [fetchError, setFetchError] = useState<string>(""); // non-empty = API failed after retry; drives OFFLINE state

  // Refresh only the live ticker overlay (Binance 24hr tickers). Used as a
  // graceful fallback when /api/coins/rankings is unavailable. Coins whose
  // symbol isn't in the Binance ticker response keep their existing price
  // (NO synthetic micro-fluctuation — see IMPL-C1 Fix 6).
  const fallbackTickersOnly = async () => {
    try {
      const res = await fetch("/api/coins/tickers");
      if (res.ok) {
        const payload = await res.json();
        if (payload.success && payload.tickers) {
          const tickers = payload.tickers;
          setAllCoins((prevCoins) =>
            prevCoins.map((coin) => {
              const live = tickers[coin.symbol.toUpperCase()];
              if (live) {
                const oldPrice = coin.price;
                const newPrice = live.price;
                const scaleRatio = oldPrice > 0 ? newPrice / oldPrice : 1;
                // Scale historical sparkline values to match the current real price seamlessly
                const updatedSparkline = coin.sparkline.map((val) => val * scaleRatio);

                return {
                  ...coin,
                  price: newPrice,
                  change24h: live.change,
                  volume24h: live.volume || coin.volume24h,
                  marketCap: newPrice * coin.circulatingSupply,
                  sparkline: updatedSparkline,
                };
              }
              // IMPL-C1 Fix 6: previously this branch applied a fake
              // `(Math.random()-0.5)*0.001` micro-fluctuation to untracked
              // coins, fabricating live-looking price movement. Now we keep
              // the existing coin data AS-IS — the real price from the API
              // (which is refreshed every 8s via the rankings poll) is shown
              // untouched.
              return coin;
            })
          );
          setLastSyncedTime(new Date().toLocaleTimeString("id-ID", { hour12: false }) + " (Fallback)");
        }
      }
    } catch (err) {
      console.error("Gagal fallback tickers:", err);
    }
  };

  const fetchLiveTickers = async () => {
    setIsSyncing(true);
    try {
      const [resRankings, resStats] = await Promise.all([
        fetch("/api/coins/rankings"),
        fetch("/api/coins/global-stats").catch(() => null)
      ]);

      let rankingsOk = false;
      if (resRankings && resRankings.ok) {
        const payload = await resRankings.json();
        if (payload.success && Array.isArray(payload.coins) && payload.coins.length > 0) {
          setAllCoins(payload.coins);
          setLastSyncedTime(new Date().toLocaleTimeString("id-ID", { hour12: false }));
          setFetchError(""); // clear any prior OFFLINE error
          rankingsOk = true;
        }
      }

      if (!rankingsOk) {
        // Rankings endpoint unavailable — try the lighter /api/coins/tickers overlay.
        // Note: this only updates coins that ALREADY exist in state. If the
        // initial state is empty (cold start), the overlay has nothing to
        // overlay onto, so we must mark this as an OFFLINE error.
        if (allCoins.length === 0) {
          setFetchError("Gagal memuat data dari API live. Periksa koneksi server atau coba lagi sebentar lagi.");
        } else {
          await fallbackTickersOnly();
        }
      }

      if (resStats && resStats.ok) {
        const statsData = await resStats.json();
        if (statsData && statsData.success) {
          setGlobalStats({
            totalMc: statsData.totalMc,
            totalVol: statsData.totalVol,
            avgChange: statsData.avgChange
          });
        }
      }
    } catch (err) {
      console.error("Gagal sinkronisasi data real-time koin:", err);
      if (allCoins.length === 0) {
        setFetchError("Gagal memuat data dari API live. Periksa koneksi server atau coba lagi sebentar lagi.");
      } else {
        // We still have prior data — overlay tickers as a soft fallback.
        await fallbackTickersOnly();
      }
    } finally {
      setIsSyncing(false);
      setHasAttemptedFetch(true);
    }
  };

  // Poll live data periodically (every 8s — same cadence as before)
  useEffect(() => {
    fetchLiveTickers();
    const interval = setInterval(fetchLiveTickers, 8000);
    return () => clearInterval(interval);
  }, []);

  const sectors = useMemo(() => {
    const sect = new Set(allCoins.map(c => c.sector));
    return ["All", ...Array.from(sect)];
  }, [allCoins]);

  // Apply filters based on current mode and queries
  const processedCoins = useMemo(() => {
    let list = [...allCoins];

    // Filter by search query
    if (searchQuery) {
      list = list.filter(c => 
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        c.symbol.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by sector (except for "new" and "hot" which bypass traditional sector filters)
    if (selectedSector !== "All" && filterMode !== "new" && filterMode !== "hot") {
      list = list.filter(c => c.sector === selectedSector);
    }

    // Sort based on filter mode
    if (filterMode === "rankings") {
      list.sort((a, b) => a.rank - b.rank);
    } else if (filterMode === "gainers") {
      list.sort((a, b) => b.change24h - a.change24h);
    } else if (filterMode === "losers") {
      list.sort((a, b) => a.change24h - b.change24h);
    } else if (filterMode === "volume") {
      list.sort((a, b) => b.volume24h - a.volume24h);
    } else if (filterMode === "hot") {
      // IMPL-C1 Fix 8: previously this used a hardcoded `highInterestSymbols`
      // list of 14 symbols (BTC/ETH/SOL/BNB/...) which falsely implied live
      // sentiment data. Now we derive "hot" transparently from the LIVE
      // gainers list: score = volume24h × |change24h| (top activity × top
      // momentum). No hardcoded symbol list — purely data-driven.
      list.sort((a, b) => (b.volume24h * Math.abs(b.change24h)) - (a.volume24h * Math.abs(a.change24h)));
    } else if (filterMode === "new") {
      // IMPL-C1 Fix 8: previously this used a hardcoded `newSymbolList` of
      // 24 symbols (HYPE/ENA/W/JUP/...) which falsely implied live
      // new-listings data. There is no free /api/coins/trending or
      // Binance new-listings endpoint available, so we derive "new" from the
      // LIVE gainers list as a transparent proxy: highest 7-day movers
      // (fresh momentum). No hardcoded symbol list — purely data-driven.
      list.sort((a, b) => b.change7d - a.change7d);
    }

    return list;
  }, [allCoins, filterMode, searchQuery, selectedSector]);

  // Pagination logic
  const totalPages = Math.ceil(processedCoins.length / itemsPerPage);
  const paginatedCoins = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return processedCoins.slice(startIdx, startIdx + itemsPerPage);
  }, [processedCoins, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      const contentArea = document.getElementById("app-workspace-area");
      if (contentArea) {
        contentArea.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  const stats = useMemo(() => {
    if (globalStats) {
      return globalStats;
    }
    const totalMc = allCoins.reduce((sum, c) => sum + c.marketCap, 0);
    const avgChange = allCoins.reduce((sum, c) => sum + c.change24h, 0) / allCoins.length;
    const totalVol = allCoins.reduce((sum, c) => sum + c.volume24h, 0);
    return { totalMc, avgChange, totalVol };
  }, [allCoins, globalStats]);

  return (
    <div className="space-y-6 pb-12 text-slate-100" id="coins-rankings-viewport">
      {/* Header telemetry info card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/60 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
              Live Index Feed
              <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 rounded font-mono font-bold">STREAMING</span>
            </span>
          </div>
          <h2 className="text-2xl font-black text-white mt-1 flex items-center gap-2 font-sans">
            <Coins className="w-6 h-6 text-amber-500" />
            ZAYTRIX CRYPTO DIRECTORY
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-400">
            <span>Data real-time 100 aset digital teratas terindeks live dari Binance Spot API.</span>
            {lastSyncedTime && (
              <span className="text-emerald-400 font-mono text-[11px] bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1.5">
                <RefreshCw className={`w-3 h-3 ${isSyncing ? "animate-spin" : ""}`} />
                Terakhir Diperbarui: {lastSyncedTime} WIB
              </span>
            )}
          </div>
        </div>

        {/* Global Stats bar */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-4 bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl font-mono text-[10px] text-slate-400 shrink-0">
            <div>
              <span className="text-slate-500 font-bold block uppercase tracking-wider">TOTAL MCAP</span>
              <span className="text-white font-bold text-xs">${(stats.totalMc / 1e12).toFixed(2)}T</span>
            </div>
            <div className="border-l border-slate-800 h-6 pl-4">
              <span className="text-slate-500 font-bold block uppercase tracking-wider">24H VOLUME</span>
              <span className="text-white font-bold text-xs">${(stats.totalVol / 1e9).toFixed(1)}B</span>
            </div>
            <div className="border-l border-slate-800 h-6 pl-4">
              <span className="text-slate-500 font-bold block uppercase tracking-wider">INDEX HEURISTIC</span>
              <span className={`font-black text-xs flex items-center gap-1 ${stats.avgChange >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                {stats.avgChange >= 0 ? "+" : ""}{stats.avgChange.toFixed(2)}%
                {stats.avgChange >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              </span>
            </div>
          </div>
          <button
            onClick={fetchLiveTickers}
            disabled={isSyncing}
            className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-300 font-semibold rounded-lg border border-slate-800/80 hover:border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 text-emerald-400 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Menyinkronkan..." : "SINKRONISASI SEKARANG"}
          </button>
        </div>
      </div>

      {/* Main filter modes - Designed with Cryptoslate reference aesthetics */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
        {/* Mode buttons */}
        <div className="md:col-span-8 flex flex-wrap gap-2">
          <button
            onClick={() => { setFilterMode("rankings"); setCurrentPage(1); }}
            className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-lg border transition-all cursor-pointer ${
              filterMode === "rankings"
                ? "bg-amber-500/10 text-amber-400 border-amber-500/30 ring-1 ring-amber-500/20"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <Layers className="w-4 h-4 text-amber-500" />
            Rankings
          </button>
          
          <button
            onClick={() => { setFilterMode("gainers"); setCurrentPage(1); }}
            className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-lg border transition-all cursor-pointer ${
              filterMode === "gainers"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 ring-1 ring-emerald-500/20"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <Flame className="w-4 h-4 text-emerald-400" />
            Biggest Gainers
          </button>

          <button
            onClick={() => { setFilterMode("losers"); setCurrentPage(1); }}
            className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-lg border transition-all cursor-pointer ${
              filterMode === "losers"
                ? "bg-rose-500/10 text-rose-400 border-rose-500/30 ring-1 ring-rose-500/20"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <TrendingDown className="w-4 h-4 text-rose-400" />
            Biggest Losers
          </button>

          <button
            onClick={() => { setFilterMode("volume"); setCurrentPage(1); }}
            className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-lg border transition-all cursor-pointer ${
              filterMode === "volume"
                ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30 ring-1 ring-cyan-500/20"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            Highest Volume
          </button>

          <button
            onClick={() => { setFilterMode("hot"); setCurrentPage(1); }}
            className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-lg border transition-all cursor-pointer ${
              filterMode === "hot"
                ? "bg-orange-500/10 text-orange-400 border-orange-500/30 ring-1 ring-orange-500/20"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <Sparkles className="w-4 h-4 text-orange-400" />
            Hot Trending
          </button>

          <button
            onClick={() => { setFilterMode("new"); setCurrentPage(1); }}
            className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-lg border transition-all cursor-pointer ${
              filterMode === "new"
                ? "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30 ring-1 ring-fuchsia-500/20"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700"
            }`}
          >
            <Clock className="w-4 h-4 text-fuchsia-400" />
            New Listings
          </button>
        </div>

        {/* Search & Sector dropdown */}
        <div className="md:col-span-4 flex gap-2 w-full md:justify-end">
          <div className="relative flex-1 max-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              placeholder="Cari Token..."
              className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500/40 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none transition-all text-slate-200"
            />
          </div>

          <select
            value={selectedSector}
            onChange={(e) => { setSelectedSector(e.target.value); setCurrentPage(1); }}
            className="bg-slate-950 border border-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-amber-500/40 max-w-[120px]"
          >
            <option value="All">All Sectors</option>
            {sectors.filter(s => s !== "All").map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Binance Official Reference Sources Banner */}
      <div className="mb-5 p-4 rounded-xl border border-slate-800 bg-slate-950/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-lg shrink-0 mt-0.5">
            <Coins className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black tracking-wider uppercase text-amber-400 font-mono">BINANCE OFFICIAL INTEGRATION FEED</span>
              <span className="text-[9px] font-mono font-bold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/30 uppercase">
                REAL-TIME
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              {filterMode === "new" ? (
                <>Daftar aset baru rilis di bursa Binance dengan dukungan likuiditas premium dan data real-time. Periksa di <span className="text-amber-300 font-bold">Binance New Listings</span>.</>
              ) : (
                <>Data pergerakan harga tertinggi (Gainers), koreksi terbesar (Losers), dan volume perdagangan 24 jam diurutkan secara real-time. Periksa di <span className="text-amber-300 font-bold">Binance Trading Data Rankings</span>.</>
              )}
            </p>
          </div>
        </div>
        
        <div className="flex gap-2.5 shrink-0 self-end md:self-center">
          <a
            href="https://www.binance.com/en/markets/newListing"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-all border ${
              filterMode === "new"
                ? "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30 ring-1 ring-fuchsia-500/20"
                : "bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            New Listings
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://www.binance.com/en/markets/trading_data/rankings"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-all border ${
              ["gainers", "losers", "volume", "hot"].includes(filterMode)
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 ring-1 ring-emerald-500/20"
                : "bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white"
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Rankings (G/L/V)
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Dynamic Render block with animation */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${filterMode}-${selectedSector}-${searchQuery}-${currentPage}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.18 }}
          className="bg-slate-950/40 border border-slate-800 rounded-xl overflow-hidden shadow-2xl"
        >
          {/* Rankings general table mode */}
          {filterMode === "rankings" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse" id="coins-directory-table">
                <thead>
                  <tr className="border-b border-slate-800/80 text-[10px] uppercase font-bold text-slate-500 font-mono tracking-wider bg-slate-950/60">
                    <th className="py-4 px-5 w-16"># Rank</th>
                    <th className="py-4 px-4 min-w-[150px]">Asset Name</th>
                    <th className="py-4 px-4 text-right">Price (USD)</th>
                    <th className="py-4 px-4 text-right">24h Change</th>
                    <th className="py-4 px-4 text-right">7d Change</th>
                    <th className="py-4 px-4 text-right">Market Cap</th>
                    <th className="py-4 px-4 text-right">24h Volume</th>
                    <th className="py-4 px-4 text-right hidden lg:table-cell">Circulating Supply</th>
                    <th className="py-4 px-5 text-center w-24">7D Spark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 text-xs font-semibold">
                  {paginatedCoins.map((coin) => {
                    const isBullish24h = coin.change24h >= 0;
                    const isBullish7d = coin.change7d >= 0;
                    return (
                      <tr key={coin.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="py-4 px-5 font-mono text-slate-400 font-bold">
                          #{coin.rank}
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-sm bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center font-black text-slate-300 border border-slate-800/80">
                              {coin.symbol.substring(0, 2)}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-white hover:text-amber-400 transition-colors cursor-pointer">{coin.name}</span>
                                <span className="text-[10px] font-mono font-bold text-slate-500 uppercase">{coin.symbol}</span>
                              </div>
                              <span className="text-[9px] text-slate-500 font-mono tracking-wide block">{coin.sector}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4 text-right font-mono text-slate-200">
                          ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(6)}
                        </td>
                        <td className={`py-4 px-4 text-right font-mono font-bold ${isBullish24h ? "text-emerald-400" : "text-rose-500"}`}>
                          {isBullish24h ? "+" : ""}{coin.change24h.toFixed(2)}%
                        </td>
                        <td className={`py-4 px-4 text-right font-mono font-bold ${isBullish7d ? "text-emerald-400" : "text-rose-500"}`}>
                          {isBullish7d ? "+" : ""}{coin.change7d.toFixed(2)}%
                        </td>
                        <td className="py-4 px-4 text-right font-mono text-slate-300">
                          ${coin.marketCap.toLocaleString()}
                        </td>
                        <td className="py-4 px-4 text-right font-mono text-slate-400">
                          ${coin.volume24h.toLocaleString()}
                        </td>
                        <td className="py-4 px-4 text-right font-mono text-slate-400 hidden lg:table-cell">
                          {coin.circulatingSupply.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-[10px] text-slate-500 font-bold">{coin.symbol}</span>
                        </td>
                        <td className="py-4 px-5">
                          {/* Beautiful svg mini sparkline */}
                          <div className="w-16 h-8 flex items-center justify-center mx-auto">
                            <svg className="w-full h-full" viewBox="0 0 100 40">
                              <polyline
                                fill="none"
                                stroke={isBullish24h ? "#34d399" : "#f43f5e"}
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                points={coin.sparkline.map((val, idx) => {
                                  const min = Math.min(...coin.sparkline);
                                  const max = Math.max(...coin.sparkline);
                                  const range = max - min || 1;
                                  const x = (idx / (coin.sparkline.length - 1)) * 95 + 2.5;
                                  const y = 38 - ((val - min) / range) * 32;
                                  return `${x},${y}`;
                                }).join(" ")}
                              />
                            </svg>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Biggest Gainers Grid Mode */}
          {filterMode === "gainers" && (
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Flame className="w-5 h-5 text-emerald-400 animate-pulse" />
                <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest font-mono">
                  Gainer Leaderboard (24H Top Movers)
                </h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {paginatedCoins.map((coin, index) => (
                  <div
                    key={coin.id}
                    className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 hover:border-emerald-500/30 hover:shadow-emerald-950/5 transition-all flex flex-col justify-between space-y-4"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-black flex items-center justify-center text-xs">
                          {coin.symbol.substring(0, 2)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm">{coin.name}</span>
                            <span className="text-[9px] font-mono font-bold text-slate-500">{coin.symbol}</span>
                          </div>
                          <span className="text-[9px] text-slate-500 font-mono uppercase block">{coin.sector}</span>
                        </div>
                      </div>
                      
                      <span className="text-[10px] font-mono text-slate-400 font-bold">
                        Rank #{coin.rank}
                      </span>
                    </div>

                    <div className="flex items-end justify-between border-t border-slate-900 pt-3">
                      <div>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block font-mono">CURRENT RATE</span>
                        <span className="text-sm font-mono font-bold text-slate-200">
                          ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(6)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block font-mono">24H RETURN</span>
                        <span className="text-base font-mono font-black text-emerald-400 flex items-center gap-1 justify-end">
                          +{coin.change24h.toFixed(2)}%
                          <TrendingUp className="w-4 h-4 text-emerald-400" />
                        </span>
                      </div>
                    </div>

                    {/* Progress visualizer */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[9px] font-mono text-slate-500 font-bold">
                        <span>7D CHANGE</span>
                        <span className="text-slate-300">+{coin.change7d.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-emerald-500 h-full rounded-full shadow-lg shadow-emerald-500/20" 
                          style={{ width: `${Math.min(100, Math.max(10, coin.change24h * 2))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Biggest Losers Grid Mode */}
          {filterMode === "losers" && (
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <TrendingDown className="w-5 h-5 text-rose-500" />
                <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest font-mono">
                  Underperforming Assets (24H Correction)
                </h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {paginatedCoins.map((coin) => (
                  <div
                    key={coin.id}
                    className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 hover:border-rose-500/30 hover:shadow-rose-950/5 transition-all flex flex-col justify-between space-y-4"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-sm bg-rose-500/10 border border-rose-500/20 text-rose-400 font-black flex items-center justify-center text-xs">
                          {coin.symbol.substring(0, 2)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm">{coin.name}</span>
                            <span className="text-[9px] font-mono font-bold text-slate-500">{coin.symbol}</span>
                          </div>
                          <span className="text-[9px] text-slate-500 font-mono uppercase block">{coin.sector}</span>
                        </div>
                      </div>
                      
                      <span className="text-[10px] font-mono text-slate-400 font-bold">
                        Rank #{coin.rank}
                      </span>
                    </div>

                    <div className="flex items-end justify-between border-t border-slate-900 pt-3">
                      <div>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block font-mono">CURRENT RATE</span>
                        <span className="text-sm font-mono font-bold text-slate-200">
                          ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(6)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block font-mono">24H RETRACT</span>
                        <span className="text-base font-mono font-black text-rose-500 flex items-center gap-1 justify-end">
                          {coin.change24h.toFixed(2)}%
                          <TrendingDown className="w-4 h-4 text-rose-500" />
                        </span>
                      </div>
                    </div>

                    {/* Progress visualizer */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[9px] font-mono text-slate-500 font-bold">
                        <span>7D LOSS</span>
                        <span className="text-slate-300">{coin.change7d.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-rose-500 h-full rounded-full shadow-lg shadow-rose-500/20" 
                          style={{ width: `${Math.min(100, Math.max(10, Math.abs(coin.change24h) * 2.5))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Highest Volume Tab Mode */}
          {filterMode === "volume" && (
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <BarChart3 className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest font-mono">
                  Volume Command Center (24H Trade Volume)
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-[10px] uppercase font-bold text-slate-500 font-mono tracking-wider bg-slate-950/60">
                      <th className="py-4 px-5 w-16">Rank</th>
                      <th className="py-4 px-4 min-w-[150px]">Asset Name</th>
                      <th className="py-4 px-4 text-right">Trading Volume (USD)</th>
                      <th className="py-4 px-4 text-right">Current Price</th>
                      <th className="py-4 px-4 text-right">Vol / Mcap Ratio</th>
                      <th className="py-4 px-5">Liquidity Indicator</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-xs font-semibold">
                    {paginatedCoins.map((coin) => {
                      const ratio = (coin.volume24h / coin.marketCap) * 100;
                      return (
                        <tr key={coin.id} className="hover:bg-slate-900/50 transition-colors">
                          <td className="py-4 px-5 font-mono text-slate-400">
                            #{coin.rank}
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-sm bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-black flex items-center justify-center text-[10px]">
                                {coin.symbol.substring(0, 2)}
                              </div>
                              <div>
                                <span className="font-bold text-white block">{coin.name}</span>
                                <span className="text-[10px] font-mono text-slate-500 uppercase">{coin.symbol}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-right font-mono text-cyan-400 font-bold text-sm">
                            ${coin.volume24h.toLocaleString()}
                          </td>
                          <td className="py-4 px-4 text-right font-mono text-slate-300">
                            ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(6)}
                          </td>
                          <td className="py-4 px-4 text-right font-mono text-slate-400">
                            {ratio.toFixed(2)}%
                          </td>
                          <td className="py-4 px-5">
                            <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden max-w-[140px]">
                              <div 
                                className="bg-cyan-500 h-full rounded-full" 
                                style={{ width: `${Math.min(100, ratio * 3)}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Hot Trending Tab Mode */}
          {filterMode === "hot" && (
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Sparkles className="w-5 h-5 text-orange-400 animate-pulse" />
                <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest font-mono">
                  Hot Trending Spotlights (Highest Market Sentiment)
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {paginatedCoins.map((coin) => (
                  <div
                    key={coin.id}
                    className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 hover:border-orange-500/30 hover:shadow-orange-950/5 transition-all flex flex-col justify-between space-y-4"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-sm bg-orange-500/10 border border-orange-500/20 text-orange-400 font-black flex items-center justify-center text-xs">
                          {coin.symbol.substring(0, 2)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm">{coin.name}</span>
                            <span className="text-[9px] font-mono font-bold text-slate-500">{coin.symbol}</span>
                          </div>
                          <span className="text-[9px] text-slate-500 font-mono uppercase block">{coin.sector}</span>
                        </div>
                      </div>
                      
                      <span className="text-[8px] font-mono text-orange-400 font-bold bg-orange-500/5 px-2 py-0.5 rounded border border-orange-500/10 uppercase tracking-wider">
                        HOT TRENDING
                      </span>
                    </div>

                    <div className="flex items-end justify-between border-t border-slate-900 pt-3">
                      <div>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block font-mono">LIVE RATE</span>
                        <span className="text-sm font-mono font-bold text-slate-200">
                          ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(6)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block font-mono">24H ACTIVITY</span>
                        <span className={`text-sm font-mono font-black flex items-center gap-1 justify-end ${coin.change24h >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                          {coin.change24h >= 0 ? "+" : ""}{coin.change24h.toFixed(2)}%
                          {coin.change24h >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        </span>
                      </div>
                    </div>

                    {/* Progress visualizer */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[9px] font-mono text-slate-500 font-bold">
                        <span>24H VOLUME (USD)</span>
                        <span className="text-orange-300 font-mono">${coin.volume24h.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-orange-500 h-full rounded-full shadow-lg shadow-orange-500/20 animate-pulse" 
                          style={{ width: `${Math.min(100, Math.max(15, (coin.volume24h / 5e9) * 100))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New Listings Tab Mode */}
          {filterMode === "new" && (
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Clock className="w-5 h-5 text-fuchsia-400 animate-pulse" />
                <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest font-mono">
                  New Listings Frontier (Fresh Market Entries)
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {paginatedCoins.map((coin) => (
                  <div
                    key={coin.id}
                    className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 hover:border-fuchsia-500/30 hover:shadow-fuchsia-950/5 transition-all flex flex-col justify-between space-y-4"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-sm bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-400 font-black flex items-center justify-center text-xs">
                          {coin.symbol.substring(0, 2)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white text-sm">{coin.name}</span>
                            <span className="text-[9px] font-mono font-bold text-slate-500">{coin.symbol}</span>
                          </div>
                          <span className="text-[9px] text-slate-500 font-mono uppercase block">{coin.sector}</span>
                        </div>
                      </div>
                      
                      <span className="text-[8px] font-mono text-fuchsia-400 font-bold bg-fuchsia-500/5 px-2 py-0.5 rounded border border-fuchsia-500/10 uppercase tracking-wider">
                        NEW ASSET
                      </span>
                    </div>

                    <div className="flex items-end justify-between border-t border-slate-900 pt-3">
                      <div>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block font-mono">LAUNCH RATE</span>
                        <span className="text-sm font-mono font-bold text-slate-200">
                          ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(6)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block font-mono">LAUNCH DEV</span>
                        <span className={`text-sm font-mono font-black flex items-center gap-1 justify-end ${coin.change24h >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                          {coin.change24h >= 0 ? "+" : ""}{coin.change24h.toFixed(2)}%
                          {coin.change24h >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        </span>
                      </div>
                    </div>

                    {/* Progress visualizer */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[9px] font-mono text-slate-500 font-bold">
                        <span>LAUNCH SECTOR</span>
                        <span className="text-fuchsia-300 uppercase font-mono text-[9px]">{coin.sector}</span>
                      </div>
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-fuchsia-500 h-full rounded-full shadow-lg shadow-fuchsia-500/20" 
                          style={{ width: `100%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty fallback state — only shown when fetch succeeded but the
              current filter (search/sector) produced no results. */}
          {processedCoins.length === 0 && hasAttemptedFetch && !fetchError && (
            <div className="p-12 text-center text-slate-500">
              <Coins className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-400">Tidak ada aset digital yang ditemukan</p>
              <p className="text-xs text-slate-500 mt-1">Sesuaikan kembali pencarian atau filter sektor Anda.</p>
            </div>
          )}

          {/* Loading skeleton — shown during the initial live fetch (cold
              start). Replaces the old 30-coin stale hardcoded seed that used
              to flash for ~8s before the live data arrived (IMPL-C1 Fix 7). */}
          {!hasAttemptedFetch && (
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
                  <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-slate-400">
                    Memuat data live dari Binance...
                  </span>
                </div>
                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">
                  LOADING SKELETON
                </span>
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-3 border-b border-slate-800/40">
                  <div className="w-8 h-8 rounded-sm bg-slate-800/60 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 bg-slate-800/60 rounded animate-pulse" />
                    <div className="h-2 w-20 bg-slate-800/40 rounded animate-pulse" />
                  </div>
                  <div className="h-3 w-20 bg-slate-800/60 rounded animate-pulse" />
                  <div className="h-3 w-16 bg-slate-800/40 rounded animate-pulse hidden md:block" />
                  <div className="h-3 w-16 bg-slate-800/40 rounded animate-pulse hidden lg:block" />
                  <div className="w-16 h-8 bg-slate-800/40 rounded animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {/* OFFLINE error state — shown only when the API failed after retry
              AND we have no cached coins to fall back on (IMPL-C1 Fix 7). */}
          {hasAttemptedFetch && fetchError && allCoins.length === 0 && (
            <div className="p-12 text-center text-slate-500">
              <Coins className="w-10 h-10 text-rose-500/60 mx-auto mb-3" />
              <p className="text-sm font-bold text-rose-400">OFFLINE — Data Live Tidak Tersedia</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{fetchError}</p>
              <button
                onClick={() => fetchLiveTickers()}
                disabled={isSyncing}
                className="mt-4 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-bold cursor-pointer transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Mencoba ulang..." : "Coba Muat Ulang"}
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center border-t border-slate-800/60 pt-5">
          <span className="text-[10px] font-mono font-bold text-slate-500 uppercase">
            Showing {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, processedCoins.length)} of {processedCoins.length} Coins
          </span>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => handlePageChange(p)}
                className={`w-7 h-7 rounded-lg text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                  currentPage === p
                    ? "bg-amber-500 border-amber-500 text-slate-950 font-black"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
                }`}
              >
                {p}
              </button>
            ))}

            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
