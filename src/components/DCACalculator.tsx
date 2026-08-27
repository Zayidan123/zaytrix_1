/**
 * DCACalculator — NEW FEATURE (Task 13)
 * -------------------------------------
 * Dollar-Cost Averaging simulator with historical performance. Lets the user
 * configure a DCA strategy (symbol, amount, frequency, start date) and see
 * how it would have performed using real historical prices.
 *
 * Fetches /api/portfolio/dca and renders:
 *   - Strategy configuration form
 *   - Summary cards (Invested, Current Value, Return, DCA vs Lump-Sum)
 *   - DCA vs Lump-Sum comparison bar
 *   - Per-purchase history table (date, price, units)
 *   - Summary message with strategy advice
 */

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Calculator,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  Coins,
  Award,
  Info,
  AlertTriangle,
  PiggyBank,
} from "lucide-react";

interface DCAPurchase {
  date: string;
  price: number;
  units: number;
  amount: number;
}

interface DCAData {
  symbol: string;
  amount: number;
  frequency: string;
  startDate: string;
  endDate: string;
  purchaseCount: number;
  totalInvested: number;
  totalUnits: number;
  averageCost: number;
  currentValue: number;
  currentPrice: number;
  totalReturn: number;
  totalReturnPct: number;
  lumpSumReturn: number;
  lumpSumReturnPct: number;
  dcaAdvantage: number;
  purchases: DCAPurchase[];
  summary: string;
}

const SYMBOL_OPTIONS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT"];
const FREQUENCIES = [
  { id: "daily", label: "Harian" },
  { id: "weekly", label: "Mingguan" },
  { id: "monthly", label: "Bulanan" },
] as const;

const START_DATE_OPTIONS = [
  { months: 1, label: "1 Bulan" },
  { months: 3, label: "3 Bulan" },
  { months: 6, label: "6 Bulan" },
  { months: 12, label: "1 Tahun" },
  { months: 24, label: "2 Tahun" },
];

