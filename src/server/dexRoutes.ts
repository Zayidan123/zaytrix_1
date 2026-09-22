// =============================================================================
// dexRoutes.ts — QA10-C (Direksi C Roadmap): DEX Radar — data pasar DEX REAL
// dari DEX Screener public API (https://api.dexscreener.com, TANPA API key).
// Endpoint publik read-only (seperti /api/assets — tanpa requireAuth, tanpa
// PII): GET /api/dex/pairs (top pairs) + GET /api/dex/search?q=.
//
// KEBIJAKAN INTEGRITAS DATA (WAJIB, konsisten app): upstream gagal/timeout →
// 503 {success:false, source:"offline"} — TIDAK PERNAH memfabrikasi pair.
// Cache server-side yang masih segar (< 5 menit) boleh dilayani saat upstream
// gagal, dengan badge jujur source:"dexscreener-stale" + fetchedAt ASLI.
// =============================================================================

import type { Express } from "express";
import { fetchWithTimeout } from "./httpUtils";
import { createLogger } from "./logger";

const log = createLogger("dexRoutes");

const DEX_BASE = "https://api.dexscreener.com";

// Bentuk pair hasil normalisasi — field numerik null tetap null JUJUR
// (DEX Screener memang tidak selalu menyediakan fdv/marketCap/boosts/
// pairCreatedAt pada setiap pair; null = "tidak diketahui", bukan 0).
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

// Koersi angka apa adanya — string dari upstream di-parse, invalid → null.
// Jangan pernah mengganti null dengan 0 (0 akan terlihat seperti data real).
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(n) ? n : null;
};

const str = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
};

// Normalisasi satu pair mentah DEX Screener → DexPair. Mengembalikan null
// bila identitas pair tidak bermakna (tanpa chainId/pairAddress) — baris
// tersebut di-skip jujur, bukan dianggap kegagalan upstream.
function normalizePair(raw: any): DexPair | null {
  if (!raw || typeof raw !== "object") return null;
  const chainId = str(raw.chainId);
  const pairAddress = str(raw.pairAddress);
  if (!chainId || !pairAddress) return null;
  const base = raw.baseToken;
  const vol = raw.volume;
  const chg = raw.priceChange;
  return {
    chainId,
    dexId: str(raw.dexId) || "unknown",
    pairAddress,
    url: str(raw.url) || `https://dexscreener.com/${chainId}/${pairAddress}`,
    baseToken: {
      address: str(base?.address),
      symbol: str(base?.symbol) || "?",
      name: str(base?.name)
    },
    quoteToken: { symbol: str(raw.quoteToken?.symbol) || "?" },
    priceUsd: num(raw.priceUsd),
    liquidityUsd: num(raw.liquidity?.usd),
    volume: {
      m5: num(vol?.m5),
      h1: num(vol?.h1),
      h6: num(vol?.h6),
      h24: num(vol?.h24)
    },
    priceChange: {
      m5: num(chg?.m5),
      h1: num(chg?.h1),
      h6: num(chg?.h6),
      h24: num(chg?.h24)
    },
    fdv: num(raw.fdv),
    marketCap: num(raw.marketCap),
    pairCreatedAt: num(raw.pairCreatedAt),
    boosts: { active: num(raw.boosts?.active) }
  };
}

// Urutkan likuiditas menurun; pair tanpa likuiditas diletakkan paling bawah.
const byLiquidityDesc = (a: DexPair, b: DexPair): number =>
  (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1);

export function registerDexRoutes(app: Express): void {

// ---------------------------------------------------------------------------
// Cache server-side (register-scoped seperti marketRoutes, dipanggil 1×).
// - /api/dex/pairs  : TTL 60 dtk (entry tunggal).
// - /api/dex/search : TTL 30 dtk PER-q (Map sederhana + timestamp, prune >50
//   entri — pola cache onchainStore).
// Jendela stale jujur: saat upstream gagal, cache berumur < 5 menit masih
// boleh dilayani dengan badge "dexscreener-stale" + fetchedAt asli.
// ---------------------------------------------------------------------------
interface DexCacheEntry { pairs: DexPair[]; fetchedAt: number }
const PAIRS_CACHE_TTL = 60 * 1000;
const SEARCH_CACHE_TTL = 30 * 1000;
const STALE_CACHE_MAX_AGE = 5 * 60 * 1000;
let pairsCache: DexCacheEntry | null = null;
const searchCache = new Map<string, DexCacheEntry>();

// Buang entri search cache termua sampai <= 50 (guard memori sederhana).
function pruneSearchCache(): void {
  while (searchCache.size > 50) {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [k, v] of searchCache) {
      if (v.fetchedAt < oldest) { oldest = v.fetchedAt; oldestKey = k; }
    }
    if (oldestKey === null) break;
    searchCache.delete(oldestKey);
  }
}

