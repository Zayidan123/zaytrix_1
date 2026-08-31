import { createLogger } from "./logger";
const log = createLogger("aiRouter");

// ZAYTRIX AI Router — OpenRouter (primary) + Gemini (fallback)
// Institutional-grade AI routing with automatic failover, cost tracking, and audit logging.
//
// OpenRouter is a cloud AI aggregator (https://openrouter.ai) — NO local server
// needed (this replaces the old 9router local proxy which required a machine
// running localhost:20128). One key unlocks 100+ models from 40+ providers.
//
// Endpoint: https://openrouter.ai/api/v1/chat/completions (OpenAI-compatible)
// Auth: Bearer sk-or-v1-... (from https://openrouter.ai/keys)
// Key lives ONLY in .env (gitignored) — never commit it to git.
//
// Resilience layers:
//   1. Model fallback list (OPENROUTER_MODEL + OPENROUTER_FALLBACK_MODELS) —
//      if the primary model returns empty content / 4xx / region-block, the
//      next model in the list is tried automatically.
//   2. `reasoning: { enabled: false }` — reasoning models (GLM etc.) would
//      otherwise burn the whole max_tokens budget on chain-of-thought and
//      return content: null.
//   3. Provider chain: OpenRouter → Gemini (if GEMINI_API_KEY) → honest error.
//   4. Error text sanitization (FIX-B-6) — upstream bodies that echo the
//      Authorization header are redacted before reaching the client.
//
// All AI calls are audit-logged with provider, model, tokens, latency, and cost.

import { GoogleGenAI } from "@google/genai";
import { logAudit } from "./audit";

// ─── Configuration ───────────────────────────────────────────────────
const OPENROUTER_ENDPOINT = process.env.OPENROUTER_ENDPOINT || "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "z-ai/glm-4.5-air";
// Verified working fallback models (region-tested 2026-08): all reachable via
// this key, cheap, good Indonesian output. Comma-separated env override.
const OPENROUTER_FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS || "meta-llama/llama-3.3-70b-instruct,google/gemma-3-27b-it")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const OPENROUTER_TIMEOUT_MS = parseInt(process.env.OPENROUTER_TIMEOUT_MS || "30000", 10);
// Attribution headers recommended by OpenRouter (shows "via ZAYTRIX" on
// openrouter.ai/activity). Falls back to the repo URL when APP_URL is unset.
const OPENROUTER_REFERER = process.env.APP_URL || "https://github.com/Zayidan123/zaytrix_1";
const OPENROUTER_TITLE = "ZAYTRIX";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ─── Types ───────────────────────────────────────────────────────────
export interface AIRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  userId?: string; // for audit logging
  context?: string; // additional context (e.g., on-chain data)
}

export type AIProviderName = "openrouter" | "gemini" | "cache" | "none";

export interface AIResponse {
  success: boolean;
  text: string;
  provider: AIProviderName;
  model?: string;
  tokensUsed?: number;
  latencyMs: number;
  error?: string;
  fallbackUsed: boolean;
}

// ─── Provider Health Tracking ────────────────────────────────────────
interface ProviderHealth {
  available: boolean;
  lastError: string | null;
  lastSuccess: number;
  failureCount: number;
  totalCalls: number;
  totalTokens: number;
}

const providerHealth: Record<string, ProviderHealth> = {
  "openrouter": { available: true, lastError: null, lastSuccess: 0, failureCount: 0, totalCalls: 0, totalTokens: 0 },
  "gemini": { available: !!GEMINI_API_KEY, lastError: null, lastSuccess: 0, failureCount: 0, totalCalls: 0, totalTokens: 0 },
};

// ─── OpenRouter low-level call (OpenAI-compatible) ───────────────────
interface OpenRouterMessage {
  role: "system" | "user";
  content: string;
}

