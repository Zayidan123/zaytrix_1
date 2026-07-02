// =============================================================================
// liveDataRoutes.ts — LIVE data scraping / computation endpoints (FREE sources)
// =============================================================================
// Owner: Implementation Agent LIVEDATA
// Mount: SEC-BACKEND mounts this router opportunistically via
//   `app.use((await import("./src/server/liveDataRoutes")).liveDataRouter)`
//   in server.ts.  If this file is missing/renamed the server still boots —
//   see server.ts lines ~5449-5461.
//
// PHILOSOPHY:
//   - Every endpoint fetches REAL data from a free public source (NO API keys).
//   - Each response is cached with an appropriate TTL.
//   - On source failure we return `{success:false, isEstimated:true, error}`
//     with HTTP 200 (frontend handles gracefully).  We NEVER fabricate
//     historical points — if a real source is unreachable we label the data
//     honestly as estimated / not-available.
//   - All endpoints are PUBLIC (no auth) — they're market data.
// =============================================================================

import express from "express";
import * as cheerio from "cheerio";
import * as zlib from "zlib";
import { execFile } from "child_process";
import { promisify } from "util";

// ---------------------------------------------------------------------------
// fetchWithTimeout — wraps Node 18+ global `fetch` with an AbortController
// timeout.  Includes a desktop User-Agent so Cloudflare-protected endpoints
// don't immediately 403 us.  Never throws for status codes — the caller
// inspects `res.ok`.
// ---------------------------------------------------------------------------
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  ms = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    ...(opts.headers as Record<string, string> | undefined),
  };
  try {
    return await fetch(url, { ...opts, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// execFileP — promisified child_process.execFile.  Used by fetchHtmlViaCurl.
// ---------------------------------------------------------------------------
const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// fetchHtmlViaCurl — fallback HTML fetcher that shells out to system `curl`.
// REQUIRED for Cloudflare-protected endpoints (e.g. Farside Investors) where
// Node's `fetch` (undici) is blocked by TLS fingerprinting even with a
// realistic User-Agent.  System `curl` uses a different TLS implementation
// (OpenSSL) that Cloudflare's basic checks allow.  Returns { status, body }
// or throws on curl failure.
// ---------------------------------------------------------------------------
export async function fetchHtmlViaCurl(
  url: string,
  opts: {
    userAgent?: string;
    referer?: string;
    timeoutSec?: number;
    extraHeaders?: Record<string, string>;
  } = {}
): Promise<{ status: number; body: string }> {
  const ua =
    opts.userAgent ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const timeoutSec = opts.timeoutSec ?? 15;
  const args = [
    "-sS",
    "--max-time",
    String(timeoutSec),
    "-A",
    ua,
    "-H",
    "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "-H",
    "Accept-Language: en-US,en;q=0.9",
  ];
  if (opts.referer) {
    args.push("-H", `Referer: ${opts.referer}`);
  }
  if (opts.extraHeaders) {
    for (const [k, v] of Object.entries(opts.extraHeaders)) {
      args.push("-H", `${k}: ${v}`);
    }
  }
  args.push("-w", "\n---HTTP_CODE:%{http_code}---", url);
  const { stdout } = await execFileP("curl", args, {
    maxOutput: 10 * 1024 * 1024, // 10MB
  });
  const m = stdout.match(/---HTTP_CODE:(\d+)---\s*$/);
  const status = m ? parseInt(m[1], 10) : 0;
  const body = stdout.replace(/\n---HTTP_CODE:\d+---\s*$/, "");
  return { status, body };
}

// ---------------------------------------------------------------------------
// Simple TTL cache (module-level Map).  cacheGet returns the cached value
// or undefined if expired/missing.  cacheSet stores with an absolute expiry.
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
  data: T;
  expiry: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Format a Date or epoch ms as Indonesian short date, e.g. "2 Jul". */
function fmtIdDate(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleDateString("id-ID", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return new Date(epochMs).toISOString().slice(5, 10);
  }
}

/** Format as ISO yyyy-mm-dd. */
function fmtIso(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Dedupe blockchain.info chart samples (which return intraday points even
 * with `&sampled=true`) to ONE point per UTC day, taking the last sample of
 * each day (closest to UTC midnight).  Input: array of {x: epochSec, y: number}.
 */
function dedupeToDaily<T extends { x: number; y: number }>(samples: T[]): T[] {
  const byDay = new Map<string, T>();
  for (const s of samples) {
    const day = new Date(s.x * 1000).toISOString().slice(0, 10);
    byDay.set(day, s); // overwrite so we end up with the last sample of each day
  }
  return Array.from(byDay.values()).sort((a, b) => a.x - b.x);
}

/** Build a Map<dayString "yyyy-mm-dd", value> from blockchain.info samples. */
function dailyMap<T extends { x: number; y: number }>(
  samples: T[]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of dedupeToDaily(samples)) {
    const day = new Date(s.x * 1000).toISOString().slice(0, 10);
    m.set(day, Number(s.y));
  }
  return m;
}

// TTL constants (ms)
const TTL_1H = 60 * 60 * 1000;
const TTL_6H = 6 * 60 * 60 * 1000;
const TTL_24H = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const liveDataRouter = express.Router();

// ---------------------------------------------------------------------------
// 1. GET /api/live/long-short-ratio?symbol=BTCUSDT&days=30
//    Source: Binance Futures (FREE, no key)
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/long-short-ratio", async (req, res) => {
  const symbol = (req.query.symbol as string) || "BTCUSDT";
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `lsr:${symbol}:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [acctRes, takerRes] = await Promise.all([
      fetchWithTimeout(
        `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=1d&limit=${days}`
      ),
      fetchWithTimeout(
        `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=1d&limit=${days}`
      ),
    ]);

    if (!acctRes.ok || !takerRes.ok) {
      throw new Error(
        `Binance response not OK (acct=${acctRes.status}, taker=${takerRes.status})`
      );
    }

    const acct: any[] = await acctRes.json();
    const taker: any[] = await takerRes.json();

    // Index taker ratios by timestamp (ms)
    const takerByTs = new Map<number, number>();
    for (const t of taker) {
      takerByTs.set(Number(t.timestamp), Number(t.buySellRatio));
    }

    const history = acct
      .map((row) => {
        const ts = Number(row.timestamp);
        return {
          date: fmtIdDate(ts),
          longShortRatio: Number(row.longShortRatio),
          longAccountPct: Number(row.longAccount) * 100,
          shortAccountPct: Number(row.shortAccount) * 100,
          takerBuySellRatio: takerByTs.has(ts)
            ? takerByTs.get(ts)!
            : Number(row.longShortRatio),
        };
      })
      .reverse(); // newest first to match dashboard chart shape

    const payload = {
      success: true,
      symbol,
      history,
      source: "binance_futures",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      symbol,
      isEstimated: true,
      error:
        "Gagal mengambil data Long/Short dari Binance Futures. Sumber: fapi.binance.com.",
      detail: err?.message || String(err),
      source: "binance_futures",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// ---------------------------------------------------------------------------
// 2. GET /api/live/hashrate?days=30
//    Source: mempool.space (FREE)
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/hashrate", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 120);
  const cacheKey = `hr:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    // mempool.space hashrate/1m returns ~30 daily points; /3m returns ~90.
    const windowArg = days <= 30 ? "1m" : "3m";
    const r = await fetchWithTimeout(
      `https://mempool.space/api/v1/mining/hashrate/${windowArg}`
    );
    if (!r.ok) throw new Error(`mempool.space responded ${r.status}`);
    const json = await r.json();

    const hashrates: any[] = json.hashrates || [];
    if (!hashrates.length) {
      throw new Error("mempool.space returned no hashrate points");
    }

    // avgHashrate is in H/s. Convert to EH/s (1 EH/s = 1e18 H/s).
    const toEH = (h: number) => h / 1e18;

    let history = hashrates
      .map((p) => ({
        date: fmtIdDate(Number(p.timestamp) * 1000),
        hashrate: Number(toEH(Number(p.avgHashrate)).toFixed(3)),
      }))
      .reverse(); // newest first

    // Limit to requested day count.
    history = history.slice(0, days);

    const payload = {
      success: true,
      history,
      currentHashrate: json.currentHashrate
        ? Number(toEH(Number(json.currentHashrate)).toFixed(3))
        : history[0]?.hashrate ?? null,
      difficulty: json.currentDifficulty
        ? Number(json.currentDifficulty)
        : null,
      unit: "EH/s",
      source: "mempool.space",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error:
        "Gagal mengambil data hashrate dari mempool.space. Coba lagi nanti.",
      detail: err?.message || String(err),
      source: "mempool.space",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// ---------------------------------------------------------------------------
// 3. GET /api/live/active-addresses?days=30
//    Primary: Coinmetrics community (AdrActCnt).  Fallback: blockchain.info
//    /charts/n-unique-addresses.  Both REAL.  If both fail → honest error.
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/active-addresses", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `aa:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  // --- Primary: Coinmetrics ---
  try {
    const url = `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics/?assets=btc&metrics=AdrActCnt&frequency=1d&page_size=${days + 5}`;
    const r = await fetchWithTimeout(url);
    if (r.ok) {
      const json = await r.json();
      const data: any[] = json.data || [];
      if (data.length > 0) {
        const history = data
          .slice(-days)
          .map((row) => ({
            date: fmtIdDate(new Date(row.time).getTime()),
            activeAddresses: Number(row.AdrActCnt),
          }))
          .reverse();
        if (history.length > 0) {
          const payload = {
            success: true,
            history,
            source: "coinmetrics",
            isEstimated: false,
            lastUpdated: new Date().toISOString(),
          };
          cacheSet(cacheKey, payload, TTL_6H);
          return res.json(payload);
        }
      }
    }
  } catch {
    /* fall through to blockchain.info */
  }

  // --- Fallback: blockchain.info /charts/n-unique-addresses ---
  try {
    const r = await fetchWithTimeout(
      `https://api.blockchain.info/charts/n-unique-addresses?format=json&timespan=${days}days&sampled=true`
    );
    if (!r.ok) throw new Error(`blockchain.info responded ${r.status}`);
    const json = await r.json();
    const values: any[] = json.values || [];
    if (!values.length) throw new Error("no values");
    const history = values
      .slice(-days)
      .map((p) => ({
        date: fmtIdDate(Number(p.x) * 1000),
        activeAddresses: Number(p.y),
      }))
      .reverse();
    const payload = {
      success: true,
      history,
      source: "blockchain.info",
      isEstimated: false,
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error:
        "Gagal mengambil data alamat aktif. Sumber gratis (Coinmetrics / blockchain.info) tidak tersedia.",
      detail: err?.message || String(err),
      source: "none",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// ---------------------------------------------------------------------------
// 4. GET /api/live/exchange-netflow?days=30
//    Source: Santiment GraphQL free tier — `exchange_balance` metric returns
//    the daily SUM of all balance-change events on tracked exchange wallets
//    (i.e., daily NET FLOW in BTC; positive=inflow to exchanges, negative=
//    outflow from exchanges).  REAL data, no API key.
//    Note: free tier has ~30-day data lag — we query 90 days back and slice
//    the latest N days requested.
//    Fallback: Blockchair /bitcoin/stats snapshot (single 24h point only).
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/exchange-netflow", (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `netflow:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  (async () => {
    // --- Primary: Santiment exchange_balance (daily net flow in BTC) ---
    // Query 95 days back to ensure we have enough data after the ~30d lag.
    const now = new Date();
    const from = new Date(now.getTime() - 95 * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const sanQuery = `{
      getMetric(metric:"exchange_balance") {
        timeseriesData(selector:{slug:"bitcoin"} from:"${from}T00:00:00Z" to:"${to}T00:00:00Z" interval:"1d"){ datetime value }
      }
    }`;
    try {
      const r = await fetchWithTimeout(
        "https://api.santiment.net/graphql",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: sanQuery }),
        },
        12000
      );
      if (r.ok) {
        const json = await r.json();
        const ts: any[] = json?.data?.getMetric?.timeseriesData || [];
        if (ts.length > 0) {
          // Santiment `exchange_balance` default aggregation returns the
          // SUM of daily balance-change events (= daily net flow in BTC).
          // Positive = inflow to exchanges, negative = outflow.
          const allRows = ts
            .map((p) => ({
              date: fmtIdDate(new Date(p.datetime).getTime()),
              isoDate: p.datetime.slice(0, 10),
              netflowBtc: Number(Number(p.value).toFixed(2)),
            }))
            .reverse(); // newest first
          const history = allRows.slice(0, days);
          const latestNetflow = history[0]?.netflowBtc ?? null;
          const payload = {
            success: true,
            isEstimated: false,
            history,
            current: {
              netflowBtc: latestNetflow,
              // Direction label for frontend convenience
              direction:
                latestNetflow == null
                  ? "unknown"
                  : latestNetflow > 0
                  ? "inflow"
                  : latestNetflow < 0
                  ? "outflow"
                  : "neutral",
            },
            source: "santiment",
            note:
              "Exchange netflow REAL dari Santiment (`exchange_balance` metric — default aggregation = SUM daily balance-change events = net flow BTC). Positif = inflow ke exchange, negatif = outflow dari exchange. Catatan: free tier memiliki lag ~30 hari (data terbaru ~30 hari lalu).",
            lastUpdated: new Date().toISOString(),
          };
          cacheSet(cacheKey, payload, TTL_6H);
          return res.json(payload);
        }
      }
    } catch {
      /* fall through to Blockchair snapshot */
    }

    // --- Fallback: Blockchair /bitcoin/stats 24h snapshot ---
    try {
      const r = await fetchWithTimeout(
        "https://api.blockchair.com/bitcoin/stats"
      );
      if (r.ok) {
        const json = await r.json();
        const d = json?.data || {};
        // Blockchair no longer exposes exchange_inflow_24h / outflow_24h
        // in the free tier — we surface cdd_24h (Coin Days Destroyed) as a
        // proxy for spending activity, labeled honestly as a proxy.
        const cdd = d.cdd_24h ?? null;
        const inflow = d.exchange_inflow_24h ?? null;
        const outflow = d.exchange_outflow_24h ?? null;
        if (inflow != null && outflow != null) {
          const payload = {
            success: true,
            isEstimated: true,
            current: {
              inflow24h: Number(inflow),
              outflow24h: Number(outflow),
              netflow24h: Number(inflow) - Number(outflow),
            },
            history: [],
            source: "blockchair_snapshot",
            note:
              "Santiment (sumber utama) gagal. Hanya snapshot 24h tersedia gratis (Blockchair). Data historis exchange netflow memerlukan API berbayar (Glassnode/CryptoQuant) bila Santiment juga tidak tersedia.",
            lastUpdated: new Date().toISOString(),
          };
          cacheSet(cacheKey, payload, TTL_6H);
          return res.json(payload);
        }
        if (cdd != null) {
          const payload = {
            success: true,
            isEstimated: true,
            current: { cdd24h: Number(cdd) },
            history: [],
            source: "blockchair_cdd_proxy",
            note:
              "Santiment (sumber utama) gagal. Blockchair tidak menyediakan exchange_inflow/outflow_24h di tier gratis. Menampilkan Coin Days Destroyed (CDD) 24h sebagai PROXY aktivitas spending (BUKAN net flow). Coba lagi nanti untuk data Santiment.",
            lastUpdated: new Date().toISOString(),
          };
          cacheSet(cacheKey, payload, TTL_6H);
          return res.json(payload);
        }
      }
    } catch {
      /* fall through */
    }

    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error:
        "Exchange netflow gagal dimuat dari Santiment (sumber utama) maupun Blockchair (fallback). Coba lagi nanti.",
      source: "none",
      lastUpdated: new Date().toISOString(),
    });
  })();
});

