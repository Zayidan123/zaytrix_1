import { createLogger } from "./logger";
const log = createLogger("portfolio");

// ZAYTRIX portfolio/ledger/backtest/conversion/alert persistence (SEC2-DATA).
// All endpoints require authentication. Data is scoped to the authenticated user.
// The frontend store (store.ts) syncs to these endpoints on login and on change.

import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "./db";
import { requireAuth } from "./auth";
import { logAudit } from "./audit";

export const portfolioRouter = Router();
portfolioRouter.use(requireAuth);

// ─── FIX-B-1: Zod input schemas (reject NaN + negatives + oversized strings) ───
// Previously these POST endpoints used bare parseFloat() with only "not null"
// checks, which silently accepted NaN and NEGATIVE values. Now we validate every
// inbound body before it touches Prisma.
const holdingSchema = z.object({
  symbol: z.string().min(1).max(20),
  category: z.string().min(1).max(30),
  purchasePrice: z.number().positive().finite(),
  quantity: z.number().positive().finite(),
  notes: z.string().max(2000).optional(),
  id: z.string().max(100).optional(),
});

const ledgerTxSchema = z.object({
  type: z.string().min(1).max(20),
  symbol: z.string().min(1).max(20),
  quantity: z.number().positive().finite(),
  price: z.number().nonnegative().finite(),
  totalAmount: z.number().nonnegative().finite().optional(),
  feePaidUsd: z.number().nonnegative().finite().optional(),
  notes: z.string().max(2000).optional(),
  timestamp: z.string().max(60).optional(),
  id: z.string().max(100).optional(),
});

const conversionSchema = z.object({
  fromSymbol: z.string().min(1).max(20),
  fromAmount: z.number().positive().finite(),
  toSymbol: z.string().min(1).max(20),
  toAmount: z.number().positive().finite(),
  rate: z.number().positive().finite(),
  timestamp: z.string().max(60).optional(),
});

const alertSchema = z.object({
  symbol: z.string().min(1).max(20),
  condition: z.string().min(1).max(20),
  targetPrice: z.number().positive().finite(),
  createdAt: z.string().max(60).optional(),
  id: z.string().max(100).optional(),
});

const ledgerSyncSchema = z.object({
  transactions: z
    .array(ledgerTxSchema)
    .max(1000, { message: "Maksimal 1000 transaksi per sinkronisasi ledger." }),
});

const conversionsSyncSchema = z.object({
  conversions: z
    .array(conversionSchema)
    .max(1000, { message: "Maksimal 1000 konversi per sinkronisasi." }),
});

const backtestResultSchema = z.object({
  symbol: z.string().min(1).max(20),
  strategy: z.string().min(1).max(50),
  startDate: z.string().max(10).optional(),
  endDate: z.string().max(10).optional(),
  initialCapital: z.number().finite().nonnegative(),
  finalCapital: z.number().finite().nonnegative(),
  totalReturn: z.number().finite(),
  sharpeRatio: z.number().finite().nullable().optional(),
  maxDrawdown: z.number().finite().nullable().optional(),
  winRate: z.number().finite().min(0).max(1).nullable().optional(),
  totalTrades: z.number().int().min(0).optional(),
  equityCurve: z.array(z.record(z.string(), z.number())).optional(),
});

// SEC-23: the bulk-sync endpoint previously spread the ENTIRE client array
// straight into a $transaction with `String(h.symbol || "")` +
// `parseFloat(...) || 0` coercion — accepting ANY shape, NaN, negatives,
// and unbounded array sizes (one request could create thousands of rows).
const holdingsSyncSchema = z.object({
  holdings: z
    .array(
      z.object({
        symbol: z.string().min(1).max(20).regex(/^[A-Za-z0-9.\-_ ]+$/, {
          message: "Simbol hanya boleh alfanumerik, titik, strip, garis bawah, spasi.",
        }),
        category: z.string().min(1).max(30).regex(/^[A-Za-z0-9.\-_ ]+$/, {
          message: "Kategori hanya boleh alfanumerik, titik, strip, garis bawah, spasi.",
        }),
        purchasePrice: z.number().finite().nonnegative(),
        quantity: z.number().finite().nonnegative(),
        notes: z.string().max(2000).nullable().optional(),
        id: z.string().max(100).optional(),
      })
    )
    .max(200, { message: "Maksimal 200 holding per sinkronisasi." }),
});

/** FIX-B-1: tiny helper — parse + flatten zod error into a single message string. */
function zodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

// ─── PORTFOLIO HOLDINGS ──────────────────────────────────────────────

// GET /api/portfolio/holdings — list current user's holdings
portfolioRouter.get("/holdings", async (req: Request, res: Response) => {
  try {
    const holdings = await prisma.portfolioHolding.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, holdings });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal memuat portofolio." });
  }
});

// POST /api/portfolio/holdings — create a holding (replaces addHolding)
portfolioRouter.post("/holdings", async (req: Request, res: Response) => {
  try {
    // FIX-B-1: validate body with zod — rejects NaN/negative/oversized values.
    const parsed = holdingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
    }
    const { symbol, category, purchasePrice, quantity, notes, id } = parsed.data;
    const holding = await prisma.portfolioHolding.create({
      data: {
        id: id || undefined,
        userId: req.user!.sub,
        symbol, category,
        purchasePrice,
        quantity,
        notes: notes || null,
      },
    });
    await logAudit(req.user!.sub, "PORTFOLIO_HOLDING_ADD", req, true, { symbol, quantity });
    res.json({ success: true, holding });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal menyimpan holding." });
  }
});

// DELETE /api/portfolio/holdings/:id
portfolioRouter.delete("/holdings/:id", async (req: Request, res: Response) => {
  try {
    await prisma.portfolioHolding.delete({
      where: { id: req.params.id, userId: req.user!.sub },
    });
    await logAudit(req.user!.sub, "PORTFOLIO_HOLDING_REMOVE", req, true, { id: req.params.id });
    res.json({ success: true });
  } catch (e: any) {
    res.status(404).json({ success: false, error: "Holding tidak ditemukan." });
  }
});

// POST /api/portfolio/holdings/sync — bulk replace (full sync from client)
portfolioRouter.post("/holdings/sync", async (req: Request, res: Response) => {
  try {
    // SEC-23: validate the array with zod BEFORE touching Prisma — max 200
    // items, symbol/category charset, finite non-negative amounts. Previously
    // this endpoint accepted an unbounded array of arbitrary shapes.
    const parsed = holdingsSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
    }
    const holdings = parsed.data.holdings;
    // Replace all holdings for this user (transactional delete+create)
    await prisma.$transaction([
      prisma.portfolioHolding.deleteMany({ where: { userId: req.user!.sub } }),
      ...holdings.map((h) => prisma.portfolioHolding.create({
        data: {
          id: h.id || undefined,
          userId: req.user!.sub,
          symbol: h.symbol,
          category: h.category,
          purchasePrice: h.purchasePrice,
          quantity: h.quantity,
          notes: h.notes || null,
        },
      })),
    ]);
    res.json({ success: true, count: holdings.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal sinkronisasi portofolio." });
  }
});

// ─── LEDGER TRANSACTIONS ─────────────────────────────────────────────

portfolioRouter.get("/ledger", async (req: Request, res: Response) => {
  try {
    const txs = await prisma.ledgerTransaction.findMany({
      where: { userId: req.user!.sub },
      orderBy: { timestamp: "desc" },
    });
    res.json({ success: true, transactions: txs });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal memuat ledger." });
  }
});

portfolioRouter.post("/ledger", async (req: Request, res: Response) => {
  try {
    // FIX-B-1: validate body with zod — rejects NaN/negative/oversized values.
    const parsed = ledgerTxSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
    }
    const { id, timestamp, type, symbol, quantity, price, totalAmount, feePaidUsd, notes } = parsed.data;
    const tx = await prisma.ledgerTransaction.create({
      data: {
        id: id || undefined,
        userId: req.user!.sub,
        timestamp: timestamp || new Date().toISOString(),
        type, symbol,
        quantity,
        price,
        totalAmount: totalAmount ?? quantity * price,
        feePaidUsd: feePaidUsd ?? 0,
        notes: notes || null,
      },
    });
    await logAudit(req.user!.sub, "LEDGER_TX_ADD", req, true, { type, symbol, quantity });
    res.json({ success: true, transaction: tx });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal menyimpan transaksi." });
  }
});

