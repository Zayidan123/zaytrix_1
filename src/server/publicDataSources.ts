// =============================================================================
// publicDataSources.ts — FREE, NO-KEY data sources for ZAYTRIX
// =============================================================================
// Each source uses only public endpoints. No API key required.
// Sources: Fear&Greed, FRED, Binance futures, Yahoo Finance, CoinMetrics,
//          DefiLlama, CoinGecko, mempool.space, etc.
// All endpoints are PUBLIC, rate-limited, cached, with honest error handling.
// =============================================================================

import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { fetchWithTimeout } from "./httpUtils";
import { cacheGet, cacheSet } from "./liveDataRoutes";
import * as cheerio from "cheerio";

export const publicDataRouter = express.Router();

// Rate limiter: 60 req/min/IP for public data endpoints
publicDataRouter.use(
  "/api/public",
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip || "unknown"),
    message: { success: false, error: "Rate limit exceeded. Coba lagi dalam 1 menit." },
  })
);

// TTL constants (ms)
const TTL_5M = 5 * 60 * 1000;
const TTL_1H = 60 * 60 * 1000;
const TTL_6H = 6 * 60 * 60 * 1000;
const TTL_24H = 24 * 60 * 60 * 1000;

// Helper: format date as Indonesian short
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

function fmtIso(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// --- Helpers for risk metrics & backtest -----------------------------------

/** Fetch Binance klines and return parsed history. Cached at module level. */
async function fetchBinanceKlines(
  symbol: string,
  days: number,
  interval: string = "1d"
): Promise<
  Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>
> {
  const cacheKey = `risk:klines:${symbol}:${days}:${interval}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return cached;

  // Deterministic mock klines for integration tests — keeps the suite reliable
  // when Binance is unreachable while still exercising the full metric pipeline.
  if (process.env.NODE_ENV === "test") {
    const history: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> = [];
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    let close = 50000;
    for (let i = 0; i < days; i++) {
      const open = close;
      // Deterministic pseudo-random walk: slight upward drift + oscillation
      // that guarantees EMA(21)/EMA(34) crossovers for the backtest.
      const ret = 0.0008 + Math.sin(i * 0.35) * 0.015 + Math.cos(i * 0.11) * 0.004;
      close = close * (1 + ret);
      const high = Math.max(open, close) * (1 + Math.abs(Math.sin(i * 1.3)) * 0.008);
      const low = Math.min(open, close) * (1 - Math.abs(Math.cos(i * 0.9)) * 0.008);
      const volume = Math.max(100, 1200 + Math.sin(i * 0.5) * 400);
      history.push({
        date: new Date(now - (days - i) * dayMs).toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
        volume,
      });
    }
    cacheSet(cacheKey, history, TTL_1H);
    return history;
  }

  const r = await fetchWithTimeout(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${days}`,
    {},
    10000
  );
  if (!r.ok) throw new Error(`Binance responded ${r.status}`);
  const data = await r.json();
  const history = data.map((d: any[]) => ({
    date: fmtIso(d[0]),
    open: Number(d[1]),
    high: Number(d[2]),
    low: Number(d[3]),
    close: Number(d[4]),
    volume: Number(d[5]),
  }));
  cacheSet(cacheKey, history, TTL_1H);
  return history;
}

/** Compute daily log returns from close prices. */
function computeLogReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  return returns;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

/** Inverse CDF of standard normal (rational approximation) for common confidence levels. */
function zScore(confidence: number): number {
  const zMap: Record<number, number> = {
    0.90: 1.282,
    0.95: 1.645,
    0.99: 2.326,
  };
  const rounded = Math.round(confidence * 1000) / 1000;
  if (zMap[rounded]) return zMap[rounded];
  if (confidence >= 0.999) return 3.090;
  if (confidence >= 0.995) return 2.576;
  if (confidence >= 0.99) return 2.326;
  if (confidence >= 0.975) return 1.960;
  if (confidence >= 0.95) return 1.645;
  if (confidence >= 0.90) return 1.282;
  if (confidence >= 0.50) return 0.674;
  return 1.645;
}

