// =============================================================================
// marketRoutes.ts — QA9-R3: market data endpoints — /api/history/:symbol,
// /api/assets(+register), /api/coins/tickers|global-stats|rankings,
// /api/stocks/fundamentals/:symbol. Extracted verbatim from server.ts
// (was 965-1786, 4978-5041); all caches are register-scoped (single call).
// =============================================================================
import type { Express } from "express";
import { z } from "zod";
import { fetchWithTimeout } from "./httpUtils";
import { liveAssets, assetsLiveReady, refreshLiveAssets, lastQuotesFetch, QUOTE_CACHE_TTL } from "./assetsStore";
import { requireAuth } from "./auth";
import { createLogger } from "./logger";

const log = createLogger("marketRoutes");





export function registerMarketRoutes(app: Express): void {
// real source fails we return 503 — the random-walk OHLCV generator that used
// to live here (plus its fabricated SMA/RSI series) was removed entirely.
app.get("/api/history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const asset = liveAssets.find(a => a.symbol === symbol);
  if (!asset) {
    return res.status(404).json({ error: "Asset not found" });
  }

  const isCrypto = asset.category === "crypto";
  const decimals = isCrypto ? 4 : 2;

  // SMA/RSI are derived from the REAL OHLCV series only (computed metrics,
  // not fabricated values).
  const attachIndicators = (history: any[]): any[] => {
    for (let i = 0; i < history.length; i++) {
      if (i >= 15) {
        const sum = history.slice(i - 15, i + 1).reduce((acc, current) => acc + current.close, 0);
        history[i].sma = parseFloat((sum / 16).toFixed(isCrypto ? 3 : 1));
      } else {
        history[i].sma = history[i].close;
      }

      if (i >= 14) {
        let gains = 0;
        let losses = 0;
        for (let j = i - 13; j <= i; j++) {
          const diff = history[j].close - history[j - 1].close;
          if (diff > 0) gains += diff;
          else losses -= diff;
        }
        const rs = gains / (losses || 1);
        history[i].rsi = parseFloat((100 - (100 / (1 + rs))).toFixed(1));
      } else {
        history[i].rsi = 50;
      }
    }
    return history;
  };

  // Real source #1 (crypto-first): Binance daily klines.
  const fetchBinanceKlines = async (): Promise<any[]> => {
    // SEC-25-style guard: never interpolate an unvalidated symbol into an
    // upstream URL.
    if (!/^[A-Z0-9]{3,20}$/.test(symbol)) {
      return [];
    }
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=105`;
    const response = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } }, 4000);
    if (!response.ok) {
      throw new Error(`Binance klines returned HTTP ${response.status}`);
    }
    const klines = await response.json() as any[];
    if (!Array.isArray(klines) || klines.length === 0) {
      throw new Error("Binance klines returned no rows");
    }
    const history: any[] = [];
    for (const k of klines) {
      const open = parseFloat(k[1]);
      const high = parseFloat(k[2]);
      const low = parseFloat(k[3]);
      const close = parseFloat(k[4]);
      const volume = parseFloat(k[5]);
      if (!isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) {
        continue;
      }
      history.push({
        date: new Date(k[0]).toISOString().split("T")[0],
        open: parseFloat(open.toFixed(decimals)),
        high: parseFloat(high.toFixed(decimals)),
        low: parseFloat(low.toFixed(decimals)),
        close: parseFloat(close.toFixed(decimals)),
        volume: isFinite(volume) ? volume : 0
      });
    }
    return history;
  };

  // Real source #2: Yahoo Finance chart (stocks as .JK, crypto as -USD).
  const fetchYahooHistory = async (): Promise<any[]> => {
    const yahooSymbol = isCrypto ? `${symbol}-USD` : `${symbol}.JK`;
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=105d&interval=1d`;
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*"
      }
    }, 4000);
    if (!response.ok) {
      throw new Error(`Failed to fetch history from Yahoo Finance: ${response.statusText}`);
    }
    const json = await response.json() as any;
    const result = json?.chart?.result?.[0];
    if (!result) {
      throw new Error("Invalid Yahoo Finance chart result");
    }
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const history: any[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const openVal = opens[i];
      const highVal = highs[i];
      const lowVal = lows[i];
      const closeVal = closes[i];
      const volumeVal = volumes[i];

      if (openVal == null || highVal == null || lowVal == null || closeVal == null) {
        continue;
      }

      const d = new Date(timestamps[i] * 1000);
      const dateStr = d.toISOString().split("T")[0];

      history.push({
        date: dateStr,
        open: parseFloat(openVal.toFixed(decimals)),
        high: parseFloat(highVal.toFixed(decimals)),
        low: parseFloat(lowVal.toFixed(decimals)),
        close: parseFloat(closeVal.toFixed(decimals)),
        volume: volumeVal || 0
      });
    }
    return history;
  };

  try {
    const now = Date.now();
    if (now - lastQuotesFetch >= QUOTE_CACHE_TTL) {
      refreshLiveAssets().catch(err => log.info("Background refresh info:", err.message));
    }

    let history: any[] = [];
    if (isCrypto) {
      // DATA-2: crypto symbols try Binance klines FIRST, then Yahoo.
      try {
        history = await fetchBinanceKlines();
      } catch (binanceErr: any) {
        log.info(`[History] Binance klines failed for ${symbol}, falling back to Yahoo:`, binanceErr.message);
      }
    }
    if (history.length === 0) {
      history = await fetchYahooHistory();
    }

    const finalHistory = attachIndicators(history.slice(-100));
    res.json({ symbol, category: asset.category, history: finalHistory });
  } catch (err: any) {
    // DATA-2: every real source failed → honest 503, never a fabricated
    // random-walk history. The frontend renders the failure state.
    log.error(`[History] All real sources failed for ${symbol}:`, err.message);
    return res.status(503).json({ success: false, error: "Data historis tidak tersedia" });
  }
});