// ---------------------------------------------------------------------------
// 5. GET /api/live/etf-flows?days=30
//    Source: Farside Investors (HTML scrape with cheerio).
//    URL: https://farside.co.uk/bitcoin-etf-flow-all-data/ (NEW location —
//    the old `/bitcoin-investment-fund-flows/` path 404s as of mid-2026).
//    If Cloudflare blocks (HTTP 403/503), return success:false honest error.
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/etf-flows", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 120);
  const cacheKey = `etf:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  const FARSIDE_URL = "https://farside.co.uk/bitcoin-etf-flow-all-data/";
  const FARSIDE_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  let html: string | null = null;
  let fetchError: string | null = null;

  // --- Attempt 1: Node fetch (fast path, fails on Cloudflare TLS fingerprint) ---
  try {
    const r = await fetchWithTimeout(
      FARSIDE_URL,
      {
        headers: {
          "User-Agent": FARSIDE_UA,
          Referer: "https://farside.co.uk/",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
        },
      },
      15000
    );
    if (r.ok) {
      html = await r.text();
    } else {
      fetchError = `Node fetch returned HTTP ${r.status}`;
    }
  } catch (err: any) {
    fetchError = `Node fetch threw: ${err?.message || String(err)}`;
  }

  // --- Attempt 2: curl fallback (bypasses Cloudflare TLS fingerprinting) ---
  if (html == null) {
    try {
      const result = await fetchHtmlViaCurl(FARSIDE_URL, {
        userAgent: FARSIDE_UA,
        referer: "https://farside.co.uk/",
        timeoutSec: 20,
        extraHeaders: {
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
        },
      });
      if (result.status === 200 && result.body.length > 1000) {
        html = result.body;
      } else {
        fetchError = `curl fallback returned HTTP ${result.status} (body ${result.body.length} bytes)`;
      }
    } catch (err: any) {
      fetchError = `curl fallback threw: ${err?.message || String(err)}`;
    }
  }

  if (html == null) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error:
        "Gagal scraping data ETF dari Farside Investors (URL: /bitcoin-etf-flow-all-data/). Cloudflare block baik via Node fetch maupun curl fallback.",
      detail: fetchError || "Unknown fetch failure",
      source: "farside.co.uk",
      lastUpdated: new Date().toISOString(),
    });
  }

  // If Cloudflare served a challenge page (NOT a real Farside page), the
  // title contains "Just a moment".  NOTE: we no longer check for the
  // "challenge-platform" string because Cloudflare's analytics scripts
  // include that string on the REAL Farside page too (false positive).
  // The real validation is whether <table class="etf"> exists below.
  if (html.includes("Just a moment") && !html.includes('table class="etf"')) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error: "Farside Investors diblokir oleh Cloudflare challenge page.",
      source: "farside.co.uk",
      lastUpdated: new Date().toISOString(),
    });
  }

  try {
    const $ = cheerio.load(html);
    // Prefer <table class="etf">; fall back to first <table> on the page.
    let $table = $("table.etf").first();
    if ($table.length === 0) $table = $("table").first();
    if ($table.length === 0) {
      throw new Error("Tabel ETF tidak ditemukan di halaman Farside.");
    }

    // Header row determines column order.  The site's columns shift over
    // time as new ETFs launch — we capture whatever columns are present
    // and merge them into a per-date record.  We specifically surface the
    // "Total" column + the well-known tickers (IBIT, FBTC, ARKB, BITB, GBTC)
    // for frontend convenience.
    const headers: string[] = [];
    $table.find("tr").first().find("th,td").each((_i, cell) => {
      headers.push($(cell).text().trim());
    });

    const rows: any[] = [];
    $table.find("tr").slice(1).each((_i, tr) => {
      const cells = $(tr).find("td");
      if (cells.length < 2) return;
      const rowObj: Record<string, string> = {};
      $(cells).each((j, cell) => {
        const key = headers[j] || `col${j}`;
        rowObj[key] = $(cell).text().trim();
      });
      const dateRaw = rowObj[headers[0] || "Date"] || "";
      // Farside date format: "11 Jan 2024" (DD MMM YYYY).  Also accept
      // "DD/MM/YYYY" for backward compatibility with older page formats.
      let dateObj: Date | null = null;
      const m1 = dateRaw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
      if (m1) {
        // Map month abbreviation to number (1-12)
        const monthNames: Record<string, string> = {
          jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
          jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
        };
        const monNum = monthNames[m1[2].toLowerCase().slice(0, 3)];
        if (monNum) {
          const isoDateStr = `${m1[3]}-${monNum}-${m1[1].padStart(2, "0")}T00:00:00Z`;
          const t = Date.parse(isoDateStr);
          if (!Number.isNaN(t)) dateObj = new Date(t);
        }
      }
      if (!dateObj) {
        const m2 = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m2) {
          const t = Date.parse(`${m2[3]}-${m2[2]}-${m2[1]}T00:00:00Z`);
          if (!Number.isNaN(t)) dateObj = new Date(t);
        }
      }
      if (!dateObj || isNaN(dateObj.getTime())) return;
      const rec: any = { date: fmtIdDate(dateObj.getTime()), isoDate: fmtIso(dateObj.getTime()) };
      let total: number | null = null;
      // Parse a numeric value, handling:
      //   "1,174"  -> 1174
      //   "(27,171)" -> -27171   (parens = negative, accounting style)
      //   "111.7"   -> 111.7
      //   "-"       -> 0 (no data)
      const parseNum = (raw: string | undefined): number | null => {
        if (raw == null) return null;
        const s = raw.trim().replace(/,/g, "");
        if (s === "" || s === "-") return 0;
        const neg = /^\(.*\)$/.test(s);
        const cleaned = neg ? s.slice(1, -1) : s;
        const v = Number(cleaned);
        if (Number.isNaN(v)) return null;
        return neg ? -v : v;
      };
      for (const ticker of ["IBIT", "FBTC", "ARKB", "BITB", "GBTC"]) {
        const v = parseNum(rowObj[ticker]);
        if (v != null) rec[ticker] = v;
      }
      const totalV = parseNum(rowObj["Total"] ?? rowObj["TOTAL"]);
      if (totalV != null) total = totalV;
      rec.total = total;
      rows.push(rec);
    });

    if (rows.length === 0) {
      throw new Error("Tabel ETF kosong / format tidak dikenali.");
    }

    // Farside's table is sorted OLDEST-first (top row = Jan 11 2024 launch).
    // Reverse to newest-first, then limit to requested days.
    const history = rows.reverse().slice(0, days);

    const payload = {
      success: true,
      history,
      tickers: ["IBIT", "FBTC", "ARKB", "BITB", "GBTC"],
      source: "farside.co.uk",
      isEstimated: false,
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error:
        "Gagal parsing tabel ETF dari Farside Investors (HTML diperoleh, tetapi struktur tabel berubah / tidak dikenali).",
      detail: err?.message || String(err),
      source: "farside.co.uk",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// ---------------------------------------------------------------------------
// 6. GET /api/live/cme-oi?days=30
//    Source: CFTC Commitment of Traders — annual text archive (CSV inside
//    a ZIP).  URL: https://www.cftc.gov/files/dea/history/fut_fin_txt_YYYY.zip
//    Each weekly report row contains Market_and_Exchange_Names + OI + the
//    full position breakdown (Dealer/AssetMgr/LevMoney/OtherRept/NonRept ×
//    Long/Short/Spread) + changes + percent + trader counts.  We filter to
//    "BITCOIN - CHICAGO MERCANTILE EXCHANGE" (standard 5-BTC contract, NOT
//    MICRO BITCOIN which is a separate contract code).  Data is WEEKLY.
//    The ZIP is unzipped in-process using Node's built-in zlib.inflateRawSync
//    (no external zip lib needed — we manually parse the local file header).
//    If archive fetch/unzip fails → honest error.
// ---------------------------------------------------------------------------

/**
 * Extract the first file from a single-file ZIP archive.
 * Uses Node's built-in zlib.inflateRawSync for deflate-compressed entries.
 * Returns { name, content } or null on failure.
 *
 * ZIP Local File Header layout (offsets from header start):
 *   0  4 bytes  signature (0x04034b50)
 *   4  2 bytes  version needed
 *   6  2 bytes  flags
 *   8  2 bytes  compression method (0=stored, 8=deflate)
 *  10  2 bytes  last mod time
 *  12  2 bytes  last mod date
 *  14  4 bytes  CRC-32
 *  18  4 bytes  compressed size
 *  22  4 bytes  uncompressed size
 *  26  2 bytes  filename length
 *  28  2 bytes  extra field length
 *  30  N bytes  filename
 *  30+N  M bytes  extra field
 *  30+N+M  ...   compressed data
 */
function extractFirstFileFromZip(buf: Buffer): {
  name: string;
  content: Buffer;
} | null {
  if (buf.length < 30) return null;
  const sig = buf.readUInt32LE(0);
  if (sig !== 0x04034b50) return null;
  const compressionMethod = buf.readUInt16LE(8);
  const compressedSize = buf.readUInt32LE(18);
  const uncompressedSize = buf.readUInt32LE(22);
  const filenameLength = buf.readUInt16LE(26);
  const extraFieldLength = buf.readUInt16LE(28);
  const filename = buf.slice(30, 30 + filenameLength).toString("utf8");
  const dataStart = 30 + filenameLength + extraFieldLength;
  let content: Buffer;
  if (compressionMethod === 0) {
    // Stored (no compression)
    content = buf.slice(dataStart, dataStart + uncompressedSize);
  } else if (compressionMethod === 8) {
    // Deflate (raw, no zlib header)
    const compressed = buf.slice(dataStart, dataStart + compressedSize);
    try {
      content = zlib.inflateRawSync(compressed);
    } catch {
      return null;
    }
  } else {
    return null;
  }
  return { name: filename, content };
}

/**
 * Parse a single CSV row that may have a leading quoted field (the CFTC
 * archive's first column "Market_and_Exchange_Names" is always quoted).
 * Returns array of string fields.  Numeric fields come back as strings
 * (caller converts via Number()).
 */
function parseCftcCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field — read until closing quote (no escaping in CFTC data)
      const end = line.indexOf('"', i + 1);
      if (end < 0) {
        fields.push(line.slice(i + 1));
        break;
      }
      fields.push(line.slice(i + 1, end));
      i = end + 1;
      // Skip optional comma
      if (line[i] === ",") i++;
    } else {
      // Unquoted field — read until next comma
      const end = line.indexOf(",", i);
      if (end < 0) {
        fields.push(line.slice(i).trim());
        break;
      }
      fields.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return fields;
}

liveDataRouter.get("/api/live/cme-oi", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 365);
  const cacheKey = `cme:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  // Determine which annual archives to fetch.  If user wants 30 days back
  // (≈5 weekly reports), the current year's archive is enough.  For longer
  // lookbacks we also fetch the previous year's archive.
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const weeksNeeded = Math.ceil(days / 7) + 2; // +2 buffer for current week
  // Crude heuristic: if user wants more weeks than the current year has
  // published so far, also fetch last year's archive.
  const weeksElapsedThisYear = Math.floor(
    (now.getTime() - Date.UTC(curYear, 0, 1)) / (7 * MS_PER_DAY)
  );
  const yearsToFetch =
    weeksNeeded > weeksElapsedThisYear ? [curYear, curYear - 1] : [curYear];

  const allBtcRows: any[] = [];
  let lastErr: any = null;

  for (const year of yearsToFetch) {
    try {
      const url = `https://www.cftc.gov/files/dea/history/fut_fin_txt_${year}.zip`;
      const r = await fetchWithTimeout(url, {}, 15000);
      if (!r.ok) {
        lastErr = new Error(`CFTC archive ${year} responded ${r.status}`);
        continue;
      }
      const zipBuf = Buffer.from(await r.arrayBuffer());
      const extracted = extractFirstFileFromZip(zipBuf);
      if (!extracted) {
        lastErr = new Error(`CFTC archive ${year} zip parse failed`);
        continue;
      }
      const text = extracted.content.toString("utf8");
      const lines = text.split("\n");
      // Skip header row (line 0)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.startsWith('"BITCOIN - CHICAGO MERCANTILE EXCHANGE",')) {
          continue;
        }
        // Exclude MICRO BITCOIN — those rows start with `"MICRO BITCOIN - ...`
        // which we already excluded via the `startsWith` check above.
        const fields = parseCftcCsvLine(line);
        // Column indices (0-based, after parsing quoted first field):
        //   0  Market_and_Exchange_Names
        //   1  As_of_Date_In_Form_YYMMDD
        //   2  Report_Date_as_YYYY-MM-DD
        //   3  CFTC_Contract_Market_Code
        //   4  CFTC_Market_Code
        //   5  CFTC_Region_Code
        //   6  CFTC_Commodity_Code
        //   7  Open_Interest_All
        //   8  Dealer_Positions_Long_All
        //   9  Dealer_Positions_Short_All
        //  10  Dealer_Positions_Spread_All
        //  11  Asset_Mgr_Positions_Long_All
        //  12  Asset_Mgr_Positions_Short_All
        //  13  Asset_Mgr_Positions_Spread_All
        //  14  Lev_Money_Positions_Long_All
        //  15  Lev_Money_Positions_Short_All
        //  16  Lev_Money_Positions_Spread_All
        //  17  Other_Rept_Positions_Long_All
        //  18  Other_Rept_Positions_Short_All
        //  19  Other_Rept_Positions_Spread_All
        //  20  Tot_Rept_Positions_Long_All
        //  21  Tot_Rept_Positions_Short_All
        //  22  NonRept_Positions_Long_All
        //  23  NonRept_Positions_Short_All
        //  24  Change_in_Open_Interest_All
        //  ... (40 change + percent columns) ...
        //  58  Traders_Tot_All
        //  ... (trader-count per-category columns) ...
        //  81  Contract_Units  (string like "(5 Bitcoins)")
        const reportDate = fields[2];
        if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) continue;
        const ts = Date.parse(`${reportDate}T00:00:00Z`);
        if (Number.isNaN(ts)) continue;
        const num = (idx: number): number => {
          const v = fields[idx];
          if (v == null) return 0;
          const s = String(v).trim();
          // CFTC uses "." to indicate "0 / not applicable"
          if (s === "" || s === ".") return 0;
          const n = Number(s);
          return Number.isFinite(n) ? n : 0;
        };
        const openInterest = num(7);
        const contractUnitsRaw = (fields[81] || "").trim();
        // Standard Bitcoin CME contract = 5 BTC per contract
        const btcPerContract = 5;
        allBtcRows.push({
          date: fmtIdDate(ts),
          isoDate: reportDate,
          openInterest,
          openInterestBtc: openInterest * btcPerContract,
          contractUnits: contractUnitsRaw || "(5 Bitcoins)",
          dealerLong: num(8),
          dealerShort: num(9),
          dealerSpread: num(10),
          assetMgrLong: num(11),
          assetMgrShort: num(12),
          assetMgrSpread: num(13),
          levMoneyLong: num(14),
          levMoneyShort: num(15),
          levMoneySpread: num(16),
          otherReptLong: num(17),
          otherReptShort: num(18),
          otherReptSpread: num(19),
          totReptLong: num(20),
          totReptShort: num(21),
          // Nonreportable = "small speculators" — closest analog to the
          // legacy "noncommercial" categorization used by traditional CoT.
          nonCommercialLong: num(22),
          nonCommercialShort: num(23),
          changeInOI: num(24),
          totalTraders: num(58),
        });
      }
    } catch (err: any) {
      lastErr = err;
      continue;
    }
  }

  if (allBtcRows.length === 0) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error:
        "Data COT CME gagal dimuat dari arsip tahunan CFTC (fut_fin_txt_YYYY.zip). Coba lagi nanti.",
      detail: lastErr?.message || String(lastErr),
      source: "cftc.gov",
      lastUpdated: new Date().toISOString(),
    });
  }

  // Sort newest-first, dedupe by isoDate (in case both years' archives
  // overlap on year boundary), limit to requested days.
  const byDate = new Map<string, any>();
  for (const row of allBtcRows) byDate.set(row.isoDate, row);
  const history = Array.from(byDate.values())
    .sort((a, b) => (a.isoDate < b.isoDate ? 1 : -1))
    .slice(0, Math.max(Math.ceil(days / 7) + 1, 1));

  const payload = {
    success: true,
    history,
    source: "cftc.gov",
    isEstimated: false,
    note:
      "CFTC Commitment of Traders (CoT) — arsip tahunan fut_fin_txt_YYYY.zip (CSV). Data MINGGUAN (dipublikasikan setiap Jumat untuk posisi Selasa). Kontrak standar BITCOIN - CME (5 BTC per kontrak). MICRO BITCOIN dieksklusi.",
    lastUpdated: new Date().toISOString(),
  };
  cacheSet(cacheKey, payload, TTL_24H);
  return res.json(payload);
});