// =============================================================================
// 1. FEAR & GREED INDEX (Alternative.me — NO KEY)
//    GET /api/public/fear-greed?days=30
// =============================================================================
publicDataRouter.get("/api/public/fear-greed", async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `fng:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://api.alternative.me/fng/?limit=${days}&format=json`,
      {},
      10000
    );
    if (!r.ok) throw new Error(`Alternative.me responded ${r.status}`);
    const json = await r.json();
    const data = json.data || [];
    const history = data.map((d: any) => ({
      date: new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10),
      value: Number(d.value),
      label: d.value_classification,
    }));
    const payload = {
      success: true,
      history,
      current: history[0] || null,
      source: "alternative.me",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil Fear & Greed Index dari Alternative.me.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "alternative.me",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 2. FRED MACRO DATA (Federal Reserve — NO KEY)
//    GET /api/public/fred?series=FEDFUNDS&days=90
//    Supported: FEDFUNDS, DGS10, DGS2Y, CPIAUCSL, DEXUSEU, UMPRATE
// =============================================================================
const FRED_SERIES: Record<string, string> = {
  FEDFUNDS: "Federal Funds Rate (%)",
  DGS10: "10-Year Treasury Yield (%)",
  DGS2Y: "2-Year Treasury Yield (%)",
  CPIAUCSL: "Consumer Price Index (CPI)",
  DEXUSEU: "EUR/USD Exchange Rate",
  UMPRATE: "Unemployment Rate (%)",
  T10Y2Y: "10Y-2Y Spread (%)",
};

publicDataRouter.get("/api/public/fred", async (req, res) => {
  const series = String(req.query.series || "FEDFUNDS").toUpperCase();
  if (!FRED_SERIES[series]) {
    return res.status(400).json({
      success: false,
      error: `Series '${series}' tidak didukung. Pilih: ${Object.keys(FRED_SERIES).join(", ")}`,
    });
  }
  const days = Math.min(Math.max(parseInt(String(req.query.days || "90"), 10) || 90, 1), 365);
  const cacheKey = `fred:${series}:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    // FRED public CSV endpoint — no API key needed
    const r = await fetchWithTimeout(
      `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`,
      {},
      15000
    );
    if (!r.ok) throw new Error(`FRED responded ${r.status}`);
    const csv = await r.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) throw new Error("FRED returned empty data");
    const history = lines
      .slice(1)
      .map((line) => {
        const [date, value] = line.split(",");
        return { date, value: value === "." ? null : Number(value) };
      })
      .filter((d) => d.value !== null && !isNaN(d.value))
      .slice(-days);
    const payload = {
      success: true,
      series,
      seriesName: FRED_SERIES[series],
      history,
      source: "fred.stlouisfed.org",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: `Gagal mengambil data FRED untuk ${series}.`,
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "fred.stlouisfed.org",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 3. BINANCE FUTURES FUNDING RATE (Binance — NO KEY)
//    GET /api/public/funding-rate?symbol=BTCUSDT&days=30
// =============================================================================
publicDataRouter.get("/api/public/funding-rate", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `funding:${symbol}:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=${days}`,
      {},
      10000
    );
    if (!r.ok) throw new Error(`Binance Futures responded ${r.status}`);
    const data = await r.json();
    const history = data.map((d: any) => ({
      date: fmtIso(d.fundingTime),
      fundingRate: Number(d.fundingRate),
    }));
    const payload = {
      success: true,
      symbol,
      history,
      source: "binance_futures",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_5M);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil Funding Rate dari Binance.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "binance_futures",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 4. BINANCE FUTURES OPEN INTEREST (Binance — NO KEY)
//    GET /api/public/open-interest?symbol=BTCUSDT&period=1d&days=30
// =============================================================================
publicDataRouter.get("/api/public/open-interest", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 90);
  const cacheKey = `oi:${symbol}:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1d&limit=${days}`,
      {},
      10000
    );
    if (!r.ok) throw new Error(`Binance Futures responded ${r.status}`);
    const data = await r.json();
    const history = data.map((d: any) => ({
      date: fmtIso(d.timestamp),
      openInterest: Number(d.sumOpenInterestValue),
      openInterestContracts: Number(d.sumOpenInterest),
    }));
    const payload = {
      success: true,
      symbol,
      history,
      source: "binance_futures",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_5M);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil Open Interest dari Binance.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "binance_futures",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 5. YAHOO FINANCE CHART (Yahoo — NO KEY)
//    GET /api/public/yahoo?symbol=^GSPC&range=3mo&interval=1d
//    Supported: ^GSPC (S&P500), ^DJI (Dow Jones), DX-Y.NYB (DXY)
// =============================================================================
const YAHOO_SYMBOLS: Record<string, string> = {
  "^GSPC": "S&P 500",
  "^DJI": "Dow Jones",
  "^IXIC": "NASDAQ",
  "DX-Y.NYB": "US Dollar Index (DXY)",
  "^TNX": "10-Year Treasury Yield",
  "^VIX": "VIX (Volatility Index)",
  "^N225": "Nikkei 225",
  "^HSI": "Hang Seng",
};

publicDataRouter.get("/api/public/yahoo", async (req, res) => {
  const symbol = String(req.query.symbol || "^GSPC");
  // Validate/sanitize URL parameters to prevent query-string injection on
  // the upstream Yahoo Finance request (an attacker could otherwise inject
  // arbitrary query parameters into the outbound URL).
  const range = String(req.query.range || "3mo").replace(/[^a-zA-Z0-9._-]/g, "");
  const interval = String(req.query.interval || "1d").replace(/[^a-zA-Z0-9._-]/g, "");
  const cacheKey = `yahoo:${symbol}:${range}:${interval}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
      {},
      10000
    );
    if (!r.ok) throw new Error(`Yahoo Finance responded ${r.status}`);
    const json = await r.json();
    const result = json.chart?.result?.[0];
    if (!result) throw new Error("No data from Yahoo Finance");
    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const history = timestamps.map((ts: number, i: number) => ({
      date: fmtIso(ts * 1000),
      open: quotes.open?.[i],
      high: quotes.high?.[i],
      low: quotes.low?.[i],
      close: quotes.close?.[i],
      volume: quotes.volume?.[i],
    }));
    const payload = {
      success: true,
      symbol,
      name: YAHOO_SYMBOLS[symbol] || symbol,
      range,
      interval,
      history,
      source: "yahoo_finance",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: `Gagal mengambil data Yahoo Finance untuk ${symbol}.`,
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "yahoo_finance",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 6. DEFINAMA PROTOCOL DATA (DefiLlama — NO KEY)
//    GET /api/public/defillama/tvl?protocol=aave
//    GET /api/public/defillama/yields?pool=ethereum-0x... (optional)
// =============================================================================
publicDataRouter.get("/api/public/defillama/tvl", async (req, res) => {
  const protocol = String(req.query.protocol || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!protocol) {
    return res.status(400).json({ success: false, error: "Parameter 'protocol' diperlukan." });
  }
  const cacheKey = `llama:tvl:${protocol}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://api.llama.fi/protocol/${protocol}`,
      {},
      15000
    );
    if (!r.ok) throw new Error(`DefiLlama responded ${r.status}`);
    const json = await r.json();
    const tvlHistory = (json.tvl || []).slice(-90).map((d: any) => ({
      date: fmtIso(d.date * 1000),
      tvl: Number(d.totalLiquidityUSD || 0),
    }));
    const payload = {
      success: true,
      protocol,
      name: json.name || protocol,
      category: json.category,
      description: json.description,
      url: json.url,
      tvlHistory,
      currentTvl: tvlHistory[tvlHistory.length - 1]?.tvl || 0,
      source: "defillama",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: `Gagal mengambil data TVL dari DefiLlama untuk ${protocol}.`,
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "defillama",
      lastUpdated: new Date().toISOString(),
    });
  }
});

