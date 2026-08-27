/**
 * MarketSentimentWidget — NEW FEATURE (Task 5)
 * ----------------------------------------------
 * A self-contained market sentiment panel that combines:
 *   1. Fear & Greed Index (from /api/onchain/metrics → alternative.me)
 *   2. BTC Dominance + Total Market Cap (from /api/coins/global-stats → CoinMarketCap)
 *   3. 24h Market Average Change
 *   4. AI-style sentiment interpretation (rule-based, no AI cost)
 *
 * Designed as a drop-in widget for the Dashboard. Fetches its own data with
 * a 60s polling interval + graceful fallback when endpoints are unreachable.
 */

import React, { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Activity, TrendingUp, TrendingDown, Gauge, Globe2, RefreshCw, Sparkles } from "lucide-react";
import { useAbortableFetch } from "../hooks/use-abortable-fetch"; // OPT-2a: abort in-flight fetches on unmount

interface FearGreedData {
  current: { value: number; classification: string };
  history?: Array<{ date: string; value: number; classification: string }>;
}
interface MetricsPayload {
  success: boolean;
  fearGreed?: FearGreedData;
}
interface GlobalStats {
  success: boolean;
  totalMc?: number;
  totalVol?: number;
  avgChange?: number;
}

const SENTIMENT_BANDS = [
  { max: 24, label: "EXTREME FEAR", color: "#dc2626", bg: "from-red-950/60 to-red-900/20", advice: "Pasar panik — secara historis ini zona akumulasi yang baik, tapi volatilitas tetap tinggi." },
  { max: 44, label: "FEAR", color: "#f97316", bg: "from-orange-950/60 to-orange-900/20", advice: "Sentimen negatif. Trader ritel cenderung keluar; opportunity untuk value buyer." },
  { max: 55, label: "NEUTRAL", color: "#eab308", bg: "from-yellow-950/60 to-yellow-900/20", advice: "Pasar ragu. Tidak ada konveksi kuat — tunggu konfirmasi arah." },
  { max: 74, label: "GREED", color: "#22c55e", bg: "from-emerald-950/60 to-emerald-900/20", advice: "Optimisme meningkat. Waspadai overbought; pertimbangkan trailing stop." },
  { max: 100, label: "EXTREME GREED", color: "#16a34a", bg: "from-green-950/60 to-green-900/20", advice: "Euforia pasar. Secara historis ini zona distribusi — disiplin take profit." },
];

function getBand(value: number) {
  return SENTIMENT_BANDS.find((b) => value <= b.max) ?? SENTIMENT_BANDS[SENTIMENT_BANDS.length - 1];
}

function formatMarketCap(usd: number): string {
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  return `$${usd.toFixed(0)}`;
}

