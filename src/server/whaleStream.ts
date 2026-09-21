// =============================================================================
// whaleStream.ts — QA5-F1 (round 5) + QA8-A-1 (round 8): REAL-time whale trade
// aggregator — Binance SPOT + FUTURES
// =============================================================================
// Purpose: feed the Whale Radar (On-Chain Data tab) with REAL large trades
// from Binance's public trade streams — no API key, no polling.
//
// HOW IT WORKS
//   1. On module load we open TWO persistent combined Binance WebSocket
//      subscriptions to `<sym>@aggTrade` for the same symbol whitelist:
//        - SPOT:     wss://stream.binance.com:9443/stream?streams=...
//        - FUTURES:  wss://fstream.binance.com/stream?streams=...
//      Every aggregated fill is pushed to us in real time; we keep those
//      ≥ MIN_CAPTURE_USD in ONE shared rolling in-memory buffer (capped:
//      900 rows / 30 minutes — the old 600 spot rows plus futures margin).
//      NOTE on the futures URL: Binance serves USDT-M futures market streams
//      on port 443 only — `wss://fstream.binance.com:9443` (the SPOT port)
//      does NOT complete a WebSocket upgrade (verified empirically before
//      this was written; the handshake fails with 1006/timeout).
//   2. At boot we additionally pull the most recent 1000 aggTrades per symbol
//      via the public SPOT REST API ONCE (a "backfill") so a freshly-booted
//      server still has immediate content — the WS then keeps the buffer
//      live. FUTURES deliberately has NO REST backfill (QA8-A-1: optional):
//      futures rows honestly start accumulating only once the futures WS
//      delivers its first real trades. Nothing is synthesized to hide that.
//   3. liveDataRoutes.ts exposes the buffer read-only via
//      GET /api/live/whale-trades (filtering + stats + honest states).
//
// HONESTY CONTRACT (campaign invariant)
//   - Every row in the buffer is a REAL Binance fill — spot or futures market
//     is tagged per row — nothing is estimated, extrapolated or fabricated.
//   - `getWhaleStreamStatus()` reports per-market `connected` flags: when a
//     market's WS drops we keep serving its last REAL rows and the API/UI
//     labels that market as disconnected/stale. The legacy top-level
//     `connected` (true when ANY market is live) is kept for older consumers.
//   - Whales are comparatively rare: an empty-but-connected buffer is a
//     legitimate live state ("menunggu whale berikutnya"), never an error.
//
// Failure modes handled: per-market WS error/close (independent 5s reconnect
// timer per market), JSON decode errors (skipped), buffer pruning (age +
// size), cold boot (spot backfill), and Binance REST being unreachable (the
// buffer just starts from the WS streams alone).
// =============================================================================

import WebSocket from "ws";
import { createLogger } from "./logger";
import { fetchWithTimeout } from "./httpUtils";

const log = createLogger("whaleStream");

export type WhaleMarket = "spot" | "futures";

export interface WhaleTradeRow {
  symbol: string;
  tradeId: number;
  price: number;
  qty: number;
  notionalUsd: number;
  side: "BUY" | "SELL";
  time: string; // ISO
  exchange: string;
  market: WhaleMarket; // QA8-A-1: which Binance venue produced this fill
}

// Trades below this are never captured — keeps the buffer small and the
// endpoint's minimum filter (UI floor) meaningful.
const MIN_CAPTURE_USD = 50_000;
// QA8-A-1: 600 (spot) + futures margin, one shared buffer.
const MAX_ROWS = 900;
const MAX_AGE_MS = 30 * 60 * 1000;

// The same whitelist the API endpoint validates against (single source of
// truth lives in liveDataRoutes.ts — kept identical here).
const WHALE_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA"];

const MARKET_ENDPOINTS: Record<WhaleMarket, { buildUrl: (streams: string) => string; exchange: string }> = {
  spot: {
    buildUrl: (streams) => `wss://stream.binance.com:9443/stream?streams=${streams}`,
    exchange: "Binance Spot",
  },
  futures: {
    // Futures market streams are only served on the default port (443).
    buildUrl: (streams) => `wss://fstream.binance.com/stream?streams=${streams}`,
    exchange: "Binance Futures",
  },
};

const buffer: WhaleTradeRow[] = [];
const seenKeys = new Set<string>();