portfolioRouter.delete("/ledger/:id", async (req: Request, res: Response) => {
  try {
    await prisma.ledgerTransaction.delete({
      where: { id: req.params.id, userId: req.user!.sub },
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(404).json({ success: false, error: "Transaksi tidak ditemukan." });
  }
});

portfolioRouter.post("/ledger/sync", async (req: Request, res: Response) => {
  try {
    const parsed = ledgerSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
    }
    const transactions = parsed.data.transactions;
    await prisma.$transaction([
      prisma.ledgerTransaction.deleteMany({ where: { userId: req.user!.sub } }),
      ...transactions.map((t) => prisma.ledgerTransaction.create({
        data: {
          userId: req.user!.sub,
          timestamp: t.timestamp || new Date().toISOString(),
          type: t.type,
          symbol: t.symbol,
          quantity: t.quantity,
          price: t.price,
          totalAmount: t.totalAmount ?? t.quantity * t.price,
          feePaidUsd: t.feePaidUsd ?? 0,
          notes: t.notes || null,
          id: t.id || undefined,
        },
      })),
    ]);
    res.json({ success: true, count: transactions.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal sinkronisasi ledger." });
  }
});

// ============================================================================
// NEW FEATURE: Tax Lot Optimizer (FIFO / LIFO / HIFO)
// ----------------------------------------------------------------------------
// GET /api/portfolio/tax-lots?method=FIFO&symbol=BTC&sellQuantity=0.2&sellPrice=95000
//
// Computes the realized P&L + remaining tax lots for a hypothetical sale of
// `sellQuantity` units of `symbol` at `sellPrice`, using one of three lot-
// identification methods:
//   - FIFO (First In First Out): oldest lots sold first → highest short-term
//     gains in rising markets (conservative for tax)
//   - LIFO (Last In First Out): newest lots sold first → tends to realize
//     smaller gains (or larger losses) — useful in down markets
//   - HIFO (Highest In First Out): highest-cost lots sold first → minimizes
//     realized gains (most tax-efficient in rising markets)
//
// Indonesian context: PMK-68 applies 0.1% final income tax on crypto
// transactions (transaction-based, not lot-based), but lot tracking is still
// essential for capital-gains accounting in jurisdictions that tax gains.
// ============================================================================

interface TaxLot {
  lotId: string;
  acquiredAt: string;
  quantity: number;
  costBasisUsd: number; // total cost for this lot (price × qty)
  costPerUnitUsd: number;
}

interface SaleLot {
  lotId: string;
  acquiredAt: string;
  quantitySold: number;
  costBasisUsd: number;
  proceedsUsd: number;
  gainLossUsd: number;
  holdingPeriodDays: number;
  isShortTerm: boolean; // < 365 days = short-term
}

interface TaxLotResult {
  method: string;
  symbol: string;
  sellQuantity: number;
  sellPrice: number;
  totalProceedsUsd: number;
  totalCostBasisUsd: number;
  totalGainLossUsd: number;
  totalGainLossPct: number;
  shortTermGainLossUsd: number;
  longTermGainLossUsd: number;
  saleLots: SaleLot[];
  remainingLots: TaxLot[];
  totalRemainingQuantity: number;
  totalRemainingCostBasis: number;
  estimatedTaxIdr: number | null; // PMK-68 0.1% on proceeds; null = kurs USD/IDR unavailable (DATA-24)
  notes: string[];
}

const PMK_68_TAX_RATE = 0.001; // 0.1% Indonesian crypto transaction tax

// ---------------------------------------------------------------------------
// DATA-24: live USD→IDR rate (replaces the hardcoded 15,800 which was wrong
// by ~2,700 IDR at the time of the audit). Fetched from open.er-api.com with
// a 1-hour in-module cache + in-flight dedup. If the rate is unavailable we
// return null and the tax estimate is honestly omitted (never a wrong
// number). A short-lived negative cache avoids hammering a dead upstream.
// ---------------------------------------------------------------------------
const USD_IDR_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const USD_IDR_FETCH_TIMEOUT_MS = 6000;
let usdIdrCache: { rate: number; ts: number } | null = null;
let usdIdrFailedAt = 0; // last failure ts (retry after 60s)
let usdIdrInflight: Promise<number | null> | null = null;

async function fetchUsdIdrRate(): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USD_IDR_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const rate = typeof data?.rates?.IDR === "number" ? data.rates.IDR : parseFloat(data?.rates?.IDR);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return rate;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getUsdIdrRate(): Promise<number | null> {
  if (usdIdrCache && Date.now() - usdIdrCache.ts < USD_IDR_CACHE_TTL_MS) {
    return usdIdrCache.rate;
  }
  // Back off for 60s after a failure so a dead upstream isn't re-queried
  // on every tax-lots request.
  if (!usdIdrCache && Date.now() - usdIdrFailedAt < 60 * 1000) {
    return null;
  }
  if (usdIdrInflight) return usdIdrInflight; // dedup concurrent callers
  usdIdrInflight = (async () => {
    const rate = await fetchUsdIdrRate();
    if (rate !== null) {
      usdIdrCache = { rate, ts: Date.now() };
    } else {
      usdIdrFailedAt = Date.now();
    }
    return rate;
  })();
  try {
    return await usdIdrInflight;
  } finally {
    usdIdrInflight = null;
  }
}

portfolioRouter.get("/tax-lots", async (req: Request, res: Response) => {
  try {
    const method = typeof req.query.method === "string" && ["FIFO", "LIFO", "HIFO"].includes(req.query.method)
      ? req.query.method
      : "FIFO";
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol.toUpperCase() : "";
    const sellQuantity = typeof req.query.sellQuantity === "string" ? parseFloat(req.query.sellQuantity) : 0;
    const sellPrice = typeof req.query.sellPrice === "string" ? parseFloat(req.query.sellPrice) : 0;

    if (!symbol || sellQuantity <= 0 || sellPrice <= 0) {
      return res.status(400).json({
        success: false,
        error: "Parameter wajib: method (FIFO/LIFO/HIFO), symbol, sellQuantity (>0), sellPrice (>0)",
      });
    }

    // Fetch all BUY transactions for this symbol (these create tax lots)
    const allTxs = await prisma.ledgerTransaction.findMany({
      where: { userId: req.user!.sub, symbol },
      orderBy: { timestamp: "asc" },
    });

    const buyTxs = allTxs.filter((t) => t.type && t.type.toUpperCase() === "BUY");
    if (buyTxs.length === 0) {
      return res.json({
        success: true,
        result: {
          method,
          symbol,
          sellQuantity,
          sellPrice,
          totalProceedsUsd: 0,
          totalCostBasisUsd: 0,
          totalGainLossUsd: 0,
          totalGainLossPct: 0,
          shortTermGainLossUsd: 0,
          longTermGainLossUsd: 0,
          saleLots: [],
          remainingLots: [],
          totalRemainingQuantity: 0,
          totalRemainingCostBasis: 0,
          estimatedTaxIdr: 0,
          notes: [`Tidak ada transaksi BUY untuk ${symbol}. Tidak dapat menghitung tax lots.`],
        } as TaxLotResult,
      });
    }

    // Build initial tax lots from BUY transactions
    const initialLots: TaxLot[] = buyTxs.map((t, idx) => ({
      lotId: t.id || `lot-${idx}`,
      acquiredAt: t.timestamp,
      quantity: t.quantity,
      costBasisUsd: t.totalAmount || t.price * t.quantity,
      costPerUnitUsd: t.quantity > 0 ? (t.totalAmount || t.price * t.quantity) / t.quantity : t.price,
    }));

    // Apply prior SELL transactions to reduce lot quantities (using the same method)
    // so the remaining lots reflect the current open position.
    const sellTxs = allTxs.filter((t) => t.type && t.type.toUpperCase() === "SELL");
    let workingLots = [...initialLots];

    // For prior sells, we use FIFO (default) to deplete lots — this matches the
    // most common accounting treatment. The hypothetical sale below uses the
    // user's chosen method.
    for (const sell of sellTxs) {
      let qtyToSell = sell.quantity;
      // Sort working lots by acquisition time (FIFO) for prior-sell depletion
      workingLots.sort((a, b) => new Date(a.acquiredAt).getTime() - new Date(b.acquiredAt).getTime());
      for (const lot of workingLots) {
        if (qtyToSell <= 0) break;
        const sellFromLot = Math.min(lot.quantity, qtyToSell);
        lot.quantity -= sellFromLot;
        lot.costBasisUsd -= sellFromLot * lot.costPerUnitUsd;
        qtyToSell -= sellFromLot;
      }
    }
    // Filter out fully-depleted lots
    workingLots = workingLots.filter((l) => l.quantity > 0.00000001);

    // Now apply the user's chosen method to order lots for the hypothetical sale
    const methodLots = [...workingLots];
    if (method === "FIFO") {
      methodLots.sort((a, b) => new Date(a.acquiredAt).getTime() - new Date(b.acquiredAt).getTime());
    } else if (method === "LIFO") {
      methodLots.sort((a, b) => new Date(b.acquiredAt).getTime() - new Date(a.acquiredAt).getTime());
    } else if (method === "HIFO") {
      methodLots.sort((a, b) => b.costPerUnitUsd - a.costPerUnitUsd);
    }

    // Walk through sorted lots, consuming sellQuantity
    const saleLots: SaleLot[] = [];
    let remainingToSell = sellQuantity;
    let totalProceeds = 0;
    let totalCostBasis = 0;
    let shortTermGL = 0;
    let longTermGL = 0;
    const now = Date.now();

    for (const lot of methodLots) {
      if (remainingToSell <= 0) break;
      const qtyFromLot = Math.min(lot.quantity, remainingToSell);
      const costBasis = qtyFromLot * lot.costPerUnitUsd;
      const proceeds = qtyFromLot * sellPrice;
      const gainLoss = proceeds - costBasis;
      const holdingPeriodDays = Math.floor((now - new Date(lot.acquiredAt).getTime()) / (1000 * 60 * 60 * 24));
      const isShortTerm = holdingPeriodDays < 365;

      if (isShortTerm) shortTermGL += gainLoss;
      else longTermGL += gainLoss;

      saleLots.push({
        lotId: lot.lotId,
        acquiredAt: lot.acquiredAt,
        quantitySold: qtyFromLot,
        costBasisUsd: costBasis,
        proceedsUsd: proceeds,
        gainLossUsd: gainLoss,
        holdingPeriodDays,
        isShortTerm,
      });

      // Reduce the lot in workingLots (so remainingLots reflects post-sale state)
      const workingLot = workingLots.find((l) => l.lotId === lot.lotId);
      if (workingLot) {
        workingLot.quantity -= qtyFromLot;
        workingLot.costBasisUsd -= costBasis;
      }

      totalProceeds += proceeds;
      totalCostBasis += costBasis;
      remainingToSell -= qtyFromLot;
    }

    // Remove fully-depleted lots from remaining
    const remainingLots = workingLots.filter((l) => l.quantity > 0.00000001);
    const totalRemainingQuantity = remainingLots.reduce((s, l) => s + l.quantity, 0);
    const totalRemainingCostBasis = remainingLots.reduce((s, l) => s + l.costBasisUsd, 0);

    const totalGainLoss = totalProceeds - totalCostBasis;
    const totalGainLossPct = totalCostBasis > 0 ? (totalGainLoss / totalCostBasis) * 100 : 0;

    // PMK-68 estimated tax (0.1% of proceeds, in IDR) — using the LIVE USD→IDR
    // rate from open.er-api.com (1h cache). DATA-24: if the rate is
    // unavailable we return null + a note instead of a WRONG hardcoded number.
    const usdIdr = await getUsdIdrRate();
    const estimatedTaxIdr = usdIdr !== null ? totalProceeds * PMK_68_TAX_RATE * usdIdr : null;

    const notes: string[] = [];
    if (estimatedTaxIdr === null) {
      notes.push("kurs USD/IDR tidak tersedia — estimasi pajak IDR tidak dapat dihitung (coba lagi nanti).");
    }
    if (remainingToSell > 0.00000001) {
      notes.push(`Peringatan: jumlah jual (${sellQuantity}) melebihi posisi tersedia. Hanya ${sellQuantity - remainingToSell} unit yang terjual.`);
    }
    if (method === "HIFO") {
      notes.push("HIFO meminimalkan gain terealisasi dengan menjual lot termahal lebih dulu — paling efisien untuk pajak di pasar naik.");
    } else if (method === "LIFO") {
      notes.push("LIFO cenderung menghasilkan gain lebih kecil (atau loss lebih besar) di pasar turun karena lot terbaru dijual dulu.");
    } else {
      notes.push("FIFO adalah metode paling konservatif — lot tertua dijual dulu, biasanya menghasilkan gain terbesar di pasar naik.");
    }
    if (shortTermGL > 0) {
      notes.push(`Gain jangka pendek (short-term): $${shortTermGL.toFixed(2)} — biasanya dikenai tarif pajak lebih tinggi.`);
    }

    const result: TaxLotResult = {
      method,
      symbol,
      sellQuantity,
      sellPrice,
      totalProceedsUsd: totalProceeds,
      totalCostBasisUsd: totalCostBasis,
      totalGainLossUsd: totalGainLoss,
      totalGainLossPct,
      shortTermGainLossUsd: shortTermGL,
      longTermGainLossUsd: longTermGL,
      saleLots,
      remainingLots,
      totalRemainingQuantity,
      totalRemainingCostBasis,
      estimatedTaxIdr,
      notes,
    };

    res.json({ success: true, result });
  } catch (e: any) {
    log.error("[tax-lots] error:", e?.message || e);
    res.status(500).json({ success: false, error: "Gagal menghitung tax lots." });
  }
});

// ============================================================================
// NEW FEATURE: Multi-asset Correlation Matrix
// ----------------------------------------------------------------------------
// GET /api/portfolio/correlation-matrix?symbols=BTC,ETH,SOL,BNB,XRP&days=30
//
// Fetches daily closing prices for the given symbols from Binance klines API,
// computes Pearson correlation coefficients between every pair, and returns
// an N×N matrix suitable for a heatmap visualization.
//
// Use cases:
//   - Identify diversification opportunities (low/negative correlation)
//   - Detect hidden concentration risk (high correlation among "diversified" holdings)
//   - Hedge analysis (find negatively-correlated assets)
// ============================================================================

const CORRELATION_DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE"];
const CORRELATION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const correlationCache = new Map<string, { data: any; ts: number }>();

interface KlineRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchKlines(symbol: string, days: number): Promise<KlineRow[]> {
  try {
    const binanceSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : symbol.toUpperCase() + "USDT";
    const interval = "1d";
    const limit = Math.min(days, 365);
    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const raw = (await res.json()) as any[];
    if (!Array.isArray(raw)) return [];
    return raw.map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch {
    return [];
  }
}

function computePearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  // Align arrays by taking the last n values
  const xs = x.slice(-n);
  const ys = y.slice(-n);
  // Compute returns (percent change) for proper correlation
  const xr: number[] = [];
  const yr: number[] = [];
  for (let i = 1; i < n; i++) {
    if (xs[i - 1] !== 0 && ys[i - 1] !== 0) {
      xr.push((xs[i] - xs[i - 1]) / xs[i - 1]);
      yr.push((ys[i] - ys[i - 1]) / ys[i - 1]);
    }
  }
  const m = xr.length;
  if (m < 2) return 0;
  const meanX = xr.reduce((s, v) => s + v, 0) / m;
  const meanY = yr.reduce((s, v) => s + v, 0) / m;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < m; i++) {
    const dx = xr[i] - meanX;
    const dy = yr[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

portfolioRouter.get("/correlation-matrix", async (req: Request, res: Response) => {
  try {
    const symbolsRaw = typeof req.query.symbols === "string"
      ? req.query.symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      : CORRELATION_DEFAULT_SYMBOLS;
    const days = typeof req.query.days === "string"
      ? Math.min(Math.max(parseInt(req.query.days) || 30, 7), 365)
      : 30;

    // Limit to 12 symbols max for performance
    const symbols = symbolsRaw.slice(0, 12);
    if (symbols.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Minimal 2 simbol diperlukan untuk komputasi korelasi.",
      });
    }

    const cacheKey = `${symbols.join(",")}|${days}`;
    const cached = correlationCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CORRELATION_CACHE_TTL_MS) {
      return res.json({ success: true, ...cached.data });
    }

    // Fetch klines for all symbols in parallel
    const klinesBySymbol = await Promise.all(
      symbols.map(async (s) => ({ symbol: s, klines: await fetchKlines(s, days) }))
    );

    // Filter to symbols that returned data
    const valid = klinesBySymbol.filter((k) => k.klines.length >= 2);
    if (valid.length < 2) {
      return res.json({
        success: true,
        matrix: [],
        symbols: [],
        days,
        error: "Data tidak cukup untuk menghitung korelasi. Coba simbol lain.",
      });
    }

    const validSymbols = valid.map((v) => v.symbol);
    const closesBySymbol = new Map<string, number[]>();
    for (const v of valid) {
      closesBySymbol.set(v.symbol, v.klines.map((k) => k.close));
    }

    // Build N×N correlation matrix
    const matrix: Array<{ a: string; b: string; correlation: number; absCorrelation: number }> = [];
    for (let i = 0; i < validSymbols.length; i++) {
      for (let j = 0; j < validSymbols.length; j++) {
        const a = validSymbols[i];
        const b = validSymbols[j];
        const corr = i === j ? 1 : computePearsonCorrelation(closesBySymbol.get(a)!, closesBySymbol.get(b)!);
        matrix.push({
          a,
          b,
          correlation: Math.round(corr * 1000) / 1000,
          absCorrelation: Math.abs(Math.round(corr * 1000) / 1000),
        });
      }
    }

    // Find highest non-self correlation (concentration risk)
    const offDiagonal = matrix.filter((m) => m.a !== m.b);
    const sorted = [...offDiagonal].sort((a, b) => b.absCorrelation - a.absCorrelation);
    const highestCorr = sorted[0] || null;
    const lowestCorr = sorted[sorted.length - 1] || null;

    // Diversification score: average off-diagonal abs correlation (lower = more diversified)
    const avgAbsCorr = offDiagonal.length > 0
      ? offDiagonal.reduce((s, m) => s + m.absCorrelation, 0) / offDiagonal.length
      : 0;
    const diversificationScore = Math.round((1 - avgAbsCorr) * 100);

    const data = {
      matrix,
      symbols: validSymbols,
      days,
      highestCorrelation: highestCorr,
      lowestCorrelation: lowestCorr,
      diversificationScore,
      lastUpdated: new Date().toISOString(),
    };

    correlationCache.set(cacheKey, { data, ts: Date.now() });
    res.json({ success: true, ...data });
  } catch (e: any) {
    log.error("[correlation-matrix] error:", e?.message || e);
    res.status(500).json({ success: false, error: "Gagal menghitung matriks korelasi." });
  }
});

// ============================================================================
// NEW FEATURE: Automated Tax Report Generator (annual P&L + PMK-68 summary)
// ----------------------------------------------------------------------------
// GET /api/portfolio/tax-report?year=2024
//
// Aggregates all ledger transactions for the given year, computes:
//   - Total proceeds (from SELL transactions)
//   - Total cost basis (from BUY transactions)
//   - Realized gain/loss (proceeds - cost basis of sold lots, FIFO)
//   - Unrealized gain/loss (current value - remaining cost basis)
//   - PMK-68 estimated tax (0.1% of total proceeds, in IDR)
//   - Per-symbol breakdown (proceeds, cost, gain/loss, tax)
//   - Transaction count + summary
//
// Returns JSON. The frontend renders this as a printable PDF report.
// ============================================================================

portfolioRouter.get("/tax-report", async (req: Request, res: Response) => {
  try {
    const year = typeof req.query.year === "string"
      ? parseInt(req.query.year)
      : new Date().getFullYear();

    if (isNaN(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ success: false, error: "Tahun tidak valid (2000-2100)." });
    }

    // Fetch all transactions for the user (filter by year in JS — SQLite string dates)
    const allTxs = await prisma.ledgerTransaction.findMany({
      where: { userId: req.user!.sub },
      orderBy: { timestamp: "asc" },
    });

    // Filter to the requested year
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const yearTxs = allTxs.filter((t) => {
      try {
        const ts = t.timestamp.startsWith("T") || t.timestamp.includes("T")
          ? t.timestamp
          : t.timestamp + "T00:00:00Z";
        const d = new Date(ts);
        const isoDate = d.toISOString().substring(0, 10);
        return isoDate >= yearStart && isoDate <= yearEnd;
      } catch {
        return false;
      }
    });

    if (yearTxs.length === 0) {
      return res.json({
        success: true,
        report: {
          year,
          totalProceedsUsd: 0,
          totalCostBasisUsd: 0,
          realizedGainLossUsd: 0,
          unrealizedGainLossUsd: 0,
          realizedGainLossPct: 0,
          pmk68TaxIdr: 0,
          pmk68TaxRate: 0.001,
          transactionCount: 0,
          buyCount: 0,
          sellCount: 0,
          perSymbol: [],
          generatedAt: new Date().toISOString(),
          summary: `Tidak ada transaksi pada tahun ${year}.`,
        },
      });
    }

    // Group by symbol
    const bySymbol = new Map<string, { buys: any[]; sells: any[] }>();
    for (const t of yearTxs) {
      const sym = t.symbol.toUpperCase();
      if (!bySymbol.has(sym)) bySymbol.set(sym, { buys: [], sells: [] });
      const type = (t.type || "").toUpperCase();
      if (type === "BUY") bySymbol.get(sym)!.buys.push(t);
      else if (type === "SELL") bySymbol.get(sym)!.sells.push(t);
    }

    const usdIdrRate = await getUsdIdrRate(); // DATA-24: live rate; null = unavailable
    const perSymbol: any[] = [];
    let totalProceeds = 0;
    let totalCostBasis = 0;
    let totalRealizedGL = 0;
    let totalBuyQty = 0;
    let totalSellQty = 0;
    let buyCount = 0;
    let sellCount = 0;

    for (const [symbol, { buys, sells }] of bySymbol) {
      // FIFO matching: for each SELL, consume from oldest BUY
      const buyQueue = [...buys].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      let symbolProceeds = 0;
      let symbolCostBasis = 0;
      let symbolRemainingQty = buys.reduce((s, b) => s + b.quantity, 0) - sells.reduce((s, s2) => s + s2.quantity, 0);

      for (const sell of sells) {
        sellCount++;
        totalSellQty += sell.quantity;
        symbolProceeds += sell.totalAmount || (sell.price * sell.quantity);
        let qtyToSell = sell.quantity;
        // Consume from buyQueue (FIFO)
        for (const lot of buyQueue) {
          if (qtyToSell <= 0) break;
          if (lot.quantity <= 0) continue;
          const sellFromLot = Math.min(lot.quantity, qtyToSell);
          const lotCost = (lot.totalAmount || lot.price * lot.quantity) / (lot.quantity > 0 ? lot.quantity : 1) * sellFromLot;
          symbolCostBasis += lotCost;
          lot.quantity -= sellFromLot;
          qtyToSell -= sellFromLot;
        }
      }

      for (const buy of buys) {
        buyCount++;
        totalBuyQty += buy.quantity;
      }

      const symbolGL = symbolProceeds - symbolCostBasis;
      totalProceeds += symbolProceeds;
      totalCostBasis += symbolCostBasis;
      totalRealizedGL += symbolGL;

      perSymbol.push({
        symbol,
        buyCount: buys.length,
        sellCount: sells.length,
        totalBuyQty: buys.reduce((s, b) => s + b.quantity, 0),
        totalSellQty: sells.reduce((s, s2) => s + s2.quantity, 0),
        proceedsUsd: symbolProceeds,
        costBasisUsd: symbolCostBasis,
        gainLossUsd: symbolGL,
        gainLossPct: symbolCostBasis > 0 ? (symbolGL / symbolCostBasis) * 100 : 0,
        remainingQty: Math.max(0, symbolRemainingQty),
      });
    }

    // Sort per-symbol by proceeds descending
    perSymbol.sort((a, b) => b.proceedsUsd - a.proceedsUsd);

    // PMK-68 tax: 0.1% of total proceeds (transaction-based, not gain-based)
    const pmk68TaxRate = 0.001;
    const pmk68TaxUsd = totalProceeds * pmk68TaxRate;
    // DATA-24: no more hardcoded 15.800 — honest null when kurs unavailable.
    const pmk68TaxIdr = usdIdrRate !== null ? pmk68TaxUsd * usdIdrRate : null;
    const taxIdrText = pmk68TaxIdr !== null
      ? `Rp ${pmk68TaxIdr.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`
      : "tidak tersedia (kurs USD/IDR sedang tidak dapat diambil)";

    const realizedGainLossPct = totalCostBasis > 0 ? (totalRealizedGL / totalCostBasis) * 100 : 0;

    // Summary message
    let summary: string;
    if (totalRealizedGL > 0) {
      summary = `Tahun ${year}: Realized gain $${totalRealizedGL.toFixed(2)} (${realizedGainLossPct.toFixed(1)}%) dari ${yearTxs.length} transaksi. Estimasi pajak PMK-68 (0.1% dari proceeds): ${taxIdrText}.`;
    } else if (totalRealizedGL < 0) {
      summary = `Tahun ${year}: Realized loss $${Math.abs(totalRealizedGL).toFixed(2)} (${Math.abs(realizedGainLossPct).toFixed(1)}%) dari ${yearTxs.length} transaksi. Estimasi pajak PMK-68 (0.1% dari proceeds): ${taxIdrText}. Loss dapat dikompensasi di tahun berikutnya sesuai aturan pajak Indonesia.`;
    } else {
      summary = `Tahun ${year}: ${yearTxs.length} transaksi tercatat. Tidak ada realized gain/loss (hanya BUY atau hanya SELL parsial). Estimasi pajak PMK-68: ${taxIdrText}.`;
    }

    res.json({
      success: true,
      report: {
        year,
        totalProceedsUsd: totalProceeds,
        totalCostBasisUsd: totalCostBasis,
        realizedGainLossUsd: totalRealizedGL,
        unrealizedGainLossUsd: 0, // would need live prices — left as exercise for future
        realizedGainLossPct,
        pmk68TaxUsd: pmk68TaxUsd,
        pmk68TaxIdr: pmk68TaxIdr,
        usdIdrRate, // kurs live yang dipakai (null jika gagal) — transparan di UI
        pmk68TaxRate,
        transactionCount: yearTxs.length,
        buyCount,
        sellCount,
        totalBuyQty,
        totalSellQty,
        perSymbol,
        generatedAt: new Date().toISOString(),
        summary,
      },
    });
  } catch (e: any) {
    log.error("[tax-report] error:", e?.message || e);
    res.status(500).json({ success: false, error: "Gagal membuat laporan pajak." });
  }
});

// ============================================================================
// NEW FEATURE: DCA (Dollar-Cost Averaging) Calculator with historical performance
// ----------------------------------------------------------------------------
// GET /api/portfolio/dca?symbol=BTC&amount=100&frequency=weekly&startDate=2024-01-01
//
// Simulates a DCA strategy: investing a fixed USD amount at regular intervals
// (daily/weekly/monthly) from startDate to today. Uses Binance daily klines
// to compute the actual purchase price at each interval.
//
// Returns:
//   - Total invested (USD)
//   - Total units accumulated
//   - Average cost per unit
//   - Current portfolio value (at latest close)
//   - Total return (USD + %)
//   - Per-purchase breakdown (date, price, units bought)
//   - Comparison vs lump-sum (investing everything on day 1)
// ============================================================================

const DCA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const dcaCache = new Map<string, { data: any; ts: number }>();

portfolioRouter.get("/dca", async (req: Request, res: Response) => {
  try {
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol.toUpperCase() : "BTC";
    const amount = typeof req.query.amount === "string" ? parseFloat(req.query.amount) : 100;
    const frequency = typeof req.query.frequency === "string" && ["daily", "weekly", "monthly"].includes(req.query.frequency)
      ? req.query.frequency
      : "weekly";
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";

    if (amount <= 0 || amount > 1e6) {
      return res.status(400).json({ success: false, error: "Amount harus antara 0 dan 1,000,000 USD." });
    }

    // Parse start date (default: 1 year ago)
    let start: Date;
    if (startDate) {
      start = new Date(startDate);
      if (isNaN(start.getTime())) {
        return res.status(400).json({ success: false, error: "Format startDate tidak valid (gunakan YYYY-MM-DD)." });
      }
    } else {
      start = new Date();
      start.setFullYear(start.getFullYear() - 1);
    }

    const end = new Date();
    if (start >= end) {
      return res.status(400).json({ success: false, error: "startDate harus sebelum hari ini." });
    }

    // Cap to 3 years max for performance
    const maxStart = new Date();
    maxStart.setFullYear(maxStart.getFullYear() - 3);
    if (start < maxStart) start = maxStart;

    const cacheKey = `${symbol}|${amount}|${frequency}|${start.toISOString().split("T")[0]}`;
    const cached = dcaCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < DCA_CACHE_TTL_MS) {
      return res.json({ success: true, ...cached.data });
    }

    // Fetch daily klines from Binance (limit = days between start and now, capped at 1000)
    const days = Math.min(Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 10, 1000);
    const binanceSymbol = symbol.endsWith("USDT") ? symbol : symbol + "USDT";
    const klinesRes = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1d&limit=${days}&startTime=${start.getTime()}`
    );
    if (!klinesRes.ok) {
      return res.status(502).json({ success: false, error: `Gagal mengambil data klines untuk ${symbol}.` });
    }
    const klines = (await klinesRes.json()) as any[];
    if (!Array.isArray(klines) || klines.length === 0) {
      return res.status(404).json({ success: false, error: `Tidak ada data harga untuk ${symbol}.` });
    }

    // Build a map of date (YYYY-MM-DD) → close price
    const priceByDate = new Map<string, number>();
    for (const k of klines) {
      const d = new Date(k[0]);
      const dateStr = d.toISOString().split("T")[0];
      priceByDate.set(dateStr, parseFloat(k[4])); // k[4] = close price
    }

    // Generate DCA purchase dates
    const purchases: Array<{ date: string; price: number; units: number; amount: number }> = [];
    const intervalMs = frequency === "daily" ? 24 * 60 * 60 * 1000 : frequency === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    let current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split("T")[0];
      // Find the closest available price (exact date, or next available)
      let price = priceByDate.get(dateStr);
      if (price === undefined) {
        // Find nearest date
        const sortedDates = Array.from(priceByDate.keys()).sort();
        for (const d of sortedDates) {
          if (d >= dateStr) {
            price = priceByDate.get(d);
            break;
          }
        }
        if (price === undefined) price = priceByDate.get(sortedDates[sortedDates.length - 1]) || 0;
      }
      if (price > 0) {
        purchases.push({
          date: dateStr,
          price,
          units: amount / price,
          amount,
        });
      }
      current = new Date(current.getTime() + intervalMs);
    }

    if (purchases.length === 0) {
      return res.json({
        success: true,
        dca: {
          symbol,
          amount,
          frequency,
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
          purchaseCount: 0,
          totalInvested: 0,
          totalUnits: 0,
          averageCost: 0,
          currentValue: 0,
          currentPrice: klines[klines.length - 1] ? parseFloat(klines[klines.length - 1][4]) : 0,
          totalReturn: 0,
          totalReturnPct: 0,
          lumpSumReturn: 0,
          lumpSumReturnPct: 0,
          dcaAdvantage: 0,
          purchases: [],
          summary: "Tidak ada periode pembelian dalam rentang tanggal yang dipilih.",
        },
      });
    }

    const totalInvested = purchases.reduce((s, p) => s + p.amount, 0);
    const totalUnits = purchases.reduce((s, p) => s + p.units, 0);
    const averageCost = totalUnits > 0 ? totalInvested / totalUnits : 0;
    const currentPrice = klines[klines.length - 1] ? parseFloat(klines[klines.length - 1][4]) : purchases[purchases.length - 1].price;
    const currentValue = totalUnits * currentPrice;
    const totalReturn = currentValue - totalInvested;
    const totalReturnPct = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;

    // Lump-sum comparison: invest everything on the first purchase date
    const firstPrice = purchases[0].price;
    const lumpSumUnits = totalInvested / firstPrice;
    const lumpSumValue = lumpSumUnits * currentPrice;
    const lumpSumReturn = lumpSumValue - totalInvested;
    const lumpSumReturnPct = (lumpSumReturn / totalInvested) * 100;
    const dcaAdvantage = totalReturn - lumpSumReturn; // positive = DCA better

    // Summary
    let summary: string;
    if (dcaAdvantage > 0) {
      summary = `Strategi DCA (${frequency}, $${amount}/periode) menghasilkan return +$${totalReturn.toFixed(2)} (${totalReturnPct.toFixed(1)}%), lebih baik $${dcaAdvantage.toFixed(2)} dibanding lump-sum. DCA menguntungkan di pasar volatil/menurun karena meratakan biaya rata-rata.`;
    } else {
      summary = `Strategi DCA (${frequency}, $${amount}/periode) menghasilkan return +$${totalReturn.toFixed(2)} (${totalReturnPct.toFixed(1)}%), lebih buruk $${Math.abs(dcaAdvantage).toFixed(2)} dibanding lump-sum. Lump-sum menguntungkan di pasar yang terus naik. DCA tetap membantu mengurangi risiko timing pasar.`;
    }

    const data = {
      symbol,
      amount,
      frequency,
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
      purchaseCount: purchases.length,
      totalInvested,
      totalUnits,
      averageCost,
      currentValue,
      currentPrice,
      totalReturn,
      totalReturnPct,
      lumpSumReturn,
      lumpSumReturnPct,
      dcaAdvantage,
      purchases: purchases.slice(-100), // last 100 purchases for UI (cap payload)
      summary,
    };

    dcaCache.set(cacheKey, { data, ts: Date.now() });
    res.json({ success: true, ...data });
  } catch (e: any) {
    log.error("[dca] error:", e?.message || e);
    res.status(500).json({ success: false, error: "Gagal menghitung simulasi DCA." });
  }
});

// ─── BACKTEST RESULTS ────────────────────────────────────────────────

portfolioRouter.get("/backtests", async (req: Request, res: Response) => {
  try {
    const results = await prisma.backtestResult.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, results });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal memuat backtest." });
  }
});

portfolioRouter.post("/backtests", async (req: Request, res: Response) => {
  try {
    const parsed = backtestResultSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
    }
    const r = parsed.data;
    const result = await prisma.backtestResult.create({
      data: {
        userId: req.user!.sub,
        symbol: r.symbol,
        strategy: r.strategy,
        startDate: r.startDate || "",
        endDate: r.endDate || "",
        initialCapital: r.initialCapital,
        finalCapital: r.finalCapital,
        totalReturn: r.totalReturn,
        sharpeRatio: r.sharpeRatio ?? null,
        maxDrawdown: r.maxDrawdown ?? null,
        winRate: r.winRate ?? null,
        totalTrades: r.totalTrades ?? 0,
        equityCurve: JSON.stringify(r.equityCurve || {}),
      },
    });
    res.json({ success: true, result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal menyimpan backtest." });
  }
});

portfolioRouter.delete("/backtests/:id", async (req: Request, res: Response) => {
  try {
    await prisma.backtestResult.delete({
      where: { id: req.params.id, userId: req.user!.sub },
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(404).json({ success: false, error: "Backtest tidak ditemukan." });
  }
});

// ─── CONVERSIONS ─────────────────────────────────────────────────────

portfolioRouter.get("/conversions", async (req: Request, res: Response) => {
  try {
    const conversions = await prisma.conversionTransaction.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, conversions });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal memuat konversi." });
  }
});

portfolioRouter.post("/conversions", async (req: Request, res: Response) => {
  try {
    // FIX-B-1: validate body with zod — rejects NaN/negative/oversized values.
    const parsed = conversionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
    }
    const c = parsed.data;
    const conv = await prisma.conversionTransaction.create({
      data: {
        userId: req.user!.sub,
        fromSymbol: c.fromSymbol,
        fromAmount: c.fromAmount,
        toSymbol: c.toSymbol,
        toAmount: c.toAmount,
        rate: c.rate,
        timestamp: c.timestamp || new Date().toISOString(),
      },
    });
    res.json({ success: true, conversion: conv });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal menyimpan konversi." });
  }
});

portfolioRouter.post("/conversions/sync", async (req: Request, res: Response) => {
  try {
    const parsed = conversionsSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
    }
    const conversions = parsed.data.conversions;
    await prisma.$transaction([
      prisma.conversionTransaction.deleteMany({ where: { userId: req.user!.sub } }),
      ...conversions.map((c) => prisma.conversionTransaction.create({
        data: {
          userId: req.user!.sub,
          fromSymbol: c.fromSymbol,
          fromAmount: c.fromAmount,
          toSymbol: c.toSymbol,
          toAmount: c.toAmount,
          rate: c.rate,
          timestamp: c.timestamp || new Date().toISOString(),
        },
      })),
    ]);
    res.json({ success: true, count: conversions.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal sinkronisasi konversi." });
  }
});

// ─── ALERTS ──────────────────────────────────────────────────────────

portfolioRouter.get("/alerts", async (req: Request, res: Response) => {
  try {
    const alerts = await prisma.alertConfig.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, alerts });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal memuat alerts." });
  }
});

portfolioRouter.post("/alerts", async (req: Request, res: Response) => {
  try {
    // FIX-B-1: validate body with zod — rejects NaN/negative/oversized values.
    const parsed = alertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "Input tidak valid: " + zodError(parsed.error) });
    }
    const { symbol, condition, targetPrice, createdAt, id } = parsed.data;
    const alert = await prisma.alertConfig.create({
      data: {
        id: id || undefined,
        userId: req.user!.sub,
        symbol,
        condition,
        targetPrice,
        createdAt: createdAt || new Date().toISOString().split("T")[0],
      },
    });
    res.json({ success: true, alert });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal menyimpan alert." });
  }
});

portfolioRouter.delete("/alerts/:id", async (req: Request, res: Response) => {
  try {
    await prisma.alertConfig.delete({
      where: { id: req.params.id, userId: req.user!.sub },
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(404).json({ success: false, error: "Alert tidak ditemukan." });
  }
});

// ============================================================================
// NEW FEATURE: Portfolio Risk Score (VaR + CVaR + concentration metrics)
// ----------------------------------------------------------------------------
// GET /api/portfolio/risk-score
// Computes:
//   - 95% / 99% Value at Risk (1-day horizon, parametric, assumes normal returns)
//   - 95% / 99% Conditional VaR (Expected Shortfall)
//   - Concentration: Herfindahl-Hirschman Index (HHI) on USD weights
//   - Sharpe-like ratio (uses asset 24h change as a return proxy)
//   - Max drawdown proxy (largest single-asset 24h loss)
//   - Diversification ratio (1 - HHI normalized)
//
// Fetches live 24h change per symbol from Binance ticker. Stocks use a fixed
// 1.2% daily vol proxy (Indonesian bluechip empirical). All math is done
// server-side so the client just renders the numbers.
// ============================================================================

interface RiskHolding {
  symbol: string;
  category: string;
  quantity: number;
  purchasePrice: number;
  currentPrice: number;
  change24hPct: number; // % return over 24h (decimal, e.g. 0.012 for 1.2%)
  dailyVol: number; // daily volatility (decimal, e.g. 0.04 for 4%)
}

async function fetchAssetVolatility(symbol: string, category: string): Promise<{ price: number; change24hPct: number; dailyVol: number }> {
  // Stock fallback (Indonesian bluechip empirical daily vol)
  if (category !== "crypto") {
    return { price: 0, change24hPct: 0, dailyVol: 0.012 };
  }
  try {
    const binanceSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : symbol.toUpperCase() + "USDT";
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`);
    if (!res.ok) return { price: 0, change24hPct: 0, dailyVol: 0.04 };
    const data = (await res.json()) as any;
    const price = parseFloat(data.lastPrice);
    const change24hPct = parseFloat(data.priceChangePercent) / 100;
    // Daily volatility proxy: |24h change| scaled. Crypto typically 3-8% daily vol.
    // We use max(|change|, 3%) as a floor, capped at 15%.
    const dailyVol = Math.min(0.15, Math.max(0.03, Math.abs(change24hPct) * 1.5));
    return { price, change24hPct, dailyVol };
  } catch {
    return { price: 0, change24hPct: 0, dailyVol: 0.04 };
  }
}

