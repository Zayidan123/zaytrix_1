// =============================================================================
// onchainStore.ts — QA9-R3: on-chain data layer — fetchLatestOnChainData()
// (Blockstream modular fetcher), the background-refreshed BTC on-chain
// metrics cache + synchronous getOnChainMetrics() used by the AI signal
// prompt builder, and the /api/onchain/* endpoints (metrics, data,
// orderbook, altcoin-season, oi-history, dominance-history, correlations).
// Extracted verbatim from server.ts (was 3090-3094, 3443-3633, 3896-4046,
// 4686-4976, 5131-5234).
// =============================================================================
import { fetchWithTimeout } from "./httpUtils";
import type { Express } from "express";
import { fetchLiveOnChainDataModular } from "../../onchainDataHelper";
import { getLiveBinanceDerivatives, liveLiquidationsList } from "./binanceDerivatives";
import { createLogger } from "./logger";

const log = createLogger("onchainStore");

// Core on-chain data retrieval helper utilizing Blockstream.info
export async function fetchLatestOnChainData() {
  return fetchLiveOnChainDataModular();
}


// ---------------------------------------------------------------------------
// Live BTC on-chain data cache (refreshed in the background).
// We keep this as a module-level cache because getOnChainMetrics() is invoked
// synchronously inside the trading-signals prompt builder; we cannot await a
// network fetch there. The background worker refreshes the values every 60s.
// ---------------------------------------------------------------------------
let liveBtcMempoolFeeSatVb: number | null = null; // halfHourFee from mempool.space (sat/vB)
let liveBtcBlockHeight: number | null = null;     // block count from blockchain.info
let liveBtcMempoolLastUpdated = 0;

async function refreshLiveBtcOnChainCache() {
  // Try to refresh both mempool fee and block height. Failures are caught and
  // simply leave the previous cached value in place (or null on first run).
  try {
    const feeRes = await fetchWithTimeout(
      "https://mempool.space/api/v1/fees/recommended",
      { headers: { "Accept": "application/json" } },
      5000
    );
    if (feeRes.ok) {
      const feeData = await feeRes.json() as any;
      const halfHour = parseFloat(feeData?.halfHourFee);
      if (isFinite(halfHour) && halfHour > 0) {
        liveBtcMempoolFeeSatVb = Math.round(halfHour);
      }
    }
  } catch (err: any) {
    // Network/parse failure — keep previous cached value (or null).
    log.info("[BTC On-Chain Cache] mempool.space fetch handled:", err.message);
  }

  try {
    const bhRes = await fetchWithTimeout(
      "https://blockchain.info/q/getblockcount",
      { headers: { "Accept": "text/plain" } },
      5000
    );
    if (bhRes.ok) {
      const text = (await bhRes.text()).trim();
      const height = parseInt(text, 10);
      if (isFinite(height) && height > 0) {
        liveBtcBlockHeight = height;
      }
    }
  } catch (err: any) {
    log.info("[BTC On-Chain Cache] blockchain.info fetch handled:", err.message);
  }

  liveBtcMempoolLastUpdated = Date.now();
}

// Kick off initial fetch and refresh every 60 seconds.
refreshLiveBtcOnChainCache().catch(() => { /* swallow on boot */ });
setInterval(() => {
  refreshLiveBtcOnChainCache().catch(() => { /* background refresh */ });
}, 60000);

