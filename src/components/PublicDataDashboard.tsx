import React, { useEffect, useMemo, useState } from "react";
import "./PublicDataDashboard.css";
import { motion, AnimatePresence } from "motion/react";
import {
  Gauge,
  Landmark,
  TrendingUp,
  Layers,
  ShieldAlert,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Activity,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// =============================================================================
// Tipe data sesuai bentuk respons API publik ZAYTRIX
// =============================================================================
interface FearGreedPoint {
  date: string;
  value: number;
  label: string;
}
interface FearGreedPayload {
  success: boolean;
  history: FearGreedPoint[];
  current: FearGreedPoint | null;
  source: string;
  lastUpdated: string;
  error?: string;
}
interface FredPoint {
  date: string;
  value: number;
}
interface FredPayload {
  success: boolean;
  series: string;
  seriesName: string;
  history: FredPoint[];
  source: string;
  lastUpdated: string;
  error?: string;
}
interface FundingPoint {
  date: string;
  fundingRate: number;
}
interface FundingPayload {
  success: boolean;
  symbol: string;
  history: FundingPoint[];
  source: string;
  lastUpdated: string;
  error?: string;
}
interface OIPoint {
  date: string;
  openInterest: number;
  openInterestContracts: number;
}
interface OIPayload {
  success: boolean;
  symbol: string;
  history: OIPoint[];
  source: string;
  lastUpdated: string;
  error?: string;
}
interface VarPayload {
  success: boolean;
  metric: {
    var: number;
    varLoss: number;
    mean: number;
    stdDev: number;
    confidence: number;
    z: number;
  } | null;
  history: Array<{ date: string | null; logReturn: number }>;
  source: string;
  lastUpdated: string;
  error?: string;
}
interface KellyPayload {
  success: boolean;
  metric: {
    kellyCriterion: number;
    kellyPercent: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    winLossRatio: number;
    totalTrades: number;
  } | null;
  history: Array<{ date: string | null; logReturn: number; signal: string }>;
  source: string;
  lastUpdated: string;
  error?: string;
}

// =============================================================================
// Helper format
// =============================================================================
const fmtDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
};

const fmtPct = (value: number, digits = 2): string =>
  `${(value * 100).toFixed(digits)}%`;

const fmtRatePct = (value: number): string => `${(value * 100).toFixed(4)}%`;

