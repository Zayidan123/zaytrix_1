import { createLogger } from "./logger";
import { fetchWithTimeout } from "./httpUtils";
const log = createLogger("upstreamHealth");

// =============================================================================
// upstreamHealth.ts — periodic upstream API health checker (OPT-3c)
// =============================================================================
// PURPOSE:
//   Pings critical upstream APIs (Binance, CoinGecko) every 60s and records
//   their health + latency. Route handlers can consult `isUpstreamHealthy(name)`
//   before issuing a request to avoid waiting for the full timeout when an
//   upstream is already known to be down.
//
// DESIGN:
//   - Pure additive: this module collects data; it does NOT block any request.
//   - The `setInterval` is `.unref()`'d so it won't prevent graceful shutdown.
//   - Default for `isUpstreamHealthy(name)` is OPTIMISTIC (returns true if no
//     health record exists yet — i.e. during the first 60s after boot). This
//     prevents false negatives from blocking legit traffic before the first
//     check completes.
//   - This is NOT a circuit breaker — it just exposes health data. A future
//     task can build circuit-breaker logic on top of this if needed.
// =============================================================================

interface UpstreamConfig {
  name: string;
  url: string;
  timeout: number;
}

interface UpstreamHealthEntry {
  healthy: boolean;
  lastCheck: number; // epoch ms
  latencyMs: number; // -1 if check threw / timed out
  lastError: string | null;
}

// OPT-3c: critical upstream APIs that the live-data + AI routes depend on.
// We ping lightweight endpoints (HTTP 200 with empty/small body) so the
// check itself is cheap — ~100 bytes of egress per minute per upstream.
const UPSTREAMS: UpstreamConfig[] = [
  { name: "binance", url: "https://api.binance.com/api/v3/ping", timeout: 5000 },
  { name: "coingecko", url: "https://api.coingecko.com/api/v3/ping", timeout: 5000 },
];

// OPT-3c: in-memory health map. Not persisted — fine because it's recomputed
// every 60s after boot. A future enhancement could write this to the audit log
// or a metrics table for trend analysis.
const health: Record<string, UpstreamHealthEntry> = {};

async function checkUpstream(upstream: UpstreamConfig): Promise<void> {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(upstream.url, {
      signal: AbortSignal.timeout(upstream.timeout),
    }, 5000);
    health[upstream.name] = {
      healthy: res.ok,
      lastCheck: Date.now(),
      latencyMs: Date.now() - start,
      lastError: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (e: any) {
    health[upstream.name] = {
      healthy: false,
      lastCheck: Date.now(),
      latencyMs: -1,
      lastError: e?.message ? String(e.message).slice(0, 200) : "unknown error",
    };
  }
}

// OPT-3c: call once at server boot to start the periodic checker. Safe to call
// multiple times — each call just schedules more checks (server.ts calls it
// exactly once near the other startup calls).
export function startUpstreamHealthChecker(): void {
  // Initial check (fire-and-forget — don't block boot).
  UPSTREAMS.forEach((u) => {
    void checkUpstream(u).catch(() => {
      /* swallow — checkUpstream already records the failure in `health` */
    });
  });

  // Periodic check every 60s. `.unref()` so the timer doesn't keep the process
  // alive during graceful shutdown.
  const timer = setInterval(() => {
    UPSTREAMS.forEach((u) => {
      void checkUpstream(u).catch(() => {});
    });
  }, 60_000);
  timer.unref();

  log.info(
    `[upstream-health] Checker started — monitors: ${UPSTREAMS.map((u) => u.name).join(", ")}`
  );
}

// OPT-3c: read-only snapshot of current health — expose via a future
// /api/health/upstream route or admin dashboard if desired.
export function getUpstreamHealth(): Record<string, UpstreamHealthEntry> {
  // Return a shallow copy so callers can't mutate the internal map.
  return { ...health };
}

// OPT-3c: optimistic health check. Returns `true` for unknown names or before
// the first check completes — this prevents the checker from accidentally
// blocking legit traffic during the boot window.
export function isUpstreamHealthy(name: string): boolean {
  return health[name]?.healthy ?? true;
}
