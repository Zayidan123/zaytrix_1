import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Terminal,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Search,
  ShieldCheck,
  Activity,
  AlertTriangle,
  Info,
  Bug,
  CircleSlash,
  Clock,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   SystemLogsPanel — QA4-F1 (ronde QA #4)
   ----------------------------------------------------------------------------
   Panel operator untuk LOG SISTEM TERSTRUKTUR (QA3-F1). Membaca
   GET /api/system/logs (requireAuth — sesi cookie otomatis terkirim).

   Kontrak endpoint (src/server/logger.ts):
     { success, total, ringCapacity,
       entries: [{ ts, level: "debug"|"info"|"warn"|"error",
                   module, msg, data?: unknown[] }] }
     — entries TERBARU-DULU, sudah ter-REDAKSI server-side
       (email → u***@, JWT/token → mask, kunci sensitif → [REDACTED])
     — ?level= mem-filter severity MINIMUM; ?limit= 1..500

   Fitur: filter level, pencarian, batas entri, auto-refresh 30 dtk
   (default ON), baris expandable (payload data JSON), statistik level,
   estetika terminal konsisten dengan Settings Hub. Semua label jujur —
   tidak ada klaim "real-time streaming": ini polling ring buffer.
   ──────────────────────────────────────────────────────────────────────────── */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  data?: unknown[];
}

interface LogsResponse {
  success: boolean;
  total: number;
  ringCapacity: number;
  entries: LogEntry[];
}

const LEVEL_CONFIG: Record<LogLevel, { label: string; chip: string; text: string; icon: React.ReactNode }> = {
  debug: {
    label: "DEBUG",
    chip: "bg-zinc-500/10 text-zinc-400 border-zinc-500/25",
    text: "text-zinc-400",
    icon: <Bug className="w-3 h-3" />,
  },
  info: {
    label: "INFO",
    chip: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    text: "text-emerald-400",
    icon: <Info className="w-3 h-3" />,
  },
  warn: {
    label: "WARN",
    chip: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    text: "text-amber-400",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  error: {
    label: "ERROR",
    chip: "bg-rose-500/10 text-rose-400 border-rose-500/25",
    text: "text-rose-400",
    icon: <CircleSlash className="w-3 h-3" />,
  },
};

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];
const AUTO_REFRESH_MS = 30_000;
const LIMIT_OPTIONS = [50, 100, 200, 500];

function formatClock(d: Date): string {
  return d.toLocaleTimeString("id-ID", { hour12: false });
}

function shortTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("id-ID", { hour12: false });
  } catch {
    return "--:--:--";
  }
}

