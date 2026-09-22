// =============================================================================
// paperTrading.ts — QA10-B (Direksi D Roadmap — Paper Trading Engine):
// order virtual MARKET-ONLY yang dieksekusi pada harga live saat submit,
// dana virtual $10.000 per user (default schema), murni simulasi LOKAL —
// TIDAK ada order ke bursa nyata, tidak memanggil modul tradeExecution.
// Pola modul mengikuti ronde #9 (lihat signalEngine.ts sebagai referensi):
//   export registerPaperTrading(app: Express) + requireAuth + createLogger
//   + prisma dari ./db + liveAssets (live-binding ESM) dari ./assetsStore.
// Model DB (PaperAccount / PaperOrder / PaperPosition + relasi di User)
// SUDAH dibuat orkestrator di prisma/schema.prisma — modul ini hanya
// menggunakannya, tidak mengubah schema.
// Semua route dilindungi requireAuth (fail-closed, sesi tervalidasi server).
// Respons konsisten aplikasi: {success:true, ...} atau
// {success:false, error:"pesan Indonesia"} dengan status 400/500.
// =============================================================================
import { liveAssets } from "./assetsStore";
import type { Express } from "express";
import { requireAuth } from "./auth";
import { createLogger } from "./logger";
import { prisma } from "./db";

const log = createLogger("paperTrading");

// ── Konstanta simulasi (jujur & terdokumentasi) ────────────────────────────
const PAPER_FEE_RATE = 0.001; // fee simulasi 0,1% × notional
const MAX_ORDER_NOTIONAL_USD = 100000; // guard kejuhujuran simulasi: maks notional per order
const QTY_EPSILON = 0.00000001; // sisa qty ≤ epsilon → baris posisi dihapus
const ORDERS_LIMIT_DEFAULT = 100; // default histori order
const ORDERS_LIMIT_MAX = 200; // maks histori order per permintaan

// ── Pembulatan konsisten ────────────────────────────────────────────────────
// Uang agregat (notional/fee/kas/equity/PnL) → 2 desimal.
// Kuantitas → 8 desimal.
// HARGA memakai pembulatan adaptif mengikuti konvensi signalEngine.ts:
// > 100 → 2 desimal; ≥ 1 → 4 desimal; < 1 → 8 desimal (PEPE/SHIB sub-sen
// tidak boleh terpangkas menjadi 0).
const rUsd = (n: number): number => parseFloat(n.toFixed(2));
const rQty = (n: number): number => parseFloat(n.toFixed(8));
const rPrice = (n: number): number =>
  parseFloat(n.toFixed(n > 100 ? 2 : n >= 1 ? 4 : 8));

// userId dipendekkan untuk log (tanpa PII berlebih — email/nama tidak dicatat)
const shortId = (userId: string): string => userId.slice(0, 8);

// ── Error pengguna (→ 400) vs error server (→ 500) ─────────────────────────
class PaperUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperUserError";
  }
}

// Cari harga live aset KRIPTO by symbol (case-insensitive). Null bila aset
// tidak ada di registry atau harganya bukan angka positif — order ditolak
// jujur dengan 400 (tidak pernah difabrikasi).
function findLiveCryptoPrice(symbol: string): { price: number; isStale: boolean } | null {
  const asset = liveAssets.find(
    (a: any) =>
      typeof a?.symbol === "string" &&
      a.symbol.toUpperCase() === symbol &&
      a.category === "crypto"
  );
  const price = typeof asset?.price === "number" ? asset.price : NaN;
  if (!asset || !Number.isFinite(price) || price <= 0) return null;
  // isStale = aset hilang dari registry ATAU harga live memang basi
  // (assetsStore menandai sumber data gagal — DATA-4, harga terakhir nyata).
  return { price, isStale: asset.isStale === true };
}

// ── Ringkasan akun + equity pada harga live saat ini ────────────────────────
// Posisi yang harga live-nya tidak ketemu dihitung pada HARGA BIAYA (avg)
// supaya equity tidak difabrikasi naik/turun; /api/paper/positions menandai
// baris tersebut isStale supaya UI jujur menampilkan harga tidak tersedia.
async function buildAccountSummary(userId: string) {
  const account = await prisma.paperAccount.upsert({
    where: { userId },
    update: {}, // auto-create akun default $10.000 saat pertama kali diakses
    create: { userId },
  });
  const positions = await prisma.paperPosition.findMany({ where: { userId } });

  let positionsValueUsd = 0;
  for (const p of positions) {
    const live = findLiveCryptoPrice(p.symbol.toUpperCase());
    positionsValueUsd += p.quantity * (live ? live.price : p.avgPriceUsd);
  }
  positionsValueUsd = rUsd(positionsValueUsd);

  const equityUsd = rUsd(account.cashUsd + positionsValueUsd);
  const totalPnlUsd = rUsd(equityUsd - account.startingUsd);
  const totalPnlPct =
    account.startingUsd > 0
      ? parseFloat(((totalPnlUsd / account.startingUsd) * 100).toFixed(2))
      : 0;

  return {
    cashUsd: rUsd(account.cashUsd),
    startingUsd: rUsd(account.startingUsd),
    equityUsd,
    positionsValueUsd,
    totalPnlUsd,
    totalPnlPct,
  };
}

