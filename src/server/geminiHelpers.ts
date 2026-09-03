// =============================================================================
// geminiHelpers.ts — QA9-R3: shared AI plumbing for every AI endpoint
// (prompt-output cache w/ LRU cap, exponential-backoff retry, SSE streaming
// helpers, loose JSON signal parser, per-request AI client factory,
// thinking-level mapping). Extracted verbatim from server.ts (was 89-349).
// =============================================================================
import crypto from "crypto";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { createOpenRouterCompatClient, openRouterModelName, callAIStream } from "./aiRouter";
import { createLogger } from "./logger";

const log = createLogger("geminiHelpers");

// QA9-R3: shared lazily-initialized Gemini SDK client (was server.ts:316-321).
// Reassigned by getAiClient() below; importers read the live binding.
export let ai: any = null;

// Centralised in-memory cache for Gemini prompt/documents output caching.
// FIX-ALL M7: cap at 500 entries with LRU-style eviction (delete oldest entry
// when full). The Map preserves insertion order, so Map.keys().next().value
// returns the oldest entry — deleting it approximates FIFO/LRU eviction
// without an external dependency. Each Gemini call produces a unique SHA-256
// cache key (varies with prompt content), so without this cap the Map would
// grow unboundedly in long-running prod deployments and cause OOM.
const GEMINI_CACHE_MAX_ENTRIES = 500;
export const geminiCache = new Map<string, string>();

export function geminiCacheSet(key: string, value: string): void {
  // Evict the oldest entry if we're at capacity. We do this BEFORE inserting
  // so the cache never transiently exceeds the cap.
  if (geminiCache.size >= GEMINI_CACHE_MAX_ENTRIES) {
    const oldestKey = geminiCache.keys().next().value;
    if (oldestKey !== undefined) geminiCache.delete(oldestKey);
  }
  // FIX-ALL P0-1: previously called geminiCacheSet(key, value) recursively
  // (infinite recursion → stack overflow on every cache miss). Now correctly
  // delegates to the underlying Map.
  geminiCache.set(key, value);
}

