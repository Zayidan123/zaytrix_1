// =============================================================================
// PaperTrading.tsx — QA10-B (Direksi D — Paper Trading Engine, frontend).
// Panel simulasi order virtual market-only: dana virtual $10.000 per user,
// TIDAK ada order bursa nyata (simulasi lokal murni).
// Kontrak backend: src/server/paperTrading.ts (registerPaperTrading):
//   GET  /api/paper/account    → { success, account{cashUsd, startingUsd,
//                                equityUsd, positionsValueUsd, totalPnlUsd,
//                                totalPnlPct}, asOf }
//   GET  /api/paper/positions  → { success, positions[] } (PnL live)
//   GET  /api/paper/orders     → { success, orders[], limit }
//   POST /api/paper/order      → { symbol, side, quantity }
//   POST /api/paper/reset      → kembalikan kas + hapus orders & posisi
// Konvensi visual komponen ini (mengikuti identitas QA10): zinc-950/zinc-800/50,
// rounded-xl, aksen emerald (positif) / rose (negatif) / teal (identitas PAPER),
// angka font-mono, badge kecil uppercase. TANPA biru/indigo.
// CSRF: wrapper global window.fetch (main.tsx) otomatis memasang header
// X-CSRF-Token untuk POST — call-site tidak perlu melakukan apa pun.
// Polling 10 dtk (harga live /api/assets + akun + posisi) dengan refresh
// SENYAP (loading state hanya pada muat pertama), pola SystemLogsPanel.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Scale,
  Wallet,
  PieChart,
  TrendingUp,
  TrendingDown,
  History,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Info,
  Activity,
} from "lucide-react";

// ── Kontrak tipe (mirror respons server) ────────────────────────────────────
interface PaperAccountSummary {
  cashUsd: number;
  startingUsd: number;
  equityUsd: number;
  positionsValueUsd: number;
  totalPnlUsd: number;
  totalPnlPct: number;
}

interface PaperPositionRow {
  symbol: string;
  quantity: number;
  avgPriceUsd: number;
  livePriceUsd: number | null;
  marketValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  realizedPnlUsd: number;
  isStale: boolean;
}

interface PaperOrderRow {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  priceUsd: number;
  notionalUsd: number;
  feeUsd: number;
  status: string;
  createdAt: string;
}

interface CryptoAssetLite {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  isStale: boolean;
}

interface OrderSubmitResult {
  success: boolean;
  error?: string;
  order?: {
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    priceUsd: number;
    notionalUsd: number;
    feeUsd: number;
  };
}

// ── Konstanta ────────────────────────────────────────────────────────────────
const POLL_MS = 10_000; // polling 10 dtk (harga live + akun + posisi)
const FEE_RATE = 0.001; // 0,1% — harus cocok dengan PAPER_FEE_RATE server
const ORDERS_LIMIT = 100;

// ── Helper format (angka selalu font-mono di markup) ────────────────────────
const fmtUsd = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

// Harga adaptif: ≥ $1 → 2 desimal; < $1 → 8 desimal (PEPE/SHIB sub-sen).
const fmtPrice = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  const decimals = Math.abs(n) >= 1 ? 2 : 8;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

const fmtQty = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
};

const fmtPct = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
};

const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

