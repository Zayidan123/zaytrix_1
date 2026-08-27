/**
 * RiskScoreWidget — NEW FEATURE (Task 7)
 * ---------------------------------------
 * Institutional-grade portfolio risk panel. Fetches /api/portfolio/risk-score
 * and renders:
 *   - Risk Grade (A-E) with color-coded circular gauge
 *   - Risk Score (0-100) breakdown
 *   - VaR 95% / 99% (1-day Value at Risk, parametric)
 *   - CVaR 95% / 99% (Conditional VaR / Expected Shortfall)
 *   - Diversification ratio + HHI concentration
 *   - Sharpe-like proxy
 *   - Largest position callout
 *
 * Polls every 60s. Shows "no holdings" empty state when portfolio is empty.
 */

import React, { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  TrendingDown,
  PieChart,
  Gauge,
  RefreshCw,
  AlertTriangle,
  Layers,
  Target,
  Zap,
} from "lucide-react";
import { useAbortableFetch } from "../hooks/use-abortable-fetch"; // OPT-2a: abort in-flight fetches on unmount

interface RiskData {
  totalValue: number;
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  hhi: number;
  diversificationRatio: number;
  sharpeProxy: number;
  maxDrawdownProxy: number;
  largestPositionPct: number;
  largestPositionSymbol: string | null;
  riskGrade: string;
  riskScore: number;
  portfolioVol?: number;
  portfolioReturn?: number;
  holdingsCount?: number;
}