// SVG gauge — semicircle from 180° (left) to 0° (right), value 0-100
function SentimentGauge({ value, color }: { value: number; color: string }) {
  const radius = 80;
  const cx = 100;
  const cy = 100;
  // Map 0-100 to 180-0 degrees
  const angle = 180 - (Math.min(100, Math.max(0, value)) / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const needleX = cx + radius * 0.85 * Math.cos(rad);
  const needleY = cy - radius * 0.85 * Math.sin(rad);

  // Arc segments — 5 colored bands
  const arcPath = (startAngle: number, endAngle: number) => {
    const s = (startAngle * Math.PI) / 180;
    const e = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(s);
    const y1 = cy - radius * Math.sin(s);
    const x2 = cx + radius * Math.cos(e);
    const y2 = cy - radius * Math.sin(e);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`;
  };

  return (
    <svg viewBox="0 0 200 120" className="w-full max-w-[280px] mx-auto">
      {/* Arc bands */}
      <path d={arcPath(180, 144)} stroke="#dc2626" strokeWidth="14" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d={arcPath(144, 108)} stroke="#f97316" strokeWidth="14" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d={arcPath(108, 72)} stroke="#eab308" strokeWidth="14" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d={arcPath(72, 36)} stroke="#22c55e" strokeWidth="14" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d={arcPath(36, 0)} stroke="#16a34a" strokeWidth="14" fill="none" strokeLinecap="round" opacity="0.85" />

      {/* Tick labels */}
      <text x="20" y="115" fill="#64748b" fontSize="9" fontFamily="monospace">0</text>
      <text x="95" y="20" fill="#64748b" fontSize="9" fontFamily="monospace">50</text>
      <text x="170" y="115" fill="#64748b" fontSize="9" fontFamily="monospace">100</text>

      {/* Needle */}
      <motion.g
        initial={{ rotate: -90, originX: "100px", originY: "100px" }}
        animate={{ rotate: angle - 90, originX: "100px", originY: "100px" }}
        transition={{ type: "spring", stiffness: 60, damping: 14 }}
      >
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={color} strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="6" fill={color} />
        <circle cx={cx} cy={cy} r="3" fill="#0b0f19" />
      </motion.g>
    </svg>
  );
}

export default function MarketSentimentWidget() {
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [global, setGlobal] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { abortableFetch } = useAbortableFetch(); // OPT-2a

  const fetchAll = async () => {
    try {
      setError(null);
      // OPT-2a: abortable fetches — null when aborted (unmount / superseded by next poll).
      // Sequential await so the hook's single AbortController doesn't abort the sibling
      // fetch mid-flight (which would happen if both were launched in parallel). Each
      // .json() parse is wrapped in its own try/catch to preserve Promise.allSettled-like
      // isolation: one bad response must not abort the other.
      const mRaw = await abortableFetch("/api/onchain/metrics");
      if (mRaw === null) return; // aborted
      const gRaw = await abortableFetch("/api/coins/global-stats");
      if (gRaw === null) return; // aborted
      let mOk = false;
      let gOk = false;
      try {
        const j = await mRaw.json();
        setMetrics(j);
        mOk = true;
      } catch {
        /* ignore parse error — preserve allSettled semantics */
      }
      try {
        const j = await gRaw.json();
        setGlobal(j);
        gOk = true;
      } catch {
        /* ignore parse error — preserve allSettled semantics */
      }
      setLastUpdated(new Date());
      if (!mOk && !gOk) {
        setError("Tidak dapat mengambil data pasar.");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat sentimen pasar.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60000); // 60s poll
    return () => clearInterval(interval);
  }, []);

  const fgValue = metrics?.fearGreed?.current?.value ?? 50;
  const fgClass = metrics?.fearGreed?.current?.classification ?? "Neutral";
  const band = useMemo(() => getBand(fgValue), [fgValue]);

  const totalMc = global?.totalMc;
  const totalVol = global?.totalVol;
  const avgChange = global?.avgChange;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`bg-gradient-to-br ${band.bg} bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-2xl relative overflow-hidden backdrop-blur-sm`}
    >
      {/* Decorative glow */}
      <div
        className="absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-30"
        style={{ backgroundColor: band.color }}
      />

      <div className="relative flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Gauge className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">
              Market Sentiment Radar
            </h4>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-950 text-emerald-400 border border-emerald-900/60">
              LIVE
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Fear &amp; Greed + Market Cap + 24h Trend
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          aria-label="Refresh sentiment data"
          className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-950/80 hover:border-slate-700 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Gauge + value */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
        <div className="flex flex-col items-center">
          <SentimentGauge value={fgValue} color={band.color} />
          <AnimatePresence mode="wait">
            <motion.div
              key={band.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
              className="text-center -mt-2"
            >
              <div className="flex items-baseline gap-1 justify-center">
                <span className="text-3xl font-black" style={{ color: band.color }}>
                  {fgValue}
                </span>
                <span className="text-xs text-slate-500 font-mono">/100</span>
              </div>
              <span
                className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider"
                style={{
                  color: band.color,
                  backgroundColor: `${band.color}20`,
                  border: `1px solid ${band.color}40`,
                }}
              >
                {band.label}
              </span>
              <p className="text-[10px] text-slate-400 mt-1 font-mono">{fgClass}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right column: stats */}
        <div className="space-y-2.5">
          <StatRow
            icon={<Globe2 className="w-3.5 h-3.5" />}
            label="Total Market Cap"
            value={totalMc !== undefined ? formatMarketCap(totalMc) : "—"}
            color="#60a5fa"
          />
          <StatRow
            icon={<Activity className="w-3.5 h-3.5" />}
            label="24h Volume"
            value={totalVol !== undefined ? formatMarketCap(totalVol) : "—"}
            color="#a78bfa"
          />
          <StatRow
            icon={avgChange !== undefined && avgChange >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            label="24h Avg Change"
            value={avgChange !== undefined ? `${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(2)}%` : "—"}
            color={avgChange !== undefined && avgChange >= 0 ? "#22c55e" : "#ef4444"}
          />
        </div>
      </div>

      {/* AI-style interpretation */}
      <div className="mt-4 pt-4 border-t border-slate-800/60">
        <div className="flex items-start gap-2">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">
              Interpretasi Sistem
            </p>
            <p className="text-xs text-slate-300 leading-relaxed">{band.advice}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between text-[9px] text-slate-500 font-mono">
        <span>
          {lastUpdated
            ? `Updated ${lastUpdated.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
            : "—"}
        </span>
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${error ? "bg-red-500" : "bg-emerald-500 animate-pulse"}`} />
          {error ? "OFFLINE" : "POLL 60s"}
        </span>
      </div>
    </motion.div>
  );
}

function StatRow({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/40 border border-slate-800/60">
      <div className="flex items-center gap-2 min-w-0">
        <span style={{ color }} className="shrink-0">
          {icon}
        </span>
        <span className="text-[11px] text-slate-400 truncate">{label}</span>
      </div>
      <span className="text-xs font-bold font-mono text-slate-100 truncate">{value}</span>
    </div>
  );
}
