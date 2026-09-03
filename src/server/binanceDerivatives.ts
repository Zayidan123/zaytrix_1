// =============================================================================
// binanceDerivatives.ts — QA9-R3: Binance Futures derivatives feed — the
// real-time liquidation WebSocket worker (!forceOrder@arr, boots on import;
// was server.ts:3349) and the symbol derivatives cache
// (funding rate / open interest / basis). Extracted verbatim from server.ts
// (was 3269-3442).
// =============================================================================
import WebSocket from "ws";
import { fetchWithTimeout } from "./httpUtils";
import { createLogger } from "./logger";

const log = createLogger("binanceDerivatives");

// --- REAL-TIME LIQUIDATION FEED WORKER (BINANCE FUTURES WS) ---
interface LiveLiquidationEvent {
  id: string;
  symbol: string;
  side: "BUY" | "SELL"; // BUY = Short liquidation, SELL = Long liquidation
  price: number;
  quantity: number;
  usdAmount: number;
  timestamp: string;
}

export let liveLiquidationsList: LiveLiquidationEvent[] = [];

// DATA-14: the `seedLiquidations()` function that injected 20 FAKE liquidation
// events (Math.random prices/quantities for BTC/ETH/SOL/BNB/XRP) was deleted.
// The feed now starts EMPTY and only fills with REAL Binance Futures
// `!forceOrder@arr` WebSocket events. The frontend renders an honest empty
// state until real events arrive.

function initBinanceLiquidationWS() {
  log.info("[Binance WS] Initializing real-time Futures Liquidation Feed...");
  const wsUrl = "wss://fstream.binance.com/ws/!forceOrder@arr";
  
  try {
    let ws = new WebSocket(wsUrl);
    
    ws.on("open", () => {
      log.info("[Binance WS] Connected to Binance Futures Liquidation Stream successfully.");
    });
    
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg && msg.e === "forceOrder" && msg.o) {
          const order = msg.o;
          const symbol = order.s; // e.g. BTCUSDT
          const side = order.S; // BUY or SELL
          const price = parseFloat(order.ap); // Average price
          const quantity = parseFloat(order.q); // Quantity
          const usdAmount = price * quantity;
          const timestamp = new Date(msg.E).toISOString(); // Event time
          
          if (usdAmount >= 1000) {
            const event: LiveLiquidationEvent = {
              id: `liq_${msg.E}_${Math.random().toString(36).substring(2, 6)}`,
              symbol: symbol.replace("USDT", ""),
              side: side as "BUY" | "SELL",
              price,
              quantity,
              usdAmount,
              timestamp
            };
            
            liveLiquidationsList.unshift(event);
            if (liveLiquidationsList.length > 100) {
              liveLiquidationsList.pop();
            }
          }
        }
      } catch (err: any) {
        log.error("[Binance WS] Message processing error:", err.message);
      }
    });
    
    ws.on("error", (err) => {
      log.error("[Binance WS] Connection error:", err.message);
    });
    
    ws.on("close", () => {
      log.warn("[Binance WS] Connection closed. Reconnecting in 5 seconds...");
      setTimeout(() => {
        initBinanceLiquidationWS();
      }, 5000);
    });
  } catch (err: any) {
    log.error("[Binance WS] Failed to establish WS client:", err.message);
  }
}

// Start Binance Liquidation Web Socket listener background thread
initBinanceLiquidationWS();


// --- CACHED REAL-TIME BINANCE DERIVATIVES DATA FETCHERS ---
let derivativesCache: any = null;
let derivativesCacheTime = 0;

// DATA-15: derivatives metrics are null unless the Binance fapi fetch for
// that metric ACTUALLY succeeded. The old hardcoded defaults (OI 1.45B,
// funding 0.015, L/S 1.42, etc.) were fabricated values and are removed.
export async function fetchBinanceSymbolDerivatives(symbol: string) {
  let openInterest: number | null = null;
  let fundingRate: number | null = null;
  let longShortRatio: number | null = null;

  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
    if (res.ok) {
      const data = await res.json() as any;
      const oi = parseFloat(data?.openInterest);
      if (isFinite(oi)) openInterest = oi;
    }
  } catch (e: any) {
    log.info(`[Binance Fetch] OI failed for ${symbol}:`, e.message);
  }

  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    if (res.ok) {
      const data = await res.json() as any;
      const fr = parseFloat(data?.lastFundingRate);
      if (isFinite(fr)) fundingRate = fr * 100;
    }
  } catch (e: any) {
    log.info(`[Binance Fetch] FR failed for ${symbol}:`, e.message);
  }

  try {
    const res = await fetch(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=5m`);
    if (res.ok) {
      const data = await res.json() as any;
      if (Array.isArray(data) && data.length > 0) {
        const ls = parseFloat(data[data.length - 1].longShortRatio);
        if (isFinite(ls)) longShortRatio = ls;
      }
    }
  } catch (e: any) {
    log.info(`[Binance Fetch] L/S failed for ${symbol}:`, e.message);
  }

  return { openInterest, fundingRate, longShortRatio };
}

export async function getLiveBinanceDerivatives() {
  const now = Date.now();
  if (derivativesCache && now - derivativesCacheTime < 15000) {
    return derivativesCache;
  }

  try {
    const [btc, eth, sol] = await Promise.all([
      fetchBinanceSymbolDerivatives("BTCUSDT"),
      fetchBinanceSymbolDerivatives("ETHUSDT"),
      fetchBinanceSymbolDerivatives("SOLUSDT")
    ]);

    // DATA-15: if every metric failed to fetch (all null), serve nulls with
    // isStale:true instead of fabricated numbers.
    const allNull = [btc, eth, sol].every((d: any) =>
      d.openInterest == null && d.fundingRate == null && d.longShortRatio == null);
    derivativesCache = allNull
      ? { btc: null, eth: null, sol: null, isStale: true }
      : { btc, eth, sol };
    derivativesCacheTime = now;
  } catch (err: any) {
    log.error("[Binance Fetch] Failed to fetch derivatives:", err.message);
    if (!derivativesCache) {
      // DATA-15: no hardcoded fallback values — nulls + isStale flag so the
      // frontend can render "tidak tersedia".
      derivativesCache = {
        btc: null,
        eth: null,
        sol: null,
        isStale: true
      };
    } else {
      // Serving expired (but real) cache while fapi is down — mark it stale.
      derivativesCache = { ...derivativesCache, isStale: true };
    }
  }
  return derivativesCache;
}


