// ZAYTRIX portfolio sync helper (SEC2-DATA).
// Bridges the Zustand store (localStorage cache) with server-side persistence.
// On login: fetches all user data from server → populates store.
// On change: debounced sync pushes store data → server.
// Offline/anonymous: store continues to work with localStorage only.

import { useGlobalStore } from "../store";
import type { PortfolioAsset, LedgerTransaction, ConversionTransaction, AlertConfig } from "../types";

let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;

// ─── FETCH from server on login ──────────────────────────────────────
export async function fetchPortfolioFromServer(): Promise<boolean> {
  try {
    const [holdingsRes, ledgerRes, conversionsRes, alertsRes, backtestsRes] = await Promise.all([
      fetch("/api/portfolio/holdings", { credentials: "include" }),
      fetch("/api/portfolio/ledger", { credentials: "include" }),
      fetch("/api/portfolio/conversions", { credentials: "include" }),
      fetch("/api/portfolio/alerts", { credentials: "include" }),
      fetch("/api/portfolio/backtests", { credentials: "include" }),
    ]);

    if (!holdingsRes.ok) return false;

    const store = useGlobalStore.getState();

    // Holdings → portfolio
    const holdingsData = await holdingsRes.json();
    if (holdingsData.success && Array.isArray(holdingsData.holdings)) {
      const portfolio: PortfolioAsset[] = holdingsData.holdings.map((h: any) => ({
        id: h.id,
        symbol: h.symbol,
        category: h.category,
        purchasePrice: h.purchasePrice,
        quantity: h.quantity,
        notes: h.notes || undefined,
        purchaseDate: h.createdAt?.split("T")[0] || "",
      }));
      store.setPortfolio(portfolio);
    }

    // Ledger → ledgerHistory
    const ledgerData = await ledgerRes.json();
    if (ledgerData.success && Array.isArray(ledgerData.transactions)) {
      const txs: LedgerTransaction[] = ledgerData.transactions.map((t: any) => ({
        id: t.id,
        timestamp: t.timestamp,
        type: t.type,
        symbol: t.symbol,
        quantity: t.quantity,
        price: t.price,
        totalAmount: t.totalAmount,
        feePaidUsd: t.feePaidUsd,
        notes: t.notes || undefined,
      }));
      // Replace store ledger history (use a batch approach)
      store.ledgerHistory = txs;
      try { localStorage.setItem("financara_ledger", JSON.stringify(txs)); } catch {}
    }

    // Conversions → conversionHistory
    const convData = await conversionsRes.json();
    if (convData.success && Array.isArray(convData.conversions)) {
      const convs: ConversionTransaction[] = convData.conversions.map((c: any) => ({
        id: c.id,
        fromSymbol: c.fromSymbol,
        fromAmount: c.fromAmount,
        toSymbol: c.toSymbol,
        toAmount: c.toAmount,
        rate: c.rate,
        timestamp: c.timestamp,
      }));
      store.conversionHistory = convs;
      try { localStorage.setItem("financara_conversions", JSON.stringify(convs)); } catch {}
    }

    // Alerts → alerts
    const alertsData = await alertsRes.json();
    if (alertsData.success && Array.isArray(alertsData.alerts)) {
      const alerts: AlertConfig[] = alertsData.alerts.map((a: any) => ({
        id: a.id,
        symbol: a.symbol,
        condition: a.condition,
        targetPrice: a.targetPrice,
        createdAt: a.createdAt,
      }));
      store.setAlerts(alerts);
    }

    // Backtests → backtestHistory
    const btData = await backtestsRes.json();
    if (btData.success && Array.isArray(btData.results)) {
      store.backtestHistory = btData.results.map((r: any) => ({
        ...r,
        equityCurve: r.equityCurve ? JSON.parse(r.equityCurve) : [],
      }));
    }

    return true;
  } catch (e) {
    console.log("[portfolioSync] fetch failed (offline or not logged in):", e);
    return false;
  }
}

// ─── DEBOUNCED SYNC to server on store change ────────────────────────
export function schedulePortfolioSync(): void {
  if (isSyncing) return;
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncPortfolioToServer().catch(() => {});
  }, 2000); // 2s debounce
}

async function syncPortfolioToServer(): Promise<void> {
  isSyncing = true;
  try {
    const store = useGlobalStore.getState();
    // Only sync if user is logged in (check store.user)
    if (!store.user) {
      isSyncing = false;
      return;
    }

    // Sync holdings
    const holdings = store.portfolio.map((h: PortfolioAsset) => ({
      symbol: h.symbol,
      category: h.category,
      purchasePrice: h.purchasePrice,
      quantity: h.quantity,
      notes: h.notes || null,
    }));
    await fetch("/api/portfolio/holdings/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ holdings }),
    }).catch(() => {});

    // Sync ledger
    const transactions = store.ledgerHistory.map((t: LedgerTransaction) => ({
      id: t.id,
      timestamp: t.timestamp,
      type: t.type,
      symbol: t.symbol,
      quantity: t.quantity,
      price: t.price,
      totalAmount: t.totalAmount,
      feePaidUsd: t.feePaidUsd,
      notes: t.notes || null,
    }));
    await fetch("/api/portfolio/ledger/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ transactions }),
    }).catch(() => {});

    // Sync conversions
    const conversions = store.conversionHistory.map((c: ConversionTransaction) => ({
      fromSymbol: c.fromSymbol,
      fromAmount: c.fromAmount,
      toSymbol: c.toSymbol,
      toAmount: c.toAmount,
      rate: c.rate,
      timestamp: c.timestamp,
    }));
    await fetch("/api/portfolio/conversions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ conversions }),
    }).catch(() => {});
  } catch (e) {
    console.log("[portfolioSync] sync error:", e);
  } finally {
    isSyncing = false;
  }
}

// ─── Save a single backtest result ───────────────────────────────────
export async function saveBacktestResult(result: any): Promise<void> {
  try {
    await fetch("/api/portfolio/backtests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(result),
    });
  } catch (e) {
    console.log("[portfolioSync] save backtest failed:", e);
  }
}