publicDataRouter.get("/api/public/defillama/yields", async (_req, res) => {
  const cacheKey = "llama:yields:top";
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://yields.llama.fi/pools`,
      {},
      15000
    );
    if (!r.ok) throw new Error(`DefiLlama Yields responded ${r.status}`);
    const json = await r.json();
    const pools = (json.data || [])
      .sort((a: any, b: any) => (b.apy || 0) - (a.apy || 0))
      .slice(0, 50)
      .map((p: any) => ({
        pool: p.pool,
        project: p.project,
        symbol: p.symbol,
        chain: p.chain,
        apy: Number(p.apy || 0),
        tvlUsd: Number(p.tvlUsd || 0),
        stablecoin: p.stablecoin,
        il7d: p.il7d,
      }));
    const payload = {
      success: true,
      pools,
      source: "defillama_yields",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data Yield dari DefiLlama.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "defillama_yields",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 7. COINMETRICS COMMUNITY (CoinMetrics — NO KEY)
//    GET /api/public/coinmetrics?asset=btc&metric=AdrActCnt&days=30
// =============================================================================
const CM_METRICS = ["AdrActCnt", "TxTfrValAdjUSD", "NVTAdj", "CapMrktCurUSD", "PriceUSD", "SplyCur"];

publicDataRouter.get("/api/public/coinmetrics", async (req, res) => {
  const asset = String(req.query.asset || "btc").toLowerCase().replace(/[^a-z]/g, "");
  const metric = String(req.query.metric || "AdrActCnt");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 365);
  if (!CM_METRICS.includes(metric)) {
    return res.status(400).json({ success: false, error: `Metric '${metric}' tidak didukung. Pilih: ${CM_METRICS.join(", ")}` });
  }
  const cacheKey = `cm:${asset}:${metric}:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics/?assets=${asset}&metrics=${metric}&frequency=1d&page_size=${days + 5}`,
      {},
      15000
    );
    if (!r.ok) throw new Error(`CoinMetrics responded ${r.status}`);
    const json = await r.json();
    const data = json.data || [];
    const history = data.slice(-days).map((d: any) => ({
      date: fmtIso(new Date(d.time).getTime()),
      value: Number(d[metric] || 0),
    }));
    const payload = {
      success: true,
      asset,
      metric,
      history,
      source: "coinmetrics_community",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: `Gagal mengambil data CoinMetrics (${metric}).`,
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "coinmetrics_community",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 8. GITHUB TRENDING (GitHub — NO KEY, public HTML scraping)
//    GET /api/public/github/trending?language=&since=daily
// =============================================================================
publicDataRouter.get("/api/public/github/trending", async (req, res) => {
  // Sanitize query params — language restricted to known safe values,
  // since since is passed into a URL path+query string to the upstream.
  const languageRaw = String(req.query.language || "");
  const sinceRaw = String(req.query.since || "daily");
  const LANGUAGE_ALLOWLIST = new Set([
    "", "javascript", "python", "typescript", "rust", "go", "java",
    "c", "cpp", "csharp", "ruby", "php", "swift", "kotlin", "scala",
    "elixir", "haskell", "clojure", "racket", "erlang", "lua",
    "shell", "bash", "powershell", "dockerfile", "makefile",
    "html", "css", "sql", "graphql", "yaml", "json", "xml",
    "markdown", "text", "plaintext",
  ]);
  const language = LANGUAGE_ALLOWLIST.has(languageRaw.toLowerCase()) ? languageRaw : "";
  const since = sinceRaw.replace(/[^a-zA-Z0-9-]/g, "");
  const cacheKey = `gh:trending:${language}:${since}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `https://github.com/trending${language ? "/" + language : ""}?since=${since}`;
    const r = await fetchWithTimeout(url, {
      headers: { Accept: "text/html" },
    }, 15000);
    if (!r.ok) throw new Error(`GitHub responded ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);
    const repos: any[] = [];
    $("article.Box-row").each((_, el) => {
      const name = $(el).find("h2 a").attr("href")?.trim().replace(/^\//, "");
      const desc = $(el).find("p").text().trim();
      const lang = $(el).find("[itemprop='programmingLanguage']").text().trim();
      const stars = $(el).find("span.d-inline-block.float-sm-right").text().trim().replace(/[,\s]/g, "");
      if (name) repos.push({ name, description: desc, language: lang, stars: Number(stars) || 0 });
    });
    const payload = {
      success: true,
      language: language || "all",
      since,
      repos: repos.slice(0, 25),
      source: "github_trending",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil GitHub Trending.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "github_trending",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 9. CRYPTO QUOTES (CoinGecko — NO KEY, rate-limited)
//    GET /api/public/quotes?ids=bitcoin,ethereum&vs_currencies=usd
// =============================================================================
publicDataRouter.get("/api/public/quotes", async (req, res) => {
  // Sanitize query params to prevent query-string injection on the
  // upstream CoinGecko request.
  const ids = String(req.query.ids || "bitcoin,ethereum").replace(/[^a-zA-Z0-9,]/g, "");
  const vs = String(req.query.vs_currencies || "usd").replace(/[^a-zA-Z0-9,]/g, "");
  const cacheKey = `quotes:${ids}:${vs}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`,
      {},
      10000
    );
    if (!r.ok) throw new Error(`CoinGecko responded ${r.status}`);
    const json = await r.json();
    const payload = {
      success: true,
      quotes: json,
      source: "coingecko",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_5M);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil harga dari CoinGecko.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "coingecko",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 10. HISTORICAL KLINE (Binance — NO KEY, for backtesting)
//     GET /api/public/kline?symbol=BTCUSDT&interval=1d&limit=90
// =============================================================================
publicDataRouter.get("/api/public/kline", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const interval = String(req.query.interval || "1d").replace(/[^a-zA-Z0-9]/g, "");
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "90"), 10) || 90, 1), 1000);
  const cacheKey = `kline:${symbol}:${interval}:${limit}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      {},
      10000
    );
    if (!r.ok) throw new Error(`Binance responded ${r.status}`);
    const data = await r.json();
    const history = data.map((d: any[]) => ({
      date: fmtIso(d[0]),
      open: Number(d[1]),
      high: Number(d[2]),
      low: Number(d[3]),
      close: Number(d[4]),
      volume: Number(d[5]),
    }));
    const payload = {
      success: true,
      symbol,
      interval,
      history,
      source: "binance",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data kline dari Binance.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 11. TOKEN UNLOCKS (Token Unlocks — scraping public page)
//     GET /api/public/token-unlocks
// =============================================================================
publicDataRouter.get("/api/public/token-unlocks", async (_req, res) => {
  const cacheKey = "token-unlocks";
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://tokenunlocks.app/`,
      { headers: { Accept: "text/html" } },
      15000
    );
    if (!r.ok) throw new Error(`TokenUnlocks responded ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);
    const unlocks: any[] = [];
    // Try to extract upcoming unlock events from the page
    $("table tbody tr").each((_, el) => {
      const cells = $(el).find("td");
      if (cells.length >= 3) {
        unlocks.push({
          token: $(cells[0]).text().trim(),
          date: $(cells[1]).text().trim(),
          details: $(cells[2]).text().trim(),
        });
      }
    });
    const payload = {
      success: true,
      unlocks: unlocks.slice(0, 20),
      source: "tokenunlocks",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data Token Unlocks.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "tokenunlocks",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 12. COINMARKETCAP (Public — NO KEY, scraping)
//     GET /api/public/cmc/trending
// =============================================================================
publicDataRouter.get("/api/public/cmc/trending", async (_req, res) => {
  const cacheKey = "cmc:trending";
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/search/trending`,
      {},
      10000
    );
    if (!r.ok) throw new Error(`CoinGecko trending responded ${r.status}`);
    const json = await r.json();
    const coins = (json.coins || []).map((c: any) => ({
      name: c.item?.name,
      symbol: c.item?.symbol,
      marketCapRank: c.item?.market_cap_rank,
      score: c.item?.score,
    }));
    const payload = {
      success: true,
      trending: coins,
      source: "coingecko_trending",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil trending coins.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "coingecko_trending",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 13. COINGLASS PROXY (Binance Futures — NO KEY)
//     GET /api/public/coinglass/long-short?symbol=BTCUSDT
//     Uses Binance public endpoints as proxy for Coinglass data
// =============================================================================
publicDataRouter.get("/api/public/coinglass/long-short", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cacheKey = `cg:ls:${symbol}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [takerRes, topTraderRes] = await Promise.all([
      fetchWithTimeout(
        `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=1d&limit=1`,
        {},
        10000
      ),
      fetchWithTimeout(
        `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=1d&limit=1`,
        {},
        10000
      ),
    ]);
    const taker = takerRes.ok ? await takerRes.json() : [];
    const top = topTraderRes.ok ? await topTraderRes.json() : [];
    const takerLatest = taker[0] || {};
    const topLatest = top[0] || {};
    const payload = {
      success: true,
      symbol,
      takerBuySellRatio: Number(takerLatest.buySellRatio) || null,
      topTraderAccountRatio: Number(topLatest.longShortRatio) || null,
      topTraderLongPct: Number(topLatest.longAccount) * 100 || null,
      topTraderShortPct: Number(topLatest.shortAccount) * 100 || null,
      source: "binance_futures_proxy",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_5M);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data Long/Short dari Binance (Coinglass proxy).",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "binance_futures_proxy",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 14. SOURCES STATUS — check which data sources are reachable
//     GET /api/public/sources-status
// =============================================================================
publicDataRouter.get("/api/public/sources-status", async (_req, res) => {
  const sources = [
    { name: "Alternative.me Fear & Greed", url: "https://api.alternative.me/fng/?limit=1&format=json", type: "json" },
    { name: "FRED Economic Data", url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS", type: "csv" },
    { name: "Binance Futures", url: "https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1", type: "json" },
    { name: "Yahoo Finance", url: "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1d&interval=1d", type: "json" },
    { name: "CoinMetrics Community", url: "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics/?assets=btc&metrics=PriceUSD&page_size=1", type: "json" },
    { name: "DefiLlama", url: "https://api.llama.fi/protocol/aave", type: "json" },
    { name: "CoinGecko", url: "https://api.coingecko.com/api/v3/ping", type: "json" },
    { name: "GitHub Trending", url: "https://github.com/trending", type: "html" },
    { name: "mempool.space", url: "https://mempool.space/api/v1/mining/hashrate/1m", type: "json" },
  ];
  const results = await Promise.allSettled(
    sources.map(async (s) => {
      const start = Date.now();
      try {
        const r = await fetchWithTimeout(s.url, {}, 8000);
        const ms = Date.now() - start;
        return { name: s.name, type: s.type, status: r.ok ? "healthy" : "degraded", http: r.status, latencyMs: ms };
      } catch (err: any) {
        const ms = Date.now() - start;
        return { name: s.name, type: s.type, status: "down", error: "Upstream tidak dapat dijangkau.", latencyMs: ms };
      }
    })
  );
  return res.json({
    success: true,
    sources: results.map((r) => (r.status === "fulfilled" ? r.value : { name: "unknown", status: "error", error: String(r.reason) })),
    lastUpdated: new Date().toISOString(),
  });
});

// =============================================================================
// 15. RISK METRICS — Parametric VaR
//     GET /api/public/risk/var?symbol=BTCUSDT&days=90&confidence=0.95
//     parametric VaR = mean + z*sigma (z from confidence level)
// =============================================================================
publicDataRouter.get("/api/public/risk/var", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "90"), 10) || 90, 1), 90);
  const confidence = parseFloat(String(req.query.confidence || "0.95")) || 0.95;
  const cacheKey = `risk:var:${symbol}:${days}:${confidence}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const history = await fetchBinanceKlines(symbol, days);
    const closes = history.map((h: any) => h.close);
    const returns = computeLogReturns(closes);
    const mu = mean(returns);
    const sigma = stdDev(returns);
    const z = zScore(confidence);
    const paramVar = mu + z * sigma;

    const payload = {
      success: true,
      metric: {
        var: paramVar,
        varLoss: -paramVar,
        mean: mu,
        stdDev: sigma,
        confidence,
        z,
      },
      history: returns.map((r, i) => ({
        date: history[i + 1]?.date ?? null,
        logReturn: r,
      })),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal menghitung Value at Risk.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 16. RISK METRICS — Kelly Criterion
//     GET /api/public/risk/kelly?symbol=BTCUSDT&days=90
// =============================================================================
publicDataRouter.get("/api/public/risk/kelly", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "90"), 10) || 90, 1), 90);
  const cacheKey = `risk:kelly:${symbol}:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const history = await fetchBinanceKlines(symbol, days);
    const closes = history.map((h: any) => h.close);
    const returns = computeLogReturns(closes);

    let wins = 0;
    let losses = 0;
    let totalWin = 0;
    let totalLoss = 0;

    for (const r of returns) {
      if (r > 0) {
        wins++;
        totalWin += r;
      } else if (r < 0) {
        losses++;
        totalLoss += Math.abs(r);
      }
    }

    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const avgWin = wins > 0 ? totalWin / wins : 0;
    const avgLoss = losses > 0 ? totalLoss / losses : 0;
    const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    const kellyCriterion = winLossRatio > 0 ? (winLossRatio * winRate - (1 - winRate)) / winLossRatio : 0;

    const payload = {
      success: true,
      metric: {
        kellyCriterion,
        kellyPercent: kellyCriterion * 100,
        winRate,
        avgWin,
        avgLoss,
        winLossRatio,
        totalTrades,
      },
      history: returns.map((r, i) => ({
        date: history[i + 1]?.date ?? null,
        logReturn: r,
        signal: r > 0 ? "win" : r < 0 ? "loss" : "flat",
      })),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal menghitung Kelly Criterion.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 17. RISK METRICS — Sharpe Ratio
//     GET /api/public/risk/sharpe?symbol=BTCUSDT&days=90&riskFreeRate=0.05
//     Sharpe = (mean_return - risk_free_daily) / std_return * sqrt(365)
// =============================================================================
publicDataRouter.get("/api/public/risk/sharpe", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "90"), 10) || 90, 1), 90);
  const riskFreeRate = parseFloat(String(req.query.riskFreeRate || "0.05")) || 0.05;
  const cacheKey = `risk:sharpe:${symbol}:${days}:${riskFreeRate}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const history = await fetchBinanceKlines(symbol, days);
    const closes = history.map((h: any) => h.close);
    const returns = computeLogReturns(closes);
    const mu = mean(returns);
    const sigma = stdDev(returns);
    const rfDaily = riskFreeRate / 365;
    const sharpeRatio = sigma > 0 ? (mu - rfDaily) / sigma * Math.sqrt(365) : 0;

    const payload = {
      success: true,
      metric: {
        sharpeRatio,
        annualizedReturn: mu * 365,
        annualizedStdDev: sigma * Math.sqrt(365),
        meanDailyReturn: mu,
        stdDailyReturn: sigma,
        riskFreeRate,
        riskFreeRateDaily: rfDaily,
      },
      history: returns.map((r, i) => ({
        date: history[i + 1]?.date ?? null,
        logReturn: r,
      })),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal menghitung Sharpe Ratio.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 18. RISK METRICS — Sortino Ratio
//     GET /api/public/risk/sortino?symbol=BTCUSDT&days=90
//     Sortino = (mean_return - target) / downside_deviation * sqrt(365)
// =============================================================================
publicDataRouter.get("/api/public/risk/sortino", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "90"), 10) || 90, 1), 90);
  const cacheKey = `risk:sortino:${symbol}:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const history = await fetchBinanceKlines(symbol, days);
    const closes = history.map((h: any) => h.close);
    const returns = computeLogReturns(closes);
    const mu = mean(returns);
    const downsideReturns = returns.filter((r) => r < 0);
    const downsideDev = downsideReturns.length > 0 ? stdDev(downsideReturns) * Math.sqrt(365) : 0;
    const sortinoRatio = downsideDev > 0 ? (mu - 0) / downsideDev * Math.sqrt(365) : 0;

    const payload = {
      success: true,
      metric: {
        sortinoRatio,
        annualizedReturn: mu * 365,
        annualizedStdDev: stdDev(returns) * Math.sqrt(365),
        downsideDeviation: downsideDev,
        meanDailyReturn: mu,
      },
      history: returns.map((r, i) => ({
        date: history[i + 1]?.date ?? null,
        logReturn: r,
      })),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal menghitung Sortino Ratio.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 19. SIMPLE BACKTEST — EMA crossover
//     GET /api/public/backtest/simple?symbol=BTCUSDT&strategy=cross_ema
//     &days=90&interval=1d
//     fast EMA=21, slow EMA=34, BUY on cross up, SELL on cross down
// =============================================================================
publicDataRouter.get("/api/public/backtest/simple", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const strategy = String(req.query.strategy || "cross_ema").toLowerCase();
  // Sanitize interval to prevent injection into the outbound Binance URL.
  const interval = String(req.query.interval || "1d").replace(/[^a-zA-Z0-9]/g, "");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "90"), 10) || 90, 1), 90);
  const cacheKey = `risk:backtest:${symbol}:${strategy}:${days}:${interval}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  if (strategy !== "cross_ema") {
    return res.json({
      success: false,
      error: `Strategy '${strategy}' tidak didukung. Gunakan 'cross_ema'.`,
      source: "binance",
      lastUpdated: new Date().toISOString(),
    });
  }

  try {
    const history = await fetchBinanceKlines(symbol, days, interval);
    const closes = history.map((h: any) => h.close);

    const fastPeriod = 21;
    const slowPeriod = 34;

    function ema(prices: number[], period: number): number[] {
      const result: number[] = [];
      const k = 2 / (period + 1);
      let prev = prices[0];
      result.push(prev);
      for (let i = 1; i < prices.length; i++) {
        prev = prices[i] * k + prev * (1 - k);
        result.push(prev);
      }
      return result;
    }

    const emaFastArr = ema(closes, fastPeriod);
    const emaSlowArr = ema(closes, slowPeriod);

    type Position = "LONG" | "FLAT";
    let position: Position = "FLAT";
    let portfolio = 1;
    let peak = portfolio;
    let maxDrawdown = 0;
    let wins = 0;
    let losses = 0;
    let entryPrice = 0;
    const returns: number[] = [];
    const signals: Array<{
      date: string;
      close: number;
      signal: "BUY" | "SELL" | "HOLD";
      position: Position;
      emaFast: number;
      emaSlow: number;
    }> = [];

    for (let i = 1; i < closes.length; i++) {
      if (i < slowPeriod) {
        signals.push({
          date: history[i].date,
          close: closes[i],
          signal: "SELL",
          position,
          emaFast: emaFastArr[i],
          emaSlow: emaSlowArr[i],
        });
        continue;
      }

      const fast = emaFastArr[i];
      const slow = emaSlowArr[i];
      const prevFast = emaFastArr[i - 1];
      const prevSlow = emaSlowArr[i - 1];

      // BUY: fast crosses above slow
      if (prevFast <= prevSlow && fast > slow && position !== "LONG") {
        position = "LONG";
        entryPrice = closes[i];
        signals.push({
          date: history[i].date,
          close: closes[i],
          signal: "BUY",
          position,
          emaFast: fast,
          emaSlow: slow,
        });
      }
      // SELL: fast crosses below slow
      else if (prevFast >= prevSlow && fast < slow && position === "LONG") {
        const tradeReturn = (closes[i] - entryPrice) / entryPrice;
        portfolio *= 1 + tradeReturn;
        returns.push(tradeReturn);
        if (tradeReturn > 0) wins++;
        else if (tradeReturn < 0) losses++;
        position = "FLAT";
        signals.push({
          date: history[i].date,
          close: closes[i],
          signal: "SELL",
          position,
          emaFast: fast,
          emaSlow: slow,
        });
      } else {
        signals.push({
          date: history[i].date,
          close: closes[i],
          signal: position === "LONG" ? "HOLD" : "SELL",
          position,
          emaFast: fast,
          emaSlow: slow,
        });
      }

      if (portfolio > peak) peak = portfolio;
      const dd = peak > 0 ? (peak - portfolio) / peak : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const totalReturn = portfolio - 1;
    const winRate = returns.length > 0 ? wins / returns.length : 0;

    const payload = {
      success: true,
      metric: {
        totalReturn,
        finalPortfolio: portfolio,
        maxDrawdown,
        winRate,
        totalTrades: wins + losses,
        wins,
        losses,
        strategy: "cross_ema",
        fastPeriod,
        slowPeriod,
      },
      history: returns.map((r, i) => ({
        date: history[i]?.date ?? null,
        logReturn: r,
      })),
      signals: signals.slice(-days),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal menjalankan backtest.",
      // In production avoid leaking upstream error details; in dev include for visibility.
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "binance",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 20. REDDIT CRYPTO SENTIMENT (Reddit public JSON — NO KEY)
//     GET /api/public/reddit/crypto?subreddit=cryptocurrency&limit=25
//     Uses Reddit's public .json endpoint with a descriptive User-Agent.
// =============================================================================
publicDataRouter.get("/api/public/reddit/crypto", async (req, res) => {
  const subreddit = String(req.query.subreddit || "cryptocurrency")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "25"), 10) || 25, 1), 100);
  const cacheKey = `reddit:${subreddit}:${limit}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}&raw_json=1`,
      {
        headers: {
          "User-Agent": "ZAYTRIX/1.0 (public data aggregator, no-key)",
          Accept: "application/json",
        },
      },
      12000
    );
    if (!r.ok) throw new Error(`Reddit responded ${r.status}`);
    const json = await r.json();
    const posts = (json.data?.children || [])
      .map((d: any) => d.data)
      .filter((d: any) => d && !d.stickied)
      .slice(0, limit)
      .map((d: any) => ({
        title: d.title,
        score: Number(d.score) || 0,
        comments: Number(d.num_comments) || 0,
        upvoteRatio: Number(d.upvote_ratio) || null,
        author: d.author,
        createdUtc: d.created_utc ? fmtIso(d.created_utc * 1000) : null,
        url: d.url,
        flair: d.link_flair_text,
      }));
    const totalScore = posts.reduce((sum: number, p: any) => sum + (p.score || 0), 0);
    const totalComments = posts.reduce((sum: number, p: any) => sum + (p.comments || 0), 0);
    const payload = {
      success: true,
      subreddit,
      posts,
      summary: {
        posts: posts.length,
        totalScore,
        totalComments,
        avgUpvoteRatio:
          posts.length > 0
            ? posts.reduce((sum: number, p: any) => sum + (p.upvoteRatio || 0), 0) / posts.length
            : null,
      },
      source: "reddit_public_json",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data Reddit.",
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "reddit_public_json",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 21. STACKEXCHANGE CRYPTO Q&A (StackExchange API — NO KEY)
//     GET /api/public/stackexchange/crypto?site=bitcoin&tag=cryptocurrency
//     Public API works without an API key (lower rate limits).
// =============================================================================
publicDataRouter.get("/api/public/stackexchange/crypto", async (req, res) => {
  const site = String(req.query.site || "bitcoin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const tag = String(req.query.tag || "cryptocurrency").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 100);
  const cacheKey = `stackexchange:${site}:${tag}:${limit}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://api.stackexchange.com/2.3/questions?site=${site}&tagged=${tag}&sort=activity&order=desc&pagesize=${limit}&filter=default`,
      {},
      12000
    );
    if (!r.ok) throw new Error(`StackExchange responded ${r.status}`);
    const json = await r.json();
    const questions = (json.items || []).map((q: any) => ({
      title: q.title,
      link: q.link,
      score: Number(q.score) || 0,
      answers: Number(q.answer_count) || 0,
      views: Number(q.view_count) || 0,
      isAnswered: q.is_answered,
      creationDate: q.creation_date ? fmtIso(q.creation_date * 1000) : null,
      lastActivityDate: q.last_activity_date ? fmtIso(q.last_activity_date * 1000) : null,
      tags: q.tags || [],
    }));
    const payload = {
      success: true,
      site,
      tag,
      questions,
      summary: {
        questions: questions.length,
        totalViews: questions.reduce((sum: number, q: any) => sum + (q.views || 0), 0),
        answered: questions.filter((q: any) => q.isAnswered).length,
      },
      source: "stackexchange_api",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data StackExchange.",
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "stackexchange_api",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 22. WIKIPEDIA CRYPTO PAGEVIEWS (Wikimedia REST — NO KEY)
//     GET /api/public/wikipedia/pageviews?article=Bitcoin&days=30
//     Public pageview statistics for crypto-related Wikipedia articles.
// =============================================================================
publicDataRouter.get("/api/public/wikipedia/pageviews", async (req, res) => {
  const article = String(req.query.article || "Bitcoin").replace(/[^a-zA-Z0-9_]/g, "_");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 365);
  const cacheKey = `wiki:pageviews:${article}:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const from = start.toISOString().slice(0, 10).replace(/-/g, "");
    const to = end.toISOString().slice(0, 10).replace(/-/g, "");
    const r = await fetchWithTimeout(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${article}/daily/${from}00/${to}00`,
      {},
      12000
    );
    if (!r.ok) throw new Error(`Wikimedia responded ${r.status}`);
    const json = await r.json();
    const history = (json.items || [])
      .slice(-days)
      .map((d: any) => ({
        date: fmtIso(new Date(`${d.timestamp.slice(0, 4)}-${d.timestamp.slice(4, 6)}-${d.timestamp.slice(6, 8)}`).getTime()),
        views: Number(d.views) || 0,
      }));
    const totalViews = history.reduce((sum: number, d: any) => sum + (d.views || 0), 0);
    const payload = {
      success: true,
      article,
      history,
      summary: {
        totalViews,
        avgDailyViews: history.length > 0 ? totalViews / history.length : 0,
        peakViews: history.length > 0 ? Math.max(...history.map((d: any) => d.views)) : 0,
      },
      source: "wikimedia_pageviews",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_24H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data Wikipedia pageviews.",
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "wikimedia_pageviews",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 23. HACKER NEWS CRYPTO SEARCH (Algolia HN API — NO KEY)
//     GET /api/public/hackernews/crypto?query=crypto&limit=20
//     Public search of Hacker News stories, useful for tech sentiment.
// =============================================================================
publicDataRouter.get("/api/public/hackernews/crypto", async (req, res) => {
  const query = String(req.query.query || "crypto").trim().slice(0, 100);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 100);
  const cacheKey = `hn:crypto:${query}:${limit}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`,
      {},
      12000
    );
    if (!r.ok) throw new Error(`Hacker News responded ${r.status}`);
    const json = await r.json();
    const stories = (json.hits || []).map((h: any) => ({
      title: h.title,
      url: h.url,
      points: Number(h.points) || 0,
      comments: Number(h.num_comments) || 0,
      author: h.author,
      created: h.created_at,
    }));
    const payload = {
      success: true,
      query,
      stories,
      summary: {
        stories: stories.length,
        totalPoints: stories.reduce((sum: number, s: any) => sum + (s.points || 0), 0),
      },
      source: "hackernews_algolia",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data Hacker News.",
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "hackernews_algolia",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 24. MEMPOOL.SPACE BITCOIN NETWORK (Public — NO KEY)
//     GET /api/public/mempool/stats
//     Fee estimates, mempool backlog, and hashrate from mempool.space.
// =============================================================================
publicDataRouter.get("/api/public/mempool/stats", async (_req, res) => {
  const cacheKey = "mempool:stats";
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [feesRes, mempoolRes, hashrateRes] = await Promise.all([
      fetchWithTimeout(`https://mempool.space/api/v1/fees/recommended`, {}, 10000),
      fetchWithTimeout(`https://mempool.space/api/v1/mempool`, {}, 10000),
      fetchWithTimeout(`https://mempool.space/api/v1/mining/hashrate/1m`, {}, 10000),
    ]);
    const fees = feesRes.ok ? await feesRes.json() : null;
    const mempool = mempoolRes.ok ? await mempoolRes.json() : null;
    const hashrate = hashrateRes.ok ? await hashrateRes.json() : null;
    const payload = {
      success: true,
      fees: fees
        ? {
            fastestFee: fees.fastestFee,
            halfHourFee: fees.halfHourFee,
            hourFee: fees.hourFee,
            economyFee: fees.economyFee,
            minimumFee: fees.minimumFee,
          }
        : null,
      mempool: mempool
        ? {
            count: mempool.count,
            vsize: mempool.vsize,
            totalFee: mempool.total_fee,
          }
        : null,
      hashrate: hashrate ? hashrate : null,
      source: "mempool.space",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_5M);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data mempool Bitcoin.",
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "mempool.space",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 25. BLOCKCHAIN.COM BITCOIN STATS (Public — NO KEY)
//     GET /api/public/blockchain/stats
//     Core Bitcoin network statistics from blockchain.com public API.
// =============================================================================
publicDataRouter.get("/api/public/blockchain/stats", async (_req, res) => {
  const cacheKey = "blockchain:stats";
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(`https://api.blockchain.info/stats`, {}, 10000);
    if (!r.ok) throw new Error(`Blockchain.com responded ${r.status}`);
    const json = await r.json();
    const stats = {
      marketPriceUsd: json.market_price_usd,
      hashRate: json.hash_rate,
      difficulty: json.difficulty,
      blocksCount: json.n_blocks_total,
      blocksLast24h: json.n_blocks_mined,
      minutesBetweenBlocks: json.minutes_between_blocks,
      totalBtcSent: json.total_btc_sent,
      estimatedBtcSent: json.estimated_btc_sent,
      tradeVolumeBtc: json.trade_volume_btc,
      tradeVolumeUsd: json.trade_volume_usd,
      minersRevenueUsd: json.miners_revenue_usd,
      costPerTransaction: json.cost_per_transaction_percent,
      uniqueAddresses: json.n_unique_addresses,
    };
    const payload = {
      success: true,
      stats,
      source: "blockchain.com",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil statistik blockchain Bitcoin.",
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "blockchain.com",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 26. COINCAP PRICE DATA (Public — NO KEY)
//     GET /api/public/coincap/assets?limit=50
//     GET /api/public/coincap/history?asset=bitcoin&interval=d1&days=30
//     Free historical and current crypto price data.
// =============================================================================
publicDataRouter.get("/api/public/coincap/assets", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 100);
  const cacheKey = `coincap:assets:${limit}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(`https://api.coincap.io/v2/assets?limit=${limit}`, {}, 12000);
    if (!r.ok) throw new Error(`CoinCap responded ${r.status}`);
    const json = await r.json();
    const assets = (json.data || []).map((a: any) => ({
      id: a.id,
      rank: Number(a.rank) || null,
      symbol: a.symbol,
      name: a.name,
      priceUsd: a.priceUsd ? Number(a.priceUsd) : null,
      marketCapUsd: a.marketCapUsd ? Number(a.marketCapUsd) : null,
      volumeUsd24Hr: a.volumeUsd24Hr ? Number(a.volumeUsd24Hr) : null,
      changePercent24Hr: a.changePercent24Hr ? Number(a.changePercent24Hr) : null,
      vwap24Hr: a.vwap24Hr ? Number(a.vwap24Hr) : null,
    }));
    const payload = {
      success: true,
      assets,
      source: "coincap",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_5M);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data CoinCap.",
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "coincap",
      lastUpdated: new Date().toISOString(),
    });
  }
});

publicDataRouter.get("/api/public/coincap/history", async (req, res) => {
  const asset = String(req.query.asset || "bitcoin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const interval = String(req.query.interval || "d1");
  const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 365);
  const cacheKey = `coincap:history:${asset}:${interval}:${days}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      `https://api.coincap.io/v2/assets/${asset}/history?interval=${interval}`,
      {},
      12000
    );
    if (!r.ok) throw new Error(`CoinCap responded ${r.status}`);
    const json = await r.json();
    const history = (json.data || [])
      .slice(-days)
      .map((d: any) => ({
        date: fmtIso(d.time),
        priceUsd: d.priceUsd ? Number(d.priceUsd) : null,
      }));
    const payload = {
      success: true,
      asset,
      interval,
      history,
      source: "coincap",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_1H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: `Gagal mengambil history CoinCap untuk ${asset}.`,
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "coincap",
      lastUpdated: new Date().toISOString(),
    });
  }
});

// =============================================================================
// 27. DEFILLAMA CHAINS OVERVIEW (Public — NO KEY)
//     GET /api/public/defillama/chains
//     TVL ranking across all supported blockchains.
// =============================================================================
publicDataRouter.get("/api/public/defillama/chains", async (_req, res) => {
  const cacheKey = "llama:chains";
  const cached = cacheGet<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(`https://api.llama.fi/chains`, {}, 15000);
    if (!r.ok) throw new Error(`DefiLlama responded ${r.status}`);
    const chains = (await r.json())
      .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
      .slice(0, 50)
      .map((c: any) => ({
        name: c.name,
        tvl: Number(c.tvl || 0),
        tokenRatio: c.tokenRatio || null,
        change_1d: c.change_1d || null,
        change_7d: c.change_7d || null,
        change_1m: c.change_1m || null,
      }));
    const totalTvl = chains.reduce((sum: number, c: any) => sum + (c.tvl || 0), 0);
    const payload = {
      success: true,
      chains,
      summary: {
        chains: chains.length,
        totalTvl,
        topChain: chains[0]?.name || null,
      },
      source: "defillama",
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, payload, TTL_6H);
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      isEstimated: true,
      error: "Gagal mengambil data chains dari DefiLlama.",
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err?.message || String(err) }),
      source: "defillama",
      lastUpdated: new Date().toISOString(),
    });
  }
});
