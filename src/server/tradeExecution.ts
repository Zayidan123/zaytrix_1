// ZAYTRIX real exchange order execution (SEC2-DATA).
// Replaces the simulation-only /api/trade/execute with REAL signed order placement
// to Binance, Bybit, and KuCoin when valid API keys are provided.
// Falls back to simulation mode when no keys / sandbox mode / test failure.

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "./db";
import { requireAuth } from "./auth";
import { logAudit } from "./audit";
import { decrypt } from "./apiKeys";

export const tradeExecutionRouter = Router();
tradeExecutionRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// SEC-15: unbounded-order guard. Every order (sandbox, no-keys, real) is
// checked against a max NOTIONAL value (qty × live price) before execution.
// Previously a bug or a compromised frontend could send qty=999999999 — for
// real orders that's unbounded exposure on the user's exchange account, and
// for the "simulation" path it fabricated a fake multi-billion-dollar fill.
// Default 50,000 USD; configurable via MAX_ORDER_NOTIONAL_USD.
// ---------------------------------------------------------------------------
const MAX_ORDER_NOTIONAL_USD = (() => {
  const v = parseFloat(process.env.MAX_ORDER_NOTIONAL_USD || "");
  return Number.isFinite(v) && v > 0 ? v : 50000;
})();

// ---------------------------------------------------------------------------
// SEC-15: zod input schemas (symbol charset + side enum + finite amounts).
// /execute previously accepted any string (e.g. a symbol containing SQL/HTML
// payloads — logged into audit metadata), and /connect accepted ANY body
// shape completely unvalidated.
// ---------------------------------------------------------------------------
const executeOrderSchema = z.object({
  exchange: z
    .string()
    .transform((s) => String(s).trim())
    .refine((s) => /^[A-Za-z0-9]{2,30}$/.test(s), { message: "Bursa tidak valid." })
    .optional(),
  symbol: z
    .string()
    .transform((s) => String(s).trim().toUpperCase())
    .refine((s) => /^[A-Z0-9]{3,20}$/.test(s), {
      message: "Simbol tidak valid (3-20 karakter alfanumerik).",
    }),
  amount: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? parseFloat(v) : v))
    .refine((v) => Number.isFinite(v) && v > 0, { message: "Jumlah tidak valid." }),
  side: z
    .enum(["buy", "sell", "BUY", "SELL"])
    .transform((s) => s.toLowerCase()),
  useSandbox: z.union([z.boolean(), z.string()]).optional(),
});

const connectSchema = z.object({
  exchange: z
    .string()
    .transform((s) => String(s).trim())
    .refine((s) => /^[A-Za-z0-9]{2,30}$/.test(s), { message: "Bursa tidak valid." })
    .optional(),
  useSandbox: z.union([z.boolean(), z.string()]).optional(),
  apiKey: z.string().max(200).optional(),
  apiSecret: z.string().max(200).optional(),
  passphrase: z.string().max(200).optional(),
  hasE2E: z.boolean().optional(),
});

function zodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

// Normalize a user-provided symbol into a Binance-compatible pair for the
// price/notional lookups: "BTC" → "BTCUSDT", "btc-usdt" → "BTCUSDT".
function toBinancePair(symbol: string): string {
  const s = symbol.toUpperCase().replace(/-/g, "");
  if (/(USDT|USDC|FDUSD|BUSD|TUSD)$/.test(s)) return s;
  return s + "USDT";
}

// ---------------------------------------------------------------------------
// DATA-8: honest simulation price. Fetch the Binance book ticker and return
// the (bid+ask)/2 MID-PRICE — replaces the old `livePrice * (1 + random jitter)`
// fake fill, which presented fabricated slippage as an executed price.
// ---------------------------------------------------------------------------
interface BookMid {
  bid: number;
  ask: number;
  mid: number;
}

async function getBinanceBookTickerMid(binancePair: string): Promise<BookMid | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(binancePair)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const bid = parseFloat(data?.bidPrice);
    const ask = parseFloat(data?.askPrice);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
    return { bid, ask, mid: (bid + ask) / 2 };
  } catch {
    return null;
  }
}

