/**
 * TaxLotOptimizer — NEW FEATURE (Task 10)
 * ---------------------------------------
 * Institutional tax-lot calculator for crypto sales. Lets the user simulate a
 * sale of N units at price P, comparing FIFO / LIFO / HIFO methods side-by-side
 * to minimize realized gains.
 *
 * Fetches /api/portfolio/tax-lots?method=X&symbol=Y&sellQuantity=Z&sellPrice=P
 * and renders:
 *   - Method selector (FIFO / LIFO / HIFO) with explanations
 *   - Sell quantity + price inputs (with live BTC price suggestion)
 *   - Comparison summary (total gain/loss per method — computed by 3 calls)
 *   - Per-lot breakdown (which lots are sold, cost basis, proceeds, gain/loss,
 *     holding period, short/long-term classification)
 *   - PMK-68 estimated tax (0.1% of proceeds in IDR)
 *   - Notes with method-specific tax advice
 */

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  AlertTriangle,
  Info,
  Coins,
  Calendar,
  Percent,
  Receipt,
  Zap,
} from "lucide-react";

interface SaleLot {
  lotId: string;
  acquiredAt: string;
  quantitySold: number;
  costBasisUsd: number;
  proceedsUsd: number;
  gainLossUsd: number;
  holdingPeriodDays: number;
  isShortTerm: boolean;
}

interface TaxLotResult {
  method: string;
  symbol: string;
  sellQuantity: number;
  sellPrice: number;
  totalProceedsUsd: number;
  totalCostBasisUsd: number;
  totalGainLossUsd: number;
  totalGainLossPct: number;
  shortTermGainLossUsd: number;
  longTermGainLossUsd: number;
  saleLots: SaleLot[];
  remainingLots: any[];
  totalRemainingQuantity: number;
  totalRemainingCostBasis: number;
  estimatedTaxIdr: number;
  notes: string[];
}

const METHODS = [
  {
    id: "FIFO",
    label: "FIFO",
    full: "First In First Out",
    desc: "Lot tertua dijual dulu — konservatif",
    color: "#3b82f6",
    icon: Calendar,
  },
  {
    id: "LIFO",
    label: "LIFO",
    full: "Last In First Out",
    desc: "Lot terbaru dijual dulu — efisien di pasar turun",
    color: "#a78bfa",
    icon: TrendingDown,
  },
  {
    id: "HIFO",
    label: "HIFO",
    full: "Highest In First Out",
    desc: "Lot termahal dijual dulu — minim gain",
    color: "#22c55e",
    icon: TrendingUp,
  },
] as const;

