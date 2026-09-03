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
// QA10-E: prisma untuk persistensi AiUsageEvent (kuota harian per-user).
// Hanya satu arah (aiRouter → db) — TIDAK ada import balik dari aiMemory
// supaya graf dependensi bebas siklus (aiMemory boleh import aiRouter).
import { prisma } from "./db";

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
  endpoint?: string; // usage attribution label (e.g. "chat-stream", "gemini-compat")
  abortSignal?: AbortSignal; // client disconnect propagation (streaming)
  // QA10-E: id model pilihan user (harus salah satu getAvailableModels().id).
  // undefined → chain default (OPENROUTER_MODEL + fallback) — perilaku lama.
  model?: string;
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

// ─── Per-Call Usage Tracking (QA7-F2) ─────────────────────────────
// Ring buffer of the last N AI calls (in-memory, privacy-safe: NO prompt
// content stored — only metadata). Powers the operator "AI Usage" panel
// (GET /api/ai/usage) so token burn / latency / model mix is visible
// without reading server logs.
interface AIUsageRecord {
  ts: number;
  endpoint: string; // e.g. "chat", "chat-stream", "gemini-compat"
  provider: AIProviderName;
  model: string;
  tokens: number;
  latencyMs: number;
  success: boolean;
  streamed: boolean;
  costUsd?: number; // OpenRouter reports this in the final stream chunk
  error?: string;
  // QA10-E: user pemilik event (untuk AiUsageEvent.userId + kuota harian).
  // Optional supaya semua call-site lama tetap valid tanpa perubahan.
  userId?: string;
}

const usageRecords: AIUsageRecord[] = [];
const MAX_USAGE_RECORDS = 300;

