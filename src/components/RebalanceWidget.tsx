/**
 * RebalanceWidget — NEW FEATURE (Task 9)
 * ---------------------------------------
 * Institutional portfolio rebalancing advisor. Fetches /api/portfolio/rebalance
 * and renders:
 *   - Risk profile selector (Low/Moderate/Balanced/Aggressive)
 *   - Current vs target allocation bars (crypto/stock split)
 *   - Drift score gauge (0-100, lower = better balanced)
 *   - Per-asset action list (BUY/SELL/REDUCE/HOLD) with suggested USD amounts
 *   - Summary message
 *
 * Polls every 60s. Uses live prices via the server endpoint.
 */

import React, { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Scale,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Minus,
  ArrowRight,
  Layers,
  Target,
  Activity,
} from "lucide-react";

interface RebalanceAction {
  holdingId: string;
  symbol: string;
  category: string;
  currentValue: number;
  currentWeightPct: number;
  targetWeightPct: number;
  driftPct: number;
  action: "HOLD" | "BUY" | "SELL" | "REDUCE";
  suggestedAmountUsd: number;
  reason: string;
}

interface RebalanceData {
  riskProfile: string;
  totalValue: number;
  currentCryptoPct: number;
  currentStockPct: number;
  targetCryptoPct: number;
  targetStockPct: number;
  maxSinglePositionPct?: number;
  actions: RebalanceAction[];
  summary: string;
  driftScore: number;
  holdingsCount?: number;
}

const RISK_PROFILES = [
  { id: "Low", label: "Low", cryptoPct: 15, desc: "Defensif" },
  { id: "Moderate", label: "Moderate", cryptoPct: 25, desc: "Pendapatan" },
  { id: "Balanced", label: "Balanced", cryptoPct: 40, desc: "Seimbang" },
  { id: "Aggressive", label: "Aggressive", cryptoPct: 60, desc: "Agresif" },
] as const;