// Rate-limit ringan internal: maks 30 panggilan upstream per 60 dtk (rolling
// window). Melebihi itu → jawab dari cache walau TTL belum habis (log.warn
// sekali per episode). Melindungi kuota gratis DEX Screener dari polling
// berlebihan multi-klien.
const UPSTREAM_RATE_LIMIT = 30;
const UPSTREAM_WINDOW = 60 * 1000;
const upstreamHits: number[] = [];
let rateLimitWarned = false;
function recordUpstreamHit(now: number): void { upstreamHits.push(now); }
function upstreamRateLimited(now: number): boolean {
  while (upstreamHits.length > 0 && now - upstreamHits[0] > UPSTREAM_WINDOW) {
    upstreamHits.shift();
  }
  return upstreamHits.length > UPSTREAM_RATE_LIMIT;
}

// Payload live vs stale — perbedaan hanya pada badge source + fetchedAt
// ASLI cache (jujur, bukan waktu respons).
const livePayload = (e: DexCacheEntry) => ({
  success: true,
  source: "dexscreener-live",
  fetchedAt: new Date(e.fetchedAt).toISOString(),
  pairs: e.pairs
});
const stalePayload = (e: DexCacheEntry) => ({
  success: true,
  source: "dexscreener-stale",
  fetchedAt: new Date(e.fetchedAt).toISOString(),
  pairs: e.pairs,
  warning: "Data cache (upstream DEX Screener baru saja gagal) — fetchedAt adalah waktu pengambilan asli."
});

// Respons kegagalan upstream — 503 jujur, tanpa data fabrikasi.
const offline503 = (reason: string) => ({
  success: false,
  error: `DEX Screener tidak dapat dijangkau saat ini — data DEX tidak tersedia. ${reason}`.trim(),
  source: "offline"
});

// --- Ambil top pairs dari DEX Screener (2 tahap, JUJUR per tahap) ----------
// Tahap 1: token-profiles/latest/v1 → kumpulkan tokenAddress unik (max 60).
// Tahap 2: latest/dex/tokens/{a1,a2,...} per chunk max 25 address →
// normalisasi + dedup pairAddress → sort liquidity desc → top 40.
async function fetchTopPairsFromUpstream(): Promise<DexPair[]> {
  const now = Date.now();
  recordUpstreamHit(now);
  const profilesRes = await fetchWithTimeout(
    `${DEX_BASE}/token-profiles/latest/v1`,
    { headers: { "Accept": "application/json" } },
    6000
  );
  if (!profilesRes.ok) {
    throw new Error(`token-profiles merespons status ${profilesRes.status}`);
  }
  const profiles = await profilesRes.json() as any[];
  if (!Array.isArray(profiles)) {
    throw new Error("token-profiles shape tidak valid (bukan array)");
  }

  const addrs: string[] = [];
  const seen = new Set<string>();
  for (const p of profiles) {
    const a = typeof p?.tokenAddress === "string" ? p.tokenAddress.trim() : "";
    if (a && !seen.has(a)) {
      seen.add(a);
      addrs.push(a);
      if (addrs.length >= 60) break; // cap 60 token unik
    }
  }

  const merged = new Map<string, DexPair>(); // dedup lintas chunk via pairAddress
  for (let i = 0; i < addrs.length; i += 25) { // chunk max 25 address per call
    const chunk = addrs.slice(i, i + 25);
    recordUpstreamHit(Date.now());
    const batchRes = await fetchWithTimeout(
      `${DEX_BASE}/latest/dex/tokens/${chunk.join(",")}`,
      { headers: { "Accept": "application/json" } },
      7000
    );
    if (!batchRes.ok) {
      throw new Error(`tokens batch merespons status ${batchRes.status}`);
    }
    const data = await batchRes.json() as any;
    // "pairs": null adalah respons VALID (token tanpa pair terdaftar) —
    // skip jujur, bukan kegagalan upstream.
    if (Array.isArray(data?.pairs)) {
      for (const rp of data.pairs) {
        const np = normalizePair(rp);
        if (np && !merged.has(np.pairAddress)) merged.set(np.pairAddress, np);
      }
    }
  }

  return [...merged.values()].sort(byLiquidityDesc).slice(0, 40);
}

