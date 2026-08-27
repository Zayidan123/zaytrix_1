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
