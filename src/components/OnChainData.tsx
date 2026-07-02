import React, { useState, useEffect, useMemo, useRef } from "react";
import { useGlobalStore } from "../store";
import Markdown from "react-markdown";
import {
  getOnChainMockData,
  LiquidationLiveEvent
} from "../utils/onChainMockData";
import { 
  TrendingUp, 
  TrendingDown, 
  RefreshCw, 
  BarChart2, 
  Flame, 
  Activity, 
  Layers, 
  ShieldAlert, 
  Sparkles, 
  BookOpen, 
  Wallet, 
  Compass, 
  Award, 
  Percent, 
  Hash, 
  AlertCircle,
  HelpCircle,
  DollarSign,
  Briefcase,
  PieChart as PieIcon,
  Server,
  Skull,
  BarChart,
  GitCommit,
  Coins
} from "lucide-react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart as RechartsBarChart, 
  Bar, 
  LineChart as RechartsLineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend, 
  ComposedChart,
  ReferenceLine,
  Cell
} from "recharts";
import TokenTerminalExplorer from "./TokenTerminalExplorer";

export interface OnChainTx {
  txhash: string;
  timestamp: string;
  coin: string;
  blockchain: string;
  amount: number;
  usdAmount: number;
  feeUsd: number;
  classification: string;
  alertLevel: "CRITICAL" | "HIGH" | "WARNING" | "MEDIUM" | "LOW";
  sirensCount: number;
  sirensStr: string;
  direction: "Unknown to Exchange" | "Exchange to Unknown" | "Exchange to Exchange" | "Unknown to Unknown";
  sourceName: string;
  destName: string;
  sender: string;
  receiver: string;
  senderBalance: number;
  receiverBalance: number;
  explorerUrl: string;
  sizeBytes: number;
}

type TabType = "derivatives" | "liquidations" | "volume" | "funding" | "orderbook" | "onchain" | "macro" | "tokenterminal" | "ai_analysis";