// Helper that produces deterministic on-chain metric estimates.
// NOTE: The values returned here are ESTIMATES derived from a deterministic
// model (symbol + UTC date seeded). They are NOT live RPC-scraped data, with
// the single exception of BTC's `averageGasFee` which is sourced live from
// mempool.space when the background cache has a fresh value. Each return
// object includes an `isEstimated` flag so downstream consumers (UI/AI) can
// label the data honestly.
export function getOnChainMetrics(symbol: string) {
  const sym = symbol.toUpperCase();
  const seed = sym.charCodeAt(0) + (sym.charCodeAt(1) || 0);
  
  // Custom deterministic randomness based on symbol & current date to produce stable per-day estimates
  const dateSeed = new Date().getUTCDate();
  const rand = (offset: number) => {
    const x = Math.sin(seed + dateSeed * 13 + offset) * 10000;
    return x - Math.floor(x);
  };

  const ESTIMATED_SOURCE = "Estimated from public market data (deterministic model). Live on-chain RPC integration pending.";

  if (sym === "BTC") {
    // BTC averageGasFee is sourced LIVE from mempool.space when available;
    // otherwise we fall back to a deterministic estimate and flag it.
    const hasLiveFee = liveBtcMempoolFeeSatVb !== null && liveBtcMempoolFeeSatVb > 0;
    const gasFeeValue = hasLiveFee
      ? `${liveBtcMempoolFeeSatVb} Sat/vB`
      : `${Math.round(20 + rand(5) * 45)} Sat/vB (est.)`;
    const scrapedSource = hasLiveFee
      ? `Live mempool fee from mempool.space (halfHourFee). Block height: ${liveBtcBlockHeight ?? "n/a"} from blockchain.info. Other metrics: ${ESTIMATED_SOURCE}`
      : ESTIMATED_SOURCE;
    return {
      activeAddresses: Math.round(920000 + rand(1) * 150000),
      exchangeNetflow24h: parseFloat((-5200 + rand(2) * 4000).toFixed(2)),
      smartMoneyAction: rand(3) > 0.4 ? "Accumulation" : "Neutral",
      onchainHealthScore: Math.round(78 + rand(4) * 18),
      averageGasFee: gasFeeValue,
      whaleTransactions24h: Math.round(1100 + rand(6) * 400),
      socialSentiment: rand(7) > 0.3 ? "Highly Positive" : "Bullish",
      scrapedSource,
      isEstimated: !hasLiveFee
    };
  } else if (sym === "ETH") {
    return {
      activeAddresses: Math.round(410000 + rand(1) * 90000),
      exchangeNetflow24h: parseFloat((-18000 + rand(2) * 15000).toFixed(2)),
      smartMoneyAction: rand(3) > 0.5 ? "Accumulation" : "Holding",
      onchainHealthScore: Math.round(74 + rand(4) * 20),
      averageGasFee: `${Math.round(8 + rand(5) * 15)} Gwei (est.)`,
      whaleTransactions24h: Math.round(450 + rand(6) * 200),
      socialSentiment: rand(7) > 0.4 ? "Positive" : "Highly Bullish",
      scrapedSource: ESTIMATED_SOURCE,
      isEstimated: true
    };
  } else if (sym === "SOL") {
    return {
      activeAddresses: Math.round(1240000 + rand(1) * 350000),
      exchangeNetflow24h: parseFloat((-250000 + rand(2) * 400000).toFixed(2)),
      smartMoneyAction: rand(3) > 0.3 ? "Aggressive Buy" : "Accumulation",
      onchainHealthScore: Math.round(82 + rand(4) * 15),
      averageGasFee: `${parseFloat((0.00005 + rand(5) * 0.00004).toFixed(6))} SOL (est.)`,
      whaleTransactions24h: Math.round(2800 + rand(6) * 1200),
      socialSentiment: rand(7) > 0.2 ? "Highly Bullish" : "FOMO Momentum",
      scrapedSource: ESTIMATED_SOURCE,
      isEstimated: true
    };
  } else if (sym === "BNB") {
    return {
      activeAddresses: Math.round(250000 + rand(1) * 80000),
      exchangeNetflow24h: parseFloat((1500 + rand(2) * 8000).toFixed(2)),
      smartMoneyAction: rand(3) > 0.6 ? "Distribution" : "Neutral",
      onchainHealthScore: Math.round(65 + rand(4) * 15),
      averageGasFee: `${parseFloat((0.00025 + rand(5) * 0.0001).toFixed(5))} BNB (est.)`,
      whaleTransactions24h: Math.round(210 + rand(6) * 100),
      socialSentiment: "Neutral",
      scrapedSource: ESTIMATED_SOURCE,
      isEstimated: true
    };
  } else {
    // Other assets, including custom or Indonesian stocks
    const isCrypto = sym === "BTC" || sym === "ETH" || sym === "SOL" || sym === "BNB" || sym === "DOGE" || sym === "ADA";
    return {
      activeAddresses: Math.round(45000 + rand(1) * 120000),
      exchangeNetflow24h: parseFloat((-1200 + rand(2) * 2500).toFixed(2)),
      smartMoneyAction: rand(3) > 0.55 ? "Accumulation" : "Neutral",
      onchainHealthScore: Math.round(60 + rand(4) * 30),
      averageGasFee: isCrypto ? "Murah (Gas Terkelola) (est.)" : "N/A (Bursa Terpusat)",
      whaleTransactions24h: Math.round(50 + rand(6) * 180),
      socialSentiment: rand(7) > 0.5 ? "Bullish" : "Optimistic",
      scrapedSource: ESTIMATED_SOURCE,
      isEstimated: true
    };
  }
}