function formatUSD(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function formatUnits(n: number): string {
  if (n >= 1) return n.toFixed(6);
  return n.toFixed(8);
}

export default function DCACalculator() {
  const [symbol, setSymbol] = useState("BTC");
  const [amount, setAmount] = useState("100");
  const [frequency, setFrequency] = useState<string>("weekly");
  const [monthsBack, setMonthsBack] = useState(12);
  const [data, setData] = useState<DCAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!symbol || isNaN(amt) || amt <= 0) {
      setError("Symbol + amount (>0) wajib diisi.");
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const start = new Date();
      start.setMonth(start.getMonth() - monthsBack);
      const startDate = start.toISOString().split("T")[0];
      const res = await fetch(
        `/api/portfolio/dca?symbol=${encodeURIComponent(symbol)}&amount=${amt}&frequency=${frequency}&startDate=${startDate}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || "Gagal memuat simulasi DCA");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat simulasi DCA");
    } finally {
      setLoading(false);
    }
  }, [symbol, amount, frequency, monthsBack]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const dcaBetter = data && data.dcaAdvantage > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-sm relative overflow-hidden"
    >
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <motion.div
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <PiggyBank className="w-4 h-4 text-cyan-400" />
            </motion.div>
            <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">
              DCA Calculator
            </h4>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-950 text-cyan-400 border border-cyan-800/60">
              HISTORIS
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Simulasi strategi Dollar-Cost Averaging dengan data historis
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          aria-label="Refresh DCA simulation"
          className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-950/80 hover:border-slate-700 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Configuration form */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <div>
          <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">Aset</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
          >
            {SYMBOL_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">Amount $</label>
          <input
            type="number"
            step="any"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
          />
        </div>
        <div>
          <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">Frekuensi</label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">Periode</label>
          <select
            value={monthsBack}
            onChange={(e) => setMonthsBack(parseInt(e.target.value))}
            className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
          >
            {START_DATE_OPTIONS.map((opt) => (
              <option key={opt.months} value={opt.months}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="bg-red-950/40 border border-red-500/40 rounded-lg p-3 mb-3">
          <p className="text-[10px] text-red-300 font-mono flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> {error}
          </p>
        </div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <SummaryCard
              label="Total Invested"
              value={formatUSD(data.totalInvested)}
              sublabel={`${data.purchaseCount} pembelian`}
              icon={<DollarSign className="w-3 h-3" />}
              color="#60a5fa"
            />
            <SummaryCard
              label="Current Value"
              value={formatUSD(data.currentValue)}
              sublabel={`${formatUnits(data.totalUnits)} ${data.symbol}`}
              icon={<Coins className="w-3 h-3" />}
              color="#22d3ee"
            />
            <SummaryCard
              label="Total Return"
              value={`${data.totalReturn >= 0 ? "+" : ""}${formatUSD(data.totalReturn)}`}
              sublabel={`${data.totalReturnPct >= 0 ? "+" : ""}${data.totalReturnPct.toFixed(1)}%`}
              icon={data.totalReturn >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              color={data.totalReturn >= 0 ? "#22c55e" : "#ef4444"}
            />
            <SummaryCard
              label="Avg Cost / Unit"
              value={formatUSD(data.averageCost)}
              sublabel={`Now: ${formatUSD(data.currentPrice)}`}
              icon={<Calculator className="w-3 h-3" />}
              color="#a78bfa"
            />
          </div>

          {/* DCA vs Lump-Sum comparison */}
          <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1">
                <Award className="w-2.5 h-2.5" /> DCA vs Lump-Sum
              </span>
              <span
                className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                  dcaBetter
                    ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                    : "bg-orange-950/60 text-orange-400 border border-orange-800/40"
                }`}
              >
                {dcaBetter ? "DCA MENANG" : "LUMP-SUM MENANG"}
              </span>
            </div>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] font-mono mb-0.5">
                  <span className="text-cyan-300">DCA Return</span>
                  <span style={{ color: data.totalReturn >= 0 ? "#22c55e" : "#ef4444" }}>
                    {data.totalReturn >= 0 ? "+" : ""}{formatUSD(data.totalReturn)} ({data.totalReturnPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 bg-slate-800/60 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, Math.abs(data.totalReturnPct))}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-mono mb-0.5">
                  <span className="text-violet-300">Lump-Sum Return</span>
                  <span style={{ color: data.lumpSumReturn >= 0 ? "#22c55e" : "#ef4444" }}>
                    {data.lumpSumReturn >= 0 ? "+" : ""}{formatUSD(data.lumpSumReturn)} ({data.lumpSumReturnPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 bg-slate-800/60 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, Math.abs(data.lumpSumReturnPct))}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                  />
                </div>
              </div>
              <div className="pt-1.5 border-t border-slate-800/60 flex justify-between text-[10px] font-mono">
                <span className="text-slate-500">Keunggulan DCA:</span>
                <span style={{ color: dcaBetter ? "#22c55e" : "#f97316" }} className="font-bold">
                  {dcaBetter ? "+" : ""}{formatUSD(data.dcaAdvantage)}
                </span>
              </div>
            </div>
          </div>

          {/* Summary message */}
          <div className={`border rounded-lg p-2.5 mb-3 ${
            dcaBetter
              ? "bg-emerald-950/20 border-emerald-800/30"
              : "bg-orange-950/20 border-orange-800/30"
          }`}>
            <p className={`text-[10px] leading-relaxed flex items-start gap-1.5 ${
              dcaBetter ? "text-emerald-200" : "text-orange-200"
            }`}>
              {dcaBetter ? (
                <TrendingUp className="w-2.5 h-2.5 mt-0.5 shrink-0 text-emerald-400" />
              ) : (
                <Info className="w-2.5 h-2.5 mt-0.5 shrink-0 text-orange-400" />
              )}
              {data.summary}
            </p>
          </div>

          {/* Purchase history (last 10) */}
          {data.purchases.length > 0 && (
            <div>
              <p className="text-[9px] uppercase font-bold text-slate-500 mb-2">
                Riwayat Pembelian ({data.purchaseCount} total, menampilkan {Math.min(10, data.purchases.length)} terakhir)
              </p>
              <div className="max-h-40 overflow-y-auto custom-scrollbar">
                <AnimatePresence>
                  {data.purchases.slice(-10).reverse().map((p, idx) => (
                    <motion.div
                      key={p.date + idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className="flex items-center justify-between text-[10px] font-mono py-1 border-b border-slate-800/40 last:border-0"
                    >
                      <span className="text-slate-400">{p.date}</span>
                      <span className="text-slate-300">${p.price.toLocaleString()}</span>
                      <span className="text-cyan-300">{formatUnits(p.units)}</span>
                      <span className="text-slate-500">{formatUSD(p.amount)}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[9px] text-slate-500 font-mono">
            <span className="flex items-center gap-1">
              <Calendar className="w-2.5 h-2.5" />
              {data.startDate} → {data.endDate}
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${error ? "bg-red-500" : "bg-cyan-500 animate-pulse"}`} />
              {error ? "OFFLINE" : "LIVE DATA"}
            </span>
          </div>
        </>
      ) : (
        <div className="text-center py-6 text-slate-500">
          <PiggyBank className={`w-7 h-7 mx-auto mb-2 ${loading ? "animate-bounce" : "opacity-40"}`} />
          <p className="text-xs">{loading ? "Menjalankan simulasi DCA..." : "Tidak ada data"}</p>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(34,211,238,0.3); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(34,211,238,0.5); }
      `}</style>
    </motion.div>
  );
}

function SummaryCard({
  label,
  value,
  sublabel,
  icon,
  color,
}: {
  label: string;
  value: string;
  sublabel: string;
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
      <p className="text-[9px] text-slate-500 font-mono mt-0.5">{sublabel}</p>
    </div>
  );
}