export default function SystemLogsPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [ringCapacity, setRingCapacity] = useState<number>(500);

  /* Filter states */
  const [levelFilter, setLevelFilter] = useState<"all" | LogLevel>("all");
  const [limit, setLimit] = useState<number>(100);
  const [query, setQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (silent: boolean) => {
      try {
        if (silent) setRefreshing(true);
        else setLoading(true);
        setError(null);
        const params = new URLSearchParams({ limit: String(limit) });
        if (levelFilter !== "all") params.set("level", levelFilter);
        const res = await fetch(`/api/system/logs?${params.toString()}`);
        if (!res.ok) {
          // 401 = sesi kedaluwarsa; 429 = rate limit — tampilkan jujur.
          if (res.status === 401) throw new Error("Sesi tidak valid — silakan masuk kembali.");
          if (res.status === 429) throw new Error("Terlalu banyak permintaan — coba lagi beberapa saat.");
          throw new Error(`Server merespon dengan kode ${res.status}.`);
        }
        const json = (await res.json()) as LogsResponse;
        if (!json.success) throw new Error("Respons server tidak valid.");
        setEntries(json.entries || []);
        setRingCapacity(json.ringCapacity || 500);
        setLastUpdated(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memuat log sistem.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [levelFilter, limit]
  );

  /* Initial load + re-load on filter change */
  useEffect(() => {
    load(false);
  }, [load]);

  /* Auto-refresh (30 dtk) — polling ring buffer, BUKAN klaim streaming */
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => load(true), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  /* Client-side search (msg + module) */
  const visibleEntries = query.trim()
    ? entries.filter(
        (e) =>
          e.msg.toLowerCase().includes(query.toLowerCase()) ||
          e.module.toLowerCase().includes(query.toLowerCase())
      )
    : entries;

  const stats = LEVEL_ORDER.reduce(
    (acc, lv) => {
      acc[lv] = entries.filter((e) => e.level === lv).length;
      return acc;
    },
    {} as Record<LogLevel, number>
  );

  return (
    <div className="space-y-4" id="system-logs-panel">
      {/* ── Panel utama: terminal ─────────────────────────────────────── */}
      <div className="bg-[#0A0F1D]/60 border border-slate-800 rounded-xl overflow-hidden">
        {/* Terminal header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
            </div>
            <span className="ml-2 text-[10px] font-mono font-bold text-slate-300 flex items-center gap-1.5 truncate">
              <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              SERVER LOG — GET /api/system/logs
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {lastUpdated && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[9.5px] font-mono text-slate-500">
                <Clock className="w-3 h-3" />
                {formatClock(lastUpdated)}
              </span>
            )}
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-1 rounded border border-slate-700 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors disabled:opacity-50"
              aria-label="Muat ulang log"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              REFRESH
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-4 py-3 border-b border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Level chips */}
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setLevelFilter("all")}
                className={`text-[9.5px] font-mono font-bold px-2 py-1 rounded border transition-colors ${
                  levelFilter === "all"
                    ? "bg-slate-100/10 text-slate-100 border-slate-500/40"
                    : "bg-transparent text-slate-500 border-slate-800 hover:text-slate-300"
                }`}
              >
                SEMUA ({entries.length})
              </button>
              {LEVEL_ORDER.map((lv) => (
                <button
                  key={lv}
                  onClick={() => setLevelFilter(lv)}
                  className={`text-[9.5px] font-mono font-bold px-2 py-1 rounded border transition-colors inline-flex items-center gap-1 ${
                    levelFilter === lv
                      ? LEVEL_CONFIG[lv].chip
                      : "bg-transparent text-slate-500 border-slate-800 hover:text-slate-300"
                  }`}
                >
                  {LEVEL_CONFIG[lv].icon}
                  {LEVEL_CONFIG[lv].label} ({stats[lv]})
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="cari msg / modul…"
                  className="w-40 sm:w-48 bg-slate-950 border border-slate-800 rounded pl-7 pr-2 py-1 text-[10px] font-mono text-slate-200 placeholder:text-slate-600 outline-none focus:border-amber-500/40"
                  aria-label="Cari pesan log"
                />
              </div>
              {/* Limit */}
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono text-slate-300 outline-none focus:border-amber-500/40 cursor-pointer"
                aria-label="Jumlah entri maksimum"
              >
                {LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} entri
                  </option>
                ))}
              </select>
              {/* Auto refresh */}
              <button
                onClick={() => setAutoRefresh((v) => !v)}
                className={`flex items-center gap-1.5 text-[10px] font-mono font-bold px-2 py-1 rounded border transition-colors ${
                  autoRefresh
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-transparent text-slate-500 border-slate-800 hover:text-slate-300"
                }`}
                aria-pressed={autoRefresh}
                title="Polling otomatis tiap 30 detik"
              >
                <span className="relative flex h-2 w-2">
                  {autoRefresh && (
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      autoRefresh ? "bg-emerald-400" : "bg-slate-600"
                    }`}
                  />
                </span>
                AUTO 30s
              </button>
            </div>
          </div>

          {/* Info bar: redaksi + ring */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[9.5px] font-mono text-slate-500">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400/70" />
              Semua entri ter-redaksi server-side (rahasia → [REDACTED])
            </span>
            <span className="inline-flex items-center gap-1">
              <Activity className="w-3 h-3 text-teal-300/70" />
              Ring buffer {entries.length}/{ringCapacity} entri · poll 30 dtk (bukan streaming)
            </span>
          </div>
        </div>

        {/* Log list */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto bg-[#05070d] custom-scrollbar" role="log" aria-label="Daftar log sistem">
          {loading && (
            <div className="p-4 space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-6 rounded bg-slate-900/60 animate-pulse" style={{ width: `${70 + ((i * 13) % 25)}%` }} />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="p-4 flex items-start gap-2 text-[11px] text-rose-400 font-mono">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">Gagal memuat log sistem</p>
                <p className="text-slate-400 mt-0.5">{error}</p>
                <button
                  onClick={() => load(false)}
                  className="mt-2 text-[10px] px-2 py-1 rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 transition-colors"
                >
                  COBA LAGI
                </button>
              </div>
            </div>
          )}

          {!loading && !error && visibleEntries.length === 0 && (
            <div className="p-8 text-center">
              <Terminal className="w-6 h-6 text-slate-700 mx-auto mb-2" />
              <p className="text-[11px] font-mono text-slate-500">
                {query.trim() ? `Tidak ada entri cocok untuk "${query.trim()}".` : "Belum ada entri log pada filter ini."}
              </p>
            </div>
          )}

          {!loading && !error && visibleEntries.length > 0 && (
            <div className="divide-y divide-slate-900/80">
              {visibleEntries.map((entry, idx) => {
                const conf = LEVEL_CONFIG[entry.level] ?? LEVEL_CONFIG.info;
                const hasData = Array.isArray(entry.data) && entry.data.length > 0;
                const expanded = expandedIdx === idx;
                return (
                  <div key={`${entry.ts}-${idx}`} className="group hover:bg-slate-900/40 transition-colors">
                    <button
                      onClick={() => hasData && setExpandedIdx(expanded ? null : idx)}
                      className="w-full text-left px-3 py-1.5 flex items-start gap-2 font-mono"
                      aria-expanded={hasData ? expanded : undefined}
                      aria-label={hasData ? `${entry.level} ${entry.module}: ${entry.msg} — tampilkan detail data` : undefined}
                    >
                      <span className="shrink-0 mt-0.5 text-slate-600">
                        {hasData ? (
                          expanded ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronRight className="w-3 h-3" />
                          )
                        ) : (
                          <span className="inline-block w-3 h-3" />
                        )}
                      </span>
                      <span className="shrink-0 text-[9.5px] text-slate-500">{shortTime(entry.ts)}</span>
                      <span
                        className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border ${conf.chip}`}
                      >
                        {conf.label}
                      </span>
                      <span className="shrink-0 text-[9px] font-bold text-teal-300/80">[{entry.module}]</span>
                      <span className="text-[10.5px] text-slate-300 leading-relaxed break-all min-w-0">{entry.msg}</span>
                    </button>
                    <AnimatePresence>
                      {expanded && hasData && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden"
                        >
                          <pre className="mx-3 mb-2 p-2 rounded bg-slate-950 border border-slate-900 text-[9.5px] font-mono text-slate-400 whitespace-pre-wrap break-all max-h-40 overflow-y-auto custom-scrollbar">
                            {entry.data!
                              .map((d, i) => {
                                try {
                                  return typeof d === "string" ? d : JSON.stringify(d, null, 2);
                                } catch {
                                  return String(d);
                                }
                              })
                              .join("\n\n— argumen berikutnya —\n\n")}
                          </pre>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between gap-2">
          <p className="text-[9px] font-mono text-slate-600 truncate">
            {visibleEntries.length} entri ditampilkan · {query.trim() ? "hasil pencarian" : "terbaru-dulu"}
            {lastUpdated ? ` · diperbarui ${formatClock(lastUpdated)}` : ""}
          </p>
          <span className="text-[9px] font-mono text-emerald-500/70 shrink-0 inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
            {autoRefresh ? "AUTO-POLL AKTIF" : "MANUAL"}
          </span>
        </div>
      </div>

      {/* ── Kartu penjelasan: apa yang dilog & apa yang TIDAK ──────────── */}
      <div className="bg-[#0A0F1D]/60 border border-slate-800 rounded-xl p-4 space-y-3">
        <h3 className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Catatan Integritas Log
        </h3>
        <ul className="space-y-1.5 text-[10.5px] text-slate-400 leading-relaxed">
          <li className="flex items-start gap-2">
            <Info className="w-3 h-3 text-teal-300 mt-0.5 shrink-0" />
            <span>
              Log dihasilkan <span className="text-slate-200 font-semibold">logger terstruktur</span> (JSON-lines: ts /
              level / module / msg / data) — bukan console.log mentah.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
            <span>
              <span className="text-slate-200 font-semibold">Redaksi server-side</span> diterapkan sebelum entri masuk
              ring buffer: email → <span className="font-mono text-amber-300">u***@domain</span>, JWT/token →{" "}
              <span className="font-mono text-rose-300">[JWT]/[TOKEN]</span>, kunci sensitif (password/cookie/secret) →{" "}
              <span className="font-mono text-rose-300">[REDACTED]</span>.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Clock className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
            <span>
              Panel ini <span className="text-slate-200 font-semibold">membaca ring buffer 500 entri</span> (in-memory)
              via polling 30 detik — bukan stream WebSocket; entri hilang saat server direstart (jujur, by design).
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Bug className="w-3 h-3 text-zinc-400 mt-0.5 shrink-0" />
            <span>
              Level DEBUG hanya tampil bila server berjalan dengan LOG_LEVEL=debug (default: info di produksi, debug di
              dev).
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