interface MarketState {
  connected: boolean;
  startedAt: string;
  lastMessageAt: null | string;
  receivedCount: number; // all messages (any size) on this market
  capturedCount: number; // messages >= MIN_CAPTURE_USD on this market
}

const markets: Record<WhaleMarket, MarketState> = {
  spot: {
    connected: false,
    startedAt: new Date().toISOString(),
    lastMessageAt: null,
    receivedCount: 0,
    capturedCount: 0,
  },
  futures: {
    connected: false,
    startedAt: new Date().toISOString(),
    lastMessageAt: null,
    receivedCount: 0,
    capturedCount: 0,
  },
};

function pushTrade(row: WhaleTradeRow) {
  // QA8-A-1: dedup key now includes the market — the same aggTrade id can
  // legitimately exist on BOTH venues (independent id sequences).
  const key = `${row.market}:${row.symbol}:${row.tradeId}`;
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  buffer.push(row);
  markets[row.market].capturedCount++;
  prune();
}

function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  // Age prune (buffer is roughly time-ordered; WS+backfill can interleave,
  // so filter by timestamp rather than assuming order).
  let rows = buffer.filter((r) => new Date(r.time).getTime() >= cutoff);
  // Size prune — keep the LARGEST when over capacity (a whale radar's most
  // useful rows), newest first as tiebreak.
  if (rows.length > MAX_ROWS) {
    rows = [...rows].sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, MAX_ROWS)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }
  if (rows.length !== buffer.length) {
    buffer.length = 0;
    buffer.push(...rows);
    // Re-sync the dedup set to surviving rows.
    seenKeys.clear();
    for (const r of rows) seenKeys.add(`${r.market}:${r.symbol}:${r.tradeId}`);
  }
}

function mapAggTrade(
  market: WhaleMarket,
  symbol: string,
  t: { a: number; p: string; q: string; m: boolean; T: number }
): WhaleTradeRow | null {
  const price = Number(t.p);
  const qty = Number(t.q);
  if (!isFinite(price) || !isFinite(qty) || price <= 0 || qty <= 0) return null;
  const notionalUsd = price * qty;
  if (notionalUsd < MIN_CAPTURE_USD) return null;
  return {
    symbol,
    tradeId: Number(t.a),
    price,
    qty,
    notionalUsd,
    // m=true → buyer was the maker → the aggressive taker SOLD into the book.
    side: t.m ? "SELL" : "BUY",
    time: new Date(t.T).toISOString(),
    exchange: MARKET_ENDPOINTS[market].exchange,
    market,
  };
}