// Format ringkas gaya Indonesia untuk badge dana virtual ("$10.000" — sesuai
// teks spec QA10-B; tabel tetap memakai fmtUsd en-US seperti konvensi app).
const fmtUsdBrief = (n: number): string =>
  `$${n.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;

// Kelas bersyarat warna PnL: emerald positif, rose negatif, zinc netral.
const pnlColor = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n) || n === 0) return "text-zinc-400";
  return n > 0 ? "text-emerald-400" : "text-rose-400";
};

// ── Komponen kecil: badge kecil uppercase (konvensi visual) ─────────────────
function MiniBadge({
  children,
  tone = "zinc",
  title,
}: {
  children: React.ReactNode;
  tone?: "zinc" | "teal" | "emerald" | "rose" | "amber";
  title?: string;
}) {
  const tones: Record<string, string> = {
    zinc: "bg-zinc-800/60 text-zinc-400 border-zinc-700/50",
    teal: "bg-teal-500/10 text-teal-300 border-teal-500/25",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
    rose: "bg-rose-500/10 text-rose-300 border-rose-500/25",
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border select-none ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

// ── Komponen utama ──────────────────────────────────────────────────────────
export default function PaperTrading() {
  // Data live dari server
  const [account, setAccount] = useState<PaperAccountSummary | null>(null);
  const [positions, setPositions] = useState<PaperPositionRow[]>([]);
  const [orders, setOrders] = useState<PaperOrderRow[]>([]);
  const [cryptoAssets, setCryptoAssets] = useState<CryptoAssetLite[]>([]);

  // State muat / error (loading hanya untuk muat PERTAMA; polling senyap)
  const [accountLoading, setAccountLoading] = useState(true);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [positionsError, setPositionsError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // Tiket order
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qtyInput, setQtyInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Reset 2-langkah (konfirmasi inline berbasis state — BUKAN window.confirm)
  const [resetArmed, setResetArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // ── Loader (pola SystemLogsPanel: silent=true → tanpa flip loading state) ──
  const loadAccount = useCallback(async (silent: boolean) => {
    if (!silent) setAccountLoading(true);
    try {
      const res = await fetch("/api/paper/account");
      if (!res.ok) {
        if (res.status === 401) throw new Error("Sesi tidak valid — silakan masuk kembali.");
        if (res.status === 429) throw new Error("Terlalu banyak permintaan — coba lagi beberapa saat.");
        throw new Error(`Server merespon dengan kode ${res.status}.`);
      }
      const json = (await res.json()) as { success: boolean; account?: PaperAccountSummary };
      if (!json.success || !json.account) throw new Error("Respons akun paper tidak valid.");
      setAccount(json.account);
      setAccountError(null);
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Gagal memuat akun paper trading.");
    } finally {
      if (!silent) setAccountLoading(false);
    }
  }, []);

  const loadPositions = useCallback(async (silent: boolean) => {
    if (!silent) setPositionsLoading(true);
    try {
      const res = await fetch("/api/paper/positions");
      if (!res.ok) {
        if (res.status === 401) throw new Error("Sesi tidak valid — silakan masuk kembali.");
        if (res.status === 429) throw new Error("Terlalu banyak permintaan — coba lagi beberapa saat.");
        throw new Error(`Server merespon dengan kode ${res.status}.`);
      }
      const json = (await res.json()) as { success: boolean; positions?: PaperPositionRow[] };
      if (!json.success || !Array.isArray(json.positions)) throw new Error("Respons posisi paper tidak valid.");
      setPositions(json.positions);
      setPositionsError(null);
    } catch (e) {
      setPositionsError(e instanceof Error ? e.message : "Gagal memuat posisi paper trading.");
    } finally {
      if (!silent) setPositionsLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await fetch(`/api/paper/orders?limit=${ORDERS_LIMIT}`);
      if (!res.ok) {
        if (res.status === 401) throw new Error("Sesi tidak valid — silakan masuk kembali.");
        if (res.status === 429) throw new Error("Terlalu banyak permintaan — coba lagi beberapa saat.");
        throw new Error(`Server merespon dengan kode ${res.status}.`);
      }
      const json = (await res.json()) as { success: boolean; orders?: PaperOrderRow[] };
      if (!json.success || !Array.isArray(json.orders)) throw new Error("Respons histori order tidak valid.");
      setOrders(json.orders);
      setOrdersError(null);
    } catch (e) {
      setOrdersError(e instanceof Error ? e.message : "Gagal memuat histori order paper.");
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  // Harga live kripto untuk pemilih symbol + preview biaya (endpoint publik).
  const loadAssets = useCallback(async () => {
    try {
      const res = await fetch("/api/assets");
      if (!res.ok) throw new Error(`Server merespon dengan kode ${res.status}.`);
      const json = (await res.json()) as {
        assets?: Array<{
          symbol?: string;
          name?: string;
          category?: string;
          price?: number;
          change24h?: number;
          isStale?: boolean;
        }>;
      };
      if (!Array.isArray(json.assets)) throw new Error("Respons daftar aset tidak valid.");
      const cryptos = json.assets
        .filter((a) => a.category === "crypto" && typeof a.symbol === "string")
        .map((a) => ({
          symbol: (a.symbol as string).toUpperCase(),
          name: typeof a.name === "string" ? a.name : (a.symbol as string),
          price: typeof a.price === "number" ? a.price : 0,
          change24h: typeof a.change24h === "number" ? a.change24h : 0,
          isStale: a.isStale === true,
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
      setCryptoAssets(cryptos);
      setAssetsError(null);
      setLastSync(new Date());
    } catch (e) {
      setAssetsError(e instanceof Error ? e.message : "Gagal memuat harga live.");
    }
  }, []);

  // Muat awal
  useEffect(() => {
    void loadAccount(false);
    void loadPositions(false);
    void loadOrders();
    void loadAssets();
  }, [loadAccount, loadPositions, loadOrders, loadAssets]);

  // Polling 10 dtk — refresh SENYAP (tidak mengganggu input pengguna).
  useEffect(() => {
    const t = setInterval(() => {
      void loadAssets();
      void loadAccount(true);
      void loadPositions(true);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [loadAssets, loadAccount, loadPositions]);

  // Symbol default = kripto pertama daftar (BTC) begitu daftar tersedia.
  const symbolInitialized = useRef(false);
  useEffect(() => {
    if (!symbolInitialized.current && cryptoAssets.length > 0) {
      symbolInitialized.current = true;
      setSymbol((prev) => (prev ? prev : cryptoAssets[0].symbol));
    }
  }, [cryptoAssets]);

  // Aset terpilih + harga live-nya (untuk preview estimasi biaya)
  const selectedAsset = useMemo(
    () => cryptoAssets.find((a) => a.symbol === symbol) ?? null,
    [cryptoAssets, symbol]
  );

  const qtyNum = useMemo(() => {
    const q = parseFloat(qtyInput);
    return Number.isFinite(q) && q > 0 ? q : null;
  }, [qtyInput]);

  // Preview estimasi biaya live (fee 0,1% — konsisten server)
  const preview = useMemo(() => {
    if (!selectedAsset || !qtyNum || selectedAsset.price <= 0) return null;
    const notional = selectedAsset.price * qtyNum;
    const fee = notional * FEE_RATE;
    return {
      notional,
      fee,
      buyTotal: notional + fee, // uang keluar saat BUY
      sellProceeds: notional - fee, // uang masuk saat SELL
    };
  }, [selectedAsset, qtyNum]);

  const canSubmit =
    !submitting && !!symbol && qtyNum !== null && !!selectedAsset && selectedAsset.price > 0;

  // ── Submit order (validasi server tetap otoritatif; ini hanya UX) ──
  const submitOrder = useCallback(async () => {
    if (!canSubmit || qtyNum === null) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const res = await fetch("/api/paper/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ symbol, side, quantity: qtyNum }),
      });
      const json = (await res.json().catch(() => null)) as OrderSubmitResult | null;
      if (!res.ok || !json?.success || !json.order) {
        throw new Error(json?.error || `Server menolak order virtual (kode ${res.status}).`);
      }
      const o = json.order;
      setSubmitSuccess(
        `Order virtual ${o.side === "BUY" ? "BELI" : "JUAL"} ${fmtQty(o.quantity)} ${o.symbol} TERISI di ${fmtPrice(o.priceUsd)} — notional ${fmtUsd(o.notionalUsd)}, fee ${fmtUsd(o.feeUsd)}. (Simulasi — tidak ada order bursa nyata.)`
      );
      setQtyInput("");
      // Segarkan data pasca-eksekusi (senyap + histori)
      void loadAccount(true);
      void loadPositions(true);
      void loadOrders();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Gagal mengirim order virtual.");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, qtyNum, symbol, side, loadAccount, loadPositions, loadOrders]);

  // ── Reset akun (2-langkah, konfirmasi inline state) ──
  const doReset = useCallback(async () => {
    if (resetting) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch("/api/paper/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        cleared?: { orders: number; positions: number };
      } | null;
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Server menolak reset (kode ${res.status}).`);
      }
      setResetArmed(false);
      setSubmitSuccess(
        `Akun paper direset: kas kembali ke dana awal, ${json.cleared?.orders ?? 0} order & ${json.cleared?.positions ?? 0} posisi virtual dihapus.`
      );
      setSubmitError(null);
      void loadAccount(true);
      void loadPositions(true);
      void loadOrders();
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Gagal mereset akun paper trading.");
    } finally {
      setResetting(false);
    }
  }, [resetting, loadAccount, loadPositions, loadOrders]);

  // Jumlah baris histori untuk badge header
  const orderCount = orders.length;

  return (
    <div className="space-y-6">
      {/* ── Header panel ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center shrink-0">
            <Scale className="w-5 h-5 text-teal-400" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-100 tracking-tight">
              Paper Trading
            </h2>
            <p className="text-xs text-zinc-500">
              Order virtual market-only · dana virtual · murni simulasi lokal
              (tanpa order bursa nyata)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MiniBadge tone="teal">DIREKSI D · QA10-B</MiniBadge>
          {lastSync && (
            <MiniBadge tone="zinc" title={`Harga live tersinkron ${fmtTime(lastSync.toISOString())}`}>
              <Activity className="w-2.5 h-2.5" aria-hidden="true" />
              LIVE 10s
            </MiniBadge>
          )}
        </div>
      </div>

      {/* ── 1) Kartu ringkasan akun ──────────────────────────────────── */}
      <section
        aria-label="Ringkasan akun paper trading"
        className="bg-zinc-950 border border-zinc-800/50 rounded-xl p-4 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-4 h-4 text-teal-400" aria-hidden="true" />
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-widest">
              Akun Virtual
            </h3>
            <MiniBadge tone="amber" title="Dana virtual simulasi — bukan uang nyata">
              PAPER · DANA VIRTUAL {fmtUsdBrief(account?.startingUsd ?? 10000)}
            </MiniBadge>
          </div>

          {/* Reset 2-langkah — konfirmasi inline (bukan window.confirm) */}
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => setResetArmed((v) => !v)}
              aria-expanded={resetArmed}
              aria-label="Reset akun paper trading ke dana awal"
              className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-3 py-2 rounded-lg border border-rose-500/30 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 hover:border-rose-500/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={resetting}
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              {resetting ? "MERESET…" : "RESET AKUN"}
            </button>
            <AnimatePresence>
              {resetArmed && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                  role="group"
                  aria-label="Konfirmasi reset akun paper"
                  className="flex flex-wrap items-center gap-2 justify-end bg-rose-950/40 border border-rose-500/25 rounded-lg px-3 py-2"
                >
                  <p className="text-[11px] text-rose-200/90 font-mono">
                    Hapus SEMUA order & posisi virtual + kembalikan kas ke{" "}
                    {fmtUsdBrief(account?.startingUsd ?? 10000)}?
                  </p>
                  <button
                    type="button"
                    onClick={() => void doReset()}
                    disabled={resetting}
                    className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold font-mono uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
                  >
                    YA, RESET
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetArmed(false)}
                    disabled={resetting}
                    className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-bold font-mono uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
                  >
                    BATAL
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {resetError && (
          <p role="alert" className="text-xs text-rose-400 font-mono flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {resetError}
          </p>
        )}

        {accountLoading && !account ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 rounded-lg bg-zinc-900/70 border border-zinc-800/50 animate-pulse"
                aria-label="Memuat ringkasan akun"
              />
            ))}
          </div>
        ) : accountError ? (
          <p role="alert" className="text-xs text-rose-400 font-mono flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {accountError}
          </p>
        ) : account ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 sm:p-4">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Equity
              </p>
              <p className="text-lg sm:text-xl font-mono font-bold text-teal-300 tabular-nums">
                {fmtUsd(account.equityUsd)}
              </p>
              <p className="text-[10px] text-zinc-600 font-mono mt-0.5">
                kas + nilai posisi (live)
              </p>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 sm:p-4">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Kas Virtual
              </p>
              <p className="text-lg sm:text-xl font-mono font-bold text-zinc-100 tabular-nums">
                {fmtUsd(account.cashUsd)}
              </p>
              <p className="text-[10px] text-zinc-600 font-mono mt-0.5">siap dipakai order</p>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 sm:p-4">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Nilai Posisi
              </p>
              <p className="text-lg sm:text-xl font-mono font-bold text-zinc-100 tabular-nums">
                {fmtUsd(account.positionsValueUsd)}
              </p>
              <p className="text-[10px] text-zinc-600 font-mono mt-0.5">
                {positions.length} simbol terbuka
              </p>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 sm:p-4">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 mb-1">
                PnL Total
              </p>
              <p
                className={`text-lg sm:text-xl font-mono font-bold tabular-nums ${pnlColor(account.totalPnlUsd)}`}
              >
                {fmtUsd(account.totalPnlUsd)}
              </p>
              <p className={`text-[10px] font-mono mt-0.5 ${pnlColor(account.totalPnlUsd)}`}>
                {fmtPct(account.totalPnlPct)} vs dana awal
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── 2) Tiket order + 3) tabel posisi (grid di desktop) ────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Tiket order */}
        <section
          aria-label="Tiket order virtual"
          className="bg-zinc-950 border border-zinc-800/50 rounded-xl p-4 sm:p-6 space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <TrendingUp className="w-4 h-4 text-teal-400" aria-hidden="true" />
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-widest">
              Tiket Order
            </h3>
            <MiniBadge tone="zinc">MARKET ONLY</MiniBadge>
          </div>

          {/* Side toggle BUY / SELL */}
          <div role="group" aria-label="Arah order" className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={side === "BUY"}
              onClick={() => setSide("BUY")}
              className={`py-2.5 rounded-lg text-sm font-bold font-mono uppercase tracking-wider border transition-colors cursor-pointer ${
                side === "BUY"
                  ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                  : "bg-zinc-900/50 border-zinc-800/50 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              BUY / BELI
            </button>
            <button
              type="button"
              aria-pressed={side === "SELL"}
              onClick={() => setSide("SELL")}
              className={`py-2.5 rounded-lg text-sm font-bold font-mono uppercase tracking-wider border transition-colors cursor-pointer ${
                side === "SELL"
                  ? "bg-rose-500/15 border-rose-500/50 text-rose-300"
                  : "bg-zinc-900/50 border-zinc-800/50 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              SELL / JUAL
            </button>
          </div>

          {/* Symbol picker (kripto live dari /api/assets) */}
          <div>
            <label
              htmlFor="paper-symbol"
              className="block text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 mb-1.5"
            >
              Simbol Kripto
            </label>
            <div className="flex items-center gap-2">
              <select
                id="paper-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                aria-label="Pilih simbol kripto untuk order virtual"
                className="flex-1 min-w-0 bg-zinc-900/70 border border-zinc-800/50 rounded-lg px-3 py-2.5 text-sm text-zinc-200 font-mono focus:outline-none focus:border-teal-500/60 cursor-pointer"
              >
                {cryptoAssets.length === 0 && (
                  <option value="">Memuat daftar kripto…</option>
                )}
                {cryptoAssets.map((a) => (
                  <option key={a.symbol} value={a.symbol}>
                    {a.symbol} — {a.name}
                  </option>
                ))}
              </select>
              {selectedAsset && (
                <div className="flex flex-col items-end shrink-0" aria-live="off">
                  <span className="text-sm font-mono font-bold text-zinc-200 tabular-nums">
                    {fmtPrice(selectedAsset.price)}
                  </span>
                  <span
                    className={`text-[10px] font-mono font-bold ${pnlColor(selectedAsset.change24h)}`}
                  >
                    {fmtPct(selectedAsset.change24h)} 24j
                  </span>
                </div>
              )}
            </div>
            {assetsError && (
              <p role="alert" className="text-[11px] text-amber-400/90 font-mono mt-1.5">
                Harga live: {assetsError}
              </p>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label
              htmlFor="paper-qty"
              className="block text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 mb-1.5"
            >
              Kuantitas
            </label>
            <input
              id="paper-qty"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="mis. 0.5"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              aria-label="Kuantitas order virtual"
              className="w-full bg-zinc-900/70 border border-zinc-800/50 rounded-lg px-3 py-2.5 text-sm text-zinc-200 font-mono tabular-nums focus:outline-none focus:border-teal-500/60 placeholder:text-zinc-600"
            />
          </div>

          {/* Preview estimasi biaya live */}
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 space-y-1.5">
            <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">
              Estimasi {side === "BUY" ? "Biaya" : "Hasil"} (harga live)
            </p>
            {preview ? (
              <dl className="text-xs font-mono space-y-1 tabular-nums">
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Notional</dt>
                  <dd className="text-zinc-200">{fmtUsd(preview.notional)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Fee (0,1%)</dt>
                  <dd className="text-zinc-200">{fmtUsd(preview.fee)}</dd>
                </div>
                <div className="flex justify-between border-t border-zinc-800/50 pt-1">
                  <dt className={side === "BUY" ? "text-emerald-400" : "text-teal-400"}>
                    {side === "BUY" ? "Total Keluar" : "Proses Masuk"}
                  </dt>
                  <dd className={side === "BUY" ? "text-emerald-300" : "text-teal-300"}>
                    {fmtUsd(side === "BUY" ? preview.buyTotal : preview.sellProceeds)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-zinc-600 font-mono">
                {selectedAsset && selectedAsset.price <= 0
                  ? "Harga live belum tersedia."
                  : "Masukkan kuantitas untuk melihat estimasi."}
              </p>
            )}
            {account && side === "BUY" && preview && (
              <p
                className={`text-[10px] font-mono ${
                  preview.buyTotal > account.cashUsd ? "text-rose-400" : "text-zinc-600"
                }`}
              >
                Kas tersedia {fmtUsd(account.cashUsd)}
                {preview.buyTotal > account.cashUsd ? " — TIDAK CUKUP" : ""}
              </p>
            )}
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={() => void submitOrder()}
            disabled={!canSubmit}
            aria-label={`Kirim order virtual ${side} ${symbol || "simbol"}`}
            className={`w-full py-3 rounded-lg text-sm font-bold font-mono uppercase tracking-widest border transition-colors cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
              side === "BUY"
                ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25"
                : "bg-rose-500/15 border-rose-500/50 text-rose-300 hover:bg-rose-500/25"
            }`}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                MENGEKSEKUSI…
              </>
            ) : (
              <>
                {side === "BUY" ? (
                  <TrendingUp className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <TrendingDown className="w-4 h-4" aria-hidden="true" />
                )}
                {side === "BUY" ? "BELI VIRTUAL" : "JUAL VIRTUAL"}
              </>
            )}
          </button>

          {/* Umpan balik submit (sukses / error) — inline, role=alert */}
          <AnimatePresence>
            {submitSuccess && (
              <motion.p
                key="ok"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role="status"
                className="text-[11px] text-emerald-300/90 font-mono leading-relaxed bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2 flex items-start gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                {submitSuccess}
              </motion.p>
            )}
            {submitError && (
              <motion.p
                key="err"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role="alert"
                className="text-[11px] text-rose-300/90 font-mono leading-relaxed bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2 flex items-start gap-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                {submitError}
              </motion.p>
            )}
          </AnimatePresence>

          <p className="text-[10px] text-zinc-600 font-mono leading-relaxed flex items-start gap-1.5">
            <Info className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
            Market order virtual dieksekusi di harga live saat submit (fee 0,1%
            × notional, maks $100.000 per order). Simulasi lokal — TIDAK ada
            order bursa nyata.
          </p>
        </section>

        {/* Tabel posisi (PnL live, polling 10 dtk senyap) */}
        <section
          aria-label="Posisi paper trading"
          className="bg-zinc-950 border border-zinc-800/50 rounded-xl p-4 sm:p-6 space-y-4 xl:col-span-2"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <PieChart className="w-4 h-4 text-teal-400" aria-hidden="true" />
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-widest">
              Posisi Terbuka
            </h3>
            <MiniBadge tone="zinc">{positions.length} SIMBOL</MiniBadge>
            <MiniBadge tone="teal" title="PnL belum direalisasi dihitung dari harga live (polling 10 detik)">
              PNL LIVE
            </MiniBadge>
          </div>

          {positionsLoading && positions.length === 0 ? (
            <div className="space-y-2" aria-label="Memuat posisi">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg bg-zinc-900/70 border border-zinc-800/50 animate-pulse"
                />
              ))}
            </div>
          ) : positionsError ? (
            <p role="alert" className="text-xs text-rose-400 font-mono flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {positionsError}
            </p>
          ) : positions.length === 0 ? (
            <div className="border border-dashed border-zinc-800/60 rounded-lg p-6 text-center">
              <p className="text-xs text-zinc-500 font-mono">
                Belum ada posisi terbuka — kirim order virtual pertama Anda
                dari tiket di samping.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-xs font-mono tabular-nums">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800/50">
                    <th scope="col" className="py-2 pr-3 font-bold">Simbol</th>
                    <th scope="col" className="py-2 pr-3 font-bold text-right">Qty</th>
                    <th scope="col" className="py-2 pr-3 font-bold text-right">Avg</th>
                    <th scope="col" className="py-2 pr-3 font-bold text-right">Live</th>
                    <th scope="col" className="py-2 pr-3 font-bold text-right">Nilai</th>
                    <th scope="col" className="py-2 pr-3 font-bold text-right">PnL Terbuka</th>
                    <th scope="col" className="py-2 font-bold text-right">Realisasi</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr
                      key={p.symbol}
                      className="border-b border-zinc-800/30 hover:bg-zinc-900/40 transition-colors"
                    >
                      <td className="py-2.5 pr-3">
                        <span className="text-zinc-200 font-bold">{p.symbol}</span>
                        {p.isStale && (
                          <MiniBadge
                            tone="amber"
                            title="Harga live tidak tersedia — nilai & PnL terbuka tidak dihitung"
                          >
                            STALE
                          </MiniBadge>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-zinc-300">
                        {fmtQty(p.quantity)}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-zinc-400">
                        {fmtPrice(p.avgPriceUsd)}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-zinc-200">
                        {fmtPrice(p.livePriceUsd)}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-zinc-200">
                        {fmtUsd(p.marketValueUsd)}
                      </td>
                      <td className={`py-2.5 pr-3 text-right ${pnlColor(p.unrealizedPnlUsd)}`}>
                        {fmtUsd(p.unrealizedPnlUsd)}
                        <span className="block text-[10px]">
                          {fmtPct(p.unrealizedPnlPct)}
                        </span>
                      </td>
                      <td className={`py-2.5 text-right ${pnlColor(p.realizedPnlUsd)}`}>
                        {fmtUsd(p.realizedPnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ── 4) Histori order (scroll max-h-96, styling scrollbar global) ── */}
      <section
        aria-label="Histori order virtual"
        className="bg-zinc-950 border border-zinc-800/50 rounded-xl p-4 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <History className="w-4 h-4 text-teal-400" aria-hidden="true" />
          <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-widest">
            Histori Order
          </h3>
          <MiniBadge tone="zinc">
            {orderCount} / {ORDERS_LIMIT} BARIS
          </MiniBadge>
          <MiniBadge tone="zinc">TERBARU DULU</MiniBadge>
        </div>

        {ordersLoading && orders.length === 0 ? (
          <div className="space-y-2" aria-label="Memuat histori order">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-10 rounded-lg bg-zinc-900/70 border border-zinc-800/50 animate-pulse"
              />
            ))}
          </div>
        ) : ordersError ? (
          <p role="alert" className="text-xs text-rose-400 font-mono flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {ordersError}
          </p>
        ) : orders.length === 0 ? (
          <div className="border border-dashed border-zinc-800/60 rounded-lg p-6 text-center">
            <p className="text-xs text-zinc-500 font-mono">
              Belum ada order virtual — histori akan muncul di sini setelah
              order pertama Anda terisi.
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto pr-1">
            <table className="w-full text-xs font-mono tabular-nums">
              <thead className="sticky top-0 bg-zinc-950">
                <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800/50">
                  <th scope="col" className="py-2 pr-3 font-bold">Waktu</th>
                  <th scope="col" className="py-2 pr-3 font-bold">Simbol</th>
                  <th scope="col" className="py-2 pr-3 font-bold">Side</th>
                  <th scope="col" className="py-2 pr-3 font-bold text-right">Qty</th>
                  <th scope="col" className="py-2 pr-3 font-bold text-right">Harga</th>
                  <th scope="col" className="py-2 pr-3 font-bold text-right">Notional</th>
                  <th scope="col" className="py-2 pr-3 font-bold text-right">Fee</th>
                  <th scope="col" className="py-2 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-zinc-800/30 hover:bg-zinc-900/40 transition-colors"
                  >
                    <td className="py-2.5 pr-3 text-zinc-500 whitespace-nowrap">
                      {fmtTime(o.createdAt)}
                    </td>
                    <td className="py-2.5 pr-3 text-zinc-200 font-bold">{o.symbol}</td>
                    <td className="py-2.5 pr-3">
                      {o.side === "BUY" ? (
                        <MiniBadge tone="emerald">BUY</MiniBadge>
                      ) : (
                        <MiniBadge tone="rose">SELL</MiniBadge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-zinc-300">
                      {fmtQty(o.quantity)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-zinc-300">
                      {fmtPrice(o.priceUsd)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-zinc-200">
                      {fmtUsd(o.notionalUsd)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-zinc-500">
                      {fmtUsd(o.feeUsd)}
                    </td>
                    <td className="py-2.5">
                      <MiniBadge tone="emerald" title="Order virtual market langsung terisi di harga live saat submit">
                        {o.status}
                      </MiniBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
