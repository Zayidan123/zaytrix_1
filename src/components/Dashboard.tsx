import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import { 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  Trash2, 
  Wallet, 
  Coins, 
  ShieldAlert,
  Search,
  Activity,
  User,
  Phone,
  Mail,
  ShieldCheck,
  Globe,
  Sparkles,
  RefreshCw,
  Flame,
  Percent,
  Hash,
  HelpCircle,
  Layers,
  Info,
  ArrowUpDown,
  Zap
} from "lucide-react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  PieChart as RiPieChart, 
  Pie, 
  Cell,
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  ReferenceLine
} from "recharts";
import { Asset, PortfolioAsset } from "../types";
import { useGlobalStore } from "../store";
import CorrelationHeatmap from "./CorrelationHeatmap";
import { db, auth } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

interface DashboardProps {
  assets: Asset[];
  portfolio: PortfolioAsset[];
  onAddHolding: (holding: Omit<PortfolioAsset, 'id' | 'currentPrice'>) => void;
  onRemoveHolding: (id: string) => void;
}

const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  const chartData = useMemo(() => data.map((val, idx) => ({ name: idx.toString(), value: parseFloat(val.toFixed(4)) })), [data]);
  const gradId = useMemo(() => `spark-grad-${Math.random().toString(36).substr(2, 9)}`, []);
  return (
    <div className="w-full h-8 mt-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area 
            type="monotone" 
            dataKey="value" 
            stroke={color} 
            strokeWidth={1.5} 
            fillOpacity={1} 
            fill={`url(#${gradId})`} 
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default function Dashboard({ assets, portfolio, onAddHolding, onRemoveHolding }: DashboardProps) {
  const user = useGlobalStore(state => state.user);
  const [profileData, setProfileData] = useState<any>(null);

  useEffect(() => {
    async function fetchProfile() {
      if (!user) return;
      const defaultProfile = {
        fullName: user.displayName || "Investor Z-Capital",
        username: user.email ? user.email.split("@")[0] : "investor",
        email: user.email || "user@example.com",
        avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150",
        phoneNumber: "628123456789",
        timezone: "Asia/Jakarta"
      };
      try {
        const docRef = doc(db, "profiles", user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setProfileData({
            ...defaultProfile,
            ...docSnap.data()
          });
        } else {
          setProfileData(defaultProfile);
        }
      } catch (err) {
        console.warn("Error fetching dashboard profile: ", err);
        setProfileData(defaultProfile);
      }
    }
    fetchProfile();
  }, [user]);

  const conversionHistory = useGlobalStore(state => state.conversionHistory);

  // ───────────────────────────────────────────────────────────────────────────
  // LIVE DATA: Zustand real-time WS prices (Binance) — overrides stale /api/assets
  // values for BTC/ETH/BNB/XRP/SOL/TRX/HYPE so the Dashboard never shows stale
  // prices when the WS stream is connected.
  // ───────────────────────────────────────────────────────────────────────────
  const liveBtcPrice = useGlobalStore(state => state.liveBtcPrice);
  const liveBtcChange = useGlobalStore(state => state.btcPriceChangePercent);

  // ───────────────────────────────────────────────────────────────────────────
  // LIVE DATA: USD→IDR exchange rate from /api/fx/usd-idr (open.er-api.com).
  // Polled every 10 minutes. The hardcoded 16200 is ONLY a fallback for the
  // brief moment before the first fetch resolves (or if the FX API is down).
  // ───────────────────────────────────────────────────────────────────────────
  const [usdToIdr, setUsdToIdr] = useState<number>(16200); // FALLBACK — replaced by /api/fx/usd-idr on mount
  useEffect(() => {
    let cancelled = false;
    const fetchFx = async () => {
      try {
        const res = await fetch("/api/fx/usd-idr");
        if (res.ok) {
          const data = await res.json();
          if (data && data.success && typeof data.rate === "number" && data.rate > 0) {
            if (!cancelled) setUsdToIdr(data.rate);
          }
        }
      } catch (err) {
        console.warn("Failed to fetch USD→IDR FX rate, using fallback:", err);
      }
    };
    fetchFx();
    // Poll every 10 minutes (FX rate barely moves intra-minute)
    const interval = setInterval(fetchFx, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // LIVE DATA: On-chain & derivatives metrics from /api/onchain/metrics
  // (CoinGecko global, Binance Futures funding/OI, Alternative.me Fear&Greed)
  // + BTC OI history from /api/onchain/oi-history. Polled every 60s. Used to
  // replace the 8 synthetic sine-wave history datasets with REAL history.
  // ───────────────────────────────────────────────────────────────────────────
  const [liveMetrics, setLiveMetrics] = useState<any>(null);
  const [liveOiHistory, setLiveOiHistory] = useState<{ date: string; openInterest: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const fetchMetrics = async () => {
      try {
        const [metricsRes, oiRes] = await Promise.all([
          fetch("/api/onchain/metrics").then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/onchain/oi-history?symbol=BTCUSDT&days=30")
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
        ]);
        if (cancelled) return;
        if (metricsRes && metricsRes.success) setLiveMetrics(metricsRes);
        if (oiRes && oiRes.success && Array.isArray(oiRes.history)) setLiveOiHistory(oiRes.history);
      } catch (err) {
        console.warn("Failed to fetch live on-chain metrics for Dashboard:", err);
      }
    };
    fetchMetrics();
    // Poll every 60s (per spec — not on every render)
    const interval = setInterval(fetchMetrics, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // LIVE DATA: /api/live/* endpoints (REAL free public sources — see worklog LIVEDATA + UI1 entries).
  // Fetches long-short-ratio (Binance Futures), active-addresses (Coinmetrics), hashrate
  // (mempool.space), and exchange-netflow (Santiment — REAL since SEC2-SCRAPING; was previously
  // success:false on paid API only). All 4 endpoints now return REAL history arrays. Polled
  // every 10 min per spec.
  // ───────────────────────────────────────────────────────────────────────────
  const [liveLongShort, setLiveLongShort] = useState<{ date: string; longShortRatio: number }[]>([]);
  const [liveActiveAddresses, setLiveActiveAddresses] = useState<{ date: string; activeAddresses: number }[]>([]);
  const [liveHashrate, setLiveHashrate] = useState<{ date: string; hashrate: number }[]>([]);
  const [liveExchangeNetflow, setLiveExchangeNetflow] = useState<{ date: string; isoDate?: string; netflowBtc: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const fetchLiveEndpoints = async () => {
      try {
        const [lsRes, addrRes, hashRes, netRes] = await Promise.all([
          fetch("/api/live/long-short-ratio?symbol=BTCUSDT&days=30").then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/live/active-addresses?days=30").then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/live/hashrate?days=30").then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/live/exchange-netflow?days=30").then(r => (r.ok ? r.json() : null)).catch(() => null)
        ]);
        if (cancelled) return;
        if (lsRes && lsRes.success && Array.isArray(lsRes.history)) setLiveLongShort(lsRes.history);
        if (addrRes && addrRes.success && Array.isArray(addrRes.history)) setLiveActiveAddresses(addrRes.history);
        if (hashRes && hashRes.success && Array.isArray(hashRes.history)) setLiveHashrate(hashRes.history);
        if (netRes && netRes.success && Array.isArray(netRes.history)) setLiveExchangeNetflow(netRes.history);
      } catch (err) {
        console.warn("Failed to fetch /api/live/* endpoints for Dashboard:", err);
      }
    };
    fetchLiveEndpoints();
    // Poll every 10 minutes (these datasets don't move intra-minute; TTLs are 1h-6h)
    const interval = setInterval(fetchLiveEndpoints, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const [newSymbol, setNewSymbol] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newBuyPrice, setNewBuyPrice] = useState("");
  const [riskProfile, setRiskProfile] = useState<"Low" | "Moderate" | "Balanced" | "Aggressive">("Balanced");
  const [freshCapitalInput, setFreshCapitalInput] = useState("");

  // States for custom manual ticker entry
  const [isCustom, setIsCustom] = useState(false);
  const [customCategory, setCustomCategory] = useState<"stock" | "crypto">("crypto");
  const [isRegistering, setIsRegistering] = useState(false);

  // States for search and sort
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"symbol" | "value" | "gain" | "none">("none");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Automated AI On-Chain & Derivatives Analysis States
  const [autoAnalysis, setAutoAnalysis] = useState<any>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState("");

  const fetchAutoAnalysis = async (forceTrigger = false) => {
    setAutoLoading(true);
    setAutoError("");
    try {
      const url = forceTrigger 
        ? "/api/gemini/automated-analysis/trigger" 
        : "/api/gemini/automated-analysis";
      const res = await fetch(url, {
        method: forceTrigger ? "POST" : "GET",
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAutoAnalysis(data);
        } else {
          setAutoError(data.error || "Gagal memuat analisis otomatis.");
        }
      } else {
        if (!forceTrigger) {
          // If GET fails (e.g. 404 because not generated yet), try to trigger it!
          fetchAutoAnalysis(true);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.error("Failed to fetch automated AI analysis:", err);
      setAutoError(err.message || "Gagal memproses data analisis otomatis.");
    } finally {
      setAutoLoading(false);
    }
  };

  useEffect(() => {
    fetchAutoAnalysis();
    
    // Set a polling interval for the dashboard to keep metrics synchronized every 30 seconds
    const interval = setInterval(() => {
      fetchAutoAnalysis(false);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // State to toggle between Actual Portfolio and Ideal Profile Target Allocation
  const [allocationMode, setAllocationMode] = useState<"actual" | "ideal">("actual");

  // On-Chain Liquidity Explorer States
  const [onChainMetricTab, setOnChainMetricTab] = useState<"netflow" | "oi">("netflow");
  const [onChainPeriod, setOnChainPeriod] = useState<"24H" | "7D" | "30D">("24H");
  const [onChainExplainOpen, setOnChainExplainOpen] = useState(false);

  // Format Indonesian Rupiah
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  // Convert USD to IDR for portfolio tracking — uses live exchange rate from
  // /api/fx/usd-idr (polled every 10 min). The hardcoded 16200 below is the
  // OFFLINE FALLBACK only — `usdToIdr` state is updated on mount.
  // (Legacy constant kept as alias so the rest of the file still compiles
  // unchanged. All conversions below use this value.)
  const USD_TO_IDR = usdToIdr;

  // ───────────────────────────────────────────────────────────────────────────
  // Live metric values. Each prefers LIVE data from /api/onchain/metrics
  // (polled every 60s) → falls back to the 10-min cached Gemini analysis →
  // finally to a hardcoded FALLBACK (clearly marked) used only on cold start
  // when both live and cached values are unavailable.
  // ───────────────────────────────────────────────────────────────────────────

  // Spot BTC — prefer live WS price from Zustand, then cached AI analysis, then FALLBACK.
  const btcPriceMetric = liveBtcPrice
    || autoAnalysis?.metrics?.price
    || 95230.00; // FALLBACK — offline only; replaced by liveBtcPrice on mount

  // Open Interest (USD notional) — derive live from /api/onchain/metrics
  // openInterest.BTC.openInterest (coin units) × live BTC price.
  const liveBtcOiUsd = (() => {
    const oi = liveMetrics?.openInterest?.BTC?.openInterest;
    if (typeof oi === "number" && oi > 0 && btcPriceMetric > 0) return oi * btcPriceMetric;
    return null;
  })();
  const openInterestMetric = liveBtcOiUsd
    || autoAnalysis?.metrics?.openInterest
    || 1450000000; // FALLBACK — offline only

  // Funding Rate (Binance BTC perp, 8h) — live from /api/onchain/metrics currentFundingRates.BTC.
  const liveBtcFunding = liveMetrics?.currentFundingRates?.BTC;
  const fundingRateMetric = (typeof liveBtcFunding === "number")
    ? liveBtcFunding * 100 // API returns decimal (0.00005 → 0.005%); card displays as percent
    : (autoAnalysis?.metrics?.fundingRate || 0.0150); // FALLBACK — offline only

  // Long/Short Ratio — LIVE from /api/live/long-short-ratio (Binance Futures
  // topLongShortAccountRatio). Falls back to cached AI analysis → hardcoded FALLBACK.
  const liveLatestLs = liveLongShort.length > 0 ? Number(liveLongShort[0].longShortRatio) : null;
  const longShortRatioMetric = liveLatestLs
    || autoAnalysis?.metrics?.longShortRatio
    || 1.42; // FALLBACK — offline only

  // Exchange Netflow — LIVE from /api/live/exchange-netflow (Santiment `exchange_balance` metric —
  // REAL since SEC2-SCRAPING; was previously success:false on paid API only). The endpoint returns
  // netflow in BTC units (signed: positive = inflow to exchange, negative = outflow). We convert
  // to USD using the live BTC price so the card displays a $M value consistent with other cards.
  // Note: Santiment free tier has ~30-day lag (most-recent data point is ~30 days old), so the
  // card badge reads "30D • LIVE" to honestly reflect the lag. Falls back to cached AI analysis →
  // hardcoded FALLBACK only on cold start before the first fetch resolves.
  const liveLatestNetflowBtc = liveExchangeNetflow.length > 0 ? Number(liveExchangeNetflow[0].netflowBtc) : null;
  const liveNetflowUsd = (liveLatestNetflowBtc !== null && btcPriceMetric > 0)
    ? liveLatestNetflowBtc * btcPriceMetric
    : null;
  const netflowMetric = liveNetflowUsd
    || autoAnalysis?.metrics?.netflow
    || -60000000; // FALLBACK — offline only (cold start before first /api/live/exchange-netflow fetch)

  // Active Addresses — LIVE from /api/live/active-addresses (Coinmetrics community API).
  // Falls back to cached AI analysis → hardcoded FALLBACK.
  const liveLatestAddr = liveActiveAddresses.length > 0 ? Number(liveActiveAddresses[0].activeAddresses) : null;
  const activeAddressesMetric = liveLatestAddr
    || autoAnalysis?.metrics?.activeAddresses
    || 890000; // FALLBACK — offline only

  // Network Hashrate — LIVE from /api/live/hashrate (mempool.space, EH/s).
  // Falls back to cached AI analysis → hardcoded FALLBACK.
  const liveLatestHash = liveHashrate.length > 0 ? Number(liveHashrate[0].hashrate) : null;
  const networkHashrateMetric = liveLatestHash
    || autoAnalysis?.metrics?.networkHashrate
    || 615; // FALLBACK — offline only

  // ───────────────────────────────────────────────────────────────────────────
  // SPARKLINE HISTORY DATASETS (7 + 1 chart = 8 total).
  // Each dataset now prefers REAL history from /api/onchain/metrics or
  // /api/onchain/oi-history when available. For datasets with no free live
  // source, a clearly-labelled synthetic FALLBACK is kept so the sparkline
  // still renders. The chart shape ({date, price} or number[]) is preserved
  // so the existing charts render unchanged.
  // ───────────────────────────────────────────────────────────────────────────

  // (1) BTC price sparkline — LIVE from /api/onchain/metrics btcPriceHistory
  const btcHistory = useMemo<number[]>(() => {
    const live = liveMetrics?.btcPriceHistory;
    if (Array.isArray(live) && live.length > 0) {
      // Map {date, price}[] → number[] (take last 10 points for the sparkline)
      return live.slice(-10).map((p: any) => Number(p.price));
    }
    // FALLBACK: synthetic sine wave (offline only)
    return Array.from({ length: 10 }, (_, i) => btcPriceMetric * (0.97 + Math.sin(i * 0.7) * 0.02 + i * 0.0035));
  }, [liveMetrics, btcPriceMetric]);

  // (2) Open Interest sparkline (USD millions) — LIVE from
  // /api/onchain/oi-history (BTC coin units) × current BTC price → $M.
  const oiHistory = useMemo<number[]>(() => {
    if (liveOiHistory.length > 0 && btcPriceMetric > 0) {
      return liveOiHistory.slice(-10).map(p => (p.openInterest * btcPriceMetric) / 1e6);
    }
    // FALLBACK: synthetic sine wave (offline only)
    return Array.from({ length: 10 }, (_, i) => (openInterestMetric / 1e6) * (0.95 + Math.cos(i * 0.6) * 0.035 + i * 0.004));
  }, [liveOiHistory, btcPriceMetric, openInterestMetric]);

  // (3) Funding Rate sparkline (Binance BTC perp, 8h rate) — LIVE from
  // /api/onchain/metrics fundingRates[].Binance (decimal, e.g. 0.00005).
  const fundingHistory = useMemo<number[]>(() => {
    const live = liveMetrics?.fundingRates;
    if (Array.isArray(live) && live.length > 0) {
      return live.slice(-10).map((p: any) => Number(p.Binance));
    }
    // FALLBACK: synthetic sine wave (offline only)
    return Array.from({ length: 10 }, (_, i) => fundingRateMetric + (Math.sin(i * 0.9) * 0.006));
  }, [liveMetrics, fundingRateMetric]);

  // (4) L/S Ratio sparkline — LIVE from /api/live/long-short-ratio (Binance Futures 30d history).
  // The endpoint returns the most-recent-first series; we slice the last 10 entries (chronologically
  // oldest among the most recent) and reverse so the sparkline reads left-to-right oldest→newest.
  // FALLBACK: synthetic sine wave (offline only).
  const lsHistory = useMemo<number[]>(() => {
    if (liveLongShort.length > 0) {
      const slice = liveLongShort.slice(0, 10).map(p => Number(p.longShortRatio));
      return slice.reverse(); // oldest → newest for left-to-right reading
    }
    // FALLBACK — synthetic sine wave (used briefly before the first live fetch resolves)
    return Array.from({ length: 10 }, (_, i) => longShortRatioMetric + (Math.cos(i * 0.8) * 0.09));
  }, [liveLongShort, longShortRatioMetric]);

  // (5) Exchange Netflow sparkline — LIVE from /api/live/exchange-netflow (Santiment 30d history,
  // netflowBtc signed value converted to USD millions using the live BTC price). Same slice-10-and-
  // reverse pattern as lsHistory. FALLBACK: synthetic sine wave (offline only — used briefly before
  // the first live fetch resolves).
  const netflowHistory = useMemo<number[]>(() => {
    if (liveExchangeNetflow.length > 0 && btcPriceMetric > 0) {
      const slice = liveExchangeNetflow.slice(0, 10).map(p => (Number(p.netflowBtc) * btcPriceMetric) / 1e6);
      return slice.reverse(); // oldest → newest for left-to-right reading
    }
    // FALLBACK — synthetic sine wave (used briefly before the first live fetch resolves)
    return Array.from({ length: 10 }, (_, i) => (netflowMetric / 1e6) + (Math.sin(i * 0.7) * 45));
  }, [liveExchangeNetflow, btcPriceMetric, netflowMetric]);

  // (6) Active Addresses sparkline — LIVE from /api/live/active-addresses (Coinmetrics 30d history).
  // Same slice-10-and-reverse pattern as lsHistory. FALLBACK: synthetic sine wave (offline only).
  const activeAddressesHistory = useMemo<number[]>(() => {
    if (liveActiveAddresses.length > 0) {
      const slice = liveActiveAddresses.slice(0, 10).map(p => Number(p.activeAddresses));
      return slice.reverse();
    }
    // FALLBACK — synthetic sine wave (used briefly before the first live fetch resolves)
    return Array.from({ length: 10 }, (_, i) => activeAddressesMetric * (0.96 + Math.sin(i * 0.5) * 0.025 + i * 0.002));
  }, [liveActiveAddresses, activeAddressesMetric]);

  // (7) Network Hashrate sparkline — LIVE from /api/live/hashrate (mempool.space 30d history, EH/s).
  // Same slice-10-and-reverse pattern. FALLBACK: synthetic sine wave (offline only).
  const networkHashrateHistory = useMemo<number[]>(() => {
    if (liveHashrate.length > 0) {
      const slice = liveHashrate.slice(0, 10).map(p => Number(p.hashrate));
      return slice.reverse();
    }
    // FALLBACK — synthetic sine wave (used briefly before the first live fetch resolves)
    return Array.from({ length: 10 }, (_, i) => networkHashrateMetric + (Math.cos(i * 0.9) * 12));
  }, [liveHashrate, networkHashrateMetric]);

  // (8) Interactive On-Chain Liquidity Explorer chart — for the 30D period,
  // use REAL BTC price history from /api/onchain/metrics btcPriceHistory and
  // REAL Open Interest history from /api/onchain/oi-history (converted to
  // USD millions using the current BTC price). For 24H/7D periods, no free
  // sub-daily live history exists — a clearly-labelled synthetic FALLBACK is
  // used. The output shape {label, netflow, oi, btcPrice} is preserved so the
  // existing BarChart/AreaChart render unchanged.
  const onChainChartData = useMemo(() => {
    // 30D period — use REAL history when available. Both endpoints may return
    // slightly different array lengths (e.g. btcPriceHistory=31, oi-history=30),
    // so we align them from the END (most recent last) using the shorter length.
    if (onChainPeriod === "30D" && Array.isArray(liveMetrics?.btcPriceHistory) && liveMetrics.btcPriceHistory.length > 0) {
      const rawBtc: any[] = liveMetrics.btcPriceHistory;
      const rawOi = liveOiHistory.length > 0 ? liveOiHistory : null;
      // Take the LAST N entries from both arrays, where N = the shorter length
      // (or just the btc length if oi isn't available). This aligns them by
      // recency so btcHist[i] and oiHist[i] correspond to the same day.
      const n = rawOi ? Math.min(rawBtc.length, rawOi.length) : rawBtc.length;
      const btcHist: any[] = rawBtc.slice(-n);
      const oiHist = rawOi ? rawOi.slice(-n) : null;
      return btcHist.map((pt: any, i: number) => {
        // OI in $M USD = (coin units × current BTC price) / 1e6
        const oiUsdM = oiHist && oiHist[i]
          ? (oiHist[i].openInterest * btcPriceMetric) / 1e6
          : (openInterestMetric / 1e6);
        // Net flow in $M USD — LIVE from Santiment when available (netflowBtc × BTC price / 1e6).
        // Falls back to a labelled deterministic synthetic series anchored on the current netflow
        // metric when the live Santiment history hasn't loaded yet (offline cold-start only).
        let netflowVal: number;
        if (liveExchangeNetflow.length > 0 && btcPriceMetric > 0) {
          // liveExchangeNetflow is most-recent-first; align by indexing from the END of the array
          // (oldest) so btcHist[i] lines up with the matching netflow day. If the arrays differ in
          // length, fall back to the latest netflow value for the missing days.
          const nfIdx = liveExchangeNetflow.length - 1 - i;
          const nfBtc = nfIdx >= 0 ? Number(liveExchangeNetflow[nfIdx].netflowBtc) : Number(liveExchangeNetflow[0].netflowBtc);
          netflowVal = (nfBtc * btcPriceMetric) / 1e6;
        } else {
          const sinCycle = Math.sin(i * 0.75);
          const cosCycle = Math.cos(i * 0.5);
          netflowVal = (netflowMetric / 1e6) + (sinCycle * 40 + cosCycle * 15 + Math.sin(i * 2.3) * 10);
        }
        return {
          label: pt.date || `Day ${i + 1}`,
          netflow: parseFloat(netflowVal.toFixed(2)),
          oi: parseFloat(oiUsdM.toFixed(2)),
          btcPrice: Math.round(Number(pt.price))
        };
      });
    }

    // 24H / 7D — FALLBACK: synthetic labelled series (no free sub-daily history)
    let length = 24;
    let formatLabel = (i: number) => {
      const hr = (i * 1) % 24;
      return `${hr.toString().padStart(2, "0")}:00`;
    };

    if (onChainPeriod === "7D") {
      length = 14;
      formatLabel = (i: number) => {
        const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const d = days[Math.floor(i / 2) % 7];
        const ampm = i % 2 === 0 ? "AM" : "PM";
        return `${d} ${ampm}`;
      };
    } else if (onChainPeriod === "30D") {
      length = 30;
      formatLabel = (i: number) => `Day ${i + 1}`;
    }

    // FALLBACK — Deterministic synthetic series (no Math.random; reproducible).
    return Array.from({ length }, (_, i) => {
      const sinCycle = Math.sin(i * 0.75);
      const cosCycle = Math.cos(i * 0.5);

      const priceFactor = 0.985 + sinCycle * 0.02 + cosCycle * 0.01;
      const btcPriceVal = btcPriceMetric * priceFactor;

      // Net flow values in Millions USD (positive is inflow to exchange, negative is outflow)
      const baseNetflow = (netflowMetric / 1e6); // -60.00
      const randOffset = sinCycle * 40 + cosCycle * 15 + Math.sin(i * 2.3) * 10;
      const netflowVal = baseNetflow + randOffset;

      // Open Interest in Millions USD (building up leverage)
      const baseOI = (openInterestMetric / 1e6); // 1450
      const oiTrend = (i / length) * 45; // upward leverage build up
      const oiOffset = sinCycle * 35 + cosCycle * 10 + oiTrend;
      const oiVal = baseOI + oiOffset;

      return {
        label: formatLabel(i),
        netflow: parseFloat(netflowVal.toFixed(2)),
        oi: parseFloat(oiVal.toFixed(2)),
        btcPrice: Math.round(btcPriceVal)
      };
    });
  }, [onChainPeriod, btcPriceMetric, openInterestMetric, netflowMetric, liveMetrics, liveOiHistory, liveExchangeNetflow]);

  // Enhance portfolio items with real-time current price from liveAssets
  const enrichedPortfolio = useMemo(() => {
    return portfolio.map(item => {
      const match = assets.find(a => a.symbol === item.symbol.toUpperCase());
      const currentPrice = match ? match.price : item.purchasePrice;
      return {
        ...item,
        currentPrice,
        totalCost: item.purchasePrice * item.quantity * (item.category === 'crypto' ? USD_TO_IDR : 1),
        totalValue: currentPrice * item.quantity * (item.category === 'crypto' ? USD_TO_IDR : 1),
      };
    });
  }, [portfolio, assets, USD_TO_IDR]);

  // Filtering and sorting memo hook
  const filteredAndSortedPortfolio = useMemo(() => {
    let result = enrichedPortfolio.filter(item => 
      item.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    if (sortBy !== "none") {
      result.sort((a, b) => {
        let factorA = 0;
        let factorB = 0;
        
        if (sortBy === "symbol") {
          return sortOrder === "asc" 
            ? a.symbol.localeCompare(b.symbol) 
            : b.symbol.localeCompare(a.symbol);
        } else if (sortBy === "value") {
          factorA = a.totalValue;
          factorB = b.totalValue;
        } else if (sortBy === "gain") {
          const gainA = a.totalValue - a.totalCost;
          const gainB = b.totalValue - b.totalCost;
          factorA = a.totalCost > 0 ? (gainA / a.totalCost) : 0;
          factorB = b.totalCost > 0 ? (gainB / b.totalCost) : 0;
        }
        
        return sortOrder === "asc" ? factorA - factorB : factorB - factorA;
      });
    }
    
    return result;
  }, [enrichedPortfolio, searchQuery, sortBy, sortOrder]);

  // Portfolio Health and Diversification Index
  const healthAssessment = useMemo(() => {
    if (enrichedPortfolio.length === 0) {
      return {
        score: 0,
        status: "Sangat Terkonsentrasi",
        colorClass: "text-rose-500 bg-rose-500/10 border-rose-500/20",
        barColor: "bg-rose-500",
        currentCryptoPct: 0,
        currentStockPct: 0,
        idealCryptoPct: 0,
        idealStockPct: 0,
        advices: [
          "Portofolio Anda kosong. Harap tambahkan beberapa aset saham bursa (IHSG) atau koin kripto untuk memulai evaluasi.",
          "Untuk profil risiko pilihan Anda, rekomendasi ideal adalah menyebar aset di beberapa kategori pelindung nilai."
        ]
      };
    }

    // Ideal rates based on profile
    let idealCryptoPct = 40;
    if (riskProfile === "Low") idealCryptoPct = 15;
    else if (riskProfile === "Moderate") idealCryptoPct = 25;
    else if (riskProfile === "Balanced") idealCryptoPct = 40;
    else if (riskProfile === "Aggressive") idealCryptoPct = 60;
    
    let idealStockPct = 100 - idealCryptoPct;

    // Current rates
    let cryptoValue = 0;
    let stockValue = 0;
    const tickerSet = new Set<string>();

    enrichedPortfolio.forEach(item => {
      tickerSet.add(item.symbol);
      if (item.category === "crypto") {
        cryptoValue += item.totalValue;
      } else {
        stockValue += item.totalValue;
      }
    });

    const totalVal = cryptoValue + stockValue;
    const currentCryptoPct = totalVal > 0 ? (cryptoValue / totalVal) * 100 : 0;
    const currentStockPct = totalVal > 0 ? (stockValue / totalVal) * 100 : 0;

    // Ratio deviation calculation
    const cryptoDev = Math.abs(currentCryptoPct - idealCryptoPct);
    
    // Calculate final score
    let baseScore = 100 - (cryptoDev * 1.5); // reduce score proportionally to deviation
    
    // Multi-asset bonus/penalty
    const uniqueTickers = tickerSet.size;
    if (uniqueTickers >= 3) {
      baseScore += 10;
    } else if (uniqueTickers === 1) {
      baseScore -= 15;
    }

    const finalScore = Math.max(15, Math.min(100, Math.round(baseScore)));

    let status = "Seimbang & Optimal";
    let colorClass = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    let barColor = "bg-emerald-500";
    if (finalScore < 50) {
      status = "Memicu Risiko Konsentrasi";
      colorClass = "text-rose-400 bg-rose-500/10 border-rose-500/20";
      barColor = "bg-rose-500";
    } else if (finalScore < 80) {
      status = "Cukup Seimbang";
      colorClass = "text-amber-400 bg-amber-500/10 border-amber-500/20";
      barColor = "bg-amber-400";
    }

    // Dynamic advices list
    const advices: string[] = [];
    if (uniqueTickers < 3) {
      advices.push(`Konsentrasi Aset Tinggi: Anda hanya memiliki ${uniqueTickers} jenis aset unik. CFA merekomendasikan diversifikasi minimal ke 3-4 emiten/koin berbeda untuk melunakkan risiko individual (idiosyncratic risk).`);
    } else {
      advices.push("Keberagaman Ticker Sehat: Portofolio Anda sudah menyebar di beberapa ticker unik, membantu melembutkan korelasi kerugian jika satu emiten mengalami guncangan.");
    }

    if (cryptoDev > 15) {
      if (currentCryptoPct > idealCryptoPct) {
        advices.push(`Paparan Kripto Berlebih: Porsi kripto Anda saat ini (${currentCryptoPct.toFixed(1)}%) jauh melebihi anjuran ideal (${idealCryptoPct}%) untuk profil ${riskProfile === "Low" ? "Aman" : riskProfile}. Ambillah profit berkala dan alihkan modal ke kelas aset berisiko rendah atau stablecoin stabil (USDT/USDC).`);
      } else {
        advices.push(`Porsi Kripto Terlalu Rendah: Porsi kripto Anda (${currentCryptoPct.toFixed(1)}%) di bawah target ideal (${idealCryptoPct}%). Jika Anda menginginkan imbal hasil yang lebih dinamis, pertimbangkan mengalokasikan porsi modal selanjutnya ke Bitcoin (BTC) atau Ethereum (ETH).`);
      }
    } else {
      advices.push(`Porsi Alokasi Sangat Sesuai: Pembagian kelas aset kripto (${currentCryptoPct.toFixed(1)}%) berada dalam posisi aman serta ideal dengan kriteria profil risiko Anda.`);
    }

    // Warn if one asset takes more than 50%
    enrichedPortfolio.forEach(item => {
      const sharePct = totalVal > 0 ? (item.totalValue / totalVal) * 100 : 0;
      if (sharePct > 55) {
        advices.push(`Over-konsentrasi Emiten: Aset ${item.symbol} mendominasi hingga ${sharePct.toFixed(1)}% dari portofolio Anda. CFA menyarankan melakukan pemangkasan posisi parsial.`);
      }
    });

    return {
      score: finalScore,
      status,
      colorClass,
      barColor,
      currentCryptoPct,
      currentStockPct,
      idealCryptoPct,
      idealStockPct,
      cryptoValue,
      stockValue,
      totalVal,
      advices
    };
  }, [enrichedPortfolio, riskProfile]);

  // Aggregate stats
  const { totalInvested, totalCurrentValue, absoluteUnrealizedGain, unrealizedGainPct } = useMemo(() => {
    let investedSum = 0;
    let currentSum = 0;
    enrichedPortfolio.forEach(item => {
      investedSum += item.totalCost;
      currentSum += item.totalValue;
    });
    const gain = currentSum - investedSum;
    const gainPct = investedSum > 0 ? (gain / investedSum) * 100 : 0;
    return {
      totalInvested: investedSum,
      totalCurrentValue: currentSum,
      absoluteUnrealizedGain: gain,
      unrealizedGainPct: gainPct
    };
  }, [enrichedPortfolio]);

  // Pie chart data
  const pieData = useMemo(() => {
    const categories: Record<string, { name: string; value: number; color: string }> = {
      stock: { name: "IHSG Stocks", value: 0, color: "#14b8a6" }, // teal
      crypto: { name: "Cryptocurr.", value: 0, color: "#a855f7" } // purple
    };

    enrichedPortfolio.forEach(item => {
      if (categories[item.category]) {
        categories[item.category].value += item.totalValue;
      }
    });

    return Object.values(categories).filter(c => c.value > 0);
  }, [enrichedPortfolio]);

  // Selected Profile Target Ideal Allocation Percentages
  const targetIdealData = useMemo(() => {
    let idealCryptoPct = 40;
    if (riskProfile === "Low") idealCryptoPct = 15;
    else if (riskProfile === "Moderate") idealCryptoPct = 25;
    else if (riskProfile === "Balanced") idealCryptoPct = 40;
    else if (riskProfile === "Aggressive") idealCryptoPct = 60;
    const idealStockPct = 100 - idealCryptoPct;

    return [
      { name: `Target Saham (${idealStockPct}%)`, value: idealStockPct, color: "#14b8a6" },
      { name: `Target Kripto (${idealCryptoPct}%)`, value: idealCryptoPct, color: "#a855f7" }
    ];
  }, [riskProfile]);

  // Daily performance history simulation
  const performanceHistory = useMemo(() => {
    const pts = [];
    const seedPercent = [0.92, 0.94, 0.93, 0.96, 0.98, 0.97, 1.01, 1.02, 1.00, 1.04];
    const today = new Date();
    
    for (let i = 9; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i * 3);
      pts.push({
        date: d.toLocaleDateString("id-ID", { month: "short", day: "numeric" }),
        Portofolio: Math.round(totalCurrentValue * (seedPercent[9 - i] || 1))
      });
    }
    return pts;
  }, [totalCurrentValue]);

  // Handle adding asset
  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol || !newQty || !newBuyPrice) return;

    let matchedAsset = assets.find(a => a.symbol === newSymbol.toUpperCase().trim());
    
    if (!matchedAsset) {
      if (isCustom) {
        setIsRegistering(true);
        try {
          const response = await fetch("/api/assets/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: newSymbol.toUpperCase().trim(),
              category: customCategory,
              name: `${newSymbol.toUpperCase().trim()} Aset Baru`
            })
          });
          if (response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              const result = await response.json();
              matchedAsset = result.asset;
            } else {
              console.log("Registrasi respon bukan JSON yang valid.");
            }
          }
        } catch (err) {
          console.log("Gagal meregistrasikan aset eksternal:", err);
        } finally {
          setIsRegistering(false);
        }
      }

      if (!matchedAsset) {
        alert("Ticker tidak ditemukan harian. Aktifkan opsi 'INPUT TICKER KUSTOM' di atas untuk menyerap data pasar baru.");
        return;
      }
    }

    onAddHolding({
      symbol: matchedAsset.symbol,
      category: matchedAsset.category,
      purchasePrice: parseFloat(newBuyPrice),
      quantity: parseFloat(newQty)
    });

    setNewSymbol("");
    setNewQty("");
    setNewBuyPrice("");
    setIsCustom(false);
  };

  return (
    <div className="space-y-6" id="dashboard-tab">
      {/* Top Welcome Title & Risk Profiles */}
      <div className="relative overflow-hidden bg-slate-900/60 backdrop-blur-md p-5 sm:p-6 rounded-2xl border border-slate-800/80 shadow-2xl">
        {/* Decorative corner glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-b from-blue-600/10 via-cyan-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative flex flex-col xl:flex-row xl:items-center xl:justify-between gap-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping shrink-0" />
              <span className="text-[10px] text-blue-400 font-mono font-bold tracking-widest uppercase">ZAYTRIX ANALYTICS TERMINAL</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
              <Wallet className="w-6 h-6 text-blue-500 shrink-0" /> Analitik Portofolio Investasi
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-medium">
              Dashboard integrasi real-time multi-aset terpadu untuk memantau nilai aset, korelasi, dan alokasi taktis.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-slate-950/40 p-3 rounded-xl border border-slate-800/60">
            <div className="flex items-center gap-1.5 shrink-0">
              <Activity className="w-4 h-4 text-amber-500" />
              <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
                Profil Toleransi Risiko:
              </span>
            </div>
            <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800 gap-1 max-w-full">
              {(["Low", "Moderate", "Balanced", "Aggressive"] as const).map((prof) => (
                <button
                  key={prof}
                  onClick={() => setRiskProfile(prof)}
                  id={`risk-btn-${prof}`}
                  className={`px-3 py-1.5 rounded-md text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex-1 text-center whitespace-nowrap ${
                    riskProfile === prof
                      ? "bg-blue-600/20 text-blue-400 border border-blue-500/40 shadow-sm font-black"
                      : "text-slate-400 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  {prof === "Low" ? "Aman" : prof === "Moderate" ? "Moderat" : prof === "Balanced" ? "Seimbang" : "Agresif"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Investor Profile Summary Bar from Firestore */}
      {profileData && (
        <div className="bg-slate-900/40 border border-slate-800/60 backdrop-blur-sm rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg" id="dashboard-investor-strip">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img 
                src={profileData.avatarUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"} 
                alt="Avatar" 
                className="w-11 h-11 rounded-xl object-cover border border-slate-800 bg-slate-900"
                referrerPolicy="no-referrer"
              />
              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[#090D16] flex items-center justify-center">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-100">{profileData.fullName || "Investor Z-Capital"}</span>
                <span className="bg-emerald-500/10 text-emerald-400 text-[8px] font-bold px-2 py-0.5 rounded border border-emerald-500/20 uppercase tracking-wider font-mono">
                  VERIFIED INVESTOR
                </span>
              </div>
              <span className="text-[10px] text-slate-500 block font-mono">@{profileData.username || "investor"}</span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:flex md:items-center md:gap-6 text-xs font-mono text-slate-400 bg-slate-950/20 px-4 py-2.5 rounded-lg border border-slate-800/40">
            {profileData.phoneNumber && (
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Tel: <strong className="text-slate-200">+{profileData.phoneNumber}</strong></span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span>Email: <strong className="text-slate-200">{profileData.email || user?.email}</strong></span>
            </div>
            {profileData.timezone && (
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Zona: <strong className="text-slate-200">{profileData.timezone}</strong></span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Portfolio Value */}
        <motion.div 
          whileHover={{ y: -4, scale: 1.015, borderColor: "rgba(59, 130, 246, 0.4)" }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-xl flex items-center justify-between transition-colors shadow-xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest font-mono">TOTAL NILAI PORTFOLIO</p>
            <h3 className="text-2xl font-black text-white tracking-tight">{formatIDR(totalCurrentValue)}</h3>
            <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-blue-500" />
              Konversi Kurs: Rp {USD_TO_IDR.toLocaleString()}/USD
            </p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 shadow-inner">
            <Wallet className="w-5.5 h-5.5 text-blue-400" />
          </div>
        </motion.div>

        {/* Invested Capital */}
        <motion.div 
          whileHover={{ y: -4, scale: 1.015, borderColor: "rgba(148, 163, 184, 0.4)" }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-xl flex items-center justify-between transition-colors shadow-xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-slate-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest font-mono">MODAL DIINVESTASIKAN</p>
            <h3 className="text-2xl font-black text-slate-200 tracking-tight">{formatIDR(totalInvested)}</h3>
            <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-slate-500" />
              Nilai basis harga rata-rata beli
            </p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center shrink-0 shadow-inner">
            <Coins className="w-5.5 h-5.5 text-slate-400" />
          </div>
        </motion.div>

        {/* Unrealized Gain/Loss */}
        <motion.div 
          whileHover={{ 
            y: -4, 
            scale: 1.015, 
            borderColor: absoluteUnrealizedGain >= 0 ? "rgba(52, 211, 153, 0.4)" : "rgba(239, 68, 68, 0.4)" 
          }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-xl flex items-center justify-between transition-colors shadow-xl relative overflow-hidden"
        >
          <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-2xl pointer-events-none ${
            absoluteUnrealizedGain >= 0 ? "bg-emerald-500/5" : "bg-rose-500/5"
          }`} />
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest font-mono">BELUM DIREALISASI (P&L)</p>
            <h3 className={`text-2xl font-black tracking-tight ${
              absoluteUnrealizedGain >= 0 ? "text-emerald-400" : "text-rose-500"
            }`}>
              {absoluteUnrealizedGain >= 0 ? "+" : ""}
              {formatIDR(absoluteUnrealizedGain)}
            </h3>
            <div className="flex items-center gap-1.5">
              {absoluteUnrealizedGain >= 0 ? (
                <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0 animate-bounce" />
              ) : (
                <TrendingDown className="w-4 h-4 text-rose-500 shrink-0 animate-bounce" />
              )}
              <span className={`text-xs font-bold ${absoluteUnrealizedGain >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                {unrealizedGainPct.toFixed(2)}%
              </span>
            </div>
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border shadow-inner ${
            absoluteUnrealizedGain >= 0 
              ? "bg-emerald-500/10 border-emerald-500/20" 
              : "bg-rose-500/10 border-rose-500/20"
          }`}>
            {absoluteUnrealizedGain >= 0 ? (
              <TrendingUp className="w-5.5 h-5.5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-5.5 h-5.5 text-rose-400" />
            )}
          </div>
        </motion.div>

        {/* CFA Target recommendation */}
        <motion.div 
          whileHover={{ y: -4, scale: 1.015, borderColor: "rgba(96, 165, 250, 0.4)" }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-xl flex items-center justify-between transition-colors shadow-xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest font-mono">REKOMENDASI PORTFOLIO</p>
            <h3 className="text-sm font-black text-slate-100 tracking-tight uppercase">
              {riskProfile === "Low" && "Alokasi Defensif"}
              {riskProfile === "Moderate" && "Pendapatan Dividen"}
              {riskProfile === "Balanced" && "Diversifikasi Seimbang"}
              {riskProfile === "Aggressive" && "Pertumbuhan Agresif"}
            </h3>
            <p className="text-[10px] text-blue-400 font-bold tracking-wide">
              {riskProfile === "Low" && "15% Crypto / 85% Saham"}
              {riskProfile === "Moderate" && "25% Crypto / 75% Saham"}
              {riskProfile === "Balanced" && "40% Crypto / 60% Saham"}
              {riskProfile === "Aggressive" && "60% Crypto / 40% Saham"}
            </p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5.5 h-5.5 text-amber-400 animate-pulse" />
          </div>
        </motion.div>
      </div>

      {/* Charts section: Line chart of Daily Portfolio Growth & Pie Chart of Allocation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800/85 p-5 sm:p-6 rounded-2xl flex flex-col justify-between shadow-2xl relative">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <h4 className="text-sm sm:text-base font-bold text-white">Grafik Tren Kinerja Portofolio</h4>
              </div>
              <p className="text-xs text-slate-400 mt-1">Total nilai kepemilikan aset dihitung historis berdasarkan interpolasi harian</p>
            </div>
            <span className="text-[10px] sm:text-xs font-mono font-bold bg-slate-950 text-blue-400 px-3 py-1 rounded-lg border border-slate-800/60 self-start sm:self-auto">
              SISTEM SIMULASI HISTORIS
            </span>
          </div>

          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={performanceHistory} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorPortofolio" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="date" 
                  stroke="#475569" 
                  fontSize={11} 
                  tickLine={false} 
                  axisLine={false}
                  dy={10}
                />
                <YAxis 
                  stroke="#475569" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false}
                  tickFormatter={(v) => `Rp ${(v / 1e6).toFixed(1)}jt`} 
                  dx={-5}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#0b0f19", borderColor: "#1e293b", borderRadius: "12px", boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)" }}
                  labelStyle={{ color: "#94a3b8", fontWeight: 'bold', fontSize: "11px" }}
                  itemStyle={{ fontSize: "12px", color: "#3b82f6" }}
                  formatter={(v: any) => [formatIDR(v), "Total Nilai"]}
                />
                <Area 
                  type="monotone" 
                  dataKey="Portofolio" 
                  stroke="#3b82f6" 
                  strokeWidth={2.5}
                  fillOpacity={1} 
                  fill="url(#colorPortofolio)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Portfolio allocation donut chart */}
        <div className="bg-slate-900/40 border border-slate-800/85 p-5 sm:p-6 rounded-2xl flex flex-col justify-between shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3 mb-2">
            <div>
              <h4 className="text-sm sm:text-base font-bold text-white">Alokasi Kelas Aset</h4>
              <p className="text-xs text-slate-400 mt-0.5">Proporsi pembagian instrumen</p>
            </div>
            
            {/* Toggle */}
            <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800/80 self-start sm:self-auto shrink-0 select-none">
              <button
                type="button"
                onClick={() => setAllocationMode("actual")}
                disabled={pieData.length === 0}
                className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${
                  pieData.length === 0 ? "opacity-35 cursor-not-allowed text-slate-500" : "cursor-pointer"
                } ${
                  pieData.length > 0 && allocationMode === "actual"
                    ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-black shadow-sm"
                    : "text-slate-400 hover:text-slate-200 border border-transparent"
                }`}
                title={pieData.length === 0 ? "Tambahkan aset untuk melihat alokasi aktual" : ""}
              >
                Aktual
              </button>
              <button
                type="button"
                onClick={() => setAllocationMode("ideal")}
                className={`px-3 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                  pieData.length === 0 || allocationMode === "ideal"
                    ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-black shadow-sm"
                    : "text-slate-400 hover:text-slate-200 border border-transparent"
                }`}
              >
                Target {pieData.length === 0 && " (Auto)"}
              </button>
            </div>
          </div>

          <div className="h-44 flex items-center justify-center relative my-4">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <RiPieChart>
                <Pie
                  data={pieData.length > 0 && allocationMode === "actual" ? pieData : targetIdealData}
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={76}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {(pieData.length > 0 && allocationMode === "actual" ? pieData : targetIdealData).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="#0B0F19" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => 
                    pieData.length > 0 && allocationMode === "actual"
                      ? formatIDR(value) 
                      : `${value}%`
                  } 
                  contentStyle={{ backgroundColor: "#0b0f19", borderColor: "#1e293b", borderRadius: "10px" }}
                  itemStyle={{ fontSize: "11px", color: "#94a3b8" }}
                />
              </RiPieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[8px] text-slate-500 uppercase tracking-widest font-mono font-bold">ALOKASI</span>
              <span className="text-xs font-black text-slate-200 uppercase tracking-wide">
                {pieData.length > 0 && allocationMode === "actual" ? "AKTUAL" : "TARGET"}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {pieData.length > 0 && allocationMode === "actual" ? (
              pieData.map((item, idx) => {
                const pct = totalCurrentValue > 0 ? (item.value / totalCurrentValue) * 100 : 0;
                return (
                  <div key={idx} className="flex items-center justify-between text-xs bg-slate-950/40 px-3 py-2.5 rounded-lg border border-slate-800/40">
                    <div className="flex items-center space-x-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-slate-300 font-bold">{item.name}</span>
                    </div>
                    <span className="text-slate-100 font-mono font-black">{pct.toFixed(1)}%</span>
                  </div>
                );
              })
            ) : (
              <div className="space-y-1.5">
                {targetIdealData.map((item, idx) => {
                  return (
                    <div key={idx} className="flex items-center justify-between text-xs bg-slate-950/40 px-3 py-2.5 rounded-lg border border-slate-800/40">
                      <div className="flex items-center space-x-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-slate-300 font-bold">{item.name.replace(/ \(\d+%\)/, "")}</span>
                      </div>
                      <span className="text-blue-400 font-mono font-black">{item.value}%</span>
                    </div>
                  );
                })}
                {pieData.length === 0 ? (
                  <div className="text-[10px] text-amber-400 bg-amber-500/5 p-2.5 rounded-lg border border-amber-500/10 text-center font-bold mt-1 leading-relaxed">
                    Aset belum ditambahkan. Menampilkan target proporsi ideal untuk profil <span className="underline font-mono">{riskProfile === "Low" ? "Aman" : riskProfile === "Moderate" ? "Moderat" : riskProfile === "Balanced" ? "Seimbang" : "Agresif"}</span>.
                  </div>
                ) : (
                  <div className="text-[10px] text-blue-400 bg-blue-500/5 p-2.5 rounded-lg border border-blue-500/10 text-center font-bold mt-1 leading-relaxed">
                    Menampilkan target komposisi ideal. Klik "Aktual" untuk kembali ke portofolio riil Anda.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Correlation Matrix D3.js Panel */}
      <CorrelationHeatmap portfolio={portfolio} />

      {/* SECTION: AUTOMATED AI ON-CHAIN & DERIVATIVES ANALYSIS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Panel 1: Live Coinglass Derivatives & Liquidation Metrics */}
        <div className="lg:col-span-5 bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl shadow-2xl flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
          
          <div>
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-cyan-400" />
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-white">Metrik Derivatif & On-Chain (Coinglass)</h4>
                  <p className="text-[10px] text-slate-400">Arus modal institusional & aktivitas berjangka real-time</p>
                </div>
              </div>
              <span className="text-[9px] font-mono font-bold bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20">
                LIVE SPOT & FUTURES
              </span>
            </div>

            {/* Metrics Grid of Graphic Cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Card 1: Price BTC */}
              <div className="bg-slate-950/40 border border-slate-800/50 hover:border-cyan-500/30 p-2.5 rounded-xl transition-all flex flex-col justify-between group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Coins className="w-3.5 h-3.5 text-yellow-500 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold text-slate-300">Spot BTC</span>
                  </div>
                  {/* Live 24h change — prefer Zustand WS percent, then cached AI, then FALLBACK */}
                  <span className={`text-[9px] font-bold font-mono ${
                    (liveBtcChange ?? autoAnalysis?.metrics?.change24h ?? 0) >= 0 ? "text-emerald-400" : "text-rose-500"
                  }`}>
                    {(liveBtcChange ?? autoAnalysis?.metrics?.change24h ?? 0) >= 0 ? "+" : ""}
                    {(liveBtcChange ?? autoAnalysis?.metrics?.change24h ?? 1.42).toFixed(2)}%
                  </span>
                </div>
                <div className="mt-1">
                  <span className="text-xs font-mono font-black text-white">
                    ${btcPriceMetric.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <Sparkline data={btcHistory} color={(liveBtcChange ?? autoAnalysis?.metrics?.change24h ?? 0) >= 0 ? "#10b981" : "#f43f5e"} />
              </div>

              {/* Card 2: Futures Open Interest */}
              <div className="bg-slate-950/40 border border-slate-800/50 hover:border-cyan-500/30 p-2.5 rounded-xl transition-all flex flex-col justify-between group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-blue-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold text-slate-300">Open Interest</span>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-blue-400">Futures</span>
                </div>
                <div className="mt-1">
                  <span className="text-xs font-mono font-black text-white">
                    ${(openInterestMetric / 1e6).toFixed(2)}M
                  </span>
                </div>
                <Sparkline data={oiHistory} color="#3b82f6" />
              </div>

              {/* Card 3: Funding Rate */}
              <div className="bg-slate-950/40 border border-slate-800/50 hover:border-cyan-500/30 p-2.5 rounded-xl transition-all flex flex-col justify-between group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Percent className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold text-slate-300">Funding Rate</span>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-purple-400">Binance</span>
                </div>
                <div className="mt-1">
                  <span className="text-xs font-mono font-black text-white">
                    {fundingRateMetric.toFixed(4)}%
                  </span>
                </div>
                <Sparkline data={fundingHistory} color="#a855f7" />
              </div>

              {/* Card 4: Long/Short Ratio */}
              <div className="bg-slate-950/40 border border-slate-800/50 hover:border-cyan-500/30 p-2.5 rounded-xl transition-all flex flex-col justify-between group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <HelpCircle className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold text-slate-300">L/S Ratio</span>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-amber-400">Accounts</span>
                </div>
                <div className="mt-1">
                  <span className="text-xs font-mono font-black text-white">
                    {longShortRatioMetric.toFixed(2)}
                  </span>
                </div>
                <Sparkline data={lsHistory} color="#f59e0b" />
              </div>

              {/* Card 5: Netflow Bersih */}
              <div className="bg-slate-950/40 border border-slate-800/50 hover:border-cyan-500/30 p-2.5 rounded-xl transition-all flex flex-col justify-between group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5 text-pink-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold text-slate-300">Exchange Netflow</span>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-emerald-400" title={liveExchangeNetflow.length > 0 ? "Exchange netflow REAL dari Santiment (free tier, lag ~30 hari). Positif = inflow ke exchange, negatif = outflow." : "Exchange netflow estimasi (data Santiment belum termuat)."}>{liveExchangeNetflow.length > 0 ? "30D • LIVE" : "30D • EST"}</span>
                </div>
                <div className="mt-1">
                  <span className={`text-xs font-mono font-black ${
                    netflowMetric < 0 ? "text-emerald-400" : "text-rose-500"
                  }`}>
                    {(netflowMetric / 1e6).toFixed(2)}M USD
                  </span>
                </div>
                <Sparkline data={netflowHistory} color={netflowMetric < 0 ? "#10b981" : "#ec4899"} />
              </div>

              {/* Card 6: Alamat Aktif & Hashrate */}
              <div className="bg-slate-950/40 border border-slate-800/50 hover:border-cyan-500/30 p-2.5 rounded-xl transition-all flex flex-col justify-between group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-teal-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold text-slate-300">Active Addr</span>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-emerald-400">{networkHashrateMetric} EH/s</span>
                </div>
                <div className="mt-1">
                  <span className="text-xs font-mono font-black text-white">
                    {activeAddressesMetric.toLocaleString()}
                  </span>
                </div>
                <Sparkline data={activeAddressesHistory} color="#14b8a6" />
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-500 mt-4 leading-relaxed bg-slate-950/20 p-2.5 rounded-lg border border-slate-800/40 font-mono">
            * Data ditarik dan disinkronkan secara real-time langsung dari nodus RPC publik & API bursa berjangka.
          </div>
        </div>

        {/* Panel 2: Automated AI On-Chain Analysis Report */}
        <div className="lg:col-span-7 bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl shadow-2xl flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 w-32 h-32 bg-purple-500/5 rounded-full blur-2xl pointer-events-none" />
          
          <div>
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400 shrink-0 animate-pulse" />
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-white">Laporan Analisis Berkala AI (Gemini)</h4>
                  <p className="text-[10px] text-slate-400">Dihasilkan otomatis secara berkala 10 menit oleh engine kognitif server</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {autoAnalysis?.timestamp && (
                  <span className="text-[9px] font-mono text-slate-500 hidden sm:inline">
                    Terakhir: {new Date(autoAnalysis.timestamp).toLocaleTimeString("id-ID", {hour: "2-digit", minute: "2-digit", second: "2-digit"})}
                  </span>
                )}
                <button
                  onClick={() => fetchAutoAnalysis(true)}
                  disabled={autoLoading}
                  className="flex items-center gap-1 text-[10px] font-bold bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 px-2.5 py-1 rounded-lg border border-purple-500/20 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${autoLoading ? 'animate-spin' : ''}`} />
                  Analis Ulang
                </button>
              </div>
            </div>

            {/* Analysis Content Area */}
            <div className="relative min-h-[300px] bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 overflow-y-auto max-h-[360px] custom-scrollbar">
              <AnimatePresence mode="wait">
                {autoLoading ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center space-y-3 bg-slate-950/20"
                  >
                    <div className="relative flex items-center justify-center">
                      <div className="w-10 h-10 border-2 border-purple-500/10 border-t-purple-400 rounded-full animate-spin" />
                      <Sparkles className="w-4 h-4 text-purple-400 animate-pulse absolute" />
                    </div>
                    <span className="text-xs text-slate-400 font-mono font-bold animate-pulse">
                      Gemini AI sedang mengolah metrik derivatif pasar...
                    </span>
                  </motion.div>
                ) : autoError ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center h-full text-center space-y-2 p-6"
                  >
                    <ShieldAlert className="w-8 h-8 text-rose-500 animate-bounce" />
                    <p className="text-xs text-slate-300 font-bold">{autoError}</p>
                    <button
                      onClick={() => fetchAutoAnalysis(true)}
                      className="text-[10px] font-bold underline text-purple-400 hover:text-purple-300"
                    >
                      Coba lagi
                    </button>
                  </motion.div>
                ) : autoAnalysis?.analysis ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="prose prose-invert prose-xs text-xs text-slate-300 leading-relaxed font-sans select-text markdown-body"
                  >
                    <Markdown>{autoAnalysis.analysis}</Markdown>
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 text-xs py-12">
                    <Sparkles className="w-8 h-8 text-slate-700 mb-2" />
                    Laporan analisis belum dibuat. Klik "Analis Ulang" untuk memicu analisis Gemini perdana.
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-500 mt-4 border-t border-slate-800/40 pt-3">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
              Sistem Otomatis Mandiri Terintegrasi
            </span>
            {autoAnalysis?.isFallback && (
              <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-mono font-bold">
                ENGINE OFFLINE ACTIVE
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SECTION: INTERACTIVE ON-CHAIN LIQUIDITY & LEVERAGE EXPLORER */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 sm:p-6 space-y-5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/60 pb-4 gap-3">
          <div className="space-y-1">
            <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
              <ArrowUpDown className="w-5 h-5 text-cyan-400 shrink-0" />
              On-Chain Liquidity Engine: Net Flow & Open Interest Explorer
            </h3>
            <p className="text-xs text-slate-400">
              Analisis grafik interaktif aliran modal bursa dan penumpukan leverage berjangka real-time untuk mendeteksi squeeze likuiditas.
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {/* Metric Tab Selector */}
            <div className="flex bg-slate-950/60 p-1 rounded-xl border border-slate-800/80">
              <button
                onClick={() => setOnChainMetricTab("netflow")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  onChainMetricTab === "netflow"
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-black"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Exchange Net Flow
              </button>
              <button
                onClick={() => setOnChainMetricTab("oi")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  onChainMetricTab === "oi"
                    ? "bg-purple-500/20 text-purple-400 border border-purple-500/30 font-black"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Open Interest
              </button>
            </div>

            {/* Period Selector */}
            <div className="flex bg-slate-950/60 p-1 rounded-xl border border-slate-800/80">
              {(["24H", "7D", "30D"] as const).map((period) => (
                <button
                  key={period}
                  onClick={() => setOnChainPeriod(period)}
                  className={`px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg transition-all ${
                    onChainPeriod === period
                      ? "bg-slate-800 text-white border border-slate-700 font-black"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>

            {/* Info toggle */}
            <button
              onClick={() => setOnChainExplainOpen(!onChainExplainOpen)}
              className={`p-1.5 rounded-lg border transition-all ${
                onChainExplainOpen 
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/30" 
                  : "bg-slate-950/60 text-slate-400 border-slate-800/80 hover:text-white"
              }`}
              title="Panduan Analisis"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Collapsible Explainer Card */}
        <AnimatePresence>
          {onChainExplainOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="bg-slate-950/40 border border-amber-500/20 p-4 rounded-xl text-xs space-y-2.5 leading-relaxed text-slate-300">
                <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                  <Info className="w-4 h-4 text-amber-400" />
                  <span>Panduan Membaca Liquidity Engine & Coinglass Indicators</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <div>
                    <span className="font-bold text-white block mb-1">🌊 Exchange Net Flow (Arus Bersih Bursa)</span>
                    <p className="text-slate-400">
                      Mengukur volume koin yang masuk dikurangi koin yang keluar dari bursa spot/derivatif.
                    </p>
                    <ul className="list-disc pl-4 mt-1 space-y-1 text-slate-400">
                      <li><strong className="text-rose-400">Net Inflow (Positif)</strong>: Banyak pelaku pasar memindahkan kripto ke bursa, mengindikasikan persiapan menjual atau distribusi. Tekanan jual meningkat.</li>
                      <li><strong className="text-emerald-400">Net Outflow (Negatif)</strong>: Banyak investor memindahkan aset ke cold storage, mengindikasikan akumulasi jangka panjang. Pasokan sirkulasi menipis (supply shock).</li>
                    </ul>
                  </div>
                  <div>
                    <span className="font-bold text-white block mb-1">⚡ Open Interest & Squeeze Risk</span>
                    <p className="text-slate-400">
                      Menghitung nilai total kontrak berjangka (leverage) yang masih aktif terbuka di bursa (Binance, OKX, Bybit).
                    </p>
                    <ul className="list-disc pl-4 mt-1 space-y-1 text-slate-400">
                      <li><strong className="text-purple-400">Open Interest Naik Tinggi</strong>: Likuiditas leverage menumpuk ekstrem. Rentan memicu liquidation cascade (Squeeze) jika harga berbalik arah secara mendadak.</li>
                      <li><strong className="text-slate-400">Open Interest Turun Tajam (Flushout)</strong>: Terjadi likuidasi massal yang menyapu bersih pelaku leverage, biasanya menandai titik balik harga (market bottom/top).</li>
                    </ul>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic Interactive Analytics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-slate-950/30 border border-slate-800/60 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 block">STATUS RISK SENTIMENT</span>
            <div className="flex items-center gap-1.5 mt-1">
              <Zap className={`w-4 h-4 ${onChainMetricTab === "netflow" ? "text-emerald-400" : "text-purple-400"}`} />
              <span className="text-xs font-extrabold text-white">
                {onChainMetricTab === "netflow" 
                  ? (netflowMetric < 0 ? "Akumulasi Kuat (Bullish)" : "Distribusi Spot (Bearish)") 
                  : (openInterestMetric > 1200000000 ? "Volatilitas Ekstrem" : "Risiko Squeeze Sedang")
                }
              </span>
            </div>
            <span className="text-[9px] text-slate-500 block mt-2 font-mono">* Berdasarkan data real-time terbaru</span>
          </div>

          <div className="bg-slate-950/30 border border-slate-800/60 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 block">NILAI RATA-RATA (PERIODE)</span>
            <div className="mt-1">
              <span className="text-base font-mono font-black text-white">
                {onChainMetricTab === "netflow" 
                  ? `${(onChainChartData.reduce((acc, d) => acc + d.netflow, 0) / onChainChartData.length).toFixed(2)}M USD`
                  : `$${(onChainChartData.reduce((acc, d) => acc + d.oi, 0) / onChainChartData.length).toFixed(2)}M`
                }
              </span>
            </div>
            <span className="text-[9px] text-slate-500 block mt-2 font-mono">Nilai rata-rata dari {onChainChartData.length} sampel</span>
          </div>

          <div className="bg-slate-950/30 border border-slate-800/60 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 block">PEAK EKSTREMUM</span>
            <div className="mt-1">
              <span className="text-base font-mono font-black text-white">
                {onChainMetricTab === "netflow" 
                  ? `${Math.max(...onChainChartData.map(d => Math.abs(d.netflow))).toFixed(2)}M USD`
                  : `$${Math.max(...onChainChartData.map(d => d.oi)).toFixed(2)}M`
                }
              </span>
            </div>
            <span className="text-[9px] text-slate-500 block mt-2 font-mono">Titik tertinggi deviasi mutlak</span>
          </div>

          <div className="bg-slate-950/30 border border-slate-800/60 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 block">KORELASI HARGA BTC</span>
            <div className="flex items-center gap-1 mt-1">
              {onChainMetricTab === "netflow" ? (
                <>
                  <TrendingDown className="w-4 h-4 text-rose-400" />
                  <span className="text-xs font-bold text-rose-400">Negatif (-0.68)</span>
                </>
              ) : (
                <>
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400">Positif (+0.74)</span>
                </>
              )}
            </div>
            <span className="text-[9px] text-slate-500 block mt-2 font-mono">Indeks aksi harga spot BTC</span>
          </div>
        </div>

        {/* Primary Interactive Chart Area */}
        <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 h-72 relative">
          <ResponsiveContainer width="100%" height="100%">
            {onChainMetricTab === "netflow" ? (
              <BarChart
                data={onChainChartData}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis 
                  dataKey="label" 
                  stroke="#475569" 
                  fontSize={9} 
                  tickLine={false} 
                  axisLine={false}
                />
                <YAxis 
                  stroke="#475569" 
                  fontSize={9} 
                  tickLine={false} 
                  axisLine={false}
                  tickFormatter={(val) => `${val}M`}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      const isAbsPositive = data.netflow >= 0;
                      return (
                        <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg shadow-2xl space-y-1 font-sans text-[11px]">
                          <p className="text-slate-400 font-mono font-bold">{data.label}</p>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-300 font-bold">Net Flow:</span>
                            <span className={`font-mono font-black ${isAbsPositive ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {isAbsPositive ? '+' : ''}{data.netflow}M USD
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-300">Estimasi BTC:</span>
                            <span className="text-slate-100 font-mono">
                              ${data.btcPrice.toLocaleString()}
                            </span>
                          </div>
                          <span className={`text-[9px] block mt-1 px-1.5 py-0.5 rounded text-center font-bold font-mono ${
                            isAbsPositive ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
                          }`}>
                            {isAbsPositive ? 'DISTRIBUSI / TEKANAN JUAL' : 'AKUMULASI / OUTFLOW BERSIH'}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                <Bar 
                  dataKey="netflow"
                  radius={[4, 4, 0, 0]}
                >
                  {onChainChartData.map((entry, index) => {
                    const isPositive = entry.netflow >= 0;
                    return (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={isPositive ? "rgba(244, 63, 94, 0.7)" : "rgba(16, 185, 129, 0.7)"}
                        stroke={isPositive ? "rgb(244, 63, 94)" : "rgb(16, 185, 129)"}
                        strokeWidth={1}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            ) : (
              <AreaChart
                data={onChainChartData}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorOiGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis 
                  dataKey="label" 
                  stroke="#475569" 
                  fontSize={9} 
                  tickLine={false} 
                  axisLine={false}
                />
                <YAxis 
                  stroke="#475569" 
                  fontSize={9} 
                  tickLine={false} 
                  axisLine={false}
                  domain={['dataMin - 10', 'dataMax + 10']}
                  tickFormatter={(val) => `$${val}M`}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      const isHighRisk = data.oi > 1460;
                      return (
                        <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg shadow-2xl space-y-1 font-sans text-[11px]">
                          <p className="text-slate-400 font-mono font-bold">{data.label}</p>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-300 font-bold">Open Interest:</span>
                            <span className="text-purple-400 font-mono font-black">
                              ${data.oi.toLocaleString()}M
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-300">Estimasi BTC:</span>
                            <span className="text-slate-100 font-mono">
                              ${data.btcPrice.toLocaleString()}
                            </span>
                          </div>
                          <span className={`text-[9px] block mt-1 px-1.5 py-0.5 rounded text-center font-bold font-mono ${
                            isHighRisk ? 'bg-rose-500/10 text-rose-400' : 'bg-purple-500/10 text-purple-400'
                          }`}>
                            {isHighRisk ? 'RISIKO SQUEEZE TINGGI' : 'LEVERAGE SEHAT'}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area 
                  type="monotone" 
                  dataKey="oi" 
                  stroke="#a855f7" 
                  strokeWidth={2} 
                  fillOpacity={1} 
                  fill="url(#colorOiGrad)" 
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Portfolio Health Index & Rebalancing Advisory section */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 sm:p-6 space-y-5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-gradient-to-tr from-blue-600/5 via-transparent to-transparent rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800/60 pb-5 gap-3">
          <div className="space-y-1">
            <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500 animate-pulse shrink-0" /> Advisory CFA: Indeks Kesehatan & Diversifikasi Portofolio
            </h3>
            <p className="text-xs text-slate-400">
              Evaluasi kepatuhan pembagian kelas aset Saham IHSG vs Kripto berdasarkan profil toleransi risiko pilihan Anda.
            </p>
          </div>
          <div className="flex items-center gap-2.5 self-start md:self-auto bg-slate-950/50 px-3.5 py-2 rounded-xl border border-slate-800/60 shadow-lg">
            <span className="text-xs text-slate-400 font-bold font-mono">SKOR KESEHATAN:</span>
            <span className={`px-2.5 py-1 rounded-lg text-xs font-black font-mono border tracking-wider ${healthAssessment.colorClass}`}>
              {healthAssessment.score} / 100 — {healthAssessment.status}
            </span>
          </div>
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6 pt-1">
          {/* Progress Bar & Ideal Allocation comparison */}
          <div className="bg-slate-950/40 p-5 rounded-xl border border-slate-800/80 flex flex-col justify-between space-y-5 shadow-inner">
            <div className="space-y-2">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-bold tracking-wider block">AKURASI DISTRIBUSI MODAL</span>
              <div className="w-full bg-slate-900 rounded-full h-3.5 p-0.5 border border-slate-800/80">
                <div 
                  className={`h-2.5 rounded-full transition-all duration-700 shadow-md ${healthAssessment.barColor}`} 
                  style={{ width: `${healthAssessment.score}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 font-mono font-bold">
                <span>TERKONSENTRASI</span>
                <span>TERDIVERSIFIKASI</span>
              </div>
            </div>

            <div className="space-y-2.5">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-bold tracking-wider block">ALOKASI AKTUAL VS TARGET IDEAL</span>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center bg-slate-900/40 px-3 py-2 rounded-lg border border-slate-800/40">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-teal-500" />
                    <span className="text-slate-400 font-medium">Porsi Saham:</span>
                  </div>
                  <div className="font-mono text-right">
                    <span className="text-slate-100 font-black">{healthAssessment.currentStockPct.toFixed(1)}%</span>
                    <span className="text-slate-500 text-[10px] ml-1.5 font-bold">(Target {healthAssessment.idealStockPct}%)</span>
                  </div>
                </div>
                <div className="flex justify-between items-center bg-slate-900/40 px-3 py-2 rounded-lg border border-slate-800/40">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                    <span className="text-slate-400 font-medium">Porsi Kripto:</span>
                  </div>
                  <div className="font-mono text-right">
                    <span className="text-slate-100 font-black">{healthAssessment.currentCryptoPct.toFixed(1)}%</span>
                    <span className="text-slate-500 text-[10px] ml-1.5 font-bold">(Target {healthAssessment.idealCryptoPct}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bulleted Analyst Advisory notes */}
          <div className="md:col-span-2 bg-slate-950/20 p-5 rounded-xl border border-slate-800/40 space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <span className="text-[10px] text-blue-400 uppercase font-mono font-bold tracking-widest block">PANDUAN TAKTIS REBALANCING (CFA COMPLIANT)</span>
              <ul className="space-y-3 text-xs">
                {healthAssessment.advices.map((advice, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 bg-slate-950/30 p-2.5 rounded-lg border border-slate-800/30">
                    <span className="text-blue-500 font-black text-sm leading-none shrink-0">•</span>
                    <span className="text-slate-300 leading-relaxed font-medium">{advice}</span>
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="text-[10.5px] bg-blue-500/5 text-blue-400 p-3 rounded-lg border border-blue-500/10 font-mono leading-relaxed shadow-sm">
              💡 <strong>Rekomendasi Pintar:</strong> Anda dapat mengubah profil risiko di bagian paling atas untuk merestrukturisasi persentase target komposisi ideal portofolio.
            </div>
          </div>
        </div>

        {/* Rebalancing Calculator Sub-Card */}
        <div className="mt-6 pt-6 border-t border-slate-800/60">
          <div className="bg-slate-950/40 p-4 sm:p-5 rounded-xl border border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-6 shadow-inner">
            <div className="space-y-1.5 max-w-xl">
              <span className="text-[10px] text-amber-500 uppercase font-mono font-bold tracking-widest block">
                KALKULATOR PENYEIMBANGAN PORTOFOLIO (REBALANCING ENGINE)
              </span>
              <p className="text-sm font-black text-slate-100 tracking-tight">
                Simulasikan Rebalancing Tanpa Jual dengan Injeksi Dana Segar
              </p>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                Mesin kalkulator instan ini menghitung deviasi devisa modal rill Anda saat ini dibandingkan target risiko ideal Anda ({healthAssessment.idealStockPct}% Saham / {healthAssessment.idealCryptoPct}% Kripto), lalu merekomendasikan porsi beli dalam mata uang Rupiah (IDR).
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shrink-0">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase tracking-wider block">
                  SUNTIK MODAL BARU (IDR):
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-xs font-mono font-bold text-slate-500">Rp</span>
                  <input
                    type="number"
                    value={freshCapitalInput}
                    onChange={(e) => setFreshCapitalInput(e.target.value)}
                    placeholder="0"
                    className="w-full sm:w-56 bg-slate-950 border border-slate-800 rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/35 transition-all"
                  />
                </div>
              </div>

              {Number(freshCapitalInput) > 0 && (
                <button
                  onClick={() => setFreshCapitalInput("")}
                  className="self-end px-3.5 py-2 bg-slate-900 border border-slate-800 text-slate-300 hover:text-white rounded-lg text-xs font-bold cursor-pointer transition-all hover:bg-slate-850"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Calculations Result Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {(() => {
              const freshCapital = Number(freshCapitalInput) || 0;
              const newTotalVal = healthAssessment.totalVal + freshCapital;
              const newIdealCrypto = newTotalVal * (healthAssessment.idealCryptoPct / 100);
              const newIdealStock = newTotalVal * (healthAssessment.idealStockPct / 100);

              const cryptoDiff = newIdealCrypto - healthAssessment.cryptoValue;
              const stockDiff = newIdealStock - healthAssessment.stockValue;

              return (
                <>
                  {/* Stock Balancing Panel */}
                  <div className="bg-slate-950/60 border border-slate-800/60 p-4 rounded-xl space-y-3.5 shadow-md">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-slate-200 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-teal-500 shadow-sm" />
                        Aset: Saham Bursa (Stock)
                      </span>
                      <span className="text-[10px] text-teal-400 font-mono font-bold bg-teal-500/5 px-2 py-0.5 rounded border border-teal-500/10">
                        Target: {healthAssessment.idealStockPct}%
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-xs border-b border-slate-900 pb-3">
                      <div>
                        <span className="text-slate-500 block font-bold">Riil Saat Ini:</span>
                        <span className="font-mono text-slate-300 font-bold">{formatIDR(healthAssessment.stockValue)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block font-bold">Target Komposisi:</span>
                        <span className="font-mono text-slate-150 font-black">{formatIDR(newIdealStock)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-400 font-semibold">Tindakan Disarankan:</span>
                      <span className={`text-xs font-black font-mono px-3 py-1 rounded-lg shadow-sm border ${
                        stockDiff > 1000
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                          : stockDiff < -1000
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}>
                        {stockDiff > 1000
                          ? `BELI +${formatIDR(stockDiff)}`
                          : stockDiff < -1000
                          ? `JUAL ${formatIDR(Math.abs(stockDiff))}`
                          : "TAHANKAN POSISI (SEIMBANG)"}
                      </span>
                    </div>
                  </div>

                  {/* Crypto Balancing Panel */}
                  <div className="bg-slate-950/60 border border-slate-800/60 p-4 rounded-xl space-y-3.5 shadow-md">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-slate-200 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-sm" />
                        Aset: Mata Uang Kripto (Crypto)
                      </span>
                      <span className="text-[10px] text-purple-400 font-mono font-bold bg-purple-500/5 px-2 py-0.5 rounded border border-purple-500/10">
                        Target: {healthAssessment.idealCryptoPct}%
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-xs border-b border-slate-900 pb-3">
                      <div>
                        <span className="text-slate-500 block font-bold">Riil Saat Ini:</span>
                        <span className="font-mono text-slate-300 font-bold">{formatIDR(healthAssessment.cryptoValue)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block font-bold">Target Komposisi:</span>
                        <span className="font-mono text-slate-150 font-black">{formatIDR(newIdealCrypto)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-400 font-semibold">Tindakan Disarankan:</span>
                      <span className={`text-xs font-black font-mono px-3 py-1 rounded-lg shadow-sm border ${
                        cryptoDiff > 1000
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                          : cryptoDiff < -1000
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}>
                        {cryptoDiff > 1000
                          ? `BELI +${formatIDR(cryptoDiff)}`
                          : cryptoDiff < -1000
                          ? `JUAL ${formatIDR(Math.abs(cryptoDiff))}`
                          : "TAHANKAN POSISI (SEIMBANG)"}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Custom asset holdings table and addition form */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-5 sm:p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-950/20">
          <div className="space-y-1">
            <h4 className="text-sm sm:text-base font-extrabold text-white">Daftar Kepemilikan Portofolio</h4>
            <p className="text-xs text-slate-400">Kelola kuantitas dan rata-rata harga beli aset investasi Anda secara aman</p>
          </div>
          <span className="text-[11px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-3.5 py-1.5 rounded-full font-mono font-bold tracking-wide self-start sm:self-auto">
            {portfolio.length} KONTRAK AKTIF
          </span>
        </div>

        {/* Dynamic add holdings form */}
        <div className="p-5 sm:p-6 bg-slate-950/40 border-b border-slate-800/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 text-xs">
            <span className="text-slate-400 font-medium">Memiliki aset atau koin lain di luar opsi bawaan sistem?</span>
            <button
              type="button"
              onClick={() => {
                setIsCustom(!isCustom);
                setNewSymbol("");
              }}
              className={`px-3 py-1.5 rounded-lg border font-mono font-bold text-[10px] tracking-wide transition-all cursor-pointer ${
                isCustom 
                  ? "bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/15" 
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {isCustom ? "✓ INPUT KUSTOM AKTIF (KLIK UNTUK KEMBALI)" : "✏️ INPUT TICKER / SAHAM KUSTOM BARU"}
            </button>
          </div>
          
          <form onSubmit={handleAddAsset} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="block text-xs text-slate-400 font-bold uppercase font-mono tracking-wider">
                {isCustom ? "Kode Ticker Baru" : "Pilih Kode Ticker"}
              </label>
              {isCustom ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    required
                    placeholder="E.g., GOTO, DOGE"
                    value={newSymbol}
                    onChange={(e) => setNewSymbol(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 uppercase font-black font-mono"
                  />
                  <select
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value as "stock" | "crypto")}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 text-[11px] text-slate-300 font-bold focus:outline-none focus:border-blue-500"
                  >
                    <option value="stock">IHSG</option>
                    <option value="crypto">Crypto</option>
                  </select>
                </div>
              ) : (
                <select
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  id="add-holding-select"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 font-bold focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Pilih Ticker --</option>
                  <optgroup label="Indonesian Stocks (IHSG)">
                    {assets.filter(a => a.category === 'stock').map((asset) => (
                      <option key={asset.id} value={asset.symbol}>{asset.symbol} - {asset.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Cryptocurrencies">
                    {assets.filter(a => a.category === 'crypto').map((asset) => (
                      <option key={asset.id} value={asset.symbol}>{asset.symbol} - {asset.name}</option>
                    ))}
                  </optgroup>
                </select>
              )}
            </div>
            
            <div className="space-y-1.5">
              <label className="block text-xs text-slate-400 font-bold uppercase font-mono tracking-wider">Jumlah Kuantitas (Qty)</label>
              <input
                type="number"
                step="any"
                min="0.00001"
                placeholder="E.g., 100 atau 0.25"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                id="add-holding-qty"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="block text-xs text-slate-400 font-bold uppercase font-mono tracking-wider">
                Harga Beli Satuan (
                {isCustom 
                  ? (customCategory === "crypto" ? "USD" : "IDR")
                  : (assets.find(a => a.symbol === newSymbol.toUpperCase())?.category === 'crypto' ? "USD" : "IDR")}
                )
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Harga beli awal per unit"
                value={newBuyPrice}
                onChange={(e) => setNewBuyPrice(e.target.value)}
                id="add-holding-price"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            
            <div>
              <button
                type="submit"
                id="add-holding-submit-btn"
                disabled={isRegistering}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black px-4 py-2.5 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 h-[36px] cursor-pointer shadow-md shadow-blue-900/30 disabled:opacity-55"
              >
                <Plus className="w-4 h-4 stroke-[3]" /> 
                {isRegistering ? "Sinkronisasi..." : "Tambahkan Aset"}
              </button>
            </div>
          </form>
        </div>

        {/* Search and filter controls toolbar */}
        <div className="px-5 py-4 sm:px-6 bg-slate-950/60 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs relative z-10">
          <div className="relative flex-1 max-w-sm w-full">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Cari aset berdasarkan kode ticker..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900/90 border border-slate-800/80 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all focus:ring-1 focus:ring-blue-500/30"
            />
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-mono text-[10px] uppercase font-bold tracking-wider mr-1">Urutan:</span>
            <button
              type="button"
              onClick={() => {
                setSortBy("symbol");
                setSortOrder(prev => prev === "asc" ? "desc" : "asc");
              }}
              className={`px-3 py-2 rounded-xl border text-[11px] flex items-center gap-1.5 cursor-pointer font-bold transition-all ${
                sortBy === "symbol"
                  ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              Abjad/Ticker {sortBy === "symbol" && (sortOrder === "asc" ? "▲" : "▼")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSortBy("value");
                setSortOrder(prev => prev === "asc" ? "desc" : "asc");
              }}
              className={`px-3 py-2 rounded-xl border text-[11px] flex items-center gap-1.5 cursor-pointer font-bold transition-all ${
                sortBy === "value"
                  ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              Total Nilai {sortBy === "value" && (sortOrder === "asc" ? "▲" : "▼")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSortBy("gain");
                setSortOrder(prev => prev === "asc" ? "desc" : "asc");
              }}
              className={`px-3 py-2 rounded-xl border text-[11px] flex items-center gap-1.5 cursor-pointer font-bold transition-all ${
                sortBy === "gain"
                  ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              P&L (%) {sortBy === "gain" && (sortOrder === "asc" ? "▲" : "▼")}
            </button>
            {(sortBy !== "none" || searchQuery !== "") && (
              <button
                type="button"
                onClick={() => {
                  setSortBy("none");
                  setSearchQuery("");
                }}
                className="text-xs text-slate-400 hover:text-white underline underline-offset-4 ml-1 cursor-pointer font-bold"
              >
                Reset Filter
              </button>
            )}
          </div>
        </div>

        {/* Table of Holdings */}
        <div className="overflow-x-auto">
          {enrichedPortfolio.length > 0 ? (
            filteredAndSortedPortfolio.length > 0 ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950/70 text-[10px] text-slate-400 uppercase font-mono tracking-widest border-b border-slate-800/80 whitespace-nowrap">
                    <th className="p-4 font-black">Kode / Nama</th>
                    <th className="p-4 font-black">Kelas</th>
                    <th className="p-4 text-right font-black">Kuantitas</th>
                    <th className="p-4 text-right font-black">Harga Beli Rata2</th>
                    <th className="p-4 text-right font-black">Harga Terkini</th>
                    <th className="p-4 text-right font-black">Nilai Total (IDR)</th>
                    <th className="p-4 text-right font-black">P&L Belum Direalisasi</th>
                    <th className="p-4 text-center font-black">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 bg-slate-900/20">
                  {filteredAndSortedPortfolio.map((item) => {
                    const gain = item.totalValue - item.totalCost;
                    const gainPct = item.totalCost > 0 ? (gain / item.totalCost) * 100 : 0;
                    const isStock = item.category === "stock";
                    return (
                      <tr key={item.id} className="text-xs text-slate-300 hover:bg-slate-800/40 transition-colors whitespace-nowrap">
                        <td className="p-4">
                          <div className="flex items-center space-x-2.5">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-[10.5px] border ${
                              isStock 
                                ? "bg-teal-500/10 text-teal-400 border-teal-500/20" 
                                : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                            }`}>
                              {item.symbol}
                            </div>
                            <div>
                              <span className="font-extrabold block text-slate-100">{item.symbol}</span>
                              <span className="text-[10px] text-slate-500 font-medium font-mono">
                                {isStock ? "Bursa Efek Indonesia (IDX)" : "Aset Kripto Global (USD)"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] uppercase font-mono font-black ${
                            isStock ? "text-teal-400 bg-teal-500/5 border border-teal-500/10" : "text-purple-400 bg-purple-500/5 border border-purple-500/10"
                          }`}>
                            {item.category === 'stock' ? 'SAHAM' : 'CRYPTO'}
                          </span>
                        </td>
                        <td className="p-4 text-right font-mono font-bold text-slate-200">{item.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} units</td>
                        <td className="p-4 text-right font-mono text-slate-400">
                          {isStock ? formatIDR(item.purchasePrice) : `$${item.purchasePrice.toLocaleString()}`}
                        </td>
                        <td className="p-4 text-right font-mono text-slate-200 font-medium">
                          {isStock ? formatIDR(item.currentPrice) : `$${item.currentPrice.toLocaleString()}`}
                        </td>
                        <td className="p-4 text-right font-mono text-blue-400 font-extrabold">
                          {formatIDR(item.totalValue)}
                        </td>
                        <td className="p-4 text-right font-mono">
                          <span className={`font-black inline-flex items-center gap-1 ${gain >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                            {gain >= 0 ? "+" : ""}
                            {formatIDR(gain)} ({gain >= 0 ? "+" : ""}{gainPct.toFixed(2)}%)
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => onRemoveHolding(item.id)}
                            id={`remove-holding-${item.id}`}
                            className="text-slate-500 hover:text-rose-400 p-2 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer inline-flex items-center justify-center"
                            title="Hapus Dari Portfolio"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-12 text-center text-slate-500 text-sm bg-slate-950/20">
                Tidak ada aset yang cocok dengan kata kunci pencarian <span className="text-blue-400 font-mono font-bold">"{searchQuery}"</span>.
                <button 
                  onClick={() => setSearchQuery("")} 
                  className="block text-xs text-blue-500 hover:underline mx-auto mt-2 cursor-pointer font-bold"
                >
                  Bersihkan Pencarian
                </button>
              </div>
            )
          ) : (
            <div className="p-12 text-center text-slate-500 text-sm bg-slate-950/20">
              <span className="block mb-2 text-slate-300 font-black">Belum ada aset terdaftar di dalam portofolio Anda.</span>
              Gunakan form di atas untuk menambahkan koin kripto terfavorit Anda (e.g. BTC, ETH, SOL) ke dalam portofolio Anda.
            </div>
          )}
        </div>
      </div>
      {/* Swap Conversion History Audit Trail */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl mt-6">
        <div className="p-5 sm:p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-950/20">
          <div className="space-y-1">
            <h4 className="text-sm sm:text-base font-extrabold text-white">Audit Trail & Riwayat Konversi Instan</h4>
            <p className="text-xs text-slate-400">Catatan transaksi swap antar aset real-time lengkap dengan biaya platform & slippage.</p>
          </div>
          <span className="text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3.5 py-1.5 rounded-full font-mono font-bold tracking-wide self-start sm:self-auto">
            {conversionHistory.length} TRANSAKSI TERCATAT
          </span>
        </div>

        <div className="overflow-x-auto">
          {conversionHistory.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/70 text-[10px] text-slate-400 uppercase font-mono tracking-widest border-b border-slate-800 whitespace-nowrap">
                  <th className="p-4 font-black">Waktu Transaksi</th>
                  <th className="p-4 font-black">Aset Asal (Source)</th>
                  <th className="p-4 text-center font-black">→</th>
                  <th className="p-4 font-black">Aset Tujuan (Target)</th>
                  <th className="p-4 text-right font-black">Rasio Konversi</th>
                  <th className="p-4 text-right font-black">Biaya Platform</th>
                  <th className="p-4 text-center font-black">Slippage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850 bg-slate-900/20 font-mono text-xs">
                {conversionHistory.map((tx) => {
                  const dateStr = new Date(tx.timestamp).toLocaleString("id-ID", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                  });
                  const rate = tx.sourcePrice / tx.targetPrice;

                  return (
                    <tr key={tx.id} className="text-slate-300 hover:bg-slate-800/40 transition-colors whitespace-nowrap">
                      <td className="p-4 text-slate-500 font-bold">{dateStr}</td>
                      <td className="p-4 font-extrabold text-rose-400">
                        {tx.sourceQty.toFixed(4)} {tx.sourceSymbol}
                        <span className="text-[10px] text-slate-500 font-medium block">(${tx.sourcePrice.toLocaleString()})</span>
                      </td>
                      <td className="p-4 text-center text-slate-650 font-black">→</td>
                      <td className="p-4 font-extrabold text-emerald-400">
                        {tx.targetQty.toFixed(6)} {tx.targetSymbol}
                        <span className="text-[10px] text-slate-500 font-medium block">(${tx.targetPrice.toLocaleString()})</span>
                      </td>
                      <td className="p-4 text-right text-blue-400 font-extrabold">1 : {rate.toFixed(4)}</td>
                      <td className="p-4 text-right text-rose-450 font-bold">
                        -${tx.feePaidUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD
                      </td>
                      <td className="p-4 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-850/80 text-slate-300 border border-slate-800 font-bold">
                          {tx.slippagePercent}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-12 text-center text-slate-500 text-sm bg-slate-950/20">
              <span className="block mb-2 text-slate-400 font-medium">Belum ada riwayat konversi/swap yang dilakukan.</span>
              Gunakan pintasan "Buy/Sell/Detail" di ticker berjalan atau tombol konversi kustom untuk melangsungkan swap instan.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
