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
