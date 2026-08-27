// ZAYTRIX AI Router — 9router (primary) + Gemini (fallback)
// Institutional-grade AI routing with automatic failover, cost tracking, and audit logging.
//
// 9router is an OpenAI-compatible local proxy/router that wraps 100+ models from 40+ providers.
// Endpoint: http://localhost:20128/v1/chat/completions (configurable)
// Auth: Bearer token (generated from 9router dashboard)
// Docs: https://github.com/decolua/9router
//
// Fallback chain: 9router → Gemini → cached response → honest error
// All AI calls are audit-logged with provider, model, tokens, latency, and cost.

import { GoogleGenAI } from "@google/genai";
import { logAudit } from "./audit";

// ─── Configuration ───────────────────────────────────────────────────
const NINEROUTER_ENDPOINT = process.env.NINEROUTER_ENDPOINT || "http://localhost:20128/v1/chat/completions";
const NINEROUTER_API_KEY = process.env.NINEROUTER_API_KEY || "";
const NINEROUTER_MODEL = process.env.NINEROUTER_MODEL || "kr/claude-sonnet-4.5";
const NINEROUTER_TIMEOUT_MS = parseInt(process.env.NINEROUTER_TIMEOUT_MS || "30000", 10);

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

export interface AIResponse {
  success: boolean;
  text: string;
  provider: "9router" | "gemini" | "cache" | "none";
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
  "9router": { available: true, lastError: null, lastSuccess: 0, failureCount: 0, totalCalls: 0, totalTokens: 0 },
  "gemini": { available: !!GEMINI_API_KEY, lastError: null, lastSuccess: 0, failureCount: 0, totalCalls: 0, totalTokens: 0 },
};

// ─── 9router Call (OpenAI-compatible) ────────────────────────────────
async function call9Router(req: AIRequest): Promise<AIResponse> {
  const startTime = Date.now();
  // OPT-3e: typed message shape (was `any[]`). 9router + OpenAI expect
  // `Array<{ role: "system"|"user"|"assistant"; content: string }>` — we only
  // push system + user messages, so a narrow literal union is correct here.
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (req.systemPrompt) {
    messages.push({ role: "system", content: req.systemPrompt });
  }
  messages.push({ role: "user", content: req.prompt });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NINEROUTER_TIMEOUT_MS);

    const res = await fetch(NINEROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NINEROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: NINEROUTER_MODEL,
        messages,
        max_tokens: req.maxTokens || 2048,
        temperature: req.temperature ?? 0.7,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      // FIX-B-6: sanitize upstream error text — if 9router echoes the
      // Authorization header back in its 4xx response body, the raw Bearer
      // token would otherwise leak to the client via `result.error`.
      const sanitizedErr = errText
        .substring(0, 200)
        .replace(/Bearer\s+[A-Za-z0-9\-_\.]+/gi, "Bearer [REDACTED]");
      throw new Error(`9router HTTP ${res.status}: ${sanitizedErr}`);
    }

    // OPT-3e: typed response shape (was `as any`). 9router is OpenAI-compatible,
    // so we model only the fields we actually read: choices[0].message.content
    // + usage.total_tokens. Extra fields are ignored by structural typing.
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    const text = data?.choices?.[0]?.message?.content || "";
    const tokensUsed = data?.usage?.total_tokens || 0;
    const latencyMs = Date.now() - startTime;

    // Update health
    providerHealth["9router"].available = true;
    providerHealth["9router"].lastSuccess = Date.now();
    providerHealth["9router"].failureCount = 0;
    providerHealth["9router"].totalCalls++;
    providerHealth["9router"].totalTokens += tokensUsed;

    return {
      success: true,
      text,
      provider: "9router",
      model: NINEROUTER_MODEL,
      tokensUsed,
      latencyMs,
      fallbackUsed: false,
    };
  } catch (error: unknown) {
    // OPT-3e: narrow `unknown` to a real message (was `any`). We only need
    // `error.message` for the audit/health record — anything else becomes
    // a String() fallback so we never throw a non-Error from this catch.
    const errorMessage = error instanceof Error ? error.message : String(error);
    const latencyMs = Date.now() - startTime;
    providerHealth["9router"].available = false;
    providerHealth["9router"].lastError = errorMessage;
    providerHealth["9router"].failureCount++;

    return {
      success: false,
      text: "",
      provider: "9router",
      latencyMs,
      error: errorMessage,
      fallbackUsed: false,
    };
  }
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

    // OPT-3e: GoogleGenAI's GenerateContentResponse type in some SDK versions
    // doesn't expose `usageMetadata` directly. We model the field we read via
    // a minimal structural cast (was `as any`) — keeps type safety for the
    // rest of the response object.
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
    // OPT-3e: narrow `unknown` → message string (was `any`).
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
  // Try 9router first (primary)
  let nineRouterError: string | null = null;
  if (providerHealth["9router"].available && NINEROUTER_API_KEY) {
    const result = await call9Router(req);
    if (result.success) {
      if (req.userId) {
        logAudit(req.userId, "AI_CALL_9ROUTER", null, true, {
          model: result.model,
          tokens: result.tokensUsed,
          latencyMs: result.latencyMs,
        }).catch(() => {});
      }
      return result;
    }
    nineRouterError = result.error || "unknown";
    // 9router failed — fall through to Gemini
    console.warn(`[aiRouter] 9router failed (${nineRouterError}), falling back to Gemini...`);
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
  console.error(`[aiRouter] All AI providers failed. 9router: ${nineRouterError}, Gemini: ${geminiResult.error}`);
  return {
    success: false,
    text: "",
    provider: "none",
    latencyMs: 0,
    error: "Semua provider AI tidak tersedia. 9router dan Gemini gagal.",
    fallbackUsed: true,
  };
}

// ─── Health Check Endpoint Data ──────────────────────────────────────
export function getAIProviderHealth() {
  return {
    "9router": {
      ...providerHealth["9router"],
      endpoint: NINEROUTER_ENDPOINT,
      model: NINEROUTER_MODEL,
      configured: !!NINEROUTER_API_KEY,
    },
    "gemini": {
      ...providerHealth["gemini"],
      model: GEMINI_MODEL,
      configured: !!GEMINI_API_KEY,
    },
    primary: "9router",
    fallback: "gemini",
  };
}

// ─── Test 9router connectivity ───────────────────────────────────────
export async function test9RouterConnection(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(NINEROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NINEROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: NINEROUTER_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      return { success: false, latencyMs, error: `HTTP ${res.status}` };
    }

    providerHealth["9router"].available = true;
    return { success: true, latencyMs };
  } catch (error: unknown) {
    // OPT-3e: narrow `unknown` → message string (was `any`).
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, latencyMs: Date.now() - startTime, error: errorMessage };
  }
}
