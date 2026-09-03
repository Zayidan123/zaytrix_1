import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Radar,
  Search,
  RefreshCw,
  ExternalLink,
  X,
  AlertTriangle
} from "lucide-react";

// =============================================================================
// DexRadar.tsx — QA10-C (Direksi C Roadmap): DEX Radar — pasangan DEX real
// dari DEX Screener (lewat proxy server /api/dex/pairs & /api/dex/search).
// Konvensi visual mengikuti OnChainData/CoinsRankings: latar gelap zinc-950,
// rounded-xl + border zinc-800/50, angka font-mono, emerald naik / rose
// turun, badge uppercase kecil. TANPA warna blue/indigo.
//
// KEBIJAKAN INTEGRITAS DATA: chip status jujur dari field `source` payload
// server ("dexscreener-live" → LIVE, "dexscreener-stale" → STALE, selain itu
// → OFFLINE). Field null ditampilkan apa adanya ("—"/"N/A"), tidak pernah
// difabrikasi. Gagal total tanpa snapshot → kartu offline + tombol coba lagi.
// =============================================================================

// Bentuk pair hasil normalisasi server (dexRoutes.ts) — numerik nullable
// JUJUR (null = DEX Screener tidak menyediakan nilai tsb).
interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  url: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { symbol: string };
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  priceChange: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  fdv: number | null;
  marketCap: number | null;
  pairCreatedAt: number | null;
  boosts: { active: number | null };
}

// --- Formatter null-safe -----------------------------------------------------
// Harga DEX sangat bervariasi ($100K s/d $0.0000001) — desimal adaptif,
// null → "N/A" (jangan pernah fabrikasi angka).
const fmtPrice = (p: number | null): string => {
  if (p == null) return "N/A";
  if (p === 0) return "$0";
  if (p >= 1000) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.001) return `$${p.toFixed(4)}`;
  // harga mikro: 8 desimal, buang trailing nol
  return `$${p.toFixed(8).replace(/0+$/, "")}`;
};

// Volume/likuiditas compact ($K/$M/$B) — pola formatUsd OnChainData.
const fmtCompactUsd = (v: number | null): string => {
  if (v == null) return "N/A";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};

// Persentase perubahan — null → "—" (honest empty, bukan 0%).
const fmtPct = (v: number | null): string =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

// Badge chain kecil — warna netral zinc/teal saja, label chain apa adanya
// lowercase (eth/base/solana/bsc/arb/…); chain tak dikenal → zinc netral.
const CHAIN_BADGE: Record<string, string> = {
  eth: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  ethereum: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  base: "bg-teal-500/10 text-teal-300 border-teal-500/30",
  solana: "bg-teal-500/10 text-teal-300 border-teal-500/30",
  bsc: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  arb: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  arbitrum: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30"
};