portfolioRouter.get("/risk-score", async (req: Request, res: Response) => {
  try {
    const holdings = await prisma.portfolioHolding.findMany({
      where: { userId: req.user!.sub },
    });
    if (holdings.length === 0) {
      return res.json({
        success: true,
        risk: {
          totalValue: 0,
          var95: 0,
          var99: 0,
          cvar95: 0,
          cvar99: 0,
          hhi: 0,
          diversificationRatio: 0,
          sharpeProxy: 0,
          maxDrawdownProxy: 0,
          largestPositionPct: 0,
          largestPositionSymbol: null,
          riskGrade: "N/A",
          riskScore: 0,
        },
      });
    }

    // Fetch live prices + volatility per holding
    const enriched: RiskHolding[] = [];
    for (const h of holdings) {
      const { price, change24hPct, dailyVol } = await fetchAssetVolatility(h.symbol, h.category);
      const currentPrice = price > 0 ? price : h.purchasePrice; // fallback to purchase price
      enriched.push({
        symbol: h.symbol,
        category: h.category,
        quantity: h.quantity,
        purchasePrice: h.purchasePrice,
        currentPrice,
        change24hPct,
        dailyVol,
      });
    }

    const totalValue = enriched.reduce((s, h) => s + h.currentPrice * h.quantity, 0);
    if (totalValue <= 0) {
      return res.json({
        success: true,
        risk: {
          totalValue: 0,
          var95: 0,
          var99: 0,
          cvar95: 0,
          cvar99: 0,
          hhi: 0,
          diversificationRatio: 0,
          sharpeProxy: 0,
          maxDrawdownProxy: 0,
          largestPositionPct: 0,
          largestPositionSymbol: null,
          riskGrade: "N/A",
          riskScore: 0,
        },
      });
    }

    // Portfolio weights
    const weights = enriched.map((h) => (h.currentPrice * h.quantity) / totalValue);

    // Herfindahl-Hirschman Index (0=perfectly diversified, 1=concentrated)
    const hhi = weights.reduce((s, w) => s + w * w, 0);

    // Diversification ratio: 0 (concentrated) → 1 (fully diversified)
    const diversificationRatio = enriched.length > 1 ? 1 - hhi : 0;

    // Weighted portfolio daily volatility
    const portfolioVol = Math.sqrt(
      enriched.reduce((s, h, i) => s + Math.pow(weights[i] * h.dailyVol, 2), 0)
    );

    // Weighted portfolio 24h return
    const portfolioReturn = enriched.reduce((s, h, i) => s + weights[i] * h.change24hPct, 0);

    // Parametric VaR (assumes normal returns): VaR_alpha = -Z_alpha * vol * value
    // Z_0.95 = 1.645, Z_0.99 = 2.326
    const var95 = 1.645 * portfolioVol * totalValue;
    const var99 = 2.326 * portfolioVol * totalValue;

    // Conditional VaR (Expected Shortfall): E[Loss | Loss > VaR]
    // For normal: CVaR_alpha = vol * phi(Z_alpha) / (1 - alpha) * value
    // phi(1.645) ≈ 0.103, phi(2.326) ≈ 0.0267
    const cvar95 = (0.103 / 0.05) * portfolioVol * totalValue;
    const cvar99 = (0.0267 / 0.01) * portfolioVol * totalValue;

    // Sharpe-like proxy: portfolioReturn / portfolioVol (risk-free rate = 0 for daily)
    const sharpeProxy = portfolioVol > 0 ? portfolioReturn / portfolioVol : 0;

    // Max drawdown proxy: largest single-asset 24h loss (if negative)
    const maxDrawdownProxy = Math.max(
      0,
      ...enriched.map((h) => Math.max(0, -h.change24hPct) * (h.currentPrice * h.quantity))
    );

    // Largest position %
    const largestIdx = weights.indexOf(Math.max(...weights));
    const largestPositionPct = weights[largestIdx] * 100;
    const largestPositionSymbol = enriched[largestIdx]?.symbol ?? null;

    // Risk score: 0-100 (higher = riskier). Composed of:
    //   - volatility (40%): portfolioVol scaled (0-15% daily vol maps to 0-40)
    //   - concentration (30%): HHI scaled (0-1 maps to 0-30)
    //   - largest position (20%): max weight % scaled (0-100% maps to 0-20)
    //   - drawdown proxy (10%): maxDrawdownProxy as % of portfolio, scaled (0-10% maps to 0-10)
    const volScore = Math.min(40, (portfolioVol / 0.15) * 40);
    const concScore = hhi * 30;
    const largestScore = Math.min(20, (largestPositionPct / 100) * 20);
    const ddPctOfPortfolio = totalValue > 0 ? (maxDrawdownProxy / totalValue) * 100 : 0;
    const ddScore = Math.min(10, (ddPctOfPortfolio / 10) * 10);
    const riskScore = Math.round(volScore + concScore + largestScore + ddScore);

    // Risk grade: A (low) → E (extreme)
    let riskGrade: string;
    if (riskScore < 20) riskGrade = "A";
    else if (riskScore < 40) riskGrade = "B";
    else if (riskScore < 60) riskGrade = "C";
    else if (riskScore < 80) riskGrade = "D";
    else riskGrade = "E";

    res.json({
      success: true,
      risk: {
        totalValue,
        var95,
        var99,
        cvar95,
        cvar99,
        hhi,
        diversificationRatio,
        sharpeProxy,
        maxDrawdownProxy,
        largestPositionPct,
        largestPositionSymbol,
        riskGrade,
        riskScore,
        portfolioVol,
        portfolioReturn,
        holdingsCount: enriched.length,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal menghitung skor risiko." });
  }
});

// Yahoo Finance chart API for stock prices (same upstream the /api/assets
// refresher uses). Short in-module cache; null on failure (never fabricated).
const STOCK_PRICE_CACHE_TTL = 120 * 1000;
const stockPriceCache = new Map<string, { price: number; ts: number }>();
async function fetchStockPrice(symbol: string): Promise<number | null> {
  const now = Date.now();
  const cached = stockPriceCache.get(symbol);
  if (cached && now - cached.ts < STOCK_PRICE_CACHE_TTL) return cached.price;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.JK?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return cached?.price ?? null;
    const data = (await res.json()) as any;
    const price = parseFloat(data?.chart?.result?.[0]?.meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) return cached?.price ?? null;
    stockPriceCache.set(symbol, { price, ts: now });
    return price;
  } catch {
    return cached?.price ?? null;
  }
}

// ============================================================================
// NEW FEATURE (Roadmap #25): Portfolio Performance Attribution
// ----------------------------------------------------------------------------
// GET /api/portfolio/attribution
// Answers: "aset mana yang paling berkontribusi terhadap gain/loss portofolio?"
// For each holding (live prices) we compute:
//   - costBasis  = purchasePrice × quantity
//   - currentValue = livePrice × quantity
//   - gainLoss & gainLossPct (absolute + relative per asset)
//   - weightPct   = share of current portfolio value
//   - contributionPct = share of TOTAL portfolio P&L (signed)
// Price sources are honest: crypto = live Binance; stock = last-synced price
// from the client sync layer (flagged) — we never fabricate prices.
// ============================================================================
portfolioRouter.get("/attribution", async (req: Request, res: Response) => {
  try {
    const holdings = await prisma.portfolioHolding.findMany({
      where: { userId: req.user!.sub },
    });

    if (holdings.length === 0) {
      return res.json({
        success: true,
        attribution: {
          totalValue: 0,
          totalCost: 0,
          totalGainLoss: 0,
          totalGainLossPct: 0,
          holdings: [],
          best: null,
          worst: null,
          summary: "Belum ada holding. Tambahkan aset di Crypto Hub untuk melihat atribusi kinerja.",
        },
      });
    }

    // DATA-QA2 (ronde QA #2): atribusi multi-mata-uang yang jujur.
    // Saham .JK di-quote Yahoo dalam IDR; crypto dalam USD. Sebelumnya kedua
    // mata uang dijumlahkan mentah (10 lembar BBCA dihitung sebagai "$6.4K").
    // Sekarang: per-baris tetap native (Rp untuk saham, $ untuk crypto),
    // sedangkan TOTAL dan persentase dinormalisasi ke USD memakai kurs live
    // (getUsdIdrRate, open.er-api.com). Jika kurs gagal dan ada saham, total
    // menjadi campuran yang DIBERI LABEL (mixedCurrency) — tidak pernah
    // diklaim sebagai USD murni.
    const hasStocks = holdings.some((h) => h.category !== "crypto");
    const fxRate = hasStocks ? await getUsdIdrRate() : null;
    const fxApplied = hasStocks && fxRate !== null;
    const mixedCurrency = hasStocks && fxRate === null;
    const toUsd = (amount: number, currency: string): number =>
      currency === "IDR" ? (fxRate ? amount / fxRate : amount) : amount;

    interface AttributionRow {
      id: string;
      symbol: string;
      category: string;
      currency: "USD" | "IDR";
      quantity: number;
      purchasePrice: number;
      livePrice: number;
      priceSource: "live" | "purchase-price";
      costBasis: number;
      currentValue: number;
      gainLoss: number;
      gainLossUsd: number;
      gainLossPct: number;
      weightPct: number;
      contributionPct: number;
    }

    const rows: AttributionRow[] = [];
    let totalValueUsd = 0;
    let totalCostUsd = 0;

    for (const h of holdings) {
      const qty = h.quantity > 0 ? h.quantity : 0;
      const isStock = h.category !== "crypto";
      const currency: "USD" | "IDR" = isStock ? "IDR" : "USD";
      const cost = (h.purchasePrice || 0) * qty; // native currency

      let livePrice = 0;
      let priceSource: AttributionRow["priceSource"] = "purchase-price";
      if (h.category === "crypto") {
        const { price } = await fetchAssetVolatility(h.symbol, h.category);
        if (price > 0) {
          livePrice = price;
          priceSource = "live";
        }
      } else {
        // Stocks: Yahoo Finance live quote dalam IDR (upstream sama dengan /api/assets).
        const price = await fetchStockPrice(h.symbol);
        if (price !== null && price > 0) {
          livePrice = price;
          priceSource = "live";
        }
      }
      // Honest fallback — flagged, never fabricated (native currency):
      if (livePrice <= 0 && (h.purchasePrice || 0) > 0) {
        livePrice = h.purchasePrice;
        priceSource = "purchase-price";
      }

      const value = livePrice * qty; // native
      const gainLoss = value - cost; // native
      const gainLossUsd = toUsd(gainLoss, currency);
      const gainLossPct = cost > 0 ? (gainLoss / cost) * 100 : 0;

      rows.push({
        id: h.id,
        symbol: h.symbol,
        category: h.category,
        currency,
        quantity: qty,
        purchasePrice: h.purchasePrice || 0,
        livePrice,
        priceSource,
        costBasis: cost,
        currentValue: value,
        gainLoss,
        gainLossUsd,
        gainLossPct,
        weightPct: 0, // filled after totals
        contributionPct: 0, // filled after totals
      });
      totalValueUsd += toUsd(value, currency);
      totalCostUsd += toUsd(cost, currency);
    }

    const totalGainLoss = totalValueUsd - totalCostUsd;
    const totalGainLossPct = totalCostUsd > 0 ? (totalGainLoss / totalCostUsd) * 100 : 0;

    for (const r of rows) {
      const valueUsd = toUsd(r.currentValue, r.currency);
      r.weightPct = totalValueUsd > 0 ? (valueUsd / totalValueUsd) * 100 : 0;
      // Contribution: share of the TOTAL P&L (signed — a losing asset inside a
      // winning portfolio shows negative contribution). USD-normalized.
      r.contributionPct = totalGainLoss !== 0 ? (r.gainLossUsd / totalGainLoss) * 100 : 0;
    }

    // Rank by absolute P&L impact in USD (largest movers first).
    rows.sort((a, b) => Math.abs(b.gainLossUsd) - Math.abs(a.gainLossUsd));
    const best = rows.find((r) => r.gainLoss > 0) ?? null;
    const worst = rows.find((r) => r.gainLoss < 0) ?? null;

    const staleCount = rows.filter((r) => r.priceSource !== "live").length;
    const summary = `${holdings.length} holding dianalisis. Total return ${totalGainLossPct.toFixed(2)}%` +
      (best ? ` • kontributor terbaik ${best.symbol} (+${best.gainLossPct.toFixed(1)}%)` : "") +
      (worst ? ` • terburuk ${worst.symbol} (${worst.gainLossPct.toFixed(1)}%)` : "") +
      (staleCount > 0 ? ` • ${staleCount} aset memakai harga non-live (berlabel)` : "") +
      (fxApplied ? ` • saham IDR dikonversi ke USD pada kurs live Rp${Math.round(fxRate!).toLocaleString("id-ID")}` : "") +
      (mixedCurrency ? " • PERINGATAN: kurs USD/IDR tidak tersedia, total campuran IDR+USD tanpa konversi" : "");

    return res.json({
      success: true,
      attribution: {
        totalValue: totalValueUsd,
        totalCost: totalCostUsd,
        totalGainLoss,
        totalGainLossPct,
        baseCurrency: "USD",
        fxRate: fxRate ?? null,
        fxSource: fxRate ? "open.er-api.com (live)" : null,
        fxApplied,
        mixedCurrency,
        holdings: rows,
        best: best ? { symbol: best.symbol, gainLoss: best.gainLoss, currency: best.currency, gainLossPct: best.gainLossPct } : null,
        worst: worst ? { symbol: worst.symbol, gainLoss: worst.gainLoss, currency: worst.currency, gainLossPct: worst.gainLossPct } : null,
        summary,
      },
    });
  } catch (e: any) {
    log.error("[attribution] error:", e?.message || e);
    res.status(500).json({ success: false, error: "Gagal menghitung atribusi kinerja." });
  }
});

// ============================================================================
// NEW FEATURE: Portfolio Rebalancing Suggestions
// ----------------------------------------------------------------------------
// GET /api/portfolio/rebalance?riskProfile=Balanced
// Computes suggested allocation adjustments based on:
//   - User's risk profile (Low/Moderate/Balanced/Aggressive) → target crypto %
//   - Current portfolio weights (live prices)
//   - Drift from target allocation
//
// Returns per-asset actions: HOLD / BUY / SELL / REDUCE with suggested USD amount
// + target weight %. Only suggests when drift > 5% (threshold).
// ============================================================================

const RISK_PROFILE_TARGETS: Record<string, { cryptoPct: number; stockPct: number; maxSinglePosition: number }> = {
  Low: { cryptoPct: 0.15, stockPct: 0.85, maxSinglePosition: 0.30 },
  Moderate: { cryptoPct: 0.25, stockPct: 0.75, maxSinglePosition: 0.35 },
  Balanced: { cryptoPct: 0.40, stockPct: 0.60, maxSinglePosition: 0.40 },
  Aggressive: { cryptoPct: 0.60, stockPct: 0.40, maxSinglePosition: 0.50 },
};

portfolioRouter.get("/rebalance", async (req: Request, res: Response) => {
  try {
    const riskProfile = typeof req.query.riskProfile === "string"
      ? (["Low", "Moderate", "Balanced", "Aggressive"].includes(req.query.riskProfile) ? req.query.riskProfile : "Balanced")
      : "Balanced";

    const targets = RISK_PROFILE_TARGETS[riskProfile];
    const holdings = await prisma.portfolioHolding.findMany({
      where: { userId: req.user!.sub },
    });

    if (holdings.length === 0) {
      return res.json({
        success: true,
        rebalance: {
          riskProfile,
          totalValue: 0,
          currentCryptoPct: 0,
          currentStockPct: 0,
          targetCryptoPct: targets.cryptoPct * 100,
          targetStockPct: targets.stockPct * 100,
          actions: [],
          summary: "Belum ada holding. Tambahkan aset di Crypto Hub untuk mendapatkan saran rebalancing.",
          driftScore: 0,
        },
      });
    }

    // Fetch live prices + compute current weights
    interface RebalanceHolding {
      id: string;
      symbol: string;
      category: string;
      quantity: number;
      purchasePrice: number;
      currentPrice: number;
      currentValue: number;
      currentWeight: number;
      targetWeight: number;
      drift: number; // currentWeight - targetWeight (positive = overweight)
    }

    const enriched: RebalanceHolding[] = [];
    let totalValue = 0;
    for (const h of holdings) {
      const { price } = await fetchAssetVolatility(h.symbol, h.category);
      const currentPrice = price > 0 ? price : h.purchasePrice;
      const currentValue = currentPrice * h.quantity;
      totalValue += currentValue;
      enriched.push({
        id: h.id,
        symbol: h.symbol,
        category: h.category,
        quantity: h.quantity,
        purchasePrice: h.purchasePrice,
        currentPrice,
        currentValue,
        currentWeight: 0, // computed after loop
        targetWeight: 0,
        drift: 0,
      });
    }

    if (totalValue <= 0) {
      return res.json({
        success: true,
        rebalance: {
          riskProfile,
          totalValue: 0,
          currentCryptoPct: 0,
          currentStockPct: 0,
          targetCryptoPct: targets.cryptoPct * 100,
          targetStockPct: targets.stockPct * 100,
          actions: [],
          summary: "Total nilai portofolio nol. Tidak dapat menghitung rebalancing.",
          driftScore: 0,
        },
      });
    }

    // Compute current weights
    for (const h of enriched) {
      h.currentWeight = h.currentValue / totalValue;
    }

    // Compute target weights per asset:
    //   - Allocate target category % equally across all assets in that category
    //   - Cap individual position at maxSinglePosition (if exceeded, redistribute)
    const cryptoHoldings = enriched.filter((h) => h.category === "crypto");
    const stockHoldings = enriched.filter((h) => h.category === "stock");

    const cryptoTargetPerAsset = cryptoHoldings.length > 0
      ? Math.min(targets.maxSinglePosition, targets.cryptoPct / cryptoHoldings.length)
      : 0;
    const stockTargetPerAsset = stockHoldings.length > 0
      ? Math.min(targets.maxSinglePosition, targets.stockPct / stockHoldings.length)
      : 0;

    for (const h of enriched) {
      h.targetWeight = h.category === "crypto" ? cryptoTargetPerAsset : stockTargetPerAsset;
      h.drift = h.currentWeight - h.targetWeight;
    }

    // Compute category-level stats
    const currentCryptoPct = cryptoHoldings.reduce((s, h) => s + h.currentWeight, 0) * 100;
    const currentStockPct = stockHoldings.reduce((s, h) => s + h.currentWeight, 0) * 100;

    // Generate actions per holding
    //   - |drift| < 5% → HOLD
    //   - drift > 5% → REDUCE (sell the excess)
    //   - drift < -5% → BUY (buy the deficit)
    //   - largest position > maxSinglePosition → SELL to cap
    const actions = enriched
      .filter((h) => h.currentValue > 0)
      .map((h) => {
        const driftPct = h.drift * 100;
        const targetValue = h.targetWeight * totalValue;
        const valueDelta = h.currentValue - targetValue;
        const absDriftPct = Math.abs(driftPct);

        let action: "HOLD" | "BUY" | "SELL" | "REDUCE";
        let suggestedAmount = 0; // USD amount to buy (+) or sell (-)
        let reason: string;

        if (h.currentWeight > targets.maxSinglePosition && valueDelta > 0) {
          // Position exceeds max single-position cap — SELL to bring it down to cap
          action = "SELL";
          const capValue = targets.maxSinglePosition * totalValue;
          suggestedAmount = -(h.currentValue - capValue);
          reason = `Posisi ${h.symbol} (${(h.currentWeight * 100).toFixed(1)}%) melebihi batas maksimum ${(targets.maxSinglePosition * 100).toFixed(0)}% untuk profil ${riskProfile}. Kurangi ke batas.`;
        } else if (absDriftPct < 5) {
          action = "HOLD";
          suggestedAmount = 0;
          reason = `Bobot ${h.symbol} (${(h.currentWeight * 100).toFixed(1)}%) sudah dekat dengan target ${(h.targetWeight * 100).toFixed(1)}%. Tidak perlu penyesuaian.`;
        } else if (driftPct > 0) {
          // Overweight — REDUCE
          action = "REDUCE";
          suggestedAmount = -valueDelta;
          reason = `${h.symbol} overweight ${(driftPct.toFixed(1))}% dari target. Jual ~$${Math.abs(valueDelta).toFixed(2)} untuk rebalance.`;
        } else {
          // Underweight — BUY
          action = "BUY";
          suggestedAmount = -valueDelta; // positive
          reason = `${h.symbol} underweight ${Math.abs(driftPct).toFixed(1)}% dari target. Beli ~$${Math.abs(valueDelta).toFixed(2)} untuk rebalance.`;
        }

        return {
          holdingId: h.id,
          symbol: h.symbol,
          category: h.category,
          currentValue: h.currentValue,
          currentWeightPct: h.currentWeight * 100,
          targetWeightPct: h.targetWeight * 100,
          driftPct,
          action,
          suggestedAmountUsd: Math.round(suggestedAmount * 100) / 100,
          reason,
        };
      })
      .sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct)); // most-drifted first

    // Overall drift score (0 = perfectly balanced, 100 = completely off-target)
    const driftScore = Math.min(
      100,
      Math.round(
        enriched.reduce((s, h) => s + Math.abs(h.drift), 0) * 50 // sum of abs drifts × 50
      )
    );

    // Summary
    const needsAction = actions.filter((a) => a.action !== "HOLD").length;
    const summary = needsAction === 0
      ? `Portofolio Anda sudah seimbang untuk profil risiko ${riskProfile}. Tidak ada penyesuaian signifikan yang diperlukan.`
      : `${needsAction} aset perlu rebalancing untuk profil risiko ${riskProfile}. Lihat saran tindakan di bawah.`;

    res.json({
      success: true,
      rebalance: {
        riskProfile,
        totalValue,
        currentCryptoPct,
        currentStockPct,
        targetCryptoPct: targets.cryptoPct * 100,
        targetStockPct: targets.stockPct * 100,
        maxSinglePositionPct: targets.maxSinglePosition * 100,
        actions,
        summary,
        driftScore,
        holdingsCount: enriched.length,
      },
    });
  } catch (e: any) {
    log.error("[rebalance] error:", e?.message || e);
    res.status(500).json({ success: false, error: "Gagal menghitung saran rebalancing." });
  }
});

