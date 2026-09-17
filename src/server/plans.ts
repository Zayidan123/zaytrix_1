import { createLogger } from "./logger";
import { prisma } from "./db";
import type { Request, Response } from "express";
import { requireAuth } from "./auth"; // sekaligus augmentasi tipe Express req.user

const log = createLogger("plans");

// ============================================================================
// ZAYTRIX — Paket Langganan (Direksi F · QA11-F)
// ----------------------------------------------------------------------------
// Fondasi tier SaaS di atas kolom User.plan (schema QA10-E). Prinsip desain:
//
//   1. TANPA REGRESI: paket "free" mempertahankan batas AI_DAILY_LIMIT yang
//      sama persis seperti sebelum tier ada (default 500/hari) — menambah
//      tier hanya MENAMBAH kapasitas, tidak pernah memotong milik siapa pun.
//   2. JUJUR soal billing: integrasi pembayaran (Stripe/Midtrans/dst.) adalah
//      keputusan bisnis operator dan BELUM tersedia. Endpoint selalu
//      menyatakan billing.available:false — tidak pernah mengklaim bisa
//      "upgrade sendiri" padahal tidak bisa.
//   3. Nilai plan tak dikenal di DB → diperlakukan "free" + field planRaw
//      diekspos apa adanya (tidak didiamkan, tidak difabrikasi).
//   4. Kuota dihitung dari AiUsageEvent (persisten, QA10-E) — sumber tunggal
//      kebenaran yang sama dengan penegakan 429 di chat-stream.
// ============================================================================

export type PlanId = "free" | "pro" | "team";

export interface PlanDefinition {
  id: PlanId;
  label: string;
  /** Batas panggilan AI per hari (UTC). 0 = unlimited. */
  aiDailyLimit: number;
  /** Fitur bertanda — hanya display + kontrak masa depan, bukan gate keras. */
  features: { id: string; label: string; included: boolean }[];
  /** Catatan jujur untuk tampilan tabel perbandingan. */
  note: string;
}

/**
 * Batas free TIDAK di-hardcode: membaca AI_DAILY_LIMIT (default 500) supaya
 * operator yang sudah menyetel env itu (mis. 1000 di VPS) tidak tiba-tiba
 * dipotong ke 500 oleh tier. Env per-tier (AI_DAILY_LIMIT_PRO / _TEAM)
 * memungkinkan penyesuaian tanpa deploy ulang kode.
 */
function envLimit(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    label: "FREE",
    aiDailyLimit: envLimit("AI_DAILY_LIMIT", 500),
    features: [
      { id: "ai-chat", label: "AI Market Chat + memori 16 pesan", included: true },
      { id: "ai-signals", label: "AI Trade Signals (8 endpoint streaming)", included: true },
      { id: "paper", label: "Paper trading $10.000 virtual", included: true },
      { id: "alerts", label: "Alert Telegram / Discord / WhatsApp", included: true },
      { id: "multi-pdf", label: "Analisis multi-dokumen PDF", included: true },
      { id: "history", label: "Riwayat analisis > 7 hari", included: false },
      { id: "priority", label: "Prioritas antrean model saat padat", included: false },
    ],
    note: "Paket bawaan semua akun — kapasitas penuh fitur inti.",
  },
  pro: {
    id: "pro",
    label: "PRO",
    aiDailyLimit: envLimit("AI_DAILY_LIMIT_PRO", 2000),
    features: [
      { id: "ai-chat", label: "Semua fitur FREE", included: true },
      { id: "history", label: "Riwayat analisis > 7 hari", included: true },
      { id: "priority", label: "Prioritas antrean model saat padat", included: true },
      { id: "models", label: "Pilihan model premium (reasoning berat)", included: true },
      { id: "seat", label: "Multi-seat tim (kerja kolaboratif)", included: false },
    ],
    note: "Untuk trader aktif harian — kuota 4× paket FREE.",
  },
  team: {
    id: "team",
    label: "TEAM",
    aiDailyLimit: envLimit("AI_DAILY_LIMIT_TEAM", 10000),
    features: [
      { id: "ai-chat", label: "Semua fitur PRO", included: true },
      { id: "seat", label: "Multi-seat tim (kerja kolaboratif)", included: true },
      { id: "export", label: "Ekspor laporan batch + API akses", included: true },
      { id: "audit", label: "Audit log per-seat untuk kepatuhan", included: true },
    ],
    note: "Untuk tim/desk riset — kuota 20× paket FREE.",
  },
};

