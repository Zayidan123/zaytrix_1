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
// QA11-F (Direksi F): batas kuota kini per-plan — pure function dari plans.ts
// (plans.ts import db+auth, BUKAN aiRouter → bebas siklus).
import { getPlanAiLimit, normalizePlan } from "./plans";

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

// ─── 9router Configuration (LOCAL, FREE models) ──────────────
// 9router is a local AI proxy running on this device (Termux).
// It provides free model access via an OpenRouter-compatible API.
// Detected automatically on boot — if unreachable, falls back to
// OpenRouter (cloud) or Gemini without affecting functionality.
const NINEROUTER_ENABLED = process.env.NINEROUTER_ENABLED !== "false"; // set "false" to disable
const NINEROUTER_API_KEY = process.env.NINEROUTER_API_KEY || "";
const NINEROUTER_ENDPOINT = process.env.NINEROUTER_ENDPOINT || "http://localhost:20128/v1";
const NINEROUTER_DETECT_TIMEOUT_MS = 10_000; // 10s for detection ping

// Free models we explicitly whitelist from 9router (all confirmed working 2026-09).
const NINEROUTER_FREE_MODELS: string[] = (process.env.NINEROUTER_FREE_MODELS || "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
// Default free models — auto-detected from /v1/models if list is empty.
const NINEROUTER_DEFAULT_FREE_MODELS = [
  "kc/openrouter/free",
  "openrouter/openrouter/free",
  "kc/nex-agi/nex-n2.5-mini:free",
  "openrouter/nex-agi/nex-n2.5-mini:free",
  "openrouter/nvidia/nemotron-3.5-lightning:free",
];
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

export type AIProviderName = "9router" | "openrouter" | "gemini" | "cache" | "none";

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
  "9router": { available: false, lastError: null, lastSuccess: 0, failureCount: 0, totalCalls: 0, totalTokens: 0 },
};

// ─── 9router Auto-Detection (fire-and-forget on boot) ────────
let nineRouterDetected = false;
let detected9RouterModels: string[] = [];