// ── Registrasi route ────────────────────────────────────────────────────────
export function registerPaperTrading(app: Express): void {
  // -----------------------------------------------------------------------
  // GET /api/paper/account — auto-create akun (upsert default $10.000) +
  // equity = kas + Σ(posisi × harga live saat ini) + PnL total.
  // -----------------------------------------------------------------------
  app.get("/api/paper/account", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Autentikasi diperlukan." });
      }
      const summary = await buildAccountSummary(userId);
      return res.json({
        success: true,
        account: summary,
        asOf: new Date().toISOString(),
      });
    } catch (err: any) {
      log.error("[account] gagal memuat ringkasan paper trading:", err?.message || err);
      return res.status(500).json({ success: false, error: "Gagal memuat akun paper trading." });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/paper/positions — posisi di-join harga live (PnL live),
  // diurutkan berdasar nilai pasar terbesar. Baris dengan harga live tidak
  // ketemu → isStale:true + nilai live null (jujur, bukan 0).
  // -----------------------------------------------------------------------
  app.get("/api/paper/positions", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Autentikasi diperlukan." });
      }
      const positions = await prisma.paperPosition.findMany({ where: { userId } });

      const rows = positions.map((p) => {
        const live = findLiveCryptoPrice(p.symbol.toUpperCase());
        const realizedPnlUsd = rUsd(p.realizedPnlUsd);
        if (!live) {
          return {
            symbol: p.symbol,
            quantity: rQty(p.quantity),
            avgPriceUsd: rPrice(p.avgPriceUsd),
            livePriceUsd: null,
            marketValueUsd: null,
            unrealizedPnlUsd: null,
            unrealizedPnlPct: null,
            realizedPnlUsd,
            isStale: true,
          };
        }
        const marketValueUsd = rUsd(p.quantity * live.price);
        const unrealizedPnlUsd = rUsd((live.price - p.avgPriceUsd) * p.quantity);
        const costUsd = p.avgPriceUsd * p.quantity;
        const unrealizedPnlPct =
          costUsd > 0
            ? parseFloat(((unrealizedPnlUsd / costUsd) * 100).toFixed(2))
            : 0;
        return {
          symbol: p.symbol,
          quantity: rQty(p.quantity),
          avgPriceUsd: rPrice(p.avgPriceUsd),
          livePriceUsd: rPrice(live.price),
          marketValueUsd,
          unrealizedPnlUsd,
          unrealizedPnlPct,
          realizedPnlUsd,
          isStale: live.isStale,
        };
      });

      // Nilai pasar terbesar dulu; baris stale (harga tidak ketemu) di akhir.
      rows.sort((a, b) => (b.marketValueUsd ?? -1) - (a.marketValueUsd ?? -1));

      return res.json({ success: true, positions: rows });
    } catch (err: any) {
      log.error("[positions] gagal memuat posisi paper:", err?.message || err);
      return res.status(500).json({ success: false, error: "Gagal memuat posisi paper trading." });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/paper/orders?limit=100 — histori order terbaru dulu.
  // Validasi manual limit (konvensi rute /level logger.ts, tanpa dependency
  // validasi baru): default 100, jinjak 1..200.
  // -----------------------------------------------------------------------
  app.get("/api/paper/orders", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Autentikasi diperlukan." });
      }
      const limitRaw = parseInt(String(req.query.limit ?? ORDERS_LIMIT_DEFAULT), 10);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(limitRaw, ORDERS_LIMIT_MAX))
        : ORDERS_LIMIT_DEFAULT;

      const orders = await prisma.paperOrder.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return res.json({ success: true, orders, limit });
    } catch (err: any) {
      log.error("[orders] gagal memuat histori order paper:", err?.message || err);
      return res.status(500).json({ success: false, error: "Gagal memuat histori order paper." });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/paper/order — eksekusi order virtual MARKET-ONLY di harga live
  // SAAT INI. Body: {symbol, side, quantity}.
  // Validasi manual ketat (tanpa zod — konvensi logger.ts):
  //   symbol  : string, 2-10 karakter setelah trim
  //   side    : "BUY"|"SELL" (case-insensitive → dinormalisasi)
  //   quantity: number > 0, finite, bukan NaN
  // Guard kejuhujuran simulasi: maks notional per order $100.000 + fee 0,1%.
  // BUY : (notional+fee) ≤ kas else 400 "Kas virtual tidak cukup…"
  // SELL: quantity ≤ posisi else 400
  // Semua penulisan dalam prisma.$transaction (akun + order + posisi).
  // -----------------------------------------------------------------------
  app.post("/api/paper/order", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Autentikasi diperlukan." });
      }
      const body =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};

      // ── Validasi manual ketat ──
      if (typeof body.symbol !== "string") {
        return res.status(400).json({ success: false, error: "Symbol wajib berupa string." });
      }
      const symbol = body.symbol.trim().toUpperCase();
      if (symbol.length < 2 || symbol.length > 10) {
        return res.status(400).json({
          success: false,
          error: `Symbol tidak valid: panjang harus 2-10 karakter (diterima "${symbol.slice(0, 12)}").`,
        });
      }

      const side = typeof body.side === "string" ? body.side.trim().toUpperCase() : "";
      if (side !== "BUY" && side !== "SELL") {
        return res.status(400).json({
          success: false,
          error: `Side tidak valid: gunakan "BUY" atau "SELL" (diterima "${String(body.side).slice(0, 12)}").`,
        });
      }

      const quantity = body.quantity;
      if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: "Quantity harus berupa angka lebih besar dari 0.",
        });
      }

      // ── Harga live SAAT INI (jujur: tolak bila tidak tersedia) ──
      const live = findLiveCryptoPrice(symbol);
      if (!live) {
        return res.status(400).json({
          success: false,
          error: `Harga live untuk ${symbol} tidak tersedia saat ini — order tidak dapat dieksekusi.`,
        });
      }
      const price = live.price;

      // ── Notional + fee + guard kejuhujuran simulasi ──
      const notionalUsd = rUsd(price * quantity);
      if (notionalUsd <= 0) {
        return res.status(400).json({
          success: false,
          error: "Notional order terlalu kecil untuk direkam (minimum $0,01).",
        });
      }
      if (notionalUsd > MAX_ORDER_NOTIONAL_USD) {
        return res.status(400).json({
          success: false,
          error: `Notional order $${notionalUsd.toLocaleString("en-US")} melebihi batas simulasi $${MAX_ORDER_NOTIONAL_USD.toLocaleString("en-US")} per order.`,
        });
      }
      const feeUsd = rUsd(notionalUsd * PAPER_FEE_RATE);

      // ── Eksekusi dalam SATU transaksi (konsistensi akun+order+posisi) ──
      const executed = await prisma.$transaction(async (tx) => {
        const account = await tx.paperAccount.upsert({
          where: { userId },
          update: {},
          create: { userId },
        });
        const position = await tx.paperPosition.findUnique({
          where: { userId_symbol: { userId, symbol } },
        });

        if (side === "BUY") {
          const costUsd = rUsd(notionalUsd + feeUsd);
          if (costUsd > account.cashUsd) {
            throw new PaperUserError(
              `Kas virtual tidak cukup: butuh $${costUsd.toFixed(2)} (termasuk fee $${feeUsd.toFixed(2)}), tersedia $${account.cashUsd.toFixed(2)}.`
            );
          }
          const oldQty = position?.quantity ?? 0;
          const oldAvg = position?.avgPriceUsd ?? 0;
          const newQty = rQty(oldQty + quantity);
          // Rata-rata tertimbang: avgBaru = (qtyLama×avgLama + q×harga) / qtyBaru
          const newAvg = rPrice((oldQty * oldAvg + quantity * price) / newQty);

          const order = await tx.paperOrder.create({
            data: {
              userId,
              symbol,
              side,
              quantity: rQty(quantity),
              priceUsd: rPrice(price),
              notionalUsd,
              feeUsd,
              status: "FILLED",
            },
          });
          const newPosition = await tx.paperPosition.upsert({
            where: { userId_symbol: { userId, symbol } },
            update: { quantity: newQty, avgPriceUsd: newAvg },
            create: { userId, symbol, quantity: newQty, avgPriceUsd: newAvg },
          });
          const updatedAccount = await tx.paperAccount.update({
            where: { userId },
            data: { cashUsd: rUsd(account.cashUsd - costUsd) },
          });
          return { order, position: newPosition, account: updatedAccount };
        }

        // ── SELL ──
        const heldQty = position?.quantity ?? 0;
        if (!position || quantity > heldQty + QTY_EPSILON) {
          throw new PaperUserError(
            `Posisi ${symbol} tidak cukup: diminta ${quantity}, tersedia ${rQty(heldQty)}.`
          );
        }
        const avg = position.avgPriceUsd;
        // realizedPnl += (harga − avg) × q
        const realizedDelta = rUsd((price - avg) * quantity);
        const realizedPnlUsd = rUsd(position.realizedPnlUsd + realizedDelta);
        const newQty = rQty(heldQty - quantity);
        const proceedsUsd = rUsd(notionalUsd - feeUsd);

        const order = await tx.paperOrder.create({
          data: {
            userId,
            symbol,
            side,
            quantity: rQty(quantity),
            priceUsd: rPrice(price),
            notionalUsd,
            feeUsd,
            status: "FILLED",
          },
        });

        let newPosition = null;
        if (newQty <= QTY_EPSILON) {
          // Posisi habis → hapus baris (konvensi spec)
          await tx.paperPosition.delete({ where: { userId_symbol: { userId, symbol } } });
        } else {
          newPosition = await tx.paperPosition.update({
            where: { userId_symbol: { userId, symbol } },
            data: { quantity: newQty, realizedPnlUsd },
          });
        }
        const updatedAccount = await tx.paperAccount.update({
          where: { userId },
          data: { cashUsd: rUsd(account.cashUsd + proceedsUsd) },
        });
        return { order, position: newPosition, account: updatedAccount };
      });

      // Log order TANPA PII berlebih: userId dipendekkan + symbol + side + qty.
      log.info(
        `[order] user=${shortId(userId)} ${side} ${rQty(quantity)} ${symbol} @ $${rPrice(price)} fee=$${feeUsd.toFixed(2)} — virtual, tidak ada order bursa nyata`
      );

      // Respons membawa ringkasan akun TERBARU (equity pasca-eksekusi).
      const summary = await buildAccountSummary(userId);
      return res.json({
        success: true,
        order: {
          id: executed.order.id,
          symbol: executed.order.symbol,
          side: executed.order.side,
          quantity: executed.order.quantity,
          priceUsd: executed.order.priceUsd,
          notionalUsd: executed.order.notionalUsd,
          feeUsd: executed.order.feeUsd,
          status: executed.order.status,
          createdAt: executed.order.createdAt,
        },
        position: executed.position
          ? {
              symbol: executed.position.symbol,
              quantity: executed.position.quantity,
              avgPriceUsd: executed.position.avgPriceUsd,
              realizedPnlUsd: executed.position.realizedPnlUsd,
            }
          : null,
        account: summary,
        asOf: new Date().toISOString(),
      });
    } catch (err: any) {
      // Error pengguna (kas kurang / posisi kurang) → 400 dengan pesan Indonesia.
      if (err instanceof PaperUserError) {
        return res.status(400).json({ success: false, error: "Data perdagangan tidak valid. Silakan periksa kembali input Anda." });
      }
      log.error("[order] gagal mengeksekusi order paper:", err?.message || err);
      return res.status(500).json({ success: false, error: "Gagal mengeksekusi order virtual." });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/paper/reset — kembalikan akun ke startingUsd + hapus semua
  // order & posisi milik user (satu prisma.$transaction). Respons membawa
  // ringkasan akun baru.
  // -----------------------------------------------------------------------
  app.post("/api/paper/reset", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ success: false, error: "Autentikasi diperlukan." });
      }

      const cleared = await prisma.$transaction(async (tx) => {
        const account = await tx.paperAccount.upsert({
          where: { userId },
          update: {},
          create: { userId },
        });
        const delOrders = await tx.paperOrder.deleteMany({ where: { userId } });
        const delPositions = await tx.paperPosition.deleteMany({ where: { userId } });
        const reset = await tx.paperAccount.update({
          where: { userId },
          data: { cashUsd: account.startingUsd },
        });
        return {
          orders: delOrders.count,
          positions: delPositions.count,
          startingUsd: rUsd(reset.startingUsd),
          cashUsd: rUsd(reset.cashUsd),
        };
      });

      log.info(
        `[reset] user=${shortId(userId)} — ${cleared.orders} order & ${cleared.positions} posisi virtual dihapus, kas kembali ke $${cleared.startingUsd.toFixed(2)}`
      );

      return res.json({
        success: true,
        account: {
          cashUsd: cleared.cashUsd,
          startingUsd: cleared.startingUsd,
          equityUsd: cleared.cashUsd,
          positionsValueUsd: 0,
          totalPnlUsd: 0,
          totalPnlPct: 0,
        },
        cleared: { orders: cleared.orders, positions: cleared.positions },
        asOf: new Date().toISOString(),
      });
    } catch (err: any) {
      log.error("[reset] gagal mereset akun paper:", err?.message || err);
      return res.status(500).json({ success: false, error: "Gagal mereset akun paper trading." });
    }
  });
} // end registerPaperTrading
