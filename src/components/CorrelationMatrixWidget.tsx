/**
 * CorrelationMatrixWidget — NEW FEATURE (Task 11)
 * ------------------------------------------------
 * Interactive heatmap of Pearson correlations between crypto assets. Fetches
 * daily klines from Binance (via /api/portfolio/correlation-matrix) and
 * computes pairwise correlations on the returns series.
 *
 * Features:
 *   - Symbol picker (add/remove assets from the matrix)
 *   - Timeframe selector (7/30/90/180 days)
 *   - N×N color-coded heatmap (red=positive, blue=negative, intensity=|corr|)
 *   - Diversification score gauge (0-100)
 *   - Highest/lowest correlation callouts
 *   - 5-min cached (server-side) + 60s client poll
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Grid3x3,
  RefreshCw,
  Plus,
  X,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

interface MatrixCell {
  a: string;
  b: string;
  correlation: number;
  absCorrelation: number;
}

interface CorrData {
  matrix: MatrixCell[];
  symbols: string[];
  days: number;
  highestCorrelation: MatrixCell | null;
  lowestCorrelation: MatrixCell | null;
  diversificationScore: number;
  lastUpdated: string;
  error?: string;
}

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP"];
const SYMBOL_OPTIONS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "MATIC", "LTC"];
const TIMEFRAMES = [
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
  { days: 180, label: "180D" },
] as const;

// Map correlation value [-1, 1] to a color
function corrColor(corr: number): { bg: string; text: string } {
  if (corr >= 0.8) return { bg: "#dc2626", text: "#fff" }; // strong positive — red
  if (corr >= 0.5) return { bg: "#f97316", text: "#fff" }; // moderate positive — orange
  if (corr >= 0.3) return { bg: "#fbbf24", text: "#1e293b" }; // weak positive — amber
  if (corr >= -0.3) return { bg: "#64748b", text: "#fff" }; // near zero — slate
  if (corr >= -0.5) return { bg: "#3b82f6", text: "#fff" }; // weak negative — blue
  if (corr >= -0.8) return { bg: "#6366f1", text: "#fff" }; // moderate negative — indigo
  return { bg: "#1d4ed8", text: "#fff" }; // strong negative — deep blue
}

function corrLabel(corr: number): string {
  if (corr >= 0.8) return "Sangat Positif";
  if (corr >= 0.5) return "Positif";
  if (corr >= 0.3) return "Lemah Positif";
  if (corr >= -0.3) return "Netral";
  if (corr >= -0.5) return "Lemah Negatif";
  if (corr >= -0.8) return "Negatif";
  return "Sangat Negatif";
}

export default function CorrelationMatrixWidget() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<CorrData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<MatrixCell | null>(null);

  const fetchData = useCallback(async () => {
    if (symbols.length < 2) {
      setError("Minimal 2 simbol diperlukan.");
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/portfolio/correlation-matrix?symbols=${encodeURIComponent(symbols.join(","))}&days=${days}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || "Gagal memuat matriks korelasi");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat matriks korelasi");
    } finally {
      setLoading(false);
    }
  }, [symbols, days]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const addSymbol = (s: string) => {
    if (!symbols.includes(s) && symbols.length < 12) {
      setSymbols((prev) => [...prev, s]);
    }
    setShowSymbolPicker(false);
  };

  const removeSymbol = (s: string) => {
    if (symbols.length > 2) {
      setSymbols((prev) => prev.filter((x) => x !== s));
    }
  };

  // Build matrix grid (symbols × symbols)
  const gridData = useMemo(() => {
    if (!data || !data.matrix.length) return [];
    const n = data.symbols.length;
    const grid: MatrixCell[][] = [];
    for (let i = 0; i < n; i++) {
      const row: MatrixCell[] = [];
      for (let j = 0; j < n; j++) {
        const cell = data.matrix.find((m) => m.a === data.symbols[i] && m.b === data.symbols[j]);
        row.push(cell || { a: data.symbols[i], b: data.symbols[j], correlation: 0, absCorrelation: 0 });
      }
      grid.push(row);
    }
    return grid;
  }, [data]);

  const divScore = data?.diversificationScore ?? 0;
  const divColor = divScore >= 70 ? "#22c55e" : divScore >= 40 ? "#eab308" : "#ef4444";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-sm relative overflow-hidden"
    >
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3 }}
            >
              <Grid3x3 className="w-4 h-4 text-indigo-400" />
            </motion.div>
            <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">
              Correlation Matrix
            </h4>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-950 text-indigo-400 border border-indigo-800/60">
              PEARSON
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Analisis korelasi return antar aset untuk diversifikasi
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          aria-label="Refresh correlation matrix"
          className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-950/80 hover:border-slate-700 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Timeframe selector */}
      <div className="flex items-center gap-1.5 mb-3">
        {TIMEFRAMES.map((tf) => (
          <motion.button
            key={tf.days}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setDays(tf.days)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition-all cursor-pointer ${
              days === tf.days
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                : "bg-slate-950/40 border border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {tf.label}
          </motion.button>
        ))}
      </div>

      {/* Symbol chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {symbols.map((s) => (
          <motion.div
            key={s}
            layout
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-950/40 border border-indigo-800/40 text-indigo-300 text-[10px] font-mono font-bold"
          >
            {s}
            {symbols.length > 2 && (
              <button
                onClick={() => removeSymbol(s)}
                aria-label={`Remove ${s}`}
                className="hover:text-red-400 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </motion.div>
        ))}
        <button
          onClick={() => setShowSymbolPicker((v) => !v)}
          className="px-2 py-0.5 rounded-full bg-slate-950/40 border border-slate-800 hover:border-indigo-700/40 text-slate-400 hover:text-indigo-300 text-[10px] font-mono flex items-center gap-0.5 transition-colors"
        >
          <Plus className="w-2.5 h-2.5" /> Aset
        </button>
      </div>

      {/* Symbol picker dropdown */}
      <AnimatePresence>
        {showSymbolPicker && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-3"
          >
            <div className="flex flex-wrap gap-1.5 p-2 bg-slate-950/40 border border-slate-800/60 rounded-lg">
              {SYMBOL_OPTIONS.filter((s) => !symbols.includes(s)).map((s) => (
                <button
                  key={s}
                  onClick={() => addSymbol(s)}
                  className="px-2 py-1 rounded-md bg-slate-900/60 border border-slate-800 hover:border-indigo-700/40 text-slate-400 hover:text-indigo-300 text-[10px] font-mono transition-colors"
                >
                  + {s}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error ? (
        <div className="bg-red-950/40 border border-red-500/40 rounded-lg p-3">
          <p className="text-[10px] text-red-300 font-mono flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> {error}
          </p>
        </div>
      ) : data && gridData.length > 0 ? (
        <>
          {/* Diversification score + highest/lowest callouts */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5">
              <div className="flex items-center gap-1 mb-1">
                <Target className="w-3 h-3" style={{ color: divColor }} />
                <span className="text-[9px] uppercase font-bold text-slate-500">Diversifikasi</span>
              </div>
              <p className="text-lg font-black font-mono" style={{ color: divColor }}>
                {divScore}<span className="text-[10px] text-slate-500">/100</span>
              </p>
              <div className="w-full h-1 bg-slate-800/60 rounded-full mt-1 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${divScore}%` }}
                  transition={{ duration: 0.8 }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: divColor }}
                />
              </div>
            </div>
            {data.highestCorrelation && (
              <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-2.5">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingUp className="w-3 h-3 text-red-400" />
                  <span className="text-[9px] uppercase font-bold text-slate-500">Tertinggi</span>
                </div>
                <p className="text-xs font-bold font-mono text-red-300">
                  {data.highestCorrelation.a}/{data.highestCorrelation.b}
                </p>
                <p className="text-sm font-black font-mono text-red-400">
                  +{data.highestCorrelation.correlation.toFixed(2)}
                </p>
              </div>
            )}
            {data.lowestCorrelation && (
              <div className="bg-blue-950/30 border border-blue-800/40 rounded-lg p-2.5">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingDown className="w-3 h-3 text-blue-400" />
                  <span className="text-[9px] uppercase font-bold text-slate-500">Terendah</span>
                </div>
                <p className="text-xs font-bold font-mono text-blue-300">
                  {data.lowestCorrelation.a}/{data.lowestCorrelation.b}
                </p>
                <p className="text-sm font-black font-mono text-blue-400">
                  {data.lowestCorrelation.correlation.toFixed(2)}
                </p>
              </div>
            )}
          </div>

          {/* Heatmap matrix */}
          <div className="overflow-x-auto custom-scrollbar mb-3">
            <div className="inline-block min-w-full">
              {/* Header row */}
              <div className="flex">
                <div className="w-12 sm:w-14 shrink-0" />
                {data.symbols.map((s) => (
                  <div
                    key={s}
                    className="flex-1 min-w-[36px] text-center text-[9px] font-mono font-bold text-slate-400 py-1.5"
                  >
                    {s}
                  </div>
                ))}
              </div>
              {/* Matrix rows */}
              {gridData.map((row, i) => (
                <div key={i} className="flex items-center">
                  <div className="w-12 sm:w-14 shrink-0 text-right pr-2 text-[9px] font-mono font-bold text-slate-400">
                    {data.symbols[i]}
                  </div>
                  {row.map((cell, j) => {
                    const colors = corrColor(cell.correlation);
                    const isDiagonal = i === j;
                    return (
                      <motion.div
                        key={`${i}-${j}`}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: (i * data.symbols.length + j) * 0.01 }}
                        onMouseEnter={() => setHoveredCell(cell)}
                        onMouseLeave={() => setHoveredCell(null)}
                        className="flex-1 min-w-[36px] h-9 m-0.5 rounded-md flex items-center justify-center text-[10px] font-mono font-bold cursor-pointer transition-transform hover:scale-110 hover:z-10 relative"
                        style={{
                          backgroundColor: isDiagonal ? "rgba(71,85,105,0.3)" : colors.bg,
                          color: colors.text,
                          border: isDiagonal ? "1px dashed rgba(148,163,184,0.4)" : "none",
                        }}
                        title={`${cell.a}/${cell.b} = ${cell.correlation.toFixed(3)}`}
                      >
                        {isDiagonal ? "1.00" : cell.correlation.toFixed(2)}
                      </motion.div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Hovered cell detail + legend */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5">
              <p className="text-[9px] uppercase font-bold text-slate-500 mb-1">Detail</p>
              {hoveredCell ? (
                <div>
                  <p className="text-xs font-mono font-bold text-white">
                    {hoveredCell.a} / {hoveredCell.b}
                  </p>
                  <p className="text-sm font-black font-mono" style={{ color: corrColor(hoveredCell.correlation).bg }}>
                    {hoveredCell.correlation >= 0 ? "+" : ""}
                    {hoveredCell.correlation.toFixed(3)}
                  </p>
                  <p className="text-[9px] text-slate-400">{corrLabel(hoveredCell.correlation)}</p>
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 italic">Hover sel matrix untuk detail</p>
              )}
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5">
              <p className="text-[9px] uppercase font-bold text-slate-500 mb-1.5">Skala Korelasi</p>
              <div className="flex items-center gap-0.5">
                {[
                  { v: -1, c: "#1d4ed8" },
                  { v: -0.5, c: "#6366f1" },
                  { v: -0.3, c: "#3b82f6" },
                  { v: 0, c: "#64748b" },
                  { v: 0.3, c: "#fbbf24" },
                  { v: 0.5, c: "#f97316" },
                  { v: 1, c: "#dc2626" },
                ].map((s, idx) => (
                  <div key={idx} className="flex-1 h-3 rounded-sm" style={{ backgroundColor: s.c }} title={`${s.v}`} />
                ))}
              </div>
              <div className="flex justify-between text-[8px] text-slate-500 font-mono mt-0.5">
                <span>-1.0</span>
                <span className="text-blue-400">Negatif</span>
                <span>0</span>
                <span className="text-red-400">Positif</span>
                <span>+1.0</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[9px] text-slate-500 font-mono">
            <span className="flex items-center gap-1">
              <Activity className="w-2.5 h-2.5" />
              {data.symbols.length} aset • {data.days} hari
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              {data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-slate-500">
          <Grid3x3 className={`w-7 h-7 mx-auto mb-2 ${loading ? "animate-spin" : "opacity-40"}`} />
          <p className="text-xs">{loading ? "Menghitung korelasi..." : "Tidak ada data"}</p>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { height: 4px; width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(99,102,241,0.5); }
      `}</style>
    </motion.div>
  );
}