// --- One-shot SPOT REST backfill (latest 1000 aggTrades per symbol) --------
// QA8-A-1 honesty note: futures has NO backfill by design (optional per
// spec) — the futures side of the buffer only fills from its live WS.
async function backfillFromRest() {
  const results = await Promise.allSettled(
    WHALE_SYMBOLS.map(async (sym) => {
      const url = `https://api.binance.com/api/v3/aggTrades?symbol=${sym}USDT&limit=1000`;
      try {
        const r = await fetchWithTimeout(url, {}, 10_000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const trades = (await r.json()) as any[];
        if (!Array.isArray(trades)) throw new Error("no array");
        let added = 0;
        for (const t of trades) {
          const row = mapAggTrade("spot", sym, t);
          if (row) {
            const before = seenKeys.size;
            pushTrade(row);
            if (seenKeys.size > before) added++;
          }
        }
        return added;
      } finally {
        /* timer cleanup moved into fetchWithTimeout */
      }
    })
  );
  const added = results.reduce((s, r) => (r.status === "fulfilled" ? s + r.value : s), 0);
  const failed = results.filter((r) => r.status === "rejected").length;
  log.info(
    `[WhaleStream] REST backfill spot selesai: +${added} transaksi ≥$50K` +
      (failed ? ` (${failed} simbol gagal — buffer akan terisi dari stream WS)` : "")
  );
}

// --- Persistent combined aggTrade stream per market ------------------------
// Each market gets its OWN socket, open handler and 5s reconnect timer, so
// one venue being unreachable never blocks the other.
function startMarketStream(market: WhaleMarket) {
  const endpoint = MARKET_ENDPOINTS[market];
  const streams = WHALE_SYMBOLS.map((s) => `${s.toLowerCase()}usdt@aggTrade`).join("/");
  const wsUrl = endpoint.buildUrl(streams);
  log.info(`[WhaleStream:${market}] Menghubungkan ke Binance ${market} aggTrade stream…`);

  try {
    const ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      markets[market].connected = true;
      log.info(
        `[WhaleStream:${market}] Terhubung — transaksi besar ${market} akan terkumpul secara real-time.`
      );
      // Never keep the Node event loop alive just for this stream: in tests
      // (vitest self-booting server) an open WS previously prevented the
      // Vite pool from exiting cleanly ("close timed out after 10000ms").
      // unref() keeps the socket fully functional while the process lives.
      const sock = (ws as any)._socket;
      if (sock && typeof sock.unref === "function") sock.unref();
    });

    ws.on("message", (data) => {
      try {
        const mstate = markets[market];
        mstate.lastMessageAt = new Date().toISOString();
        mstate.receivedCount++;
        const msg = JSON.parse(data.toString());
        // Combined-stream envelope: {stream: "btcusdt@aggTrade", data: {...}}
        const payload = msg?.data ?? msg;
        if (!payload || payload.e !== "aggTrade") return;
        const sym = String(payload.s || "").replace(/USDT$/i, "").toUpperCase();
        if (!WHALE_SYMBOLS.includes(sym)) return;
        const row = mapAggTrade(market, sym, payload);
        if (row) pushTrade(row);
      } catch {
        /* skip malformed frame — never crash the stream */
      }
    });

    ws.on("error", (err: Error) => {
      log.error(`[WhaleStream:${market}] Connection error:`, err.message);
    });

    ws.on("close", () => {
      if (markets[market].connected) {
        log.warn(`[WhaleStream:${market}] Koneksi terputus — mencoba ulang dalam 5 detik…`);
      }
      markets[market].connected = false;
      const t = setTimeout(() => startMarketStream(market), 5000);
      // Reconnect timers must not keep the event loop alive either.
      if (typeof (t as any).unref === "function") (t as any).unref();
    });
  } catch (err: any) {
    markets[market].connected = false;
    log.error(`[WhaleStream:${market}] Gagal memulai WS:`, err?.message || String(err));
    const t = setTimeout(() => startMarketStream(market), 15_000);
    if (typeof (t as any).unref === "function") (t as any).unref();
  }
}

startMarketStream("spot");
startMarketStream("futures");
// Give the WS a moment to connect, then backfill (SPOT only — see honesty
// note above). Even if the backfill loses the race with early stream
// messages, de-dup by (market, symbol, trade id) keeps it correct.
const backfillTimer = setTimeout(() => {
  backfillFromRest().catch((e) =>
    log.warn("[WhaleStream] Backfill gagal:", e?.message || String(e))
  );
}, 2_000);
if (typeof (backfillTimer as any).unref === "function") (backfillTimer as any).unref();

// --- Read-only accessors used by liveDataRoutes.ts ---------------------------
export function getWhaleSnapshot(filterSymbols: string[], minUsd: number, limit: number) {
  const symbolSet = new Set(filterSymbols.map((s) => s.toUpperCase()));
  return buffer
    .filter((r) => symbolSet.has(r.symbol) && r.notionalUsd >= minUsd)
    .sort((a, b) => b.notionalUsd - a.notionalUsd)
    .slice(0, limit);
}

export function getWhaleStreamStatus() {
  const spot = markets.spot;
  const futures = markets.futures;
  const lastMessageAt = [spot.lastMessageAt, futures.lastMessageAt]
    .filter((x): x is string => typeof x === "string")
    .sort()
    .pop() ?? null;
  return {
    // Legacy aggregate: the feed is "live" when ANY market is connected.
    // Older consumers (endpoint "stream.connected" + UI LIVE chip) keep
    // working; per-market truth is in `markets`.
    connected: spot.connected || futures.connected,
    lastMessageAt,
    startedAt: spot.startedAt,
    receivedCount: spot.receivedCount + futures.receivedCount,
    capturedCount: spot.capturedCount + futures.capturedCount,
    markets: {
      spot: { ...spot },
      futures: { ...futures },
    },
    bufferedCount: buffer.length,
    bufferedByMarket: {
      spot: buffer.filter((r) => r.market === "spot").length,
      futures: buffer.filter((r) => r.market === "futures").length,
    },
    minCaptureUsd: MIN_CAPTURE_USD,
    maxRows: MAX_ROWS,
    symbols: WHALE_SYMBOLS,
  };
}