export function registerOnchainRoutes(app: Express): void {
// ============================================================================
// LIVE ON-CHAIN METRICS API - Real data from Binance Futures, CoinGecko, Alternative.me
// ============================================================================
let metricsCache: any = null;
let metricsCacheTime = 0;
const METRICS_CACHE_TTL = 30000; // 30 seconds

app.get("/api/onchain/metrics", async (req, res) => {
  const now = Date.now();
  if (metricsCache && now - metricsCacheTime < METRICS_CACHE_TTL) {
    return res.json(metricsCache);
  }

  const result: any = { success: true, lastUpdated: new Date().toISOString() };
  let binanceSectionsFetched = 0;

  // --- 1. Binance Futures Funding Rate History (30 entries) for BTC, ETH, SOL ---
  try {
    const [btcFr, ethFr, solFr] = await Promise.all([
      fetchWithTimeout("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=30", {}, 5000).then(r => r.json()).catch(() => []),
      fetchWithTimeout("https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=30", {}, 5000).then(r => r.json()).catch(() => []),
      fetchWithTimeout("https://fapi.binance.com/fapi/v1/fundingRate?symbol=SOLUSDT&limit=30", {}, 5000).then(r => r.json()).catch(() => []),
    ]);
    binanceSectionsFetched++;

    const fundingRateMap = new Map<string, any[]>();
    for (const item of btcFr) { const d = new Date(item.fundingTime).toLocaleDateString("id-ID", {month:"short",day:"numeric"}); const arr = fundingRateMap.get(d)||[]; arr.push({exchange:"Binance",rate:parseFloat(item.fundingRate)}); fundingRateMap.set(d,arr); }
    for (const item of ethFr) { const d = new Date(item.fundingTime).toLocaleDateString("id-ID", {month:"short",day:"numeric"}); const arr = fundingRateMap.get(d)||[]; arr.push({exchange:"ETH",rate:parseFloat(item.fundingRate)}); fundingRateMap.set(d,arr); }
    for (const item of solFr) { const d = new Date(item.fundingTime).toLocaleDateString("id-ID", {month:"short",day:"numeric"}); const arr = fundingRateMap.get(d)||[]; arr.push({exchange:"SOL",rate:parseFloat(item.fundingRate)}); fundingRateMap.set(d,arr); }

    result.fundingRates = btcFr.slice(0,30).map((item, i) => {
      const d = new Date(item.fundingTime).toLocaleDateString("id-ID", {month:"short",day:"numeric"});
      return {
        date: d,
        Binance: parseFloat(btcFr[i]?.fundingRate || 0),
        ETH: parseFloat(ethFr[i]?.fundingRate || 0),
        SOL: parseFloat(solFr[i]?.fundingRate || 0),
      };
    });

    result.currentFundingRates = {
      BTC: btcFr.length > 0 ? parseFloat(btcFr[0].fundingRate) : null,
      ETH: ethFr.length > 0 ? parseFloat(ethFr[0].fundingRate) : null,
      SOL: solFr.length > 0 ? parseFloat(solFr[0].fundingRate) : null,
    };
  } catch(e: any) { log.error("[Metrics] Funding rate fetch failed:", e.message); }

  // --- 2. Binance Futures Open Interest (current) ---
  try {
    const symbols = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT"];
    const oiResults = await Promise.all(symbols.map(sym =>
      fetchWithTimeout(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`, {}, 5000)
        .then(r => r.json())
        .catch(() => null)
    ));
    result.openInterest = {};
    symbols.forEach((sym, i) => {
      if (oiResults[i]) {
        result.openInterest[sym.replace("USDT","")] = {
          openInterest: parseFloat(oiResults[i].openInterest),
          notionalValue: parseFloat(oiResults[i].notionalValue || 0),
        };
      }
    });
    binanceSectionsFetched++;
  } catch(e: any) { log.error("[Metrics] OI fetch failed:", e.message); }

  // --- 3. CoinGecko Global Data (dominance, market cap, volume) ---
  try {
    const cgGlobal = await fetchWithTimeout("https://api.coingecko.com/api/v3/global", {}, 5000).then(r => r.json());
    if (cgGlobal && cgGlobal.data) {
      const d = cgGlobal.data;
      result.market = {
        btcDominance: d.market_cap_percentage?.btc || null,
        ethDominance: d.market_cap_percentage?.eth || null,
        totalMarketCap: d.total_market_cap?.usd || null,
        totalVolume24h: d.total_volume?.usd || null,
        activeCurrencies: d.active_cryptocurrencies || null,
        marketCapChange24h: d.market_cap_change_percentage_24h_usd || null,
      };
    }
  } catch(e: any) { log.error("[Metrics] CoinGecko global failed:", e.message); }

  // --- 4. CoinGecko BTC Price History (30 days) ---
  try {
    const btcHistory = await fetchWithTimeout("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily", {}, 8000).then(r => r.json());
    if (btcHistory && btcHistory.prices) {
      result.btcPriceHistory = btcHistory.prices.map((p: number[]) => ({
        date: new Date(p[0]).toLocaleDateString("id-ID", {month:"short",day:"numeric"}),
        price: Math.round(p[1]),
      }));
    }
    if (btcHistory && btcHistory.total_volumes) {
      result.btcVolumeHistory = btcHistory.total_volumes.map((v: number[], i: number) => ({
        date: result.btcPriceHistory?.[i]?.date || "",
        volume: Math.round(v[1] / 1e6), // in millions
      }));
    }
  } catch(e: any) { log.error("[Metrics] BTC price history failed:", e.message); }

  // --- 5. Fear & Greed Index (Alternative.me) ---
  try {
    const fng = await fetchWithTimeout("https://api.alternative.me/fng/?limit=30", {}, 5000).then(r => r.json());
    if (fng && fng.data) {
      result.fearGreed = {
        current: { value: parseInt(fng.data[0]?.value || 50), classification: fng.data[0]?.value_classification || "Neutral" },
        history: fng.data.map((d: any) => ({
          date: new Date(parseInt(d.timestamp) * 1000).toLocaleDateString("id-ID", {month:"short",day:"numeric"}),
          value: parseInt(d.value),
          classification: d.value_classification,
        })),
      };
    }
  } catch(e: any) { log.error("[Metrics] Fear & Greed failed:", e.message); }

  // --- 6. Top Gainers/Losers from Binance Spot (server already has this) ---
  try {
    const binanceTickers = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/24hr", {}, 5000).then(r => r.json()).catch(() => []);
    if (Array.isArray(binanceTickers) && binanceTickers.length > 0) {
      const usdtPairs = binanceTickers.filter((t: any) => t.symbol.endsWith("USDT") && parseFloat(t.quoteVolume) > 1000000);
      const sorted = [...usdtPairs].sort((a: any, b: any) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
      result.gainers = sorted.slice(0, 10).map((t: any) => ({
        symbol: t.symbol.replace("USDT", ""),
        price: parseFloat(t.lastPrice),
        change: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)),
        volume: formatCompactVolume(parseFloat(t.quoteVolume)),
        volumeUsd: parseFloat(t.quoteVolume),
      }));
      result.losers = sorted.slice(-10).reverse().map((t: any) => ({
        symbol: t.symbol.replace("USDT", ""),
        price: parseFloat(t.lastPrice),
        change: parseFloat(parseFloat(t.priceChangePercent).toFixed(2)),
        volume: formatCompactVolume(parseFloat(t.quoteVolume)),
        volumeUsd: parseFloat(t.quoteVolume),
      }));
      binanceSectionsFetched++;
    }
  } catch(e: any) { log.error("[Metrics] Binance gainers/losers failed:", e.message); }

  // DATA-8: If ALL Binance sections failed, the endpoint is degraded —
  // serve success:false so the frontend shows an honest error instead
  // of implying full data coverage. CoinGecko/fear-greed data may
  // still be present for partial display.
  if (binanceSectionsFetched === 0) {
    return res.json({
      success: false,
      isStale: true,
      lastUpdated: new Date().toISOString(),
      error: "Binance Futures API tidak dapat dijangkau. Data derivatif (funding rate, open interest, gainers/losers) tidak tersedia. CoinGecko data mungkin masih tersedia.",
      fundingRates: null,
      openInterest: null,
      gainers: null,
      losers: null,
      market: result.market || null,
      btcPriceHistory: result.btcPriceHistory || null,
      btcVolumeHistory: result.btcVolumeHistory || null,
      fearGreed: result.fearGreed || null,
    });
  }

  metricsCache = result;
  metricsCacheTime = now;
  return res.json(result);
});

function formatCompactVolume(val: number): string {
  if (val >= 1e9) return `$${(val/1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val/1e6).toFixed(1)}M`;
  if (val >= 1e3) return `$${(val/1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

// GET ROUTE CALLING THE DATA RETRIEVAL DECODER
app.get("/api/onchain/data", async (req, res) => {
  try {
    const [data, derivatives] = await Promise.all([
      fetchLatestOnChainData(),
      getLiveBinanceDerivatives()
    ]);
    
    return res.json({
      success: true,
      // DATA-16: propagate the upstream staleness flag (true when any
      // on-chain source fell back) so the frontend can label stale data
      // instead of silently presenting it as live.
      isStale: data.isStale === true,
      blockHeight: data.blockHeight,
      blockHash: data.blockHash,
      recommendedFees: data.recommendedFees,
      processedTxs: data.processedTxs,
      btcPrice: data.btcPrice,
      btcPriceChangePercent: data.btcPriceChangePercent,
      ethPrice: data.ethPrice,
      ethPriceChangePercent: data.ethPriceChangePercent,
      bnbPrice: data.bnbPrice,
      bnbPriceChangePercent: data.bnbPriceChangePercent,
      solPrice: data.solPrice,
      solPriceChangePercent: data.solPriceChangePercent,
      trxPrice: data.trxPrice,
      trxPriceChangePercent: data.trxPriceChangePercent,
      xrpPrice: data.xrpPrice,
      xrpPriceChangePercent: data.xrpPriceChangePercent,
      hypePrice: data.hypePrice,
      hypePriceChangePercent: data.hypePriceChangePercent,
      liveLiquidations: liveLiquidationsList,
      derivatives: derivatives,
      lastUpdated: new Date().toISOString()
    });
  } catch (err: any) {
    log.error("[On-Chain Data ERROR]", err.message);
    return res.status(500).json({
      success: false,
      error: "Gagal memproses data on-chain bursa real-time: " + err.message
    });
  }
});

// --- 3. GET /api/onchain/orderbook -----------------------------------------
// Live Binance orderbook depth with bid/ask pressure analysis. 5s cache.
let orderbookCache: Map<string, { data: any; ts: number }> = new Map();
const ORDERBOOK_CACHE_TTL = 5 * 1000; // 5 seconds

app.get("/api/onchain/orderbook", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().trim();
    const now = Date.now();
    const cached = orderbookCache.get(symbol);
    if (cached && now - cached.ts < ORDERBOOK_CACHE_TTL) {
      return res.json(cached.data);
    }

    const url = `https://api.binance.com/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=100`;
    const response = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } }, 5000);
    if (!response.ok) {
      throw new Error(`Binance depth returned HTTP ${response.status}`);
    }
    const data = await response.json() as any;
    const bids: [string, string][] = Array.isArray(data?.bids) ? data.bids : [];
    const asks: [string, string][] = Array.isArray(data?.asks) ? data.asks : [];

    let bidTotal = 0;
    for (const [p, q] of bids) {
      const price = parseFloat(p); const qty = parseFloat(q);
      if (isFinite(price) && isFinite(qty)) bidTotal += price * qty;
    }
    let askTotal = 0;
    for (const [p, q] of asks) {
      const price = parseFloat(p); const qty = parseFloat(q);
      if (isFinite(price) && isFinite(qty)) askTotal += price * qty;
    }
    const bidPressure = (bidTotal + askTotal) > 0
      ? parseFloat((bidTotal / (bidTotal + askTotal)).toFixed(4))
      : 0.5;

    const bestBid = bids.length ? parseFloat(bids[0][0]) : 0;
    const bestAsk = asks.length ? parseFloat(asks[0][0]) : 0;
    const spread = (bestBid > 0 && bestAsk > 0)
      ? parseFloat((bestAsk - bestBid).toFixed(8))
      : 0;

    const payload = {
      success: true,
      symbol,
      bids: bids.slice(0, 20),
      asks: asks.slice(0, 20),
      bidTotal: parseFloat(bidTotal.toFixed(2)),
      askTotal: parseFloat(askTotal.toFixed(2)),
      bidPressure,
      spread,
      lastUpdated: new Date().toISOString()
    };
    orderbookCache.set(symbol, { data: payload, ts: now });
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "Gagal memproses permintaan. Silakan coba lagi nanti." });
  }
});

// --- 4. GET /api/onchain/altcoin-season -----------------------------------
// Altcoin Season Index from blockchaincenter.net. 30 min cache.
let altcoinSeasonCache: { index: number; isAltcoinSeason: boolean; lastUpdated: string } | null = null;
let altcoinSeasonCacheTime = 0;
const ALTCOIN_SEASON_CACHE_TTL = 30 * 60 * 1000;

app.get("/api/onchain/altcoin-season", async (req, res) => {
  try {
    const now = Date.now();
    if (altcoinSeasonCache && now - altcoinSeasonCacheTime < ALTCOIN_SEASON_CACHE_TTL) {
      return res.json({
        success: true,
        index: altcoinSeasonCache.index,
        isAltcoinSeason: altcoinSeasonCache.isAltcoinSeason,
        lastUpdated: altcoinSeasonCache.lastUpdated
      });
    }

    let index: number | null = null;
    try {
      const r = await fetchWithTimeout(
        "https://api.blockchaincenter.net/v1/altcoinseason/",
        { headers: { "Accept": "application/json" } },
        6000
      );
      if (r.ok) {
        const text = (await r.text()).trim();
        // API may return a bare integer or JSON; handle both.
        const parsed = JSON.parse(text);
        if (typeof parsed === "number") {
          index = parsed;
        } else if (parsed && typeof parsed === "object") {
          index = parseFloat(parsed?.value ?? parsed?.index ?? parsed?.altcoinSeasonIndex);
        }
      }
    } catch (err: any) {
      log.info("[Altcoin Season] blockchaincenter fetch handled:", err.message);
    }

    // Fallback: derive a simple proxy from CoinGecko global dominance.
    if (index === null || !isFinite(index)) {
      try {
        const cg = await fetchWithTimeout(
          "https://api.coingecko.com/api/v3/global",
          { headers: { "Accept": "application/json" } },
          6000
        );
        if (cg.ok) {
          const cgData = await cg.json() as any;
          const btcDom = parseFloat(cgData?.data?.market_cap_percentage?.btc);
          if (isFinite(btcDom)) {
            // Heuristic: when BTC dominance is low (<40), altcoins are stronger.
            // Map 25% dom -> 100 index, 60% dom -> 0 index (clamped).
            const proxy = Math.round(Math.max(0, Math.min(100, (60 - btcDom) / (60 - 25) * 100)));
            index = proxy;
          }
        }
      } catch (err: any) {
        log.info("[Altcoin Season] CoinGecko proxy fetch handled:", err.message);
      }
    }

    if (index === null || !isFinite(index)) {
      return res.status(502).json({
        success: false,
        error: "Altcoin Season Index unavailable from all sources."
      });
    }

    const isAltcoinSeason = index >= 75;
    const payload = {
      success: true,
      index: Math.round(index),
      isAltcoinSeason,
      lastUpdated: new Date().toISOString()
    };
    altcoinSeasonCache = {
      index: payload.index,
      isAltcoinSeason,
      lastUpdated: payload.lastUpdated
    };
    altcoinSeasonCacheTime = now;
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "Gagal memproses permintaan. Silakan coba lagi nanti." });
  }
});