function formatUSD(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function getActionStyle(action: string): { color: string; bg: string; border: string; icon: React.ReactNode } {
  switch (action) {
    case "BUY":
      return { color: "#22c55e", bg: "bg-emerald-950/40", border: "border-emerald-700/40", icon: <Plus className="w-3.5 h-3.5" /> };
    case "SELL":
      return { color: "#ef4444", bg: "bg-red-950/40", border: "border-red-700/40", icon: <Minus className="w-3.5 h-3.5" /> };
    case "REDUCE":
      return { color: "#f97316", bg: "bg-orange-950/40", border: "border-orange-700/40", icon: <TrendingDown className="w-3.5 h-3.5" /> };
    default:
      return { color: "#64748b", bg: "bg-slate-950/40", border: "border-slate-700/40", icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
  }
}

// Linear drift gauge (0 = perfect, 100 = completely off)
function DriftGauge({ score }: { score: number }) {
  const color = score < 20 ? "#22c55e" : score < 40 ? "#eab308" : score < 60 ? "#f97316" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-800/60 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono font-bold" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export default function RebalanceWidget() {
  const [riskProfile, setRiskProfile] = useState<string>("Balanced");
  const [data, setData] = useState<RebalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (profile: string) => {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch(`/api/portfolio/rebalance?riskProfile=${encodeURIComponent(profile)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        setData(json.rebalance);
      } else {
        setError(json.error || "Gagal memuat saran rebalancing");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat saran rebalancing");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(riskProfile);
    const interval = setInterval(() => fetchData(riskProfile), 60_000);
    return () => clearInterval(interval);
  }, [riskProfile]);

  const hasData = data && data.totalValue > 0;
  const currentProfile = useMemo(
    () => RISK_PROFILES.find((p) => p.id === riskProfile) ?? RISK_PROFILES[2],
    [riskProfile]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-sm relative overflow-hidden"
    >
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <motion.div
              animate={{ rotate: [0, 8, -8, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3 }}
            >
              <Scale className="w-4 h-4 text-amber-400" />
            </motion.div>
            <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">
              Portfolio Rebalancing
            </h4>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950 text-amber-400 border border-amber-800/60">
              ADVISOR
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Saran penyesuaian alokasi berbasis profil risiko
          </p>
        </div>
        <button
          onClick={() => fetchData(riskProfile)}
          disabled={loading}
          aria-label="Refresh rebalancing data"
          className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-950/80 hover:border-slate-700 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Risk profile selector */}
      <div className="relative grid grid-cols-4 gap-1.5 mb-4 p-1 bg-slate-950/40 border border-slate-800/60 rounded-lg">
        {RISK_PROFILES.map((p) => (
          <motion.button
            key={p.id}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setRiskProfile(p.id)}
            className={`relative py-1.5 px-2 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
              riskProfile === p.id
                ? "bg-gradient-to-br from-amber-600 to-orange-600 text-white shadow-lg shadow-amber-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title={`${p.cryptoPct}% Crypto / ${100 - p.cryptoPct}% Saham`}
          >
            <div className="font-mono">{p.label}</div>
            <div className={`text-[8px] ${riskProfile === p.id ? "text-amber-100" : "text-slate-500"}`}>
              {p.cryptoPct}%
            </div>
          </motion.button>
        ))}
      </div>

      {!hasData ? (
        <div className="text-center py-8 text-slate-500">
          <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs">
            {error ? error : "Belum ada holding di portofolio."}
          </p>
          <p className="text-[10px] text-slate-600 mt-1">
            Tambah aset di Crypto Hub untuk mendapatkan saran rebalancing
          </p>
        </div>
      ) : (
        <>
          {/* Current vs Target allocation bars */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Activity className="w-3 h-3 text-blue-400" />
                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400">
                  Crypto / Saham
                </span>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] font-mono mb-0.5">
                    <span className="text-slate-400">Crypto</span>
                    <span className="text-blue-300 font-bold">{data!.currentCryptoPct.toFixed(1)}%</span>
                  </div>
                  <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-800">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${data!.currentCryptoPct}%` }}
                      transition={{ duration: 0.6 }}
                      className="bg-gradient-to-r from-blue-500 to-cyan-400"
                    />
                  </div>
                  <p className="text-[8px] text-slate-500 mt-0.5">
                    Target: {data!.targetCryptoPct.toFixed(0)}%
                  </p>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] font-mono mb-0.5">
                    <span className="text-slate-400">Saham</span>
                    <span className="text-emerald-300 font-bold">{data!.currentStockPct.toFixed(1)}%</span>
                  </div>
                  <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-800">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${data!.currentStockPct}%` }}
                      transition={{ duration: 0.6 }}
                      className="bg-gradient-to-r from-emerald-500 to-green-400"
                    />
                  </div>
                  <p className="text-[8px] text-slate-500 mt-0.5">
                    Target: {data!.targetStockPct.toFixed(0)}%
                  </p>
                </div>
              </div>
            </div>

            {/* Drift score */}
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Target className="w-3 h-3 text-amber-400" />
                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400">
                  Drift Score
                </span>
              </div>
              <div className="mb-1.5">
                <span className="text-2xl font-black font-mono text-white">
                  {data!.driftScore}
                </span>
                <span className="text-[10px] text-slate-500 font-mono ml-1">/100</span>
              </div>
              <DriftGauge score={data!.driftScore} />
              <p className="text-[8px] text-slate-500 mt-1.5">
                {data!.driftScore < 20 ? "Sangat seimbang" : data!.driftScore < 40 ? "Cukup seimbang" : data!.driftScore < 60 ? "Perlu penyesuaian" : "Sangat tidak seimbang"}
              </p>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-2.5 mb-3">
            <p className="text-[10px] text-amber-200 leading-relaxed">{data!.summary}</p>
          </div>

          {/* Actions list */}
          <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
            <AnimatePresence>
              {data!.actions.map((action, idx) => {
                const style = getActionStyle(action.action);
                return (
                  <motion.div
                    key={action.holdingId}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20, height: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.03 }}
                    className={`${style.bg} ${style.border} border rounded-lg p-3`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
                          style={{
                            backgroundColor: `${style.color}15`,
                            borderColor: `${style.color}40`,
                            color: style.color,
                          }}
                        >
                          {style.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-white font-mono truncate">
                              {action.symbol}
                            </span>
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold"
                              style={{
                                color: style.color,
                                backgroundColor: `${style.color}20`,
                              }}
                            >
                              {action.action}
                            </span>
                          </div>
                          <p className="text-[9px] text-slate-500 font-mono">
                            {action.currentWeightPct.toFixed(1)}% → {action.targetWeightPct.toFixed(1)}%
                            <span className="text-slate-600 mx-0.5">•</span>
                            {action.driftPct > 0 ? "+" : ""}
                            {action.driftPct.toFixed(1)}% drift
                          </p>
                        </div>
                      </div>
                      {action.suggestedAmountUsd !== 0 && (
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold font-mono" style={{ color: style.color }}>
                            {action.suggestedAmountUsd > 0 ? "+" : "-"}
                            {formatUSD(Math.abs(action.suggestedAmountUsd))}
                          </p>
                          <p className="text-[8px] text-slate-500 font-mono">
                            {action.suggestedAmountUsd > 0 ? "beli" : "jual"}
                          </p>
                        </div>
                      )}
                    </div>
                    {/* Drift bar */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-[8px] text-slate-500 font-mono w-8">Drift</span>
                      <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden relative">
                        {/* Center line */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600" />
                        {/* Drift fill */}
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{
                            width: `${Math.min(50, Math.abs(action.driftPct))}%`,
                            marginLeft: action.driftPct >= 0 ? "50%" : "auto",
                            marginRight: action.driftPct < 0 ? "50%" : "auto",
                          }}
                          transition={{ duration: 0.5 }}
                          className="h-full"
                          style={{
                            backgroundColor: style.color,
                            marginLeft: action.driftPct >= 0 ? "50%" : undefined,
                            marginRight: action.driftPct < 0 ? "50%" : undefined,
                          }}
                        />
                      </div>
                      <span className="text-[8px] font-mono font-bold" style={{ color: style.color }}>
                        {action.driftPct > 0 ? "+" : ""}
                        {action.driftPct.toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">
                      {action.reason}
                    </p>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[9px] text-slate-500 font-mono">
            <span className="flex items-center gap-1">
              <TrendingUp className="w-2.5 h-2.5" />
              Total: {formatUSD(data!.totalValue)} • {data!.holdingsCount} aset
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${error ? "bg-red-500" : "bg-amber-500 animate-pulse"}`} />
              {error ? "OFFLINE" : "LIVE"}
            </span>
          </div>
        </>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(245,158,11,0.3); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(245,158,11,0.5); }
      `}</style>
    </motion.div>
  );
}