// ============================================================================
// NEW FEATURE: Price Alert Checker
// ----------------------------------------------------------------------------
// Periodically fetches live prices for all unique symbols that have un-triggered
// alerts, evaluates each alert's condition (above/below), and marks triggered
// alerts with timestamp + the live price at trigger time. Runs every 30s.
// ============================================================================

// Simple in-memory price cache (symbol → { price, ts }) to avoid hitting
// Binance repeatedly when multiple alerts share a symbol.
const alertPriceCache = new Map<string, { price: number; ts: number }>();
const ALERT_PRICE_CACHE_TTL = 15_000; // 15s

async function fetchAlertPrice(symbol: string): Promise<number | null> {
  const now = Date.now();
  const cached = alertPriceCache.get(symbol);
  if (cached && now - cached.ts < ALERT_PRICE_CACHE_TTL) {
    return cached.price;
  }
  try {
    // Binance spot ticker — symbol like BTCUSDT
    const binanceSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : symbol.toUpperCase() + "USDT";
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
    if (!res.ok) return cached?.price ?? null;
    const data = (await res.json()) as any;
    const price = parseFloat(data.price);
    if (!Number.isFinite(price) || price <= 0) return cached?.price ?? null;
    alertPriceCache.set(symbol, { price, ts: now });
    return price;
  } catch {
    return cached?.price ?? null;
  }
}