function recordUsage(rec: AIUsageRecord): void {
  // (1) In-memory ring buffer — PERSIS seperti sebelumnya (panel operator
  //     /api/ai/usage tidak berubah satu bit).
  usageRecords.push(rec);
  if (usageRecords.length > MAX_USAGE_RECORDS) {
    usageRecords.splice(0, usageRecords.length - MAX_USAGE_RECORDS);
  }
  // (2) QA10-E: persist ke DB fire-and-forget → AiUsageEvent (kuota harian
  //     per-user + jejak lintas restart). Signature & return TIDAK berubah;
  //     gagal tulis DB hanya di-log — flow utama AI tidak boleh terganggu.
  //     Catatan mapping: AIUsageRecord hanya punya `tokens` total (OpenRouter
  //     melaporkan total_tokens gabungan) → dicatat sebagai tokensOut,
  //     tokensIn = 0. Kuota menghitung JUMLAH EVENT, bukan token, jadi
  //     mapping ini tidak memengaruhi penegakan kuota.
  prisma
    .aiUsageEvent
    .create({
      data: {
        userId: rec.userId ?? null,
        endpoint: rec.endpoint,
        provider: rec.provider,
        model: rec.model ?? null,
        tokensIn: 0,
        tokensOut: rec.tokens ?? 0,
        costUsd: rec.costUsd ?? 0,
      },
    })
    .catch((error: unknown) => {
      log.warn(
        `[aiRouter] gagal menulis AiUsageEvent (fire-and-forget, flow AI lanjut): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
}

export interface AIUsageSummary {
  windowRecords: number;
  totalCalls: number;
  totalTokens: number;
  failures: number;
  totalCostUsd: number;
  byModel: Array<{ model: string; calls: number; tokens: number; failures: number; avgLatencyMs: number; costUsd: number }>;
  byEndpoint: Array<{ endpoint: string; calls: number; tokens: number; failures: number; avgLatencyMs: number; costUsd: number }>;
  recent: AIUsageRecord[];
  windowStart: number;
}

export function getAIUsage(): AIUsageSummary {
  const byModel = new Map<string, { model: string; calls: number; tokens: number; failures: number; avgLatencyMs: number; costUsd: number }>();
  const byEndpoint = new Map<string, { endpoint: string; calls: number; tokens: number; failures: number; avgLatencyMs: number; costUsd: number }>();
  let totalTokens = 0;
  let totalCalls = 0;
  let failures = 0;
  let totalCostUsd = 0;

  for (const r of usageRecords) {
    totalTokens += r.tokens;
    totalCalls++;
    if (!r.success) failures++;
    totalCostUsd += r.costUsd ?? 0;

    const m = byModel.get(r.model) || { model: r.model, calls: 0, tokens: 0, failures: 0, avgLatencyMs: 0, costUsd: 0 };
    m.calls++; m.tokens += r.tokens; if (!r.success) m.failures++; m.avgLatencyMs += r.latencyMs; m.costUsd += r.costUsd ?? 0;
    byModel.set(r.model, m);

    const e = byEndpoint.get(r.endpoint) || { endpoint: r.endpoint, calls: 0, tokens: 0, failures: 0, avgLatencyMs: 0, costUsd: 0 };
    e.calls++; e.tokens += r.tokens; if (!r.success) e.failures++; e.avgLatencyMs += r.latencyMs; e.costUsd += r.costUsd ?? 0;
    byEndpoint.set(r.endpoint, e);
  }

  const fin = <T extends { calls: number; avgLatencyMs: number }>(arr: T[]) =>
    arr.map((v) => ({ ...v, avgLatencyMs: Math.round(v.avgLatencyMs / Math.max(1, v.calls)) }));

  return {
    windowRecords: usageRecords.length,
    totalCalls,
    totalTokens,
    failures,
    totalCostUsd,
    byModel: fin(Array.from(byModel.values())),
    byEndpoint: fin(Array.from(byEndpoint.values())),
    recent: usageRecords.slice(-25).reverse(), // newest first
    windowStart: usageRecords.length ? usageRecords[0].ts : 0,
  };
}

// ─── QA10-E: Kuota AI harian per-user (fondasi Direksi F — tier) ──────
// Dihitung dari AiUsageEvent DB (createdAt >= awal hari UTC) — persisten
// lintas restart, melengkapi ring in-memory di atas. Penegakan kuota
// (429 dsb.) di-wiring orkestrator server.ts; fungsi ini hanya menghitung
// + memberi bentuk respons yang jujur.
export interface AIQuotaInfo {
  used: number; // jumlah event AI hari ini (UTC) milik user
  limit: number; // AI_DAILY_LIMIT (default 500); 0 saat unlimited
  remaining: number; // max(0, limit - used); 0 saat unlimited
  resetsAt: string; // ISO — tengah malam UTC berikutnya
  unlimited: boolean; // true = tidak dibatasi (userId kosong / DB error)
}

/** Tengah malam UTC berikutnya sebagai ISO string (waktu reset kuota). */
function nextUtcMidnightIso(now = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0); // 24:00 hari ini = 00:00 besok (roll-over)
  return next.toISOString();
}

export async function getUserAiQuota(userId: string | undefined): Promise<AIQuotaInfo> {
  const resetsAt = nextUtcMidnightIso();

  // Tanpa identitas (panggilan internal / anonim) → unlimited jujur.
  // JSON tidak bisa membawa Infinity — pakai limit:0 + flag unlimited:true.
  if (!userId || typeof userId !== "string") {
    return { used: 0, limit: 0, remaining: 0, resetsAt, unlimited: true };
  }

  const limit = Number(process.env.AI_DAILY_LIMIT || 500);

  try {
    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    const used = await prisma.aiUsageEvent.count({
      where: { userId, createdAt: { gte: startOfDayUtc } },
    });
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetsAt,
      unlimited: false,
    };
  } catch (error: unknown) {
    // Fail-open JUJUR: bug counting tidak boleh mematikan chat — tapi
    // kegagalan ini WAJIB terlihat di log operator (bukan gagal diam-diam).
    log.warn(
      `[aiRouter] gagal menghitung kuota harian user (fail-open unlimited): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { used: 0, limit: 0, remaining: 0, resetsAt, unlimited: true };
  }
}

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

// ─── QA10-E: Pemilih model per-request (Direksi B) ────────────────────
// Daftar model yang BOLEH dipilih user — HANYA id yang memang ada di
// konfigurasi file ini (primary + fallback chain), tidak ada id karangan.
// Frontend memakai daftar ini untuk dropdown; server memvalidasi ulang.
export interface AIModelOption {
  id: string; // id OpenRouter persis (mis. "z-ai/glm-4.5-air")
  label: string; // label ramah bahasa Indonesia
  description: string; // deskripsi singkat untuk UI
}

// Label/deskripsi ramah untuk id yang dikenal; env override (OPENROUTER_MODEL /
// OPENROUTER_FALLBACK_MODELS) tetap didukung — id tak dikenal ditampilkan apa adanya.
const MODEL_LABELS: Record<string, { label: string; description: string }> = {
  "z-ai/glm-4.5-air": {
    label: "GLM 4.5 Air",
    description: "Model utama — cepat, hemat token, bahasa Indonesia natural",
  },
  "meta-llama/llama-3.3-70b-instruct": {
    label: "Llama 3.3 70B",
    description: "Alternatif seimbang — analisis umum yang stabil",
  },
  "google/gemma-3-27b-it": {
    label: "Gemma 3 27B",
    description: "Cadangan ringan — konsisten untuk pertanyaan sederhana",
  },
};

export function getAvailableModels(): AIModelOption[] {
  return [OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS]
    .filter((id, i, arr) => arr.indexOf(id) === i) // dedup id ganda dari env
    .map((id) => ({
      id,
      label: MODEL_LABELS[id]?.label ?? id,
      description: MODEL_LABELS[id]?.description ?? "Model OpenRouter dari konfigurasi server",
    }));
}

/**
 * QA10-E: tentukan chain model untuk satu request.
 * - req.model VALID (ada di getAvailableModels) → model pilihan user dicoba
 *   PERTAMA, sisa chain fallback tetap di belakangnya (resilience lama utuh:
 *   model pilihan gagal → fallback otomatis jalan seperti biasa).
 * - req.model TIDAK valid → log.warn SEKALI per request + chain default
 *   (degradasi jujur, BUKAN error — chat tidak boleh gagal karena pilihan).
 * - req.model undefined → chain default (perilaku lama, byte-identik).
 */
function resolveModelChain(req: AIRequest): string[] {
  const defaultChain = [OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS];
  if (!req.model) return defaultChain;
  if (!getAvailableModels().some((m) => m.id === req.model)) {
    log.warn(
      `[aiRouter] model "${req.model}" tidak ada di daftar model yang diizinkan — memakai model default (${OPENROUTER_MODEL})`
    );
    return defaultChain;
  }
  return [req.model, ...defaultChain.filter((m) => m !== req.model)];
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
  // QA10-E: chain = model pilihan user (jika valid) + fallback default.
  const models = resolveModelChain(req);
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

      recordUsage({
        ts: Date.now(),
        endpoint: req.endpoint || "chat",
        provider: "openrouter",
        model: result.model,
        tokens: result.tokensUsed,
        latencyMs: Date.now() - startTime,
        success: true,
        streamed: false,
        userId: req.userId, // QA10-E: kuota harian per-user
      });

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

  recordUsage({
    ts: Date.now(),
    endpoint: req.endpoint || "chat",
    provider: "openrouter",
    model: OPENROUTER_MODEL,
    tokens: 0,
    latencyMs: Date.now() - startTime,
    success: false,
    streamed: false,
    error: lastError.substring(0, 150),
    userId: req.userId, // QA10-E: kuota harian per-user
  });

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

    recordUsage({
      ts: Date.now(),
      endpoint: req.endpoint || "chat",
      provider: "gemini",
      model: GEMINI_MODEL,
      tokens: tokensUsed,
      latencyMs,
      success: true,
      streamed: false,
      userId: req.userId, // QA10-E: kuota harian per-user
    });

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

// ─── Streaming (SSE) — QA7-F1 ────────────────────────────────────────
// Streams OpenRouter responses token-by-token. Model fallback only applies
// BEFORE the first token is emitted (retrying mid-stream would duplicate
// partial text, so once content flows we commit to that model).
// Gemini has no streaming path here — callers degrade to non-streaming.
export interface AIStreamEvent {
  type: "start" | "token" | "done" | "error";
  model?: string;
  provider?: AIProviderName;
  text?: string; // token delta
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
}

const OPENROUTER_STREAM_TIMEOUT_MS = Math.max(OPENROUTER_TIMEOUT_MS, 90_000);

export async function callAIStream(
  req: AIRequest,
  onEvent: (ev: AIStreamEvent) => void
): Promise<void> {
  const startTime = Date.now();

  if (OPENROUTER_API_KEY && providerHealth["openrouter"].available) {
    // QA10-E: chain = model pilihan user (jika valid) + fallback default.
    const models = resolveModelChain(req);
    const messages: OpenRouterMessage[] = [];
    if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
    messages.push({ role: "user", content: req.prompt });

    let lastError = "unknown";

    for (const model of models) {
      let gotAnyToken = false;
      let tokensUsed = 0;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OPENROUTER_STREAM_TIMEOUT_MS);
      // Abort the upstream fetch when the client disconnects mid-stream.
      const onClientClose = () => controller.abort();
      req.abortSignal?.addEventListener("abort", onClientClose, { once: true });

      try {
        const res = await fetch(OPENROUTER_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": OPENROUTER_REFERER,
            "X-Title": OPENROUTER_TITLE,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: Math.max(256, req.maxTokens ?? 2048),
            temperature: req.temperature ?? 0.7,
            stream: true,
            reasoning: { enabled: false },
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "Unknown error");
          const sanitized = errText
            .substring(0, 200)
            .replace(/Bearer\s+[A-Za-z0-9\-_\.]+/gi, "Bearer [REDACTED]")
            .replace(/sk-or-v1-[A-Za-z0-9\-]+/gi, "sk-or-v1-[REDACTED]");
          throw new Error(`OpenRouter HTTP ${res.status} (${model}): ${sanitized}`);
        }
        if (!res.body) {
          throw new Error(`OpenRouter (${model}) tidak mengembalikan body stream`);
        }

        onEvent({ type: "start", model, provider: "openrouter" });

        // Parse SSE: lines of "data: {json}" separated by newlines; the
        // terminal sentinel is "data: [DONE]". The final data chunk may
        // carry `usage` for accounting.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamError: string | null = null;
        let streamCostUsd: number | undefined;

        readLoop:
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // keep trailing partial line
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let json: any;
            try {
              json = JSON.parse(payload);
            } catch {
              continue; // tolerate malformed chunk (keep-alive comments etc.)
            }
            // Mid-stream provider error: {"error": {"message": ...}}
            if (json?.error) {
              const msg = typeof json.error === "string" ? json.error : json.error.message || "upstream stream error";
              streamError = String(msg).substring(0, 200);
              break readLoop;
            }
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              gotAnyToken = true;
              onEvent({ type: "token", text: delta, model, provider: "openrouter" });
            }
            if (typeof json?.usage?.total_tokens === "number") {
              tokensUsed = json.usage.total_tokens;
            }
            if (typeof json?.usage?.cost === "number") {
              streamCostUsd = json.usage.cost;
            }
          }
        }

        if (streamError) {
          throw new Error(`OpenRouter stream error (${model}): ${streamError}`);
        }
        if (!gotAnyToken) {
          // Empty stream (e.g. moderation filter) — safe to try the next model.
          throw new Error(`OpenRouter (${model}) stream kosong`);
        }

        providerHealth["openrouter"].available = true;
        providerHealth["openrouter"].lastError = null;
        providerHealth["openrouter"].lastSuccess = Date.now();
        providerHealth["openrouter"].failureCount = 0;
        providerHealth["openrouter"].totalCalls++;
        providerHealth["openrouter"].totalTokens += tokensUsed;

        const latencyMs = Date.now() - startTime;
        recordUsage({
          ts: Date.now(),
          endpoint: req.endpoint || "chat-stream",
          provider: "openrouter",
          model,
          tokens: tokensUsed,
          latencyMs,
          success: true,
          streamed: true,
          costUsd: streamCostUsd,
          userId: req.userId, // QA10-E: kuota harian per-user
        });
        if (req.userId) {
          logAudit(req.userId, "AI_CALL_OPENROUTER_STREAM", null, true, {
            model,
            tokens: tokensUsed,
            latencyMs,
          }).catch(() => {});
        }
        onEvent({ type: "done", model, provider: "openrouter", tokensUsed, latencyMs });
        return;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastError = errorMessage;
        if (gotAnyToken) {
          // Partial content already delivered — do NOT retry with another
          // model (would duplicate text). End the stream honestly instead.
          log.warn(`[aiRouter] stream error setelah ${model} mengirim konten parsial: ${errorMessage.substring(0, 120)}`);
          recordUsage({
            ts: Date.now(),
            endpoint: req.endpoint || "chat-stream",
            provider: "openrouter",
            model,
            tokens: 0,
            latencyMs: Date.now() - startTime,
            success: false,
            streamed: true,
            error: errorMessage.substring(0, 150),
            userId: req.userId, // QA10-E: kuota harian per-user
          });
          onEvent({ type: "error", error: `Stream terputus: ${errorMessage.substring(0, 120)}` });
          return;
        }
        log.warn(`[aiRouter] stream model "${model}" gagal: ${errorMessage.substring(0, 120)} — mencoba model berikutnya...`);
      } finally {
        clearTimeout(timeout);
        req.abortSignal?.removeEventListener("abort", onClientClose);
      }
    }

    providerHealth["openrouter"].available = false;
    providerHealth["openrouter"].lastError = lastError;
    providerHealth["openrouter"].failureCount++;
    recordUsage({
      ts: Date.now(),
      endpoint: req.endpoint || "chat-stream",
      provider: "openrouter",
      model: OPENROUTER_MODEL,
      tokens: 0,
      latencyMs: Date.now() - startTime,
      success: false,
      streamed: true,
      error: lastError.substring(0, 150),
      userId: req.userId, // QA10-E: kuota harian per-user
    });
  }

  // Degrade gracefully: non-streaming callAI (OpenRouter retry or Gemini),
  // emitted as a single token so the client UI behaves identically.
  const result = await callAI(req);
  if (result.success) {
    onEvent({ type: "start", model: result.model, provider: result.provider });
    onEvent({ type: "token", text: result.text, model: result.model, provider: result.provider });
    onEvent({
      type: "done",
      model: result.model,
      provider: result.provider,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
    });
  } else {
    onEvent({ type: "error", error: result.error || "Semua provider AI gagal." });
  }
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