const fmtUSD = (value: number): string => {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}M`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
};

const fmtSigned = (value: number, digits = 2): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

const fmtNumber = (value: number, digits = 2): string => value.toFixed(digits);

// Band warna Fear & Greed (0-100)
const SENTIMENT_BANDS = [
  { max: 24, label: "EXTREME FEAR", color: "#ef4444" },
  { max: 44, label: "FEAR", color: "#f97316" },
  { max: 55, label: "NEUTRAL", color: "#eab308" },
  { max: 74, label: "GREED", color: "#22c55e" },
  { max: 100, label: "EXTREME GREED", color: "#16a34a" },
];
const getBand = (value: number) =>
  SENTIMENT_BANDS.find((b) => value <= b.max) ?? SENTIMENT_BANDS[SENTIMENT_BANDS.length - 1];

// =============================================================================
// Gauge Fear & Greed (SVG semi-circle)
// =============================================================================
function FearGreedGauge({ value }: { value: number }) {
  const radius = 80;
  const cx = 100;
  const cy = 100;
  const clamped = Math.min(100, Math.max(0, value));
  const angle = 180 - (clamped / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const needleX = cx + radius * 0.82 * Math.cos(rad);
  const needleY = cy - radius * 0.82 * Math.sin(rad);
  const arcPath = (startAngle: number, endAngle: number) => {
    const s = (startAngle * Math.PI) / 180;
    const e = (endAngle * Math.PI) / 180;
    return `M ${cx + radius * Math.cos(s)} ${cy - radius * Math.sin(s)} A ${radius} ${radius} 0 0 1 ${cx + radius * Math.cos(e)} ${cy - radius * Math.sin(e)}`;
  };
  const band = getBand(clamped);

  return (
    <svg viewBox="0 0 200 118" className="w-full max-w-[260px] mx-auto" aria-label="Gauge Fear and Greed">
      {SENTIMENT_BANDS.map((b, i) => {
        const starts = [180, 144, 108, 72, 36];
        const ends = [144, 108, 72, 36, 0];
        return (
          <path
            key={i}
            d={arcPath(starts[i], ends[i])}
            stroke={b.color}
            strokeWidth="13"
            fill="none"
            strokeLinecap="round"
            opacity={b.label === band.label ? 1 : 0.35}
          />
        );
      })}
      <text x="18" y="112" fill="#64748b" fontSize="9" fontFamily="monospace">0</text>
      <text x="94" y="18" fill="#64748b" fontSize="9" fontFamily="monospace">50</text>
      <text x="168" y="112" fill="#64748b" fontSize="9" fontFamily="monospace">100</text>
      <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={band.color} strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill={band.color} />
      <circle cx={cx} cy={cy} r="3" fill="#0b0f19" />
    </svg>
  );
}

// =============================================================================
// Komponen kartu kecil untuk chart
// =============================================================================
const cardBase = "bg-slate-950/40 border border-slate-800/70 rounded-xl p-4";
const titleCls = "text-xs font-bold text-slate-200 flex items-center gap-1.5";
const subCls = "text-[10px] text-slate-500";

interface ChartCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  live: boolean;
  children: React.ReactNode;
}
function ChartCard({ icon, title, subtitle, live, children }: ChartCardProps) {
  return (
    <div className={cardBase}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className={titleCls}>
            {icon}
            {title}
            {live && (
              <span className="px-1 py-px rounded text-[8px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-900/60">
                LIVE
              </span>
            )}
          </div>
          <p className={subCls}>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// =============================================================================
// Komponen utama
// =============================================================================
export default function PublicDataDashboard() {
  const [isOpen, setIsOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [fearGreed, setFearGreed] = useState<FearGreedPayload | null>(null);
  const [fred, setFred] = useState<FredPayload | null>(null);
  const [funding, setFunding] = useState<FundingPayload | null>(null);
  const [openInterest, setOpenInterest] = useState<OIPayload | null>(null);
  const [varData, setVarData] = useState<VarPayload | null>(null);
  const [kellyData, setKellyData] = useState<KellyPayload | null>(null);

  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      setError(null);
      const endpoints = [
        "/api/public/fear-greed",
        "/api/public/fred?series=FEDFUNDS",
        "/api/public/funding-rate",
        "/api/public/open-interest",
        "/api/public/risk/var",
        "/api/public/risk/kelly",
      ] as const;

      const results = await Promise.all(
        endpoints.map(async (url) => {
          try {
            const res = await fetch(url);
            const data = await res.json();
            return { url, data };
          } catch (err: any) {
            return { url, error: err?.message || "Gagal mengambil data." };
          }
        })
      );

      let allFailed = true;
      for (const r of results) {
        if ("error" in r) continue;
        allFailed = false;
        if (r.url === endpoints[0]) setFearGreed(r.data);
        else if (r.url === endpoints[1]) setFred(r.data);
        else if (r.url === endpoints[2]) setFunding(r.data);
        else if (r.url === endpoints[3]) setOpenInterest(r.data);
        else if (r.url === endpoints[4]) setVarData(r.data);
        else if (r.url === endpoints[5]) setKellyData(r.data);
      }

      if (allFailed) {
        setError("Tidak dapat mengambil data publik. Periksa koneksi atau coba lagi nanti.");
      }
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message || "Gagal memuat data publik.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60000); // refresh setiap 60 detik
    return () => clearInterval(interval);
  }, []);

  // --- Derived values ---
  const fgValue = fearGreed?.current?.value ?? null;
  const fgBand = fgValue !== null ? getBand(fgValue) : null;

  const fredLatest = fred?.history?.[fred.history.length - 1] ?? null;
  const fredPrev = fred?.history?.[fred.history.length - 2] ?? null;
  const fredDelta =
    fredLatest && fredPrev && fredPrev.value !== 0
      ? ((fredLatest.value - fredPrev.value) / Math.abs(fredPrev.value)) * 100
      : null;

  const fundingLatest = funding?.history?.[funding.history.length - 1] ?? null;
  const fundingAvg = useMemo(() => {
    if (!funding?.history?.length) return null;
    const sum = funding.history.reduce((acc, d) => acc + d.fundingRate, 0);
    return sum / funding.history.length;
  }, [funding]);

  const oiLatest = openInterest?.history?.[openInterest.history.length - 1] ?? null;
  const oiPrev = openInterest?.history?.[openInterest.history.length - 2] ?? null;
  const oiDelta =
    oiLatest && oiPrev && oiPrev.openInterest !== 0
      ? ((oiLatest.openInterest - oiPrev.openInterest) / oiPrev.openInterest) * 100
      : null;

  const varMetric = varData?.metric;
  const kellyMetric = kellyData?.metric;

  const chartCommon = {
    stroke: "#38bdf8",
    strokeWidth: 1.5,
    dot: false,
  };
  const tooltipStyle = {
    backgroundColor: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 8,
    fontSize: 11,
    color: "#e2e8f0",
  };
  const xAxisStyle = {
    fontSize: 10,
    fill: "#64748b",
    tickFormatter: (v: string) => fmtDate(v),
  };
  const gridStyle = { stroke: "#1e293b", strokeDasharray: "3 3" };

  const slice = <T,>(arr: T[], n: number): T[] => (arr.length > n ? arr.slice(-n) : arr);

  const fgHistory = slice(fearGreed?.history ?? [], 30);
  const fredHistory = slice(fred?.history ?? [], 60);
  const fundingHistory = slice(funding?.history ?? [], 30);
  const oiHistory = slice(openInterest?.history ?? [], 30);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full"
    >
      {/* Header collapsible */}
      <div className="bg-gradient-to-br from-slate-900/70 to-slate-950/70 border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-900/50 flex items-center justify-center">
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight leading-tight">
                Dashboard Data Publik
              </h3>
              <p className="text-[11px] text-slate-400">
                Sentimen, makro, funding, open interest & risiko pasar
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="hidden sm:block text-[10px] text-slate-500 font-mono">
                diperbarui {lastUpdated.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={fetchAll}
              disabled={loading}
              aria-label="Segarkan data publik"
              className="p-2 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-900/60 hover:border-slate-700 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-300 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => setIsOpen((v) => !v)}
              aria-label={isOpen ? "Tutup dashboard" : "Buka dashboard"}
              className="p-2 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-900/60 hover:border-slate-700 transition-colors"
            >
              {isOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-300" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-300" />
              )}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="border-t border-slate-800/60 px-5 py-5">
                {/* Error banner */}
                {error && (
                  <div className="mb-4 flex items-start gap-2 bg-rose-500/10 border border-rose-900/50 rounded-lg px-3 py-2 text-xs text-rose-300">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {loading && !fearGreed && !fred && !funding && !openInterest && !varData && !kellyData ? (
                  <div className="text-center py-10 text-slate-400 text-sm">
                    <Activity className="w-5 h-5 mx-auto mb-2 text-cyan-400 animate-pulse" />
                    Memuat data publik...
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* ================= 1. FEAR & GREED ================= */}
                    <ChartCard
                      icon={<Gauge className="w-3.5 h-3.5 text-amber-400" />}
                      title="Indeks Fear & Greed"
                      subtitle="Sentimen pasar crypto (Alternative.me)"
                      live={!!fearGreed?.success}
                    >
                      {fearGreed?.success && fearGreed.current ? (
                        <div className="flex flex-col sm:flex-row items-center gap-3">
                          <div className="w-full sm:w-[260px] shrink-0">
                            <FearGreedGauge value={fgValue as number} />
                            <div className="text-center -mt-3">
                              <span className="text-2xl font-black text-white" style={{ color: fgBand?.color }}>
                                {fgValue}
                              </span>
                            </div>
                          </div>
                          <div className="flex-1 w-full">
                            <div className="flex items-baseline justify-between mb-1">
                              <span className="text-sm font-bold" style={{ color: fgBand?.color }}>
                                {fearGreed.current.label}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {fmtDate(fearGreed.current.date)}
                              </span>
                            </div>
                            {fgHistory.length > 1 ? (
                              <div className="h-[90px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={fgHistory} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                    <XAxis dataKey="date" tick={xAxisStyle} axisLine={false} tickLine={false} />
                                    <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} width={22} />
                                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtDate(String(v))} />
                                    <ReferenceLine y={50} stroke="#475569" strokeDasharray="4 4" />
                                    <Area
                                      type="monotone"
                                      dataKey="value"
                                      stroke="#f59e0b"
                                      fill="url(#fgGradient)"
                                      fillOpacity={0.35}
                                      strokeWidth={1.5}
                                      dot={false}
                                    />
                                    <defs>
                                      <linearGradient id="fgGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
                                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                                      </linearGradient>
                                    </defs>
                                  </AreaChart>
                                </ResponsiveContainer>
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-500 py-4 text-center">Belum ada data historis.</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 py-3">
                          {fearGreed?.error || "Data Fear & Greed belum tersedia."}
                        </p>
                      )}
                    </ChartCard>

                    {/* ================= 2. FRED MACRO ================= */}
                    <ChartCard
                      icon={<Landmark className="w-3.5 h-3.5 text-emerald-400" />}
                      title="Data Makro (FRED)"
                      subtitle={fred?.seriesName || "Federal Funds Rate — Federal Reserve"}
                      live={!!fred?.success}
                    >
                      {fred?.success && fred.history.length > 0 ? (
                        <div>
                          <div className="flex flex-wrap items-end gap-x-6 gap-y-1 mb-2">
                            <span className="text-xl font-black text-white">{fmtNumber(fredLatest?.value ?? 0)}</span>
                            <span className="text-[10px] text-slate-500 font-mono mb-0.5">{fredLatest?.date}</span>
                            {fredDelta !== null && (
                              <span className={`text-[11px] font-bold mb-0.5 flex items-center gap-1 ${fredDelta >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                {fredDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                {fmtSigned(fredDelta, 1)}% vs periode sebelumnya
                              </span>
                            )}
                          </div>
                          <div className="h-[110px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={fredHistory} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke={gridStyle.stroke} strokeDasharray={gridStyle.strokeDasharray} />
                                <XAxis dataKey="date" tick={xAxisStyle} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} width={34} />
                                <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtDate(String(v))} />
                                <Line type="monotone" dataKey="value" {...chartCommon} stroke="#34d399" />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 py-3">
                          {fred?.error || "Data FRED belum tersedia."}
                        </p>
                      )}
                    </ChartCard>

                    {/* ================= 3. FUNDING RATE ================= */}
                    <ChartCard
                      icon={<TrendingUp className="w-3.5 h-3.5 text-violet-400" />}
                      title="Funding Rate"
                      subtitle={`Futures ${funding?.symbol || "BTCUSDT"} — Binance`}
                      live={!!funding?.success}
                    >
                      {funding?.success && funding.history.length > 0 ? (
                        <div>
                          <div className="flex flex-wrap items-end gap-x-6 gap-y-1 mb-2">
                            <span className="text-xl font-black text-violet-300">{fmtRatePct(fundingLatest?.fundingRate ?? 0)}</span>
                            <span className="text-[10px] text-slate-500 font-mono mb-0.5">{fundingLatest?.date}</span>
                            {fundingAvg !== null && (
                              <span className="text-[10px] text-slate-500 mb-0.5">
                                rata-rata {fmtRatePct(fundingAvg)} ({funding.history.length} sampel)
                              </span>
                            )}
                          </div>
                          <div className="h-[110px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={fundingHistory} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke={gridStyle.stroke} strokeDasharray={gridStyle.strokeDasharray} />
                                <XAxis dataKey="date" tick={xAxisStyle} axisLine={false} tickLine={false} />
                                <YAxis
                                  tick={{ fontSize: 9, fill: "#64748b" }}
                                  axisLine={false}
                                  tickLine={false}
                                  width={44}
                                  tickFormatter={(v: number) => `${(v * 100).toFixed(3)}%`}
                                />
                                <Tooltip
                                  contentStyle={tooltipStyle}
                                  labelFormatter={(v) => fmtDate(String(v))}
                                  formatter={(value: number) => [fmtRatePct(value), "Funding"]}
                                />
                                <ReferenceLine y={0} stroke="#475569" />
                                <Line type="monotone" dataKey="fundingRate" {...chartCommon} stroke="#a78bfa" />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 py-3">
                          {funding?.error || "Data Funding Rate belum tersedia."}
                        </p>
                      )}
                    </ChartCard>

                    {/* ================= 4. OPEN INTEREST ================= */}
                    <ChartCard
                      icon={<Layers className="w-3.5 h-3.5 text-cyan-400" />}
                      title="Open Interest"
                      subtitle={`Nilai kontrak berjangka ${openInterest?.symbol || "BTCUSDT"} (USD)`}
                      live={!!openInterest?.success}
                    >
                      {openInterest?.success && openInterest.history.length > 0 ? (
                        <div>
                          <div className="flex flex-wrap items-end gap-x-6 gap-y-1 mb-2">
                            <span className="text-xl font-black text-cyan-300">{fmtUSD(oiLatest?.openInterest ?? 0)}</span>
                            <span className="text-[10px] text-slate-500 font-mono mb-0.5">{oiLatest?.date}</span>
                            {oiDelta !== null && (
                              <span className={`text-[11px] font-bold mb-0.5 flex items-center gap-1 ${oiDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                {oiDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                {fmtSigned(oiDelta, 1)}% vs sebelumnya
                              </span>
                            )}
                          </div>
                          <div className="h-[110px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={oiHistory} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke={gridStyle.stroke} strokeDasharray={gridStyle.strokeDasharray} />
                                <XAxis dataKey="date" tick={xAxisStyle} axisLine={false} tickLine={false} />
                                <YAxis
                                  tick={{ fontSize: 9, fill: "#64748b" }}
                                  axisLine={false}
                                  tickLine={false}
                                  width={44}
                                  tickFormatter={(v: number) => fmtUSD(v)}
                                />
                                <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtDate(String(v))} formatter={(value: number) => [fmtUSD(value), "Open Interest"]} />
                                <Area type="monotone" dataKey="openInterest" stroke="#22d3ee" fill="url(#oiGradient)" fillOpacity={0.3} strokeWidth={1.5} dot={false} />
                                <defs>
                                  <linearGradient id="oiGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} />
                                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 py-3">
                          {openInterest?.error || "Data Open Interest belum tersedia."}
                        </p>
                      )}
                    </ChartCard>

                    {/* ================= 5. RISK METRICS ================= */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* VaR */}
                      <div className={cardBase}>
                        <div className={titleCls}>
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                          Value at Risk (VaR)
                          {varData?.success && (
                            <span className="px-1 py-px rounded text-[8px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-900/60">
                              LIVE
                            </span>
                          )}
                        </div>
                        <p className={subCls}>Risiko kerugian harian — Binance</p>
                        {varMetric ? (
                          <div className="mt-3 space-y-2 text-xs">
                            <div className="flex justify-between items-baseline">
                              <span className="text-slate-400">VaR ({Math.round(varMetric.confidence * 100)}%)</span>
                              <span className="font-mono font-bold text-rose-300">{fmtPct(varMetric.varLoss)}</span>
                            </div>
                            <div className="flex justify-between items-baseline">
                              <span className="text-slate-400">Return rata-rata</span>
                              <span className="font-mono text-slate-200">{fmtSigned(varMetric.mean, 4)}</span>
                            </div>
                            <div className="flex justify-between items-baseline">
                              <span className="text-slate-400">Volatilitas (σ)</span>
                              <span className="font-mono text-slate-200">{fmtNumber(varMetric.stdDev, 4)}</span>
                            </div>
                            <div className="flex justify-between items-baseline">
                              <span className="text-slate-400">Z-score</span>
                              <span className="font-mono text-slate-200">{varMetric.z.toFixed(3)}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-500 py-3">{varData?.error || "Data VaR belum tersedia."}</p>
                        )}
                      </div>

                      {/* Kelly */}
                      <div className={cardBase}>
                        <div className={titleCls}>
                          <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                          Kriteria Kelly
                          {kellyData?.success && (
                            <span className="px-1 py-px rounded text-[8px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-900/60">
                              LIVE
                            </span>
                          )}
                        </div>
                        <p className={subCls}>Ukuran posisi optimal — Binance</p>
                        {kellyMetric ? (
                          <div className="mt-3 space-y-2 text-xs">
                            <div className="flex justify-between items-baseline">
                              <span className="text-slate-400">Kelly fraction</span>
                              <span className={`font-mono font-bold ${kellyMetric.kellyCriterion >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                                {fmtSigned(kellyMetric.kellyCriterion, 4)}
                              </span>
                            </div>
                            <div className="flex justify-between items-baseline">
                              <span className="text-slate-400">Kelly (% modal)</span>
                              <span className={`font-mono font-bold ${kellyMetric.kellyPercent >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                                {fmtSigned(kellyMetric.kellyPercent, 2)}%
                              </span>
                            </div>
                            <div className="flex justify-between items-baseline">
                              <span className="text-slate-400">Win rate</span>
                              <span className="font-mono text-slate-200">{fmtPct(kellyMetric.winRate, 1)}</span>
                            </div>
                            <div className="flex justify-between items-baseline">
                              <span className="text-slate-400">Rata-rata menang / kalah</span>
                              <span className="font-mono text-slate-200">{fmtNumber(kellyMetric.winLossRatio, 2)}x</span>
                            </div>
                            <div className="flex justify-between items-baseline">
                              <span className="text-slate-400">Sampel harian</span>
                              <span className="font-mono text-slate-200">{kellyMetric.totalTrades}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-500 py-3">{kellyData?.error || "Data Kelly belum tersedia."}</p>
                        )}
                      </div>
                    </div>

                    {/* Footer note */}
                    <p className="text-[10px] text-slate-600 text-center pt-1">
                      Sumber: Alternative.me · FRED · Binance Futures — data diperbarui otomatis setiap 60 detik.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