async function runAlertChecker(): Promise<void> {
  try {
    // Only check alerts that haven't triggered yet.
    const activeAlerts = await prisma.alertConfig.findMany({
      where: { triggered: false },
      select: { id: true, userId: true, symbol: true, condition: true, targetPrice: true },
    });
    if (activeAlerts.length === 0) return;

    // Group by symbol to minimize upstream calls.
    const bySymbol = new Map<string, typeof activeAlerts>();
    for (const a of activeAlerts) {
      const list = bySymbol.get(a.symbol) ?? [];
      list.push(a);
      bySymbol.set(a.symbol, list);
    }

    const updates: Promise<any>[] = [];
    for (const [symbol, alerts] of bySymbol) {
      const price = await fetchAlertPrice(symbol);
      if (price == null) continue;
      for (const a of alerts) {
        const cond = a.condition?.toLowerCase();
        const hit = (cond === "above" && price >= a.targetPrice) || (cond === "below" && price <= a.targetPrice);
        if (hit) {
          updates.push(
            prisma.alertConfig.update({
              where: { id: a.id },
              data: {
                triggered: true,
                triggeredAt: new Date(),
                triggerPrice: price,
              },
            })
          );
        }
      }
    }
    if (updates.length > 0) {
      await Promise.allSettled(updates);
      log.info(`[alertChecker] Triggered ${updates.length} alert(s)`);
    }
  } catch (e: any) {
    log.error("[alertChecker] run error:", e?.message || e);
  }
}

