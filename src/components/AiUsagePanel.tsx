import React, { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import {
  Gauge,
  RefreshCw,
  Coins,
  Zap,
  Clock,
  TrendingUp,
  AlertTriangle,
  Info,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   AiUsagePanel — QA7-F2 (ronde QA #7)
   ----------------------------------------------------------------------------
   Panel operator untuk PEMAKAIAN AI (token + biaya + latensi per model /
   per endpoint). Membaca GET /api/ai/usage (requireAuth).

   Kontrak endpoint (src/server/aiRouter.ts getAIUsage):
     { success, usage: {
         windowRecords, totalCalls, totalTokens, failures, totalCostUsd,
         byModel: [{ model, calls, tokens, failures, avgLatencyMs, costUsd }],
         byEndpoint: [{ endpoint, calls, tokens, failures, avgLatencyMs, costUsd }],
         recent: [{ ts, endpoint, provider, model, tokens, latencyMs,
                    success, streamed, costUsd?, error? }],  // terbaru-dulu
         windowStart } }
     — ring buffer server-side 300 panggilan terakhir (IN-MEMORY, hilang saat
       restart — label jujur di bawah), TIDAK menyimpan isi prompt
       (privasi: hanya metadata).

   Fitur: statistik ringkas, agregat per-model (bar proporsional), tabel
   per-endpoint, 25 panggilan terakhir, auto-refresh 30 dtk, estetika
   terminal konsisten dengan Settings Hub. Semua label jujur.
   ──────────────────────────────────────────────────────────────────────────── */

interface UsageRecord {
  ts: number;
  endpoint: string;
  provider: string;
  model: string;
  tokens: number;
  latencyMs: number;
  success: boolean;
  streamed: boolean;
  costUsd?: number;
  error?: string;
}

interface UsageSummary {
  windowRecords: number;
  totalCalls: number;
  totalTokens: number;
  failures: number;
  totalCostUsd: number;
  byModel: Array<{ model: string; calls: number; tokens: number; failures: number; avgLatencyMs: number; costUsd: number }>;
  byEndpoint: Array<{ endpoint: string; calls: number; tokens: number; failures: number; avgLatencyMs: number; costUsd: number }>;
  recent: UsageRecord[];
  windowStart: number;
}

const PROVIDER_CHIP: Record<string, { label: string; chip: string }> = {
  "9router": { label: "🔥 9router", chip: "bg-amber-500/10 text-amber-300 border-amber-500/25" },
  openrouter: { label: "⚡ openrouter", chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25" },
  gemini: { label: "✦ gemini", chip: "bg-sky-500/10 text-sky-300 border-sky-500/25" },
};

function fmtCost(usd: number | undefined): string {
  if (typeof usd !== "number" || usd <= 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(3)}`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortModel(model: string): string {
  return model.split("/").pop() || model;
}

export default function AiUsagePanel() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [auto, setAuto] = useState(true);

  const fetchUsage = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/ai/usage");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.success && data.usage) {
        setUsage(data.usage as UsageSummary);
        setError(null);
      } else {
        throw new Error(data?.error || "Respons tidak valid");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setLastRefresh(Date.now());
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(fetchUsage, 30_000);
    return () => clearInterval(t);
  }, [auto, fetchUsage]);

  const maxModelTokens = Math.max(1, ...(usage?.byModel ?? []).map((m) => m.tokens));

  return (
    <div className="p-5 rounded-xl border border-slate-800 bg-[#0A0F1D]/60 space-y-4" id="ai-usage-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-violet-400" />
          <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
            Pemakaian AI (Token &amp; Biaya)
          </h3>
          <span className="text-[8px] px-1.5 py-0.5 rounded font-mono bg-violet-950/60 text-violet-300 border border-violet-800/50">
            QA7-F2
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAuto((a) => !a)}
            aria-pressed={auto}
            className={`text-[9px] font-mono px-2 py-1 rounded border transition-colors ${
              auto
                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                : "bg-slate-800/40 text-slate-400 border-slate-700"
            }`}
            title="Auto-refresh setiap 30 detik"
          >
            AUTO {auto ? "ON" : "OFF"}
          </button>
          <button
            onClick={fetchUsage}
            disabled={loading}
            aria-label="Muat ulang pemakaian AI"
            className="p-1.5 rounded border border-slate-700 bg-slate-800/40 text-slate-400 hover:text-violet-300 hover:border-violet-700/50 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[10px] font-mono">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Gagal memuat pemakaian AI: {error}
        </div>
      )}

      {!error && usage && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800">
              <div className="flex items-center gap-1.5 text-[8px] font-mono text-slate-500 uppercase">
                <Coins className="w-3 h-3 text-violet-400" /> Total Token
              </div>
              <p className="text-lg font-mono font-bold text-slate-100 tabular-nums mt-1">
                {usage.totalTokens.toLocaleString("id-ID")}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800">
              <div className="flex items-center gap-1.5 text-[8px] font-mono text-slate-500 uppercase">
                <Zap className="w-3 h-3 text-amber-400" /> Panggilan
              </div>
              <p className="text-lg font-mono font-bold text-slate-100 tabular-nums mt-1">
                {usage.totalCalls.toLocaleString("id-ID")}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800">
              <div className="flex items-center gap-1.5 text-[8px] font-mono text-slate-500 uppercase">
                <Clock className="w-3 h-3 text-sky-400" /> Estimasi Biaya
              </div>
              <p className="text-lg font-mono font-bold text-emerald-300 tabular-nums mt-1" title="Total biaya upstream dilaporkan OpenRouter (ring buffer)">
                {fmtCost(usage.totalCostUsd)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800">
              <div className="flex items-center gap-1.5 text-[8px] font-mono text-slate-500 uppercase">
                <TrendingUp className="w-3 h-3 text-rose-400" /> Kegagalan
              </div>
              <p className={`text-lg font-mono font-bold tabular-nums mt-1 ${usage.failures > 0 ? "text-rose-300" : "text-slate-100"}`}>
                {usage.failures.toLocaleString("id-ID")}
              </p>
            </div>
          </div>

          {/* By model */}
          <div className="space-y-2">
            <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">Agregat per model</p>
            {usage.byModel.length === 0 && (
              <p className="text-[10px] text-slate-500 font-mono">Belum ada panggilan AI sejak server dinyalakan.</p>
            )}
            {usage.byModel.map((m) => {
              const pct = Math.round((m.tokens / maxModelTokens) * 100);
              const ok = m.failures === 0;
              return (
                <div key={m.model} className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/70 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono text-slate-300 truncate" title={m.model}>
                      {shortModel(m.model)}
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 tabular-nums shrink-0">
                      {m.calls}× · {m.tokens.toLocaleString("id-ID")} tok · {fmtCost(m.costUsd)} · ~{m.avgLatencyMs}ms
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800/80 overflow-hidden" role="progressbar" aria-label={`Token ${shortModel(m.model)}`} aria-valuenow={pct}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      className={`h-full rounded-full ${ok ? "bg-gradient-to-r from-violet-500/70 to-fuchsia-500/70" : "bg-gradient-to-r from-rose-500/70 to-amber-500/70"}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* By endpoint */}
          {usage.byEndpoint.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">Agregat per endpoint</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {usage.byEndpoint.map((e) => (
                  <div key={e.endpoint} className="flex items-center justify-between p-2 rounded-lg bg-slate-950/40 border border-slate-800/70">
                    <span className="text-[9px] font-mono text-slate-400 truncate">{e.endpoint}</span>
                    <span className="text-[9px] font-mono text-slate-500 tabular-nums shrink-0">
                      {e.calls}× · {e.tokens.toLocaleString("id-ID")} tok{e.failures > 0 ? ` · ${e.failures} gagal` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent calls — scrollable list */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">25 panggilan terakhir</p>
              <p className="text-[8px] font-mono text-slate-600">
                jendela {usage.windowRecords}/300 · sejak {usage.windowStart ? fmtTime(usage.windowStart) : "—"}
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto custom-scrollbar-usage rounded-lg border border-slate-800/70 bg-slate-950/40 divide-y divide-slate-800/60">
              {usage.recent.length === 0 && (
                <p className="text-[10px] text-slate-500 font-mono p-3">Belum ada riwayat.</p>
              )}
              {usage.recent.map((r, i) => {
                const prov = PROVIDER_CHIP[r.provider] || { label: r.provider, chip: "bg-slate-500/10 text-slate-400 border-slate-600/30" };
                return (
                  <div key={`${r.ts}-${i}`} className="flex items-center gap-2 px-2.5 py-2 hover:bg-slate-900/40 transition-colors">
                    <span className="text-[8px] font-mono text-slate-600 tabular-nums shrink-0">{fmtTime(r.ts)}</span>
                    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${prov.chip}`}>{prov.label}</span>
                    <span className="text-[9px] font-mono text-slate-400 truncate" title={`${r.model}${r.error ? ` — ${r.error}` : ""}`}>
                      {shortModel(r.model)}
                    </span>
                    {r.streamed && (
                      <span className="text-[7px] font-mono px-1 py-px rounded bg-violet-950/60 text-violet-300 border border-violet-800/50 shrink-0" title="Panggilan streaming (SSE)">
                        STREAM
                      </span>
                    )}
                    <span className="text-[8px] font-mono text-slate-500 tabular-nums ml-auto shrink-0">
                      {r.tokens > 0 ? `${r.tokens} tok` : r.success ? "0 tok" : "gagal"} · {r.latencyMs}ms
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.success ? "bg-emerald-400/70" : "bg-rose-400/80"}`} title={r.success ? "sukses" : r.error || "gagal"} />
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[8px] text-slate-600 font-mono flex items-start gap-1.5 leading-snug">
            <Info className="w-2.5 h-2.5 shrink-0 mt-px" />
            Ring buffer in-memory {usage.windowRecords} panggilan terakhir (di-reset saat server restart) — hanya metadata, isi prompt tidak disimpan (privasi). Biaya = angka yang dilaporkan OpenRouter per panggilan (bukan estimasi).
            {lastRefresh > 0 && <> Diperbarui {fmtTime(lastRefresh)}.</>}
          </p>
        </>
      )}

      {loading && !usage && (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-[10px] font-mono">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Memuat data pemakaian…
        </div>
      )}

      <style>{`
        .custom-scrollbar-usage::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar-usage::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar-usage::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 2px; }
        .custom-scrollbar-usage::-webkit-scrollbar-thumb:hover { background: rgba(139,92,246,0.5); }
      `}</style>
    </div>
  );
}
