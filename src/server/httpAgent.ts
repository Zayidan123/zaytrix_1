// =============================================================================
// httpAgent.ts — shared HTTP(S) agents with keepAlive (OPT-3b)
// =============================================================================
// PURPOSE:
//   All upstream fetch() calls (Binance, CoinGecko, blockchain.info, mempool,
//   etc.) currently create a brand-new TCP+TLS connection per request. Each
//   handshake is ~100-300ms of pure overhead. By reusing connections via
//   `keepAlive: true` we cut latency for repeated calls (live-data router
//   polls Binance every few seconds) and reduce egress socket churn.
//
// USAGE (additive — no existing call sites are changed in this task):
//   import { fetchWithAgent, httpsAgent, httpAgent } from "./src/server/httpAgent";
//   const res = await fetchWithAgent("https://api.binance.com/api/v3/ping");
//
//   // For callers that build their own options object, pass the agent directly:
//   await fetch(url, { agent: httpsAgent });
//
// IMPORTANT:
//   - Node's GLOBAL fetch (undici) does NOT honor the `agent` option. It only
//     honors `dispatcher`. To make global fetch reuse connections, you must
//     either (a) call `setGlobalKeepAliveDispatcher()` once at boot (see
//     bottom of this file), OR (b) pass `dispatcher` explicitly per-call.
//   - This module is intentionally additive: it does not touch global state
//     unless `setGlobalKeepAliveDispatcher()` is explicitly called.
//   - The exported `fetchWithAgent` is a thin wrapper that passes `agent` —
//     this works for `node-fetch` users; for global-fetch callers, prefer
//     `setGlobalKeepAliveDispatcher()` at boot.
// =============================================================================

import http from "http";
import https from "https";

// OPT-3b: shared HTTPS agent with keepAlive — reuse TCP+TLS connections for
// repeated upstream API calls (Binance/CoinGecko/blockchain.info).
export const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 10000,
});

// OPT-3b: shared HTTP agent (same config) — used for plain-http upstreams.
export const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 10000,
});

// OPT-3b: convenience wrapper — picks the right agent by URL scheme.
// NOTE: Node's global `fetch` (undici) ignores the `agent` option; this helper
// is mainly useful for `node-fetch` callers. For global-fetch callers, see
// `setGlobalKeepAliveDispatcher()` below.
export function fetchWithAgent(url: string, options: any = {}): Promise<Response> {
  const isHttps = url.startsWith("https://");
  return fetch(url, {
    ...options,
    // @ts-ignore - node-fetch supports the `agent` option; global fetch
    // (undici) silently ignores it. The dispatcher field below is a no-op
    // for node-fetch but harmless.
    agent: isHttps ? httpsAgent : httpAgent,
  });
}

// OPT-3b: optional — call ONCE at boot to make Node's GLOBAL fetch (undici)
// reuse connections via a Pool with keepAlive. This is the approach that
// actually improves perf for code that calls the global `fetch()` directly
// (which is what the existing liveDataRoutes.ts + aiRouter.ts do).
//
// Implementation note: we lazy-import undici so the module loads even on Node
// builds that don't ship undici globally. If undici is unavailable, this
// becomes a no-op with a warning log.
export async function setGlobalKeepAliveDispatcher(): Promise<void> {
  try {
    // undici is bundled with Node 18+ as the global fetch implementation.
    const undici = await import("undici");
    const dispatcher = new undici.Agent({
      keepAliveTimeout: 30000,
      keepAliveMaxTimeout: 60000,
      connections: 10,
    });
    undici.setGlobalDispatcher(dispatcher);
    console.log("[httpAgent] global undici dispatcher set (keepAlive ON, max 10 connections per host).");
  } catch (e: any) {
    console.warn("[httpAgent] could not set global undici dispatcher:", e?.message || e);
  }
}
