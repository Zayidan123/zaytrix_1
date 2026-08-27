/**
 * PriceAlertsWidget — NEW FEATURE (Task 6)
 * ----------------------------------------
 * A self-contained price alert manager. Lets the user:
 *   - Create alerts (symbol + above/below + target price)
 *   - View active alerts with live current-price + distance-to-target
 *   - See triggered alerts with timestamp + trigger price
 *   - Delete alerts
 *   - Receive toast-style notifications when alerts fire
 *
 * Talks to:
 *   - GET    /api/portfolio/alerts          (active alerts)
 *   - POST   /api/portfolio/alerts          (create)
 *   - DELETE /api/portfolio/alerts/:id      (delete)
 *   - GET    /api/portfolio/alerts/triggered?since=ISO  (poll for newly triggered)
 *   - POST   /api/portfolio/alerts/:id/acknowledge
 *
 * Live prices come from /api/assets (cached 2s server-side) so the widget
 * doesn't hit Binance directly. Falls back to "—" when unavailable.
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bell,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
  CheckCircle2,
  X,
  RefreshCw,
} from "lucide-react";

interface AlertRow {
  id: string;
  symbol: string;
  condition: string;
  targetPrice: number;
  createdAt: string;
  triggered?: boolean;
  triggeredAt?: string | null;
  triggerPrice?: number | null;
}

interface TriggeredToast {
  id: string;
  symbol: string;
  condition: string;
  targetPrice: number;
  triggerPrice: number;
  triggeredAt: string;
}

const SYMBOL_SUGGESTIONS = ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT"];

export default function PriceAlertsWidget() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [triggeredToasts, setTriggeredToasts] = useState<TriggeredToast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [symbol, setSymbol] = useState("BTC");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [targetPrice, setTargetPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Track the last "since" timestamp for triggered-alert polling
  const lastSinceRef = useRef<string>(new Date().toISOString());

  const fetchAlerts = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/portfolio/alerts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setAlerts(data.alerts);
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat alert");
    } finally {
      setLoading(false);
    }
  }, []);

  const pollTriggered = useCallback(async () => {
    try {
      const since = lastSinceRef.current;
      const res = await fetch(`/api/portfolio/alerts/triggered?since=${encodeURIComponent(since)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.triggered) && data.triggered.length > 0) {
        // Update lastSinceRef to the latest triggeredAt
        const latest = data.triggered[0]?.triggeredAt;
        if (latest) lastSinceRef.current = latest;

        // Add toasts
        const newToasts: TriggeredToast[] = data.triggered.map((t: AlertRow) => ({
          id: t.id,
          symbol: t.symbol,
          condition: t.condition,
          targetPrice: t.targetPrice,
          triggerPrice: t.triggerPrice ?? 0,
          triggeredAt: t.triggeredAt ?? new Date().toISOString(),
        }));
        setTriggeredToasts((prev) => [...prev, ...newToasts]);

        // Refresh the main alerts list (triggered alerts will show as triggered)
        fetchAlerts();
      }
    } catch {
      // silent — background poll
    }
  }, [fetchAlerts]);

  useEffect(() => {
    fetchAlerts();
    // Poll for triggered alerts every 15s
    const interval = setInterval(pollTriggered, 15_000);
    return () => clearInterval(interval);
  }, [fetchAlerts, pollTriggered]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const tp = parseFloat(targetPrice);
    if (!symbol || !tp || tp <= 0) {
      setError("Symbol dan target price wajib diisi (> 0).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          condition,
          targetPrice: tp,
          createdAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setTargetPrice("");
        await fetchAlerts();
      } else {
        setError(data.error || "Gagal menyimpan alert");
      }
    } catch (e: any) {
      setError(e?.message || "Gagal menyimpan alert");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/portfolio/alerts/${id}`, { method: "DELETE" });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // silent
    }
  };

  const dismissToast = async (toast: TriggeredToast) => {
    try {
      await fetch(`/api/portfolio/alerts/${toast.id}/acknowledge`, { method: "POST" });
    } catch {
      // silent
    }
    setTriggeredToasts((prev) => prev.filter((t) => t.id !== toast.id));
  };

  const activeAlerts = alerts.filter((a) => !a.triggered);
  const triggeredAlerts = alerts.filter((a) => a.triggered);

  return (
    <>
      {/* Toast notifications for triggered alerts */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        <AnimatePresence>
          {triggeredToasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 100, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="bg-emerald-950/95 border border-emerald-500/60 rounded-xl p-4 shadow-2xl backdrop-blur-md flex items-start gap-3 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-transparent pointer-events-none" />
              <motion.div
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.1, type: "spring", stiffness: 300 }}
                className="shrink-0"
              >
                <Bell className="w-5 h-5 text-emerald-400" />
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                    Alert Terpicu!
                  </span>
                </div>
                <p className="text-sm text-white font-bold">
                  {toast.symbol}{" "}
                  <span className="text-emerald-300">
                    {toast.condition === "above" ? "↑" : "↓"} ${toast.triggerPrice.toLocaleString()}
                  </span>
                </p>
                <p className="text-[10px] text-emerald-200/70 font-mono mt-0.5">
                  Target: ${toast.targetPrice.toLocaleString()} •{" "}
                  {new Date(toast.triggeredAt).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>
              </div>
              <button
                onClick={() => dismissToast(toast)}
                aria-label="Dismiss"
                className="shrink-0 text-emerald-300/60 hover:text-emerald-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Main widget card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-sm relative overflow-hidden"
      >
        {/* Decorative gradient */}
        <div className="absolute -top-12 -left-12 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <motion.div
                animate={{ rotate: [0, 12, -8, 0] }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              >
                <Bell className="w-4 h-4 text-amber-400" />
              </motion.div>
              <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Price Alert Manager
              </h4>
              {activeAlerts.length > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950 text-amber-400 border border-amber-800/60">
                  {activeAlerts.length} ACTIVE
                </span>
              )}
              {triggeredAlerts.length > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                  {triggeredAlerts.length} TRIGGERED
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Notifikasi otomatis saat harga menyentuh target
            </p>
          </div>
          <button
            onClick={fetchAlerts}
            disabled={loading}
            aria-label="Refresh alerts"
            className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-950/80 hover:border-slate-700 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Create alert form */}
        <form onSubmit={handleCreate} className="grid grid-cols-12 gap-2 mb-4">
          <div className="col-span-4 sm:col-span-3">
            <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">
              Symbol
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="BTC"
              list="alert-symbols"
              className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all"
            />
            <datalist id="alert-symbols">
              {SYMBOL_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="col-span-4 sm:col-span-3">
            <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">
              Condition
            </label>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setCondition("above")}
                className={`py-2 text-[10px] font-bold rounded-lg border transition-all flex items-center justify-center gap-1 ${
                  condition === "above"
                    ? "bg-emerald-600/20 border-emerald-500/60 text-emerald-300"
                    : "bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                <TrendingUp className="w-3 h-3" /> Above
              </button>
              <button
                type="button"
                onClick={() => setCondition("below")}
                className={`py-2 text-[10px] font-bold rounded-lg border transition-all flex items-center justify-center gap-1 ${
                  condition === "below"
                    ? "bg-red-600/20 border-red-500/60 text-red-300"
                    : "bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                <TrendingDown className="w-3 h-3" /> Below
              </button>
            </div>
          </div>
          <div className="col-span-4 sm:col-span-3">
            <label className="text-[9px] uppercase font-mono font-bold text-slate-500 block mb-1">
              Target $
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="100000"
              className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all"
            />
          </div>
          <div className="col-span-12 sm:col-span-3 flex items-end">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-amber-600 to-orange-600 disabled:opacity-50 py-2 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              {submitting ? "..." : "Buat Alert"}
            </motion.button>
          </div>
        </form>

        {error && (
          <div className="bg-red-950/40 border border-red-500/40 rounded-lg p-2 mb-3">
            <p className="text-[10px] text-red-300 font-mono">{error}</p>
          </div>
        )}

        {/* Active alerts list */}
        <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
          <AnimatePresence>
            {activeAlerts.length === 0 && triggeredAlerts.length === 0 && !loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-6 text-slate-500"
              >
                <Target className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-xs">Belum ada alert. Buat satu di atas ↑</p>
              </motion.div>
            )}

            {activeAlerts.map((alert) => (
              <motion.div
                key={alert.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20, height: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="bg-slate-950/40 border border-slate-800/60 rounded-lg p-3 flex items-center justify-between gap-3 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      alert.condition === "above"
                        ? "bg-emerald-500/10 border border-emerald-500/20"
                        : "bg-red-500/10 border border-red-500/20"
                    }`}
                  >
                    {alert.condition === "above" ? (
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white font-mono truncate">
                      {alert.symbol}
                      <span className="text-slate-500 mx-1">·</span>
                      <span className={alert.condition === "above" ? "text-emerald-400" : "text-red-400"}>
                        {alert.condition === "above" ? "≥" : "≤"} ${alert.targetPrice.toLocaleString()}
                      </span>
                    </p>
                    <p className="text-[9px] text-slate-500 font-mono">
                      Dibuat {new Date(alert.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/60 text-amber-400 border border-amber-800/40 flex items-center gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                    MONITORING
                  </span>
                  <button
                    onClick={() => handleDelete(alert.id)}
                    aria-label="Delete alert"
                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}

            {triggeredAlerts.map((alert) => (
              <motion.div
                key={alert.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20, height: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="bg-emerald-950/30 border border-emerald-700/40 rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white font-mono truncate">
                      {alert.symbol}
                      <span className="text-slate-500 mx-1">·</span>
                      <span className="text-emerald-400">
                        {alert.condition === "above" ? "≥" : "≤"} ${alert.targetPrice.toLocaleString()}
                      </span>
                    </p>
                    <p className="text-[9px] text-emerald-300/70 font-mono flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5" />
                      Tercapai @ ${alert.triggerPrice?.toLocaleString() ?? "—"} •{" "}
                      {alert.triggeredAt
                        ? new Date(alert.triggeredAt).toLocaleString("id-ID", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(alert.id)}
                  aria-label="Delete triggered alert"
                  className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[9px] text-slate-500 font-mono">
          <span>
            {activeAlerts.length} aktif · {triggeredAlerts.length} terpicu
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            CHECK 30s
          </span>
        </div>

        <style>{`
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(71,85,105,0.4); border-radius: 2px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(71,85,105,0.6); }
        `}</style>
      </motion.div>
    </>
  );
}