export function getCacheKey(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// Sanitise inputs against prompt injections or HTML manipulations
export function sanitizePromptInput(text: string): string {
  if (!text) return "";
  let clean = text.replace(/<(script|iframe)[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Block trigger phrases securely by neutralizing them to redact authority spoofing
  clean = clean.replace(/(system\s*instruction|ignore\s*previous\s*instruction|you\s*are\s*now|acting\s*as|dan\s*abaikan|system\s*prompt)/gi, "[REDACTED_SECURITY_PHRASE]");
  return clean;
}

// Exponential Backoff Retry Wrapper for Gemini model queries
export async function generateContentWithRetry(aiClient: any, args: any, retries = 4, delay = 1200): Promise<any> {
  let lastError: any = null;
  // FIX-ALL P0-2: previously used "gemini-3.5-flash" / "gemini-3.1-flash-lite"
  // which do NOT exist in Google's API and caused every Gemini call to 404.
  // Replaced with real model names: gemini-2.5-flash → gemini-2.0-flash → gemini-flash-latest.
  const initialModel = args ? args.model : "gemini-2.5-flash";
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await aiClient.models.generateContent(args);
    } catch (error: any) {
      lastError = error;
      
      let errorDetail = "";
      if (error) {
        if (typeof error === "string") {
          errorDetail = error;
        } else if (typeof error === "object") {
          errorDetail = (error.message || "") + " " + JSON.stringify(error);
        } else {
          errorDetail = String(error);
        }
      }
      const errStr = errorDetail.toLowerCase();

      // If of daily/monthly limit context or quota exhaustion, retry is futile & delays user feedback.
      const isQuotaExhausted = errStr.includes("quota exceeded") || 
                              errStr.includes("quota_exhausted") || 
                              errStr.includes("exceeded your current quota") || 
                              errStr.includes("resource_exhausted") ||
                              errStr.includes("free tier") ||
                              errStr.includes("rate_limit_exceeded");

      const isRateLimit = errStr.includes("429") || errStr.includes("quota") || errStr.includes("limit");
      const isTransient = errStr.includes("500") || errStr.includes("503") || errStr.includes("timeout") || errStr.includes("fetch") || errStr.includes("unavailable") || errStr.includes("high demand") || errStr.includes("temporary");
      
      if (isQuotaExhausted) {
        // Daily quota limit hit, raise and throw immediately to fallback
        throw error;
      }

      if ((isRateLimit || isTransient) && attempt < retries) {
        // Multi-stage model cycling for extreme resilience!
        if (args) {
          if (args.model === "gemini-2.5-flash") {
            const nextModel = "gemini-2.0-flash";
            log.info(`[Gemini Model Fallback] gemini-2.5-flash threw error. Switching attempt ${attempt + 1} to ${nextModel} for resilience.`);
            args.model = nextModel;
          } else if (args.model === "gemini-2.0-flash") {
            const nextModel = "gemini-flash-latest";
            log.info(`[Gemini Model Fallback] gemini-2.0-flash threw error. Switching attempt ${attempt + 1} to ${nextModel} for resilience.`);
            args.model = nextModel;
          }
        }
        
        const sleepTime = delay * Math.pow(2, attempt - 1);
        log.info(`[Gemini Retry] Attempt ${attempt} failed with standard error/high demand. Retrying in ${sleepTime}ms... Error: ${errorDetail}`);
        await new Promise(resolve => setTimeout(resolve, sleepTime));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

// ─── QA8-C: shared SSE scaffolding for the Gemini-compat AI endpoints ────
// Mirrors /api/ai/chat-stream (QA7-F1): text/event-stream + no proxy buffering
// (X-Accel-Buffering: no) + keep-alive comment every 15s while the model is
// thinking + client-disconnect abort propagation (AbortController upstream) +
// res.end() in finally. Each endpoint passes a `run` callback that receives
// `send` (frame writer) + `abortSignal` (fires when the client disconnects) and
// is responsible for its own final {type:"done", ...} / {type:"error"} frame.
export async function runSSEStream(
  req: any,
  res: any,
  run: (send: (obj: unknown) => void, abortSignal: AbortSignal) => Promise<void>
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy buffering (Caddy/nginx) so tokens arrive immediately.
    "X-Accel-Buffering": "no",
  });

  let clientClosed = false;
  const clientAbort = new AbortController();
  req.on("close", () => {
    clientClosed = true;
    clientAbort.abort();
  });

  const send = (obj: unknown) => {
    if (clientClosed || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      clientClosed = true;
    }
  };

  // Keep-alive comment every 15s so proxies don't time the stream out.
  const keepAlive = setInterval(() => {
    if (clientClosed || res.writableEnded) return;
    try {
      res.write(": keep-alive\n\n");
    } catch {
      clientClosed = true;
    }
  }, 15_000);

  try {
    await run(send, clientAbort.signal);
  } catch (e: any) {
    send({ type: "error", error: String(e?.message || e).substring(0, 150) });
  } finally {
    clearInterval(keepAlive);
    if (!res.writableEnded) {
      try {
        res.end();
      } catch {}
    }
  }
}

// QA8-C: run callAIStream and collect the outcome without emitting the
// router-internal terminal events (they are re-shaped by each endpoint into
// its own authoritative done/error frames per the SSE contract). Token events
// are forwarded verbatim. Returns the accumulated text + the sanitized stream
// error (if the AI failed before/after tokens).
export async function streamViaAIRouter(
  params: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    userId?: string;
    endpoint: string;
    abortSignal: AbortSignal;
  },
  send: (obj: unknown) => void
): Promise<{ fullText: string; streamError: string | null }> {
  let fullText = "";
  let streamError: string | null = null;
  await callAIStream(params, (ev) => {
    if (ev.type === "token" && typeof ev.text === "string" && ev.text) {
      fullText += ev.text;
      send(ev);
    } else if (ev.type === "error" && ev.error) {
      streamError = ev.error;
    }
    // "start" and router-internal "done" events are intentionally not
    // forwarded: the endpoint emits the authoritative terminal frame itself.
  });
  return { fullText, streamError };
}

// QA8-C: streaming trading-signal responses run without upstream jsonMode
// (callAIStream has no response_format), so the model may wrap its JSON in
// markdown fences or prose. Strict-parse first — identical to the non-stream
// path — then best-effort extract the outermost JSON object. Returns null
// when nothing parses; the caller then degrades to its honest local fallback.
export function parseSignalJsonLoose(raw: string): Record<string, any> | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
    return null;
  } catch {}
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  try {
    const extracted = JSON.parse(text.slice(first, last + 1));
    if (extracted && typeof extracted === "object" && !Array.isArray(extracted)) return extracted;
    return null;
  } catch {
    return null;
  }
}

// Initialize the AI client — OpenRouter FIRST (cloud aggregator, works with
// NO local machine), direct Gemini second (legacy), none → honest degradation.
// MIGRATION 2026-08: the old 9router local proxy (localhost:20128) required an
// always-on machine the operator does not have — replaced by OpenRouter
// (https://openrouter.ai), which is OpenAI-compatible and needs only a key.
// The compat client mimics the GoogleGenAI `.models.generateContent()` shape
// so every existing call site keeps working unchanged (see aiRouter.ts).
if (process.env.OPENROUTER_API_KEY) {
  ai = createOpenRouterCompatClient();
  log.info(`[AI] Provider aktif: OpenRouter (model utama ${openRouterModelName()}, fallback Gemini) — cloud, tanpa server lokal.`);
} else if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  log.info("[AI] Provider aktif: Gemini langsung (GEMINI_API_KEY).");
} else {
  log.warn("[AI] Tidak ada provider AI terkonfigurasi (OPENROUTER_API_KEY / GEMINI_API_KEY kosong) — semua endpoint AI akan fallback jujur.");
}

export function getAiClient(req: any): any {
  // FIX-ALL P0-3b: previously accepted arbitrary `x-gemini-key` headers from
  // the client, which let any authenticated user inject their own (or a stolen)
  // Gemini API key and burn quota attributed to that key. Now we only ever use
  // the server-configured key. Per-user BYO-key (if needed in the future)
  // should be stored encrypted in the ApiKey table, never accepted raw.
  return ai;
}

export function mapThinkingLevel(mode: string | undefined): ThinkingLevel | undefined {
  if (mode === "high") return ThinkingLevel.HIGH;
  if (mode === "low") return ThinkingLevel.LOW;
  if (mode === "minimal") return ThinkingLevel.MINIMAL;
  return ThinkingLevel.HIGH; // Default to maximum reasoning
}

