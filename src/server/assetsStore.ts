// =============================================================================
// assetsStore.ts — QA9-R3: live market-asset engine — initial asset registry,
// the 2s Binance/Yahoo refresh routine (stale-flagging, warmup state), and
// the refresh-hook registry the signal engine subscribes to.
// Extracted verbatim from server.ts (was 350-557, 574-744; the direct
// updatePendingSignals() call became a hook so deps stay one-directional).
// =============================================================================
import { fetchWithTimeout } from "./httpUtils";
import { createLogger } from "./logger";

const log = createLogger("assetsStore");

// QA9-R3: hook registry — replaces the direct updatePendingSignals() call that
// used to live inside refreshLiveAssets (server.ts:743). signalEngine
// subscribes via registerAssetsRefreshHook(); keeps module deps acyclic.
const assetsRefreshHooks: Array<() => void> = [];
export function registerAssetsRefreshHook(cb: () => void): void {
  assetsRefreshHooks.push(cb);
}

// Data store containing Indonesian Stocks and Cryptos
const initialAssets: any[] = [
  // Indonesian Bluechip Stocks (IHSG)
  {
    id: "s_bbca",
    symbol: "BBCA",
    name: "Bank Central Asia Tbk",
    category: "stock" as const,
    price: 9500,
    change24h: 3.2,
    marketCap: 1170000000000000,
    volume24h: 350000000000,
  },
  {
    id: "s_bbri",
    symbol: "BBRI",
    name: "Bank Rakyat Indonesia Tbk",
    category: "stock" as const,
    price: 4900,
    change24h: -1.2,
    marketCap: 742000000000000,
    volume24h: 410000000000,
  },
  {
    id: "s_tlkm",
    symbol: "TLKM",
    name: "Telkom Indonesia Tbk",
    category: "stock" as const,
    price: 3600,
    change24h: 0.5,
    marketCap: 356000000000000,
    volume24h: 180000000000,
  },
  {
    id: "s_goto",
    symbol: "GOTO",
    name: "GoTo Gojek Tokopedia Tbk",
    category: "stock" as const,
    price: 58,
    change24h: -3.4,
    marketCap: 68000000000000,
    volume24h: 120000000000,
  },
  {
    id: "s_asii",
    symbol: "ASII",
    name: "Astra International Tbk",
    category: "stock" as const,
    price: 4800,
    change24h: 1.8,
    marketCap: 194000000000000,
    volume24h: 89000000000,
  },
  {
    id: "s_unvr",
    symbol: "UNVR",
    name: "Unilever Indonesia Tbk",
    category: "stock" as const,
    price: 2800,
    change24h: -0.2,
    marketCap: 106000000000000,
    volume24h: 42000000000,
  },
  {
    id: "s_adro",
    symbol: "ADRO",
    name: "Adaro Energy Indonesia Tbk",
    category: "stock" as const,
    price: 2750,
    change24h: 2.5,
    marketCap: 87000000000000,
    volume24h: 65000000000,
  },
  // Cryptocurrencies (Global)
  {
    id: "c_btc",
    symbol: "BTC",
    name: "Bitcoin",
    category: "crypto" as const,
    price: 68420,
    change24h: 0.0,
    marketCap: 1345000000000,
    volume24h: 28500000000,
  },
  {
    id: "c_eth",
    symbol: "ETH",
    name: "Ethereum",
    category: "crypto" as const,
    price: 3540,
    change24h: 0.0,
    marketCap: 425000000000,
    volume24h: 15100000000,
  },
  {
    id: "c_sol",
    symbol: "SOL",
    name: "Solana",
    category: "crypto" as const,
    price: 164.5,
    change24h: 0.0,
    marketCap: 74500000000,
    volume24h: 3800000000,
  },
  {
    id: "c_bnb",
    symbol: "BNB",
    name: "BNB",
    category: "crypto" as const,
    price: 585.2,
    change24h: 0.0,
    marketCap: 86500000000,
    volume24h: 1200000000,
  },
  {
    id: "c_doge",
    symbol: "DOGE",
    name: "Dogecoin",
    category: "crypto" as const,
    price: 0.142,
    change24h: 0.0,
    marketCap: 20500000000,
    volume24h: 980000000,
  },
  {
    id: "c_ada",
    symbol: "ADA",
    name: "Cardano",
    category: "crypto" as const,
    price: 0.465,
    change24h: 0.0,
    marketCap: 1650000000,
    volume24h: 340000000,
  },
  {
    id: "c_xrp",
    symbol: "XRP",
    name: "Ripple",
    category: "crypto" as const,
    price: 0.524,
    change24h: 0.0,
    marketCap: 28500000000,
    volume24h: 890000000,
  },
  {
    id: "c_sui",
    symbol: "SUI",
    name: "Sui",
    category: "crypto" as const,
    price: 1.15,
    change24h: 0.0,
    marketCap: 2900000000,
    volume24h: 210000000,
  },
  {
    id: "c_pepe",
    symbol: "PEPE",
    name: "Pepe",
    category: "crypto" as const,
    price: 0.0000145,
    change24h: 0.0,
    marketCap: 6100000000,
    volume24h: 1350000000,
  },
  {
    id: "c_link",
    symbol: "LINK",
    name: "Chainlink",
    category: "crypto" as const,
    price: 15.6,
    change24h: 0.0,
    marketCap: 9200000000,
    volume24h: 250000000,
  },
  {
    id: "c_avax",
    symbol: "AVAX",
    name: "Avalanche",
    category: "crypto" as const,
    price: 32.8,
    change24h: 0.0,
    marketCap: 12800000000,
    volume24h: 420000000,
  },
  {
    id: "c_shib",
    symbol: "SHIB",
    name: "Shiba Inu",
    category: "crypto" as const,
    price: 0.0000215,
    change24h: 0.0,
    marketCap: 12600000000,
    volume24h: 650000000,
  }
];

