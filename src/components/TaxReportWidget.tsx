/**
 * TaxReportWidget — NEW FEATURE (Task 12)
 * ---------------------------------------
 * Automated annual tax report generator with PDF export. Fetches
 * /api/portfolio/tax-report?year=YYYY and renders:
 *   - Year selector
 *   - Summary cards (Proceeds, Cost Basis, Realized G/L, PMK-68 Tax)
 *   - Per-symbol breakdown table
 *   - Summary message with tax advice
 *   - "Export PDF" button that opens a print-optimized report in a new tab
 *
 * The PDF is generated client-side via window.print() on a formatted HTML
 * document (same approach as pdfGenerator.ts, but tax-report specific).
 */

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  FileText,
  Download,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Receipt,
  Coins,
  Calendar,
  Printer,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

interface SymbolRow {
  symbol: string;
  buyCount: number;
  sellCount: number;
  totalBuyQty: number;
  totalSellQty: number;
  proceedsUsd: number;
  costBasisUsd: number;
  gainLossUsd: number;
  gainLossPct: number;
  remainingQty: number;
}

interface TaxReport {
  year: number;
  totalProceedsUsd: number;
  totalCostBasisUsd: number;
  realizedGainLossUsd: number;
  unrealizedGainLossUsd: number;
  realizedGainLossPct: number;
  pmk68TaxUsd: number;
  pmk68TaxIdr: number | null; // DATA-24: null = kurs USD/IDR tidak tersedia
  usdIdrRate?: number | null; // kurs live yang dipakai server (transparansi)
  pmk68TaxRate: number;
  transactionCount: number;
  buyCount: number;
  sellCount: number;
  totalBuyQty: number;
  totalSellQty: number;
  perSymbol: SymbolRow[];
  generatedAt: string;
  summary: string;
}

// SEC-4: escape user-controlled values (symbol bisa berasal dari transaksi
// ledger user) sebelum diinterpolasi ke HTML print-window (document.write).
const escapeHtml = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