interface OpenRouterCallOptions {
  messages: OpenRouterMessage[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

interface OpenRouterCallResult {
  text: string;
  tokensUsed: number;
  model: string;
}

export function openRouterModelName(): string {
  return OPENROUTER_MODEL;
}

/**
 * Single OpenRouter chat-completion attempt against ONE model.
 * Throws on HTTP error, empty content, or timeout — callers handle fallback.
 */
async function openRouterCallOnce(opts: OpenRouterCallOptions): Promise<OpenRouterCallResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? OPENROUTER_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      max_tokens: Math.max(256, opts.maxTokens ?? 2048),
      temperature: opts.temperature ?? 0.7,
      stream: false,
      // Reasoning models (z-ai/glm-*) otherwise spend the entire token budget
      // on chain-of-thought and return content: null.
      reasoning: { enabled: false },
    };
    if (opts.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": OPENROUTER_REFERER,
        "X-Title": OPENROUTER_TITLE,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      // FIX-B-6: sanitize upstream error text — if OpenRouter (or a provider)
      // echoes the Authorization header back in its 4xx body, the raw Bearer
      // token would otherwise leak to the client via `result.error`.
      const sanitizedErr = errText
        .substring(0, 200)
        .replace(/Bearer\s+[A-Za-z0-9\-_\.]+/gi, "Bearer [REDACTED]")
        .replace(/sk-or-v1-[A-Za-z0-9\-]+/gi, "sk-or-v1-[REDACTED]");
      throw new Error(`OpenRouter HTTP ${res.status} (${opts.model}): ${sanitizedErr}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { total_tokens?: number };
    };
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text.trim()) {
      // content: null usually means a reasoning model exhausted max_tokens on
      // thinking — surface a distinct error so the model-fallback layer can
      // pick a non-reasoning model next.
      throw new Error(`OpenRouter (${opts.model}) mengembalikan konten kosong (reasoning budget habis?)`);
    }

    return {
      text,
      tokensUsed: data?.usage?.total_tokens || 0,
      model: opts.model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * OpenRouter call with automatic model fallback.
 * Tries OPENROUTER_MODEL, then each entry in OPENROUTER_FALLBACK_MODELS.
 */
async function callOpenRouter(req: AIRequest): Promise<AIResponse> {
  const startTime = Date.now();
  const models = [OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS];
  const messages: OpenRouterMessage[] = [];
  if (req.systemPrompt) {
    messages.push({ role: "system", content: req.systemPrompt });
  }
  messages.push({ role: "user", content: req.prompt });

  let lastError = "unknown";
  for (const model of models) {
    try {
      const result = await openRouterCallOnce({
        messages,
        model,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
      });

      providerHealth["openrouter"].available = true;
      providerHealth["openrouter"].lastError = null;
      providerHealth["openrouter"].lastSuccess = Date.now();
      providerHealth["openrouter"].failureCount = 0;
      providerHealth["openrouter"].totalCalls++;
      providerHealth["openrouter"].totalTokens += result.tokensUsed;

      return {
        success: true,
        text: result.text,
        provider: "openrouter",
        model: result.model,
        tokensUsed: result.tokensUsed,
        latencyMs: Date.now() - startTime,
        fallbackUsed: false,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lastError = errorMessage;
      log.warn(`[aiRouter] OpenRouter model "${model}" gagal: ${errorMessage.substring(0, 120)} — mencoba model berikutnya...`);
    }
  }

  providerHealth["openrouter"].available = false;
  providerHealth["openrouter"].lastError = lastError;
  providerHealth["openrouter"].failureCount++;

  return {
    success: false,
    text: "",
    provider: "openrouter",
    model: OPENROUTER_MODEL,
    latencyMs: Date.now() - startTime,
    error: lastError,
    fallbackUsed: false,
  };
}

// ─── Gemini Call (fallback) ──────────────────────────────────────────
async function callGemini(req: AIRequest): Promise<AIResponse> {
  const startTime = Date.now();

  if (!GEMINI_API_KEY) {
    return {
      success: false,
      text: "",
      provider: "gemini",
      latencyMs: 0,
      error: "GEMINI_API_KEY not configured",
      fallbackUsed: true,
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const fullPrompt = req.systemPrompt ? `${req.systemPrompt}\n\n${req.prompt}` : req.prompt;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: fullPrompt,
      config: {
        maxOutputTokens: req.maxTokens || 2048,
        temperature: req.temperature ?? 0.7,
      },
    });

    const geminiResponse = response as { text?: string; usageMetadata?: { totalTokenCount?: number } };
    const text = geminiResponse.text || "";
    const tokensUsed = geminiResponse?.usageMetadata?.totalTokenCount || 0;
    const latencyMs = Date.now() - startTime;

    providerHealth["gemini"].available = true;
    providerHealth["gemini"].lastSuccess = Date.now();
    providerHealth["gemini"].failureCount = 0;
    providerHealth["gemini"].totalCalls++;
    providerHealth["gemini"].totalTokens += tokensUsed;

    return {
      success: true,
      text,
      provider: "gemini",
      model: GEMINI_MODEL,
      tokensUsed,
      latencyMs,
      fallbackUsed: true,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const latencyMs = Date.now() - startTime;
    providerHealth["gemini"].available = false;
    providerHealth["gemini"].lastError = errorMessage;
    providerHealth["gemini"].failureCount++;

    return {
      success: false,
      text: "",
      provider: "gemini",
      latencyMs,
      error: errorMessage,
      fallbackUsed: true,
    };
  }
}

// ─── Main AI Router (with fallback chain) ─────────────────────────────
export async function callAI(req: AIRequest): Promise<AIResponse> {
  // Try OpenRouter first (primary — cloud, no local server required)
  let openRouterError: string | null = null;
  if (providerHealth["openrouter"].available && OPENROUTER_API_KEY) {
    const result = await callOpenRouter(req);
    if (result.success) {
      if (req.userId) {
        logAudit(req.userId, "AI_CALL_OPENROUTER", null, true, {
          model: result.model,
          tokens: result.tokensUsed,
          latencyMs: result.latencyMs,
        }).catch(() => {});
      }
      return result;
    }
    openRouterError = result.error || "unknown";
    // OpenRouter failed — fall through to Gemini
    log.warn(`[aiRouter] OpenRouter gagal (${openRouterError}), fallback ke Gemini...`);
  }

  // Fallback to Gemini
  const geminiResult = await callGemini(req);
  if (geminiResult.success) {
    if (req.userId) {
      logAudit(req.userId, "AI_CALL_GEMINI", null, true, {
        model: geminiResult.model,
        tokens: geminiResult.tokensUsed,
        latencyMs: geminiResult.latencyMs,
        fallback: true,
      }).catch(() => {});
    }
    return geminiResult;
  }

  // Both failed
  log.error(`[aiRouter] Semua provider AI gagal. OpenRouter: ${openRouterError}, Gemini: ${geminiResult.error}`);
  return {
    success: false,
    text: "",
    provider: "none",
    latencyMs: 0,
    error: "Semua provider AI tidak tersedia. OpenRouter dan Gemini gagal.",
    fallbackUsed: true,
  };
}

// ─── Health Check Endpoint Data ──────────────────────────────────────
export function getAIProviderHealth() {
  return {
    "openrouter": {
      ...providerHealth["openrouter"],
      endpoint: OPENROUTER_ENDPOINT,
      model: OPENROUTER_MODEL,
      fallbackModels: OPENROUTER_FALLBACK_MODELS,
      configured: !!OPENROUTER_API_KEY,
    },
    "gemini": {
      ...providerHealth["gemini"],
      model: GEMINI_MODEL,
      configured: !!GEMINI_API_KEY,
    },
    primary: "openrouter",
    fallback: "gemini",
  };
}

// ─── Test OpenRouter connectivity ────────────────────────────────────
export async function testOpenRouterConnection(): Promise<{ success: boolean; latencyMs: number; model?: string; error?: string }> {
  const startTime = Date.now();
  if (!OPENROUTER_API_KEY) {
    return { success: false, latencyMs: 0, error: "OPENROUTER_API_KEY belum dikonfigurasi di .env" };
  }
  const models = [OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS];
  let lastError = "";
  for (const model of models) {
    try {
      await openRouterCallOnce({
        messages: [{ role: "user", content: "ping" }],
        model,
        maxTokens: 256,
        temperature: 0,
      });
      const latencyMs = Date.now() - startTime;
      providerHealth["openrouter"].available = true;
      providerHealth["openrouter"].lastSuccess = Date.now();
      return { success: true, latencyMs, model };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { success: false, latencyMs: Date.now() - startTime, error: lastError };
}

// ─── Gemini-compatible adapter (for server.ts direct call sites) ─────
// =============================================================================
// server.ts has ~6 endpoints that call the Gemini SDK client directly:
//   const client = getAiClient(req);
//   const response = await generateContentWithRetry(client, {
//     model: "gemini-2.5-flash",
//     contents: prompt,                  // string OR parts array
//     config: { systemInstruction, temperature, maxOutputTokens,
//               responseMimeType: "application/json" }
//   });
//   const text = response.text;
//
// createOpenRouterCompatClient() returns an object with the SAME shape
// (`.models.generateContent(args) → { text, usageMetadata }`) so every one of
// those endpoints transparently gains OpenRouter support — zero call-site
// changes, zero risk to the honest-fallback paths (errors still throw, so
// generateContentWithRetry + the endpoints' catch blocks behave identically).
// =============================================================================
type GeminiCompatArgs = {
  model?: string; // ignored — OpenRouter model comes from env
  contents?: string | Array<{ text?: string; parts?: Array<{ text?: string }> } | { role?: string; parts?: Array<{ text?: string }> }>;
  config?: {
    systemInstruction?: string | { parts?: Array<{ text?: string }> };
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: string; // "application/json" → jsonMode
    thinkingConfig?: unknown; // Gemini-only — ignored (OpenRouter reasoning is disabled at the request level)
  };
};

function extractContentsText(contents: GeminiCompatArgs["contents"]): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (typeof (part as { text?: string }).text === "string") return (part as { text: string }).text;
          const parts = (part as { parts?: Array<{ text?: string }> }).parts;
          if (Array.isArray(parts)) return parts.map((p) => p?.text ?? "").join("");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractSystemInstruction(config: GeminiCompatArgs["config"]): string | undefined {
  const si = config?.systemInstruction;
  if (typeof si === "string") return si;
  if (si && typeof si === "object" && Array.isArray(si.parts)) {
    const joined = si.parts.map((p) => p?.text ?? "").join("\n");
    return joined.trim() || undefined;
  }
  return undefined;
}

export interface GeminiCompatResponse {
  text: string;
  usageMetadata?: { totalTokenCount?: number };
}

export function createOpenRouterCompatClient() {
  if (!OPENROUTER_API_KEY) {
    throw new Error("createOpenRouterCompatClient dipanggil tanpa OPENROUTER_API_KEY");
  }
  return {
    models: {
      async generateContent(args: GeminiCompatArgs): Promise<GeminiCompatResponse> {
        const userPrompt = extractContentsText(args?.contents);
        if (!userPrompt.trim()) {
          throw new Error("[openrouterCompat] prompt kosong — tidak ada yang bisa dianalisis");
        }
        const systemInstruction = extractSystemInstruction(args?.config);
        const jsonMode = args?.config?.responseMimeType === "application/json";

        const messages: OpenRouterMessage[] = [];
        if (systemInstruction) {
          messages.push({ role: "system", content: systemInstruction });
        }
        messages.push({ role: "user", content: userPrompt });

        // Model fallback mirrors callOpenRouter — one failing model (region
        // block, empty content, transient 429) moves on to the next.
        const models = [OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS];
        let lastError: Error | null = null;
        for (const model of models) {
          try {
            const result = await openRouterCallOnce({
              messages,
              model,
              maxTokens: args?.config?.maxOutputTokens,
              temperature: args?.config?.temperature,
              jsonMode,
            });
            providerHealth["openrouter"].totalCalls++;
            providerHealth["openrouter"].totalTokens += result.tokensUsed;
            providerHealth["openrouter"].lastSuccess = Date.now();
            return {
              text: result.text,
              usageMetadata: { totalTokenCount: result.tokensUsed },
            };
          } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error(String(error));
          }
        }
        providerHealth["openrouter"].lastError = lastError?.message ?? "unknown";
        throw lastError ?? new Error("OpenRouter gagal tanpa alasan");
      },
    },
  };
}