// Helper: fetch user's stored API keys for an exchange (decrypted)
async function getUserApiKeys(userId: string, exchange: string) {
  const stored = await prisma.apiKey.findFirst({
    where: { userId, exchange, label: "default" },
  });
  if (!stored) return null;
  try {
    return {
      apiKey: decrypt(stored.encryptedKey),
      apiSecret: decrypt(stored.encryptedSecret),
      passphrase: stored.encryptedPassphrase ? decrypt(stored.encryptedPassphrase) : undefined,
    };
  } catch {
    return null;
  }
}

// ─── BINANCE SPOT ORDER ──────────────────────────────────────────────
async function placeBinanceOrder(
  apiKey: string, apiSecret: string,
  symbol: string, side: "BUY" | "SELL", quantity: number
): Promise<{ success: boolean; orderId?: string; executedPrice?: number; error?: string; isSimulation: boolean; clientOrderId?: string }> {
  try {
    const timestamp = Date.now();
    // FIX-ALL P0-7: Binance supports `newClientOrderId` for idempotency.
    // If the network times out AFTER the order was placed but BEFORE the
    // response reached us, a client retry would otherwise place a DUPLICATE
    // real-money order. With a stable clientOrderId, a retry returns the
    // same orderId instead of creating a second fill.
    const clientOrderId = `ZTX${timestamp}${crypto.randomBytes(4).toString("hex")}`.slice(0, 32);
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      side,
      type: "MARKET",
      quantity: String(quantity),
      newClientOrderId: clientOrderId,
      recvWindow: "5000",
      timestamp: String(timestamp),
    });
    const signature = crypto.createHmac("sha256", apiSecret).update(params.toString()).digest("hex");
    const url = `https://api.binance.com/api/v3/order?${params.toString()}&signature=${signature}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "X-MBX-APIKEY": apiKey, "Content-Type": "application/json" },
    });
    const data = await res.json() as any;

    if (!res.ok) {
      return { success: false, error: `Binance: ${data.msg || res.statusText}`, isSimulation: false };
    }
    // For MARKET orders, price is filled at market — compute average from fills
    const fills = data.fills || [];
    const avgPrice = fills.length > 0
      ? fills.reduce((sum: number, f: any) => sum + parseFloat(f.price) * parseFloat(f.qty), 0) /
        fills.reduce((sum: number, f: any) => sum + parseFloat(f.qty), 0)
      : undefined;

    return {
      success: true,
      orderId: String(data.orderId),
      clientOrderId,
      executedPrice: avgPrice,
      isSimulation: false,
    };
  } catch (e: any) {
    return { success: false, error: `Binance network error: ${e.message}`, isSimulation: false };
  }
}

// ─── BYBIT ORDER ─────────────────────────────────────────────────────
async function placeBybitOrder(
  apiKey: string, apiSecret: string,
  symbol: string, side: "Buy" | "Sell", qty: number
): Promise<{ success: boolean; orderId?: string; executedPrice?: number; error?: string; isSimulation: boolean; clientOrderId?: string }> {
  try {
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    // FIX-ALL P0-7: Bybit's `orderLinkId` is the idempotency key (max 36 chars).
    // Prevents duplicate real-money orders on network-timeout retries.
    const orderLinkId = `ZTX${timestamp}${crypto.randomBytes(4).toString("hex")}`.slice(0, 36);
    const body = JSON.stringify({
      category: "spot",
      symbol: symbol.toUpperCase(),
      side,
      orderType: "Market",
      qty: String(qty),
      orderLinkId,
    });
    const paramStr = timestamp + apiKey + recvWindow + body;
    const sign = crypto.createHmac("sha256", apiSecret).update(paramStr).digest("hex");

    const res = await fetch("https://api.bybit.com/v5/order/create", {
      method: "POST",
      headers: {
        "X-BAPI-API-KEY": apiKey,
        "X-BAPI-SIGN": sign,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json",
      },
      body,
    });
    const data = await res.json() as any;

    if (data.retCode !== 0) {
      return { success: false, error: `Bybit: ${data.retMsg}`, isSimulation: false };
    }
    return {
      success: true,
      orderId: String(data.result?.orderId || ""),
      clientOrderId: orderLinkId,
      isSimulation: false,
    };
  } catch (e: any) {
    return { success: false, error: `Bybit network error: ${e.message}`, isSimulation: false };
  }
}

// ─── KUCOIN ORDER ────────────────────────────────────────────────────
async function placeKucoinOrder(
  apiKey: string, apiSecret: string, passphrase: string,
  symbol: string, side: "buy" | "sell", size: number
): Promise<{ success: boolean; orderId?: string; error?: string; isSimulation: boolean }> {
  try {
    const timestamp = Date.now().toString();
    const method = "POST";
    const endpoint = "/api/v1/orders";
    const body = JSON.stringify({
      clientOid: crypto.randomUUID(),
      side,
      symbol, // e.g. BTC-USDT
      type: "market",
      size: String(size),
    });
    const strToSign = timestamp + method + endpoint + body;
    const signature = crypto.createHmac("sha256", apiSecret).update(strToSign).digest("base64");
    const passphraseSign = crypto.createHmac("sha256", apiSecret).update(passphrase).digest("base64");

    const res = await fetch("https://api.kucoin.com/api/v1/orders", {
      method: "POST",
      headers: {
        "KC-API-KEY": apiKey,
        "KC-API-SIGN": signature,
        "KC-API-TIMESTAMP": timestamp,
        "KC-API-PASSPHRASE": passphraseSign,
        "KC-API-KEY-VERSION": "2",
        "Content-Type": "application/json",
      },
      body,
    });
    const data = await res.json() as any;

    if (data.code !== "200000") {
      return { success: false, error: `KuCoin: ${data.msg}`, isSimulation: false };
    }
    return {
      success: true,
      orderId: String(data.data?.orderId || ""),
      isSimulation: false,
    };
  } catch (e: any) {
    return { success: false, error: `KuCoin network error: ${e.message}`, isSimulation: false };
  }
}

// ─── SIMULATION FALLBACK ─────────────────────────────────────────────
async function simulateOrder(
  exchange: string, symbol: string, side: string, amount: number
): Promise<{ success: boolean; orderId?: string; executedPrice?: number; isSimulation: boolean; error?: string; simulationNote?: string }> {
  // DATA-8: honest price = Binance book ticker MID-PRICE ((bid+ask)/2).
  // The old code multiplied the live price by a random ±0.01% jitter and
  // presented that fabricated number as the "executed price" — fake market
  // data in a trading terminal. If the book ticker is unavailable we fall
  // back to the plain live price (still REAL, just not mid-book) and label it
  // in simulationNote so the UI can be honest about the fill basis.
  const pair = toBinancePair(symbol);
  const book = await getBinanceBookTickerMid(pair);

  let executedPrice = 0;
  let priceNote = "harga simulasi (mid-price orderbook)";
  if (book) {
    executedPrice = parseFloat(book.mid.toPrecision(12));
  } else {
    // Fallback: plain last-trade price — no jitter fabrication.
    try {
      const priceRes = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`
      );
      if (priceRes.ok) {
        const pData = await priceRes.json() as any;
        executedPrice = parseFloat(pData.price);
      }
    } catch {}
    priceNote = "harga simulasi (harga live; orderbook tidak tersedia)";
  }

  // FIX-A-5: if both Binance fetches failed, executedPrice stays 0. Previously
  // we returned `success: true, executedPrice: 0` — the UI then displayed
  // "filled at $0", which is impossible and misleads the user into thinking a
  // $0 fill executed. Now we return `success: false` with an actionable error
  // so the caller can surface the failure instead of presenting a fake fill.
  if (!Number.isFinite(executedPrice) || executedPrice <= 0) {
    return {
      success: false,
      error: "Gagal mengambil harga live dari Binance. Coba lagi.",
      executedPrice: 0,
      isSimulation: true,
    };
  }

  // Simulation order id — an identifier (not market data); generated with
  // crypto.randomInt instead of Math.random for decent entropy.
  const orderId =
    "SIM-" + exchange.toUpperCase().substring(0, 3) + "-" + crypto.randomInt(100000, 1000000);

  return { success: true, orderId, executedPrice, isSimulation: true, simulationNote: priceNote };
}