// --- 5. GET /api/onchain/oi-history ---------------------------------------
// Binance Futures open-interest history. 10 min cache.
let oiHistoryCache: Map<string, { data: any; ts: number }> = new Map();
const OI_HISTORY_CACHE_TTL = 10 * 60 * 1000;

app.get("/api/onchain/oi-history", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().trim();
    const days = Math.max(1, Math.min(90, parseInt(String(req.query.days || "30"), 10) || 30));
    const now = Date.now();
    const cacheKey = `${symbol}_${days}`;
    const cached = oiHistoryCache.get(cacheKey);
    if (cached && now - cached.ts < OI_HISTORY_CACHE_TTL) {
      return res.json(cached.data);
    }

    const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=1d&limit=${days}`;
    const r = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } }, 6000);
    if (!r.ok) throw new Error(`Binance fapi OI history HTTP ${r.status}`);
    const raw = await r.json() as any[];
    const history = (Array.isArray(raw) ? raw : []).map((row: any) => ({
      date: row?.timestamp ? new Date(row.timestamp).toISOString().slice(0, 10) : "",
      openInterest: parseFloat(row?.sumOpenInterest) || 0
    })).filter(h => h.date);

    const payload = {
      success: true,
      symbol,
      history,
      lastUpdated: new Date().toISOString()
    };
    oiHistoryCache.set(cacheKey, { data: payload, ts: now });
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "Gagal memproses permintaan. Silakan coba lagi nanti." });
  }
});

// --- 6. GET /api/onchain/dominance-history --------------------------------
// BTC/ETH dominance 30d history. CoinGecko's `/global/market_cap_chart`
// endpoint now requires a DEMO API key (returns 401 for free tier), so we
// derive the history from public per-coin market_chart endpoints for BTC and
// ETH plus a single /global call to anchor the BTC+ETH share of total market
// cap. 30 min cache.
let dominanceHistoryCache: Map<string, { data: any; ts: number }> = new Map();
const DOMINANCE_HISTORY_CACHE_TTL = 30 * 60 * 1000;

app.get("/api/onchain/dominance-history", async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(String(req.query.days || "30"), 10) || 30));
    const now = Date.now();
    const cacheKey = `d_${days}`;
    const cached = dominanceHistoryCache.get(cacheKey);
    if (cached && now - cached.ts < DOMINANCE_HISTORY_CACHE_TTL) {
      return res.json(cached.data);
    }

    // Fetch BTC and ETH market_cap series (free /coins/{id}/market_chart).
    const [btcRes, ethRes, globalRes] = await Promise.allSettled([
      fetchWithTimeout(
        `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`,
        { headers: { "Accept": "application/json" } },
        8000
      ),
      fetchWithTimeout(
        `https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=${days}&interval=daily`,
        { headers: { "Accept": "application/json" } },
        8000
      ),
      fetchWithTimeout(
        "https://api.coingecko.com/api/v3/global",
        { headers: { "Accept": "application/json" } },
        5000
      )
    ]);

    if (btcRes.status !== "fulfilled" || !btcRes.value.ok) {
      throw new Error("Failed to fetch BTC market_chart from CoinGecko.");
    }
    if (ethRes.status !== "fulfilled" || !ethRes.value.ok) {
      throw new Error("Failed to fetch ETH market_chart from CoinGecko.");
    }

    const btcData = await btcRes.value.json() as any;
    const ethData = await ethRes.value.json() as any;
    const btcMcArr: [number, number][] = btcData?.market_caps || [];
    const ethMcArr: [number, number][] = ethData?.market_caps || [];

    if (!btcMcArr.length || !ethMcArr.length) {
      throw new Error("CoinGecko returned no usable dominance history rows.");
    }

    // Anchor: from /global we read the CURRENT market_cap_percentage for BTC
    // and ETH. We assume the BTC+ETH share of total market cap is approximately
    // constant over the requested window; this lets us back out a historical
    // total market cap from the sum of BTC + ETH market caps.
    let btcPctNow = 0;
    let ethPctNow = 0;
    if (globalRes.status === "fulfilled" && globalRes.value.ok) {
      try {
        const gData = await globalRes.value.json() as any;
        btcPctNow = parseFloat(gData?.data?.market_cap_percentage?.btc) || 0;
        ethPctNow = parseFloat(gData?.data?.market_cap_percentage?.eth) || 0;
      } catch { /* ignore parse error */ }
    }
    const btcEthShare = (btcPctNow + ethPctNow) > 0 ? (btcPctNow + ethPctNow) / 100 : 0.6;

    const n = Math.min(btcMcArr.length, ethMcArr.length);
    const history: any[] = [];
    for (let i = 0; i < n; i++) {
      const [tsBtc, btcMc] = btcMcArr[i];
      const [, ethMc] = ethMcArr[i];
      // CoinGecko returns numbers, but defensively coerce via Number() in case a string slips through.
      const btcNum = Number(btcMc) || 0;
      const ethNum = Number(ethMc) || 0;
      const btcEthSum = btcNum + ethNum;
      if (btcEthSum <= 0) continue;
      const totalEstimate = btcEthSum / btcEthShare;
      history.push({
        date: new Date(tsBtc).toISOString().slice(0, 10),
        btcDominance: parseFloat((btcNum / totalEstimate * 100).toFixed(2)),
        ethDominance: parseFloat((ethNum / totalEstimate * 100).toFixed(2)),
        totalMarketCap: parseFloat(totalEstimate.toFixed(0))
      });
    }

    if (!history.length) {
      throw new Error("No dominance rows could be derived.");
    }

    const payload = {
      success: true,
      history,
      lastUpdated: new Date().toISOString(),
      source: "Derived from CoinGecko BTC/ETH market_chart + /global anchor"
    };
    dominanceHistoryCache.set(cacheKey, { data: payload, ts: now });
    return res.json(payload);
  } catch (err: any) {
    return res.json({ success: false, error: "Gagal memproses permintaan. Silakan coba lagi nanti." });
  }
});


// --- 9. GET /api/onchain/correlations -------------------------------------
// Pearson correlation of BTC daily returns vs S&P500, Gold, DXY, Nasdaq.
// 1 hour cache. Partial failures return available correlations only.
let correlationsCache: { data: any; ts: number } | null = null;
const CORRELATIONS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]; sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  if (!isFinite(den) || den === 0) return null;
  return parseFloat((num / den).toFixed(4));
}

function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && isFinite(closes[i]) && isFinite(closes[i - 1])) {
      out.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }
  return out;
}

app.get("/api/onchain/correlations", async (req, res) => {
  try {
    const now = Date.now();
    if (correlationsCache && now - correlationsCache.ts < CORRELATIONS_CACHE_TTL) {
      return res.json(correlationsCache.data);
    }

    const yahooHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json"
    };

    // BTC daily closes (30d) from CoinGecko.
    const btcCloses: number[] = [];
    try {
      const r = await fetchWithTimeout(
        "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily",
        { headers: { "Accept": "application/json" } },
        8000
      );
      if (r.ok) {
        const data = await r.json() as any;
        const prices: [number, number][] = data?.prices || [];
        for (const [, p] of prices) {
          const v = Number(p);
          if (isFinite(v) && v > 0) btcCloses.push(v);
        }
      }
    } catch (err: any) {
      log.info("[Correlations] CoinGecko BTC fetch handled:", err.message);
    }

    const btcReturns = dailyReturns(btcCloses);

    const targets = [
      { asset: "S&P 500", symbol: "^GSPC" },
      { asset: "Gold", symbol: "GC=F" },
      { asset: "DXY", symbol: "DX-Y.NYB" },
      { asset: "Nasdaq", symbol: "^IXIC" }
    ];

    const correlations: { asset: string; correlation: number | null }[] = [];

    const assetResults = await Promise.allSettled(targets.map(async (t) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t.symbol)}?range=1mo&interval=1d`;
      const r = await fetchWithTimeout(url, { headers: yahooHeaders }, 6000);
      if (!r.ok) throw new Error(`${t.symbol} HTTP ${r.status}`);
      const data = await r.json() as any;
      const closes: number[] = (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
        .map((v: any) => parseFloat(v))
        .filter((v: number) => isFinite(v) && v > 0);
      return { asset: t.asset, returns: dailyReturns(closes) };
    }));

    for (const r of assetResults) {
      if (r.status !== "fulfilled") continue;
      const corr = pearson(btcReturns, r.value.returns);
      correlations.push({ asset: r.value.asset, correlation: corr });
    }

    const payload = {
      success: true,
      correlations,
      btcReturnDays: btcReturns.length,
      lastUpdated: new Date().toISOString()
    };
    correlationsCache = { data: payload, ts: now };
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "Gagal memproses permintaan. Silakan coba lagi nanti." });
  }
});
} // end registerOnchainRoutes