export default function DexRadar() {
  // null = belum ada snapshot sama sekali (menggerakkan skeleton awal).
  const [pairs, setPairs] = useState<DexPair[] | null>(null);
  const [source, setSource] = useState<string>("");
  const [fetchedAt, setFetchedAt] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null); // null = mode top pairs
  const [busy, setBusy] = useState<boolean>(false);   // aksi manual (cari/refresh) in-flight
  const [error, setError] = useState<string>("");     // pesan kegagalan terakhir (jujur)

  // Ref mode aktif supaya interval auto-refresh tidak membaca state basi.
  const activeQueryRef = useRef<string | null>(null);
  useEffect(() => {
    activeQueryRef.current = activeQuery;
  }, [activeQuery]);

  // Ambil data dari proxy server (relative path; credentials include agar
  // konsisten dengan fetch app lainnya — endpoint ini publik, tanpa PII).
  // q === null → top pairs; q string → pencarian (encodeURIComponent).
  // silent=true dipakai auto-refresh background (tanpa skeleton/spinner).
  const fetchData = useCallback(async (q: string | null, silent: boolean) => {
    if (!silent) setBusy(true);
    try {
      const url = q
        ? `/api/dex/search?q=${encodeURIComponent(q)}`
        : "/api/dex/pairs";
      const res = await fetch(url, { credentials: "include" });
      const payload = await res.json().catch(() => null as any);
      if (payload && payload.success === true && Array.isArray(payload.pairs)) {
        // SUKSES — snapshot baru (live atau stale-badge, keduanya real).
        setPairs(payload.pairs as DexPair[]);
        setSource(typeof payload.source === "string" ? payload.source : "");
        setFetchedAt(typeof payload.fetchedAt === "string" ? payload.fetchedAt : "");
        setError("");
      } else {
        // GAGAL jujur — 503/400 dari server. Snapshot real lama TETAP
        // ditampilkan (stale-but-real beats blank, pola Whale Radar) + chip
        // source diubah jadi "offline" sesuai payload server; tanpa snapshot
        // → kartu offline penuh dengan tombol coba lagi.
        const msg =
          (payload && typeof payload.error === "string" && payload.error) ||
          "Data DEX tidak tersedia saat ini.";
        setError(msg);
        setSource(
          payload && typeof payload.source === "string" && payload.source
            ? payload.source
            : "offline"
        );
      }
    } catch (e: any) {
      setError(e?.message || "Gagal menghubungi server DEX Radar.");
      setSource("offline");
    } finally {
      if (!silent) setBusy(false);
    }
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return; // kosong → abaikan (server juga menolak q kosong)
    setActiveQuery(q);
    fetchData(q, false);
  };

  const clearSearch = () => {
    setQuery("");
    setActiveQuery(null);
    fetchData(null, false);
  };

  const retry = () => fetchData(activeQueryRef.current, false);

  // Initial fetch + auto-refresh 60 dtk HANYA saat tab terlihat (guard
  // document.visibilityState — tab background tidak memukul upstream).
  // Kembali terlihat → refresh langsung (silent) agar data tidak basi.
  useEffect(() => {
    fetchData(null, false);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchData(activeQueryRef.current, true);
      }
    }, 60000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchData(activeQueryRef.current, true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchData]);

  // --- Chip status jujur (dari field source payload server) ---------------
  // 4 keadaan: MEMUAT (fetch pertama), LIVE (dexscreener-live), STALE
  // (dexscreener-stale — cache <5 menit saat upstream gagal), OFFLINE.
  const memuat = pairs === null && !error;
  const isLive = source === "dexscreener-live";
  const isStale = source === "dexscreener-stale";
  const chipCls = memuat
    ? "bg-zinc-500/10 border-zinc-600/40 text-zinc-400"
    : isLive
      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
      : isStale
        ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
        : "bg-rose-500/10 border-rose-500/30 text-rose-300";
  const chipLabel = memuat
    ? "MEMUAT…"
    : isLive
      ? "LIVE · DEX SCREENER"
      : isStale
        ? "STALE"
        : "OFFLINE";
  const chipTip = memuat
    ? "Mengambil snapshot pasangan DEX pertama dari DEX Screener…"
    : isLive
      ? "Data real-time dari DEX Screener public API"
      : isStale
        ? "Cache segar (usia < 5 menit) — upstream DEX Screener baru saja gagal, fetchedAt adalah waktu asli"
        : "DEX Screener tidak dapat dijangkau — tidak ada data palsu yang ditampilkan";
  const chipDot = memuat
    ? "bg-zinc-400 animate-pulse"
    : isLive
      ? "bg-emerald-400 animate-pulse"
      : isStale
        ? "bg-amber-400"
        : "bg-rose-400";

  return (
    <section
      aria-label="DEX Radar — data pasangan DEX real dari DEX Screener"
      className="bg-zinc-950/60 border border-zinc-800/50 rounded-xl shadow-md overflow-hidden"
    >
      {/* Header — judul + chip status jujur + pencarian + refresh manual */}
      <div className="p-4 border-b border-zinc-800/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 shrink-0">
            <Radar className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
              DEX Radar — Pasangan Likuid
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase font-mono border flex items-center gap-1.5 ${chipCls}`}
                title={chipTip}
                role="status"
                aria-label={`Status DEX Radar: ${chipLabel}`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${chipDot}`} aria-hidden="true" />
                {chipLabel}
              </span>
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Data pasar DEX real dari DEX Screener (publik, tanpa API key). Auto-refresh 60 detik saat tab terlihat.
            </p>
          </div>
        </div>

        {/* Pencarian — Enter juga submit lewat <form onSubmit> */}
        <form
          role="search"
          onSubmit={submitSearch}
          className="flex items-center gap-2 w-full lg:w-auto"
        >
          <label htmlFor="dex-radar-search" className="sr-only">
            Cari pasangan DEX (simbol, nama token, atau alamat)
          </label>
          <input
            id="dex-radar-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari token / pair DEX…"
            maxLength={40}
            autoComplete="off"
            className="flex-1 lg:w-56 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 font-mono focus:outline-none focus:border-teal-500/50 transition-colors"
          />
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-white text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Search className="w-3.5 h-3.5" aria-hidden="true" />
            Cari
          </button>
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            title="Muat ulang data DEX"
            aria-label="Muat ulang data DEX Radar"
            className="flex items-center justify-center w-9 h-9 p-0 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </form>
      </div>

      {/* Konteks pencarian aktif + tombol kembali ke top pairs */}
      {activeQuery && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-teal-500/5 border-b border-zinc-800/50">
          <span className="text-[11px] font-mono text-teal-300 truncate">
            HASIL PENCARIAN: &quot;{activeQuery}&quot; · {pairs?.length ?? 0} pair
          </span>
          <button
            type="button"
            onClick={clearSearch}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 text-[10px] font-mono uppercase tracking-wider transition-colors shrink-0"
          >
            <X className="w-3 h-3" aria-hidden="true" />
            Top Pairs
          </button>
        </div>
      )}

      {/* Banner degradasi jujur — refresh terakhir gagal TAPI snapshot real
          sebelumnya masih tampil (stale-but-real, pola Whale Radar QA8-A). */}
      {pairs !== null && error && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 m-4 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10">
          <p className="text-[11px] text-amber-300 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
            Refresh terakhir gagal: {error} Snapshot real sebelumnya tetap ditampilkan.
          </p>
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 shrink-0 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
            Coba Lagi
          </button>
        </div>
      )}

      {/* Loading skeleton — fetch pertama (cold start), mengikuti pola
          CoinsRankings; TIDAK ada seed data palsu yang ditampilkan. */}
      {pairs === null && !error && (
        <div className="p-4 space-y-3" role="status" aria-label="Memuat data DEX">
          <div className="flex items-center gap-2 border-b border-zinc-800/50 pb-3">
            <RefreshCw className="w-4 h-4 text-teal-400 animate-spin" aria-hidden="true" />
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-zinc-400">
              Memuat data live dari DEX Screener…
            </span>
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3 border-b border-zinc-800/40">
              <div className="flex-1 space-y-2">
                <div className="h-3 w-28 bg-zinc-800/60 rounded animate-pulse" />
                <div className="h-2 w-20 bg-zinc-800/40 rounded animate-pulse" />
              </div>
              <div className="h-3 w-12 bg-zinc-800/40 rounded animate-pulse hidden sm:block" />
              <div className="h-3 w-16 bg-zinc-800/60 rounded animate-pulse" />
              <div className="h-3 w-16 bg-zinc-800/40 rounded animate-pulse hidden md:block" />
              <div className="h-3 w-14 bg-zinc-800/60 rounded animate-pulse" />
              <div className="w-6 h-3 bg-zinc-800/40 rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* OFFLINE penuh — API gagal total dan TIDAK ada snapshot real yang
          bisa ditampilkan (tidak pernah ada data fabrikasi). */}
      {pairs === null && error && (
        <div className="p-10 text-center">
          <AlertTriangle className="w-10 h-10 text-rose-500/60 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm font-bold text-rose-400">OFFLINE — DEX Screener Tidak Dapat Dijangkau</p>
          <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">{error}</p>
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            className="mt-4 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-bold cursor-pointer transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
            {busy ? "Mencoba ulang…" : "Coba Lagi"}
          </button>
        </div>
      )}

      {/* Empty state jujur — upstream menjawab tapi 0 pair (bukan error). */}
      {pairs !== null && !error && pairs.length === 0 && (
        <div className="p-10 text-center text-zinc-500">
          <Radar className="w-8 h-8 text-zinc-700 mx-auto mb-2" aria-hidden="true" />
          <p className="text-xs">
            Tidak ada pair DEX yang cocok saat ini
            {activeQuery ? ` untuk pencarian “${activeQuery}”` : ""} — coba kata kunci lain.
          </p>
        </div>
      )}

      {/* Tabel top pairs — max-h-96 + overflow-y-auto (custom scrollbar
          global app di index.css otomatis berlaku, konsisten OnChainData). */}
      {pairs !== null && pairs.length > 0 && (
        <div
          className="max-h-96 overflow-y-auto overflow-x-auto"
          role="region"
          aria-label="Tabel pasangan DEX"
        >
          <table className="w-full text-xs">
            <caption className="sr-only">
              Tabel pasangan DEX teratas dari DEX Screener: pasangan token, chain, DEX,
              harga USD, volume 24 jam, likuiditas USD, perubahan harga 24 jam dan 1 jam,
              serta tautan ke halaman pair di DEX Screener.
            </caption>
            <thead className="sticky top-0 z-10">
              <tr className="bg-zinc-950 border-b border-zinc-800/50 text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider">
                <th scope="col" className="text-left py-2.5 px-4">Pasangan</th>
                <th scope="col" className="text-left py-2.5 px-3">Chain</th>
                <th scope="col" className="text-left py-2.5 px-3 hidden sm:table-cell">DEX</th>
                <th scope="col" className="text-right py-2.5 px-3">Harga</th>
                <th scope="col" className="text-right py-2.5 px-3 hidden md:table-cell">Vol 24j</th>
                <th scope="col" className="text-right py-2.5 px-3 hidden sm:table-cell">Likuiditas</th>
                <th scope="col" className="text-right py-2.5 px-3">Δ24j</th>
                <th scope="col" className="text-right py-2.5 px-3 hidden lg:table-cell">Δ1j</th>
                <th scope="col" className="text-right py-2.5 px-3">Pair</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => {
                const chg24 = p.priceChange.h24;
                const chg1 = p.priceChange.h1;
                const chainKey = p.chainId.toLowerCase();
                return (
                  <tr
                    key={`${p.chainId}:${p.pairAddress}`}
                    className="border-b border-zinc-800/40 hover:bg-zinc-900/60 transition-colors"
                  >
                    {/* Pasangan BASE/QUOTE + nama panjang via tooltip */}
                    <td className="py-2.5 px-4">
                      <span
                        className="font-mono font-bold text-zinc-100"
                        title={`${p.baseToken.name || p.baseToken.symbol} / ${p.quoteToken.symbol} · ${p.baseToken.address}`}
                      >
                        {p.baseToken.symbol}
                        <span className="text-zinc-600">/</span>
                        {p.quoteToken.symbol}
                      </span>
                      {p.baseToken.name && (
                        <span className="block text-[10px] text-zinc-500 truncate max-w-[180px]">
                          {p.baseToken.name}
                        </span>
                      )}
                    </td>
                    {/* Chain apa adanya (lowercase), warna netral zinc/teal */}
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono border lowercase ${CHAIN_BADGE[chainKey] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-700/60"}`}
                        title={`Chain: ${p.chainId}`}
                      >
                        {p.chainId}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 hidden sm:table-cell text-zinc-400 font-mono">
                      {p.dexId}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-200">
                      {fmtPrice(p.priceUsd)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-400 hidden md:table-cell">
                      {fmtCompactUsd(p.volume.h24)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-300 hidden sm:table-cell">
                      {fmtCompactUsd(p.liquidityUsd)}
                    </td>
                    {/* Δ warna: emerald naik, rose turun, "—" jujur saat null */}
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                        chg24 == null ? "text-zinc-600" : chg24 >= 0 ? "text-emerald-400" : "text-rose-500"
                      }`}
                    >
                      {fmtPct(chg24)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold hidden lg:table-cell ${
                        chg1 == null ? "text-zinc-600" : chg1 >= 0 ? "text-emerald-400" : "text-rose-500"
                      }`}
                    >
                      {fmtPct(chg1)}
                    </td>
                    {/* Tautan eksternal ↗ — tab baru, noopener noreferrer */}
                    <td className="py-2.5 px-3 text-right">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Buka pair ${p.baseToken.symbol}/${p.quoteToken.symbol} di ${p.dexId} (${p.chainId}) pada DEX Screener`
                        }
                        title={`Buka ${p.baseToken.symbol}/${p.quoteToken.symbol} di DEX Screener`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-teal-300 hover:bg-teal-500/10 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer — provenance jujur: sumber + waktu pengambilan ASLI */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-zinc-800/50 text-[10px] font-mono text-zinc-500">
        <span>
          {pairs?.length ?? 0} pair · src: {source || "—"}
          {source === "dexscreener-stale" && " (cache)"}
        </span>
        <span>
          fetched:{" "}
          {fetchedAt
            ? new Date(fetchedAt).toLocaleTimeString("id-ID", { hour12: false })
            : "—"}
          {fetchedAt && ` · ${new Date(fetchedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}`}
        </span>
      </div>
    </section>
  );
}
