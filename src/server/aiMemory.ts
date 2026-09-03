// =============================================================================
// aiMemory.ts — QA10-E (Ronde #10, Direksi B: AI expansion)
// Memori percakapan AI per-user: riwayat chat persisten (model ChatMessage)
// + daftar model yang dipilih user (dari aiRouter) + endpoint hapus riwayat.
//
// Pola modul ronde #9: TIDAK memakai Router terpisah — cukup
// `registerAiMemoryRoutes(app)` yang dipanggil server.ts (komposisi root)
// SEBELUM handler 404 /api dan SPA catch-all.
//
// Helper di file ini (getRecentChatHistory / saveChatMessage /
// clearChatHistory) adalah KONTRAK untuk orkestrator server.ts:
// route /api/ai/chat-stream memanggil mereka untuk memberi konteks 16 pesan
// terakhir + menyimpan prompt user & jawaban assistant per request.
//
// Ketahanan: SEMUA helper DB bersifat best-effort — kegagalan DB TIDAK
// boleh mematikan jalur chat utama (log jujur + return kosong / no-op).
// =============================================================================
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { createLogger } from "./logger";
import { prisma } from "./db";
import { getAvailableModels } from "./aiRouter";

const log = createLogger("aiMemory");

// Batas konteks yang dikirim ke AI per request (pesan terakhir, kronologis).
export const CHAT_CONTEXT_LIMIT = 16;
// Batas jumlah pesan riwayat yang dikirim ke frontend (GET /api/ai/history).
const HISTORY_ROUTE_LIMIT = 50;
// Kap panjang konten satu pesan sebelum disimpan (anti-bloat SQLite).
const MAX_MESSAGE_CHARS = 20_000;

// ─── Helper (kontrak orkestrator server.ts) ─────────────────────────────

/**
 * Ambil `limit` pesan chat terakhir milik user lalu urutkan ASC (kronologis)
 * — siap disisipkan sebagai konteks percakapan ke AI.
 *
 * Guard kejujuran: userId kosong → []. Error DB → log + [] (chat TIDAK
 * boleh mati hanya karena baca memori gagal).
 */
export async function getRecentChatHistory(
  userId: string,
  limit = CHAT_CONTEXT_LIMIT
): Promise<{ role: string; content: string }[]> {
  if (!userId || typeof userId !== "string") return [];
  const take = Math.min(Math.max(1, Math.floor(limit)), 100);
  try {
    const rows = await prisma.chatMessage.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], // terbaru dulu
      take,
      select: { role: true, content: true },
    });
    // Balik ke kronologis (ASC) — urutan percakapan alami untuk prompt AI.
    return rows
      .slice()
      .reverse()
      .map((r) => ({ role: r.role, content: r.content }));
  } catch (error: unknown) {
    log.warn(
      `[aiMemory] gagal membaca riwayat chat (lanjut tanpa memori): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  }
}

/**
 * Simpan satu pesan chat (fire-and-forget — TIDAK di-await pemanggilnya).
 * Content di-trim + cap 20.000 char; userId kosong / content kosong → no-op.
 * Error DB ditelan dengan log (penulisan memori tidak boleh menggagalkan
 * respons chat).
 */
export function saveChatMessage(
  userId: string | undefined,
  role: "user" | "assistant",
  content: string,
  model?: string
): void {
  if (!userId || typeof userId !== "string") return; // tanpa identitas → no-op
  const trimmed = typeof content === "string" ? content.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  if (!trimmed) return; // tidak ada isi → tidak ada yang layak disimpan
  prisma
    .chatMessage
    .create({
      data: {
        userId,
        role, // "user" | "assistant" — skema String, divalidasi di sini
        content: trimmed,
        model: model ?? null,
      },
    })
    .catch((error: unknown) => {
      log.warn(
        `[aiMemory] gagal menyimpan pesan chat (fire-and-forget): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
}

/**
 * Hapus seluruh riwayat chat milik user. Return jumlah baris terhapus.
 * (Error DB dibiarkan lempar — pemanggil route menangkap → 500 jujur.)
 */
export async function clearChatHistory(userId: string): Promise<number> {
  const result = await prisma.chatMessage.deleteMany({ where: { userId } });
  return result.count;
}

// ─── Routes ─────────────────────────────────────────────────────────────

/**
 * Daftarkan route memori AI (semua requireAuth):
 *   GET    /api/ai/history → {success, messages:[{id,role,content,model,createdAt}]} (max 50, ASC)
 *   DELETE /api/ai/history → {success, deleted:n}
 *   GET    /api/ai/models  → {success, models:getAvailableModels()} (dari aiRouter)
 */
export function registerAiMemoryRoutes(app: Express): void {
  // Riwayat percakapan per-user (paling lama → terbaru).
  app.get("/api/ai/history", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Autentikasi diperlukan." });
    }
    try {
      // Ambil 50 pesan TERAKHIR (desc) lalu balik ke ASC — jendela "max 50
      // ASC" tetap menampilkan percakapan terbaru user, bukan yang tertua.
      const rows = await prisma.chatMessage.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: HISTORY_ROUTE_LIMIT,
        select: { id: true, role: true, content: true, model: true, createdAt: true },
      });
      rows.reverse();
      res.json({
        success: true,
        messages: rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          model: r.model ?? undefined,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    } catch (error: unknown) {
      log.error(
        `[aiMemory] GET /api/ai/history gagal: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return res.status(500).json({
        success: false,
        error: "Gagal memuat riwayat percakapan dari database.",
      });
    }
  });

  // Hapus seluruh riwayat percakapan milik user yang login.
  app.delete("/api/ai/history", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Autentikasi diperlukan." });
    }
    try {
      const deleted = await clearChatHistory(userId);
      log.info(`[aiMemory] riwayat chat user ${userId.slice(0, 8)}… dihapus (${deleted} pesan)`);
      res.json({ success: true, deleted });
    } catch (error: unknown) {
      log.error(
        `[aiMemory] DELETE /api/ai/history gagal: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return res.status(500).json({
        success: false,
        error: "Gagal menghapus riwayat percakapan dari database.",
      });
    }
  });

  // Daftar model AI yang diizinkan (label ramah + deskripsi) — frontend
  // memakainya untuk pemilih model per request. Diambil dari konfigurasi
  // aiRouter (primary + fallback) supaya tidak pernah ada id karangan.
  app.get("/api/ai/models", requireAuth, (_req: Request, res: Response) => {
    res.json({ success: true, models: getAvailableModels() });
  });

  log.info("[aiMemory] route memori AI terpasang (GET/DELETE /api/ai/history, GET /api/ai/models).");
}
