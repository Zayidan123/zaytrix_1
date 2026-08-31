// ZAYTRIX portfolio sync helper (SEC2-DATA).
// Bridges the Zustand store (localStorage cache) with server-side persistence.
// On login: fetches all user data from server → populates store.
// On change: debounced sync pushes store data → server.
// Offline/anonymous: store continues to work with localStorage only.

import { useGlobalStore } from "../store";
import type { PortfolioAsset, LedgerTransaction, ConversionTransaction, AlertConfig } from "../types";

let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;

// FUNC-8: alert ids that are known to exist on the server (pushed by us or
// fetched from the server). Prevents the 2s-debounced sync from re-POSTing
// the whole alert list on every keystroke — the server POST creates a new row
// per call, so unguarded re-POSTs would duplicate alerts.
const syncedAlertIds = new Set<string>();

/** Mark an alert id as present on the server (skip future POSTs for it). */
export function markAlertSynced(id: string): void {
  if (id) syncedAlertIds.add(id);
}

// FUNC-8: push a single alert to the server (POST /api/portfolio/alerts).
// Body mirrors PriceAlertsWidget.tsx exactly:
//   { symbol, condition: "above"|"below", targetPrice, createdAt }
// plus the local `id` so the server row keeps the SAME id (the server's zod
// alertSchema accepts an optional id ≤100 chars and uses it as the row PK) —
// this makes DELETE /api/portfolio/alerts/:id work for locally-created alerts.
async function pushAlertToServer(alert: AlertConfig): Promise<boolean> {
  try {
    const res = await fetch("/api/portfolio/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        id: alert.id,
        symbol: (alert.symbol || "").toUpperCase(),
        condition: (alert.condition || "").toLowerCase(),
        targetPrice: alert.targetPrice,
        createdAt: alert.createdAt || new Date().toISOString(),
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data && data.success);
  } catch (e) {
    console.log("[portfolioSync] push alert failed:", e);
    return false;
  }
}

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

    // Conversions → conversionHistory — map server API fields to frontend type fields
    const convData = await conversionsRes.json();
    if (convData.success && Array.isArray(convData.conversions)) {
      const convs: ConversionTransaction[] = convData.conversions.map((c: any) => ({
        id: c.id,
        sourceSymbol: c.fromSymbol,
        sourceQty: c.fromAmount,
        sourcePrice: c.rate > 0 ? c.fromAmount / c.rate : 0,
        targetSymbol: c.toSymbol,
        targetQty: c.toAmount,
        targetPrice: c.rate > 0 ? c.toAmount * c.rate / c.fromAmount : 0,
        slippagePercent: 0,
        feePaidUsd: 0,
        timestamp: c.timestamp,
      }));
      store.conversionHistory = convs;
      try { localStorage.setItem("financara_conversions", JSON.stringify(convs)); } catch {}
    }

    // Alerts → alerts (FUNC-8: MERGE instead of blind overwrite).
    // Previous behaviour: `setAlerts(serverList)` blindly replaced the local
    // list — any locally-created alert that hadn't been synced yet (e.g. made
    // while offline, or in the 2s debounce window) was silently DESTROYED on
    // re-login. New behaviour:
    //   1. fetch the server list (source of truth for already-synced ids)
    //   2. find local alerts whose id is NOT on the server → push each via
    //      POST /api/portfolio/alerts (preserving the local id)
    //   3. after the push, the server list (+ any push failures) becomes the
    //      merged result written back to the store
    try {
      if (alertsRes.ok) {
        const alertsData = await alertsRes.json();
        if (alertsData.success && Array.isArray(alertsData.alerts)) {
          const serverAlerts: AlertConfig[] = alertsData.alerts.map((a: any) => ({
            id: a.id,
            symbol: a.symbol,
            // Server stores lowercase "above"/"below" (see portfolio.ts
            // alertSchema + runAlertChecker); the frontend AlertConfig type
            // uses uppercase — normalize here so TechnicalTerminal's
            // `al.condition === 'ABOVE'` checks keep working.
            condition: String(a.condition || "").toUpperCase() as AlertConfig["condition"],
            targetPrice: Number(a.targetPrice) || 0,
            intensity: "MEDIUM",
            isActive: !a.triggered,
            createdAt: a.createdAt || new Date().toISOString().split("T")[0],
          }));
          const serverIds = new Set(serverAlerts.map(a => a.id));
          serverAlerts.forEach(a => syncedAlertIds.add(a.id));

          // Push local-only alerts (not yet on the server) up.
          const localOnly = (store.alerts || []).filter(
            (a) => a && a.id && !serverIds.has(a.id) && !syncedAlertIds.has(a.id)
          );
          const pushed: AlertConfig[] = [];
          for (const la of localOnly) {
            const ok = await pushAlertToServer(la);
            if (ok) {
              syncedAlertIds.add(la.id);
              pushed.push(la);
            }
          }

          // Merged result: server list is the source of truth; append any
          // local alerts that were just pushed (or failed to push — they stay
          // visible locally and will be retried by the debounced sync).
          const merged = [...serverAlerts, ...pushed, ...localOnly.filter(la => !pushed.includes(la))];
          // Newest-first to match the store convention (addAlert prepends).
          merged.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
          store.setAlerts(merged);
        }
      }
    } catch (e) {
      console.log("[portfolioSync] alerts merge failed (offline?):", e);
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

    // Sync conversions — map frontend type fields to server API field names
    const conversions = store.conversionHistory.map((c: ConversionTransaction) => ({
      fromSymbol: c.sourceSymbol,
      fromAmount: c.sourceQty,
      toSymbol: c.targetSymbol,
      toAmount: c.targetQty,
      rate: c.sourcePrice > 0 ? c.targetPrice / c.sourcePrice : 0,
      timestamp: c.timestamp,
    }));
    await fetch("/api/portfolio/conversions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ conversions }),
    }).catch(() => {});

    // FUNC-8: Sync alerts — POST every alert that is not yet known to exist on
    // the server (see syncedAlertIds). The server has no bulk /alerts/sync
    // endpoint (only POST /api/portfolio/alerts per row), so the "array" is
    // pushed row-by-row with the local id preserved to keep ids aligned.
    const alertsToPush = store.alerts.filter((a: AlertConfig) => a && a.id && !syncedAlertIds.has(a.id));
    if (alertsToPush.length > 0) {
      await Promise.all(
        alertsToPush.map((a: AlertConfig) =>
          pushAlertToServer(a).then((ok) => {
            if (ok) syncedAlertIds.add(a.id);
          })
        )
      );
    }
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
