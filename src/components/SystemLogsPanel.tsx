import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { List, useDynamicRowHeight, type RowComponentProps } from "react-window";
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
  Layers,
  SlidersHorizontal,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   SystemLogsPanel — QA4-F1 (ronde QA #4) · QA8-B (virtualisasi + LOG_LEVEL)
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

   QA8-B FITUR 1 — VIRTUALISASI (react-window v2, API baru — BUKAN v1):
     • <List rowComponent rowProps rowCount rowHeight overscanCount> —
       rowComponent menerima { ariaAttributes, index, style } + rowProps.
     • Tinggi variabel (baris expandable): rowHeight menerima objek
       DynamicRowHeight dari hook useDynamicRowHeight({ defaultRowHeight, key }).
       List memasang ResizeObserver pada tiap baris yang ter-render
       (observeRowElements) → tinggi nyata terukur otomatis → cache
       diperbarui lewat setRowHeight → offset baris berikut digeser.
     • RESET cache: opsi `key` pada useDynamicRowHeight menghapus seluruh
       cache tinggi saat nilainya berubah (padanan "resetAfterIndex" v1 —
       v2 tidak punya API imperatif itu; reset per-key adalah mekanismenya).
       Key diikat ke BENTUK dataset (filter level / limit / pencarian).
       Saat polling 30 dtk menggeser indeks (entri baru masuk di depan),
       cache TIDAK direset; baris terlihat terukur ulang otomatis oleh
       ResizeObserver saat kontennya berubah → deviasi posisi scroll yang
       kecil dan sesaat mungkin terjadi (jujur: self-healing begitu baris
       ter-render; ini trade-off agar tidak ada loncatan tiap 30 detik).
     • Toggle expand: tinggi estimasi di-seed SEGERA via setRowHeight
       (44px collapsed; expanded = header + aproksimasi tinggi payload JSON
       dari panjang teks + jumlah baris) supaya offset baris di bawahnya
       kira-kira benar sebelum ResizeObserver melaporkan tinggi sebenarnya.
       Estimasi memang aproksimasi — koreksi otomatis menyusul.
     • Catatan jujur di UI: "Baris divirtualisasi — hanya area terlihat
       yang dirender".

   QA8-B FITUR 2 — TOGGLE LOG_LEVEL RUNTIME (server-side):
     • GET  /api/system/logs/level → level runtime saat ini.
     • POST /api/system/logs/level { level } → setLogLevel + entri audit
       warn (module "system") di ring buffer. CSRF double-submit ditangani
       wrapper global window.fetch di main.tsx (header X-CSRF-Token dari
       cookie zaytrix_csrf + satu retry transparan bila cookie basi) —
       pola yang sama persis dengan semua POST lain di aplikasi ini.

   Fitur asli QA4-F1 dipertahankan: filter level + count, pencarian,
   batas entri, auto-refresh 30 dtk (default ON, polling — BUKAN klaim
   streaming), baris expandable (payload JSON), statistik level, state
   loading/empty/error jujur, kartu "Catatan Integritas Log".
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

interface LevelResponse {
  success: boolean;
  level?: string;
  note?: string;
  error?: string;
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

/* Tooltip tombol toggle LOG_LEVEL (QA8-B) — penjelasan konsekuensi tiap level. */
const LEVEL_TOGGLE_TIP: Record<LogLevel, string> = {
  debug: "Semua entri dicatat (debug + info + warn + error) — paling rinci.",
  info: "Entri info/warn/error dicatat; entri debug disembunyikan (default LOG_LEVEL produksi).",
  warn: "Hanya entri warning dan error yang dicatat.",
  error: "Hanya entri error yang dicatat — paling senyap.",
};

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];
const AUTO_REFRESH_MS = 30_000;
const LIMIT_OPTIONS = [50, 100, 200, 500];

/* ── Konstanta virtualisasi (QA8-B) ───────────────────────────────────────── */
const LIST_VIEWPORT_PX = 420;   // tinggi viewport daftar (dahulu max-h-[420px])
const ROW_DEFAULT_HEIGHT = 44;  // estimasi baris collapsed (spesifikasi QA8-B)
const PRE_CLAMP_PX = 160;       // max-h-40 pada <pre> payload (scroll internal)
const EST_CHARS_PER_LINE = 110; // aproksimasi karakter per baris mono 9.5px
const EST_LINE_HEIGHT_PX = 14;  // aproksimasi tinggi baris teks 9.5px

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

function isLogLevel(v: unknown): v is LogLevel {
  return v === "debug" || v === "info" || v === "warn" || v === "error";
}

/* Format payload data untuk baris expandable — dipakai render DAN estimasi
   tinggi (satu sumber kebenaran supaya estimasi menghitung teks yang sama). */
function formatPayload(entry: LogEntry): string {
  if (!Array.isArray(entry.data) || entry.data.length === 0) return "";
  return entry.data
    .map((d) => {
      try {
        return typeof d === "string" ? d : JSON.stringify(d, null, 2);
      } catch {
        return String(d);
      }
    })
    .join("\n\n— argumen berikutnya —\n\n");
}

/* Estimasi tinggi baris (QA8-B): collapsed ~44px; expanded = header +
 * aproksimasi tinggi <pre> payload (jumlah baris eksplisit vs baris hasil
 * word-wrap, di-clamp max-h-40). Ini APROKSIMASI — ResizeObserver react-window
 * mengoreksi dengan tinggi sebenarnya begitu baris ter-render. */
function estimateRowHeight(entry: LogEntry, expanded: boolean): number {
  if (!expanded || !Array.isArray(entry.data) || entry.data.length === 0) {
    return ROW_DEFAULT_HEIGHT;
  }
  const payload = formatPayload(entry);
  const explicitLines = payload.split("\n").length;
  const wrappedLines = Math.ceil(payload.length / EST_CHARS_PER_LINE);
  const lines = Math.max(explicitLines, wrappedLines, 1);
  const preContent = 16 + lines * EST_LINE_HEIGHT_PX; // padding p-2 + tinggi baris
  const pre = Math.min(preContent, PRE_CLAMP_PX); // <pre> scroll internal di atas 160px
  return ROW_DEFAULT_HEIGHT + 8 + pre; // header + margin mb-2 + <pre>
}

/* ── Komponen baris virtual (module scope — identitas stabil supaya memo
      internal react-window tetap efektif; rowProps membawa data + state). ── */
interface LogRowProps {
  entries: LogEntry[];
  expandedIdx: number | null;
  onToggle: (index: number) => void;
}

function LogRow({ ariaAttributes, index, style, entries, expandedIdx, onToggle }: RowComponentProps<LogRowProps>) {
  const entry = entries[index];
  if (!entry) return null;
  const conf = LEVEL_CONFIG[entry.level] ?? LEVEL_CONFIG.info;
  const hasData = Array.isArray(entry.data) && entry.data.length > 0;
  const expanded = expandedIdx === index;
  const isLastRow = index === entries.length - 1;
  return (
    <div
      {...ariaAttributes}
      style={style}
      className={`group hover:bg-slate-900/40 transition-colors ${isLastRow ? "" : "border-b border-slate-900/80"}`}
    >
      <button
        onClick={() => hasData && onToggle(index)}
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
        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border ${conf.chip}`}>{conf.label}</span>
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
              {formatPayload(entry)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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

  /* QA8-B: state level log runtime server-side */
  const [serverLevel, setServerLevel] = useState<LogLevel | null>(null);
  const [levelLoading, setLevelLoading] = useState(true);
  const [postingLevel, setPostingLevel] = useState<LogLevel | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);

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

  /* QA8-B: muat level runtime saat mount (GET /api/system/logs/level) */
  const loadServerLevel = useCallback(async () => {
    setLevelLoading(true);
    setLevelError(null);
    try {
      const res = await fetch("/api/system/logs/level");
      if (!res.ok) {
        if (res.status === 401) throw new Error("Sesi tidak valid — silakan masuk kembali.");
        throw new Error(`Server merespon dengan kode ${res.status}.`);
      }
      const json = (await res.json()) as LevelResponse;
      if (!json.success || !isLogLevel(json.level)) throw new Error("Respons level server tidak valid.");
      setServerLevel(json.level);
    } catch (e) {
      setServerLevel(null);
      setLevelError(e instanceof Error ? e.message : "Gagal memuat level log server.");
    } finally {
      setLevelLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServerLevel();
  }, [loadServerLevel]);

  /* QA8-B: ubah level runtime (POST). Kalau server menolak/gagal → state
   * TIDAK berubah + pesan error inline jujur. CSRF double-submit ditangani
   * wrapper global window.fetch (main.tsx): header X-CSRF-Token otomatis
   * dari cookie zaytrix_csrf + satu retry transparan bila cookie basi —
   * pola yang sama dengan semua POST lain di aplikasi ini. */
  const changeServerLevel = useCallback(
    async (level: LogLevel) => {
      if (postingLevel !== null) return;
      setPostingLevel(level);
      setLevelError(null);
      try {
        const res = await fetch("/api/system/logs/level", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ level }),
        });
        const json = (await res.json().catch(() => null)) as LevelResponse | null;
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || `Server menolak perubahan level (kode ${res.status}).`);
        }
        // Level aktif diambil dari respons SERVER (bukan asumsi lokal) — jujur.
        setServerLevel(isLogLevel(json.level) ? json.level : level);
        // Entri audit perubahan level langsung terlihat: refresh senyap ring buffer.
        void load(true);
      } catch (e) {
        setLevelError(e instanceof Error ? e.message : "Gagal mengubah level log server.");
      } finally {
        setPostingLevel(null);
      }
    },
    [postingLevel, load]
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
  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.msg.toLowerCase().includes(q) || e.module.toLowerCase().includes(q));
  }, [entries, query]);

  /* QA8-B: cache tinggi dinamis react-window v2. Key reset diikat ke BENTUK
   * dataset (filter/limit/pencarian) — bukan tiap polling — supaya tidak
   * ada loncatan tiap 30 dtk; baris terlihat ter-ukur ulang otomatis oleh
   * ResizeObserver saat konten bergeser (deviasi kecil sesaat, diakui jujur). */
  const heightCacheKey = `${levelFilter}:${limit}:${query.trim()}`;
  const dynamicRowHeight = useDynamicRowHeight({ defaultRowHeight: ROW_DEFAULT_HEIGHT, key: heightCacheKey });

  /* Toggle expand: seed tinggi estimasi SEKARANG supaya offset baris di
   * bawahnya kira-kira benar sebelum ResizeObserver melaporkan tinggi nyata
   * (yang kemudian mengoreksi nilai estimasi ini). */
  const handleToggle = useCallback(
    (index: number) => {
      const entry = visibleEntries[index];
      if (!entry || !Array.isArray(entry.data) || entry.data.length === 0) return;
      const willExpand = expandedIdx !== index;
      dynamicRowHeight.setRowHeight(index, estimateRowHeight(entry, willExpand));
      setExpandedIdx(willExpand ? index : null);
    },
    [expandedIdx, visibleEntries, dynamicRowHeight]
  );

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

          {/* QA8-B: toggle LOG_LEVEL runtime (server-side, jujur) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-2 border-t border-slate-900/70">
            <span className="inline-flex items-center gap-1 text-[9.5px] font-mono font-bold text-slate-500">
              <SlidersHorizontal className="w-3 h-3" />
              LOG_LEVEL SERVER
            </span>
            <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Ubah level log server (berlaku runtime)">
              {LEVEL_ORDER.map((lv) => {
                const active = serverLevel === lv;
                const posting = postingLevel === lv;
                return (
                  <button
                    key={lv}
                    onClick={() => void changeServerLevel(lv)}
                    disabled={postingLevel !== null}
                    aria-pressed={active}
                    title={`${LEVEL_TOGGLE_TIP[lv]} Berlaku untuk entri baru selama proses hidup; restart mengembalikan ke LOG_LEVEL env.`}
                    className={`text-[9.5px] font-mono font-bold px-2 py-1 rounded border transition-colors inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                      active
                        ? LEVEL_CONFIG[lv].chip
                        : "bg-transparent text-slate-500 border-slate-800 hover:text-slate-300"
                    }`}
                  >
                    {LEVEL_CONFIG[lv].icon}
                    {LEVEL_CONFIG[lv].label}
                    {posting && <span aria-hidden="true">…</span>}
                  </button>
                );
              })}
              {levelLoading && (
                <span className="text-[9px] font-mono text-slate-500" role="status">
                  memuat level server…
                </span>
              )}
            </div>
            <p className="basis-full sm:basis-auto sm:ml-auto text-[9px] font-mono text-slate-500">
              Level berlaku untuk entri BARU selama proses hidup; entri lama di ring tidak diubah; restart mengembalikan
              ke LOG_LEVEL env.
            </p>
            {levelError && (
              <p className="basis-full text-[9.5px] font-mono text-rose-400 inline-flex items-center gap-2" role="alert">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span className="min-w-0 break-all">{levelError}</span>
                <button
                  onClick={() => void loadServerLevel()}
                  className="shrink-0 underline decoration-dotted hover:text-rose-300"
                >
                  muat ulang level
                </button>
              </p>
            )}
          </div>

          {/* Info bar: redaksi + ring + virtualisasi */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[9.5px] font-mono text-slate-500">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400/70" />
              Semua entri ter-redaksi server-side (rahasia → [REDACTED])
            </span>
            <span className="inline-flex items-center gap-1">
              <Activity className="w-3 h-3 text-teal-300/70" />
              Ring buffer {entries.length}/{ringCapacity} entri · poll 30 dtk (bukan streaming)
            </span>
            <span className="inline-flex items-center gap-1">
              <Layers className="w-3 h-3 text-violet-300/70" />
              Baris divirtualisasi — hanya area terlihat yang dirender
            </span>
          </div>
        </div>

        {/* Log list — react-window v2 (QA8-B): hanya baris terlihat + overscan
            yang dirender; scroll native pada elemen daftar; keyboard tetap
            natural (tab ke baris fokus → browser auto-scroll-kan ke area fokus). */}
        <div className="bg-[#05070d]">
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
            <List
              className="custom-scrollbar bg-[#05070d]"
              style={{ height: LIST_VIEWPORT_PX, maxHeight: LIST_VIEWPORT_PX }}
              defaultHeight={LIST_VIEWPORT_PX}
              rowCount={visibleEntries.length}
              rowHeight={dynamicRowHeight}
              rowComponent={LogRow}
              rowProps={{ entries: visibleEntries, expandedIdx, onToggle: handleToggle }}
              overscanCount={6}
              aria-label="Daftar log sistem"
            />
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
              Level server (LOG_LEVEL) kini dapat <span className="text-slate-200 font-semibold">diubah runtime</span>{" "}
              dari panel ini — berlaku untuk entri BARU saja; entri lama di ring tidak diubah; restart mengembalikan ke
              nilai LOG_LEVEL env (default: info di produksi, debug di dev).
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Layers className="w-3 h-3 text-violet-300 mt-0.5 shrink-0" />
            <span>
              Daftar baris <span className="text-slate-200 font-semibold">divirtualisasi</span> (react-window): hanya
              area terlihat (+ beberapa baris overscan) yang dirender — tinggi baris expandable diukur otomatis;
              estimasi awal bisa menyimpang sedikit sesaat sebelum terukur ulang.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