// In-memory runtime asset registry
export let liveAssets = [...initialAssets];

// DATA-5: the hardcoded initialAssets above are WARMUP values only — a static
// snapshot so the first paint is not empty. `assetsLiveReady` flips to true
// after the first successful live market refresh, and /api/assets exposes
// `isWarmup: !assetsLiveReady` so consumers can label pre-refresh values
// as warmup data instead of mistaking them for live quotes.
export let assetsLiveReady = false;

export let lastQuotesFetch = 0;
export const QUOTE_CACHE_TTL = 2000; // 2 seconds cache for extreme real-time speed

export async function refreshLiveAssets() {
  const now = Date.now();
  if (now - lastQuotesFetch < QUOTE_CACHE_TTL) {
    return;
  }

  let updatedCrypto = false;
  let updatedStocks = false;
  // DATA-4: tracks which asset symbols got a REAL price update in this pass
  // so failed ones can be flagged `isStale` instead of being simulated.
  const updatedSymbols = new Set<string>();

  // 1. Fetch Crypto prices from Binance (highly reliable, no rate limits, no 401)
  try {
    const binanceRes = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/24hr", {
      headers: { "Accept": "application/json" }
    }, 4500);
    if (binanceRes.ok) {
      const tickers = await binanceRes.json() as any[];
      
      // Build dynamic map for checking crypto assets currently in memory
      const cryptoPairs: Record<string, string> = {};
      liveAssets.forEach((asset: any) => {
        if (asset.category === "crypto") {
          cryptoPairs[`${asset.symbol.toUpperCase()}USDT`] = asset.symbol.toUpperCase();
        }
      });
      
      tickers.forEach((t: any) => {
        const sym = cryptoPairs[t.symbol];
        if (sym) {
          const asset = liveAssets.find(a => a.symbol.toUpperCase() === sym && a.category === "crypto");
          if (asset) {
            if (t.lastPrice != null) asset.price = parseFloat(t.lastPrice);
            if (t.priceChangePercent != null) {
              asset.change24h = parseFloat(parseFloat(t.priceChangePercent).toFixed(2));
            }
            if (t.quoteVolume != null) {
              asset.volume24h = parseFloat(t.quoteVolume);
            }
            asset.isStale = false;
            updatedSymbols.add(sym);
          }
        }
      });
      updatedCrypto = true;
      log.info("Crypto assets refreshed from Binance API successfully.");
    } else {
      throw new Error(`Binance API returned status: ${binanceRes.status}`);
    }
  } catch (bErr: any) {
    log.info("Binance crypto fetch handled status:", bErr.message);
  }

  // 2. Fetch Indonesian Stocks and Fallbacks from Yahoo Finance using resilient /v8/finance/chart (bypasses 401 entirely)
  try {
    const symbolsToFetch = liveAssets
      .filter(a => a.category === "stock")
      .map(a => {
        const sym = a.symbol.toUpperCase();
        return sym.endsWith(".JK") ? sym : `${sym}.JK`;
      });
    
    // If cryptos were not successfully fetched via Binance, include them as safety fallbacks
    if (!updatedCrypto) {
      liveAssets
        .filter(a => a.category === "crypto")
        .forEach(a => {
          symbolsToFetch.push(`${a.symbol.toUpperCase()}-USD`);
        });
    }

    const fetches = symbolsToFetch.map(async (sym) => {
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?range=5d&interval=1d`;
        const response = await fetchWithTimeout(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
          }
        }, 3500);
        if (!response.ok) {
          return null; // Suppress rating errors on weekend limits
        }
        return await response.json();
      } catch (err) {
        return null;
      }
    });

    const results = await Promise.all(fetches);
    let successfullyUpdatedCount = 0;

    results.forEach((data, index) => {
      if (data) {
        const resultItem = data?.chart?.result?.[0];
        if (resultItem) {
          const itemSymbol = symbolsToFetch[index];
          const meta = resultItem.meta;
          const quote = resultItem.indicators?.quote?.[0];

          const price = meta?.regularMarketPrice;
          const prevClose = meta?.chartPreviousClose || meta?.previousClose;
          
          if (price != null) {
            const asset = liveAssets.find(a => {
              if (a.category === "stock") {
                const sym = a.symbol.toUpperCase();
                const expected = sym.endsWith(".JK") ? sym : `${sym}.JK`;
                return expected === itemSymbol;
              } else {
                return `${a.symbol.toUpperCase()}-USD` === itemSymbol;
              }
            });

            if (asset) {
              asset.price = price;
              asset.isStale = false;
              updatedSymbols.add(asset.symbol.toUpperCase());
              if (prevClose != null && prevClose > 0) {
                asset.change24h = parseFloat((((price - prevClose) / prevClose) * 100).toFixed(2));
              }
              // Try to find volume in quote
              const vol = quote?.volume?.[0];
              if (vol != null && vol > 0) {
                asset.volume24h = vol;
              }
              successfullyUpdatedCount++;
            }
          }
        }
      }
    });

    if (successfullyUpdatedCount > 0) {
      updatedStocks = true;
      log.info(`Successfully updated ${successfullyUpdatedCount} stock assets from resilient Yahoo Finance chart API.`);
    }
  } catch (err: any) {
    log.info("[Resilience] Fallback triggered: Failed to fetch stocks from resonant chart:", err.message);
  }

  // 3. DATA-4: NO fabricated price fluctuation anymore. When a category
  // fails to refresh from real sources we keep the LAST KNOWN REAL price and
  // flag those assets `isStale: true` so the frontend can label them (e.g.
  // "harga terakhir tersimpan — sumber data gagal"). Prices are never
  // random-walked.
  if (!updatedStocks || !updatedCrypto) {
    liveAssets = liveAssets.map(asset => {
      if (updatedSymbols.has(asset.symbol.toUpperCase())) {
        return asset.isStale === true ? { ...asset, isStale: false } : asset;
      }
      const categoryFailed = asset.category === "stock" ? !updatedStocks : !updatedCrypto;
      if (categoryFailed) {
        return { ...asset, isStale: true };
      }
      return asset;
    });
  }

  // DATA-5: first successful real refresh flips the warmup state off.
  if (updatedCrypto || updatedStocks) {
    assetsLiveReady = true;
  }

  // Always markQuotesFetch so we obey TTL cache restrictions
  lastQuotesFetch = now;

  // Evaluate and update states of all pending trading signals in-memory
  for (const hook of assetsRefreshHooks) {
    try { hook(); } catch (e: any) { log.info("assets refresh hook error:", e?.message || e); }
  }
}