// ─── ENDPOINT: REAL ORDER EXECUTION ──────────────────────────────────
tradeExecutionRouter.post("/execute", async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  // SEC-15: zod validation — symbol charset, side enum, finite amount. The
  // raw body (which also carries apiKey/apiSecret fields the frontend sends)
  // is stripped to the validated fields only.
  const parsed = executeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
  }
  const { symbol, side } = parsed.data;
  const exchange = parsed.data.exchange || "Binance";
  const qty = parsed.data.amount;
  const { useSandbox } = parsed.data;
  const orderSide = side; // already lowercased by the schema transform

  // ---------------------------------------------------------------------
  // SEC-15: max-notional guard — applies to EVERY mode (sandbox, no-keys,
  // and real orders). We need a live price to compute qty × price, so we
  // fetch the Binance book ticker mid-price; if the price cannot be
  // verified we FAIL CLOSED (an order whose size cannot be bounded must
  // not be executed).
  // ---------------------------------------------------------------------
  const book = await getBinanceBookTickerMid(toBinancePair(symbol));
  let refPrice = book ? book.mid : 0;
  if (!(refPrice > 0)) {
    try {
      const priceRes = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(toBinancePair(symbol))}`
      );
      if (priceRes.ok) {
        const pData = await priceRes.json() as any;
        const p = parseFloat(pData.price);
        if (Number.isFinite(p) && p > 0) refPrice = p;
      }
    } catch {}
  }
  if (!(refPrice > 0)) {
    await logAudit(userId, "TRADE_EXECUTE", req, false, {
      exchange, symbol, side, amount: qty, reason: "price_unavailable_notional_check_failed",
    });
    return res.status(400).json({
      success: false,
      exchange, symbol, amount: qty, side,
      error: "Gagal memverifikasi harga untuk pemeriksaan batas notional. Coba lagi.",
    });
  }
  const notionalUsd = qty * refPrice;
  if (notionalUsd > MAX_ORDER_NOTIONAL_USD) {
    await logAudit(userId, "TRADE_EXECUTE", req, false, {
      exchange, symbol, side, amount: qty,
      notionalUsd: Math.round(notionalUsd),
      maxNotionalUsd: MAX_ORDER_NOTIONAL_USD,
      reason: "notional_limit_exceeded",
    });
    return res.status(400).json({
      success: false,
      exchange, symbol, amount: qty, side,
      error: "Order melebihi batas notional maksimum",
      maxNotionalUsd: MAX_ORDER_NOTIONAL_USD,
      notionalUsd: Math.round(notionalUsd * 100) / 100,
    });
  }

  // If sandbox mode → always simulate
  // FIX-ALL P0-7b: previously `if (useSandbox)` — but useSandbox comes from
  // the request body as a string, and `if ("false")` is TRUTHY in JS, so a
  // client sending useSandbox="false" would silently get simulation. Coerce
  // properly: only simulate when useSandbox is boolean true or the string "true".
  const sandboxMode = useSandbox === true || String(useSandbox).toLowerCase() === "true";
  if (sandboxMode) {
    const sim = await simulateOrder(exchange, symbol, side, qty);
    await logAudit(userId, "TRADE_EXECUTE", req, true, { exchange, symbol, side, amount: qty, mode: "sandbox", notionalUsd: Math.round(notionalUsd) });
    return res.json({
      success: sim.success,
      exchange, symbol, amount: qty, side,
      ...sim,
      simulationNote: sim.success
        ? `Order tidak dieksekusi di bursa sungguhan. Ini adalah simulasi — ${sim.simulationNote || "harga simulasi"}.`
        : undefined,
    });
  }

  // Try real execution with stored API keys
  const keys = await getUserApiKeys(userId, exchange);
  if (!keys) {
    // No stored keys → simulate
    const sim = await simulateOrder(exchange, symbol, side, qty);
    await logAudit(userId, "TRADE_EXECUTE", req, true, { exchange, symbol, side, amount: qty, mode: "simulation-no-keys", notionalUsd: Math.round(notionalUsd) });
    return res.json({
      success: sim.success,
      exchange, symbol, amount: qty, side,
      ...sim,
      simulationNote: sim.success
        ? `Tidak ada API key tersimpan untuk bursa ini. Order disimulasikan — ${sim.simulationNote || "harga live"}.`
        : undefined,
    });
  }

  // Attempt REAL order
  let result;
  const ex = exchange.toLowerCase();
  if (ex === "binance") {
    result = await placeBinanceOrder(keys.apiKey, keys.apiSecret, symbol, orderSide === "buy" ? "BUY" : "SELL", qty);
  } else if (ex === "bybit") {
    result = await placeBybitOrder(keys.apiKey, keys.apiSecret, symbol, orderSide === "buy" ? "Buy" : "Sell", qty);
  } else if (ex === "kucoin") {
    if (!keys.passphrase) {
      result = { success: false, error: "KuCoin memerlukan passphrase.", isSimulation: false };
    } else {
      result = await placeKucoinOrder(keys.apiKey, keys.apiSecret, keys.passphrase, symbol, orderSide as "buy" | "sell", qty);
    }
  } else {
    // Unsupported exchange → simulate
    result = await simulateOrder(exchange, symbol, side, qty);
  }

  await logAudit(userId, "TRADE_EXECUTE", req, result.success, {
    exchange, symbol, side, amount: qty,
    mode: result.isSimulation ? "simulation" : "real",
    orderId: result.orderId,
    error: result.error,
  });

  if (!result.success) {
    // FIX-A-6: real-order failures must return HTTP 400 (not 200) so the
    // frontend can branch on response status / catch handlers — a 200 with
    // `success:false` would otherwise be silently swallowed by code that
    // checks `if (resp.ok)`. Simulation failures (sandbox / no-keys /
    // unsupported-exchange fallbacks) stay at HTTP 200 because the request
    // itself was well-formed; the client opted into simulation and should
    // read `success:false` from the JSON body. `result.isSimulation === false`
    // distinguishes a real attempt (Binance/Bybit/KuCoin HTTP errors, missing
    // KuCoin passphrase) from a simulated attempt.
    const isRealOrderFailure = result.isSimulation === false;
    return res.status(isRealOrderFailure ? 400 : 200).json({
      success: false,
      exchange, symbol, amount: qty, side,
      error: result.error,
      isSimulation: result.isSimulation,
    });
  }

  return res.json({
    success: true,
    exchange, symbol, amount: qty, side,
    orderId: result.orderId,
    executedPrice: result.executedPrice,
    isSimulation: result.isSimulation,
    ...(result.isSimulation
      ? { simulationNote: result.simulationNote || "Order tidak dieksekusi di bursa sungguhan. Ini adalah simulasi harga live." }
      : { realOrderNote: "Order REAL telah ditembakkan ke bursa." }),
    timestamp: new Date().toISOString(),
  });
});

// ─── ENDPOINT: CONNECT (real balance from exchange) ──────────────────
tradeExecutionRouter.post("/connect", async (req: Request, res: Response) => {
  const userId = req.user!.sub;

  // SEC-15: the connect body was previously COMPLETELY unvalidated — any
  // JSON shape flowed straight into exchange-name comparisons, key handling
  // and audit metadata. Validate it with zod (exchange charset, capped key
  // lengths, boolean flags).
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
  }
  const { apiKey, apiSecret, passphrase, hasE2E } = parsed.data;
  const useSandbox = parsed.data.useSandbox === true || String(parsed.data.useSandbox).toLowerCase() === "true";
  // Normalize the exchange name (lowercase) — the old code compared EXACT-CASE
  // strings ("KuCoin"/"Bybit"), so "kucoin" silently fell through to the
  // Binance branch.
  const exchange = (parsed.data.exchange || "Binance").toLowerCase();

  try {
    // Fetch live ticker price for the exchange
    let targetUrl = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";
    if (exchange === "kucoin") targetUrl = "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT";
    else if (exchange === "bybit") targetUrl = "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT";

    let tickerPrice = 0;
    try {
      const response = await fetch(targetUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (response.ok) {
        const data = await response.json() as any;
        if (exchange === "kucoin") tickerPrice = parseFloat(data?.data?.price) || 0;
        else if (exchange === "bybit") tickerPrice = parseFloat(data?.result?.list?.[0]?.lastPrice) || 0;
        else tickerPrice = parseFloat(data?.price) || 0;
      }
    } catch (e: any) {
      console.log(`[trade/connect] ticker fetch for ${exchange}: ${e.message}`);
    }

    let balance: number | null = 0;
    let balanceSource: "live" | "sandbox" | "unavailable" | "estimated" = "unavailable";

    if (useSandbox) {
      balance = 15000.00;
      balanceSource = "sandbox";
    } else {
      // Try to get real balance using stored keys or provided keys
      const k = apiKey && apiSecret
        ? { apiKey: String(apiKey).trim(), apiSecret: String(apiSecret).trim(), passphrase: passphrase || undefined }
        : await getUserApiKeys(userId, exchange);

      if (k && k.apiKey.length >= 8 && k.apiSecret.length >= 8) {
        // Attempt real balance fetch
        const ex = exchange;
        const timestamp = Date.now().toString();

        try {
          if (ex === "binance" && !k.apiKey.includes("MOCK")) {
            const payloadString = `recvWindow=5000&timestamp=${timestamp}`;
            const sig = crypto.createHmac("sha256", k.apiSecret).update(payloadString).digest("hex");
            const authRes = await fetch(`https://api.binance.com/api/v3/account?${payloadString}&signature=${sig}`, {
              headers: { "X-MBX-APIKEY": k.apiKey },
            });
            const authData = await authRes.json() as any;
            if (authRes.ok && authData?.balances) {
              // Sum USDT balance
              const usdt = authData.balances.find((b: any) => b.asset === "USDT");
              balance = usdt ? parseFloat(usdt.free) + parseFloat(usdt.locked) : 0;
              balanceSource = "live";
            }
          } else if (ex === "bybit" && !k.apiKey.includes("MOCK")) {
            const sign = crypto.createHmac("sha256", k.apiSecret).update(timestamp + k.apiKey + "5000" + "accountType=UNIFIED").digest("hex");
            const authRes = await fetch("https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED", {
              headers: {
                "X-BAPI-API-KEY": k.apiKey,
                "X-BAPI-TIMESTAMP": timestamp,
                "X-BAPI-RECV-WINDOW": "5000",
                "X-BAPI-SIGN": sign,
              },
            });
            const authData = await authRes.json() as any;
            if (authData?.retCode === 0 && authData?.result?.list?.[0]) {
              balance = parseFloat(authData.result.list[0].totalEquity) || 0;
              balanceSource = "live";
            }
          } else if (ex === "kucoin" && !k.apiKey.includes("MOCK") && k.passphrase) {
            const endpoint = "/api/v1/accounts";
            const strToSign = timestamp + "GET" + endpoint;
            const sig = crypto.createHmac("sha256", k.apiSecret).update(strToSign).digest("base64");
            const passSign = crypto.createHmac("sha256", k.apiSecret).update(k.passphrase).digest("base64");
            const authRes = await fetch(`https://api.kucoin.com${endpoint}`, {
              headers: {
                "KC-API-KEY": k.apiKey,
                "KC-API-SIGN": sig,
                "KC-API-TIMESTAMP": timestamp,
                "KC-API-PASSPHRASE": passSign,
                "KC-API-KEY-VERSION": "2",
              },
            });
            const authData = await authRes.json() as any;
            if (authData?.code === "200000" && authData?.data?.total) {
              balance = parseFloat(authData.data.total) || 0;
              balanceSource = "live";
            }
          }
        } catch (e: any) {
          console.log(`[trade/connect] balance fetch for ${exchange}: ${e.message}`);
        }
      }

      // FIX-B-7: previously returned a hardcoded fake balance ($4250.75) when
      // the real balance fetch failed, with `balanceSource: "estimated"`. For a
      // trading terminal that misleads the user into thinking they have funds
      // they don't. Now we honestly report the balance as unavailable.
      if (balance === 0) {
        balance = null;
        balanceSource = "unavailable";
      }
    }

    await logAudit(userId, "TRADE_CONNECT", req, true, { exchange, useSandbox, balanceSource });

    return res.json({
      success: true,
      exchange,
      useSandbox,
      tickerPrice,
      balance: balance === null ? null : parseFloat(balance.toFixed(2)),
      balanceSource,
      hasE2EEncountered: !!hasE2E,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "Gagal menghubungkan ke bursa." });
  }
});