app.get("/api/assets", async (req, res) => {
  const now = Date.now();
  if (now - lastQuotesFetch >= QUOTE_CACHE_TTL) {
    refreshLiveAssets().catch(err => log.info("Background refresh info:", err.message));
  }
  // DATA-5: `isWarmup` stays true until the first successful live market
  // refresh completes, so consumers can label the returned prices as the
  // static warmup snapshot instead of live quotes.
  res.json({ assets: liveAssets, isWarmup: !assetsLiveReady });
});

// Cache variables for real-time coin rankings
let tickersCache: Record<string, { price: number; change: number; volume: number }> | null = null;
let tickersCacheTime = 0;
const TICKERS_CACHE_TTL = 3000; // 3 seconds cache

app.get("/api/coins/tickers", async (req, res) => {
  const now = Date.now();
  if (tickersCache && (now - tickersCacheTime < TICKERS_CACHE_TTL)) {
    return res.json({ success: true, tickers: tickersCache });
  }

  try {
    const response = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    if (!response.ok) {
      throw new Error(`Binance response status: ${response.status}`);
    }
    const data = await response.json() as any[];
    const filtered: Record<string, { price: number; change: number; volume: number }> = {};
    if (Array.isArray(data)) {
      data.forEach((item) => {
        if (item.symbol && (item.symbol.endsWith("USDT") || item.symbol.endsWith("USDC"))) {
          let sym = "";
          if (item.symbol.endsWith("USDT")) {
            sym = item.symbol.replace("USDT", "");
          } else {
            sym = item.symbol.replace("USDC", "");
          }
          
          if (!filtered[sym] || item.symbol.endsWith("USDT")) {
            filtered[sym] = {
              price: parseFloat(item.lastPrice) || 0,
              change: parseFloat(item.priceChangePercent) || 0,
              volume: parseFloat(item.quoteVolume) || 0
            };
          }
        }
      });
    }
    tickersCache = filtered;
    tickersCacheTime = now;
    return res.json({ success: true, tickers: filtered });
  } catch (err: any) {
    log.info("[Coins Tickers API Info]", err.message);
    // If external call fails, return stale cache if available
    if (tickersCache) {
      return res.json({ success: true, tickers: tickersCache, warning: "Served from expired cache due to external error" });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cache variables for CoinCap top 100 directory
let coincapCache: any[] | null = null;
let coincapCacheTime = 0;
const COINCAP_CACHE_TTL = 30000; // 30 seconds cache

// DATA-1: CoinGecko /coins/markets cache — the primary rankings directory
// source, and the only one that provides REAL change7d + sparkline data.
let coingeckoMarketsCache: any[] | null = null;
let coingeckoMarketsCacheTime = 0;

const getSectorForSymbol = (symbol: string, id: string): "L1/L2" | "DeFi" | "Stablecoin" | "AI" | "Meme" | "Infrastructure" => {
  const sym = symbol.toUpperCase();
  const cid = id.toLowerCase();
  if (["USDT", "USDC", "DAI", "FDUSD", "USDE", "PYUSD", "BUSD"].includes(sym) || cid.includes("stable") || cid.includes("usd")) {
    return "Stablecoin";
  }
  if (["DOGE", "SHIB", "PEPE", "WIF", "BONK", "FLOKI", "POPCAT", "BRETT", "BOME", "MOG", "MEW", "TURBO"].includes(sym)) {
    return "Meme";
  }
  if (["FET", "RNDR", "RENDER", "NEAR", "TAO", "AKT", "AGIX", "OCEAN", "WLD", "ARKM"].includes(sym)) {
    return "AI";
  }
  if (["LINK", "GRT", "TIA", "FIL", "STX", "THETA", "JASMY", "ICP", "HNT", "AR", "LPT", "W"].includes(sym)) {
    return "Infrastructure";
  }
  if (["UNI", "AAVE", "MKR", "LDO", "RAY", "JUP", "ENA", "CRV", "SNX", "DYDX", "CAKE", "COMP"].includes(sym) || cid.includes("finance") || cid.includes("swap") || cid.includes("dex")) {
    return "DeFi";
  }
  return "L1/L2";
};

// Global crypto stats cache and endpoint
let globalStatsCache: { totalMc: number; totalVol: number; avgChange: number | null } | null = null;
let globalStatsCacheTime = 0;

app.get("/api/coins/global-stats", async (req, res) => {
  const now = Date.now();
  if (globalStatsCache && (now - globalStatsCacheTime < 30000)) { // 30 seconds cache
    return res.json({ success: true, ...globalStatsCache });
  }

  // 1. Try CoinMarketCap data-api
  try {
    const response = await fetch("https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/latest", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });
    if (response.ok) {
      const payload = await response.json() as any;
      if (payload && payload.data && Array.isArray(payload.data.quotes) && payload.data.quotes.length > 0) {
        const quote = payload.data.quotes[0];
        // DATA-6: no fabricated constants — a field that fails to parse makes
        // this source unusable and we move to the next real source.
        const totalMc = parseFloat(quote.totalMarketCap);
        const totalVol = parseFloat(quote.totalVolume24H);
        if (isFinite(totalMc) && isFinite(totalVol)) {
          const totalMarketCapYesterday = parseFloat(quote.totalMarketCapYesterday);
          const avgChange = (isFinite(totalMarketCapYesterday) && totalMarketCapYesterday !== 0)
            ? (((totalMc - totalMarketCapYesterday) / totalMarketCapYesterday) * 100)
            : null;

          const stats = { totalMc, totalVol, avgChange };
          globalStatsCache = stats;
          globalStatsCacheTime = now;
          return res.json({ success: true, ...stats });
        }
      }
    }
  } catch (err: any) {
    log.info("[Global Stats Fetch from CoinMarketCap info]", err.message);
  }

  // 2. Fallback to Coinpaprika
  try {
    const response = await fetch("https://api.coinpaprika.com/v1/global");
    if (response.ok) {
      const data = await response.json() as any;
      if (data && data.market_cap_usd) {
        // DATA-6: parse strictly — no hardcoded $1.81T / $56.6B fallbacks.
        const totalMc = parseFloat(data.market_cap_usd);
        const totalVol = parseFloat(data.volume_24h_usd);
        if (isFinite(totalMc) && isFinite(totalVol)) {
          const avgChange = parseFloat(data.market_cap_change_24h);
          const stats = {
            totalMc,
            totalVol,
            avgChange: isFinite(avgChange) ? avgChange : null
          };
          globalStatsCache = stats;
          globalStatsCacheTime = now;
          return res.json({ success: true, ...stats });
        }
      }
    }
  } catch (err: any) {
    log.info("[Global Stats Fetch from Coinpaprika info]", err.message);
  }

  // 3. Fallback to Coingecko
  try {
    const cgRes = await fetch("https://api.coingecko.com/api/v3/global");
    if (cgRes.ok) {
      const payload = await cgRes.json() as any;
      if (payload && payload.data) {
        // DATA-6: parse strictly — no hardcoded fallback constants.
        const totalMc = parseFloat(payload.data.total_market_cap?.usd);
        const totalVol = parseFloat(payload.data.total_volume?.usd);
        if (isFinite(totalMc) && isFinite(totalVol)) {
          const avgChange = parseFloat(payload.data.market_cap_change_percentage_24h_usd);
          const stats = {
            totalMc,
            totalVol,
            avgChange: isFinite(avgChange) ? avgChange : null
          };
          globalStatsCache = stats;
          globalStatsCacheTime = now;
          return res.json({ success: true, ...stats });
        }
      }
    }
  } catch (err: any) {
    log.info("[Global Stats Fetch from Coingecko info]", err.message);
  }

  // DATA-6: every real source failed → honest 503. The old fallback here used
  // to fabricate a $1.81T market cap by multiplying Binance prices by a made-up
  // 100,000,000 circulating supply — that fabrication was removed.
  return res.status(503).json({ success: false, error: "Global stats tidak tersedia" });
});

app.get("/api/coins/rankings", async (req, res) => {
  const now = Date.now();
  let rawData: any[] = [];
  let isFromCache = false;

  // 1. Ensure we have Binance tickers fetched or try to fetch them
  let currentTickers = tickersCache || {};
  if (!tickersCache || (now - tickersCacheTime > 15000)) {
    try {
      const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/24hr");
      if (binanceRes.ok) {
        const bData = await binanceRes.json() as any[];
        const filtered: Record<string, { price: number; change: number; volume: number }> = {};
        if (Array.isArray(bData)) {
          bData.forEach((item) => {
            if (item.symbol && (item.symbol.endsWith("USDT") || item.symbol.endsWith("USDC"))) {
              let sym = "";
              if (item.symbol.endsWith("USDT")) {
                sym = item.symbol.replace("USDT", "");
              } else {
                sym = item.symbol.replace("USDC", "");
              }
              if (!filtered[sym] || item.symbol.endsWith("USDT")) {
                filtered[sym] = {
                  price: parseFloat(item.lastPrice) || 0,
                  change: parseFloat(item.priceChangePercent) || 0,
                  volume: parseFloat(item.quoteVolume) || 0
                };
              }
            }
          });
        }
        tickersCache = filtered;
        tickersCacheTime = now;
        currentTickers = filtered;
      }
    } catch (err) {
      log.warn("[Background Binance Ticker Fetch inside Rankings failed]", err);
    }
  }

  // 2. DATA-1: primary REAL source — CoinGecko /coins/markets (the only
  // rankings source that provides REAL change7d + sparkline data). If every
  // real source fails we now return 503 — the Math.random "fake coins"
  // generator (generateFallbackRawData) was deleted for good.
  if (coingeckoMarketsCache && (now - coingeckoMarketsCacheTime < COINCAP_CACHE_TTL)) {
    rawData = coingeckoMarketsCache;
    isFromCache = true;
  } else {
    try {
      const response = await fetchWithTimeout(
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=7d",
        { headers: { "Accept": "application/json" } },
        6000
      );
      if (response.ok) {
        const payload = await response.json() as any[];
        if (Array.isArray(payload) && payload.length > 0) {
          rawData = payload.map((item, index) => ({
            rank: (item.market_cap_rank || index + 1).toString(),
            id: item.id || (item.symbol || "").toLowerCase(),
            symbol: item.symbol || "",
            name: item.name || item.symbol || "",
            priceUsd: String(item.current_price ?? 0),
            changePercent24Hr: String(item.price_change_percentage_24h_in_currency ?? item.price_change_percentage_24h ?? 0),
            change7d: item.price_change_percentage_7d_in_currency ?? item.price_change_percentage_7d ?? null,
            marketCapUsd: item.market_cap != null ? String(item.market_cap) : null,
            volumeUsd24Hr: String(item.total_volume ?? 0),
            supply: item.circulating_supply != null ? String(item.circulating_supply) : null,
            sparkline: Array.isArray(item.sparkline_in_7d?.price) ? item.sparkline_in_7d.price : null
          }));
          coingeckoMarketsCache = rawData;
          coingeckoMarketsCacheTime = now;
        }
      }
    } catch (err: any) {
      log.info("[CoinGecko Markets Fetch Info, trying CoinCap next]", err.message);
    }
  }

  // 3. CoinCap directory fallback (real data)
  if (rawData.length === 0) {
    if (coincapCache && (now - coincapCacheTime < COINCAP_CACHE_TTL)) {
      rawData = coincapCache;
      isFromCache = true;
    } else {
      try {
        const response = await fetch("https://api.coincap.io/v2/assets?limit=100");
        if (response.ok) {
          const payload = await response.json() as { data: any[] };
          if (payload && Array.isArray(payload.data) && payload.data.length > 0) {
            rawData = payload.data;
            coincapCache = rawData;
            coincapCacheTime = now;
          }
        }
      } catch (err: any) {
        log.info("[CoinCap Fetch Info, trying Coinpaprika next]", err.message);
      }
    }
  }

  // 4. Coinpaprika fallback (100% Real-time, NO DUMMY DATA)
  if (rawData.length === 0) {
    try {
      const response = await fetch("https://api.coinpaprika.com/v1/tickers?limit=100");
      if (response.ok) {
        const payload = await response.json() as any[];
        if (payload && Array.isArray(payload) && payload.length > 0) {
          rawData = payload.map((item, index) => ({
            rank: (item.rank || index + 1).toString(),
            id: item.id || item.symbol.toLowerCase(),
            symbol: item.symbol,
            name: item.name,
            priceUsd: (item.quotes?.USD?.price || 0).toString(),
            changePercent24Hr: (item.quotes?.USD?.percent_change_24h || 0).toString(),
            volumeUsd24Hr: (item.quotes?.USD?.volume_24h || 0).toString(),
            marketCapUsd: (item.quotes?.USD?.market_cap || 0).toString(),
            supply: (item.circulating_supply || 0).toString()
          }));
        }
      }
    } catch (err: any) {
      log.warn("[Coinpaprika Fetch Failed, trying Binance dynamic next]", err.message);
    }
  }

  // 5. Binance Tickers list as dynamic third-level fallback (100% real-time!)
  if (rawData.length === 0 && Object.keys(currentTickers).length > 0) {
    const sortedTickers = Object.entries(currentTickers)
      .map(([symbol, data]: [string, any]) => ({
        symbol,
        price: data.price,
        change: data.change,
        volume: data.volume
      }))
      .sort((a, b) => b.volume - a.volume);

    rawData = sortedTickers.slice(0, 100).map((item, index) => ({
      rank: (index + 1).toString(),
      id: item.symbol.toLowerCase(),
      symbol: item.symbol,
      name: item.symbol,
      priceUsd: item.price.toString(),
      changePercent24Hr: item.change.toString(),
      volumeUsd24Hr: item.volume.toString(),
      // DATA-11: Binance tickers carry NO marketCap/supply data — the old
      // `price * 100000000` fake market cap and hardcoded "100000000" supply
      // were removed; these stay null so the frontend renders "—".
      marketCapUsd: null,
      supply: null
    }));
  }

  // Last resort: serve stale (but REAL) cached CoinCap data if available.
  if (rawData.length === 0 && coincapCache) {
    rawData = coincapCache;
    isFromCache = true;
  }

  // DATA-1: every REAL source failed → honest 503 with an empty coin list.
  // The app NEVER fabricates rankings (the fake coins 21-100 generator was
  // removed entirely).
  if (rawData.length === 0) {
    return res.status(503).json({ success: false, error: "Data rankings tidak tersedia saat ini", coins: [] });
  }

  try {
    const coinsMap = new Map<string, any>();

    rawData.forEach((item, index) => {
      const rank = parseInt(item.rank) || index + 1;
      const symbol = (item.symbol || "").toUpperCase();
      const id = item.id || symbol.toLowerCase();
      const name = item.name || symbol;

      let price = parseFloat(item.priceUsd) || 0;
      let change24h = parseFloat(item.changePercent24Hr) || 0;
      let volume24h = parseFloat(item.volumeUsd24Hr) || 0;
      // DATA-11: supply/marketCap are ONLY set when the real source actually
      // provided them; otherwise null (frontend renders "—").
      const circulatingSupply = item.supply != null ? (parseFloat(item.supply) || null) : null;
      let marketCap: number | null = item.marketCapUsd != null ? (parseFloat(item.marketCapUsd) || null) : null;
      // Derived (not fabricated): market cap from a REAL price × REAL supply.
      if (marketCap == null && circulatingSupply != null && circulatingSupply > 0) {
        marketCap = price * circulatingSupply;
      }

      // Overlay with live ultra-fresh Binance prices if available
      const liveTicker = currentTickers[symbol];
      if (liveTicker) {
        price = liveTicker.price;
        change24h = liveTicker.change;
        volume24h = liveTicker.volume;
        if (circulatingSupply != null && circulatingSupply > 0) {
          marketCap = price * circulatingSupply;
        }
      }

      const sector = getSectorForSymbol(symbol, id);

      // DATA-11: change7d is REAL (CoinGecko) or null — the old
      // `change24h * 1.45 + sin` fabrication is gone. Sparkline is REAL
      // (CoinGecko sparkline_in_7d) or null — the sin-noise generator is gone.
      const change7d = item.change7d != null ? (parseFloat(item.change7d) || null) : null;
      const sparkline = Array.isArray(item.sparkline) ? item.sparkline : null;

      coinsMap.set(symbol, {
        rank,
        id,
        symbol,
        name,
        price,
        change24h,
        change7d,
        marketCap,
        volume24h,
        circulatingSupply,
        sector,
        sparkline
      });
    });

    // Explicitly merge in any target Hot/New symbols from Binance that are missing to guarantee they show up
    const targetSymbols = [
      "BTC", "ETH", "SOL", "BNB", "DOGE", "SHIB", "PEPE", "WIF", "NEAR", "HYPE", "AVAX", "LINK", "UNI", "SUI", "XRP", "ADA",
      "ENA", "W", "JUP", "STRK", "DYM", "PYTH", "SEI", "APT", "TIA", "IO", "ZK", "ME", "COW", "CETUS", "SCR", "CARV", "CATI",
      "DOGS", "BANANA", "TON", "HMSTR", "NOT"
    ];

    const symbolToName: Record<string, string> = {
      HYPE: "Hyperliquid",
      ENA: "Ethena",
      W: "Wormhole",
      JUP: "Jupiter",
      STRK: "Starknet",
      DYM: "Dymension",
      PYTH: "Pyth Network",
      SUI: "Sui",
      SEI: "Sei",
      APT: "Aptos",
      TIA: "Celestia",
      IO: "io.net",
      ZK: "zkSync",
      ME: "Magic Eden",
      COW: "CoW Protocol",
      CETUS: "Cetus Protocol",
      SCR: "Scroll",
      CARV: "CARV",
      CATI: "Catizen",
      DOGS: "DOGS",
      BANANA: "Banana Gun",
      TON: "Toncoin",
      HMSTR: "Hamster Kombat",
      NOT: "Notcoin",
      PEPE: "Pepe",
      SHIB: "Shiba Inu",
      WIF: "dogwifhat"
    };

    let nextRank = Math.max(101, coinsMap.size + 1);

    targetSymbols.forEach((sym) => {
      const symbol = sym.toUpperCase();
      const ticker = currentTickers[symbol];
      if (ticker && !coinsMap.has(symbol)) {
        const name = symbolToName[symbol] || symbol;
        const price = ticker.price;
        const change24h = ticker.change;
        const volume24h = ticker.volume;
        // DATA-11: hardcoded supplies (TON 2.5B / HYPE 333M / 1B default) and
        // the derived fake marketCap / change7d / sin-noise sparkline were
        // removed. Only price/change/volume are real (Binance ticker); the
        // rest stays null until a real source provides them.
        const sector = getSectorForSymbol(symbol, symbol.toLowerCase());

        coinsMap.set(symbol, {
          rank: nextRank++,
          id: symbol.toLowerCase(),
          symbol,
          name,
          price,
          change24h,
          change7d: null,
          marketCap: null,
          volume24h,
          circulatingSupply: null,
          sector,
          sparkline: null
        });
      }
    });

    const coins = Array.from(coinsMap.values());
    return res.json({ 
      success: true, 
      coins, 
      source: "binance_robust_hybrid", 
      cached: isFromCache,
      sources: {
        newListing: "https://www.binance.com/en/markets/newListing",
        tradingRankings: "https://www.binance.com/en/markets/trading_data/rankings"
      }
    });

  } catch (err: any) {
    log.error("[Rankings API Error]", err.message);
    return res.status(503).json({ success: false, error: "Data rankings tidak tersedia saat ini", coins: [] });
  }
});

// Register any dynamic custom asset from Yahoo Finance (Stocks) or Binance (Crypto)
// SEC-4: this route now requires authentication and applies strict charset
// validation to symbol/name/category. Previously an unauthenticated caller
// could push arbitrary strings into the in-memory asset store (which is
// rendered in the UI → stored XSS) and inject syntax into upstream URLs.
// The dummy fallback asset injection (which fabricated a price of 1000) was
// also removed — registration only succeeds when the symbol is VERIFIED
// against a real upstream source.
app.post("/api/assets/register", requireAuth, async (req, res) => {
  const registerSchema = z.object({
    symbol: z.string().min(2).max(20),
    category: z.enum(["stock", "crypto"]),
    name: z.string().max(60).optional().nullable()
  });

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validasi registrasi gagal: " + parsed.error.issues.map(e => e.message).join(", ") });
  }

  const { category } = parsed.data;
  const upperSymbol = parsed.data.symbol.trim().toUpperCase();
  const rawName = parsed.data.name != null ? parsed.data.name.trim() : null;
  const cleanName = rawName != null && rawName !== "" ? rawName : null;

  // SEC-4 (stored XSS) + SEC-25 (upstream URL injection): strict charsets —
  // nothing outside these can reach the asset store or an upstream URL.
  if (!/^[A-Z0-9.\-]{2,20}$/.test(upperSymbol)) {
    return res.status(400).json({ error: "Simbol hanya boleh mengandung huruf besar, angka, titik, dan strip (2-20 karakter)." });
  }
  if (cleanName != null && !/^[A-Za-z0-9 .\-()]{2,60}$/.test(cleanName)) {
    return res.status(400).json({ error: "Nama aset hanya boleh mengandung huruf, angka, spasi, dan karakter . - ( ) (2-60 karakter)." });
  }

  const existing = liveAssets.find(a => a.symbol === upperSymbol);
  if (existing) {
    return res.json({ message: "Asset already exists", asset: existing });
  }

  const nameMap: Record<string, string> = {
    "BTC": "Bitcoin",
    "ETH": "Ethereum",
    "SOL": "Solana",
    "BNB": "BNB",
    "DOGE": "Dogecoin",
    "ADA": "Cardano",
    "XRP": "Ripple",
    "DOT": "Polkadot",
    "LINK": "Chainlink",
    "SHIB": "Shiba Inu",
    "NEAR": "Near Protocol",
    "AVAX": "Avalanche",
    "LTC": "Litecoin",
    "UNI": "Uniswap",
    "SUI": "Sui",
    "APT": "Aptos",
    "PEPE": "Pepe"
  };

  if (category === "crypto") {
    // SEC-25: Binance spot symbols are pure alphanumeric — validate before
    // the symbol is interpolated into the upstream 24hr URL.
    if (!/^[A-Z0-9]{3,20}$/.test(upperSymbol)) {
      return res.status(400).json({ error: "Simbol crypto tidak valid untuk verifikasi bursa Binance." });
    }
    try {
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${upperSymbol}USDT`;
      const response = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } }, 4000);
      if (!response.ok) {
        throw new Error(`Symbol ${upperSymbol}USDT not found on Binance`);
      }
      const data = await response.json() as any;
      if (!data || data.lastPrice == null) {
        throw new Error(`No live ticker data for ${upperSymbol}USDT on Binance`);
      }
      
      const price = parseFloat(data.lastPrice);
      const change24h = data.priceChangePercent ? parseFloat(parseFloat(data.priceChangePercent).toFixed(2)) : 0;
      const volume24h = data.quoteVolume ? parseFloat(data.quoteVolume) : 0;

      const newAsset = {
        id: `c_${upperSymbol.toLowerCase()}`,
        symbol: upperSymbol,
        name: cleanName || nameMap[upperSymbol] || `${upperSymbol} Token`,
        category: "crypto" as const,
        price: price,
        change24h: change24h,
        // DATA: Binance's 24hr ticker provides NO market cap — the old
        // `price * (volume24h * 15)` estimate was fabricated and is removed.
        marketCap: null,
        volume24h: volume24h,
      };

      (liveAssets as any[]).push(newAsset);
      return res.json({ message: "Asset successfully registered from Binance real-time", asset: newAsset });
    } catch (err: any) {
      log.error(`Binance registration failed for ${upperSymbol}:`, err.message);
      return res.status(400).json({ error: `Gagal mendaftarkan aset crypto: ${upperSymbol} tidak ditemukan di bursa Binance.` });
    }
  }

  // Stocks branch remains protected with Yahoo Finance
  let yahooSymbol = upperSymbol;
  if (category === "stock" && !upperSymbol.endsWith(".JK")) {
    yahooSymbol = `${upperSymbol}.JK`;
  }

  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`;
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    }, 4500);

    if (!response.ok) {
      throw new Error(`Symbol ${yahooSymbol} not verified on external market api`);
    }

    const data = await response.json() as any;
    const resultItem = data?.chart?.result?.[0];
    if (!resultItem) {
      throw new Error("No chart results for target symbol");
    }

    const meta = resultItem.meta;
    const price = meta?.regularMarketPrice;
    // DATA: no fabricated default price — registration requires a real quote.
    if (price == null || !isFinite(price) || price <= 0) {
      throw new Error("No live market price available for symbol");
    }
    const prevClose = meta?.chartPreviousClose || meta?.previousClose || price;
    const change24h = prevClose > 0 ? parseFloat((((price - prevClose) / prevClose) * 100).toFixed(2)) : 0;

    const newAsset = {
      id: `s_${upperSymbol.toLowerCase()}`,
      symbol: upperSymbol,
      name: cleanName || meta?.shortName || meta?.longName || `${upperSymbol} Global Asset`,
      category: "stock" as "stock",
      price: price,
      change24h: change24h,
      marketCap: meta?.marketCap ?? null, // real from Yahoo or null — no fake value
      volume24h: resultItem.indicators?.quote?.[0]?.volume?.[0] || 0,
    };

    (liveAssets as any[]).push(newAsset);
    res.json({ message: "Asset successfully registered", asset: newAsset });
  } catch (err: any) {
    // SEC-4/DATA: the dummy fallback asset (fabricated price of 1000 and a
    // fake "(Aset Kustom)" name) was removed — fail honestly instead of
    // injecting fabricated data into the asset registry.
    log.error(`[Registration] Yahoo verification failed for ${upperSymbol}:`, err.message);
    return res.status(400).json({ error: `Gagal memverifikasi aset ${upperSymbol} dari Yahoo Finance. Aset tidak didaftarkan.` });
  }
});


// --- 7. GET /api/stocks/fundamentals/:symbol ------------------------------
// Stock fundamentals (P/E, dividend yield, market cap, profit margins) via
// Yahoo Finance quoteSummary. Yahoo often 401s for this endpoint, so we
// return HTTP 200 with success:false to let the UI show "N/A" gracefully.
app.get("/api/stocks/fundamentals/:symbol", async (req, res) => {
  try {
    const symbol = String(req.params.symbol || "").toUpperCase().trim();
    if (!symbol) {
      return res.json({ success: false, symbol: "", error: "Fundamentals unavailable" });
    }

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail,defaultKeyStatistics,financialData`;
    const r = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    }, 6000);

    if (!r.ok) {
      // Yahoo frequently returns 401/404 for this endpoint. Return 200 with
      // success:false so the UI can render "N/A" instead of an error toast.
      return res.json({
        success: false,
        symbol,
        error: "Fundamentals unavailable"
      });
    }

    const data = await r.json() as any;
    const qs = data?.quoteSummary?.result?.[0] || {};

    const trailingPE = qs?.summaryDetail?.trailingPE?.raw
      ?? qs?.defaultKeyStatistics?.trailingPE?.raw
      ?? null;
    const dividendYield = qs?.summaryDetail?.dividendYield?.raw
      ?? qs?.summaryDetail?.trailingAnnualDividendYield?.raw
      ?? null;
    const marketCap = qs?.summaryDetail?.marketCap?.raw
      ?? qs?.defaultKeyStatistics?.marketCap?.raw
      ?? null;
    const profitMargins = qs?.financialData?.profitMargins?.raw
      ?? qs?.defaultKeyStatistics?.profitMargins?.raw
      ?? null;

    return res.json({
      success: true,
      symbol,
      peRatio: trailingPE !== null ? parseFloat(trailingPE) : null,
      dividendYield: dividendYield !== null ? parseFloat(dividendYield) : null,
      marketCap: marketCap !== null ? parseFloat(marketCap) : null,
      profitMargins: profitMargins !== null ? parseFloat(profitMargins) : null,
      source: "Yahoo Finance quoteSummary",
      lastUpdated: new Date().toISOString()
    });
  } catch (err: any) {
    return res.json({
      success: false,
      symbol: String(req.params.symbol || "").toUpperCase(),
      error: "Fundamentals unavailable"
    });
  }
});

} // end registerMarketRoutes

