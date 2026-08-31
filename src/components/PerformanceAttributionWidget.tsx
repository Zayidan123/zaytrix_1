/**
 * PerformanceAttributionWidget — NEW FEATURE (Roadmap #25)
 * ---------------------------------------------------------
 * "Aset mana yang paling berkontribusi terhadap gain/loss portofolio?"
 * Fetches GET /api/portfolio/attribution (server computes with live prices:
 * crypto = Binance, saham = Yahoo Finance) and renders:
 *   - Summary: Total Value / Total Cost / P&L / Return %
 *   - Best & worst performer chips
 *   - Ranked contribution list: weight bar, diverging P&L bar, per-asset
 *     return %, contribution share of total P&L
 *   - Honest per-row price-source badges (LIVE / HARGA BELI)
 *
 * Polls every 60s. Empty state when no holdings. Error state on API failure.
 */

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  PieChart,
  Crown,
  AlertTriangle,
  Info,
} from "lucide-react";

interface AttributionRow {
  id: string;
  symbol: string;
  category: string;
  currency: "USD" | "IDR";
  quantity: number;
  purchasePrice: number;
  livePrice: number;
  priceSource: "live" | "purchase-price";
  costBasis: number;
  currentValue: number;
  gainLoss: number;
  gainLossUsd: number;
  gainLossPct: number;
  weightPct: number;
  contributionPct: number;
}

interface AttributionData {
  totalValue: number; // USD (base)
  totalCost: number; // USD (base)
  totalGainLoss: number; // USD (base)
  totalGainLossPct: number;
  baseCurrency: "USD";
  fxRate: number | null;
  fxSource: string | null;
  fxApplied: boolean;
  mixedCurrency: boolean;
  holdings: AttributionRow[];
  best: { symbol: string; gainLoss: number; currency: "USD" | "IDR"; gainLossPct: number } | null;
  worst: { symbol: string; gainLoss: number; currency: "USD" | "IDR"; gainLossPct: number } | null;
  summary: string;
}

const fmtUSD = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
};

// DATA-QA2: format rupiah untuk baris saham .JK (native IDR).
const fmtIDR = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `Rp${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `Rp${(n / 1e9).toFixed(2)}M`;
  if (abs >= 1e6) return `Rp${(n / 1e6).toFixed(2)}jt`;
  if (abs >= 1e4) return `Rp${(n / 1e3).toFixed(1)}rb`;
  return `Rp${n.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
};

const fmtNative = (currency: "USD" | "IDR" | undefined, n: number): string =>
  currency === "IDR" ? fmtIDR(n) : fmtUSD(n);