async function detect9Router(): Promise<void> {
  if (!NINEROUTER_ENABLED) {
    log.info("[aiRouter] 9router disabled via NINEROUTER_ENABLED=false");
    return;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NINEROUTER_DETECT_TIMEOUT_MS);
    const res = await fetch(`${NINEROUTER_ENDPOINT}/models`, {
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: Array<{ id: string; owned_by?: string; capabilities?: Record<string, unknown> }> };
    const models = (data?.data ?? []).map((m) => m.id).filter(Boolean);
    if (models.length > 0) {
      detected9RouterModels = models;
      nineRouterDetected = true;
      providerHealth["9router"].available = true;
      providerHealth["9router"].lastSuccess = Date.now();
      const freeCount = models.filter((id) => id.includes("free") || id.includes(":free")).length;
      log.info(`[aiRouter] 9router terdeteksi — ${models.length} model (${freeCount} free) — ${models.slice(0, 5).join(", ")}${models.length > 5 ? " ..." : ""}`);
    } else {
      log.warn("[aiRouter] 9router merespons tapi tidak ada model");
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.warn(`[aiRouter] 9router tidak terdeteksi (localhost:20128) — using OpenRouter/Gemini saja: ${errMsg}`);
    providerHealth["9router"].lastError = errMsg;
  }
}

// Fire-and-forget detection on module load
detect9Router().catch((e) => log.warn("[aiRouter] 9router detection error:", e));


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
// QA11-F: batas kini PLAN-AWARE — plan dibaca dari User.plan (schema QA10-E).
// Paket "free" mempertahankan batas AI_DAILY_LIMIT yang sama persis
// (default 500) → TIDAK ADA REGRESI bagi user yang sudah ada; pro/team
// hanya MENAMBAH kapasitas (default 2000/10000, env AI_DAILY_LIMIT_PRO/_TEAM).
export interface AIQuotaInfo {
  used: number; // jumlah event AI hari ini (UTC) milik user
  limit: number; // batas plan user (free=AI_DAILY_LIMIT default 500); 0 saat unlimited
  remaining: number; // max(0, limit - used); 0 saat unlimited
  resetsAt: string; // ISO — tengah malam UTC berikutnya
  unlimited: boolean; // true = tidak dibatasi (userId kosong / DB error)
  plan: "free" | "pro" | "team"; // QA11-F: plan yang menentukan limit (transparansi 429)
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
    return { used: 0, limit: 0, remaining: 0, resetsAt, unlimited: true, plan: "free" };
  }

  // QA11-F: batas mengikuti plan user (fail-open "free" — plan tak boleh
  // mematikan fitur; kegagalan baca → unlimited jujur, sama seperti count).
  let plan: "free" | "pro" | "team" = "free";
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
    plan = normalizePlan(user?.plan);
  } catch (error: unknown) {
    log.warn(
      `[aiRouter] gagal membaca plan user (fail-open unlimited): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { used: 0, limit: 0, remaining: 0, resetsAt, unlimited: true, plan };
  }
  const limit = getPlanAiLimit(plan);

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
      plan,
    };
  } catch (error: unknown) {
    // Fail-open JUJUR: bug counting tidak boleh mematikan chat — tapi
    // kegagalan ini WAJIB terlihat di log operator (bukan gagal diam-diam).
    log.warn(
      `[aiRouter] gagal menghitung kuota harian user (fail-open unlimited): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { used: 0, limit: 0, remaining: 0, resetsAt, unlimited: true, plan };
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

/**
 * Model yang BOLEH dipilih user — mencakup:
 *   1. 9router free models (jika terdeteksi)
 *   2. OpenRouter model (primary + fallback)
 *   3. (Gemini model ditambahkan jika dikonfigurasi)
 * Daftar ini digunakan frontend untuk dropdown model picker.
 */
export function getAvailableModels(): AIModelOption[] {
  const models: AIModelOption[] = [];

  // 1. 9router free models (jika terdeteksi) — prioritas utama (gratis, lokal)
  if (nineRouterDetected) {
    const nineModels = detected9RouterModels
      .filter((id) => id.includes("free") || id.includes(":free")) // hanya model FREE
      .map((id) => ({
        id,
        label: id.includes("nvidia") ? id.split("/").pop() ?? id : `9Router · ${id.includes("kc") ? "Kilometer" : id.includes("openrouter") && !id.includes("nvidia") ? "Free" : "Model"}`,
        description: "Model GRATIS dari 9router lokal (cepat, tanpa biaya)",
      }));
    models.push(...nineModels);
  }

  // 2. OpenRouter models (primary + fallback chain)
  models.push(...[OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS]
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .map((id) => ({
      id,
      label: MODEL_LABELS[id]?.label ?? id,
      description: MODEL_LABELS[id]?.description ?? "Model OpenRouter dari konfigurasi server",
    })));

  // 3. Gemini model (jika dikonfigurasi)
  if (GEMINI_API_KEY) {
    models.push({
      id: GEMINI_MODEL,
      label: "Gemini " + GEMINI_MODEL,
      description: "Google Gemini (fallback)",
    });
  }

  return models;
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
  // 9router free models prepended to default chain (user preference takes priority)
  const nineRouterFree = nineRouterDetected
    ? detected9RouterModels.filter((id) => id.includes("free") || id.includes(":free"))
    : [];
  const fullDefaultChain = [...nineRouterFree, ...defaultChain];
  if (!req.model) return fullDefaultChain;
  if (!getAvailableModels().some((m) => m.id === req.model)) {
    log.warn(
      `[aiRouter] model "${req.model}" tidak ada di daftar model yang diizinkan — memakai model default`
    );
    return fullDefaultChain;
  }
  return [req.model, ...fullDefaultChain.filter((m) => m !== req.model)];
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

// ─── 9router Call (LOCAL, FREE) ────────────────────────
async function call9Router(req: AIRequest): Promise<AIResponse> {
  const startTime = Date.now();
  const models = (NINEROUTER_FREE_MODELS.length > 0 ? NINEROUTER_FREE_MODELS : detected9RouterModels)
    .filter((id) => id.includes("free") || id.includes(":free"));

  if (models.length === 0) {
    return { success: false, text: "", provider: "9router", latencyMs: 0, error: "Tidak ada model free 9router tersedia", fallbackUsed: true };
  }

  const messages: OpenRouterMessage[] = [];
  if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
  messages.push({ role: "user", content: req.prompt });

  let lastError = "unknown";
  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
      const res = await fetch(`${NINEROUTER_ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: {"Content-Type": "application/json", "Authorization": `Bearer ${NINEROUTER_API_KEY}`, "HTTP-Referer": OPENROUTER_REFERER, "X-Title": OPENROUTER_TITLE},
        body: JSON.stringify({ model, messages, max_tokens: Math.max(256, req.maxTokens ?? 2048), temperature: req.temperature ?? 0.7, stream: false, reasoning: { enabled: false } }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        throw new Error(`9router HTTP ${res.status} (${model}): ${errText.substring(0, 200)}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }>; usage?: { total_tokens?: number } };
      const text = data?.choices?.[0]?.message?.content || "";
      if (!text.trim()) throw new Error(`9router (${model}) mengembalikan konten kosong`);

      providerHealth["9router"].available = true;
      providerHealth["9router"].lastError = null;
      providerHealth["9router"].lastSuccess = Date.now();
      providerHealth["9router"].failureCount = 0;
      providerHealth["9router"].totalCalls++;
      providerHealth["9router"].totalTokens += data?.usage?.total_tokens || 0;

      recordUsage({ ts: Date.now(), endpoint: req.endpoint || "chat", provider: "9router", model, tokens: data?.usage?.total_tokens || 0, latencyMs: Date.now() - startTime, success: true, streamed: false, userId: req.userId });
      return { success: true, text, provider: "9router", model, tokensUsed: data?.usage?.total_tokens || 0, latencyMs: Date.now() - startTime, fallbackUsed: false };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
      log.warn(`[aiRouter] 9router model "${model}" gagal: ${lastError.substring(0, 120)} — mencoba model berikutnya...`);
    }
  }

  providerHealth["9router"].available = false;
  providerHealth["9router"].lastError = lastError;
  providerHealth["9router"].failureCount++;
  recordUsage({ ts: Date.now(), endpoint: req.endpoint || "chat", provider: "9router", model: models[0], tokens: 0, latencyMs: Date.now() - startTime, success: false, streamed: false, error: lastError.substring(0, 150), userId: req.userId });
  return { success: false, text: "", provider: "9router", model: models[0], latencyMs: Date.now() - startTime, error: lastError, fallbackUsed: true };
}