export default function TaxReportWidget() {
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [report, setReport] = useState<TaxReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (y: number) => {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch(`/api/portfolio/tax-report?year=${y}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setReport(data.report);
      } else {
        setError(data.error || "Gagal memuat laporan pajak");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat laporan pajak");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport(year);
  }, [year, fetchReport]);

  const exportPDF = () => {
    if (!report) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup terblokir. Izinkan popup untuk ekspor PDF.");
      return;
    }

    const symbolRows = report.perSymbol
      .map(
        (s) => `<tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${escapeHtml(s.symbol)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${s.buyCount}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${s.sellCount}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #3b82f6;">${formatUSD(s.proceedsUsd)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #8b5cf6;">${formatUSD(s.costBasisUsd)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right; color: ${s.gainLossUsd >= 0 ? "#22c55e" : "#ef4444"}; font-weight: bold;">
            ${s.gainLossUsd >= 0 ? "+" : ""}${formatUSD(s.gainLossUsd)}
          </td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${s.gainLossPct.toFixed(1)}%</td>
        </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Laporan Pajak ZAYTRIX ${report.year}</title>
  <style>
    @page { margin: 1.5cm; }
    body { font-family: 'Inter', -apple-system, sans-serif; color: #1e293b; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #0f172a; border-bottom: 3px solid #0d9488; padding-bottom: 10px; font-size: 24px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .badge { background: linear-gradient(135deg, #0d9488, #0891b2); color: white; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: bold; }
    .summary { background: #f0fdfa; border-left: 4px solid #0d9488; padding: 15px; margin: 20px 0; font-size: 13px; line-height: 1.6; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
    .stat-label { font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px; }
    .stat-value { font-size: 16px; font-weight: 900; margin-top: 4px; font-family: 'JetBrains Mono', monospace; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
    th { background: #0f172a; color: white; padding: 10px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    th.right { text-align: right; }
    .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #64748b; display: flex; justify-content: space-between; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>ZAYTRIX — Laporan Pajak Tahun ${report.year}</h1>
      <p style="color: #64748b; font-size: 12px; margin: 4px 0;">Ringkasan transaksi crypto + estimasi pajak PMK-68</p>
    </div>
    <span class="badge">TAHUN ${report.year}</span>
  </div>

  <div class="summary">
    <strong>Ringkasan:</strong> ${escapeHtml(report.summary)}
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-label">Total Proceeds</div>
      <div class="stat-value" style="color: #3b82f6;">${formatUSD(report.totalProceedsUsd)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Cost Basis</div>
      <div class="stat-value" style="color: #8b5cf6;">${formatUSD(report.totalCostBasisUsd)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Realized G/L</div>
      <div class="stat-value" style="color: ${report.realizedGainLossUsd >= 0 ? "#22c55e" : "#ef4444"};">
        ${report.realizedGainLossUsd >= 0 ? "+" : ""}${formatUSD(report.realizedGainLossUsd)}
      </div>
    </div>
    <div class="stat">
      <div class="stat-label">PMK-68 Tax</div>
      <div class="stat-value" style="color: #f97316;">${report.pmk68TaxIdr !== null && report.pmk68TaxIdr !== undefined ? formatIDR(report.pmk68TaxIdr) : "—"}</div>
    </div>
  </div>

  <h2 style="font-size: 16px; color: #0f172a; margin-top: 30px;">Rincian Per Aset</h2>
  <table>
    <thead>
      <tr>
        <th>Symbol</th>
        <th class="right">Buy Tx</th>
        <th class="right">Sell Tx</th>
        <th class="right">Proceeds</th>
        <th class="right">Cost Basis</th>
        <th class="right">G/L</th>
        <th class="right">G/L %</th>
      </tr>
    </thead>
    <tbody>
      ${symbolRows}
    </tbody>
  </table>

  <div class="footer">
    <span>Dibuat: ${new Date(report.generatedAt).toLocaleString("id-ID")}</span>
    <span>PMK-68 Rate: ${(report.pmk68TaxRate * 100).toFixed(1)}% dari proceeds • USD/IDR: ${report.usdIdrRate ? report.usdIdrRate.toLocaleString("id-ID", { maximumFractionDigits: 0 }) : "kurs live (tidak tersedia)"}</span>
  </div>
  <script>
    window.onload = () => { setTimeout(() => window.print(), 300); };
  </script>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const hasData = report && report.transactionCount > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-sm relative overflow-hidden"
    >
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <motion.div
              animate={{ rotate: [0, 8, -8, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3 }}
            >
              <FileText className="w-4 h-4 text-orange-400" />
            </motion.div>
            <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">
              Tax Report Generator
            </h4>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-orange-950 text-orange-400 border border-orange-800/60">
              PMK-68
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Laporan pajak tahunan + ekspor PDF
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasData && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={exportPDF}
              className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-orange-600 to-amber-600 text-white text-[10px] font-bold flex items-center gap-1 shadow-lg shadow-orange-500/20"
            >
              <Download className="w-3 h-3" /> Export PDF
            </motion.button>
          )}
          <button
            onClick={() => fetchReport(year)}
            disabled={loading}
            aria-label="Refresh tax report"
            className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-950/80 hover:border-slate-700 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Year selector */}
      <div className="flex items-center gap-1.5 mb-4">
        <Calendar className="w-3 h-3 text-slate-500" />
        {YEAR_OPTIONS.map((y) => (
          <motion.button
            key={y}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setYear(y)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition-all cursor-pointer ${
              year === y
                ? "bg-orange-600 text-white shadow-lg shadow-orange-500/20"
                : "bg-slate-950/40 border border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {y}
          </motion.button>
        ))}
      </div>

      {error ? (
        <div className="bg-red-950/40 border border-red-500/40 rounded-lg p-3">
          <p className="text-[10px] text-red-300 font-mono flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> {error}
          </p>
        </div>
      ) : report ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <SummaryCard
              label="Proceeds"
              value={formatUSD(report.totalProceedsUsd)}
              icon={<Coins className="w-3 h-3" />}
              color="#3b82f6"
            />
            <SummaryCard
              label="Cost Basis"
              value={formatUSD(report.totalCostBasisUsd)}
              icon={<Receipt className="w-3 h-3" />}
              color="#a78bfa"
            />
            <SummaryCard
              label="Realized G/L"
              value={`${report.realizedGainLossUsd >= 0 ? "+" : ""}${formatUSD(report.realizedGainLossUsd)}`}
              icon={report.realizedGainLossUsd >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              color={report.realizedGainLossUsd >= 0 ? "#22c55e" : "#ef4444"}
            />
            <SummaryCard
              label="PMK-68 Tax"
              value={report.pmk68TaxIdr !== null && report.pmk68TaxIdr !== undefined ? formatIDR(report.pmk68TaxIdr) : "kurs tidak tersedia"}
              icon={<Receipt className="w-3 h-3" />}
              color="#f97316"
            />
          </div>

          {/* Transaction stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5 text-center">
              <p className="text-[9px] uppercase font-bold text-slate-500">Buy Tx</p>
              <p className="text-lg font-black font-mono text-emerald-400">{report.buyCount}</p>
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5 text-center">
              <p className="text-[9px] uppercase font-bold text-slate-500">Sell Tx</p>
              <p className="text-lg font-black font-mono text-red-400">{report.sellCount}</p>
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-2.5 text-center">
              <p className="text-[9px] uppercase font-bold text-slate-500">Total Tx</p>
              <p className="text-lg font-black font-mono text-slate-200">{report.transactionCount}</p>
            </div>
          </div>

          {/* Per-symbol table */}
          {hasData && report.perSymbol.length > 0 ? (
            <div className="mb-3">
              <p className="text-[9px] uppercase font-bold text-slate-500 mb-2">Rincian Per Aset</p>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left py-1.5 px-1 text-slate-500 uppercase">Symbol</th>
                      <th className="text-right py-1.5 px-1 text-slate-500">Buy</th>
                      <th className="text-right py-1.5 px-1 text-slate-500">Sell</th>
                      <th className="text-right py-1.5 px-1 text-slate-500">Proceeds</th>
                      <th className="text-right py-1.5 px-1 text-slate-500">Cost</th>
                      <th className="text-right py-1.5 px-1 text-slate-500">G/L</th>
                      <th className="text-right py-1.5 px-1 text-slate-500">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {report.perSymbol.map((row, idx) => (
                        <motion.tr
                          key={row.symbol}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.03 }}
                          className="border-b border-slate-800/60 hover:bg-slate-950/40"
                        >
                          <td className="py-1.5 px-1 font-bold text-slate-200">{row.symbol}</td>
                          <td className="py-1.5 px-1 text-right text-emerald-400">{row.buyCount}</td>
                          <td className="py-1.5 px-1 text-right text-red-400">{row.sellCount}</td>
                          <td className="py-1.5 px-1 text-right text-blue-300">{formatUSD(row.proceedsUsd)}</td>
                          <td className="py-1.5 px-1 text-right text-violet-300">{formatUSD(row.costBasisUsd)}</td>
                          <td className="py-1.5 px-1 text-right font-bold" style={{ color: row.gainLossUsd >= 0 ? "#22c55e" : "#ef4444" }}>
                            {row.gainLossUsd >= 0 ? "+" : ""}{formatUSD(row.gainLossUsd)}
                          </td>
                          <td className="py-1.5 px-1 text-right text-slate-400">{row.gainLossPct.toFixed(1)}%</td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Summary message */}
          <div className="bg-orange-950/20 border border-orange-800/30 rounded-lg p-2.5 mb-2">
            <p className="text-[10px] text-orange-200 leading-relaxed flex items-start gap-1.5">
              {report.realizedGainLossUsd >= 0 ? (
                <CheckCircle2 className="w-2.5 h-2.5 mt-0.5 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0 text-amber-400" />
              )}
              {report.summary}
            </p>
          </div>

          {/* Footer */}
          <div className="text-[9px] text-slate-500 font-mono flex items-center justify-between border-t border-slate-800/60 pt-2">
            <span>PMK-68 Rate: {(report.pmk68TaxRate * 100).toFixed(1)}% • USD/IDR: 15.800</span>
            <span>{new Date(report.generatedAt).toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </>
      ) : (
        <div className="text-center py-6 text-slate-500">
          <FileText className={`w-7 h-7 mx-auto mb-2 ${loading ? "animate-spin" : "opacity-40"}`} />
          <p className="text-xs">{loading ? "Membuat laporan..." : "Tidak ada data"}</p>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(249,115,22,0.3); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(249,115,22,0.5); }
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