const fmtPct = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function PerformanceAttributionWidget() {
  const [data, setData] = useState<AttributionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string>("");

  const fetchAttribution = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/portfolio/attribution", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        setData(json.attribution);
        setLastSync(new Date().toLocaleTimeString("id-ID", { hour12: false }));
      } else {
        setError(json.error || "Gagal memuat atribusi kinerja.");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal terhubung ke server atribusi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAttribution();
    const t = setInterval(fetchAttribution, 60_000);
    return () => clearInterval(t);
  }, [fetchAttribution]);

  // DATA-QA2: skala bar memakai gainLossUsd agar bar lintas mata uang Apple-to-apple.
  const maxAbsGain = data
    ? Math.max(
        ...data.holdings.map((h) => Math.abs(h.gainLossUsd ?? h.gainLoss)),
        1,
      )
    : 1;
  const totalGain = data ? data.totalGainLoss : 0;
  const isProfit = totalGain >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 shadow-2xl relative overflow-hidden"
    >
      {/* Ambient glow */}
      <div
        className={`absolute top-0 ${isProfit ? "right-0" : "left-0"} w-40 h-40 rounded-full blur-3xl pointer-events-none ${
          isProfit ? "bg-emerald-500/5" : "bg-rose-500/5"
        }`}
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/60 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/15 to-cyan-500/10 border border-amber-500/30 flex items-center justify-center">
            <PieChart className="w-4.5 h-4.5 text-amber-400" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              Atribusi Kinerja Portofolio
              <span className="text-[8px] px-1.5 py-0.5 rounded font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/25">
                BARU
              </span>
            </h4>
            <p className="text-[10px] text-slate-500 font-mono">
              Kontribusi gain/loss per aset • harga live{lastSync ? ` • sinkron ${lastSync}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchAttribution}
          disabled={loading}
          className="p-2 rounded-lg bg-slate-800/60 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:border-slate-600 transition-colors cursor-pointer disabled:opacity-50"
          title="Muat ulang atribusi"
          aria-label="Muat ulang atribusi"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 bg-rose-500/5 border border-rose-500/20 rounded-xl p-3 text-[11px] text-rose-400 font-mono">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty state */}
      {!error && !loading && data && data.holdings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center mb-3">
            <PieChart className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-xs text-slate-400 font-semibold">Belum ada holding</p>
          <p className="text-[10px] text-slate-500 font-mono mt-1 max-w-xs leading-relaxed">
            Tambahkan aset di Crypto Hub untuk melihat aset mana yang paling berkontribusi pada gain/loss Anda.
          </p>
        </div>
      )}

      {/* Content */}
      {!error && data && data.holdings.length > 0 && (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
            <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-2.5">
              <p className="text-[8.5px] uppercase font-mono font-bold text-slate-500 tracking-wider">Nilai Kini</p>
              <p className="text-sm font-black font-mono text-white mt-0.5">{fmtUSD(data.totalValue)}</p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-2.5">
              <p className="text-[8.5px] uppercase font-mono font-bold text-slate-500 tracking-wider">Total Biaya</p>
              <p className="text-sm font-black font-mono text-slate-300 mt-0.5">{fmtUSD(data.totalCost)}</p>
            </div>
            <div
              className={`rounded-xl p-2.5 border ${
                isProfit
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-rose-500/5 border-rose-500/20"
              }`}
            >
              <p className="text-[8.5px] uppercase font-mono font-bold text-slate-500 tracking-wider">P&L</p>
              <p
                className={`text-sm font-black font-mono mt-0.5 ${
                  isProfit ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {isProfit ? "+" : ""}
                {fmtUSD(data.totalGainLoss)}
              </p>
            </div>
            <div
              className={`rounded-xl p-2.5 border ${
                isProfit
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-rose-500/5 border-rose-500/20"
              }`}
            >
              <p className="text-[8.5px] uppercase font-mono font-bold text-slate-500 tracking-wider">Return</p>
              <p
                className={`text-sm font-black font-mono mt-0.5 ${
                  isProfit ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {fmtPct(data.totalGainLossPct)}
              </p>
            </div>
          </div>

          {/* Best / worst chips */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
            {data.best && (
              <div className="flex items-center gap-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-3 py-2">
                <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-emerald-400 font-mono">
                    {data.best.symbol} {fmtPct(data.best.gainLossPct)}
                  </p>
                  <p className="text-[9px] text-slate-500 font-mono truncate">
                    Kontributor terbaik • {fmtNative(data.best.currency, data.best.gainLoss)}
                  </p>
                </div>
              </div>
            )}
            {data.worst && (
              <div className="flex items-center gap-2.5 bg-rose-500/5 border border-rose-500/20 rounded-xl px-3 py-2">
                <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-rose-400 font-mono">
                    {data.worst.symbol} {fmtPct(data.worst.gainLossPct)}
                  </p>
                  <p className="text-[9px] text-slate-500 font-mono truncate">
                    Kontributor terburuk • {fmtNative(data.worst.currency, data.worst.gainLoss)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* DATA-QA2: peringatan total campuran bila kurs gagal */}
          {data.mixedCurrency && (
            <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 mb-4 text-[10px] text-amber-400 font-mono">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Kurs USD/IDR live tidak tersedia — total sementara mencampur IDR dan USD TANPA konversi
                (diberi label, bukan klaim USD murni). Persentase per-aset tetap akurat.
              </span>
            </div>
          )}

          {/* Contribution list */}
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {data.holdings.map((h, idx) => {
                const profit = h.gainLoss >= 0;
                // DATA-QA2: bar P&L diskalakan dalam USD agar lintas mata uang sebanding.
                const barPct = (Math.abs(h.gainLossUsd ?? h.gainLoss) / maxAbsGain) * 100;
                return (
                  <motion.div
                    key={h.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05, duration: 0.3 }}
                    className="bg-slate-950/50 border border-slate-800/50 rounded-xl p-3 hover:border-slate-700/60 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                            h.category === "crypto"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                              : "bg-sky-500/10 text-sky-400 border-sky-500/25"
                          }`}
                        >
                          {h.category === "crypto" ? "CRYPTO" : "SAHAM"}
                        </span>
                        <span className="text-xs font-black font-mono text-white truncate">{h.symbol}</span>
                        <span className="text-[9px] text-slate-500 font-mono truncate hidden sm:inline">
                          {h.quantity.toLocaleString()} × {fmtNative(h.currency, h.livePrice)}
                        </span>
                        {h.currency === "IDR" && (
                          <span className="text-[7.5px] font-mono font-bold px-1 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/25 shrink-0" title={`Dikonversi ke USD untuk total portofolio (kurs Rp${data.fxRate ? Math.round(data.fxRate).toLocaleString("id-ID") : "-"})`}>
                            IDR→USD
                          </span>
                        )}
                        {h.priceSource !== "live" && (
                          <span className="text-[7.5px] font-mono font-bold px-1 py-0.5 rounded bg-slate-700/40 text-slate-400 border border-slate-600/40 shrink-0">
                            HARGA BELI
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`text-[11px] font-black font-mono ${
                            profit ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {profit ? "+" : ""}
                          {fmtNative(h.currency, h.gainLoss)}
                        </p>
                        <p className="text-[9px] font-mono text-slate-500">{fmtPct(h.gainLossPct)}</p>
                      </div>
                    </div>

                    {/* Diverging P&L bar (gain emerald right, loss rose left) — skala USD */}
                    <div className="relative h-2.5 bg-slate-900/80 rounded-full overflow-hidden">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-700/60" />
                      {profit ? (
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${barPct / 2}%` }}
                          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 + idx * 0.05 }}
                          className="absolute inset-y-0 left-1/2 bg-gradient-to-r from-emerald-500/80 to-emerald-400 rounded-r-full"
                        />
                      ) : (
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${barPct / 2}%` }}
                          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 + idx * 0.05 }}
                          className="absolute inset-y-0 right-1/2 bg-gradient-to-l from-rose-500/80 to-rose-400 rounded-l-full"
                        />
                      )}
                    </div>

                    {/* Footer stats */}
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[8.5px] font-mono text-slate-500">
                        Bobot portofolio: {h.weightPct.toFixed(1)}%
                      </span>
                      <span
                        className={`text-[8.5px] font-mono font-semibold ${
                          h.contributionPct >= 0 ? "text-emerald-500/80" : "text-rose-500/80"
                        }`}
                      >
                        Kontribusi P&L: {h.contributionPct.toFixed(1)}%
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Honest data note */}
          <div className="flex items-start gap-1.5 mt-4 pt-3 border-t border-slate-800/60">
            <Info className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
            <p className="text-[9px] text-slate-500 font-mono leading-relaxed">
              {data.summary} • Crypto: harga live Binance; saham: live Yahoo Finance. Baris berlabel
              "HARGA BELI" memakai harga beli karena harga live tidak tersedia.
              {data.fxApplied
                ? ` Total dalam USD; saham IDR dikonversi pada kurs live ${data.fxSource ?? ""}.`
                : ""}
            </p>
          </div>
        </>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2.5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 bg-slate-950/60 border border-slate-800/60 rounded-xl animate-pulse" />
            ))}
          </div>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-950/50 border border-slate-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      )}
    </motion.div>
  );
}