// --- Pencarian pair (urutan relevansi upstream dipertahankan, cap 30) -----
async function searchUpstream(q: string): Promise<DexPair[]> {
  recordUpstreamHit(Date.now());
  const res = await fetchWithTimeout(
    `${DEX_BASE}/latest/dex/search?q=${encodeURIComponent(q)}`,
    { headers: { "Accept": "application/json" } },
    6000
  );
  if (!res.ok) {
    throw new Error(`search merespons status ${res.status}`);
  }
  const data = await res.json() as any;
  if (!Array.isArray(data?.pairs)) {
    throw new Error("search shape tidak valid (pairs bukan array)");
  }
  const out: DexPair[] = [];
  const seen = new Set<string>();
  for (const rp of data.pairs) {
    const np = normalizePair(rp);
    if (np && !seen.has(np.pairAddress)) {
      seen.add(np.pairAddress);
      out.push(np);
    }
    if (out.length >= 30) break; // cap 30 pair
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET /api/dex/pairs — TOP pairs (publik, read-only, tanpa PII).
// ---------------------------------------------------------------------------
app.get("/api/dex/pairs", async (req, res) => {
  try {
    const now = Date.now();
    // 1) Cache masih segar → langsung jawab (tidak menyentuh upstream).
    if (pairsCache && now - pairsCache.fetchedAt < PAIRS_CACHE_TTL) {
      return res.json(livePayload(pairsCache));
    }

    // 2) Rate-limit internal → jawab dari cache walau TTL sudah lewat
    //    (hanya bila masih dalam jendela stale jujur < 5 menit).
    if (upstreamRateLimited(now)) {
      if (!rateLimitWarned) {
        log.warn("[DEX Radar] rate-limit internal aktif (>30 req/menit ke upstream DEX Screener) — melayani dari cache");
        rateLimitWarned = true;
      }
      if (pairsCache && now - pairsCache.fetchedAt < STALE_CACHE_MAX_AGE) {
        return res.json(stalePayload(pairsCache));
      }
      return res.status(503).json({
        success: false,
        error: "Terlalu banyak permintaan DEX Radar dalam satu menit — mohon tunggu sebentar dan coba lagi.",
        source: "offline"
      });
    }
    rateLimitWarned = false;

    // 3) Ambil live dari upstream.
    try {
      const pairs = await fetchTopPairsFromUpstream();
      pairsCache = { pairs, fetchedAt: Date.now() };
      return res.json(livePayload(pairsCache));
    } catch (err: any) {
      // KEGAGALAN JUJUR: cache < 5 menit boleh dilayani dengan badge stale;
      // selain itu 503 — TIDAK PERNAH memfabrikasi pair.
      log.info("[DEX Radar] upstream pairs gagal (dilayani", pairsCache ? "cache stale" : "503 jujur", "):", err?.message);
      if (pairsCache && Date.now() - pairsCache.fetchedAt < STALE_CACHE_MAX_AGE) {
        return res.json(stalePayload(pairsCache));
      }
      return res.status(503).json(offline503("Silakan coba lagi beberapa saat."));
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "Gagal memproses permintaan. Silakan coba lagi nanti." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/dex/search?q= — pencarian pair DEX Screener (publik, read-only).
// q disanitasi: trim, buang karakter kontrol, clamp 1-40 karakter.
// ---------------------------------------------------------------------------
app.get("/api/dex/search", async (req, res) => {
  try {
    const raw = typeof req.query.q === "string" ? req.query.q : "";
    // Escape karakter kontrol (0x00-0x1F, 0x7F) lalu trim + clamp 40 char.
    const q = raw.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 40);
    if (!q) {
      return res.status(400).json({
        success: false,
        error: "Parameter q wajib diisi (1-40 karakter).",
        source: "offline"
      });
    }

    const now = Date.now();
    const cached = searchCache.get(q);
    // 1) Cache per-q masih segar → langsung jawab.
    if (cached && now - cached.fetchedAt < SEARCH_CACHE_TTL) {
      return res.json(livePayload(cached));
    }

    // 2) Rate-limit internal (guard sama dengan /api/dex/pairs).
    if (upstreamRateLimited(now)) {
      if (!rateLimitWarned) {
        log.warn("[DEX Radar] rate-limit internal aktif (>30 req/menit ke upstream DEX Screener) — melayani dari cache");
        rateLimitWarned = true;
      }
      if (cached && now - cached.fetchedAt < STALE_CACHE_MAX_AGE) {
        return res.json(stalePayload(cached));
      }
      return res.status(503).json({
        success: false,
        error: "Terlalu banyak permintaan DEX Radar dalam satu menit — mohon tunggu sebentar dan coba lagi.",
        source: "offline"
      });
    }
    rateLimitWarned = false;

    // 3) Ambil live dari upstream.
    try {
      const pairs = await searchUpstream(q);
      const entry: DexCacheEntry = { pairs, fetchedAt: Date.now() };
      searchCache.set(q, entry);
      pruneSearchCache();
      return res.json(livePayload(entry));
    } catch (err: any) {
      // KEGAGALAN JUJUR — sama seperti /api/dex/pairs, tanpa fabrikasi.
      log.info(`[DEX Radar] upstream search "${q}" gagal (dilayani`, cached ? "cache stale" : "503 jujur", "):", err?.message);
      if (cached && Date.now() - cached.fetchedAt < STALE_CACHE_MAX_AGE) {
        return res.json(stalePayload(cached));
      }
      return res.status(503).json(offline503("Silakan coba lagi beberapa saat."));
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "Gagal memproses permintaan. Silakan coba lagi nanti." });
  }
});

} // end registerDexRoutes