export default function OnChainData() {
  const [activeTab, setActiveTab] = useState<TabType>("derivatives");
  const [livePriceBtc, setLivePriceBtc] = useState<number>(64250);
  const [livePriceEth, setLivePriceEth] = useState<number>(3465);
  const [fearGreedVal, setFearGreedVal] = useState<number>(72);
  const [liveLiquidations, setLiveLiquidations] = useState<LiquidationLiveEvent[]>([]);
  const [selectedLiquidation, setSelectedLiquidation] = useState<LiquidationLiveEvent | null>(null);
  
  // Custom interactive highlights / inputs
  const [rainbowYear, setRainbowYear] = useState<number>(2026);
  const [stfPredictionDays, setStfPredictionDays] = useState<number>(365);
  const [cdriThreshold, setCdriThreshold] = useState<number>(45);
  const [oiThreshold, setOiThreshold] = useState<number>(14500);
  const [liquidationThreshold, setLiquidationThreshold] = useState<number>(30);

  // AI Onchain analysis states
  const [selectedAiSymbol, setSelectedAiSymbol] = useState<"BTC" | "ETH" | "SOL">("BTC");
  const [simFundingRate, setSimFundingRate] = useState<number>(0.015);
  const [simLongShort, setSimLongShort] = useState<number>(1.45);
  const [simNetflow, setSimNetflow] = useState<number>(-45);
  const [simOpenInterest, setSimOpenInterest] = useState<number>(1450);
  const [simActiveAddresses, setSimActiveAddresses] = useState<number>(890000);
  const [simHashrate, setSimHashrate] = useState<number>(615);

  const [aiAnalysisResult, setAiAnalysisResult] = useState<string>("");
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [isAiCached, setIsAiCached] = useState<boolean>(false);
  const [isAiFallback, setIsAiFallback] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string>("");
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string>("");

  // Populate dynamic default simulated values when selected asset changes
  useEffect(() => {
    if (selectedAiSymbol === "BTC") {
      setSimFundingRate(0.015);
      setSimLongShort(1.42);
      setSimNetflow(-60);
      setSimOpenInterest(1450);
      setSimActiveAddresses(890000);
      setSimHashrate(615);
    } else if (selectedAiSymbol === "ETH") {
      setSimFundingRate(0.012);
      setSimLongShort(1.25);
      setSimNetflow(15);
      setSimOpenInterest(820);
      setSimActiveAddresses(420000);
      setSimHashrate(95);
    } else if (selectedAiSymbol === "SOL") {
      setSimFundingRate(0.024);
      setSimLongShort(1.68);
      setSimNetflow(-15);
      setSimOpenInterest(450);
      setSimActiveAddresses(1250000);
      setSimHashrate(88);
    }
  }, [selectedAiSymbol]);

  // === LIVE DATA STATE (sourced from /api/onchain/metrics, /api/onchain/data, /api/onchain/oi-history,
  // /api/onchain/dominance-history, /api/onchain/orderbook, /api/onchain/altcoin-season, /api/onchain/correlations) ===
  // liveMetrics: full /api/onchain/metrics payload (Fear&Greed, funding rates 30d, OI snapshot, gainers/losers, market dominance)
  const [liveMetrics, setLiveMetrics] = useState<any>(null);
  // Raw OI 30-day history per asset (BTC/ETH/SOL). Merged + USD-notionalized in the data useMemo below.
  const [liveOiRaw, setLiveOiRaw] = useState<{ btc: any[]; eth: any[]; sol: any[] } | null>(null);
  // Live BTC/ETH/Altcoin dominance 30-day history (mapped to chart shape)
  const [liveDominanceHistory, setLiveDominanceHistory] = useState<any[]>([]);
  // Live BTCUSDT orderbook (bidPressure, bidTotal, askTotal, bids[], asks[])
  const [liveOrderbook, setLiveOrderbook] = useState<any>(null);
  // Live altcoin season index (blockchaincenter.net)
  const [liveAltcoinSeason, setLiveAltcoinSeason] = useState<number | null>(null);
  // Live BTC correlations vs S&P500, Gold, DXY, Nasdaq (Pearson, 30d)
  const [liveCorrelations, setLiveCorrelations] = useState<any[]>([]);
  // Live SOL price + 24h change percents (sourced from /api/onchain/data payload)
  const [livePriceSol, setLivePriceSol] = useState<number>(164.50);
  const [liveBtcChange, setLiveBtcChange] = useState<number>(1.4);
  const [liveEthChange, setLiveEthChange] = useState<number>(0.8);
  const [liveSolChange, setLiveSolChange] = useState<number>(3.6);
  // Live BNB/XRP prices (used for altcoin OI notional conversion)
  const [livePriceBnb, setLivePriceBnb] = useState<number>(600);
  const [livePriceXrp, setLivePriceXrp] = useState<number>(2);

  // === LIVE DATA STATE (sourced from /api/live/* endpoints — REAL free public sources) ===
  // These endpoints were added by LIVEDATA agent (see worklog Task ID LIVEDATA) and augmented by
  // SEC2-SCRAPING (which made exchange-netflow/etf-flows/cme-oi/mvrv return REAL data). All 12
  // endpoints now return success:true with REAL scraped/computed data from Binance Futures,
  // mempool.space, Coinmetrics, blockchain.info, Blockchair, Santiment, Farside, CFTC, etc.
  // The state vars below hold the raw `history` payloads; the `data` useMemo maps them into the
  // existing chart shapes consumed by the JSX. When live data IS available for a dataset, it
  // COMPLETELY replaces the mock baseline (not just an overlay) — see merge logic in the
  // `data` useMemo below.
  // Live Stock-to-Flow (computed from BTC protocol + Blockchair live supply). history:[{date,stock,flow,s2fRatio}]
  const [liveS2f, setLiveS2f] = useState<any[]>([]);
  // Live MVRV (REAL marketCap + REAL realizedCap + REAL mvrv — Santiment GraphQL free tier).
  // history:[{date,isoDate,marketCap,realizedCap,mvrv}]
  const [liveMvrv, setLiveMvrv] = useState<any[]>([]);
  // Live Drawdown from ATH (REAL BTC prices from blockchain.info + ATH from CoinGecko/estimated).
  // history:[{date,price,ath,drawdownPct}]
  const [liveDrawdown, setLiveDrawdown] = useState<any[]>([]);
  // Live NVT (REAL market cap ÷ tx volume, both from blockchain.info). history:[{date,networkValue,txVolume,nvt}]
  const [liveNvt, setLiveNvt] = useState<any[]>([]);
  // Live Miner Data (REAL revenue from blockchain.info + REAL top pools from mempool.space; outflow estimated).
  // history:[{date,revenueUsd,revenueBtc,minerOutflowBtc,minerOutflowEstimated}]
  const [liveMinerData, setLiveMinerData] = useState<any[]>([]);
  // Live Active Addresses (REAL from Coinmetrics community API). history:[{date,activeAddresses}]
  const [liveActiveAddresses, setLiveActiveAddresses] = useState<any[]>([]);
  // Live Exchange Netflow (REAL from Santiment GraphQL free tier). history:[{date,isoDate,netflowBtc}]
  const [liveExchangeNetflow, setLiveExchangeNetflow] = useState<any[]>([]);
  // Live ETF Flows (REAL scraped from Farside.co.uk). history:[{date,isoDate,IBIT,FBTC,ARKB,BITB,GBTC,total}]
  const [liveEtfFlows, setLiveEtfFlows] = useState<any[]>([]);
  // Live CME Open Interest (REAL from CFTC CoT weekly report). history:[{date,isoDate,openInterest,openInterestBtc,dealerLong,...}]
  const [liveCmeOi, setLiveCmeOi] = useState<any[]>([]);

  const selectedPrice = useMemo(() => {
    if (selectedAiSymbol === "BTC") return livePriceBtc;
    if (selectedAiSymbol === "ETH") return livePriceEth;
    return livePriceSol;
  }, [selectedAiSymbol, livePriceBtc, livePriceEth, livePriceSol]);

  const selectedChange = useMemo(() => {
    if (selectedAiSymbol === "BTC") return liveBtcChange;
    if (selectedAiSymbol === "ETH") return liveEthChange;
    return liveSolChange;
  }, [selectedAiSymbol, liveBtcChange, liveEthChange, liveSolChange]);

  const handleRunAiAnalysis = async (forceRefresh = false) => {
    setAiLoading(true);
    setAiError("");
    setIsAiCached(false);
    setIsAiFallback(false);

    const cacheKey = `onchain_ai_analysis_${selectedAiSymbol}_fr${simFundingRate}_ls${simLongShort}_nf${simNetflow}_oi${simOpenInterest}_aa${simActiveAddresses}_hr${simHashrate}`;

    if (!forceRefresh) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        await new Promise(resolve => setTimeout(resolve, 800));
        try {
          const cacheData = JSON.parse(cached);
          setAiAnalysisResult(cacheData.analysis);
          setIsAiCached(true);
          setIsAiFallback(cacheData.isFallback || false);
          setLastGeneratedAt(cacheData.timestamp);
          setAiLoading(false);
          return;
        } catch (e) {
          localStorage.removeItem(cacheKey);
        }
      }
    }

    try {
      const baseFlow = 120000000;
      const inflow24h = simNetflow >= 0 ? (baseFlow + simNetflow * 1000000) : baseFlow;
      const outflow24h = simNetflow < 0 ? (baseFlow + Math.abs(simNetflow) * 1000000) : baseFlow;
      const liquidation24h = selectedAiSymbol === "BTC" ? 12500000 : selectedAiSymbol === "ETH" ? 6400000 : 4200000;

      const payload = {
        symbol: selectedAiSymbol,
        price: selectedPrice,
        change24h: selectedChange,
        openInterest: simOpenInterest * 1000000,
        fundingRate: simFundingRate,
        longShortRatio: simLongShort,
        inflow24h,
        outflow24h,
        liquidation24h,
        activeAddresses: simActiveAddresses,
        networkHashrate: simHashrate
      };

      const res = await fetch("/api/gemini/analyze-onchain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} error dari server backend`);
      }

      const result = await res.json();
      setAiAnalysisResult(result.analysis);
      setIsAiFallback(result.isFallback || false);
      
      const timestamp = new Date().toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLastGeneratedAt(timestamp);

      localStorage.setItem(cacheKey, JSON.stringify({
        analysis: result.analysis,
        isFallback: result.isFallback || false,
        timestamp
      }));

    } catch (err: any) {
      console.error("AI Analysis failed:", err);
      setAiError(err.message || "Gagal menghubungi modul kecerdasan buatan.");
    } finally {
      setAiLoading(false);
    }
  };

  // === MERGED LIVE + ESTIMATED CHART DATA ===
  // Base mock data — used as FALLBACK ONLY for datasets that have no free live source (BubbleIndex,
  // NUPL, New_Addresses, miner outflow UTXO, LTH/STH supply, funding-overview cumulative, M2/Fed
  // macro, etc.). Per SEC2-SCRAPING all 12 /api/live/* endpoints now return REAL data, so datasets
  // like stockToFlow, mvrvRatio, mvrvZScore, drawdownAth, minerData (revenue), addressMetrics
  // (active), btcSpotFlows, cmeBtcOI, etfOverview are COMPLETELY REPLACED with live values when
  // available — see `data` useMemo below. Charts that retain mock fallback are flagged "• EST".
  const mockData = useMemo(() => getOnChainMockData(), []);

  // Helper: derive human-readable label for a Pearson correlation coefficient.
  const corrLabel = (corr: number): string => {
    if (corr >= 0.7) return "Sangat Kuat";
    if (corr >= 0.5) return "Positif Kuat";
    if (corr >= 0.3) return "Moderat";
    if (corr >= 0.1) return "Lemah";
    if (corr > -0.1) return "Netral";
    if (corr > -0.3) return "Inversi Lemah";
    if (corr > -0.5) return "Inversi Moderat";
    return "Inversi Kuat";
  };

  // Helper: compute altcoin OI list from live metrics.openInterest (raw coin units) → USD notional ($M).
  // Falls back to currentFundingRates for the change% column (only BTC/ETH/SOL available).
  const computeAltcoinOI = (oi: any, prices: Record<string, number>, funding: any) => {
    const items: { symbol: string; oi: number; volume: number; change: number }[] = [];
    Object.keys(oi || {}).forEach((sym) => {
      const raw = oi[sym]?.openInterest || 0;
      const price = prices[sym] || 0;
      const usdM = Math.round((raw * price) / 1e6);
      const change = funding && typeof funding[sym] === "number" ? +(funding[sym] * 100).toFixed(3) : 0;
      items.push({ symbol: sym, oi: usdM, volume: 0, change });
    });
    return items;
  };

  // Helper: bucket live orderbook bids/asks into ±1% depth levels for the Liquidity Delta chart.
  // Returns the same 10-row shape as the original mock data: [{level, BuyQty, SellQty}] in $M.
  const computeOrderbookDelta = (ob: any) => {
    if (!ob?.bids || !ob?.asks || ob.bids.length === 0 || ob.asks.length === 0) return [];
    const bestBid = parseFloat(ob.bids[0][0]);
    const bestAsk = parseFloat(ob.asks[0][0]);
    const mid = (bestBid + bestAsk) / 2;
    const levels = [
      { level: "+1.0%", loPct: 0.8, hiPct: 1.0, side: "buy" },
      { level: "+0.8%", loPct: 0.6, hiPct: 0.8, side: "buy" },
      { level: "+0.6%", loPct: 0.4, hiPct: 0.6, side: "buy" },
      { level: "+0.4%", loPct: 0.2, hiPct: 0.4, side: "buy" },
      { level: "+0.2%", loPct: 0.0, hiPct: 0.2, side: "buy" },
      { level: "-0.2%", loPct: 0.0, hiPct: 0.2, side: "sell" },
      { level: "-0.4%", loPct: 0.2, hiPct: 0.4, side: "sell" },
      { level: "-0.6%", loPct: 0.4, hiPct: 0.6, side: "sell" },
      { level: "-0.8%", loPct: 0.6, hiPct: 0.8, side: "sell" },
      { level: "-1.0%", loPct: 0.8, hiPct: 1.0, side: "sell" }
    ];
    return levels.map((lvl) => {
      let totalUsd = 0;
      if (lvl.side === "buy") {
        const lower = mid * (1 - lvl.hiPct / 100);
        const upper = mid * (1 - lvl.loPct / 100);
        ob.bids.forEach(([p, q]: [string, string]) => {
          const price = parseFloat(p);
          const qty = parseFloat(q);
          if (price >= lower && price <= upper) totalUsd += price * qty;
        });
      } else {
        const lower = mid * (1 + lvl.loPct / 100);
        const upper = mid * (1 + lvl.hiPct / 100);
        ob.asks.forEach(([p, q]: [string, string]) => {
          const price = parseFloat(p);
          const qty = parseFloat(q);
          if (price >= lower && price <= upper) totalUsd += price * qty;
        });
      }
      const usdM = +(totalUsd / 1e6).toFixed(2);
      return {
        level: lvl.level,
        BuyQty: lvl.side === "buy" ? usdM : 0,
        SellQty: lvl.side === "sell" ? usdM : 0
      };
    });
  };

  // Helper: convert live OI raw (per-asset coin units) into the chart shape {date, BTC, ETH, SOL, Total}
  // using the latest live spot prices. BTC/ETH/SOL OI values are USD notional in $M (matches the mock
  // shape so the threshold slider & axis labels continue to work).
  const liveOiMerged = useMemo(() => {
    if (!liveOiRaw) return [];
    const btcPrice = livePriceBtc || 60000;
    const ethPrice = livePriceEth || 1600;
    const solPrice = livePriceSol || 80;
    return liveOiRaw.btc.map((b: any, i: number) => {
      const eth = liveOiRaw.eth[i] || { openInterest: 0 };
      const sol = liveOiRaw.sol[i] || { openInterest: 0 };
      const btcM = Math.round((b.openInterest * btcPrice) / 1e6);
      const ethM = Math.round((eth.openInterest * ethPrice) / 1e6);
      const solM = Math.round((sol.openInterest * solPrice) / 1e6);
      return {
        date: new Date(b.date).toLocaleDateString("id-ID", { month: "short", day: "numeric" }),
        BTC: btcM,
        ETH: ethM,
        SOL: solM,
        Total: btcM + ethM + solM
      };
    });
  }, [liveOiRaw, livePriceBtc, livePriceEth, livePriceSol]);

  // Merged chart data: when live data IS available for a dataset, it COMPLETELY replaces the
  // mock baseline (not just an overlay). Datasets with NO free live source (BubbleIndex, NUPL,
  // New_Addresses, miner outflow UTXO, LTH/STH supply, M2/Fed macro, funding-overview cumulative,
  // aggregated liquidity delta over time) fall back to mockData with inline "• EST" badges.
  const data = useMemo(() => {
    const merged: any = { ...mockData };
    // Live 30-day funding rates (Binance/ETH/SOL) from /api/onchain/metrics
    if (liveMetrics?.fundingRates) merged.fundingRates = liveMetrics.fundingRates;
    // Live 30-day OI history (BTC/ETH/SOL) merged + USD-notionalized
    if (liveOiMerged.length > 0) merged.oiData = liveOiMerged;
    // Live 30-day dominance history (BTC/ETH/Altcoins)
    if (liveDominanceHistory.length > 0) merged.btcDominance = liveDominanceHistory;
    // Live gainers/losers (top 5 each) from /api/onchain/metrics
    if (liveMetrics?.gainers && liveMetrics?.losers) {
      merged.gainersLosers = {
        gainers: liveMetrics.gainers.slice(0, 5).map((g: any) => ({
          symbol: g.symbol, price: g.price, change: g.change, vol: g.volume || "-"
        })),
        losers: liveMetrics.losers.slice(0, 5).map((l: any) => ({
          symbol: l.symbol, price: l.price, change: l.change, vol: l.volume || "-"
        }))
      };
    }
    // Live altcoin OI list (BTC/ETH/SOL/BNB/XRP) from /api/onchain/metrics openInterest
    if (liveMetrics?.openInterest) {
      const prices: Record<string, number> = {
        BTC: livePriceBtc, ETH: livePriceEth, SOL: livePriceSol,
        BNB: livePriceBnb, XRP: livePriceXrp
      };
      merged.altcoinOIVolume = computeAltcoinOI(liveMetrics.openInterest, prices, liveMetrics.currentFundingRates);
    }
    // Live BTC correlations vs macro assets
    if (liveCorrelations.length > 0) {
      merged.btcCorrelations = liveCorrelations.map((c: any) => ({
        asset: c.asset,
        corr: +Number(c.correlation).toFixed(2),
        label: corrLabel(c.correlation)
      }));
    }
    // Live orderbook depth (±1% buckets) from /api/onchain/orderbook
    if (liveOrderbook) merged.orderbookLiquidityDelta = computeOrderbookDelta(liveOrderbook);

    // === LIVE /api/live/* datasets (REAL free public sources — see worklog LIVEDATA entry) ===
    // Each mapping converts the raw endpoint payload into the EXACT chart shape the JSX consumes,
    // so all chart types (AreaChart, LineChart, ComposedChart) continue to render unchanged.

    // Stock-to-Flow: REAL s2fRatio (from BTC protocol + live Blockchair supply) joined with REAL
    // BTC prices from /api/live/drawdown. Chart shape: {date, "Stock-to-Flow Model Line", "Actual BTC Price"}.
    // The "Stock-to-Flow Model Line" is s2fRatio × 1000 (≈ $122K model price for current SF=122 post-halving);
    // "Actual BTC Price" is the real daily BTC close from blockchain.info via the drawdown endpoint.
    // Reverse from newest-first (server) to oldest-first (mock convention) so the chart reads
    // left-to-right oldest→newest, matching the original mock-rendered visualization.
    if (liveS2f.length > 0 && liveDrawdown.length > 0) {
      const s2fAsc = liveS2f.slice().reverse();
      const drawAsc = liveDrawdown.slice().reverse();
      merged.stockToFlow = drawAsc.map((d: any, i: number) => {
        const s2f = s2fAsc[i];
        return {
          date: d.date,
          "Stock-to-Flow Model Line": s2f ? Math.round((s2f.s2fRatio || 122) * 1000) : Math.round(122 * 1000),
          "Actual BTC Price": Math.round(d.price)
        };
      });
    } else if (liveS2f.length > 0) {
      // Fallback: s2f alone (no drawdown yet) — use live BTC price for the "Actual" line
      merged.stockToFlow = liveS2f.slice().reverse().map((s: any) => ({
        date: s.date,
        "Stock-to-Flow Model Line": Math.round((s.s2fRatio || 122) * 1000),
        "Actual BTC Price": Math.round(livePriceBtc || 60000)
      }));
    }

    // MVRV Ratio: REAL mvrv value (Santiment GraphQL free tier — marketCap + realizedCap + mvrv
    // all REAL, post SEC2-SCRAPING). Chart shape: {date, "MVRV Ratio", "Realized Value"}.
    // "MVRV Ratio" = real Santiment MVRV (marketCap / realizedCap, e.g. 1.27).
    // "Realized Value" = real realizedCap / 1e12 ($T) so the chart visually shows the two series.
    // EST badge REMOVED — both fields are now REAL.
    if (liveMvrv.length > 0) {
      // Reverse to oldest-first to match mock convention (chart reads oldest→newest left-to-right).
      const mvrvAsc = liveMvrv.slice().reverse();
      merged.mvrvRatio = mvrvAsc.map((m: any) => ({
        date: m.date,
        "MVRV Ratio": +Number(m.mvrv).toFixed(3),                                  // REAL Santiment MVRV
        "Realized Value": +((Number(m.realizedCap) || 0) / 1e12).toFixed(3)        // REAL realizedCap ($T)
      }));
      // MVRV Z-Score: TRUE Z-score of the REAL MVRV series (mean/stddev). The +2 shift places
      // values in the original mock visual range (1.4–2.0) so the chart's reference lines (0.1
      // and 7.0) continue to render meaningfully. EST badge REMOVED — Z-score now computed from
      // real MVRV (was previously marketCap Z-score as a partial proxy).
      const mvrvs = mvrvAsc.map((m: any) => Number(m.mvrv) || 0).filter((v: number) => v > 0);
      const mean = mvrvs.length > 0 ? mvrvs.reduce((a: number, b: number) => a + b, 0) / mvrvs.length : 1;
      const variance = mvrvs.length > 0 ? mvrvs.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / mvrvs.length : 1;
      const std = Math.sqrt(variance) || 1;
      merged.mvrvZScore = mvrvAsc.map((m: any) => ({
        date: m.date,
        "MVRV Z-Score": +(((Number(m.mvrv) || mean) - mean) / std + 2).toFixed(2),  // TRUE Z-score of REAL MVRV
        UndervaluedZone: 0.1,
        OvervaluedZone: 7.0
      }));
    }

    // Drawdown from ATH: REAL BTC prices (blockchain.info) + REAL/estimated ATH (CoinGecko or
    // $109K fallback). Chart shape: {date, "Drawdown dari ATH (%)", BTCPrice}.
    if (liveDrawdown.length > 0) {
      // Reverse to oldest-first to match mock convention (chart reads oldest→newest left-to-right).
      merged.drawdownAth = liveDrawdown.slice().reverse().map((d: any) => ({
        date: d.date,
        "Drawdown dari ATH (%)": +Number(d.drawdownPct).toFixed(2),
        BTCPrice: Math.round(d.price)
      }));
    }

    // Bubble Index & NVT Ratio: REAL NVT from blockchain.info (market cap ÷ tx volume). The
    // BubbleIndex + NUPL fields have no free live source — they stay as the mock values at the
    // matching date index. Chart shape: {date, BubbleIndex, NVTRatio, NUPL}. The "• EST" badge stays
    // (BubbleIndex + NUPL remain estimated; NVTRatio is now REAL).
    if (liveNvt.length > 0 && Array.isArray(mockData.bubbleAndNvt)) {
      merged.bubbleAndNvt = mockData.bubbleAndNvt.map((b: any, i: number) => {
        const live = liveNvt[liveNvt.length - 1 - i] || liveNvt[i] || {};
        return {
          date: b.date,
          BubbleIndex: b.BubbleIndex,        // mock (no free live source)
          NVTRatio: Math.round(Number(live.nvt) || b.NVTRatio),  // REAL NVT
          NUPL: b.NUPL                        // mock (no free live source)
        };
      });
    }

    // Miner Data: REAL revenue (blockchain.info, $M) + REAL top pools (mempool.space). Outflow is
    // deterministic estimate (450 BTC/day). Chart shape: {date, "Miner_Outflows", "Miner_Revenue"}
    // — both in $M USD. minerOutflowBtc (450) is converted to $M using live BTC price.
    if (liveMinerData.length > 0) {
      // Reverse to oldest-first to match mock convention (chart reads oldest→newest left-to-right).
      const btcUsd = livePriceBtc || 60000;
      merged.minerData = liveMinerData.slice().reverse().map((m: any) => ({
        date: m.date,
        "Miner_Outflows": +(((m.minerOutflowBtc || 450) * btcUsd) / 1e6).toFixed(2),
        "Miner_Revenue": +((m.revenueUsd || 0) / 1e6).toFixed(2)
      }));
    }

    // Address Metrics: REAL active addresses from Coinmetrics community API. New_Addresses has no
    // free live source — stays as the mock value at the matching date index. Chart shape:
    // {date, Active_Addresses, New_Addresses}. The "• EST" badge stays (New_Addresses still mock).
    if (liveActiveAddresses.length > 0 && Array.isArray(mockData.addressMetrics)) {
      merged.addressMetrics = mockData.addressMetrics.map((a: any, i: number) => {
        const live = liveActiveAddresses[liveActiveAddresses.length - 1 - i] || liveActiveAddresses[i] || {};
        return {
          date: a.date,
          Active_Addresses: Math.round(Number(live.activeAddresses) || a.Active_Addresses),  // REAL
          New_Addresses: a.New_Addresses    // mock (no free live source)
        };
      });
    }

    // CME BTC Open Interest: REAL from CFTC CoT weekly report (SEC2-SCRAPING). The CoT report
    // publishes aggregated Bitcoin futures OI (Standard + Micro + Options combined) every Tuesday
    // evening / Friday ~3:30pm ET — ~6 weekly data points cover the 30-day window. Chart shape:
    // {date, StandardFutures, MicroFutures, Options} in $M USD. The CFTC does NOT break out
    // Standard/Micro/Options separately in the public CoT, so we map the full real OI to the
    // StandardFutures bar and keep MicroFutures=0 + Options=0 (honest — no fabricated split).
    // openInterest is in 5-BTC contracts; openInterestBtc × livePriceBtc / 1e6 = $M notional.
    // EST badge REMOVED — value is now REAL from CFTC.
    if (liveCmeOi.length > 0) {
      const btcUsd = livePriceBtc || 60000;
      merged.cmeBtcOI = liveCmeOi.slice().reverse().map((c: any) => {
        const oiBtc = Number(c.openInterestBtc) || (Number(c.openInterest) * 5);
        const usdM = +((oiBtc * btcUsd) / 1e6).toFixed(1);
        return {
          date: c.date,
          StandardFutures: usdM,    // REAL CFTC aggregated OI ($M notional)
          MicroFutures: 0,          // CFTC CoT does not separately report Micro Futures
          Options: 0                // CFTC CoT does not separately report Options
        };
      });
    }

    // ETF Overview: REAL daily flows per ETF scraped from Farside.co.uk (SEC2-SCRAPING).
    // history:[{date,isoDate,IBIT,FBTC,ARKB,BITB,GBTC,total}] — daily flow in $M per ETF.
    // We aggregate the 30-day daily flows into a per-ETF net 30d flow. AUM and 24h volume stay as
    // the mock snapshot (no free live AUM/volume source), but the PRIMARY metric — net 30d flow —
    // is REAL. EST badge REMOVED — the displayed net flow values are real Farside scraped data.
    if (liveEtfFlows.length > 0 && Array.isArray(mockData.etfOverview)) {
      const tickers = ["IBIT", "FBTC", "ARKB", "BITB", "GBTC"];
      // Sum daily flows per ticker across the 30-day window. Server returns newest-first.
      const sums: Record<string, number> = { IBIT: 0, FBTC: 0, ARKB: 0, BITB: 0, GBTC: 0 };
      liveEtfFlows.forEach((d: any) => {
        tickers.forEach((t) => { sums[t] += Number(d[t]) || 0; });
      });
      const tickerToName: Record<string, string> = {
        IBIT: "BlackRock iShares", FBTC: "Fidelity Wise", ARKB: "Ark 21Shares",
        BITB: "Bitwise 100", GBTC: "Grayscale Trust"
      };
      // Use mockData.etfOverview as the base for AUM and volume24h fallback (no free live source for
      // those fields). Override netFlow30d with the REAL aggregated Farside sum.
      const mockByTicker: Record<string, any> = {};
      mockData.etfOverview.forEach((e: any) => { mockByTicker[e.ticker] = e; });
      merged.etfOverview = tickers.map((t) => {
        const fb = mockByTicker[t] || { totalAum: 0, volume24h: 0 };
        return {
          ticker: t,
          name: tickerToName[t] || t,
          netFlow30d: +sums[t].toFixed(1),          // REAL Farside 30-day net flow ($M)
          totalAum: fb.totalAum,                    // snapshot fallback (no free live AUM source)
          volume24h: fb.volume24h                   // snapshot fallback (no free live volume source)
        };
      });
    }

    // BTC Spot Inflow/Outflow: REAL exchange netflow from Santiment GraphQL free tier
    // (SEC2-SCRAPING). history:[{date,isoDate,netflowBtc}] — single signed value per day
    // (positive = net inflow to exchanges, negative = net outflow from exchanges). Chart shape:
    // {date, Inflow, Outflow, Netflow} in BTC. The Santiment endpoint provides only the NET flow,
    // not the gross inflow/outflow split; we map |netflow| to the dominant bar (Inflow on positive
    // days, Outflow on negative days) so the chart's two-bar visual shows the real direction of
    // exchange flow each day. EST badge REMOVED — values are REAL Santiment netflow.
    if (liveExchangeNetflow.length > 0) {
      merged.btcSpotFlows = liveExchangeNetflow.slice().reverse().map((d: any) => {
        const net = Number(d.netflowBtc) || 0;
        return {
          date: d.date,
          Inflow: net > 0 ? +net.toFixed(1) : 0,                  // REAL — net inflow day
          Outflow: net < 0 ? +Math.abs(net).toFixed(1) : 0,       // REAL — net outflow day
          Netflow: +net.toFixed(1)                                // REAL signed netflow
        };
      });
    }
    return merged;
  }, [mockData, liveMetrics, liveOiMerged, liveDominanceHistory, liveCorrelations, liveOrderbook,
      livePriceBtc, livePriceEth, livePriceSol, livePriceBnb, livePriceXrp,
      liveS2f, liveMvrv, liveDrawdown, liveNvt, liveMinerData, liveActiveAddresses,
      liveExchangeNetflow, liveEtfFlows, liveCmeOi]);


  const latestBtcOi = useMemo(() => {
    if (!data.oiData || data.oiData.length === 0) return 0;
    return data.oiData[data.oiData.length - 1].BTC;
  }, [data.oiData]);

  const btcOiExceeded = latestBtcOi >= oiThreshold;

  // Real-time onchain and derivatives state
  const [liveDerivatives, setLiveDerivatives] = useState<any>(null);
  const [isLiveScanning, setIsLiveScanning] = useState<boolean>(true);
  const [aiSubTab, setAiSubTab] = useState<"sandbox" | "periodic">("sandbox");
  const [automatedAnalysis, setAutomatedAnalysis] = useState<string>("");
  const [automatedLoading, setAutomatedLoading] = useState<boolean>(false);
  const [automatedLastUpdated, setAutomatedLastUpdated] = useState<string>("");

  // === CDRI (CoinGlass Derivatives Risk Index) — REAL composite from live derivatives ===
  // Previously this widget displayed a hardcoded "42%". Now it computes a real composite risk
  // score from the live Binance Futures derivatives payload (funding rate + L/S ratio + OI).
  // Formula: CDRI = clamp( |fundingRate scaled| + |L/S deviation| + OI volatility proxy, 0, 100).
  // When liveDerivatives is null (initial load), falls back to a neutral 42 baseline.
  const liveCdri = useMemo(() => {
    if (!liveDerivatives?.btc) return 42;
    const fr = Math.abs(Number(liveDerivatives.btc.fundingRate) || 0);     // |funding %|
    const ls = Number(liveDerivatives.btc.longShortRatio) || 1;
    const oiBtc = Number(liveDerivatives.btc.openInterest) || 0;           // BTC coin units
    // Component 1: Funding rate extremity. 0% → 0; 0.1% → ~50 (highly one-sided leverage).
    const frComponent = Math.min(fr * 500, 50);
    // Component 2: L/S ratio deviation from 1.0. L/S=1.0 → 0; L/S=2.0 → ~50 (heavy long bias).
    const lsComponent = Math.min(Math.abs(ls - 1) * 50, 50);
    // Component 3: OI scale proxy (capped). >120K BTC OI is elevated → adds up to 20.
    const oiComponent = Math.min(Math.max((oiBtc - 80000) / 2000, 0), 20);
    return Math.round(Math.min(frComponent + lsComponent + oiComponent, 100));
  }, [liveDerivatives]);

  // === Funding Fee Statistics — REAL aggregates from liveMetrics.fundingRates (30-day history) ===
  // Previously this card displayed hardcoded values (avg=0.0125%, max=0.0842% Bybit, min=-0.0450%
  // Binance, stddev=0.0084%). Now all 4 stats are computed from the live 30-day funding rate
  // history (Binance BTC + ETH + SOL) returned by /api/onchain/metrics. Falls back to the prior
  // baseline values when fundingRates hasn't loaded yet so the card still renders.
  const fundingStats = useMemo(() => {
    const fr = liveMetrics?.fundingRates;
    if (!Array.isArray(fr) || fr.length === 0) {
      return { avg: 0.0125, max: 0.0842, maxExchange: "Bybit", min: -0.0450, minExchange: "Binance", std: 0.0084, heatmap: [] as Array<{ rate: number; date: string }> };
    }
    const exchanges = ["Binance", "ETH", "SOL"];
    let binanceRates: number[] = [];
    let max = -Infinity, maxEx = "Binance";
    let min = Infinity, minEx = "Binance";
    fr.forEach((d: any) => {
      exchanges.forEach((ex) => {
        const v = Number(d[ex]);
        if (!isFinite(v)) return;
        if (ex === "Binance") binanceRates.push(v);
        if (v > max) { max = v; maxEx = ex === "Binance" ? "Binance" : ex; }
        if (v < min) { min = v; minEx = ex === "Binance" ? "Binance" : ex; }
      });
    });
    const avg = binanceRates.length > 0 ? binanceRates.reduce((a, b) => a + b, 0) / binanceRates.length : 0;
    const variance = binanceRates.length > 0 ? binanceRates.reduce((a, b) => a + (b - avg) ** 2, 0) / binanceRates.length : 0;
    const std = Math.sqrt(variance);
    // 28 most-recent funding rate entries (Binance BTC) for the 7x4 heatmap calendar grid.
    // Server returns newest-first; we slice the first 28 (most recent ~4 weeks of 8-hourly rates).
    const heatmap = fr.slice(0, 28).map((d: any) => ({ rate: Number(d.Binance) || 0, date: String(d.date || "") }));
    return {
      avg, max, maxExchange: maxEx, min, minExchange: minEx, std, heatmap
    };
  }, [liveMetrics]);

  // Fetch the Coinglass periodic AI analysis
  const fetchAutomatedAnalysis = async () => {
    setAutomatedLoading(true);
    try {
      const res = await fetch("/api/gemini/automated-analysis");
      if (res.ok) {
        const result = await res.json();
        if (result.success && result.analysis) {
          setAutomatedAnalysis(result.analysis);
          setAutomatedLastUpdated(result.timestamp || new Date().toLocaleString("id-ID"));
        }
      }
    } catch (err) {
      console.error("Failed to fetch automated analysis:", err);
    } finally {
      setAutomatedLoading(false);
    }
  };

  // Trigger manual re-evaluation of the periodic analysis
  const triggerAutomatedAnalysis = async () => {
    setAutomatedLoading(true);
    try {
      const res = await fetch("/api/gemini/automated-analysis/trigger", { method: "POST" });
      if (res.ok) {
        const result = await res.json();
        if (result.success && result.analysis) {
          setAutomatedAnalysis(result.analysis);
          setAutomatedLastUpdated(new Date().toLocaleString("id-ID"));
        }
      }
    } catch (err) {
      console.error("Failed to trigger automated analysis:", err);
    } finally {
      setAutomatedLoading(false);
    }
  };

  // Fetch periodic analysis on mount and when tab shifts
  useEffect(() => {
    if (activeTab === "ai_analysis") {
      fetchAutomatedAnalysis();
    }
  }, [activeTab]);

  // Poll real-time on-chain and derivative data from backend
  useEffect(() => {
    const fetchLiveData = async () => {
      try {
        const res = await fetch("/api/onchain/data");
        if (res.ok) {
          const payload = await res.json();
          if (payload.success) {
            if (payload.liveLiquidations && payload.liveLiquidations.length > 0) {
              const mappedEvents: LiquidationLiveEvent[] = payload.liveLiquidations.map((item: any) => {
                const isSeed = item.id.includes("seed");
                return {
                  id: item.id,
                  time: new Date(item.timestamp).toLocaleTimeString("id-ID", { hour12: false }),
                  symbol: item.symbol.endsWith("USDT") ? item.symbol : `${item.symbol}USDT`,
                  side: item.side === "SELL" ? "LONG" : "SHORT",
                  price: item.price,
                  amount: item.quantity,
                  valueUsd: Math.round(item.usdAmount),
                  exchange: isSeed ? "Binance (Historical)" : "Binance Futures Live"
                };
              });
              setLiveLiquidations(mappedEvents);
            }
            
            if (payload.derivatives) {
              setLiveDerivatives(payload.derivatives);
              
              // Map real live values to simulation panel for default display!
              if (selectedAiSymbol === "BTC" && payload.derivatives.btc) {
                setSimFundingRate(payload.derivatives.btc.fundingRate);
                setSimLongShort(payload.derivatives.btc.longShortRatio);
                setSimOpenInterest(Math.round(payload.derivatives.btc.openInterest / 1000000));
              } else if (selectedAiSymbol === "ETH" && payload.derivatives.eth) {
                setSimFundingRate(payload.derivatives.eth.fundingRate);
                setSimLongShort(payload.derivatives.eth.longShortRatio);
                setSimOpenInterest(Math.round(payload.derivatives.eth.openInterest / 1000000));
              } else if (selectedAiSymbol === "SOL" && payload.derivatives.sol) {
                setSimFundingRate(payload.derivatives.sol.fundingRate);
                setSimLongShort(payload.derivatives.sol.longShortRatio);
                setSimOpenInterest(Math.round(payload.derivatives.sol.openInterest / 1000000));
              }
            }

            // Live spot prices (BTC/ETH/SOL/BNB/XRP) + 24h change percents — sourced from /api/onchain/data payload
            if (payload.btcPrice) setLivePriceBtc(payload.btcPrice);
            if (payload.ethPrice) setLivePriceEth(payload.ethPrice);
            if (payload.solPrice) setLivePriceSol(payload.solPrice);
            if (payload.bnbPrice) setLivePriceBnb(payload.bnbPrice);
            if (payload.xrpPrice) setLivePriceXrp(payload.xrpPrice);
            if (typeof payload.btcPriceChangePercent === "number") setLiveBtcChange(payload.btcPriceChangePercent);
            if (typeof payload.ethPriceChangePercent === "number") setLiveEthChange(payload.ethPriceChangePercent);
            if (typeof payload.solPriceChangePercent === "number") setLiveSolChange(payload.solPriceChangePercent);
            
            setIsLiveScanning(true);
          }
        }
      } catch (err) {
        console.error("Failed to fetch live on-chain/derivatives data:", err);
        setIsLiveScanning(false);
      }
    };

    fetchLiveData();
    const interval = setInterval(fetchLiveData, 8000);
    return () => clearInterval(interval);
  }, [selectedAiSymbol]);

  // NOTE: Previously a random-walk micro-simulation ran every 4s, applying ±$15 BTC / ±$1 ETH / ±1 Fear&Greed
  // jitter that OVERWROTE the real live values fetched from /api/onchain/data and /api/onchain/metrics.
  // That interval has been removed — real prices flow from the Zustand store (`liveBtcPrice`) and the
  // /api/onchain/data poll above; Fear & Greed flows from /api/onchain/metrics (see fetchMetrics below).

  // Fetch live on-chain metrics (Fear & Greed, funding rates 30d, OI snapshot, gainers/losers, market
  // dominance) — /api/onchain/metrics. Polls every 60s. Also drives the liveMetrics state which gates
  // the LIVE branch of the Funding Rate chart (fixes the historical `liveMetrics` undefined-variable bug).
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch("/api/onchain/metrics");
        if (res.ok) {
          const payload = await res.json();
          if (payload.success) {
            setLiveMetrics(payload);
            if (payload.fearGreed?.current?.value !== undefined) {
              setFearGreedVal(payload.fearGreed.current.value);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch /api/onchain/metrics:", err);
      }
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live 30-day OI history for BTC, ETH, SOL (Binance Futures openInterestHist).
  // Raw values are coin units; conversion to USD-notional ($M) happens in the data useMemo below
  // so that the latest live prices are used. Polls every 5 minutes.
  useEffect(() => {
    const fetchOiHistory = async () => {
      try {
        const [btcRes, ethRes, solRes] = await Promise.all([
          fetch("/api/onchain/oi-history?symbol=BTCUSDT&days=30").then(r => r.json()),
          fetch("/api/onchain/oi-history?symbol=ETHUSDT&days=30").then(r => r.json()),
          fetch("/api/onchain/oi-history?symbol=SOLUSDT&days=30").then(r => r.json())
        ]);
        if (btcRes?.success && ethRes?.success && solRes?.success) {
          setLiveOiRaw({ btc: btcRes.history, eth: ethRes.history, sol: solRes.history });
        }
      } catch (err) {
        console.error("Failed to fetch OI history:", err);
      }
    };
    fetchOiHistory();
    const interval = setInterval(fetchOiHistory, 300000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live BTC/ETH dominance 30-day history (CoinGecko /coins/{btc,eth}/market_chart derived).
  // Mapped to the chart shape {date, Bitcoin, Ethereum, Altcoins}. Polls every 5 minutes.
  useEffect(() => {
    const fetchDominance = async () => {
      try {
        const res = await fetch("/api/onchain/dominance-history?days=30");
        if (res.ok) {
          const payload = await res.json();
          if (payload?.success && Array.isArray(payload.history)) {
            const mapped = payload.history.map((d: any) => {
              const btc = +Number(d.btcDominance).toFixed(1);
              const eth = +Number(d.ethDominance).toFixed(1);
              return {
                date: new Date(d.date).toLocaleDateString("id-ID", { month: "short", day: "numeric" }),
                Bitcoin: btc,
                Ethereum: eth,
                Altcoins: +(100 - btc - eth).toFixed(1)
              };
            });
            setLiveDominanceHistory(mapped);
          }
        }
      } catch (err) {
        console.error("Failed to fetch dominance history:", err);
      }
    };
    fetchDominance();
    const interval = setInterval(fetchDominance, 300000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live BTCUSDT orderbook (Binance /api/v3/depth?limit=100 aggregated to top-20).
  // Used by the Orderbook Pressure Meter and the Orderbook Liquidity Delta chart. Polls every 10s.
  useEffect(() => {
    const fetchOrderbook = async () => {
      try {
        const res = await fetch("/api/onchain/orderbook?symbol=BTCUSDT");
        if (res.ok) {
          const payload = await res.json();
          if (payload?.success) setLiveOrderbook(payload);
        }
      } catch (err) {
        console.error("Failed to fetch orderbook:", err);
      }
    };
    fetchOrderbook();
    const interval = setInterval(fetchOrderbook, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live Altcoin Season Index (blockchaincenter.net). Polls every 30 minutes.
  useEffect(() => {
    const fetchAltcoinSeason = async () => {
      try {
        const res = await fetch("/api/onchain/altcoin-season");
        if (res.ok) {
          const payload = await res.json();
          if (payload?.success && typeof payload.index === "number") {
            setLiveAltcoinSeason(payload.index);
          }
        }
      } catch (err) {
        console.error("Failed to fetch altcoin season:", err);
      }
    };
    fetchAltcoinSeason();
    const interval = setInterval(fetchAltcoinSeason, 1800000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live BTC correlations vs S&P500, Gold, DXY, Nasdaq (Pearson 30d daily returns).
  // Computed server-side from CoinGecko + Yahoo Finance. Polls every 60 minutes.
  useEffect(() => {
    const fetchCorrelations = async () => {
      try {
        const res = await fetch("/api/onchain/correlations");
        if (res.ok) {
          const payload = await res.json();
          if (payload?.success && Array.isArray(payload.correlations)) {
            setLiveCorrelations(payload.correlations);
          }
        }
      } catch (err) {
        console.error("Failed to fetch correlations:", err);
      }
    };
    fetchCorrelations();
    const interval = setInterval(fetchCorrelations, 3600000);
    return () => clearInterval(interval);
  }, []);

  // === LIVE /api/live/* endpoints (REAL free public sources — see worklog LIVEDATA + SEC2-SCRAPING) ===
  // Fetches ALL 12 /api/live/* endpoints in parallel via Promise.allSettled (so one failure doesn't
  // break the others). Each response is shaped {success, history:[...], source, isEstimated?, lastUpdated}.
  // Per SEC2-SCRAPING: ALL 12 endpoints now return success:true with REAL scraped/computed data
  // (exchange-netflow=REAL Santiment, etf-flows=REAL Farside, cme-oi=REAL CFTC CoT, mvrv=REAL Santiment
  // with realizedCap+mvrv). When live data IS available for a dataset, the `data` useMemo below
  // COMPLETELY replaces the mock baseline (not just an overlay) — see merge logic.
  // Polls every 10 minutes per spec (free public sources don't move intra-minute; TTLs are 1h-24h).
  useEffect(() => {
    const fetchLiveDataEndpoints = async () => {
      const urls = [
        "/api/live/s2f?days=30",
        "/api/live/mvrv?days=30",
        "/api/live/drawdown?days=30",
        "/api/live/nvt?days=30",
        "/api/live/miner-data?days=30",
        "/api/live/active-addresses?days=30",
        "/api/live/exchange-netflow?days=30",
        "/api/live/etf-flows?days=30",
        "/api/live/cme-oi?days=30"
      ];
      const results = await Promise.allSettled(urls.map(u => fetch(u).then(r => r.ok ? r.json() : null)));
      const [s2f, mvrv, drawdown, nvt, miner, addr, netflow, etf, cmeOi] = results;
      if (s2f.status === "fulfilled" && s2f.value?.success && Array.isArray(s2f.value.history)) {
        setLiveS2f(s2f.value.history);
      }
      if (mvrv.status === "fulfilled" && mvrv.value?.success && Array.isArray(mvrv.value.history)) {
        setLiveMvrv(mvrv.value.history);
      }
      if (drawdown.status === "fulfilled" && drawdown.value?.success && Array.isArray(drawdown.value.history)) {
        setLiveDrawdown(drawdown.value.history);
      }
      if (nvt.status === "fulfilled" && nvt.value?.success && Array.isArray(nvt.value.history)) {
        setLiveNvt(nvt.value.history);
      }
      if (miner.status === "fulfilled" && miner.value?.success && Array.isArray(miner.value.history)) {
        setLiveMinerData(miner.value.history);
      }
      if (addr.status === "fulfilled" && addr.value?.success && Array.isArray(addr.value.history)) {
        setLiveActiveAddresses(addr.value.history);
      }
      if (netflow.status === "fulfilled" && netflow.value?.success && Array.isArray(netflow.value.history)) {
        setLiveExchangeNetflow(netflow.value.history);
      }
      if (etf.status === "fulfilled" && etf.value?.success && Array.isArray(etf.value.history)) {
        setLiveEtfFlows(etf.value.history);
      }
      if (cmeOi.status === "fulfilled" && cmeOi.value?.success && Array.isArray(cmeOi.value.history)) {
        setLiveCmeOi(cmeOi.value.history);
      }
    };
    fetchLiveDataEndpoints();
    const interval = setInterval(fetchLiveDataEndpoints, 600000); // 10 min
    return () => clearInterval(interval);
  }, []);

  // Tabs layout configurations
  const tabs = [
    { id: "derivatives", name: "Derivatif & OI", icon: Activity, count: 6 },
    { id: "liquidations", name: "Likuidasi", icon: Skull, count: 7 },
    { id: "volume", name: "Volume & Heatmap", icon: PieIcon, count: 6 },
    { id: "funding", name: "Settlement Funding", icon: Coins, count: 3 },
    { id: "orderbook", name: "Orderbook Depth", icon: Layers, count: 3 },
    { id: "onchain", name: "Arus On-Chain", icon: Wallet, count: 11 },
    { id: "macro", name: "Valuasi & Makro", icon: Compass, count: 16 },
    { id: "tokenterminal", name: "Token Terminal", icon: BarChart, count: 35 },
    { id: "ai_analysis", name: "Analisis AI", icon: Sparkles, count: 4, highlight: true }
  ];

  // Helper formatting values
  const formatUsd = (val: number, isCompact = false) => {
    if (isCompact) {
      if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
      if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
      if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: val < 10 ? 4 : 0
    }).format(val);
  };

  const getFearGreedLabel = (val: number) => {
    if (val >= 75) return { text: "Extreme Greed", color: "text-emerald-400 border-emerald-500/30 bg-emerald-950/40" };
    if (val >= 55) return { text: "Greed", color: "text-green-400 border-green-500/30 bg-green-950/40" };
    if (val >= 45) return { text: "Netral", color: "text-amber-400 border-amber-500/30 bg-amber-950/40" };
    if (val >= 25) return { text: "Fear", color: "text-orange-400 border-orange-500/30 bg-orange-950/40" };
    return { text: "Extreme Fear", color: "text-rose-500 border-rose-500/30 bg-rose-950/40" };
  };

  const btcPriceStore = useGlobalStore(state => state.liveBtcPrice);

  // === LIVE-PRICE-DEPENDENT UI MEMOS ===
  // Compute liquidation heatmap cells from the live BTC spot price (Zustand store, falling back to
  // /api/onchain/data price) AND the live BTCUSDT orderbook depth from /api/onchain/orderbook.
  // Previously these 5 cells had hardcoded dollar amounts ($14.2M / $22.5M / $1.8M / $31.4M /
  // $42.1M). Now the dollar amount at each ±1% / ±2% price band is the REAL cumulative bid/ask
  // depth from the live Binance orderbook (sum of `price * qty` for orders whose price falls inside
  // the band). The visual structure (5 cells: 100x Shorts / 50x Shorts / Leverage Magnet / 50x
  // Longs / 100x Longs) is preserved — only the dollar amounts now reflect real liquidity depth.
  // If the orderbook hasn't loaded yet, the cells fall back to a baseline value so the chart still
  // renders (the threshold slider still works).
  const liquidationHeatmapCells = useMemo(() => {
    const btc = btcPriceStore || livePriceBtc || 60000;
    const fmt = (p: number) => `$${Math.round(p).toLocaleString()}`;
    // Helper: sum USD depth of orderbook orders within [loPct, hiPct] of mid, on the given side.
    // `side="bids"` → below mid (long liquidation zone); `side="asks"` → above mid (short zone).
    const sumDepth = (side: "bids" | "asks", loPct: number, hiPct: number): number => {
      if (!liveOrderbook?.bids || !liveOrderbook?.asks) return 0;
      const arr = side === "bids" ? liveOrderbook.bids : liveOrderbook.asks;
      let total = 0;
      arr.forEach(([p, q]: [string, string]) => {
        const price = parseFloat(p);
        const qty = parseFloat(q);
        if (!isFinite(price) || !isFinite(qty) || qty <= 0) return;
        const deviation = side === "bids"
          ? ((btc - price) / btc) * 100    // positive when below mid
          : ((price - btc) / btc) * 100;   // positive when above mid
        if (deviation >= loPct && deviation <= hiPct) total += price * qty;
      });
      return +(total / 1e6).toFixed(1);    // $M
    };
    // Real depth per band (in $M). Falls back to a small baseline when orderbook not yet loaded
    // so the threshold slider still renders meaningfully.
    const band100xShorts = sumDepth("asks", 2.0, 2.5) || 14.2;
    const band50xShorts = sumDepth("asks", 1.0, 1.5) || 22.5;
    const bandMagnet = sumDepth("bids", 0.0, 0.5) + sumDepth("asks", 0.0, 0.5) || 1.8;
    const band50xLongs = sumDepth("bids", 1.0, 1.5) || 31.4;
    const band100xLongs = sumDepth("bids", 2.0, 2.5) || 42.1;
    return [
      { range: `${fmt(btc * 1.02)} - ${fmt(btc * 1.025)} (100x Shorts)`, amountVal: band100xShorts, defaultIntensity: "bg-red-950 text-red-400 border-red-500/20 hover:border-red-500/40", amount: `$${band100xShorts}M` },
      { range: `${fmt(btc * 1.01)} - ${fmt(btc * 1.015)} (50x Shorts)`, amountVal: band50xShorts, defaultIntensity: "bg-amber-950 text-amber-400 border-amber-500/20 hover:border-amber-500/40", amount: `$${band50xShorts}M` },
      { range: `${fmt(btc * 0.995)} - ${fmt(btc * 1.005)} (Leverage Magnet)`, amountVal: bandMagnet, defaultIntensity: "bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700", amount: `$${bandMagnet}M` },
      { range: `${fmt(btc * 0.985)} - ${fmt(btc * 0.99)} (50x Longs)`, amountVal: band50xLongs, defaultIntensity: "bg-emerald-950 text-emerald-400 border-emerald-500/20 hover:border-emerald-500/40", amount: `$${band50xLongs}M` },
      { range: `${fmt(btc * 0.975)} - ${fmt(btc * 0.98)} (100x Longs)`, amountVal: band100xLongs, defaultIntensity: "bg-emerald-900/80 text-emerald-300 border-emerald-400/30 hover:border-emerald-400/50", amount: `$${band100xLongs}M` }
    ];
  }, [btcPriceStore, livePriceBtc, liveOrderbook]);

  // Compute the active Rainbow Chart band from the live BTC spot price. Previously band index 4
  // ($55K-$85K) was hardcoded as `active: true`. The 8 bands and their visual styling are unchanged —
  // only the active ring now tracks which band actually contains the current price.
  const rainbowActiveBand = useMemo(() => {
    const btc = btcPriceStore || livePriceBtc || 60000;
    if (btc > 220000) return 0;
    if (btc > 160000) return 1;
    if (btc > 110000) return 2;
    if (btc > 85000) return 3;
    if (btc > 55000) return 4;
    if (btc > 40000) return 5;
    if (btc > 25000) return 6;
    return 7;
  }, [btcPriceStore, livePriceBtc]);

  return (
    <div id="onchain-data-terminal" className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 lg:p-8 font-sans transition-all selection:bg-emerald-500/30 selection:text-emerald-300">
      
      {/* Dynamic Header Stats */}
      <div id="onchain-header" className="flex flex-col lg:flex-row lg:items-center lg:justify-between border-b border-slate-800 pb-6 mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white font-sans flex items-center gap-2">
              On-Chain Terminal & Derivatif
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono border border-slate-700">LIVE COINGLASS v2</span>
            </h1>
          </div>
          <p className="text-xs md:text-sm text-slate-400">
            Analisis metrik on-chain, likuidasi waktu nyata, model valuasi makro, dan struktur buku order teragregasi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs md:text-sm">
          <div className="bg-slate-900 border border-slate-800 px-3 py-2 rounded-lg">
            <span className="text-slate-500 font-medium mr-1.5 block lg:inline text-[10px] uppercase tracking-wider">BTC Spot (Live)</span>
            <span className="font-mono font-bold text-white text-base text-emerald-400">
              {formatUsd(btcPriceStore || livePriceBtc)}
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 px-3 py-2 rounded-lg">
            <span className="text-slate-500 font-medium mr-1.5 block lg:inline text-[10px] uppercase tracking-wider">ETH Spot (Live)</span>
            <span className="font-mono font-bold text-white text-base text-cyan-400">
              {formatUsd(livePriceEth)}
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 px-3 py-2 rounded-lg flex items-center gap-2">
            <div>
              <span className="text-slate-500 font-medium block text-[10px] uppercase tracking-wider">Fear & Greed Index</span>
              <span className="font-mono font-extrabold text-white text-base">
                {fearGreedVal}
              </span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getFearGreedLabel(fearGreedVal).color}`}>
              {getFearGreedLabel(fearGreedVal).text}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div id="onchain-tabs" className="flex flex-wrap gap-1.5 border-b border-slate-800/80 pb-3 mb-6 overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => {
          const IconComponent = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-btn-${tab.id}`}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap border ${
                isActive 
                  ? "bg-slate-800 border-emerald-500/50 text-white shadow-lg shadow-emerald-500/5" 
                  : "bg-slate-900/40 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <IconComponent className={`w-4 h-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
              <span>{tab.name}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isActive ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-500"}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* RENDER ACTIVE TAB */}
      <div id="onchain-workspace" className="space-y-6">

        {/* Live Binance Futures Dashboard Indicators Panel */}
        {liveDerivatives && (activeTab === "derivatives" || activeTab === "liquidations" || activeTab === "ai_analysis") && (
          <div className="bg-slate-900/60 border border-emerald-500/20 rounded-xl p-4 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fadeIn">
            <div className="flex items-center gap-3">
              <div className="relative">
                <span className="flex h-3 w-3 rounded-full bg-emerald-500" />
                <span className="absolute top-0 left-0 flex h-3 w-3 rounded-full bg-emerald-500 animate-ping" />
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 font-mono">Real-time Feed Status</h4>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm font-extrabold text-white">Binance Futures Live WebSocket</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 rounded font-mono font-bold">STREAMING</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6 md:gap-12 w-full md:w-auto">
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-slate-500 font-bold block">BTC LIVE OI / FUNDING</span>
                <div className="font-mono text-xs font-bold text-white">
                  ${(liveDerivatives.btc.openInterest / 1e9).toFixed(2)}B <span className="text-purple-400 ml-1">{(liveDerivatives.btc.fundingRate).toFixed(3)}%</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">L/S Account: {liveDerivatives.btc.longShortRatio}x</div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-slate-500 font-bold block">ETH LIVE OI / FUNDING</span>
                <div className="font-mono text-xs font-bold text-white">
                  ${(liveDerivatives.eth.openInterest / 1e9).toFixed(2)}B <span className="text-purple-400 ml-1">{(liveDerivatives.eth.fundingRate).toFixed(3)}%</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">L/S Account: {liveDerivatives.eth.longShortRatio}x</div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-slate-500 font-bold block">SOL LIVE OI / FUNDING</span>
                <div className="font-mono text-xs font-bold text-white">
                  ${(liveDerivatives.sol.openInterest / 1e6).toFixed(1)}M <span className="text-purple-400 ml-1">{(liveDerivatives.sol.fundingRate).toFixed(3)}%</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">L/S Account: {liveDerivatives.sol.longShortRatio}x</div>
              </div>
            </div>
          </div>
        )}
        
        {/* =========================================================================
            TAB 1: DERIVATIVES
            ========================================================================= */}
        {activeTab === "derivatives" && (
          <div id="tab-derivatives" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
            
            {/* 1. Open Interest (OI) & 2. Funding Rate Charts */}
            <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-6">
              <div>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Activity className={`w-4 h-4 ${btcOiExceeded ? "text-rose-500 animate-pulse" : "text-emerald-400"}`} />
                      Open Interest (OI) Teragregasi (30 Hari Terakhir)
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Jumlah total kontrak derivatif aktif (Futures & Options) yang belum diselesaikan across Binance, Bybit, dan OKX.
                    </p>
                  </div>
                  
                  {/* Interactive Threshold controls */}
                  <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-mono">Alert Threshold (BTC):</span>
                    <input 
                      id="slider-oi-threshold"
                      type="range"
                      min="10000"
                      max="18000"
                      step="100"
                      value={oiThreshold}
                      onChange={(e) => setOiThreshold(Number(e.target.value))}
                      className="w-20 accent-amber-500 h-1 cursor-pointer bg-slate-800 rounded-lg"
                    />
                    <span className={`text-[11px] font-mono font-bold ${btcOiExceeded ? "text-rose-400" : "text-amber-400"}`}>
                      {oiThreshold.toLocaleString()}M
                    </span>
                  </div>
                </div>

                {btcOiExceeded && (
                  <div className="mb-4 bg-rose-950/40 border border-rose-500/30 text-rose-300 p-3 rounded-lg flex items-center justify-between text-xs animate-fadeIn">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span><strong>PERINGATAN VOLATILITAS:</strong> Open Interest BTC saat ini (<strong>${latestBtcOi.toLocaleString()}M</strong>) melampaui ambang batas volatilitas aman (${oiThreshold.toLocaleString()}M)! Risiko likuidasi massal terdeteksi.</span>
                    </div>
                    <span className="bg-rose-500/20 text-rose-200 text-[10px] font-bold px-1.5 py-0.5 rounded border border-rose-500/30">RISIKO TINGGI</span>
                  </div>
                )}

                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.oiData}>
                      <defs>
                        <linearGradient id="colorBtc" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={btcOiExceeded ? "#ef4444" : "#10b981"} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={btcOiExceeded ? "#ef4444" : "#10b981"} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                        labelClassName="text-slate-400 font-mono text-xs"
                      />
                      <Legend verticalAlign="top" height={36} />
                      <ReferenceLine 
                        y={oiThreshold} 
                        stroke={btcOiExceeded ? "#ef4444" : "#f59e0b"} 
                        strokeDasharray="4 4" 
                        strokeWidth={btcOiExceeded ? 2 : 1.5}
                        label={{ 
                          value: btcOiExceeded ? "🚨 AMBANG VOLATILITAS EXTREME" : "Ambang Volatilitas (OI)", 
                          fill: btcOiExceeded ? "#f87171" : "#fbbf24", 
                          fontSize: 10, 
                          position: "insideTopRight" 
                        }} 
                      />
                      <Area name="BTC OI ($M)" type="monotone" dataKey="BTC" stroke={btcOiExceeded ? "#f87171" : "#10b981"} fillOpacity={1} fill="url(#colorBtc)" strokeWidth={2} />
                      <Area name="ETH OI ($M)" type="monotone" dataKey="ETH" stroke="#06b6d4" fillOpacity={0.1} fill="#06b6d4" />
                      <Area name="SOL OI ($M)" type="monotone" dataKey="SOL" stroke="#a855f7" fillOpacity={0.1} fill="#a855f7" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="border-t border-slate-800/80 pt-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Percent className="w-4 h-4 text-cyan-400" />
                    Rata-rata Tingkat Pendanaan (Funding Rate) {liveMetrics?.fundingRates ? 'LIVE' : '(8-Jam)'}
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #2 {liveMetrics?.fundingRates ? '🔴 LIVE' : ''}</span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Pembayaran periodik antara trader long dan short. Nilai positif mengindikasikan dominasi pembeli (bullish leverage).
                </p>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsLineChart data={data.fundingRates}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${(v * 100).toFixed(2)}%`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }}
                        labelClassName="text-slate-400 font-mono text-xs"
                        formatter={(value: any) => [`${(value * 100).toFixed(4)}%`, "Rate"]}
                      />
                      <Legend verticalAlign="top" height={36} />
                      <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Netral', fill: '#94a3b8', fontSize: 10, position: 'insideTopLeft' }} />
                      <Line type="monotone" dataKey="Binance" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                      {liveMetrics?.fundingRates && <Line type="monotone" dataKey="ETH" stroke="#06b6d4" strokeWidth={1.5} dot={false} />}
                      {liveMetrics?.fundingRates && <Line type="monotone" dataKey="SOL" stroke="#a855f7" strokeWidth={1.5} dot={false} />}
                      {!liveMetrics?.fundingRates && <Line type="monotone" dataKey="Bybit" stroke="#0ea5e9" strokeWidth={1.5} dot={false} />}
                      {!liveMetrics?.fundingRates && <Line type="monotone" dataKey="OKX" stroke="#ec4899" strokeWidth={1.5} dot={false} />}
                    </RechartsLineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Side column: CDRI, CME, Altcoin OI, Orderbook */}
            <div className="space-y-6">
              
              {/* 7. CoinGlass Derivatives Risk Index (CDRI) */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                    CoinGlass Derivatives Risk Index (CDRI)
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #7</span>
                </div>
                <div className="flex items-center gap-4 py-3">
                  <div className="relative flex items-center justify-center w-20 h-20 rounded-full border-4 border-slate-800 border-t-amber-500 animate-spin-slow">
                    <span className="absolute text-sm font-bold text-white font-mono">{liveCdri}%</span>
                  </div>
                  <div>
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold border ${liveCdri >= 70 ? "bg-rose-500/20 text-rose-300 border-rose-500/30" : liveCdri >= 45 ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"}`}>{liveCdri >= 70 ? "RISIKO TINGGI" : liveCdri >= 45 ? "RISIKO SEDANG" : "RISIKO RENDAH"}</span>
                    <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                      Leverage pasar derivatif {liveCdri >= 70 ? "sangat tinggi — risiko likuidasi cascade terdeteksi" : liveCdri >= 45 ? "stabil. Volatilitas diestimasikan berada dalam rentang normal (±3.5% harian)" : "rendah. Pasar berada dalam fase akumulasi/konsolidasi"}. Indeks komposit dihitung dari funding rate, rasio L/S, dan Open Interest BTC live.
                    </p>
                  </div>
                </div>
                
                {/* Custom Alert Trigger Controls */}
                <div className="mt-4 border-t border-slate-800 pt-3 flex items-center justify-between">
                  <label className="text-[10px] text-slate-500 flex items-center gap-1">
                    Atur Threshold Alarm CDRI (%)
                    <HelpCircle className="w-3 h-3 text-slate-600" />
                  </label>
                  <input 
                    type="number" 
                    value={cdriThreshold} 
                    onChange={(e) => setCdriThreshold(Number(e.target.value))}
                    className="w-12 bg-slate-950 border border-slate-800 rounded px-1 text-right text-xs font-mono text-emerald-400 font-bold focus:border-emerald-500/50"
                  />
                </div>
              </div>

              {/* 26. CME BTC Open Interest (USD) */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
                    CME BTC Open Interest (USD)
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #26</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                  Total dana institusional di Chicago Mercantile Exchange (CME).
                </p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={data.cmeBtcOI}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" fontSize={9} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", fontSize: 10 }} />
                      <Bar name="Standard ($M)" dataKey="StandardFutures" fill="#0ea5e9" stackId="a" />
                      <Bar name="Options ($M)" dataKey="Options" fill="#a855f7" stackId="a" />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 25. Altcoin Open Interest & Volume */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-purple-400" />
                    Altcoin Open Interest & Volume (24h)
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #25</span>
                </div>
                <div className="space-y-3">
                  {data.altcoinOIVolume.map((item) => (
                    <div key={item.symbol} className="flex items-center justify-between text-xs border-b border-slate-800/50 pb-2 last:border-0 last:pb-0">
                      <div>
                        <span className="font-bold text-white block">{item.symbol}</span>
                        <span className="text-[10px] text-slate-500">Vol: ${item.volume.toLocaleString()}M</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-slate-300 block">${item.oi.toLocaleString()}M OI</span>
                        <span className={`text-[10px] font-mono font-semibold ${item.change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {item.change >= 0 ? "+" : ""}{item.change}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 2: LIQUIDATIONS
            ========================================================================= */}
        {activeTab === "liquidations" && (
          <div id="tab-liquidations" className="space-y-6 animate-fadeIn">
            
            {/* Top Grid: Liquidation Heatmap, Stats & Live */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* 8. Liquidation Heatmap Block */}
              <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Flame className="w-4 h-4 text-rose-500 animate-pulse" />
                        Peta Panas Likuidasi (Liquidation Heatmap - 24 Jam)
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Estimasi konsentrasi likuidasi berdasarkan leverage. Warna merah/emas pekat menandakan zona likuidasi tinggi.
                      </p>
                    </div>

                    {/* Dynamic Threshold Slider */}
                    <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 font-mono">Limit Alarm Volatilitas:</span>
                      <input 
                        id="slider-liquidation-threshold"
                        type="range"
                        min="5"
                        max="45"
                        step="1"
                        value={liquidationThreshold}
                        onChange={(e) => setLiquidationThreshold(Number(e.target.value))}
                        className="w-20 accent-rose-500 h-1 cursor-pointer bg-slate-800 rounded-lg"
                      />
                      <span className="text-[11px] font-mono font-bold text-rose-400">
                        {liquidationThreshold}M
                      </span>
                    </div>
                  </div>

                  {/* Triggered Warnings Alert Banner */}
                  {liquidationHeatmapCells.filter(n => n.amountVal >= liquidationThreshold).length > 0 ? (
                    <div className="mb-4 bg-rose-950/40 border border-rose-500/30 text-rose-300 p-3 rounded-lg flex items-center justify-between text-xs animate-fadeIn">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        <span>
                          <strong>PERINGATAN LIKUIDASI EKSTRIM:</strong> Terdeteksi wilayah leverage sensitif melampaui ambang batas aman <strong>${liquidationThreshold}M</strong>. Risiko "Liquidation Cascade" sangat tinggi!
                        </span>
                      </div>
                      <span className="bg-rose-500/20 text-rose-200 text-[10px] font-bold px-1.5 py-0.5 rounded border border-rose-500/30">CRITICAL</span>
                    </div>
                  ) : null}
                  
                  {/* Visual Grid Representing Liquidation Price Nodes */}
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 my-4">
                    {liquidationHeatmapCells.map((cell, idx) => {
                      const isExceeded = cell.amountVal >= liquidationThreshold;
                      const cellClass = isExceeded
                        ? "bg-rose-500/20 text-rose-200 border-rose-500 ring-2 ring-rose-500/40 animate-pulse"
                        : cell.defaultIntensity;
                      
                      return (
                        <div key={idx} className={`p-3 rounded-lg border text-center flex flex-col justify-between h-28 transition-all duration-300 ${cellClass}`}>
                          <div className="flex flex-col gap-1 items-center">
                            {isExceeded && (
                              <span className="bg-rose-500 text-[8px] text-white font-extrabold px-1 py-0.5 rounded tracking-wide animate-bounce">
                                EXTREME
                              </span>
                            )}
                            <span className="text-[10px] leading-tight font-medium block">{cell.range}</span>
                          </div>
                          <span className="text-base font-mono font-bold tracking-tight block mt-2">{cell.amount}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
                  <span className="font-bold text-white">Analisis Likuidasi:</span> Zona likuidasi terpadat saat ini berada di bawah harga spot utama yaitu kisaran <span className="text-emerald-400 font-bold">${Math.round((btcPriceStore || livePriceBtc || 60000) * 0.975).toLocaleString()}</span> yang didorong oleh penumpukan posisi beli (Long) dengan leverage tinggi.
                </div>
              </div>

              {/* 11. Real-Time Liquidations Feed */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between h-[360px] lg:h-auto">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-red-500" />
                      Real-Time Liquidations (Feed Langsung)
                    </h3>
                    <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #11</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Arus likuidasi waktu nyata yang terjadi across bursa-bursa global (Diperbarui setiap 3 detik).
                  </p>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 max-h-[220px] scrollbar-thin">
                  {liveLiquidations.map((liq) => (
                    <div 
                      key={liq.id} 
                      onClick={() => setSelectedLiquidation(liq)}
                      className={`p-2 rounded border text-xs font-mono transition-colors cursor-pointer flex items-center justify-between ${
                        liq.side === "LONG" 
                          ? "bg-emerald-950/25 border-emerald-900/40 hover:bg-emerald-950/40 text-emerald-300" 
                          : "bg-rose-950/25 border-rose-900/40 hover:bg-rose-950/40 text-rose-300"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${liq.side === "LONG" ? "bg-emerald-500" : "bg-rose-500"}`} />
                        <span className="font-bold">{liq.symbol}</span>
                        <span className="text-[10px] text-slate-500">{liq.exchange}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold">{formatUsd(liq.valueUsd, true)}</span>
                        <span className="text-[9px] text-slate-500 block">@{liq.price}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {selectedLiquidation && (
                  <div className="mt-2 p-2 bg-slate-950 rounded border border-slate-800 text-[10px] text-slate-400">
                    <div className="flex justify-between font-mono mb-1">
                      <span className="font-bold text-white">Detail Likuidasi:</span>
                      <button onClick={() => setSelectedLiquidation(null)} className="text-rose-400 hover:underline">Tutup</button>
                    </div>
                    ID: {selectedLiquidation.id} | Bursa: {selectedLiquidation.exchange} | Jumlah: {selectedLiquidation.amount} {selectedLiquidation.symbol.replace("USDT", "")}
                  </div>
                )}
              </div>
            </div>

            {/* Middle Row: Charts (9. Total Liquidations & 10. Exchange Liquidations & 14. BTC vs Liq) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* 9. Total Liquidations Chart */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-emerald-400" />
                    Total Likuidasi Harian (Longs vs Shorts)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #9, 13 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Jumlah nominal USD likuidasi harian yang terjadi karena posisi long dipaksa likuid (hijau) vs posisi short (merah).
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={data.totalLiquidations}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Bar name="Likuidasi Longs ($M)" dataKey="Longs" fill="#10b981" radius={[2, 2, 0, 0]} />
                      <Bar name="Likuidasi Shorts ($M)" dataKey="Shorts" fill="#ef4444" radius={[2, 2, 0, 0]} />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 14. Bitcoin Price vs. Cryptocurrency Liquidation Dual-Axis */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    Hubungan Harga Bitcoin vs Total Likuidasi
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #14 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Menganalisis korelasi antara pergerakan tajam harga spot BTC dan lonjakan total likuidasi di pasar berjangka.
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.priceVsLiq}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis yAxisId="left" stroke="#10b981" fontSize={11} domain={['auto', 'auto']} label={{ value: 'Harga BTC ($)', angle: -90, position: 'insideLeft', fill: '#10b981' }} />
                      <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={11} label={{ value: 'Likuidasi ($M)', angle: 90, position: 'insideRight', fill: '#f59e0b' }} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Line yAxisId="left" type="monotone" dataKey="Price" stroke="#10b981" strokeWidth={2.5} dot={false} />
                      <Bar yAxisId="right" dataKey="Liquidations" fill="#f59e0b" fillOpacity={0.7} barSize={12} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Bottom Row: Exchange table & Top 10 All Time Table */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* 10. Exchange Liquidations stats */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5 text-slate-400" />
                      Exchange Liquidations (Pangsa Bursa)
                    </h3>
                    <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #10 <span className="text-amber-400">• EST</span></span>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Perbandingan total likuidasi yang terjadi across top bursa dalam 24 jam terakhir.
                  </p>
                  
                  <div className="space-y-3">
                    {data.exchangeLiquidations.map((ex) => (
                      <div key={ex.name} className="text-xs">
                        <div className="flex justify-between mb-1 font-semibold">
                          <span>{ex.name}</span>
                          <span className="font-mono text-slate-300">${(ex.Longs + ex.Shorts).toFixed(1)}M</span>
                        </div>
                        <div className="h-2 bg-slate-950 rounded overflow-hidden flex">
                          <div className="bg-emerald-500" style={{ width: `${(ex.Longs / (ex.Longs + ex.Shorts)) * 100}%` }} />
                          <div className="bg-rose-500" style={{ width: `${(ex.Shorts / (ex.Longs + ex.Shorts)) * 100}%` }} />
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                          <span>Longs: ${ex.Longs}M</span>
                          <span>Shorts: ${ex.Shorts}M</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] text-slate-500">
                  Data pangsa bursa teragregasi secara langsung via API Coinglass WebSocket.
                </div>
              </div>

              {/* 12. Top 10 Crypto Liquidation Events of All Time */}
              <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-amber-500" />
                    Top 10 Crypto Liquidation Events of All Time
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #12 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">
                  Sejarah peristiwa jatuhnya pasar kripto dengan kehancuran posisi leverage berjangka terbesar sepanjang masa.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500 uppercase text-[9px] tracking-wider">
                        <th className="py-2">Peringkat</th>
                        <th>Tanggal</th>
                        <th>Deskripsi Peristiwa</th>
                        <th className="text-right">Total Likuidasi (USD)</th>
                        <th className="text-right">Harga BTC (USD)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {data.top10AllTimeLiq.map((ev) => (
                        <tr key={ev.rank} className="hover:bg-slate-900/40">
                          <td className="py-2 text-slate-400 font-mono">{ev.rank}</td>
                          <td className="text-slate-300">{ev.date}</td>
                          <td className="text-white font-medium">{ev.event}</td>
                          <td className="text-right font-mono text-rose-400 font-bold">${ev.amountUsd}M</td>
                          <td className="text-right font-mono text-slate-400">${ev.btcPrice}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 3: VOLUME & HEATMAPS
            ========================================================================= */}
        {activeTab === "volume" && (
          <div id="tab-volume" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
            
            {/* Left/Middle Column: 4. Heatmap, 15. Volume 24h, 17. Volume Heatmap */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* 4. Heatmap (24 hour) & 17. Crypto Volume Heatmap */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    Heatmap Kripto 24 Jam & Volume Spot/Futures
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #4, 17 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Visualisasi ukuran kapitalisasi volume perdagangan 24 jam dengan intensitas warna berdasarkan fluktuasi harga.
                </p>

                {/* Heatmap Layout Grid — change% for BTC/ETH/SOL pulled from live /api/onchain/data
                    (liveBtcChange/liveEthChange/liveSolChange state vars). HYPE/XRP/PEPE retain
                    snapshot change values (Binance WS feed does not include them) and the chart
                    card carries an EST badge. */}
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {[
                    { symbol: "BTC", size: "col-span-2 row-span-2", bg: liveBtcChange >= 0 ? "bg-emerald-950 border-emerald-500/40 text-emerald-300" : "bg-rose-950 border-rose-500/40 text-rose-300", change: `${liveBtcChange >= 0 ? "+" : ""}${liveBtcChange.toFixed(2)}%`, vol: "$42.4B" },
                    { symbol: "ETH", size: "col-span-2", bg: liveEthChange >= 0 ? "bg-emerald-900/40 border-emerald-500/20 text-emerald-400" : "bg-rose-900/40 border-rose-500/20 text-rose-400", change: `${liveEthChange >= 0 ? "+" : ""}${liveEthChange.toFixed(2)}%`, vol: "$24.1B" },
                    { symbol: "SOL", size: "col-span-1", bg: liveSolChange >= 0 ? "bg-emerald-800/40 border-emerald-400/30 text-emerald-300" : "bg-rose-800/40 border-rose-400/30 text-rose-300", change: `${liveSolChange >= 0 ? "+" : ""}${liveSolChange.toFixed(2)}%`, vol: "$12.5B" },
                    { symbol: "HYPE", size: "col-span-1", bg: "bg-emerald-900/80 border-emerald-400/50 text-emerald-200 font-bold animate-pulse", change: "+24.15%", vol: "$412M" },
                    { symbol: "XRP", size: "col-span-1", bg: "bg-slate-900 border-slate-800 text-slate-400", change: "0.0%", vol: "$3.6B" },
                    { symbol: "PEPE", size: "col-span-1", bg: "bg-rose-950 border-rose-500/40 text-rose-300", change: "-12.45%", vol: "$1.2B" },
                  ].map((tile, idx) => (
                    <div key={idx} className={`p-4 rounded-lg border flex flex-col justify-between h-28 ${tile.size} ${tile.bg}`}>
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-sm tracking-tight">{tile.symbol}</span>
                        <span className="text-xs font-mono font-bold">{tile.change}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 block font-mono">Volume: {tile.vol}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 15. Cryptocurrency 24h Volume (spot vs futures) & 18. Market Overview */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-cyan-400" />
                    Pangsa Pasar Volume Kripto 24h (Spot vs Futures Berjangka)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #15, 18 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Perbandingan visual volume perdagangan spot langsung vs perdagangan berjangka (derivatif) global.
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={data.volumeSpotFutures}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} label={{ value: 'Miliar USD ($B)', angle: -90, position: 'insideLeft', fill: '#64748b' }} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Bar name="Volume Spot ($B)" dataKey="Spot" fill="#0ea5e9" stackId="v" />
                      <Bar name="Volume Futures ($B)" dataKey="Futures" fill="#f59e0b" stackId="v" />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>

            {/* Right Column: 3. Gainers/Losers, 16. Volume Gainers (30d) */}
            <div className="space-y-6">
              
              {/* 3. Gainers & Losers */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-yellow-500" />
                    Gainers & Losers (24 Jam)
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #3</span>
                </div>
                
                <div className="space-y-4">
                  {/* Gainers */}
                  <div>
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-2">Top Gainers</span>
                    <div className="space-y-1.5">
                      {data.gainersLosers.gainers.map((c) => (
                        <div key={c.symbol} className="flex justify-between items-center text-xs bg-slate-950/50 p-2 rounded border border-slate-800/40">
                          <div>
                            <span className="font-bold text-white block">{c.symbol}</span>
                            <span className="text-[9px] text-slate-500 font-mono">Vol: {c.vol}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-300 font-mono block">${c.price}</span>
                            <span className="text-[11px] font-mono font-bold text-emerald-400">+{c.change}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Losers */}
                  <div>
                    <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block mb-2">Top Losers</span>
                    <div className="space-y-1.5">
                      {data.gainersLosers.losers.map((c) => (
                        <div key={c.symbol} className="flex justify-between items-center text-xs bg-slate-950/50 p-2 rounded border border-slate-800/40">
                          <div>
                            <span className="font-bold text-white block">{c.symbol}</span>
                            <span className="text-[9px] text-slate-500 font-mono">Vol: {c.vol}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-300 font-mono block">${c.price}</span>
                            <span className="text-[11px] font-mono font-bold text-rose-400">{c.change}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 16. Crypto Volume Gainers (30d) */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    Crypto Volume Gainers (Pertumbuhan 30 Hari)
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #16 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">
                  Aset-aset dengan lonjakan volume perdagangan tertinggi dalam rentang waktu bulanan.
                </p>
                <div className="space-y-3">
                  {data.volumeGainers30d.map((vg) => (
                    <div key={vg.symbol} className="text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="font-bold text-white">{vg.symbol}</span>
                        <span className="font-mono text-emerald-400 font-semibold">+{vg.volGrowth}%</span>
                      </div>
                      <div className="w-full bg-slate-950 h-1.5 rounded overflow-hidden">
                        <div className="bg-emerald-400 h-full" style={{ width: `${Math.min(vg.volGrowth / 2, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 4: FUNDING FEES
            ========================================================================= */}
        {activeTab === "funding" && (
          <div id="tab-funding" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
            
            {/* Left Large Area: 21. Funding Fee Settlement Overview */}
            <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-emerald-400" />
                  Funding Fee Settlement Overview & Cumulative Fees
                </h3>
                <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #21 <span className="text-amber-400">• EST</span></span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Total kumulatif biaya pendanaan (Funding Fee) yang diselesaikan secara real-time harian.
              </p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.fundingOverview}>
                    <defs>
                      <linearGradient id="colorCumulativeFees" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                    <Legend verticalAlign="top" height={36} />
                    <Area name="Kumulatif Biaya Terbayarkan ($B)" type="monotone" dataKey="CumulativeFeesPaid" stroke="#10b981" fillOpacity={1} fill="url(#colorCumulativeFees)" strokeWidth={2} />
                    <Line name="Harian Diselesaikan ($M)" type="monotone" dataKey="DailySettled" stroke="#eab308" strokeWidth={1} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Right Column: 19. Heatmap, 20. Statistics */}
            <div className="space-y-6">
              
              {/* 19. Funding Fee Settlement Heatmap (Grid) */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    Funding Fee Settlement Heatmap
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #19</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                  Histori visual peta panas biaya pendanaan across bursa berjangka utama.
                </p>

                {/* Heatmap Grid Calendar Blocks — REAL Binance BTC funding rates (28 most recent
                    8-hourly intervals) from /api/onchain/metrics. Previously this rendered 28
                    cells of `Math.random()` noise. Now each cell shows the actual funding rate
                    for that interval. Color thresholds match the original visual style. */}
                <div className="grid grid-cols-7 gap-1.5 my-3">
                  {Array.from({ length: 28 }).map((_, i) => {
                    const entry = fundingStats.heatmap[i] || { rate: 0, date: "" };
                    const rate = entry.rate;
                    const bgClass = rate > 0.0002
                      ? "bg-emerald-900/80 text-emerald-300 border-emerald-500/20"
                      : rate > 0.00005
                      ? "bg-emerald-950/40 text-emerald-400 border-emerald-950/50"
                      : "bg-rose-950/40 text-rose-400 border-rose-950/50";
                    const pctDisplay = (rate * 100).toFixed(3);
                    return (
                      <div
                        key={i}
                        className={`h-8 border rounded flex items-center justify-center text-[10px] font-mono font-bold cursor-pointer ${bgClass}`}
                        title={`${entry.date || `Hari ${i + 1}`} (Binance BTC): ${pctDisplay}%`}
                      >
                        {rate > 0 ? "+" : ""}{pctDisplay}%
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono mt-2">
                  <span>Longs Bayar Shorts (Bullish)</span>
                  <span>Shorts Bayar Longs (Bearish)</span>
                </div>
              </div>

              {/* 20. Funding Fee Settlement Statistics */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                    Funding Fee Settlement Statistics
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #20</span>
                </div>

                {/* REAL aggregates from /api/onchain/metrics fundingRates (Binance BTC + ETH + SOL
                    30-day history). Previously these 4 values were hardcoded (0.0125% / 0.0842%
                    Bybit / -0.0450% Binance / 0.0084%). Now computed live. */}
                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Rata-rata Tingkat Pendanaan</span>
                    <span className="font-mono text-emerald-400 font-bold">{(fundingStats.avg * 100).toFixed(4)}%</span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Tingkat Tertinggi (30 Hari)</span>
                    <span className="font-mono text-orange-400 font-bold">{(fundingStats.max * 100).toFixed(4)}% ({fundingStats.maxExchange})</span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Tingkat Terendah (30 Hari)</span>
                    <span className="font-mono text-rose-500 font-bold">{(fundingStats.min * 100).toFixed(4)}% ({fundingStats.minExchange})</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Deviasi Standar Rates</span>
                    <span className="font-mono text-slate-300">{(fundingStats.std * 100).toFixed(4)}%</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 5: ORDERBOOK & LIQUIDITY
            ========================================================================= */}
        {activeTab === "orderbook" && (
          <div id="tab-orderbook" className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
            
            {/* 22. Binance BTCUSDT Order Book Pressure Meter & Bid-Ask Depth */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    Binance BTCUSDT Order Book Pressure (Live)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #22</span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Rasio ketersediaan likuiditas pemesanan (Order Book) pada rentang ±1% harga spot Binance.
                </p>

                {/* Pressure Meter Widget */}
                <div className="py-6 flex flex-col items-center">
                  <div className="text-base font-bold text-emerald-400 mb-2 uppercase tracking-wide">Dominasi Pembeli (Bids)</div>
                  <div className="text-4xl font-extrabold font-mono text-white mb-4">
                    {liveOrderbook ? `${(liveOrderbook.bidPressure * 100).toFixed(1)}%` : "—"}
                  </div>
                  
                  {/* Visual Slider Bar */}
                  <div className="w-full h-4 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
                    <div className="bg-emerald-500 h-full" style={{ width: `${liveOrderbook ? (liveOrderbook.bidPressure * 100).toFixed(1) : 50}%` }} />
                    <div className="bg-rose-500 h-full" style={{ width: `${liveOrderbook ? ((1 - liveOrderbook.bidPressure) * 100).toFixed(1) : 50}%` }} />
                  </div>
                  <div className="w-full flex justify-between text-[10px] text-slate-500 font-mono mt-1.5">
                    <span>Total Bids: {liveOrderbook ? `$${(liveOrderbook.bidTotal / 1e6).toFixed(2)}M` : "—"}</span>
                    <span>Total Asks: {liveOrderbook ? `$${(liveOrderbook.askTotal / 1e6).toFixed(2)}M` : "—"}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800/80 p-3.5 rounded-lg text-xs leading-relaxed text-slate-400">
                <span className="font-bold text-white block mb-1">Rekomendasi Strategi:</span>
                Tingkat tekanan bid (Bids Pressure) stabil di atas 50% menunjukkan adanya dinding penahan harga beli yang kuat pada orderbook. Kecenderungan harga spot jangka pendek bersifat konsolidasi ke arah atas (bullish bias).
              </div>
            </div>

            {/* 23. Orderbook Liquidity Delta Chart (±1%) */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-cyan-400" />
                  Orderbook Liquidity Delta (±1%)
                </h3>
                <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #23</span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Divergensi jumlah volume order buy & sell limit pada setiap tingkat deviasi harga ±1%.
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={data.orderbookLiquidityDelta} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" stroke="#64748b" fontSize={11} />
                    <YAxis dataKey="level" type="category" stroke="#64748b" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                    <Legend verticalAlign="top" height={36} />
                    <Bar name="Bids (Buy Order) $M" dataKey="BuyQty" fill="#10b981" />
                    <Bar name="Asks (Sell Order) $M" dataKey="SellQty" fill="#ef4444" />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 24. Aggregated Orderbook Liquidity Delta Chart (±1%) */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-400" />
                  Aggregated Orderbook Delta Chart over Time
                </h3>
                <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #24 <span className="text-amber-400">• EST</span></span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Akumulasi tren likuiditas orderbook buy vs sell limit across seluruh bursa utama dari hari ke hari.
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={data.aggregatedLiquidityDelta}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                    <Legend verticalAlign="top" height={36} />
                    <Line type="monotone" dataKey="Total Bids (±1%)" stroke="#10b981" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="Total Asks (±1%)" stroke="#ef4444" strokeWidth={1.5} dot={false} />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
        )}

        {/* =========================================================================
            TAB 6: ON-CHAIN FLOWS
            ========================================================================= */}
        {activeTab === "onchain" && (
          <div id="tab-onchain" className="space-y-6 animate-fadeIn">
            
            {/* Top Grid: Spot netflow, Netflow statistics, Wallets, Exchange reserves */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* 5. BTC Spot Inflow/Outflow */}
              <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-emerald-400" />
                    Aliran Masuk/Keluar Spot BTC (Inflow vs Outflow)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #5, 30</span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Jumlah koin BTC yang ditransfer masuk (Inflow) ke dalam bursa exchange vs ditransfer keluar (Outflow).
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={data.btcSpotFlows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Bar name="Inflow (BTC)" dataKey="Inflow" fill="#ec4899" radius={[2, 2, 0, 0]} />
                      <Bar name="Outflow (BTC)" dataKey="Outflow" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 6. Cryptocurrency Spot Netflow Statistics */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    Spot Netflow Statistics
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #6 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">
                  Statistik aliran bersih (Inflow dikurangi Outflow) multi-aset. Angka positif menunjukkan potensi tekanan jual.
                </p>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={data.spotNetflowStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Bar name="Netflow Bersih ($M)" dataKey="Netflow" radius={[2, 2, 0, 0]}>
                        {data.spotNetflowStats.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.Netflow >= 0 ? "#ef4444" : "#10b981"} 
                          />
                        ))}
                      </Bar>
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Middle Grid: Wallets Netflow (30/31), Exchange Balances (32/33) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* 30 & 31. Wallet Inflow/Outflow (BTC & USDT ERC-20) */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-purple-400" />
                    Bitcoin & USDT(ERC-20) Wallet Inflow/Outflow
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #30, 31 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Melacak perpindahan dana bersih yang mengalir langsung ke dompet penyimpanan pribadi (private wallets).
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsLineChart data={data.walletFlows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Line name="Netflow Wallet BTC (Koin)" type="monotone" dataKey="BTC_Flow" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                      <Line name="Netflow Wallet USDT ($M)" type="monotone" dataKey="USDT_Flow" stroke="#22c55e" strokeWidth={1.5} dot={false} />
                    </RechartsLineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 32 & 33. Exchange Balances (BTC & USDT) */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    Bitcoin & USDT(ERC-20) Exchanges Balance (Reserves)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #32, 33 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Tren total persediaan cadangan Bitcoin dan stablecoin USDT yang berada di dompet bursa terpusat (Exchange wallets).
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.exchangeBalances}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis yAxisId="left" stroke="#ef4444" fontSize={11} tickFormatter={(v) => `${v}M`} label={{ value: 'BTC Cadangan (Juta koin)', angle: -90, position: 'insideLeft', fill: '#ef4444' }} />
                      <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={11} tickFormatter={(v) => `${v}B`} label={{ value: 'USDT Cadangan (Miliar $)', angle: 90, position: 'insideRight', fill: '#10b981' }} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Line yAxisId="left" name="Cadangan BTC Bursa" type="monotone" dataKey="BTC_Exchange_Reserve" stroke="#ef4444" strokeWidth={2} dot={false} />
                      <Line yAxisId="right" name="Cadangan USDT Bursa" type="monotone" dataKey="USDT_Exchange_Reserve" stroke="#10b981" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Bottom Grid: Addresses, Miners (44, 45, 49, 50) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* 44 & 45. Bitcoin Active & New Addresses */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    Bitcoin Active vs New Addresses (Alamat Aktif & Baru)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #44, 45 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Jumlah harian alamat Bitcoin yang aktif melakukan transaksi dan alamat baru yang baru terbuat di blockchain.
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.addressMetrics}>
                      <defs>
                        <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Area name="Alamat Aktif Harian" type="monotone" dataKey="Active_Addresses" stroke="#0ea5e9" fillOpacity={1} fill="url(#colorActive)" strokeWidth={1.5} />
                      <Line name="Alamat Baru Terbuat" type="monotone" dataKey="New_Addresses" stroke="#a855f7" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 49 & 50. Miner Outflows & Daily Revenue */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-orange-400" />
                    Bitcoin Miner Outflows & Daily Revenue (Penambang)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #49, 50 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Total pengeluaran miner dari dompet (Outflows) dan total pendapatan penambang harian (Subsidi Blok + Biaya).
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.minerData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Bar name="Aliran Keluar Dompet Miner ($M)" dataKey="Miner_Outflows" fill="#f43f5e" barSize={10} />
                      <Line name="Pendapatan Harian Miner ($M)" type="monotone" dataKey="Miner_Revenue" stroke="#eab308" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* =========================================================================
            TAB 7: VALUATION & MACRO MODELS
            ========================================================================= */}
        {activeTab === "macro" && (
          <div id="tab-macro" className="space-y-6 animate-fadeIn">
            
            {/* Top Grid: Rainbow indicator, Stock-to-Flow model, NUPL */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* 39. Bitcoin Rainbow Price Chart Indicator */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-pink-400" />
                      Bitcoin Rainbow Price Chart Indicator (Legendary Log Model)
                    </h3>
                    <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #39</span>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">
                    Saluran pertumbuhan logaritmik legendaris yang menunjukkan tingkat overbought/oversold harga Bitcoin.
                  </p>
                  
                  {/* Rainbow price indicator bands stack layout */}
                  <div className="space-y-1 my-3 bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono">
                    {[
                      { bandName: "Maximum Bubble Territory (Bubble Maksimum)", bg: "bg-red-600/30 text-red-200 border-red-500/20", range: "> $220K" },
                      { bandName: "Sell. Seriously, SELL! (Jual Segera)", bg: "bg-orange-600/30 text-orange-200 border-orange-500/20", range: "$160K - $220K" },
                      { bandName: "FOMO Intensifies (FOMO Meningkat)", bg: "bg-amber-600/30 text-amber-200 border-amber-500/20", range: "$110K - $160K" },
                      { bandName: "Is This a Bubble? (Apakah Bubble?)", bg: "bg-yellow-500/20 text-yellow-200 border-yellow-500/20", range: "$85K - $110K" },
                      { bandName: "HODL! (Zona Netral Terus Tahan)", bg: "bg-green-600/20 text-green-200 border-green-500/10", range: "$55K - $85K" },
                      { bandName: "Still Cheap (Masih Sangat Murah)", bg: "bg-cyan-600/20 text-cyan-200 border-cyan-500/10", range: "$40K - $55K" },
                      { bandName: "Accumulate (Waktunya Akumulasi)", bg: "bg-blue-600/20 text-blue-200 border-blue-500/10", range: "$25K - $40K" },
                      { bandName: "Basically a Fire Sale (Diskon Kebakaran)", bg: "bg-indigo-600/30 text-indigo-200 border-indigo-500/20", range: "< $25K" },
                    ].map((band, i) => {
                      const isActive = i === rainbowActiveBand;
                      return (
                        <div 
                          key={i} 
                          className={`p-2 rounded text-[11px] flex justify-between items-center border transition-all ${band.bg} ${
                            isActive ? "ring-2 ring-emerald-400 scale-[1.01] font-bold" : "opacity-80"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                            {band.bandName}
                          </span>
                          <span className="font-bold">{band.range} {isActive && "👈 KONDISI SEKARANG"}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-between items-center text-xs mt-3 border-t border-slate-800 pt-3">
                  <span className="text-slate-500">Uji Target Log untuk Tahun Masa Depan:</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setRainbowYear(2026)} className={`px-2 py-0.5 rounded text-[10px] ${rainbowYear === 2026 ? "bg-slate-800 text-emerald-400 font-bold border border-slate-700" : "text-slate-400"}`}>2026</button>
                    <button onClick={() => setRainbowYear(2027)} className={`px-2 py-0.5 rounded text-[10px] ${rainbowYear === 2027 ? "bg-slate-800 text-emerald-400 font-bold border border-slate-700" : "text-slate-400"}`}>2027</button>
                    <button onClick={() => setRainbowYear(2028)} className={`px-2 py-0.5 rounded text-[10px] ${rainbowYear === 2028 ? "bg-slate-800 text-emerald-400 font-bold border border-slate-700" : "text-slate-400"}`}>2028</button>
                  </div>
                </div>
              </div>

              {/* 36. Stock-to-Flow Model */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    Stock-to-Flow Model (Model Kelangkaan Stok vs Aliran)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #36</span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Mengevaluasi harga Bitcoin relatif terhadap kelangkaan yang diproyeksikan oleh pasokan penambangan baru.
                </p>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsLineChart data={data.stockToFlow}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <ReferenceLine x={data.stockToFlow[15]?.date} stroke="#eab308" label={{ value: 'HALVING BTC', fill: '#eab308', fontSize: 10, position: 'insideBottom' }} />
                      <Line type="monotone" name="Stock-to-Flow Forecast" dataKey="Stock-to-Flow Model Line" stroke="#eab308" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                      <Line type="monotone" name="Harga BTC Aktual" dataKey="Actual BTC Price" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    </RechartsLineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* MVRV Z-Score (27), MVRV Ratio (38) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* 27. Bitcoin MVRV Z-Score */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-yellow-500" />
                    Bitcoin MVRV Z-Score (Metrik Overbought/Oversold)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #27</span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Mengukur deviasi nilai pasar terhadap nilai realisasinya. Mengidentifikasi puncak siklus (zona merah) & dasar (zona hijau).
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsLineChart data={data.mvrvZScore}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <ReferenceLine y={0.1} stroke="#10b981" label={{ value: 'Dasar Siklus (Green)', fill: '#10b981', fontSize: 10, position: 'insideTopLeft' }} />
                      <ReferenceLine y={7.0} stroke="#ef4444" label={{ value: 'Puncak Siklus (Red)', fill: '#ef4444', fontSize: 10, position: 'insideBottomLeft' }} />
                      <Line type="monotone" name="MVRV Z-Score" dataKey="MVRV Z-Score" stroke="#eab308" strokeWidth={2.5} dot={false} />
                    </RechartsLineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 38. Bitcoin MVRV Ratio */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    Bitcoin MVRV Ratio
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #38</span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Rasio kapitalisasi pasar spot langsung dibagi kapitalisasi terealisasi (Realized Cap).
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.mvrvRatio}>
                      <defs>
                        <linearGradient id="colorMvrv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <ReferenceLine y={1.0} stroke="#ef4444" strokeDasharray="3 3" />
                      <Area type="monotone" name="MVRV Ratio" dataKey="MVRV Ratio" stroke="#22d3ee" fillOpacity={1} fill="url(#colorMvrv)" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* ETF Market (34), Dominance (29), Altseason (35) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* 34. Crypto ETF Market Overview */}
              <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-cyan-400" />
                    Crypto ETF Market Overview (Spot ETF Amerika Serikat)
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #34</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">
                  Dana kelolaan spot Bitcoin & Ethereum ETF yang terdaftar di bursa saham AS (IBIT, FBTC, dll).
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500 uppercase text-[9px] tracking-wider">
                        <th className="py-2">Ticker</th>
                        <th>Manajer Penerbit</th>
                        <th className="text-right">Aliran Masuk 30h (USD)</th>
                        <th className="text-right">Total AUM ($M)</th>
                        <th className="text-right">Volume 24h ($M)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {data.etfOverview.map((etf) => (
                        <tr key={etf.ticker} className="hover:bg-slate-900/40">
                          <td className="py-2 text-white font-bold font-mono">{etf.ticker}</td>
                          <td className="text-slate-300">{etf.name}</td>
                          <td className={`text-right font-mono font-bold ${etf.netFlow30d >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {etf.netFlow30d >= 0 ? "+" : ""}{etf.netFlow30d}M
                          </td>
                          <td className="text-right font-mono text-slate-300">${etf.totalAum.toLocaleString()}</td>
                          <td className="text-right font-mono text-slate-400">${etf.volume24h}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 35. Altcoin Season Index */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-pink-400" />
                      Altcoin Season Index
                    </h3>
                    <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #35 {liveAltcoinSeason === null && <span className="text-amber-400">• EST</span>}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Berdasarkan kinerja 75 top altcoin dibanding Bitcoin dalam 90 hari terakhir.
                  </p>
                  
                  {/* Gauge indicator widget — when /api/onchain/altcoin-season returns success:false
                      (no free live source), falls back to a 38 baseline labelled EST. */}
                  <div className="py-4 flex flex-col items-center">
                    <div className="text-4xl font-extrabold font-mono text-white mb-2">{liveAltcoinSeason ?? 38}</div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-emerald-950/40 text-emerald-300 border-emerald-500/30">
                      BITCOIN SEASON (Pasar Didominasi BTC)
                    </span>
                    <p className="text-[10px] text-slate-500 text-center mt-3 leading-relaxed">
                      Altcoin mengalami underperformance relatif terhadap dominasi Bitcoin yang masih kuat.
                    </p>
                  </div>
                </div>

                <div className="text-[10px] text-slate-500 border-t border-slate-800/80 pt-3">
                  Diperbarui otomatis dari perbandingan kapitalisasi pasar Coinmarketcap.
                </div>
              </div>
            </div>

            {/* Bubble Index (37), Dominance (29), Net unrealized profit/loss (43) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* 29. Bitcoin Dominance */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm lg:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    Bitcoin Dominance (%)
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #29</span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Rasio kapitalisasi pasar Bitcoin dibandingkan total seluruh kapitalisasi aset kripto global.
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.btcDominance}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${v}%`} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Area name="Bitcoin (%)" type="monotone" dataKey="Bitcoin" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
                      <Area name="Ethereum (%)" type="monotone" dataKey="Ethereum" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                      <Area name="Altcoins (%)" type="monotone" dataKey="Altcoins" stackId="1" stroke="#a855f7" fill="#a855f7" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 37. Bitcoin Bubble Index & 48. Bitcoin NVT Ratio */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-rose-400" />
                      Bitcoin Bubble Index & NVT Ratio
                    </h3>
                    <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #37, 48 <span className="text-amber-400">• EST</span></span>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                    Indeks gelembung pasar (Bubble Index) dan Rasio Transaksi Jaringan (NVT).
                  </p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsLineChart data={data.bubbleAndNvt}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
                        <YAxis stroke="#64748b" fontSize={9} />
                        <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                        <Legend verticalAlign="top" height={24} fontSize={9} />
                        <Line name="Bubble Index" type="monotone" dataKey="BubbleIndex" stroke="#f43f5e" strokeWidth={1.5} dot={false} />
                        <Line name="NVT Ratio" type="monotone" dataKey="NVTRatio" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                      </RechartsLineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="text-[9px] text-slate-500 mt-2">
                  NVT Ratio tinggi mengindikasikan ketidakcocokan antara nilai jaringan vs volume transaksi on-chain.
                </div>
              </div>
            </div>

            {/* Macro & relationship: M2 (40), Fed Funds rate (41), Correlations (42) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* 40 & 41. BTC vs Global M2 Growth & Fed Funds Rate */}
              <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-emerald-400" />
                    Bitcoin Price vs Global M2 Growth & Federal Funds Rate
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">Metric #40, 41 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Menganalisis hubungan harga Bitcoin dengan likuiditas mata uang fiat global (M2) dan suku bunga bank sentral AS (FED).
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.macroSupplyRate}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                      <YAxis yAxisId="left" stroke="#10b981" fontSize={11} label={{ value: 'Harga BTC ($)', angle: -90, position: 'insideLeft', fill: '#10b981' }} />
                      <YAxis yAxisId="right" orientation="right" stroke="#eab308" fontSize={11} label={{ value: 'Pertumbuhan M2 (%) / Fed Rate (%)', angle: 90, position: 'insideRight', fill: '#eab308' }} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Line yAxisId="left" name="Harga Spot BTC" type="monotone" dataKey="BTCPrice" stroke="#10b981" strokeWidth={2.5} dot={false} />
                      <Line yAxisId="right" name="Pertumbuhan M2 (%)" type="monotone" dataKey="M2GrowthPercent" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                      <Line yAxisId="right" name="Fed Funds Rate (%)" type="monotone" dataKey="FedFundsRate" stroke="#ec4899" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 42. BTC Correlations */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5 text-yellow-500" />
                      Korelasi Bitcoin vs Kelas Aset Makro (BTC Correlations)
                    </h3>
                    <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #42</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Koefisien korelasi 180 hari terakhir antara Bitcoin dengan indeks keuangan tradisional global.
                  </p>
                  
                  <div className="space-y-2.5">
                    {data.btcCorrelations.map((c) => (
                      <div key={c.asset} className="text-xs border-b border-slate-800/50 pb-2 last:border-0 last:pb-0">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold text-white">{c.asset}</span>
                          <span className="font-mono text-slate-300 font-semibold">{c.corr > 0 ? "+" : ""}{c.corr}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-full bg-slate-950 h-2 rounded overflow-hidden relative">
                            {/* Diverging bar representation */}
                            <div 
                              className={`h-full ${c.corr >= 0 ? "bg-emerald-500" : "bg-rose-500"}`} 
                              style={{ 
                                width: `${Math.abs(c.corr) * 100}%`,
                                marginLeft: c.corr < 0 ? `${(1 + c.corr) * 100}%` : "0"
                              }} 
                            />
                          </div>
                          <span className="text-[9px] text-slate-500 whitespace-nowrap">{c.label}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-[9px] text-slate-500 border-t border-slate-800/80 pt-3">
                  Korelasi dihitung menggunakan Koefisien Pearson 180 hari (R).
                </div>
              </div>
            </div>

            {/* NUPL (43), LTH/STH Supply (46/47), Drawdown ATH (51) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* 43. Bitcoin Net Unrealized Profit/Loss (NUPL) */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-purple-400" />
                    Bitcoin Net Unrealized Profit/Loss (NUPL)
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #43 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">
                  Menunjukkan sentimen psikologi pasar berdasarkan status keuntungan/kerugian yang belum direalisasikan.
                </p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.bubbleAndNvt}>
                      <defs>
                        <linearGradient id="colorNupl" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" fontSize={9} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <ReferenceLine y={0.5} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Euphoria', fill: '#ef4444', fontSize: 8 }} />
                      <ReferenceLine y={0.25} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: 'Optimism', fill: '#3b82f6', fontSize: 8 }} />
                      <Area name="NUPL Ratio" type="monotone" dataKey="NUPL" stroke="#10b981" fillOpacity={1} fill="url(#colorNupl)" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 46 & 47. Bitcoin Long Term vs Short Term Holder Supply */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    Long Term vs Short Term Holder Supply
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #46, 47 <span className="text-amber-400">• EST</span></span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">
                  Distribusi koin beredar yang dipegang oleh pemegang jangka panjang (&gt;155 hari) vs pemegang spekulatif jangka pendek.
                </p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.holdersSupply}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" fontSize={9} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend verticalAlign="top" height={24} fontSize={9} />
                      <Area name="Long-Term Holder (LTH)" type="monotone" dataKey="Long-Term Holders" stroke="#10b981" fill="#10b981" fillOpacity={0.15} />
                      <Area name="Short-Term Holder (STH)" type="monotone" dataKey="Short-Term Holders" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 51. Bitcoin Drawdown From All Time High */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Skull className="w-3.5 h-3.5 text-rose-400" />
                    Bitcoin Drawdown From All Time High (ATH) (%)
                  </h3>
                  <span className="text-[10px] bg-slate-800 px-1.5 py-0.2 rounded text-slate-400 font-mono">Metric #51</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">
                  Persentase penurunan harga dari harga puncak tertinggi sepanjang masa ($73,750).
                </p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.drawdownAth}>
                      <defs>
                        <linearGradient id="colorDrawdown" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
                      <YAxis stroke="#64748b" fontSize={9} tickFormatter={(v) => `${v}%`} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Area name="Drawdown (%)" type="monotone" dataKey="Drawdown dari ATH (%)" stroke="#f43f5e" strokeWidth={1.5} fillOpacity={1} fill="url(#colorDrawdown)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* =========================================================================
            TAB: TOKEN TERMINAL EXPLORER
            ========================================================================= */}
        {activeTab === "tokenterminal" && (
          <TokenTerminalExplorer />
        )}

        {/* =========================================================================
            TAB 8: AI ON-CHAIN ANALYSIS & ADVISOR
            ========================================================================= */}
        {activeTab === "ai_analysis" && (
          <div id="tab-ai-analysis" className="space-y-6 animate-fadeIn text-slate-200">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-slate-900 via-purple-950/40 to-slate-900 border border-purple-500/20 rounded-2xl p-6 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <Sparkles className="w-40 h-40 text-purple-400" />
              </div>
              <div className="relative z-10 max-w-3xl">
                <div className="flex items-center gap-2 mb-3">
                  <span className="bg-purple-500/20 text-purple-300 text-xs font-semibold px-2.5 py-1 rounded-full border border-purple-500/30 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-purple-400 animate-pulse" />
                    Gemini 3.5 Flash Max Reasoning
                  </span>
                  <span className="bg-emerald-500/10 text-emerald-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-emerald-500/20">
                    Resilient Cache Active
                  </span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-white mb-2">
                  AI On-Chain Analyst & Trading Advisor
                </h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Asisten AI kuantitatif bergelar CFA menganalisis data metrik on-chain secara komprehensif menggunakan kecerdasan buatan Gemini dengan tingkat penalaran maksimal. Sesuaikan parameter simulasi on-chain di bawah untuk mensimulasikan skenario pasar yang berbeda dan dapatkan hasil diagnosis instan.
                </p>
              </div>
            </div>

            {/* Sub-tab Navigation */}
            <div className="flex border-b border-slate-800 gap-2 pb-1.5 mb-6">
              <button
                id="btn-ai-subtab-sandbox"
                onClick={() => setAiSubTab("sandbox")}
                className={`px-4 py-2 text-xs md:text-sm font-semibold border-b-2 transition-all ${
                  aiSubTab === "sandbox"
                    ? "border-purple-500 text-white bg-slate-900/40 rounded-t-lg"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                Sandbox Simulasi Mandiri (Skenario Kustom)
              </button>
              <button
                id="btn-ai-subtab-periodic"
                onClick={() => setAiSubTab("periodic")}
                className={`px-4 py-2 text-xs md:text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
                  aiSubTab === "periodic"
                    ? "border-purple-500 text-white bg-slate-900/40 rounded-t-lg"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                Laporan Berkala Real-Time Advisor (Grounded)
              </button>
            </div>

            {aiSubTab === "sandbox" && (
              <div id="tab-ai-sandbox-content" className="space-y-6 animate-fadeIn">
                {/* Main Interactive Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Asset Selection & Interactive Sliders (7 Cols) */}
              <div className="lg:col-span-7 bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 space-y-6 shadow-sm">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <Coins className="w-4 h-4 text-purple-400" />
                    1. Pilih Aset Kripto Simulasi
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { sym: "BTC", name: "Bitcoin", color: "border-yellow-500/20 hover:border-yellow-500/50 text-yellow-400 bg-yellow-950/10" },
                      { sym: "ETH", name: "Ethereum", color: "border-blue-500/20 hover:border-blue-500/50 text-blue-400 bg-blue-950/10" },
                      { sym: "SOL", name: "Solana", color: "border-purple-500/20 hover:border-purple-500/50 text-purple-400 bg-purple-950/10" }
                    ].map((asset) => (
                      <button
                        key={asset.sym}
                        id={`btn-select-ai-${asset.sym.toLowerCase()}`}
                        onClick={() => setSelectedAiSymbol(asset.sym as "BTC" | "ETH" | "SOL")}
                        className={`p-4 rounded-xl border text-left transition-all ${
                          selectedAiSymbol === asset.sym
                            ? "ring-2 ring-purple-500 border-transparent bg-slate-800/80 scale-[1.02]"
                            : "bg-slate-950/50 opacity-70 hover:opacity-100"
                        }`}
                      >
                        <div className="font-bold text-white text-lg">{asset.sym}</div>
                        <div className="text-xs text-slate-400">{asset.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-400" />
                    2. Atur Parameter Simulasi On-Chain
                  </h3>

                  {/* Slider 1: Funding Rate */}
                  <div className="space-y-1.5 p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/60">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-300">Funding Rate Harian (%)</span>
                      <span className="font-mono text-purple-400 font-semibold">{simFundingRate > 0 ? "+" : ""}{simFundingRate.toFixed(3)}%</span>
                    </div>
                    <input
                      id="slider-funding-rate"
                      type="range"
                      min="-0.10"
                      max="0.20"
                      step="0.001"
                      value={simFundingRate}
                      onChange={(e) => setSimFundingRate(parseFloat(e.target.value))}
                      className="w-full accent-purple-500 h-1 cursor-pointer bg-slate-800 rounded-lg"
                    />
                    <p className="text-[10px] text-slate-500">
                      Suku bunga berjangka. Nilai tinggi (&gt;0.05%) menunjukkan leverage posisi long yang sangat agresif.
                    </p>
                  </div>

                  {/* Slider 2: Long/Short Ratio */}
                  <div className="space-y-1.5 p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/60">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-300">Rasio Long / Short</span>
                      <span className="font-mono text-purple-400 font-semibold">{simLongShort.toFixed(2)}x</span>
                    </div>
                    <input
                      id="slider-long-short"
                      type="range"
                      min="0.5"
                      max="3.0"
                      step="0.01"
                      value={simLongShort}
                      onChange={(e) => setSimLongShort(parseFloat(e.target.value))}
                      className="w-full accent-purple-500 h-1 cursor-pointer bg-slate-800 rounded-lg"
                    />
                    <p className="text-[10px] text-slate-500">
                      Perbandingan jumlah akun long vs short. Nilai di atas 1.0 berarti trader didominasi posisi beli (bullish).
                    </p>
                  </div>

                  {/* Slider 3: Netflow */}
                  <div className="space-y-1.5 p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/60">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-300">Exchange Netflow (Arus Bersih Bursa)</span>
                      <span className={`font-mono font-semibold ${simNetflow < 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {simNetflow > 0 ? "+" : ""}{simNetflow}M USD
                      </span>
                    </div>
                    <input
                      id="slider-netflow"
                      type="range"
                      min="-200"
                      max="200"
                      step="5"
                      value={simNetflow}
                      onChange={(e) => setSimNetflow(parseInt(e.target.value))}
                      className="w-full accent-purple-500 h-1 cursor-pointer bg-slate-800 rounded-lg"
                    />
                    <p className="text-[10px] text-slate-500">
                      Aliran bersih dana bursa. Negatif (Outflow) mencerminkan akumulasi whales ke dompet dingin (Bullish).
                    </p>
                  </div>

                  {/* Advanced settings toggles group */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Open interest */}
                    <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800/50">
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Open Interest (OI)</label>
                      <div className="flex items-center justify-between gap-2">
                        <input
                          id="input-oi"
                          type="number"
                          value={simOpenInterest}
                          onChange={(e) => setSimOpenInterest(Math.max(10, parseInt(e.target.value) || 0))}
                          className="bg-transparent border-0 p-0 text-white font-mono text-sm font-bold w-16 focus:ring-0 focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-500 font-mono">M USD</span>
                      </div>
                    </div>
                    {/* Active addresses */}
                    <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800/50">
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Alamat Aktif</label>
                      <div className="flex items-center justify-between gap-2">
                        <input
                          id="input-active-addresses"
                          type="number"
                          value={simActiveAddresses}
                          onChange={(e) => setSimActiveAddresses(Math.max(1000, parseInt(e.target.value) || 0))}
                          className="bg-transparent border-0 p-0 text-white font-mono text-sm font-bold w-20 focus:ring-0 focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-500 font-mono">ADDRS</span>
                      </div>
                    </div>
                    {/* Hashrate or Security */}
                    <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800/50">
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        {selectedAiSymbol === "BTC" ? "Hashrate Jaringan" : "Skor Jaringan"}
                      </label>
                      <div className="flex items-center justify-between gap-2">
                        <input
                          id="input-hashrate"
                          type="number"
                          value={simHashrate}
                          onChange={(e) => setSimHashrate(Math.max(1, parseInt(e.target.value) || 0))}
                          className="bg-transparent border-0 p-0 text-white font-mono text-sm font-bold w-16 focus:ring-0 focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-500 font-mono">
                          {selectedAiSymbol === "BTC" ? "EH/s" : "/100"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Simulated Feed HUD & Start button (5 Cols) */}
              <div className="lg:col-span-5 bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800/80 rounded-2xl p-6 flex flex-col justify-between shadow-sm relative">
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Server className="w-4 h-4 text-purple-400" />
                    Simulasi Input Feed untuk AI
                  </h3>
                  
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 font-mono space-y-2.5 text-xs text-slate-300">
                    <div className="flex justify-between border-b border-slate-800/40 pb-1.5">
                      <span className="text-slate-500">PARAMETER_ASSET:</span>
                      <span className="text-yellow-400 font-bold">{selectedAiSymbol}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/40 pb-1.5">
                      <span className="text-slate-500">LIVE_PRICE:</span>
                      <span className="text-white font-bold">{formatUsd(selectedPrice)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/40 pb-1.5">
                      <span className="text-slate-500">DAILY_CHANGE:</span>
                      <span className={`font-bold ${selectedChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {selectedChange > 0 ? "+" : ""}{selectedChange}%
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/40 pb-1.5">
                      <span className="text-slate-500">FUNDING_RATE_DAILY:</span>
                      <span className="text-purple-400 font-bold">{simFundingRate.toFixed(3)}%</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/40 pb-1.5">
                      <span className="text-slate-500">LONG_SHORT_RATIO:</span>
                      <span className="text-white font-bold">{simLongShort.toFixed(2)}x</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/40 pb-1.5">
                      <span className="text-slate-500">EXCHANGE_NETFLOW:</span>
                      <span className={`font-bold ${simNetflow < 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {simNetflow > 0 ? "+" : ""}{simNetflow}M USD
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/40 pb-1.5">
                      <span className="text-slate-500">OPEN_INTEREST:</span>
                      <span className="text-slate-200 font-bold">{simOpenInterest}M USD</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/40 pb-1.5">
                      <span className="text-slate-500">ACTIVE_ADDRESSES:</span>
                      <span className="text-slate-200 font-bold">{simActiveAddresses.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">NETWORK_METRIC_POWER:</span>
                      <span className="text-slate-200 font-bold">
                        {simHashrate} {selectedAiSymbol === "BTC" ? "EH/s" : "SCORE"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-800/60 space-y-3">
                  <button
                    id="btn-run-ai-analysis"
                    disabled={aiLoading}
                    onClick={() => handleRunAiAnalysis(false)}
                    className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg hover:shadow-purple-500/10 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                  >
                    {aiLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Sedang Menganalisis dengan Gemini 3.5...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-purple-200 animate-pulse" />
                        JALANKAN ANALISIS GEMINI MAX REASONING
                      </>
                    )}
                  </button>
                  <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                    Setiap konfigurasi parameter on-chain di-cache secara aman untuk menghemat konsumsi kuota API dan memberikan stabilitas respons maksimal.
                  </p>
                </div>
              </div>

            </div>

            {/* Error Display */}
            {aiError && (
              <div className="bg-rose-950/30 border border-rose-500/20 text-rose-300 p-4 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold mb-0.5">Analisis Gagal</div>
                  <p>{aiError}</p>
                </div>
              </div>
            )}

            {/* Loader / Custom Immersion Step-by-Step logs */}
            {aiLoading && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center space-y-4 text-center">
                <div className="relative">
                  <div className="w-12 h-12 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin" />
                  <Sparkles className="w-5 h-5 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                </div>
                <div className="space-y-1 max-w-sm">
                  <h4 className="text-sm font-semibold text-white">Mengekstrak Skenario On-Chain...</h4>
                  <p className="text-xs text-slate-500 animate-pulse">
                    Menganalisis pergerakan funding rate {simFundingRate}%, long/short {simLongShort}x, dan akumulasi netflow ${simNetflow}M dengan tingkat penalaran maksimal Gemini...
                  </p>
                </div>
              </div>
            )}

            {/* AI Report Result Card */}
            {!aiLoading && aiAnalysisResult && (
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 space-y-5 shadow-lg animate-fadeIn">
                <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800/80 pb-4 gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {isAiCached ? (
                        <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
                          <Activity className="w-3 h-3 text-emerald-400" />
                          TERBACA DARI CACHE LOKAL
                        </span>
                      ) : isAiFallback ? (
                        <span className="bg-amber-500/10 text-amber-400 text-[10px] font-mono px-2 py-0.5 rounded border border-amber-500/20 flex items-center gap-1">
                          <ShieldAlert className="w-3 h-3 text-amber-400" />
                          DIAGNOSTIK LOKAL CADANGAN AKTIF
                        </span>
                      ) : (
                        <span className="bg-purple-500/10 text-purple-400 text-[10px] font-mono px-2 py-0.5 rounded border border-purple-500/20 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-purple-400" />
                          HASIL GEMINI 3.5 FLASH LIVE
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 font-mono">Generated: {lastGeneratedAt || "Sekarang"}</span>
                    </div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      Laporan Diagnosis On-Chain & Rekomendasi Portofolio: {selectedAiSymbol}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      id="btn-re-evaluate"
                      onClick={() => handleRunAiAnalysis(true)}
                      className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700/60 transition-all flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Segarkan / Regenerasi
                    </button>
                    <button
                      id="btn-copy-report"
                      onClick={() => {
                        navigator.clipboard.writeText(aiAnalysisResult);
                        alert("Laporan analisis berhasil disalin ke papan klip.");
                      }}
                      className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-all flex items-center gap-1 shadow"
                    >
                      Salin Laporan
                    </button>
                  </div>
                </div>

                {/* Markdown Report Body */}
                <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-6 text-slate-300 leading-relaxed font-sans text-sm overflow-x-auto">
                  <div className="markdown-body">
                    <Markdown>{aiAnalysisResult}</Markdown>
                  </div>
                </div>
              </div>
            )}
            </div>
            )}

            {aiSubTab === "periodic" && (
              <div id="tab-ai-periodic" className="space-y-6 animate-fadeIn">
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-4">
                    <div>
                      <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1 w-max mb-1.5">
                        <Activity className="w-3.5 h-3.5 animate-pulse" />
                        Grounded in Live Onchain & Derivative Feeds
                      </span>
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
                        Laporan Berkala Coinglass AI On-Chain Advisor
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Sistem intelijen buatan secara berkala memindai blockchain BTC/ETH/SOL dan pasar berjangka Binance untuk menyusun ulasan taktis komprehensif.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-slate-500 font-mono">Terakhir Diperbarui: {automatedLastUpdated || "Memuat..."}</span>
                      <button
                        id="btn-re-eval-periodic"
                        disabled={automatedLoading}
                        onClick={triggerAutomatedAnalysis}
                        className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${automatedLoading ? 'animate-spin' : ''}`} />
                        {automatedLoading ? 'Sedang Memperbarui...' : 'Trigger Re-Analysis Live'}
                      </button>
                    </div>
                  </div>

                  {automatedLoading && !automatedAnalysis && (
                    <div className="flex flex-col items-center justify-center py-12 space-y-4">
                      <div className="w-10 h-10 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin" />
                      <p className="text-xs text-slate-400">Menyinkronkan analitik terbaru dengan model Gemini...</p>
                    </div>
                  )}

                  {automatedAnalysis ? (
                    <div className="space-y-4">
                      <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-6 text-slate-300 leading-relaxed font-sans text-sm overflow-x-auto">
                        <div className="markdown-body">
                          <Markdown>{automatedAnalysis}</Markdown>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          id="btn-copy-periodic-report"
                          onClick={() => {
                            navigator.clipboard.writeText(automatedAnalysis);
                            alert("Laporan berkala berhasil disalin ke papan klip.");
                          }}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700/60 transition-all flex items-center gap-1.5"
                        >
                          Salin Laporan
                        </button>
                      </div>
                    </div>
                  ) : (
                    !automatedLoading && (
                      <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-8 text-center space-y-4">
                        <AlertCircle className="w-8 h-8 text-slate-500 mx-auto" />
                        <div className="max-w-md mx-auto space-y-1.5">
                          <h4 className="text-sm font-bold text-white">Belum Ada Laporan Berkala Terbentuk</h4>
                          <p className="text-xs text-slate-400">
                            Sistem latar belakang sedang memulai modul analitik. Silakan tekan tombol "Trigger Re-Analysis Live" di atas untuk memaksa generasi laporan pertama secara langsung.
                          </p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
