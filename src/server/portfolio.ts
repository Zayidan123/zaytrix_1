// ZAYTRIX portfolio/ledger/backtest/conversion/alert persistence (SEC2-DATA).
// All endpoints require authentication. Data is scoped to the authenticated user.
// The frontend store (store.ts) syncs to these endpoints on login and on change.

import { Router, Request, Response } from "express";
import { prisma } from "./db";
import { requireAuth } from "./auth";
import { logAudit } from "./audit";

export const portfolioRouter = Router();
portfolioRouter.use(requireAuth);

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
    const { symbol, category, purchasePrice, quantity, notes, id } = req.body;
    if (!symbol || !category || purchasePrice == null || quantity == null) {
      return res.status(400).json({ success: false, error: "Field tidak lengkap." });
    }
    const holding = await prisma.portfolioHolding.create({
      data: {
        id: id || undefined,
        userId: req.user!.sub,
        symbol, category,
        purchasePrice: parseFloat(purchasePrice),
        quantity: parseFloat(quantity),
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
    const { holdings } = req.body; // array of {symbol, category, purchasePrice, quantity, notes}
    if (!Array.isArray(holdings)) {
      return res.status(400).json({ success: false, error: "Format data tidak valid." });
    }
    // Replace all holdings for this user (transactional delete+create)
    await prisma.$transaction([
      prisma.portfolioHolding.deleteMany({ where: { userId: req.user!.sub } }),
      ...holdings.map((h: any) => prisma.portfolioHolding.create({
        data: {
          userId: req.user!.sub,
          symbol: String(h.symbol || ""),
          category: String(h.category || "crypto"),
          purchasePrice: parseFloat(h.purchasePrice) || 0,
          quantity: parseFloat(h.quantity) || 0,
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
    const { id, timestamp, type, symbol, quantity, price, totalAmount, feePaidUsd, notes } = req.body;
    if (!type || !symbol || quantity == null || price == null) {
      return res.status(400).json({ success: false, error: "Field tidak lengkap." });
    }
    const tx = await prisma.ledgerTransaction.create({
      data: {
        id: id || undefined,
        userId: req.user!.sub,
        timestamp: timestamp || new Date().toISOString(),
        type, symbol,
        quantity: parseFloat(quantity),
        price: parseFloat(price),
        totalAmount: parseFloat(totalAmount) || parseFloat(quantity) * parseFloat(price),
        feePaidUsd: parseFloat(feePaidUsd) || 0,
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
    const { transactions } = req.body;
    if (!Array.isArray(transactions)) {
      return res.status(400).json({ success: false, error: "Format data tidak valid." });
    }
    await prisma.$transaction([
      prisma.ledgerTransaction.deleteMany({ where: { userId: req.user!.sub } }),
      ...transactions.map((t: any) => prisma.ledgerTransaction.create({
        data: {
          userId: req.user!.sub,
          timestamp: String(t.timestamp || new Date().toISOString()),
          type: String(t.type || "BUY"),
          symbol: String(t.symbol || ""),
          quantity: parseFloat(t.quantity) || 0,
          price: parseFloat(t.price) || 0,
          totalAmount: parseFloat(t.totalAmount) || 0,
          feePaidUsd: parseFloat(t.feePaidUsd) || 0,
          notes: t.notes || null,
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
  estimatedTaxIdr: number; // PMK-68 0.1% on proceeds
  notes: string[];
}

const PMK_68_TAX_RATE = 0.001; // 0.1% Indonesian crypto transaction tax
const USD_TO_IDR_FALLBACK = 15800;

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

    // PMK-68 estimated tax (0.1% of proceeds, in IDR)
    const estimatedTaxIdr = totalProceeds * PMK_68_TAX_RATE * USD_TO_IDR_FALLBACK;

    const notes: string[] = [];
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
    console.error("[tax-lots] error:", e?.message || e);
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
    console.error("[correlation-matrix] error:", e?.message || e);
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

    const USD_TO_IDR = 15800;
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
    const pmk68TaxIdr = pmk68TaxUsd * USD_TO_IDR;

    const realizedGainLossPct = totalCostBasis > 0 ? (totalRealizedGL / totalCostBasis) * 100 : 0;

    // Summary message
    let summary: string;
    if (totalRealizedGL > 0) {
      summary = `Tahun ${year}: Realized gain $${totalRealizedGL.toFixed(2)} (${realizedGainLossPct.toFixed(1)}%) dari ${yearTxs.length} transaksi. Estimasi pajak PMK-68 (0.1% dari proceeds): Rp ${pmk68TaxIdr.toLocaleString("id-ID", { maximumFractionDigits: 0 })}.`;
    } else if (totalRealizedGL < 0) {
      summary = `Tahun ${year}: Realized loss $${Math.abs(totalRealizedGL).toFixed(2)} (${Math.abs(realizedGainLossPct).toFixed(1)}%) dari ${yearTxs.length} transaksi. Estimasi pajak PMK-68 (0.1% dari proceeds): Rp ${pmk68TaxIdr.toLocaleString("id-ID", { maximumFractionDigits: 0 })}. Loss dapat dikompensasi di tahun berikutnya sesuai aturan pajak Indonesia.`;
    } else {
      summary = `Tahun ${year}: ${yearTxs.length} transaksi tercatat. Tidak ada realized gain/loss (hanya BUY atau hanya SELL parsial). Estimasi pajak PMK-68: Rp ${pmk68TaxIdr.toLocaleString("id-ID", { maximumFractionDigits: 0 })}.`;
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
    console.error("[tax-report] error:", e?.message || e);
    res.status(500).json({ success: false, error: "Gagal membuat laporan pajak." });
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
    const r = req.body;
    if (!r.symbol || !r.strategy) {
      return res.status(400).json({ success: false, error: "Field tidak lengkap." });
    }
    const result = await prisma.backtestResult.create({
      data: {
        userId: req.user!.sub,
        symbol: String(r.symbol),
        strategy: String(r.strategy),
        startDate: String(r.startDate || ""),
        endDate: String(r.endDate || ""),
        initialCapital: parseFloat(r.initialCapital) || 0,
        finalCapital: parseFloat(r.finalCapital) || 0,
        totalReturn: parseFloat(r.totalReturn) || 0,
        sharpeRatio: r.sharpeRatio != null ? parseFloat(r.sharpeRatio) : null,
        maxDrawdown: r.maxDrawdown != null ? parseFloat(r.maxDrawdown) : null,
        winRate: r.winRate != null ? parseFloat(r.winRate) : null,
        totalTrades: parseInt(r.totalTrades) || 0,
        equityCurve: JSON.stringify(r.equityCurve || []),
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
    const c = req.body;
    const conv = await prisma.conversionTransaction.create({
      data: {
        userId: req.user!.sub,
        fromSymbol: String(c.fromSymbol || ""),
        fromAmount: parseFloat(c.fromAmount) || 0,
        toSymbol: String(c.toSymbol || ""),
        toAmount: parseFloat(c.toAmount) || 0,
        rate: parseFloat(c.rate) || 0,
        timestamp: String(c.timestamp || new Date().toISOString()),
      },
    });
    res.json({ success: true, conversion: conv });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal menyimpan konversi." });
  }
});

portfolioRouter.post("/conversions/sync", async (req: Request, res: Response) => {
  try {
    const { conversions } = req.body;
    if (!Array.isArray(conversions)) {
      return res.status(400).json({ success: false, error: "Format tidak valid." });
    }
    await prisma.$transaction([
      prisma.conversionTransaction.deleteMany({ where: { userId: req.user!.sub } }),
      ...conversions.map((c: any) => prisma.conversionTransaction.create({
        data: {
          userId: req.user!.sub,
          fromSymbol: String(c.fromSymbol || ""),
          fromAmount: parseFloat(c.fromAmount) || 0,
          toSymbol: String(c.toSymbol || ""),
          toAmount: parseFloat(c.toAmount) || 0,
          rate: parseFloat(c.rate) || 0,
          timestamp: String(c.timestamp || new Date().toISOString()),
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
    const { symbol, condition, targetPrice, createdAt, id } = req.body;
    if (!symbol || !condition || targetPrice == null) {
      return res.status(400).json({ success: false, error: "Field tidak lengkap." });
    }
    const alert = await prisma.alertConfig.create({
      data: {
        id: id || undefined,
        userId: req.user!.sub,
        symbol: String(symbol),
        condition: String(condition),
        targetPrice: parseFloat(targetPrice),
        createdAt: String(createdAt || new Date().toISOString().split("T")[0]),
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
    console.error("[rebalance] error:", e?.message || e);
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
      console.log(`[alertChecker] Triggered ${updates.length} alert(s)`);
    }
  } catch (e: any) {
    console.error("[alertChecker] run error:", e?.message || e);
  }
}

// Start the background checker (30s interval, 10s initial delay).
let alertCheckerStarted = false;
export function startAlertChecker(): void {
  if (alertCheckerStarted) return;
  alertCheckerStarted = true;
  setTimeout(() => {
    runAlertChecker().catch((e) => console.error("[alertChecker] initial run:", e?.message || e));
  }, 10_000);
  setInterval(() => {
    runAlertChecker().catch((e) => console.error("[alertChecker] interval run:", e?.message || e));
  }, 30_000);
  console.log("[alertChecker] Started — runs every 30s (first run in 10s)");
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
