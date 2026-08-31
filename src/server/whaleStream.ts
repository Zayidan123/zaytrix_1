// =============================================================================
// whaleStream.ts — QA5-F1 (round 5): REAL-time whale trade aggregator
// =============================================================================
// Purpose: feed the Whale Radar (On-Chain Data tab) with REAL large spot
// trades from Binance's public trade streams — no API key, no polling.
//
// HOW IT WORKS
//   1. On module load we open ONE combined Binance WebSocket subscription to
//      `<sym>@aggTrade` for the symbol whitelist. Every aggregated fill is
//      pushed to us in real time; we keep those ≥ MIN_CAPTURE_USD in a
//      rolling in-memory buffer (capped: 600 rows / 30 minutes).
//   2. At boot we additionally pull the most recent 1000 aggTrades per symbol
//      via the public REST API ONCE (a "backfill") so a freshly-booted server
//      still has immediate content — the WS then keeps the buffer live.
//      The two sources are de-duplicated by (symbol, aggTrade id).
//   3. liveDataRoutes.ts exposes the buffer read-only via
//      GET /api/live/whale-trades (filtering + stats + honest states).
//
// HONESTY CONTRACT (campaign invariant)
//   - Every row in the buffer is a REAL Binance fill — nothing is estimated,
//     extrapolated or fabricated.
//   - `status()` reports `connected` — when the WS drops we keep serving the
//     last REAL snapshot and the API/UI labels it as disconnected/stale.
//   - Whales are comparatively rare: an empty-but-connected buffer is a
//     legitimate live state ("menunggu whale berikutnya"), never an error.
//
// Failure modes handled: WS error/close (5s reconnect, exponential-ish cap),
// JSON decode errors (skipped), buffer pruning (age + size), cold boot
// (backfill), and Binance REST being unreachable (buffer just starts from
// the WS stream alone).
// =============================================================================

import WebSocket from "ws";
import { createLogger } from "./logger";

const log = createLogger("whaleStream");

export interface WhaleTradeRow {
  symbol: string;
  tradeId: number;
  price: number;
  qty: number;
  notionalUsd: number;
  side: "BUY" | "SELL";
  time: string; // ISO
  exchange: string;
}

// Trades below this are never captured — keeps the buffer small and the
// endpoint's minimum filter (UI floor) meaningful.
const MIN_CAPTURE_USD = 50_000;
const MAX_ROWS = 600;
const MAX_AGE_MS = 30 * 60 * 1000;

// The same whitelist the API endpoint validates against (single source of
// truth lives in liveDataRoutes.ts — kept identical here).
const WHALE_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA"];

const buffer: WhaleTradeRow[] = [];
const seenKeys = new Set<string>();

const state = {
  connected: false,
  startedAt: new Date().toISOString(),
  lastMessageAt: null as string | null,
  receivedCount: 0, // all messages (any size)
  capturedCount: 0, // messages ≥ MIN_CAPTURE_USD
};

function pushTrade(row: WhaleTradeRow) {
  const key = `${row.symbol}:${row.tradeId}`;
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  buffer.push(row);
  state.capturedCount++;
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
    for (const r of rows) seenKeys.add(`${r.symbol}:${r.tradeId}`);
  }
}

function mapAggTrade(symbol: string, t: { a: number; p: string; q: string; m: boolean; T: number }): WhaleTradeRow | null {
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
    exchange: "Binance Spot",
  };
}

// --- One-shot REST backfill (latest 1000 aggTrades per symbol) --------------
async function backfillFromRest() {
  const results = await Promise.allSettled(
    WHALE_SYMBOLS.map(async (sym) => {
      const url = `https://api.binance.com/api/v3/aggTrades?symbol=${sym}USDT&limit=1000`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const trades = (await r.json()) as any[];
        if (!Array.isArray(trades)) throw new Error("no array");
        let added = 0;
        for (const t of trades) {
          const row = mapAggTrade(sym, t);
          if (row) {
            const before = seenKeys.size;
            pushTrade(row);
            if (seenKeys.size > before) added++;
          }
        }
        return added;
      } finally {
        clearTimeout(timer);
      }
    })
  );
  const added = results.reduce((s, r) => (r.status === "fulfilled" ? s + r.value : s), 0);
  const failed = results.filter((r) => r.status === "rejected").length;
  log.info(
    `[WhaleStream] REST backfill selesai: +${added} transaksi ≥$50K` +
      (failed ? ` (${failed} simbol gagal — buffer akan terisi dari stream WS)` : "")
  );
}

// --- Combined spot trade stream ----------------------------------------------
function startWhaleStream() {
  const streams = WHALE_SYMBOLS.map((s) => `${s.toLowerCase()}usdt@aggTrade`).join("/");
  const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  log.info("[WhaleStream] Menghubungkan ke Binance spot aggTrade stream…");

  try {
    const ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      state.connected = true;
      log.info("[WhaleStream] Terhubung — transaksi besar akan terkumpul secara real-time.");
      // Never keep the Node event loop alive just for this stream: in tests
      // (vitest self-booting server) an open WS previously prevented the
      // Vite pool from exiting cleanly ("close timed out after 10000ms").
      // unref() keeps the socket fully functional while the process lives.
      const sock = (ws as any)._socket;
      if (sock && typeof sock.unref === "function") sock.unref();
    });

    ws.on("message", (data) => {
      try {
        state.lastMessageAt = new Date().toISOString();
        state.receivedCount++;
        const msg = JSON.parse(data.toString());
        // Combined-stream envelope: {stream: "btcusdt@aggTrade", data: {...}}
        const payload = msg?.data ?? msg;
        if (!payload || payload.e !== "aggTrade") return;
        const sym = String(payload.s || "").replace(/USDT$/i, "").toUpperCase();
        if (!WHALE_SYMBOLS.includes(sym)) return;
        const row = mapAggTrade(sym, payload);
        if (row) pushTrade(row);
      } catch {
        /* skip malformed frame — never crash the stream */
      }
    });

    ws.on("error", (err: Error) => {
      log.error("[WhaleStream] Connection error:", err.message);
    });

    ws.on("close", () => {
      if (state.connected) log.warn("[WhaleStream] Koneksi terputus — mencoba ulang dalam 5 detik…");
      state.connected = false;
      setTimeout(() => startWhaleStream(), 5000);
    });
  } catch (err: any) {
    state.connected = false;
    log.error("[WhaleStream] Gagal memulai WS:", err?.message || String(err));
    setTimeout(() => startWhaleStream(), 15_000);
  }
}

startWhaleStream();
// Give the WS a moment to connect, then backfill. Even if the backfill loses
// the race with early stream messages, de-dup by trade id keeps it correct.
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
  return {
    ...state,
    bufferedCount: buffer.length,
    minCaptureUsd: MIN_CAPTURE_USD,
    symbols: WHALE_SYMBOLS,
  };
}