function formatUSD(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function formatIDR(n: number): string {
  if (n >= 1e9) return `Rp ${(n / 1e9).toFixed(2)}M`;
  if (n >= 1e6) return `Rp ${(n / 1e6).toFixed(2)}jt`;
  return `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

function formatDays(days: number): string {
  if (days < 30) return `${days}h`;
  if (days < 365) return `${Math.floor(days / 30)}bln`;
  return `${(days / 365).toFixed(1)}thn`;
}

export default function TaxLotOptimizer() {
  const [method, setMethod] = useState<string>("HIFO");
  const [symbol, setSymbol] = useState("BTC");
  const [sellQuantity, setSellQuantity] = useState("0.1");
  const [sellPrice, setSellPrice] = useState("95000");
  const [result, setResult] = useState<TaxLotResult | null>(null);
  const [comparison, setComparison] = useState<Record<string, TaxLotResult | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (m: string) => {
    const qty = parseFloat(sellQuantity);
    const price = parseFloat(sellPrice);
    if (!symbol || isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
      setError("Symbol, sellQuantity (>0), dan sellPrice (>0) wajib diisi.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/portfolio/tax-lots?method=${m}&symbol=${encodeURIComponent(symbol.toUpperCase())}&sellQuantity=${qty}&sellPrice=${price}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setResult(data.result);
        // For comparison, fetch the other 2 methods
        const others = METHODS.filter((x) => x.id !== m);
        const [r1, r2] = await Promise.all(
          others.map((x) =>
            fetch(
              `/api/portfolio/tax-lots?method=${x.id}&symbol=${encodeURIComponent(symbol.toUpperCase())}&sellQuantity=${qty}&sellPrice=${price}`
            ).then((r) => r.json())
          )
        );
        const comp: Record<string, TaxLotResult | null> = { [m]: data.result };
        if (r1.success) comp[others[0].id] = r1.result;
        if (r2.success) comp[others[1].id] = r2.result;
        setComparison(comp);
      } else {
        setError(data.error || "Gagal menghitung tax lots");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal menghitung tax lots");
    } finally {
      setLoading(false);
    }
  }, [symbol, sellQuantity, sellPrice]);

  useEffect(() => {
    fetchData(method);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, symbol, sellQuantity, sellPrice]);

  const bestMethod = React.useMemo(() => {
    const entries = Object.entries(comparison).filter(([, r]) => r && r.saleLots.length > 0);
    if (entries.length === 0) return null;
    entries.sort((a, b) => a[1].totalGainLossUsd - b[1].totalGainLossUsd);
    return entries[0][0]; // lowest gain = best for tax
  }, [comparison]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-sm relative overflow-hidden"
    >
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3 }}
            >
              <Calculator className="w-4 h-4 text-emerald-400" />
            </motion.div>
            <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">
              Tax Lot Optimizer
            </h4>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
              FIFO/LIFO/HIFO
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Optimalkan pajak capital gain dengan pemilihan lot yang tepat
          </p>
        </div>
      </div>

      {/* Method selector */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {METHODS.map((m) => {
          const Icon = m.icon;
          const isActive = method === m.id;
          const compResult = comparison[m.id];
          const isBest = bestMethod === m.id && compResult && compResult.saleLots.length > 0;
          return (
            <motion.button
              key={m.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setMethod(m.id)}
              className={`relative p-2.5 rounded-lg border text-left transition-all cursor-pointer overflow-hidden ${
                isActive
                  ? "bg-slate-950/80 border-2"
                  : "bg-slate-950/40 border border-slate-800 hover:border-slate-700"
              }`}
              style={isActive ? { borderColor: m.color } : {}}
            >
              {isBest && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-1 right-1 px-1 py-0.5 rounded text-[7px] font-mono font-bold bg-emerald-500 text-white"
                >
                  BEST
                </motion.div>
              )}
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3.5 h-3.5" style={{ color: isActive ? m.color : "#94a3b8" }} />
                <span className="text-xs font-bold font-mono" style={{ color: isActive ? m.color : "#cbd5e1" }}>
                  {m.label}
                </span>
              </div>
              <p className="text-[8px] text-slate-500 leading-tight">{m.desc}</p>
              {compResult && compResult.saleLots.length > 0 && (
                <p className="text-[9px] font-mono font-bold mt-1" style={{
                  color: compResult.totalGainLossUsd >= 0 ? "#22c55e" : "#ef4444"
                }}>
                  {compResult.totalGainLossUsd >= 0 ? "+" : ""}
                  {formatUSD(compResult.totalGainLossUsd)}
                </p>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Sale parameters */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div>
          <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">
            Symbol
          </label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="BTC"
            className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
          />
        </div>
        <div>
          <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">
            Sell Qty
          </label>
          <input
            type="number"
            step="any"
            min="0"
            value={sellQuantity}
            onChange={(e) => setSellQuantity(e.target.value)}
            placeholder="0.1"
            className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
          />
        </div>
        <div>
          <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">
            Sell Price $
          </label>
          <input
            type="number"
            step="any"
            min="0"
            value={sellPrice}
            onChange={(e) => setSellPrice(e.target.value)}
            placeholder="95000"
            className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
          />
        </div>
      </div>

      {error ? (
        <div className="bg-red-950/40 border border-red-500/40 rounded-lg p-3 mb-3">
          <p className="text-[10px] text-red-300 font-mono flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> {error}
          </p>
        </div>
      ) : result ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <SummaryCard
              label="Proceeds"
              value={formatUSD(result.totalProceedsUsd)}
              icon={<Coins className="w-3 h-3" />}
              color="#60a5fa"
            />
            <SummaryCard
              label="Cost Basis"
              value={formatUSD(result.totalCostBasisUsd)}
              icon={<Receipt className="w-3 h-3" />}
              color="#a78bfa"
            />
            <SummaryCard
              label="Gain/Loss"
              value={`${result.totalGainLossUsd >= 0 ? "+" : ""}${formatUSD(result.totalGainLossUsd)}`}
              icon={result.totalGainLossUsd >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              color={result.totalGainLossUsd >= 0 ? "#22c55e" : "#ef4444"}
            />
            <SummaryCard
              label="PMK-68 Tax"
              value={formatIDR(result.estimatedTaxIdr)}
              icon={<Percent className="w-3 h-3" />}
              color="#f97316"
            />
          </div>

          {/* Short/Long term split */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5">
              <p className="text-[9px] uppercase font-bold text-slate-500 mb-1">Short-Term (&lt;1yr)</p>
              <p className="text-sm font-bold font-mono" style={{ color: result.shortTermGainLossUsd >= 0 ? "#22c55e" : "#ef4444" }}>
                {result.shortTermGainLossUsd >= 0 ? "+" : ""}
                {formatUSD(result.shortTermGainLossUsd)}
              </p>
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5">
              <p className="text-[9px] uppercase font-bold text-slate-500 mb-1">Long-Term (&ge;1yr)</p>
              <p className="text-sm font-bold font-mono" style={{ color: result.longTermGainLossUsd >= 0 ? "#22c55e" : "#ef4444" }}>
                {result.longTermGainLossUsd >= 0 ? "+" : ""}
                {formatUSD(result.longTermGainLossUsd)}
              </p>
            </div>
          </div>

          {/* Per-lot breakdown */}
          {result.saleLots.length > 0 && (
            <div className="mb-3">
              <p className="text-[9px] uppercase font-bold text-slate-500 mb-2 flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> Lot Terjual ({result.saleLots.length})
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                <AnimatePresence>
                  {result.saleLots.map((lot, idx) => (
                    <motion.div
                      key={lot.lotId + idx}
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.03 }}
                      className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[9px] font-mono text-slate-500">#{idx + 1}</span>
                          <span className="text-[10px] font-mono text-slate-300 truncate">
                            {new Date(lot.acquiredAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "2-digit" })}
                          </span>
                          <span className={`text-[8px] px-1 py-0.5 rounded font-mono font-bold ${
                            lot.isShortTerm
                              ? "bg-orange-950/60 text-orange-400 border border-orange-800/40"
                              : "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                          }`}>
                            {lot.isShortTerm ? "ST" : "LT"} • {formatDays(lot.holdingPeriodDays)}
                          </span>
                        </div>
                        <span className="text-xs font-bold font-mono" style={{ color: lot.gainLossUsd >= 0 ? "#22c55e" : "#ef4444" }}>
                          {lot.gainLossUsd >= 0 ? "+" : ""}
                          {formatUSD(lot.gainLossUsd)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[9px] font-mono">
                        <div>
                          <span className="text-slate-500">Qty: </span>
                          <span className="text-slate-300">{lot.quantitySold.toFixed(6)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Cost: </span>
                          <span className="text-violet-300">{formatUSD(lot.costBasisUsd)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Proc: </span>
                          <span className="text-blue-300">{formatUSD(lot.proceedsUsd)}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Notes */}
          {result.notes.length > 0 && (
            <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-2.5 mb-2">
              {result.notes.map((note, i) => (
                <p key={i} className="text-[10px] text-amber-200 leading-relaxed flex items-start gap-1.5 mb-1">
                  <Info className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                  {note}
                </p>
              ))}
            </div>
          )}

          {/* Remaining position */}
          {result.totalRemainingQuantity > 0 && (
            <div className="text-[9px] text-slate-500 font-mono flex items-center justify-between border-t border-slate-800/60 pt-2">
              <span>Sisa posisi: <span className="text-slate-300">{result.totalRemainingQuantity.toFixed(6)} {result.symbol}</span></span>
              <span>Cost basis: <span className="text-violet-300">{formatUSD(result.totalRemainingCostBasis)}</span></span>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-6 text-slate-500">
          <Calculator className={`w-7 h-7 mx-auto mb-2 ${loading ? "animate-spin" : "opacity-40"}`} />
          <p className="text-xs">{loading ? "Menghitung..." : "Isi parameter untuk menghitung tax lots"}</p>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(16,185,129,0.3); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(16,185,129,0.5); }
      `}</style>
    </motion.div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5">
      <div className="flex items-center gap-1 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-[9px] uppercase font-bold text-slate-500">{label}</span>
      </div>
      <p className="text-sm font-bold font-mono" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