// Start the background checker (30s interval, 10s initial delay).
let alertCheckerStarted = false;
export function startAlertChecker(): void {
  if (alertCheckerStarted) return;
  alertCheckerStarted = true;
  setTimeout(() => {
    runAlertChecker().catch((e) => log.error("[alertChecker] initial run:", e?.message || e));
  }, 10_000);
  setInterval(() => {
    runAlertChecker().catch((e) => log.error("[alertChecker] interval run:", e?.message || e));
  }, 30_000);
  log.info("[alertChecker] Started — runs every 30s (first run in 10s)");
}

// GET /api/portfolio/alerts/triggered — returns only alerts that fired since
// the provided `since` timestamp (so the UI can toast newly-triggered ones).
portfolioRouter.get("/alerts/triggered", async (req: Request, res: Response) => {
  try {
    const sinceRaw = req.query.since;
    const since = typeof sinceRaw === "string" ? new Date(sinceRaw) : new Date(0);
    const triggered = await prisma.alertConfig.findMany({
      where: {
        userId: req.user!.sub,
        triggered: true,
        triggeredAt: { gt: since },
      },
      orderBy: { triggeredAt: "desc" },
      take: 20,
    });
    res.json({ success: true, triggered });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal memuat alert terpicu." });
  }
});

// POST /api/portfolio/alerts/:id/acknowledge — mark a triggered alert as
// acknowledged by deleting it (UI calls this after showing the toast).
portfolioRouter.post("/alerts/:id/acknowledge", async (req: Request, res: Response) => {
  try {
    await prisma.alertConfig.delete({
      where: { id: req.params.id, userId: req.user!.sub },
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(404).json({ success: false, error: "Alert tidak ditemukan." });
  }
});
