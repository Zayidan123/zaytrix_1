// =============================================================================
// httpUtils.ts — QA9-R3 (monolith refactor): shared outbound fetch helper
// with hard timeout and a curl fallback.
//
// WHY a curl fallback: in some sandbox/embedded Node runtimes the native
// `fetch` (undici) silently stalls or aborts against upstream HTTPS APIs
// even though system `curl` works.  The server therefore retries the same
// request through `curl` when Node fetch fails with an abort/timeout.
// The curl path is also why this module is the shared network layer: every
// endpoint that imports it automatically gains the fallback.
// =============================================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function buildCurlArgs(url: string, options: any, timeoutMs: number): string[] {
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const rawHeaders: Record<string, string> =
    (options?.headers as Record<string, string> | undefined) || {};
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: rawHeaders.Accept || "application/json",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    ...rawHeaders,
  };

  const args: string[] = [
    "-sS",
    "--max-time",
    String(timeoutSec),
    "-A",
    headers["User-Agent"],
    "-H",
    `Accept: ${headers.Accept}`,
    "-H",
    `Accept-Language: ${headers["Accept-Language"]}`,
  ];
  for (const [key, value] of Object.entries(headers)) {
    if (["User-Agent", "Accept", "Accept-Language"].includes(key)) continue;
    args.push("-H", `${key}: ${value}`);
  }
  // `--` separator prevents option injection if `url` starts with `-`.
  args.push("-w", "\n---HTTP_CODE:%{http_code}---", "--", url);
  return args;
}

async function fetchViaCurl(url: string, options: any, timeoutMs: number): Promise<Response> {
  const { stdout } = await execFileP("curl", buildCurlArgs(url, options, timeoutMs), {
    maxBuffer: 10 * 1024 * 1024,
  });
  const m = stdout.match(/---HTTP_CODE:(\d+)---\s*$/);
  const status = m ? parseInt(m[1], 10) : 0;
  const body = stdout.replace(/\n---HTTP_CODE:\d+---\s*$/, "");

  const responseHeaders = new Headers();
  const rawHeaders: Record<string, string> =
    (options?.headers as Record<string, string> | undefined) || {};
  for (const [key, value] of Object.entries({
    "User-Agent": DEFAULT_UA,
    Accept: rawHeaders.Accept || "application/json",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    ...rawHeaders,
  })) {
    responseHeaders.set(key, value);
  }

  return new Response(body, { status, headers: responseHeaders, statusText: STATUS_TEXTS[status] });
}

const STATUS_TEXTS: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

// ---------------------------------------------------------------------------
// Circuit breaker — protects Binance fetches from cascading timeouts when the
// upstream is unreachable.  After 3 consecutive failures the circuit OPENS
// and requests fail FAST (no network wait) for 30s.  After the reset window a
// single HALF_OPEN probe is allowed; on success the circuit closes again.
// ---------------------------------------------------------------------------
interface CircuitState {
  failures: number;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  openedAt: number;
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_RESET_TIMEOUT_MS = 30_000;

function circuitKey(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function shouldTripCircuit(key: string): boolean {
  const state = circuits.get(key);
  if (!state || state.state === "CLOSED") return false;
  if (state.state === "HALF_OPEN") return false; // allow the single probe
  return Date.now() - state.openedAt < CIRCUIT_RESET_TIMEOUT_MS;
}

function markCircuitFailure(key: string): void {
  const state = circuits.get(key) || { failures: 0, state: "CLOSED", openedAt: 0 };
  state.failures += 1;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.state = "OPEN";
    state.openedAt = Date.now();
    console.warn(`[httpUtils] Circuit OPEN for ${key} after ${state.failures} consecutive failures`);
  }
  circuits.set(key, state);
}

function markCircuitSuccess(key: string): void {
  const state = circuits.get(key);
  if (state) {
    state.failures = 0;
    state.state = "CLOSED";
    state.openedAt = 0;
    circuits.set(key, state);
  }
}

function allowHalfOpenProbe(key: string): boolean {
  const state = circuits.get(key);
  if (!state || state.state !== "OPEN") return true;
  if (Date.now() - state.openedAt >= CIRCUIT_RESET_TIMEOUT_MS) {
    state.state = "HALF_OPEN";
    circuits.set(key, state);
    return true;
  }
  return false;
}

function throwCircuitOpen(key: string): never {
  throw new Error(`Circuit breaker OPEN for ${key}; upstream unreachable, failing fast`);
}

// ---------------------------------------------------------------------------
// fetchWithTimeout — wraps Node 18+ global `fetch` with an AbortController
// timeout.  If Node fetch is aborted/timed out (common in this environment),
// the same request is retried through system `curl`.  Never throws for status
// codes — the caller inspects `res.ok`.  Circuit breaker is applied per host.
// ---------------------------------------------------------------------------
export async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 3500) {
  const key = circuitKey(url);
  if (shouldTripCircuit(key)) {
    throwCircuitOpen(key);
  }
  if (!allowHalfOpenProbe(key)) {
    throwCircuitOpen(key);
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      markCircuitFailure(key);
    } else {
      markCircuitSuccess(key);
    }
    return res;
  } catch (err: any) {
    const name = err?.name || "";
    const message = (err?.message || "").toLowerCase();
    const isAbort =
      name === "AbortError" ||
      name === "TimeoutError" ||
      name === "TypeError" ||
      /abort|timed? out|network|fetch failed/i.test(message);
    if (!isAbort) {
      markCircuitFailure(key);
      throw err;
    }
    console.info(`[httpUtils] Node fetch aborted for ${url}; retrying via curl (${name}: ${err?.message})`);
    try {
      const curlRes = await fetchViaCurl(url, options, timeoutMs);
      if (!curlRes.ok) {
        markCircuitFailure(key);
      } else {
        markCircuitSuccess(key);
      }
      return curlRes;
    } catch (curlErr: any) {
      markCircuitFailure(key);
      throw curlErr;
    }
  } finally {
    clearTimeout(id);
  }
}