/** Nilai plan mentah → PlanId valid. Tak dikenal → "free" (jujur + tercatat). */
export function normalizePlan(raw: unknown): PlanId {
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "free" || v === "pro" || v === "team") return v;
  }
  if (raw !== undefined && raw !== null && raw !== "") {
    // Nilai ada tapi tak dikenal — JANGAN crash/diamkan; catat sekali per nilai.
    log.warn(`[plans] nilai plan tidak dikenal "${String(raw).slice(0, 32)}" → diperlakukan "free"`);
  }
  return "free";
}

/** Batas AI harian untuk plan (pure — dipakai aiRouter agar bebas siklus). */
export function getPlanAiLimit(plan: PlanId): number {
  return PLAN_DEFINITIONS[plan]?.aiDailyLimit ?? PLAN_DEFINITIONS.free.aiDailyLimit;
}

/** Tengah malam UTC berikutnya (ISO) — sama semantik dengan aiRouter. */
function nextUtcMidnightIso(now = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

export interface PlanInfo {
  plan: PlanId;
  planRaw: string | null; // nilai User.plan apa adanya (transparansi)
  label: string;
  aiDailyLimit: number; // 0 = unlimited
  features: PlanDefinition["features"];
  note: string;
}

/** Baca plan user dari DB (fail-open "free" — plan tak boleh mematikan fitur). */
export async function getPlanInfoForUser(userId: string | undefined): Promise<PlanInfo> {
  if (!userId || typeof userId !== "string") {
    const def = PLAN_DEFINITIONS.free;
    return { plan: "free", planRaw: null, label: def.label, aiDailyLimit: def.aiDailyLimit, features: def.features, note: def.note };
  }
  let planRaw: string | null = null;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
    planRaw = user?.plan ?? null;
  } catch (error: unknown) {
    // Fail-open jujur: kegagalan baca plan TIDAK mematikan kuota/fitur —
    // user diperlakukan free (batas 500) dan kegagalan terlihat di log.
    log.warn(
      `[plans] gagal membaca plan user (fail-open free): ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const plan = normalizePlan(planRaw);
  const def = PLAN_DEFINITIONS[plan];
  return { plan, planRaw, label: def.label, aiDailyLimit: def.aiDailyLimit, features: def.features, note: def.note };
}

// ─── Route module ──────────────────────────────────────────────────────
export function registerPlanRoutes(app: import("express").Express) {
  // GET /api/account/plan — paket + batas + kuota hari ini milik user login.
  // Semua field jujur: billing.available selalu false sampai integrasi
  // pembayaran benar-benar ada (keputusan operator — lihat README Roadmap F).
  app.get("/api/account/plan", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user?.sub;
    try {
      const info = await getPlanInfoForUser(userId);

      // Kuota hari ini — sumber kebenaran SAMA dengan penegakan 429 (AiUsageEvent).
      // Gagal hitung → field quota null + errorNote jujur (bukan 0 palsu).
      let quota: { used: number; remaining: number; resetsAt: string } | null = null;
      let quotaError = false;
      try {
        const startOfDayUtc = new Date();
        startOfDayUtc.setUTCHours(0, 0, 0, 0);
        const used = await prisma.aiUsageEvent.count({
          where: { userId, createdAt: { gte: startOfDayUtc } },
        });
        quota = {
          used,
          remaining: Math.max(0, info.aiDailyLimit - used),
          resetsAt: nextUtcMidnightIso(),
        };
      } catch (error: unknown) {
        quotaError = true;
        log.warn(
          `[plans] gagal menghitung kuota harian (ditampilkan null jujur): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      res.json({
        success: true,
        plan: info.plan,
        planRaw: info.planRaw,
        label: info.label,
        aiDailyLimit: info.aiDailyLimit,
        features: info.features,
        note: info.note,
        quota,
        quotaError, // true = angka kuota tidak tersedia saat ini (bukan nol)
        billing: {
          available: false,
          note: "Integrasi pembayaran belum tersedia. Perubahan paket dilakukan operator (lihat docs/DEPLOYMENT.md + scripts/set-plan.mjs).",
        },
      });
    } catch (error: unknown) {
      log.error(`[plans] /api/account/plan gagal: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ success: false, error: "Gagal memuat informasi paket." });
    }
  });
}