function formatUSD(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPct(n: number, digits = 2): string {
  return `${n.toFixed(digits)}%`;
}

const GRADE_COLORS: Record<string, { bg: string; text: string; ring: string; label: string }> = {
  A: { bg: "from-emerald-950/60 to-emerald-900/20", text: "#10b981", ring: "#10b981", label: "LOW RISK" },
  B: { bg: "from-green-950/60 to-green-900/20", text: "#22c55e", ring: "#22c55e", label: "MODERATE-LOW" },
  C: { bg: "from-yellow-950/60 to-yellow-900/20", text: "#eab308", ring: "#eab308", label: "MODERATE" },
  D: { bg: "from-orange-950/60 to-orange-900/20", text: "#f97316", ring: "#f97316", label: "MODERATE-HIGH" },
  E: { bg: "from-red-950/60 to-red-900/20", text: "#ef4444", ring: "#ef4444", label: "EXTREME" },
};

// Circular progress gauge (SVG)
function RiskGauge({ score, color }: { score: number; color: string }) {
  const radius = 70;
  const cx = 90;
  const cy = 90;
  const circumference = 2 * Math.PI * radius;
  // Score 0-100 maps to 0% → 100% of the circle
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <svg viewBox="0 0 180 180" className="w-full max-w-[200px] mx-auto">
      {/* Background circle */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="rgba(71,85,105,0.2)"
        strokeWidth="10"
      />
      {/* Progress arc */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: dashOffset }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {/* Center text */}
      <text
        x={cx}
        y={cy - 5}
        textAnchor="middle"
        className="font-black fill-white"
        style={{ fontSize: "32px", fontFamily: "monospace" }}
      >
        {score}
      </text>
      <text
        x={cx}
        y={cy + 18}
        textAnchor="middle"
        className="fill-slate-400"
        style={{ fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em" }}
      >
        RISK SCORE
      </text>
    </svg>
  );
}

export default function RiskScoreWidget() {
  const [risk, setRisk] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const { abortableFetch } = useAbortableFetch(); // OPT-2a

  const fetchRisk = async () => {
    try {
      setError(null);
      // OPT-2a: abortable fetch — returns null when aborted (unmount / superseded by next poll).
      const res = await abortableFetch("/api/portfolio/risk-score");
      if (!res) return; // aborted (unmount / next poll cycle)
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setRisk(data.risk);
        setLastUpdated(new Date());
      } else {
        setError(data.error || "Gagal memuat skor risiko");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat skor risiko");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRisk();
    const interval = setInterval(fetchRisk, 60_000);
    return () => clearInterval(interval);
  }, []);

  const grade = useMemo(() => {
    if (!risk || risk.riskGrade === "N/A") return GRADE_COLORS.A;
    return GRADE_COLORS[risk.riskGrade] ?? GRADE_COLORS.C;
  }, [risk]);

  const hasHoldings = risk && risk.totalValue > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`bg-gradient-to-br ${grade.bg} bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-2xl relative overflow-hidden backdrop-blur-sm`}
    >
      <div
        className="absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-25"
        style={{ backgroundColor: grade.ring }}
      />

      <div className="relative flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Gauge className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">
              Portfolio Risk Score
            </h4>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-950 text-rose-400 border border-rose-900/60">
              VaR/CVaR
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Value at Risk • Conditional VaR • Diversification
          </p>
        </div>
        <button
          onClick={fetchRisk}
          disabled={loading}
          aria-label="Refresh risk score"
          className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-950/80 hover:border-slate-700 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!hasHoldings ? (
        <div className="text-center py-8 text-slate-500">
          <PieChart className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs">
            {error ? error : "Belum ada holding di portofolio."}
          </p>
          <p className="text-[10px] text-slate-600 mt-1">
            Tambah aset di Crypto Hub untuk menghitung risiko
          </p>
        </div>
      ) : (
        <>
          {/* Gauge + Grade */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center mb-4">
            <div className="flex flex-col items-center">
              <RiskGauge score={risk!.riskScore} color={grade.ring} />
              <AnimatePresence mode="wait">
                <motion.div
                  key={risk!.riskGrade}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3 }}
                  className="text-center -mt-2"
                >
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-widest"
                    style={{
                      color: grade.text,
                      backgroundColor: `${grade.text}20`,
                      border: `1px solid ${grade.text}40`,
                    }}
                  >
                    GRADE {risk!.riskGrade} • {grade.label}
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* VaR / CVaR stats */}
            <div className="space-y-2">
              <RiskStat
                icon={<TrendingDown className="w-3 h-3" />}
                label="VaR 95% (1-day)"
                value={formatUSD(risk!.var95)}
                sublabel="Max expected loss @ 95% confidence"
                color="#f97316"
              />
              <RiskStat
                icon={<TrendingDown className="w-3 h-3" />}
                label="VaR 99% (1-day)"
                value={formatUSD(risk!.var99)}
                sublabel="Max expected loss @ 99% confidence"
                color="#ef4444"
              />
              <RiskStat
                icon={<AlertTriangle className="w-3 h-3" />}
                label="CVaR 95% (ES)"
                value={formatUSD(risk!.cvar95)}
                sublabel="Avg loss if VaR breached"
                color="#dc2626"
              />
            </div>
          </div>

          {/* Concentration + diversification */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Layers className="w-3 h-3 text-violet-400" />
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                  Diversification
                </span>
              </div>
              <p className="text-lg font-black text-violet-300 font-mono">
                {formatPct(risk!.diversificationRatio * 100, 1)}
              </p>
              <div className="w-full h-1 bg-slate-800/60 rounded-full mt-1.5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${risk!.diversificationRatio * 100}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                />
              </div>
              <p className="text-[9px] text-slate-500 font-mono mt-1">
                HHI: {risk!.hhi.toFixed(3)} • {risk!.holdingsCount} aset
              </p>
            </div>

            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Target className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                  Largest Position
                </span>
              </div>
              <p className="text-lg font-black text-amber-300 font-mono">
                {formatPct(risk!.largestPositionPct, 1)}
              </p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                {risk!.largestPositionSymbol ?? "—"}
              </p>
              <div className="w-full h-1 bg-slate-800/60 rounded-full mt-1.5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, risk!.largestPositionPct)}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className={`h-full ${
                    risk!.largestPositionPct > 50
                      ? "bg-gradient-to-r from-rose-500 to-red-500"
                      : "bg-gradient-to-r from-amber-500 to-orange-500"
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Sharpe + Portfolio Vol */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5 flex items-center justify-between">
              <div>
                <p className="text-[9px] uppercase tracking-wider font-bold text-slate-500">
                  Sharpe Proxy
                </p>
                <p className="text-sm font-bold font-mono mt-0.5" style={{ color: risk!.sharpeProxy >= 0 ? "#22c55e" : "#ef4444" }}>
                  {risk!.sharpeProxy >= 0 ? "+" : ""}{risk!.sharpeProxy.toFixed(2)}
                </p>
              </div>
              <Zap className="w-4 h-4 text-slate-500" />
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5 flex items-center justify-between">
              <div>
                <p className="text-[9px] uppercase tracking-wider font-bold text-slate-500">
                  Daily Vol
                </p>
                <p className="text-sm font-bold font-mono text-slate-200 mt-0.5">
                  {formatPct((risk!.portfolioVol ?? 0) * 100, 2)}
                </p>
              </div>
              <Activity className="w-4 h-4 text-slate-500" />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono pt-2 border-t border-slate-800/60">
            <span>
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`
                : "—"}
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${error ? "bg-red-500" : "bg-emerald-500 animate-pulse"}`} />
              {error ? "OFFLINE" : "POLL 60s"}
            </span>
          </div>
        </>
      )}
    </motion.div>
  );
}

function RiskStat({
  icon,
  label,
  value,
  sublabel,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/40 border border-slate-800/60">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span style={{ color }}>{icon}</span>
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-[9px] text-slate-500 mt-0.5">{sublabel}</p>
      </div>
      <span className="text-sm font-bold font-mono" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