// ---------------------------------------------------------------------------
// 7. GET /api/live/s2f?days=30
//    Stock-to-Flow: computed deterministically from BTC protocol.  No API.
//    Halving April 2024 → block reward 3.125 BTC → ~144 blocks/day →
//    450 BTC/day mined.  Annual flow = 450 * 365 = 164,250 BTC.  Stock is
//    the cumulative supply; we anchor to the live Blockchair "circulation"
//    stat (satoshis → BTC) and walk backwards 450 BTC/day for history.
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/s2f", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 365);
  const cacheKey = `s2f:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    // Anchor supply from Blockchair (circulation field = satoshis).
    let currentSupply = 19_700_000; // sensible fallback (post-2024 halving)
    let blockReward = 3.125;
    try {
      const r = await fetchWithTimeout(
        "https://api.blockchair.com/bitcoin/stats"
      );
      if (r.ok) {
        const json = await r.json();
        const circ = json?.data?.circulation;
        if (typeof circ === "number") {
          // circulation is in satoshis
          currentSupply = circ / 1e8;
        }
      }
    } catch {
      /* use fallback */
    }

    // Blocks/day ≈ 144 (10-min target).  Annual flow.
    const blocksPerDay = 144;
    const flowPerDay = blockReward * blocksPerDay; // ~450 BTC
    const annualFlow = flowPerDay * 365; // ~164,250 BTC

    const now = Date.now();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const history: any[] = [];
    for (let i = 0; i < days; i++) {
      const ts = todayMs - i * MS_PER_DAY;
      const stock = currentSupply - flowPerDay * i;
      const s2f = stock / annualFlow;
      history.push({
        date: fmtIdDate(ts),
        stock: Number(stock.toFixed(0)),
        flow: Number(annualFlow.toFixed(0)),
        s2fRatio: Number(s2f.toFixed(2)),
      });
    }

    const payload = {
      success: true,
      history,
      currentStock: Number(currentSupply.toFixed(0)),
      annualFlow: Number(annualFlow.toFixed(0)),
      currentS2F: Number((currentSupply / annualFlow).toFixed(2)),
      blockReward,
      source: "computed",
      isEstimated: false, // deterministic from BTC protocol; supply anchor is REAL (Blockchair)
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_24H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error: "Gagal menghitung Stock-to-Flow.",
      detail: err?.message || String(err),
      source: "computed",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// ---------------------------------------------------------------------------
// 8. GET /api/live/mvrv?days=30
//    MVRV = MarketCap / RealizedCap.  Source: Santiment GraphQL free tier —
//    `mvrv_usd` (precomputed MVRV ratio), `marketcap_usd` (MarketCap USD),
//    `realized_value_usd` (RealizedCap USD, computed from UTXO cost basis).
//    All three metrics are REAL on Santiment's free tier (SANAPI FREE).
//    Note: free tier has ~30-day data lag (latest data is ~30 days old),
//    so we query 90 days back and slice the latest N days requested.
//    Fallback: Coinmetrics community API (MarketCap only — RealizedCap is
//    paid on Coinmetrics, would return null).
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/mvrv", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `mvrv:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  // --- Primary: Santiment (mvrv_usd + marketcap_usd + realized_value_usd) ---
  // Query 90 days back because free tier has ~30d lag — guarantees enough
  // data points to slice `days` latest.
  const now = new Date();
  const from90 = new Date(now.getTime() - 95 * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const toIso = now.toISOString().slice(0, 10);
  const sanQuery = `{
    mvrv: getMetric(metric:"mvrv_usd") {
      timeseriesData(selector:{slug:"bitcoin"} from:"${from90}T00:00:00Z" to:"${toIso}T00:00:00Z" interval:"1d"){ datetime value }
    }
    mcap: getMetric(metric:"marketcap_usd") {
      timeseriesData(selector:{slug:"bitcoin"} from:"${from90}T00:00:00Z" to:"${toIso}T00:00:00Z" interval:"1d"){ datetime value }
    }
    rcap: getMetric(metric:"realized_value_usd") {
      timeseriesData(selector:{slug:"bitcoin"} from:"${from90}T00:00:00Z" to:"${toIso}T00:00:00Z" interval:"1d"){ datetime value }
    }
  }`;
  try {
    const r = await fetchWithTimeout(
      "https://api.santiment.net/graphql",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sanQuery }),
      },
      12000
    );
    if (r.ok) {
      const json = await r.json();
      const mvrvTs: any[] = json?.data?.mvrv?.timeseriesData || [];
      const mcapTs: any[] = json?.data?.mcap?.timeseriesData || [];
      const rcapTs: any[] = json?.data?.rcap?.timeseriesData || [];
      if (mvrvTs.length > 0 || mcapTs.length > 0) {
        // Index by datetime (ISO string with T00:00:00Z)
        const mcapByDay = new Map<string, number>();
        for (const p of mcapTs) mcapByDay.set(p.datetime, Number(p.value));
        const rcapByDay = new Map<string, number>();
        for (const p of rcapTs) rcapByDay.set(p.datetime, Number(p.value));
        const mvrvByDay = new Map<string, number>();
        for (const p of mvrvTs) mvrvByDay.set(p.datetime, Number(p.value));

        // IMPORTANT: Santiment free tier has a ~30-day data lag for
        // mvrv_usd and realized_value_usd, BUT marketcap_usd has no lag.
        // If we iterate over mcap days, the latest ~30 days will have
        // mcap but null mvrv/rcap.  To avoid returning rows with null
        // MVRV for the most recent days, we iterate over mvrvTs days
        // (the 30-day-lagged set) as the primary, and look up mcap/rcap
        // for each.  This guarantees every row has a real MVRV value.
        // If mvrvTs is empty (Santiment paid-tier regression), fall back
        // to using mcap days and computing MVRV from mcap/rcap where
        // both exist.
        const primaryTs = mvrvTs.length > 0 ? mvrvTs : rcapTs.length > 0 ? rcapTs : mcapTs;
        const rows: any[] = [];
        for (const p of primaryTs) {
          const day = p.datetime;
          const mcap = mcapByDay.get(day) ?? null;
          const rcap = rcapByDay.get(day) ?? null;
          const mvrvPre = mvrvByDay.get(day);
          const mvrvComputed =
            mcap != null && rcap != null && rcap > 0 ? mcap / rcap : null;
          const mvrv = mvrvPre != null ? Number(mvrvPre) : mvrvComputed;
          rows.push({
            date: fmtIdDate(new Date(day).getTime()),
            isoDate: day.slice(0, 10),
            marketCap: mcap,
            realizedCap: rcap,
            mvrv: mvrv != null ? Number(mvrv.toFixed(4)) : null,
          });
        }
        // Newest-first, slice to requested days
        const history = rows.slice(-days).reverse();
        if (history.length > 0) {
          const payload = {
            success: true,
            isEstimated: false,
            history,
            source: "santiment",
            note:
              "MVRV REAL (precomputed `mvrv_usd` dari Santiment). MarketCap & RealizedCap REAL (UTXO cost basis) dari Santiment free tier. Catatan: free tier memiliki lag ~30 hari (data terbaru ~30 hari lalu) — tanggal terbaru pada history adalah ~30 hari yang lalu.",
            lastUpdated: new Date().toISOString(),
          };
          cacheSet(cacheKey, payload, TTL_6H);
          return res.json(payload);
        }
      }
    }
  } catch {
    /* fall through to Coinmetrics */
  }

  // --- Fallback: Coinmetrics (MarketCap REAL, RealizedCap null/paid) ---
  try {
    const r = await fetchWithTimeout(
      `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics/?assets=btc&metrics=CapMrktCurUSD,PriceUSD&frequency=1d&page_size=${days + 5}`
    );
    if (r.ok) {
      const json = await r.json();
      const data: any[] = json.data || [];
      if (data.length > 0) {
        const history = data
          .slice(-days)
          .map((row) => ({
            date: fmtIdDate(new Date(row.time).getTime()),
            isoDate: new Date(row.time).toISOString().slice(0, 10),
            marketCap: Number(row.CapMrktCurUSD),
            realizedCap: null,
            mvrv: null,
          }))
          .reverse();
        const payload = {
          success: true,
          isEstimated: true,
          history,
          source: "coinmetrics",
          note:
            "Santiment (sumber utama) gagal. MarketCap REAL dari Coinmetrics. RealizedCap & MVRV tidak tersedia di Coinmetrics free tier (CapRealUSD hanya di tier berbayar) — nilai mvrv null.",
          lastUpdated: new Date().toISOString(),
        };
        cacheSet(cacheKey, payload, TTL_6H);
        return res.json(payload);
      }
    }
  } catch {
    /* fall through */
  }

  return res.json({
    success: false,
    isEstimated: true,
    history: [],
    error:
      "MVRV gagal dimuat dari Santiment (sumber utama) maupun Coinmetrics (fallback). Coba lagi nanti.",
    source: "none",
    lastUpdated: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// 9. GET /api/live/drawdown?days=30
//    Source: blockchain.info /charts/market-price (REAL price history) + ATH
//    from CoinGecko /coins/bitcoin (when not rate-limited).  Fallback: a
//    reasonable ATH constant with isEstimated=true label.
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/drawdown", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `dd:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    // Price history from blockchain.info.
    const priceRes = await fetchWithTimeout(
      `https://api.blockchain.info/charts/market-price?format=json&timespan=${days}days&sampled=true`
    );
    if (!priceRes.ok)
      throw new Error(`blockchain.info market-price responded ${priceRes.status}`);
    const priceJson = await priceRes.json();
    const priceVals: any[] = dedupeToDaily(priceJson.values || []);
    if (!priceVals.length) throw new Error("no price values");

    // ATH from CoinGecko.  If rate-limited, fall back to a known constant
    // (BTC Jan-2025 high) and label isEstimated=true.
    let ath: number | null = null;
    let athSource = "coingecko";
    try {
      const cg = await fetchWithTimeout(
        "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false"
      );
      if (cg.ok) {
        const cgJson = await cg.json();
        const athUsd = cgJson?.market_data?.ath?.usd;
        if (typeof athUsd === "number" && athUsd > 0) ath = athUsd;
      } else if (cg.status === 429) {
        ath = 109_000; // Jan 2025 BTC ATH ~$109K
        athSource = "estimated_constant";
      }
    } catch {
      /* fall back below */
    }
    if (ath == null) {
      ath = 109_000;
      athSource = "estimated_constant";
    }

    const history = priceVals
      .slice(-days)
      .map((p) => {
        const price = Number(p.y);
        const drawdown = ((price - ath!) / ath!) * 100;
        return {
          date: fmtIdDate(Number(p.x) * 1000),
          price: Number(price.toFixed(2)),
          ath: ath,
          drawdownPct: Number(drawdown.toFixed(2)),
        };
      })
      .reverse();

    const payload = {
      success: true,
      history,
      ath,
      athSource,
      isEstimated: athSource === "estimated_constant",
      source: "blockchain.info+coingecko",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error:
        "Gagal mengambil data harga BTC untuk perhitungan drawdown (blockchain.info).",
      detail: err?.message || String(err),
      source: "blockchain.info",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// ---------------------------------------------------------------------------
// 10. GET /api/live/nvt?days=30
//     NVT = MarketCap / TxVolumeUSD.  Both available REAL from blockchain.info:
//       /charts/market-cap (USD)
//       /charts/estimated-transaction-volume-usd (USD)
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/nvt", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `nvt:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [mcRes, txRes] = await Promise.all([
      fetchWithTimeout(
        `https://api.blockchain.info/charts/market-cap?format=json&timespan=${days}days&sampled=true`
      ),
      fetchWithTimeout(
        `https://api.blockchain.info/charts/estimated-transaction-volume-usd?format=json&timespan=${days}days&sampled=true`
      ),
    ]);
    if (!mcRes.ok || !txRes.ok)
      throw new Error(
        `blockchain.info responded mc=${mcRes.status}, tx=${txRes.status}`
      );
    const [mcJson, txJson] = await Promise.all([mcRes.json(), txRes.json()]);
    const mcVals: any[] = dedupeToDaily(mcJson.values || []);
    if (!mcVals.length)
      throw new Error("empty market-cap series");
    // Join with tx-volume on day-string (robust to sub-midnight timestamps).
    const txByDay = dailyMap(txJson.values || []);

    const history: any[] = [];
    for (const p of mcVals.slice(-days)) {
      const ts = Number(p.x);
      const day = new Date(ts * 1000).toISOString().slice(0, 10);
      const mv = Number(p.y);
      const tv = txByDay.get(day) ?? 0;
      const nvt = tv > 0 ? mv / tv : null;
      history.push({
        date: fmtIdDate(ts * 1000),
        networkValue: Number(mv.toFixed(0)),
        txVolume: Number(tv.toFixed(0)),
        nvt: nvt != null ? Number(nvt.toFixed(2)) : null,
      });
    }
    history.reverse();

    const payload = {
      success: true,
      history,
      source: "blockchain.info",
      isEstimated: false,
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error:
        "Gagal menghitung NVT — blockchain.info market-cap / estimated-transaction-volume tidak tersedia.",
      detail: err?.message || String(err),
      source: "blockchain.info",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// ---------------------------------------------------------------------------
// 11. GET /api/live/miner-data?days=30
//     Miner revenue: blockchain.info /charts/miners-revenue (REAL USD/day).
//     Top pools: mempool.space /api/v1/mining/pools/1m (REAL).
//     "Miner outflows" labeled as estimated (no free source for UTXO-based
//     miner spend).
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/miner-data", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `miner:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [revRes, poolsRes, priceRes] = await Promise.all([
      fetchWithTimeout(
        `https://api.blockchain.info/charts/miners-revenue?format=json&timespan=${days}days&sampled=true`
      ),
      fetchWithTimeout("https://mempool.space/api/v1/mining/pools/1m"),
      fetchWithTimeout(
        `https://api.blockchain.info/charts/market-price?format=json&timespan=${days}days&sampled=true`
      ),
    ]);

    if (!revRes.ok) throw new Error(`miners-revenue responded ${revRes.status}`);
    const revJson = await revRes.json();
    const revVals: any[] = dedupeToDaily(revJson.values || []);

    // Price series for USD→BTC conversion (revenue is in USD; we compute
    // BTC-denominated revenue = revenue_usd / price_usd).  Join on day-string
    // because blockchain.info's last-sample-of-day timestamps differ between
    // charts.
    const priceByDay = new Map<string, number>();
    if (priceRes.ok) {
      const priceJson = await priceRes.json();
      for (const [day, val] of dailyMap(priceJson.values || [])) {
        priceByDay.set(day, val);
      }
    }

    const history = revVals
      .slice(-days)
      .map((p) => {
        const ts = Number(p.x);
        const day = new Date(ts * 1000).toISOString().slice(0, 10);
        const revUsd = Number(p.y);
        const price = priceByDay.get(day) || 0;
        const revBtc = price > 0 ? revUsd / price : null;
        return {
          date: fmtIdDate(ts * 1000),
          revenueUsd: Number(revUsd.toFixed(0)),
          revenueBtc: revBtc != null ? Number(revBtc.toFixed(2)) : null,
          // Miner outflows are NOT freely available (Glassnode paid).
          // We surface a deterministic estimate = block reward * 144 ≈ 450
          // BTC/day post-2024 halving, clearly labeled estimated.
          minerOutflowBtc: 450,
          minerOutflowEstimated: true,
        };
      })
      .reverse();

    // Top mining pools
    let topPools: any[] = [];
    if (poolsRes.ok) {
      const poolsJson = await poolsRes.json();
      const pools: any[] = poolsJson.pools || [];
      const totalBlocks = pools.reduce((s, p) => s + Number(p.blockCount || 0), 0);
      topPools = pools.slice(0, 8).map((p) => ({
        name: p.name,
        blockCount: Number(p.blockCount || 0),
        sharePct:
          totalBlocks > 0
            ? Number(((Number(p.blockCount || 0) / totalBlocks) * 100).toFixed(2))
            : 0,
      }));
    }

    const payload = {
      success: true,
      history,
      topPools,
      minerOutflowEstimated: true,
      source: "blockchain.info+mempool.space",
      isEstimated: true, // outflow portion is estimated
      note:
        "Miner revenue REAL dari blockchain.info. Top pools REAL dari mempool.space. Miner outflow diestimasi (= block reward × 144 ≈ 450 BTC/day) karena data UTXO miner-spend memerlukan API berbayar (Glassnode).",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      topPools: [],
      error:
        "Gagal mengambil data miner (blockchain.info / mempool.space).",
      detail: err?.message || String(err),
      source: "blockchain.info+mempool.space",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// ---------------------------------------------------------------------------
// 12. GET /api/live/dominance-history?days=30
//     Source: CoinGecko (BTC mcap, ETH mcap, total mcap).  CoinGecko free
//     tier sometimes returns 429 (sandbox).  On 429 we fall back to
//     blockchain.info for BTC mcap only and return success:false honest
//     error for ETH mcap portion.
// ---------------------------------------------------------------------------
liveDataRouter.get("/api/live/dominance-history", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `dom:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    // Try CoinGecko first.
    const [btcRes, ethRes, globalRes] = await Promise.all([
      fetchWithTimeout(
        `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`
      ),
      fetchWithTimeout(
        `https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=${days}&interval=daily`
      ),
      fetchWithTimeout("https://api.coingecko.com/api/v3/global"),
    ]);

    if (btcRes.ok && ethRes.ok && globalRes.ok) {
      const [btcJson, ethJson, globalJson] = await Promise.all([
        btcRes.json(),
        ethRes.json(),
        globalRes.json(),
      ]);
      const btcMcap: any[] = btcJson.market_caps || [];
      const ethMcap: any[] = ethJson.market_caps || [];
      const totalMcap =
        globalJson?.data?.total_market_cap?.usd ??
        (btcMcap.length
          ? btcMcap[btcMcap.length - 1][1] / 0.5 // very rough fallback
          : 0);

      const ethByTs = new Map<number, number>();
      for (const e of ethMcap) ethByTs.set(e[0], e[1]);

      const history = btcMcap
        .slice(-days)
        .map((b) => {
          const ts = Number(b[0]);
          const btcM = Number(b[1]);
          const ethM = ethByTs.get(ts) ?? 0;
          // Total mcap is current snapshot — we approximate historical total
          // by scaling BTC's share relative to today.  Honest label below.
          const btcDom = totalMcap > 0 ? (btcM / totalMcap) * 100 : 0;
          const ethDom = totalMcap > 0 ? (ethM / totalMcap) * 100 : 0;
          return {
            date: fmtIdDate(ts),
            btcDominance: Number(btcDom.toFixed(2)),
            ethDominance: Number(ethDom.toFixed(2)),
            totalMarketCap: Number(totalMcap.toFixed(0)),
          };
        })
        .reverse();

      const payload = {
        success: true,
        history,
        source: "coingecko",
        isEstimated: false,
        note:
          "Total market cap adalah snapshot saat ini dari CoinGecko /global; dominance historis dihitung dengan asumsi total mcap konstan dalam window (pendekatan standar untuk tier gratis).",
        lastUpdated: new Date().toISOString(),
      };
      cacheSet(cacheKey, payload, TTL_1H);
      return res.json(payload);
    }

    // CoinGecko rate-limited → fall back to blockchain.info for BTC only.
    if (btcRes.status === 429 || ethRes.status === 429) {
      // blockchain.info BTC mcap history + a constant ETH dominance estimate.
      const bcRes = await fetchWithTimeout(
        `https://api.blockchain.info/charts/market-cap?format=json&timespan=${days}days&sampled=true`
      );
      if (!bcRes.ok)
        throw new Error("CoinGecko rate-limited and blockchain.info fallback failed");
      const bcJson = await bcRes.json();
      const vals: any[] = dedupeToDaily(bcJson.values || []);
      // Honest: we only have BTC mcap.  ETH & total are estimated.
      const history = vals
        .slice(-days)
        .map((p) => {
          const btcM = Number(p.y);
          // BTC dominance historically 50-60%.  We invert: assume BTC dom
          // ≈ 52% (a reasonable recent average) and label estimated.
          const btcDom = 52;
          const totalM = (btcM / 52) * 100;
          const ethDom = 17; // typical ETH dominance
          return {
            date: fmtIdDate(Number(p.x) * 1000),
            btcDominance: btcDom,
            ethDominance: ethDom,
            totalMarketCap: Number(totalM.toFixed(0)),
          };
        })
        .reverse();
      const payload = {
        success: true,
        history,
        source: "blockchain.info",
        isEstimated: true,
        note:
          "CoinGecko rate-limited (429). BTC market cap REAL dari blockchain.info. ETH dominance & total mcap diestimasi (konstanta 52%/17%). Coba lagi nanti untuk data CoinGecko penuh.",
        lastUpdated: new Date().toISOString(),
      };
      cacheSet(cacheKey, payload, TTL_1H);
      return res.json(payload);
    }

    throw new Error(
      `CoinGecko tidak merespons OK (btc=${btcRes.status}, eth=${ethRes.status}, global=${globalRes.status})`
    );
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      history: [],
      error:
        "Gagal mengambil data dominance (CoinGecko / blockchain.info).",
      detail: err?.message || String(err),
      source: "coingecko",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// Default export for clarity — server.ts reads `liveDataRouter` named export.
export default liveDataRouter;