// ─── Main AI Router (with fallback chain) ─────────────────────
export async function callAI(req: AIRequest): Promise<AIResponse> {
  // Priority 1: 9router local free models (if detected)
  if (nineRouterDetected) {
    const nineResult = await call9Router(req);
    if (nineResult.success) {
      if (req.userId) {
        logAudit(req.userId, "AI_CALL_NINEROUTER", null, true, { model: nineResult.model, tokens: nineResult.tokensUsed, latencyMs: nineResult.latencyMs }).catch(() => {});
      }
      return nineResult;
    }
    log.warn(`[aiRouter] 9router gagal, fallback ke OpenRouter...`);
  }

  // Priority 2: OpenRouter (cloud)
  let openRouterError: string | null = null;
  if (providerHealth["openrouter"].available && OPENROUTER_API_KEY) {
    const result = await callOpenRouter(req);
    if (result.success) {
      if (req.userId) {
        logAudit(req.userId, "AI_CALL_OPENROUTER", null, true, { model: result.model, tokens: result.tokensUsed, latencyMs: result.latencyMs }).catch(() => {});
      }
      return result;
    }
    openRouterError = result.error || "unknown";
    log.warn(`[aiRouter] OpenRouter gagal (${openRouterError}), fallback ke Gemini...`);
  }

  // Priority 3: Gemini (fallback)
  const geminiResult = await callGemini(req);
  if (geminiResult.success) {
    if (req.userId) {
      logAudit(req.userId, "AI_CALL_GEMINI", null, true, { model: geminiResult.model, tokens: geminiResult.tokensUsed, latencyMs: geminiResult.latencyMs, fallback: true }).catch(() => {});
    }
    return geminiResult;
  }

  // All failed
  log.error(`[aiRouter] Semua provider AI gagal. 9router: ${nineRouterDetected ? "tercoba" : "tidak terdeteksi"}, OpenRouter: ${openRouterError}, Gemini: ${geminiResult.error}`);
  return { success: false, text: "", provider: "none", latencyMs: 0, error: "Semua provider AI tidak tersedia.", fallbackUsed: true };
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

  // Priority 1: 9router streaming (if detected)
  if (nineRouterDetected) {
    const models = (NINEROUTER_FREE_MODELS.length > 0 ? NINEROUTER_FREE_MODELS : detected9RouterModels)
      .filter((id) => id.includes("free") || id.includes(":free"));
    if (models.length > 0) {
      const messages: OpenRouterMessage[] = [];
      if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
      messages.push({ role: "user", content: req.prompt });

      let lastStreamError = "unknown";
      for (const model of models) {
        let gotAnyToken = false;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), OPENROUTER_STREAM_TIMEOUT_MS);
        const onClientClose = () => controller.abort();
        req.abortSignal?.addEventListener("abort", onClientClose, { once: true });

        try {
          const res = await fetch(`${NINEROUTER_ENDPOINT}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
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
          clearTimeout(timeout);
          if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => "Unknown");
            throw new Error(`9router HTTP ${res.status}: ${errText.substring(0, 100)}`);
          }
          gotAnyToken = true;
          // Process 9router stream — same SSE pattern as OpenRouter
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let totalTokens = 0;
          let chunksRead = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim() || !line.startsWith("data: ")) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.event === "token" && ev.data?.content) {
                  onEvent({ type: "token", text: ev.data.content, model, provider: "9router" });
                  chunksRead++;
                } else if (ev.event === "done") {
                  totalTokens = ev.data?.usage?.total_tokens ?? totalTokens;
                }
              } catch { /* skip malformed lines */ }
            }
          }
          reader.releaseLock();

          providerHealth["9router"].totalCalls++;
          providerHealth["9router"].totalTokens += totalTokens;
          providerHealth["9router"].lastSuccess = Date.now();

          onEvent({ type: "start", model, provider: "9router" });
          onEvent({
            type: "done",
            model,
            provider: "9router",
            tokensUsed: totalTokens,
            latencyMs: Date.now() - startTime,
          });
          return; // success, done
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          lastStreamError = errMsg;
          log.warn(`[aiRouter] 9router stream "${model}" gagal: ${errMsg.substring(0, 100)}`);
          if (controller.signal.aborted) break;
        } finally {
          clearTimeout(timeout);
          req.abortSignal?.removeEventListener("abort", onClientClose);
        }
      }
      // All 9router stream models failed — fall through to OpenRouter stream
      log.warn(`[aiRouter] 9router stream gagal, fallback ke OpenRouter stream...`);
    }
  }

  // Priority 2: OpenRouter streaming (existing)
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
    "9router": {
      ...providerHealth["9router"],
      endpoint: NINEROUTER_ENDPOINT,
      detected: nineRouterDetected,
      modelCount: detected9RouterModels.length,
      freeModels: detected9RouterModels.filter((id) => id.includes("free") || id.includes(":free")),
      configured: NINEROUTER_ENABLED,
    },
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
    primary: nineRouterDetected ? "9router" : "openrouter",
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

// ─── 9router Connection Test ──────────────────────────────────
export async function test9RouterConnection(): Promise<{ success: boolean; latencyMs: number; models?: string[]; error?: string }> {
  const startTime = Date.now();
  if (!NINEROUTER_ENABLED) {
    return { success: false, latencyMs: 0, error: "9router dinonaktifkan (NINEROUTER_ENABLED=false)" };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NINEROUTER_DETECT_TIMEOUT_MS);
    const res = await fetch(`${NINEROUTER_ENDPOINT}/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (data?.data ?? []).map((m) => m.id);
    if (models.length === 0) {
      return { success: false, latencyMs: Date.now() - startTime, error: "Tidak ada model di 9router" };
    }
    const freeModels = models.filter((id) => id.includes("free") || id.includes(":free"));
    providerHealth["9router"].available = true;
    providerHealth["9router"].lastSuccess = Date.now();
    nineRouterDetected = true;
    detected9RouterModels = models;
    return { success: true, latencyMs: Date.now() - startTime, models: freeModels.length > 0 ? freeModels : models };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    providerHealth["9router"].lastError = errMsg;
    return { success: false, latencyMs: Date.now() - startTime, error: errMsg };
  }
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
