import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { 
  Bell, 
  HelpCircle, 
  Moon, 
  Sun, 
  ShieldCheck, 
  X,
  Volume2,
  Clock,
  Sparkles,
  Info,
  Menu,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Command,
  LayoutDashboard,
  Layers,
  Newspaper,
  Coins,
  Radar,
  LineChart,
  MessageCircle,
  Files,
  BarChart3,
  Cpu,
  Wallet,
  Settings as SettingsIcon,
  Palette,
  LogOut,
  RotateCw,
  CandlestickChart,
  FlaskConical
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useGlobalStore } from "./store";
import { Asset, PortfolioAsset, AlertConfig, AppSettings } from "./types";
import { safeLocalStorage } from "./utils/safeStorage";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import AssetsHub from "./components/AssetsHub";
import Projections from "./components/Projections";
import Backtester from "./components/Backtester";
import TechnicalTerminal from "./components/TechnicalTerminal";
import ApiAutomation from "./components/ApiAutomation";
import SecurityCenter from "./components/SecurityCenter";
import MultiDocAnalysis from "./components/MultiDocAnalysis";
import AiSignals from "./components/AiSignals";
import MarketSentimentChat from "./components/MarketSentimentChat";
import OnChainData from "./components/OnChainData";
import DexRadar from "./components/DexRadar";
import PaperTrading from "./components/PaperTrading";
import Settings from "./components/Settings";
import Ledger from "./components/Ledger";
import NewsSection from "./components/NewsSection";
import PublicDataDashboard from "./components/PublicDataDashboard";
import CoinsRankings from "./components/CoinsRankings";
import { motion, AnimatePresence } from "motion/react";
// OPT-7: Firebase removed — server-side JWT+Prisma (/api/auth/me) is the sole
// auth source. The previous `auth` import from "./lib/firebase" is deleted.
import { logoutUser } from "./lib/auth";
import { fetchPortfolioFromServer, schedulePortfolioSync, markAlertSynced } from "./lib/portfolioSync";
import SplashScreen from "./components/SplashScreen";
// QA5-F2: global Ctrl+K command palette — keyboard-first navigation + actions.
import CommandPalette, { PaletteItem } from "./components/CommandPalette";

export default function App() {
  const [activeTab, setActiveTab ] = useState("dashboard");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return safeLocalStorage.getItem("sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [utcTime, setUtcTime] = useState(() => new Date().toISOString().substring(11, 19));

  // === QA5-F2 Command Palette (Ctrl+K / Cmd+K) ===
  const [paletteOpen, setPaletteOpen] = useState(false);
  const updateSettings = useGlobalStore(state => state.updateSettings);

  // Global keybinding: open with Ctrl+K (Windows/Linux) or Cmd+K (Mac).
  // Registered on window (capture) so it works regardless of which inner
  // component holds focus. The palette itself handles Esc/Enter/arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);



  // Quick Action state variables and handlers
  const [selectedQuickAsset, setSelectedQuickAsset] = useState<Asset | null>(null);
  const [quickActionType, setQuickActionType] = useState<"buy" | "sell" | "details" | "convert" | null>(null);
  const [quickQuantity, setQuickQuantity] = useState<string>("1");
  const [quickPrice, setQuickPrice] = useState<string>("");
  const [convertTargetSymbol, setConvertTargetSymbol] = useState<string>("");
  const [slippageTolerance, setSlippageTolerance] = useState<number>(0.5);

  const handleQuickAction = (asset: Asset, type: "buy" | "sell" | "details") => {
    setSelectedQuickAsset(asset);
    setQuickActionType(type);
    setQuickQuantity("1");
    setQuickPrice((asset.price ?? 0).toString());
  };

  const handleExecuteQuickBuy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQuickAsset) return;
    const qty = parseFloat(quickQuantity);
    const price = parseFloat(quickPrice);
    if (isNaN(qty) || qty <= 0) {
      alert("Masukkan jumlah unit yang valid!");
      return;
    }
    if (isNaN(price) || price <= 0) {
      alert("Masukkan harga beli yang valid!");
      return;
    }

    handleAddHolding({
      symbol: selectedQuickAsset.symbol,
      category: selectedQuickAsset.category,
      purchasePrice: price,
      quantity: qty
    });

    // Record BUY transaction to ledger
    addLedgerTransaction({
      id: `tx_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: "BUY",
      symbol: selectedQuickAsset.symbol,
      quantity: qty,
      price: price,
      totalAmount: qty * price,
      feePaidUsd: qty * price * 0.0005, // 0.05% estimated transaction fee
      notes: "Pembelian cepat via modal ticker berjalan"
    });

    setSelectedQuickAsset(null);
    setQuickActionType(null);
  };

  const handleExecuteQuickSell = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQuickAsset) return;
    const qty = parseFloat(quickQuantity);
    const price = parseFloat(quickPrice);
    if (isNaN(qty) || qty <= 0) {
      alert("Masukkan jumlah unit yang valid!");
      return;
    }
    if (isNaN(price) || price <= 0) {
      alert("Masukkan harga jual yang valid!");
      return;
    }

    // Sell execution (First-In, First-Out ledger or reducing holdings)
    const matchingHoldings = portfolio.filter(p => p.symbol === selectedQuickAsset.symbol);
    const totalOwned = matchingHoldings.reduce((sum, item) => sum + item.quantity, 0);

    if (totalOwned <= 0) {
      alert(`Anda tidak memiliki aset ${selectedQuickAsset.symbol} untuk dijual.`);
      return;
    }

    if (qty > totalOwned) {
      alert(`Jumlah penjualan (${qty}) melebihi total kepemilikan Anda (${totalOwned} unit).`);
      return;
    }

    // FIFO Realized PnL Calculation basis before reducing holdings
    let remainingToSell = qty;
    let totalCostBasisOfSoldUnits = 0;
    const reversedHoldings = [...matchingHoldings].reverse(); // oldest-first is at the back of the prepended list

    for (const h of reversedHoldings) {
      if (remainingToSell <= 0) break;
      const amountFromThisHolding = Math.min(h.quantity, remainingToSell);
      totalCostBasisOfSoldUnits += amountFromThisHolding * h.purchasePrice;
      remainingToSell -= amountFromThisHolding;
    }

    const averageCostBasisPrice = totalCostBasisOfSoldUnits / qty;
    const realizedPnL = (price - averageCostBasisPrice) * qty;

    // Execute FIFO selling reduction
    let remainingToReduce = qty;
    const updatedPortfolio = portfolio.map(holding => {
      if (holding.symbol === selectedQuickAsset.symbol && remainingToReduce > 0) {
        if (holding.quantity <= remainingToReduce) {
          remainingToReduce -= holding.quantity;
          return null;
        } else {
          const newQty = holding.quantity - remainingToReduce;
          remainingToReduce = 0;
          return { ...holding, quantity: newQty };
        }
      }
      return holding;
    }).filter((item): item is PortfolioAsset => item !== null);

    setPortfolio(updatedPortfolio);
    triggerSystemNotification(`Berhasil menjual ${qty} unit ${selectedQuickAsset.symbol} pada harga $${price.toLocaleString()}.`);

    // Record SELL transaction with Realized PnL to ledger
    addLedgerTransaction({
      id: `tx_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: "SELL",
      symbol: selectedQuickAsset.symbol,
      quantity: qty,
      price: price,
      totalAmount: qty * price,
      realizedPnL: realizedPnL,
      feePaidUsd: qty * price * 0.0005,
      notes: `Penjualan FIFO. Harga beli rata-rata unit terjual: $${averageCostBasisPrice < 0.01 ? averageCostBasisPrice.toFixed(6) : averageCostBasisPrice.toLocaleString()}`
    });

    setSelectedQuickAsset(null);
    setQuickActionType(null);
  };

  const handleExecuteQuickConvert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQuickAsset || !convertTargetSymbol) return;

    const sourceQty = parseFloat(quickQuantity);
    if (isNaN(sourceQty) || sourceQty <= 0) {
      alert("Masukkan jumlah unit konversi yang valid!");
      return;
    }

    const matchingHoldings = portfolio.filter(p => p.symbol === selectedQuickAsset.symbol);
    const totalOwned = matchingHoldings.reduce((sum, item) => sum + item.quantity, 0);

    if (totalOwned <= 0) {
      alert(`Anda tidak memiliki aset ${selectedQuickAsset.symbol} untuk dikonversi.`);
      return;
    }

    if (sourceQty > totalOwned) {
      alert(`Jumlah konversi (${sourceQty}) melebihi total kepemilikan Anda (${totalOwned} unit).`);
      return;
    }

    const targetAsset = liveAssets.find(a => a.symbol === convertTargetSymbol);
    if (!targetAsset) {
      alert("Aset tujuan konversi tidak ditemukan!");
      return;
    }

    const sourcePrice = selectedQuickAsset.price ?? 0;
    const targetPrice = targetAsset.price ?? 0;
    if (sourcePrice <= 0 || targetPrice <= 0) {
      alert("Harga aset tidak valid untuk melakukan perhitungan konversi.");
      return;
    }

    // Platform Fee 0.05%
    const platformFeeRate = 0.0005;
    const exchangeRate = sourcePrice / targetPrice;
    
    // Amount of target asset (before slippage & fee)
    const initialTargetQty = sourceQty * exchangeRate;
    const feePaidTarget = initialTargetQty * platformFeeRate;
    
    // final estimation containing slippage simulation deduction
    const targetQty = (initialTargetQty - feePaidTarget) * (1 - (slippageTolerance / 100));
    const feePaidUsd = sourceQty * sourcePrice * platformFeeRate;

    // FIFO Realized PnL on converted source asset
    let remainingToConvert = sourceQty;
    let sourceCostBasis = 0;
    const reversedSourceHoldings = [...matchingHoldings].reverse();

    for (const h of reversedSourceHoldings) {
      if (remainingToConvert <= 0) break;
      const amountFromThisHolding = Math.min(h.quantity, remainingToConvert);
      sourceCostBasis += amountFromThisHolding * h.purchasePrice;
      remainingToConvert -= amountFromThisHolding;
    }

    const sourceAverageCostBasis = sourceCostBasis / sourceQty;
    const realizedPnLOnSwap = (sourcePrice - sourceAverageCostBasis) * sourceQty;

    // Deduct source asset from portfolio using FIFO logic
    let remainingToSell = sourceQty;
    const portfolioAfterDeduction = portfolio.map(holding => {
      if (holding.symbol === selectedQuickAsset.symbol && remainingToSell > 0) {
        if (holding.quantity <= remainingToSell) {
          remainingToSell -= holding.quantity;
          return null;
        } else {
          const newQty = holding.quantity - remainingToSell;
          remainingToSell = 0;
          return { ...holding, quantity: newQty };
        }
      }
      return holding;
    }).filter((item): item is PortfolioAsset => item !== null);

    // Add target asset to portfolio
    const id = `p_${Math.random().toString(36).substring(2, 9)}`;
    const newTargetHolding: PortfolioAsset = {
      id,
      symbol: targetAsset.symbol,
      category: targetAsset.category,
      purchasePrice: targetPrice,
      quantity: targetQty,
      currentPrice: targetPrice
    };

    setPortfolio([newTargetHolding, ...portfolioAfterDeduction]);
    
    // Record to conversion history
    addConversionTransaction({
      id: `tx_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date().toISOString(),
      sourceSymbol: selectedQuickAsset.symbol,
      sourceQty,
      sourcePrice,
      targetSymbol: targetAsset.symbol,
      targetQty,
      targetPrice,
      slippagePercent: slippageTolerance,
      feePaidUsd
    });

    // Record SWAP to main ledger
    addLedgerTransaction({
      id: `tx_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: "SWAP",
      symbol: `${selectedQuickAsset.symbol} ➔ ${targetAsset.symbol}`,
      quantity: sourceQty,
      price: sourcePrice,
      totalAmount: sourceQty * sourcePrice,
      realizedPnL: realizedPnLOnSwap,
      feePaidUsd: feePaidUsd,
      notes: `Konversi aset (Swap). Cost basis asal: $${sourceAverageCostBasis.toLocaleString(undefined, { maximumFractionDigits: 4 })}/unit.`
    });

    triggerSystemNotification(`Sukses konversi: ${sourceQty} ${selectedQuickAsset.symbol} menjadi ${targetQty.toFixed(6)} ${targetAsset.symbol} (Fee: $${feePaidUsd.toFixed(2)}, Slip: ${slippageTolerance}%).`);

    setSelectedQuickAsset(null);
    setQuickActionType(null);
    setConvertTargetSymbol("");
  };

  const toggleSidebarCollapsed = () => {
    setIsSidebarCollapsed(prev => {
      const newVal = !prev;
      try {
        safeLocalStorage.setItem("sidebar_collapsed", String(newVal));
      } catch (e) {
        console.log(e);
      }
      return newVal;
    });
  };

  // Connect state declarations with Zustand global store
  const user = useGlobalStore(state => state.user);
  const setUser = useGlobalStore(state => state.setUser);
  // authReady flips true immediately in guest mode; SplashScreen is only the
  // visual loading phase before the dashboard.
  const [authReady, setAuthReady] = useState(false);
  const portfolio = useGlobalStore(state => state.portfolio);
  const alerts = useGlobalStore(state => state.alerts);
  const twoFactorEnabled = useGlobalStore(state => state.twoFactorEnabled);
  const setTwoFactorEnabled = useGlobalStore(state => state.setTwoFactorEnabled);
  const setPortfolio = useGlobalStore(state => state.setPortfolio);
  const setAlerts = useGlobalStore(state => state.setAlerts);
  const settings = useGlobalStore(state => state.settings);
  const addConversionTransaction = useGlobalStore(state => state.addConversionTransaction);
  const conversionHistory = useGlobalStore(state => state.conversionHistory);
  const addLedgerTransaction = useGlobalStore(state => state.addLedgerTransaction);

  // Zustand live price values and setters
  const liveBtcPrice = useGlobalStore(state => state.liveBtcPrice);
  const liveEthPrice = useGlobalStore(state => state.liveEthPrice);
  const liveBnbPrice = useGlobalStore(state => state.liveBnbPrice);
  const liveXrpPrice = useGlobalStore(state => state.liveXrpPrice);
  const liveSolPrice = useGlobalStore(state => state.liveSolPrice);
  const liveTrxPrice = useGlobalStore(state => state.liveTrxPrice);
  const liveHypePrice = useGlobalStore(state => state.liveHypePrice);
  const btcPriceChangePercent = useGlobalStore(state => state.btcPriceChangePercent);
  const ethPriceChangePercent = useGlobalStore(state => state.ethPriceChangePercent);
  const bnbPriceChangePercent = useGlobalStore(state => state.bnbPriceChangePercent);
  const xrpPriceChangePercent = useGlobalStore(state => state.xrpPriceChangePercent);
  const solPriceChangePercent = useGlobalStore(state => state.solPriceChangePercent);
  const trxPriceChangePercent = useGlobalStore(state => state.trxPriceChangePercent);
  const hypePriceChangePercent = useGlobalStore(state => state.hypePriceChangePercent);
  const updateBtcPrice = useGlobalStore(state => state.updateBtcPrice);
  const updateEthPrice = useGlobalStore(state => state.updateEthPrice);
  const updateBnbPrice = useGlobalStore(state => state.updateBnbPrice);
  const updateXrpPrice = useGlobalStore(state => state.updateXrpPrice);
  const updateSolPrice = useGlobalStore(state => state.updateSolPrice);
  const updateTrxPrice = useGlobalStore(state => state.updateTrxPrice);
  const updateHypePrice = useGlobalStore(state => state.updateHypePrice);
  const setTickerSource = useGlobalStore(state => state.setTickerSource);

  // === QA5-F2 palette items: navigation (15 tabs) + actions + themes ===
  // Built with useMemo so the palette's own memo/keyboard nav doesn't re-run
  // on unrelated re-renders. `setActiveTab` closes the mobile sidebar too,
  // matching the standard sidebar click behaviour.
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const navItems: PaletteItem[] = [
      { id: "nav-dashboard", name: "Dashboard", group: "NAVIGASI", icon: LayoutDashboard, hint: "ringkasan", action: () => { setActiveTab("dashboard"); setIsMobileSidebarOpen(false); } },
      { id: "nav-coins", name: "Coins Rankings", group: "NAVIGASI", icon: Layers, hint: "100 koin", keywords: "ranking coin market cap", action: () => { setActiveTab("coins"); setIsMobileSidebarOpen(false); } },
      { id: "nav-news", name: "Newsroom Feed", group: "NAVIGASI", icon: Newspaper, hint: "berita", keywords: "berita news the block", action: () => { setActiveTab("news"); setIsMobileSidebarOpen(false); } },
      { id: "nav-assets", name: "Crypto Hub", group: "NAVIGASI", icon: Coins, hint: "aset", keywords: "aset portfolio crypto hub wallet", action: () => { setActiveTab("assets"); setIsMobileSidebarOpen(false); } },
      { id: "nav-whale", name: "On-Chain Data & Whale Radar", group: "NAVIGASI", icon: Radar, hint: "whale", keywords: "onchain on-chain whale radar radar whale binance aggtrades", action: () => { setActiveTab("whale-tracker"); setIsMobileSidebarOpen(false); } },
      { id: "nav-dex", name: "DEX Radar", group: "NAVIGASI", icon: CandlestickChart, hint: "dex", keywords: "dex screener uniswap pool likuiditas pancakeswap aerodrome", action: () => { setActiveTab("dex"); setIsMobileSidebarOpen(false); } },
      { id: "nav-paper", name: "Paper Trading (Simulasi)", group: "NAVIGASI", icon: FlaskConical, hint: "paper", keywords: "paper trading simulasi virtual order posisi uji", action: () => { setActiveTab("paper"); setIsMobileSidebarOpen(false); } },
      { id: "nav-ai-signals", name: "AI Trade Signals", group: "NAVIGASI", icon: LineChart, hint: "sinyal", keywords: "ai sinyal signal trading", action: () => { setActiveTab("ai-signals"); setIsMobileSidebarOpen(false); } },
      { id: "nav-market-chat", name: "AI Market Chat", group: "NAVIGASI", icon: MessageCircle, hint: "chat", keywords: "ai chat percakapan gemini", action: () => { setActiveTab("market-chat"); setIsMobileSidebarOpen(false); } },
      { id: "nav-multi-doc", name: "AI Multi-Doc Compare", group: "NAVIGASI", icon: Files, hint: "dokumen", keywords: "dokumen document compare multi doc vip", action: () => { setActiveTab("multi-doc"); setIsMobileSidebarOpen(false); } },
      { id: "nav-projections", name: "Profit Projections", group: "NAVIGASI", icon: TrendingUp, hint: "proyeksi", keywords: "proyeksi profit projection dca", action: () => { setActiveTab("projections"); setIsMobileSidebarOpen(false); } },
      { id: "nav-backtester", name: "Strategy Backtester", group: "NAVIGASI", icon: BarChart3, hint: "backtest", keywords: "backtest strategi strategy tester", action: () => { setActiveTab("backtester"); setIsMobileSidebarOpen(false); } },
      { id: "nav-technical", name: "Technical Terminal", group: "NAVIGASI", icon: LineChart, hint: "teknikal", keywords: "teknikal technical terminal chart", action: () => { setActiveTab("technical"); setIsMobileSidebarOpen(false); } },
      { id: "nav-automation", name: "Trade Automation", group: "NAVIGASI", icon: Cpu, hint: "otomasi", keywords: "otomasi automation trading bot", action: () => { setActiveTab("automation"); setIsMobileSidebarOpen(false); } },
      { id: "nav-ledger", name: "Ledger History & Tax", group: "NAVIGASI", icon: Wallet, hint: "pajak", keywords: "ledger riwayat history pajak tax pnl", action: () => { setActiveTab("ledger"); setIsMobileSidebarOpen(false); } },
      { id: "nav-security", name: "Security & 2FA", group: "NAVIGASI", icon: ShieldCheck, hint: "keamanan", keywords: "keamanan security 2fa webauthn", action: () => { setActiveTab("security"); setIsMobileSidebarOpen(false); } },
      { id: "nav-settings", name: "Settings Hub", group: "NAVIGASI", icon: SettingsIcon, hint: "pengaturan", keywords: "pengaturan settings konfigurasi log", action: () => { setActiveTab("settings"); setIsMobileSidebarOpen(false); } },
    ];
    const themeLabels: { key: AppSettings["theme"]; label: string }[] = [
      { key: "glass-3d", label: "Glass 3D" },
      { key: "liquid-glass", label: "Liquid Glass" },
      { key: "cyber-3d", label: "Cyber 3D" },
      { key: "aurora-synth", label: "Aurora Synth" },
      { key: "holo-glass", label: "Holo Glass" },
      { key: "bloomberg", label: "Bloomberg" },
      { key: "hacker", label: "Hacker" },
      { key: "dark", label: "Dark" },
      { key: "light", label: "Light" },
    ];
    const themeItems: PaletteItem[] = themeLabels.map((t) => ({
      id: `theme-${t.key}`,
      name: `Tema: ${t.label}`,
      group: "TEMA",
      icon: Palette,
      hint: settings.theme === t.key ? "aktif" : undefined,
      keywords: `tema theme tampilan ${t.key}`,
      action: () => updateSettings({ theme: t.key }),
    }));
    const actionItems: PaletteItem[] = [
      {
        id: "action-reload",
        name: "Muat Ulang Aplikasi",
        group: "AKSI",
        icon: RotateCw,
        hint: "refresh",
        keywords: "muat ulang reload refresh hard reset",
        action: () => window.location.reload(),
      },
      {
        id: "action-glass",
        name: `${settings.glassmorphism ? "Matikan" : "Aktifkan"} Efek Glassmorphism`,
        group: "AKSI",
        icon: Sparkles,
        keywords: "glass glassmorphism efek blur transparan",
        action: () => updateSettings({ glassmorphism: !settings.glassmorphism }),
      },
      {
        id: "action-logout",
        name: "Keluar (Logout)",
        group: "AKSI",
        icon: LogOut,
        hint: "session",
        keywords: "keluar logout log out signout sesi",
        action: () => {
          logoutUser();
          setUser(guestUser);
          localStorage.clear();
        },
      },
    ];
    return [...navItems, ...themeItems, ...actionItems];
  }, [setActiveTab, settings.theme, settings.glassmorphism, updateSettings]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);


  // Ref tracking the WS reconnect timeout so it can be cleared on unmount (prevents memory leak)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // OPT-2c: exponential backoff counter for WS reconnect attempts.
  // Each failed reconnect doubles the delay (5s → 10s → 20s → 40s → 60s cap)
  // so a long Binance outage doesn't hammer the endpoint with a new WS handshake
  // every 5 seconds. Reset to 0 on a successful ws.onopen.
  const wsRetryCountRef = useRef(0);

  // GUEST MODE: user asked to skip login/register — splash → dashboard directly.
  // No /api/auth/me call, no session cookie, no AuthScreen. We set a guest user
  // so every component that reads `user.uid` / `user.email` / `user.displayName`
  // (Dashboard, Profile, Sidebar, SecurityCenter) keeps working without null
  // guards tripping. The guest user is a plain object — no server session exists.
  const guestUser = useMemo(() => ({
    id: "guest",
    uid: "guest",
    email: "guest@zaytrix.local",
    displayName: "Z-Capital Guest",
    twoFactorEnabled: false,
  }), []);
  useEffect(() => {
    setUser(guestUser);
    setTwoFactorEnabled(false);
    setAuthReady(true);
  }, [guestUser, setUser]);

  // SEC2-DATA: debounced server sync for portfolio/ledger/conversions.
  // Subscribes to store changes; when user is logged in, pushes data to server
  // after a 2s debounce. When logged out, no sync (localStorage still works).
  useEffect(() => {
    const unsub = useGlobalStore.subscribe((state) => {
      if (state.user) {
        schedulePortfolioSync();
      }
    });
    return () => unsub();
  }, []);

  // OPT-7: REMOVED the secondary Firebase `onAuthStateChanged` listener AND
  // the capture-phase window click-walker that intercepted Sidebar's logout
  // button by its `title` string. Both are obsolete now that:
  //   (1) /api/auth/me (called above) is the sole auth state source, and
  //   (2) Sidebar.tsx calls `logoutUser()` directly from its onClick handler.
  // This eliminates the dual-auth race + brittle DOM-walker noted in audit 2-c.

  // Dynamic real-time UTC clock updater
  useEffect(() => {
    const timer = setInterval(() => {
      setUtcTime(new Date().toISOString().substring(11, 19));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Safe client-side alert listener to map global window.alert mocks to elegant in-app notifications
  useEffect(() => {
    const handleSystemAlert = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string; type?: string }>;
      if (customEvent.detail && customEvent.detail.message) {
        triggerSystemNotification(customEvent.detail.message, true);
      }
    };
    window.addEventListener("system-alert", handleSystemAlert);
    return () => window.removeEventListener("system-alert", handleSystemAlert);
  }, []);

  // Sync notification configuration to server on mount to enable persistent server-side background alerts
  useEffect(() => {
    const config = useGlobalStore.getState().notificationConfig;
    if (config && (config.telegramEnabled || config.discordEnabled)) {
      fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      })
      .then(res => res.json())
      .then(data => console.log("[App Sync] Notification settings synced successfully on mount:", data))
      .catch(err => console.log("[App Sync] Background notification settings sync failed on mount:", err));
    }
  }, []);

  // Dynamic 3D lighting effect tracking cursor relative to viewport for the cyber-3d theme
  useEffect(() => {
    if (settings.theme !== 'cyber-3d' && settings.theme !== 'glass-3d') return;

    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      
      const root = document.documentElement;
      root.style.setProperty('--light-x', String(x));
      root.style.setProperty('--light-y', String(y));
      root.style.setProperty('--light-dx', String(-x));
      root.style.setProperty('--light-dy', String(-y));
      root.style.setProperty('--mouse-x', `${e.clientX}px`);
      root.style.setProperty('--mouse-y', `${e.clientY}px`);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [settings.theme]);

  // Real-time Centralised Spot Ticker Price Updates (WebSocket Stream with HTTP Fallback)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;
    let hypePollingTimer: NodeJS.Timeout | null = null;
    let isWsActive = false;

    // DATA-21: fetch the live HYPE price from public exchange APIs. The old
    // `|| 18.50` / `|| 5.60` fallbacks fabricated a price + change% when the
    // API failed — removed. On failure the store keeps its previous real
    // value (or 0 = "—" on cold start); no fake price is ever written.
    const fetchHypePrice = async () => {
      try {
        const res = await fetch("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=HYPE_USDT");
        if (res.ok) {
          const data = await res.json() as any;
          if (Array.isArray(data) && data.length > 0) {
            const price = parseFloat(data[0].last);
            const change = parseFloat(data[0].change_percentage);
            if (!isNaN(price) && price > 0) {
              updateHypePrice(price, isNaN(change) ? undefined : change);
            }
          }
        } else {
          const bybitRes = await fetch("https://api.bybit.com/v5/market/tickers?category=spot&symbol=HYPEUSDT");
          if (bybitRes.ok) {
            const bybitData = await bybitRes.json() as any;
            const item = bybitData?.result?.list?.[0];
            if (item) {
              const price = parseFloat(item.lastPrice);
              const change = parseFloat(item.price24hPcnt) * 100;
              if (!isNaN(price) && price > 0) {
                updateHypePrice(price, isNaN(change) ? undefined : change);
              }
            }
          }
        }
      } catch (e) {
        console.log("Error fetching HYPE price in App.tsx:", e);
      }
    };

    const connectWebSocket = () => {
      try {
        ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/bnbusdt@ticker/xrpusdt@ticker/solusdt@ticker/trxusdt@ticker");

        // QA-FIX (render storm): Binance mengirim pesan ticker per simbol tiap
        // ~1 dtk; 6 stream interleaved memicu burst Zustand set() → render
        // storm yang sempat memicu "Maximum update depth exceeded" di chart
        // recharts (tertangkap ErrorBoundary). Throttle per-simbol 1000ms —
        // pesan antar-jendela di-drop (nilai berikutnya selalu lebih segar),
        // tekanan render turun drastis tanpa mengurangi rasa "live".
        const lastTickerUpdate = new Map<string, number>();
        const TICKER_THROTTLE_MS = 1000;
        const throttledTickerUpdate = (
          key: string,
          price: number,
          changePercent: number,
          updater: (p: number, c?: number) => void
        ) => {
          const now = Date.now();
          const last = lastTickerUpdate.get(key) ?? 0;
          if (now - last >= TICKER_THROTTLE_MS) {
            lastTickerUpdate.set(key, now);
            updater(price, changePercent);
          }
        };
        
        ws.onopen = () => {
          isWsActive = true;
          setTickerSource("WebSocket");
          // OPT-2c: reset backoff counter on a successful connection so the next
          // outage starts again from the 5s base delay.
          wsRetryCountRef.current = 0;
        };

        ws.onmessage = async (event) => {
          try {
            let rawData = "";
            if (typeof event.data === "string") {
              rawData = event.data;
            } else if (event.data instanceof Blob) {
              rawData = await event.data.text();
            } else if (event.data && typeof event.data.toString === "function") {
              rawData = event.data.toString();
            }
            
            if (!rawData) return;
            const msg = JSON.parse(rawData);
            if (msg && msg.stream && msg.data) {
              const streamName = msg.stream;
              const data = msg.data;
              const price = parseFloat(data.c);
              const changePercent = parseFloat(data.P);
              
              if (streamName === "btcusdt@ticker" && !isNaN(price)) {
                throttledTickerUpdate("BTC", price, changePercent, updateBtcPrice);
              } else if (streamName === "ethusdt@ticker" && !isNaN(price)) {
                throttledTickerUpdate("ETH", price, changePercent, updateEthPrice);
              } else if (streamName === "bnbusdt@ticker" && !isNaN(price)) {
                throttledTickerUpdate("BNB", price, changePercent, updateBnbPrice);
              } else if (streamName === "xrpusdt@ticker" && !isNaN(price)) {
                throttledTickerUpdate("XRP", price, changePercent, updateXrpPrice);
              } else if (streamName === "solusdt@ticker" && !isNaN(price)) {
                throttledTickerUpdate("SOL", price, changePercent, updateSolPrice);
              } else if (streamName === "trxusdt@ticker" && !isNaN(price)) {
                throttledTickerUpdate("TRX", price, changePercent, updateTrxPrice);
              }
            }
          } catch (e) {
            console.log("Error parsing live Binance WebSocket message safely:", e);
          }
        };

        ws.onerror = (err) => {
          console.log("WebSocket error: Falling back to HTTP polling", err);
          isWsActive = false;
          setTickerSource("HTTP Polling");
        };

        ws.onclose = () => {
          isWsActive = false;
          setTickerSource("HTTP Polling");
          // OPT-2c: exponential backoff for reconnect (5s → 10s → 20s → 40s → 60s cap).
          // Replaces the previous fixed 5000ms delay that hammered Binance with a new
          // WS handshake every 5 seconds during a prolonged outage. The fallback HTTP
          // poller (4s interval) keeps ticker data flowing while we wait to retry WS.
          const delay = Math.min(5000 * Math.pow(2, wsRetryCountRef.current), 60000);
          wsRetryCountRef.current++;
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${wsRetryCountRef.current})`);
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connectWebSocket();
          }, delay);
        };
      } catch (err) {
        console.error("Failed to initialize WebSocket stream:", err);
      }
    };

    // Initialize Websocket connection and HYPE fetcher
    connectWebSocket();
    fetchHypePrice();
    hypePollingTimer = setInterval(fetchHypePrice, 5000);

    // Setup fallback HTTP poller that runs every 4 seconds
    fallbackTimer = setInterval(async () => {
      if (isWsActive) return; // Skip if WebSocket is active/streaming

      try {
        setTickerSource("HTTP Polling");
        const [btcRes, ethRes, bnbRes, xrpRes, solRes, trxRes] = await Promise.all([
          fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"),
          fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT"),
          fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BNBUSDT"),
          fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=XRPUSDT"),
          fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=SOLUSDT"),
          fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=TRXUSDT")
        ]);

        if (btcRes.ok) {
          const data = await btcRes.json();
          const p = parseFloat(data.lastPrice || data.price);
          if (!isNaN(p)) updateBtcPrice(p, parseFloat(data.priceChangePercent) || 0);
        }
        if (ethRes.ok) {
          const data = await ethRes.json();
          const p = parseFloat(data.lastPrice || data.price);
          if (!isNaN(p)) updateEthPrice(p, parseFloat(data.priceChangePercent) || 0);
        }
        if (bnbRes.ok) {
          const data = await bnbRes.json();
          const p = parseFloat(data.lastPrice || data.price);
          if (!isNaN(p)) updateBnbPrice(p, parseFloat(data.priceChangePercent) || 0);
        }
        if (xrpRes.ok) {
          const data = await xrpRes.json();
          const p = parseFloat(data.lastPrice || data.price);
          if (!isNaN(p)) updateXrpPrice(p, parseFloat(data.priceChangePercent) || 0);
        }
        if (solRes.ok) {
          const data = await solRes.json();
          const p = parseFloat(data.lastPrice || data.price);
          if (!isNaN(p)) updateSolPrice(p, parseFloat(data.priceChangePercent) || 0);
        }
        if (trxRes.ok) {
          const data = await trxRes.json();
          const p = parseFloat(data.lastPrice || data.price);
          if (!isNaN(p)) updateTrxPrice(p, parseFloat(data.priceChangePercent) || 0);
        }
      } catch (e) {
        console.log("Spot market info loading error:", e);
        // Stay in HTTP Polling state (the next interval iteration will retry the live fetch).
        // "Local Simulation" was removed because the synthetic micro-fluctuation generator was deleted;
        // tickerSource is now only ever "WebSocket" (live WS streaming) or "HTTP Polling" (REST fallback).
        setTickerSource("HTTP Polling");
      }
    }, 4000);

    return () => {
      // Clear any pending reconnect timeout before tearing down the socket (prevents memory leak / setState-on-unmounted).
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      }
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (hypePollingTimer) clearInterval(hypePollingTimer);
    };
  }, []);
  
  // Custom Disappearing Instant Alerts State Array
  const [notifications, setNotifications] = useState<{
    id: string;
    message: string;
    isDrastic: boolean;
    createdAt: number;
  }[]>([]);

  // DATA-20 (FALLBACK_LIVE_ASSETS removed): the previous code shipped a
  // hardcoded array of fake prices (BTC $68,420 / ETH $3,540 / SOL $165.5 /
  // BNB $595.2 …) shown whenever /api/assets failed — fabricating "live"
  // market data during an outage. Now:
  //   • queryFn THROWS on failure (no fake return) → React Query keeps the
  //     last successful `data` in cache → we render the last-known REAL prices
  //     with a visible amber "OFFLINE" badge.
  //   • if no successful response was ever received (cold start offline), the
  //     ticker shows an honest "Koneksi data pasar terputus" message instead
  //     of fabricated prices.
  const { data: serverAssets, isError: assetsRequestFailed, isLoading: assetsLoading } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: async () => {
      const res = await fetch("/api/assets");
      if (!res.ok) throw new Error(`Gagal mengambil data pasar (HTTP ${res.status}).`);
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Respon bukan JSON yang valid.");
      }
      const payload = await res.json();
      if (Array.isArray(payload) && payload.length > 0) {
        return payload as Asset[];
      }
      // success:false or empty payload — treat as an outage, keep last-known cache.
      throw new Error(payload?.error || "Data pasar kosong dari server.");
    },
    refetchInterval: 5000, // FUNC-7: relaxed from 2000ms to 5000ms — halves the request volume against the server rate limiter while still feeling live.
    refetchOnWindowFocus: false,
  });

  // Last-known REAL assets (React Query preserves `data` across errors).
  const rawLiveAssets = serverAssets && serverAssets.length > 0 ? serverAssets : [];
  // True when the latest poll failed — drives the OFFLINE badge / disconnect banner.
  const assetsOffline = assetsRequestFailed || (!assetsLoading && rawLiveAssets.length === 0);

  // Intercept raw asset values and override them with active centralized high-frequency prices.
  // The 7 streamed/polled coins (BTC, ETH, BNB, XRP, SOL, TRX, HYPE) are overridden with live
  // Zustand store values so the ticker marquee and quick-action modals never display stale
  // /api/assets prices when a fresh live value is already available in the store.
  // DATA-21: store prices initialize to 0 (no fake seeds) — a 0 value means
  // "WS not connected yet", so we only override when the store value is > 0.
  const liveAssets = React.useMemo(() => {
    return rawLiveAssets.map((asset) => {
      // Case-insensitive symbol matching so "btc"/"Btc"/"BTC" all resolve to the same override.
      const symbolUpper = (asset.symbol || "").toUpperCase();
      switch (symbolUpper) {
        case "BTC":
          return { ...asset, price: liveBtcPrice > 0 ? liveBtcPrice : asset.price, change24h: liveBtcPrice > 0 ? btcPriceChangePercent : asset.change24h };
        case "ETH":
          return { ...asset, price: liveEthPrice > 0 ? liveEthPrice : asset.price, change24h: liveEthPrice > 0 ? ethPriceChangePercent : asset.change24h };
        case "BNB":
          return { ...asset, price: liveBnbPrice > 0 ? liveBnbPrice : asset.price, change24h: liveBnbPrice > 0 ? bnbPriceChangePercent : asset.change24h };
        case "XRP":
          return { ...asset, price: liveXrpPrice > 0 ? liveXrpPrice : asset.price, change24h: liveXrpPrice > 0 ? xrpPriceChangePercent : asset.change24h };
        case "SOL":
          return { ...asset, price: liveSolPrice > 0 ? liveSolPrice : asset.price, change24h: liveSolPrice > 0 ? solPriceChangePercent : asset.change24h };
        case "TRX":
          return { ...asset, price: liveTrxPrice > 0 ? liveTrxPrice : asset.price, change24h: liveTrxPrice > 0 ? trxPriceChangePercent : asset.change24h };
        case "HYPE":
          return { ...asset, price: liveHypePrice > 0 ? liveHypePrice : asset.price, change24h: liveHypePrice > 0 ? hypePriceChangePercent : asset.change24h };
        default:
          return asset;
      }
    });
  }, [
    rawLiveAssets,
    liveBtcPrice, liveEthPrice, liveBnbPrice, liveXrpPrice, liveSolPrice, liveTrxPrice, liveHypePrice,
    btcPriceChangePercent, ethPriceChangePercent, bnbPriceChangePercent, xrpPriceChangePercent,
    solPriceChangePercent, trxPriceChangePercent, hypePriceChangePercent,
  ]);

  // Fetch real-time AI signal history to derive active sentiment next to price change marquee
  const { data: signalHistoryData } = useQuery<{ signals: any[] }>({
    queryKey: ['trading-signals-history'],
    queryFn: async () => {
      try {
        const res = await fetch("/api/trading-signals/history");
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {
        console.log("Error loading trading signals for header ticker:", e);
      }
      return { signals: [] };
    },
    refetchInterval: 12000,
  });

  const assetSentiments = React.useMemo(() => {
    const mapping: Record<string, "bullish" | "bearish"> = {};
    
    // Default fallback based on change24h if no signal is found
    if (Array.isArray(liveAssets)) {
      liveAssets.forEach((asset) => {
        if (asset && asset.symbol) {
          mapping[asset.symbol] = (asset.change24h ?? 0) >= 0 ? "bullish" : "bearish";
        }
      });
    }

    if (signalHistoryData && Array.isArray(signalHistoryData.signals)) {
      // Find the latest recorded signal for each symbol
      const sortedSignals = [...signalHistoryData.signals]
        .filter(sig => sig && sig.timestamp)
        .sort((a, b) => {
          const tA = new Date(a.timestamp).getTime() || 0;
          const tB = new Date(b.timestamp).getTime() || 0;
          return tA - tB;
        });
      
      sortedSignals.forEach(sig => {
        if (!sig || !sig.symbol) return;
        const rec = sig.recommendation;
        if (rec === "STRONG BUY" || rec === "BUY") {
          mapping[sig.symbol] = "bullish";
        } else if (rec === "STRONG SELL" || rec === "SELL") {
          mapping[sig.symbol] = "bearish";
        }
      });
    }

    return mapping;
  }, [liveAssets, signalHistoryData]);

  // Handle building standard notifications including 5-second auto-expiration!
  const triggerSystemNotification = (message: string, isDrastic: boolean = false) => {
    const newId = `notif_${Math.random().toString(36).substring(2, 9)}`;
    const newNotif = {
      id: newId,
      message,
      isDrastic,
      createdAt: Date.now()
    };

    setNotifications(prev => [newNotif, ...prev]);

    // Automatically dismiss the banner after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== newId));
    }, 5000);
  };

  const handleCloseNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // Add holding portfolio unit
  const handleAddHolding = (holding: Omit<PortfolioAsset, 'id' | 'currentPrice'>) => {
    const match = liveAssets.find(a => a.symbol === holding.symbol);
    const id = `p_${Math.random().toString(36).substring(2, 9)}`;
    const newHolding: PortfolioAsset = {
      id,
      ...holding,
      currentPrice: match ? match.price : holding.purchasePrice
    };
    setPortfolio([newHolding, ...portfolio]);
    triggerSystemNotification(`Berhasil menambahkan ${holding.symbol} sebanyak ${holding.quantity} unit ke portofolio.`);
  };

  const handleRemoveHolding = (id: string) => {
    const item = portfolio.find(p => p.id === id);
    if (item) {
      setPortfolio(portfolio.filter(p => p.id !== id));
      triggerSystemNotification(`Berhasil melikuidasi / mengeluarkan ${item.symbol} dari portofolio.`);
    }
  };

  // FUNC-8 (alert persistence): create an alert locally AND on the server
  // (POST /api/portfolio/alerts — same body shape as PriceAlertsWidget.tsx:
  // { symbol, condition: "above"|"below", targetPrice, createdAt } plus our
  // locally generated `id` so server + local ids match and DELETE works).
  // The server is the source of truth; on success the server-returned row is
  // stored (which may add `triggered` state). On failure the alert is still
  // created locally and will be pushed by portfolioSync on the next sync.
  const handleAddAlert = async (alert: Omit<AlertConfig, 'id' | 'createdAt'>) => {
    const id = `a_${Math.random().toString(36).substring(2, 9)}`;
    const createdAt = new Date().toISOString().split('T')[0];
    const newAlert: AlertConfig = {
      id,
      ...alert,
      createdAt
    };
    setAlerts([newAlert, ...alerts]);
    triggerSystemNotification(`Alarm target harga ${alert.symbol} di pasang sukses.`);

    // Server-side persistence (fire-and-forget, non-blocking UI).
    try {
      const res = await fetch("/api/portfolio/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id,
          symbol: alert.symbol.toUpperCase(),
          condition: (alert.condition || "").toLowerCase(), // server expects "above"/"below"
          targetPrice: alert.targetPrice,
          createdAt: new Date().toISOString()
        })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.alert) {
        // Replace the optimistic local row with the canonical server row.
        const canonicalId = data.alert.id || id;
        setAlerts([ { ...newAlert, id: canonicalId }, ...alerts ]);
        markAlertSynced(canonicalId);
      }
    } catch (e) {
      console.log("[App] Gagal menyimpan alert ke server (akan dicoba lagi saat sinkronisasi):", e);
    }
  };

  // FUNC-8: remove locally + DELETE /api/portfolio/alerts/:id server-side
  // (best-effort — offline removal still applies locally and the sync layer
  // handles the residue).
  const handleRemoveAlert = (id: string) => {
    setAlerts(alerts.filter(a => a.id !== id));
    fetch(`/api/portfolio/alerts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include"
    }).catch((e) => console.log("[App] Gagal menghapus alert dari server:", e));
  };

  // GUEST MODE: skip AuthScreen. SplashScreen → dashboard directly.
  // The 3-second SplashScreen animation acts as the only "loading" phase.
  if (!authReady) {
    return <SplashScreen onComplete={() => { /* no-op — authReady flips in useEffect above */ }} />;
  }


  return (
  <div className={`flex h-screen bg-[#05070A] text-slate-200 font-sans overflow-hidden relative theme-${settings.theme} ${settings.glassmorphism ? 'glassmorphism-active' : ''}`} id="zaytrix-app-root">
      {/* QA5-F2: global command palette overlay (Ctrl+K / Cmd+K) */}
      <CommandPalette open={paletteOpen} onClose={closePalette} items={paletteItems} />
      
      {/* High-tech sweep scanning telemetry line */}
      <div className="tech-sweep-line" />

      {/* Floating liquid glass background blobs for the liquid-glass theme */}
      {settings.theme === 'liquid-glass' && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="liquid-blob blob-1" />
          <div className="liquid-blob blob-2" />
          <div className="liquid-blob blob-3" />
          <div className="liquid-blob blob-4" />
        </div>
      )}

      {/* Floating 3D Wireframe Crystals for the cyber-3d theme */}
      {settings.theme === 'cyber-3d' && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="wireframe-crystal wireframe-crystal-1" />
          <div className="wireframe-crystal wireframe-crystal-2" />
        </div>
      )}

      {/* Mobile Drawer Backdrop overlay */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/70 z-30 transition-opacity duration-300 md:hidden animate-fade-in"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <div className={`fixed inset-y-0 left-0 z-40 transform md:transform-none transition-all duration-300 ease-in-out md:static md:block shrink-0 ${
        isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}>
        <Sidebar 
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          twoFactorEnabled={twoFactorEnabled} 
          onClose={() => setIsMobileSidebarOpen(false)}
          isCollapsed={isSidebarCollapsed}
          setIsCollapsed={setIsSidebarCollapsed}
        />
      </div>

      {/* Main Workspace Frame */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative" id="app-workspace-area">
        
        {/* Top Header Panel - Professional Polish Ticker style */}
        <header className="h-16 border-b border-slate-800 bg-[#0F172A] px-4 sm:px-6 flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center space-x-3 sm:space-x-4 overflow-hidden max-w-[80%] sm:max-w-[70%]">
            <button 
              onClick={() => setIsMobileSidebarOpen(true)}
              id="mobile-sidebar-toggle-btn"
              className="md:hidden p-1.5 text-slate-400 hover:text-slate-100 focus:outline-none rounded hover:bg-slate-800 shrink-0 cursor-pointer"
              title="Menu Utama"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button 
              onClick={toggleSidebarCollapsed}
              id="desktop-sidebar-toggle-btn"
              className="hidden md:flex p-1.5 text-slate-400 hover:text-slate-100 focus:outline-none rounded hover:bg-slate-800 shrink-0 cursor-pointer border border-[#1E293B] bg-slate-900/60"
              title={isSidebarCollapsed ? "Buka Sidebar" : "Tutup Sidebar"}
            >
              <Menu className="w-4 h-4" />
            </button>
            {/* QA5-F2: command palette trigger — discoverable entry point for the
                Ctrl+K overlay. Sits next to the sidebar toggle in the header. */}
            <button
              onClick={() => setPaletteOpen(true)}
              id="command-palette-trigger"
              className="flex items-center gap-1.5 p-1.5 text-slate-400 hover:text-emerald-300 focus:outline-none rounded hover:bg-slate-800 shrink-0 cursor-pointer border border-[#1E293B] bg-slate-900/60 transition-colors"
              title="Command Palette (Ctrl+K)"
              aria-label="Buka command palette (Ctrl+K)"
            >
              <Command className="w-4 h-4" />
              <kbd className="hidden lg:inline text-[9px] font-mono text-slate-500 border border-slate-700 bg-slate-800/70 rounded px-1 py-px leading-none">
                CTRL K
              </kbd>
            </button>
            <div className="hidden sm:flex items-center space-x-2 border-r border-[#1E293B] pr-4 select-none shrink-0 z-20 bg-[#0F172A]">
              <span className="text-[10px] font-mono font-bold text-amber-500 flex items-center">
                <span className={`w-1.5 h-1.5 rounded-full ${assetsOffline ? "bg-rose-500" : "bg-emerald-500"} animate-pulse inline-block mr-1.5`}></span>
                <span>{assetsOffline ? "PASAR:" : "BINANCE LIVE:"}</span>
              </span>
              {/* DATA-20: visible OFFLINE badge when /api/assets is unreachable. */}
              {assetsOffline && (
                <span className="text-[9px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/40 px-1.5 py-0.5 rounded" title="Permintaan data pasar terakhir gagal — menampilkan data terakhir yang diketahui.">
                  OFFLINE
                </span>
              )}
            </div>
            <div className="relative flex-1 overflow-hidden select-none pointer-events-auto" style={{ maskImage: 'linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)' }}>
              <div className="inline-flex whitespace-nowrap animate-marquee py-1 hover:[animation-play-state:paused] pointer-events-auto">
                {liveAssets.length > 0 ? (
                  (() => {
                    const cryptoAssets = liveAssets.filter(asset => asset && asset.category === "crypto");
                    // Quadruple the items to ensure wide screen coverage and smooth loop restart
                    return [...cryptoAssets, ...cryptoAssets, ...cryptoAssets, ...cryptoAssets].map((asset, idx) => {
                      if (!asset) return null;
                      const valChange = asset.change24h ?? 0;
                      const assetPrice = asset.price ?? 0;
                      const absoluteChange = valChange === -100 ? -assetPrice : assetPrice * (valChange / (100 + valChange));
                      const absValue = Math.abs(absoluteChange);

                      let absFormatted = "0.00";
                      if (!isNaN(absValue)) {
                        absFormatted = absValue < 0.01 
                          ? absValue.toFixed(6) 
                          : absValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      }

                      const absFormattedWithSign = (isNaN(absoluteChange) || absoluteChange >= 0)
                        ? `+$${absFormatted}` 
                        : `-$${absFormatted}`;
                      
                      const sentiment = (asset.symbol && assetSentiments[asset.symbol]) || (valChange >= 0 ? "bullish" : "bearish");
                      const isBullish = sentiment === "bullish";

                      const formattedPrice = assetPrice < 0.01 
                        ? assetPrice.toFixed(6) 
                        : assetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

                      return (
                        <div key={`${asset.id || idx}-${idx}`} className="inline-flex items-center space-x-2.5 mx-5 shrink-0 bg-slate-900/40 hover:bg-slate-900/80 border border-slate-800/60 hover:border-slate-700/80 px-3 py-1 rounded-full transition-all duration-200">
                          <span className="text-[10px] font-bold text-slate-100">{asset.name || ""} ({asset.symbol || ""})</span>
                          <span className="text-xs font-mono font-medium text-slate-300">
                            ${formattedPrice}
                          </span>
                          <span className={`inline-flex items-center space-x-1 text-[10px] font-mono font-bold ${valChange >= 0 ? "text-emerald-400" : "text-rose-500"}`} title={`AI Sentiment: ${isBullish ? 'Bullish' : 'Bearish'}`}>
                            <span>{valChange >= 0 ? "▲ +" : "▼ "}{valChange}%</span>
                            {isBullish ? (
                              <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-rose-500 shrink-0" />
                            )}
                          </span>

                          {/* Interactive Quick Action Buttons directly in ticker stream */}
                          <div className="flex items-center gap-1 pl-1.5 border-l border-slate-800">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickAction(asset, "buy");
                              }}
                              className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 border border-emerald-500/30 rounded transition-colors cursor-pointer"
                              title={`Beli ${asset.symbol} Instan`}
                            >
                              Buy
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickAction(asset, "sell");
                              }}
                              className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/30 rounded transition-colors cursor-pointer"
                              title={`Jual ${asset.symbol} Instan`}
                            >
                              Sell
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickAction(asset, "details");
                              }}
                              className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded transition-colors cursor-pointer"
                              title={`Detail Aset ${asset.symbol}`}
                            >
                              Detail
                            </button>
                          </div>
                        </div>
                      );
                    });
                  })()
                ) : assetsOffline ? (
                  // DATA-20: honest disconnect message — no fake prices, no crash.
                  <span className="text-xs font-mono text-rose-400 px-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    Koneksi data pasar terputus
                  </span>
                ) : (
                  <span className="text-xs font-mono text-slate-600 px-4">Menghubungkan ke data pasar…</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 sm:space-x-4 text-xs shrink-0 pl-2">
            {/* Real-time server uptime clocks - hidden on super small screens to protect space */}
            <div className="hidden sm:flex items-center space-x-2 text-slate-400 font-mono text-[10px]">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>UTC: {utcTime}</span>
            </div>

            <div className="hidden md:flex items-center space-x-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded text-[10px] font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>VAULT AES-256-GCM</span>
            </div>
          </div>
        </header>

        {/* Live Top Pop-up Notification Center for dynamic push warning triggers */}
        <div className="absolute top-4 right-4 z-50 space-y-2.5 max-w-sm w-full pointer-events-auto px-4 sm:px-0" id="notification-banner-group">
          <AnimatePresence>
            {notifications.map((notif) => (
              <motion.div 
                key={notif.id}
                initial={{ opacity: 0, x: 100, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 120, scale: 0.9, transition: { duration: 0.2 } }}
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 350, damping: 24 }}
                className={`p-4 rounded-lg shadow-2xl border-l-4 flex items-start gap-3 backdrop-blur-md ${
                  notif.isDrastic 
                    ? "bg-slate-900/95 text-rose-200 border-rose-500 ring-1 ring-rose-500/10" 
                    : "bg-slate-900/95 text-slate-200 border-blue-500 ring-1 ring-blue-500/10"
                }`}
                style={{ direction: 'ltr' }}
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-blue-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Peringatan Instan
                    </span>
                    <span className="text-[9px] text-slate-500 font-mono font-medium">Auto close 5s</span>
                  </div>
                  <p className="text-xs leading-relaxed font-semibold">{notif.message}</p>
                </div>
                
                {/* Manual close trigger button - User Requirement */}
                <button
                  onClick={() => handleCloseNotification(notif.id)}
                  id={`notif-close-btn-${notif.id}`}
                  className="text-slate-400 hover:text-slate-100 p-0.5 rounded transition-colors self-start cursor-pointer"
                  title="Close Manual"
                >
                  <X className="w-4 h-4 stroke-[2.5]" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Content view dispatcher with premium tab cross-fade and lift effect */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 12, scale: 0.993 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.993 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="w-full min-h-full"
            >
              {activeTab === "dashboard" && (
                <Dashboard 
                  assets={liveAssets} 
                  portfolio={portfolio} 
                  onAddHolding={handleAddHolding}
                  onRemoveHolding={handleRemoveHolding}
                />
              )}

              {activeTab === "news" && (
                <NewsSection />
              )}

              {activeTab === "data-sources" && (
                <PublicDataDashboard />
              )}

              {activeTab === "coins" && (
                <CoinsRankings />
              )}

              {activeTab === "assets" && (
                <AssetsHub assets={liveAssets} />
              )}

              {activeTab === "multi-doc" && (
                <MultiDocAnalysis />
              )}

              {activeTab === "projections" && (
                <Projections assets={liveAssets} />
              )}

              {activeTab === "backtester" && (
                <Backtester assets={liveAssets} />
              )}

              {activeTab === "technical" && (
                <TechnicalTerminal 
                  assets={liveAssets} 
                  alerts={alerts}
                  onAddAlert={handleAddAlert}
                  onRemoveAlert={handleRemoveAlert}
                  triggerSystemNotification={triggerSystemNotification}
                />
              )}

              {activeTab === "automation" && (
                <ApiAutomation />
              )}

              {activeTab === "ledger" && (
                <Ledger />
              )}

              {activeTab === "ai-signals" && (
                <AiSignals assets={liveAssets} />
              )}

              {activeTab === "market-chat" && (
                <MarketSentimentChat />
              )}

              {activeTab === "security" && (
                <SecurityCenter 
                  twoFactorEnabled={twoFactorEnabled} 
                  setTwoFactorEnabled={setTwoFactorEnabled} 
                />
              )}

              {activeTab === "whale-tracker" && (
                <OnChainData />
              )}

              {activeTab === "dex" && (
                <DexRadar />
              )}

              {activeTab === "paper" && (
                <PaperTrading />
              )}

              {activeTab === "settings" && (
                <Settings />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Quick Transaction Action Dialog (Buy / Sell / View Details) */}
        <AnimatePresence>
          {selectedQuickAsset && quickActionType && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 pointer-events-auto"
            >
              {/* Backdrop cancel */}
              <div 
                className="absolute inset-0 cursor-pointer" 
                onClick={() => {
                  setSelectedQuickAsset(null);
                  setQuickActionType(null);
                }}
              />
              
              {/* Modal Card content */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="bg-[#0F172A] border border-slate-800 rounded-2xl shadow-2xl p-6 max-w-md w-full relative z-10 text-slate-200"
              >
                <button 
                  onClick={() => {
                    setSelectedQuickAsset(null);
                    setQuickActionType(null);
                  }}
                  className="absolute top-4 right-4 p-1 rounded hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-100 cursor-pointer"
                  title="Tutup dialog"
                >
                  <X className="w-5 h-5" />
                </button>

                {quickActionType === "buy" && (
                  <form onSubmit={handleExecuteQuickBuy} className="space-y-4">
                    <div className="text-center pb-2 border-b border-slate-800">
                      <span className="inline-flex p-2 rounded-full bg-emerald-500/10 text-emerald-400 mb-2">
                        <TrendingUp className="w-6 h-6 animate-pulse" />
                      </span>
                      <h3 className="text-base font-bold text-slate-100 uppercase tracking-wide">
                        Transaksi Beli Instan
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {selectedQuickAsset.name} ({selectedQuickAsset.symbol})
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wide mb-1">
                          Harga Pasar (USD)
                        </label>
                        <input 
                          type="number" 
                          step="any"
                          value={quickPrice}
                          onChange={(e) => setQuickPrice(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wide mb-1">
                          Jumlah Unit ({selectedQuickAsset.symbol})
                        </label>
                        <input 
                          type="number" 
                          step="any" 
                          min="0.000001"
                          value={quickQuantity}
                          onChange={(e) => setQuickQuantity(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                          required
                          placeholder="0.00"
                        />
                      </div>

                      <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex justify-between items-center text-xs">
                        <span className="text-slate-400">Total Biaya Pembelian:</span>
                        <span className="text-sm font-mono font-bold text-emerald-400">
                          ${((parseFloat(quickQuantity) || 0) * (parseFloat(quickPrice) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedQuickAsset(null);
                          setQuickActionType(null);
                        }}
                        className="flex-1 py-2 rounded-lg border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-300 hover:text-slate-200 transition-colors cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-950/20 transition-all cursor-pointer"
                      >
                        Konfirmasi Beli
                      </button>
                    </div>
                  </form>
                )}

                {quickActionType === "sell" && (() => {
                  const ownedQty = portfolio
                    .filter(p => p.symbol === selectedQuickAsset.symbol)
                    .reduce((sum, item) => sum + item.quantity, 0);

                  return (
                    <form onSubmit={handleExecuteQuickSell} className="space-y-4">
                      <div className="text-center pb-2 border-b border-slate-800">
                        <span className="inline-flex p-2 rounded-full bg-rose-500/10 text-rose-400 mb-2">
                          <TrendingDown className="w-6 h-6 animate-pulse" />
                        </span>
                        <h3 className="text-base font-bold text-slate-100 uppercase tracking-wide">
                          Transaksi Jual Instan
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          {selectedQuickAsset.name} ({selectedQuickAsset.symbol})
                        </p>
                      </div>

                      <div className="space-y-3">
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex justify-between items-center text-xs">
                          <span className="text-slate-400">Kepemilikan Aktif:</span>
                          <span className="text-slate-200 font-mono font-semibold">
                            {ownedQty} {selectedQuickAsset.symbol}
                          </span>
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wide mb-1">
                            Harga Penjualan (USD)
                          </label>
                          <input 
                            type="number" 
                            step="any"
                            value={quickPrice}
                            onChange={(e) => setQuickPrice(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-rose-300 focus:outline-none focus:border-rose-500"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wide mb-1 font-semibold flex justify-between">
                            <span>Jumlah Unit Jual</span>
                            {ownedQty > 0 && (
                              <button
                                type="button"
                                onClick={() => setQuickQuantity(ownedQty.toString())}
                                className="text-[9px] text-blue-400 hover:text-blue-300 cursor-pointer"
                              >
                                Gunakan Semua Max
                              </button>
                            )}
                          </label>
                          <input 
                            type="number" 
                            step="any" 
                            min="0.000001"
                            max={ownedQty}
                            value={quickQuantity}
                            onChange={(e) => setQuickQuantity(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                            required
                            placeholder="0.00"
                            disabled={ownedQty <= 0}
                          />
                        </div>

                        <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex justify-between items-center text-xs">
                          <span className="text-slate-400">Total Penerimaan:</span>
                          <span className="text-sm font-mono font-bold text-rose-400">
                            ${((parseFloat(quickQuantity) || 0) * (parseFloat(quickPrice) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 flex gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedQuickAsset(null);
                            setQuickActionType(null);
                          }}
                          className="flex-1 py-2 rounded-lg border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-300 hover:text-slate-200 transition-colors cursor-pointer"
                        >
                          Batal
                        </button>
                        <button
                          type="submit"
                          disabled={ownedQty <= 0}
                          className="flex-1 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:hover:bg-rose-600 text-white text-xs font-semibold shadow-md shadow-rose-950/20 transition-all cursor-pointer"
                        >
                          Konfirmasi Jual
                        </button>
                      </div>
                    </form>
                  );
                })()}

                {quickActionType === "details" && (() => {
                  const ownedQty = portfolio
                    .filter(p => p.symbol === selectedQuickAsset.symbol)
                    .reduce((sum, item) => sum + item.quantity, 0);

                  const price = selectedQuickAsset.price ?? 0;
                  const change = selectedQuickAsset.change24h ?? 0;
                  const isPriceUp = change >= 0;

                  return (
                    <div className="space-y-4">
                      <div className="text-center pb-2 border-b border-slate-800">
                        <span className={`inline-flex p-2.5 rounded-full mb-2 ${isPriceUp ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                          <Info className="w-6 h-6 animate-pulse" />
                        </span>
                        <h3 className="text-base font-bold text-slate-100 uppercase tracking-wide">
                          Laporan Analitika Aset
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          {selectedQuickAsset.name} ({selectedQuickAsset.symbol})
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                          <span className="block text-[9px] uppercase font-mono text-slate-500 font-bold mb-0.5">Kategori</span>
                          <span className="text-slate-300 font-semibold uppercase">{selectedQuickAsset.category}</span>
                        </div>

                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                          <span className="block text-[9px] uppercase font-mono text-slate-500 font-bold mb-0.5">Kepemilikan Anda</span>
                          <span className="text-slate-300 font-mono font-semibold">{ownedQty} Unit</span>
                        </div>

                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                          <span className="block text-[9px] uppercase font-mono text-slate-500 font-bold mb-0.5">Harga Terkini</span>
                          <span className="text-slate-200 font-mono font-bold">
                            ${price < 0.01 ? price.toFixed(6) : price.toLocaleString()}
                          </span>
                        </div>

                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                          <span className="block text-[9px] uppercase font-mono text-slate-500 font-bold mb-0.5">Perubahan 24 Jam</span>
                          <span className={`font-mono font-bold ${isPriceUp ? "text-emerald-400" : "text-rose-500"}`}>
                            {isPriceUp ? "+" : ""}{change}%
                          </span>
                        </div>

                        <div className="col-span-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1">
                          <div className="flex justify-between">
                            <span className="text-[9px] uppercase font-mono text-slate-500 font-bold">Kapitalisasi Pasar</span>
                            <span className="text-slate-300 font-mono font-medium">${(selectedQuickAsset.marketCap ?? 0).toLocaleString()} USD</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[9px] uppercase font-mono text-slate-500 font-bold">Volume Perdagangan 24j</span>
                            <span className="text-slate-300 font-mono font-medium">${(selectedQuickAsset.volume24h ?? 0).toLocaleString()} USD</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-3 bg-slate-950/80 rounded-lg ring-1 ring-slate-800 text-[11px] leading-relaxed text-slate-400">
                        <span className="font-semibold text-slate-200 flex items-center gap-1.5 mb-1 text-xs">
                          <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Sentiment AI Core: {(selectedQuickAsset.symbol && assetSentiments[selectedQuickAsset.symbol]) === "bullish" ? "BULLISH" : "BEARISH"}
                        </span>
                        Berdasarkan feed dari bursa live, pergerakan tren short-term aset ({selectedQuickAsset.symbol}) menunjukkan momentum {(selectedQuickAsset.symbol && assetSentiments[selectedQuickAsset.symbol]) === "bullish" ? "positif (BULLISH)" : "negatif (BEARISH)"}. Anda direkomendasikan memantau support dan level resistansi fundamental.
                      </div>

                      <div className="flex gap-2 text-xs pt-1">
                        <button
                          onClick={() => {
                            setQuickActionType("buy");
                            setQuickQuantity("1");
                            setQuickPrice(price.toString());
                          }}
                          className="flex-1 py-4 md:py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold text-white transition-colors cursor-pointer text-center text-xs"
                        >
                          Beli Aset
                        </button>
                        <button
                          onClick={() => {
                            setQuickActionType("sell");
                            setQuickQuantity("1");
                            setQuickPrice(price.toString());
                          }}
                          disabled={ownedQty <= 0}
                          className="flex-1 py-4 md:py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 font-semibold text-white transition-colors cursor-pointer text-center text-xs"
                        >
                          Jual Aset
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setQuickActionType("convert");
                            setQuickQuantity("1");
                            // Set default conversion target to first available asset that is not the current one
                            const otherAssets = liveAssets.filter(a => a.symbol !== selectedQuickAsset.symbol);
                            if (otherAssets.length > 0) {
                              setConvertTargetSymbol(otherAssets[0].symbol);
                            } else {
                              setConvertTargetSymbol("");
                            }
                          }}
                          disabled={ownedQty <= 0}
                          className="flex-1 py-4 md:py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 font-semibold text-white transition-colors cursor-pointer text-center text-xs"
                        >
                          Convert
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedQuickAsset(null);
                          setQuickActionType(null);
                        }}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                      >
                        Tutup
                      </button>
                    </div>
                  );
                })()}

                {quickActionType === "convert" && (() => {
                  const ownedQty = portfolio
                    .filter(p => p.symbol === selectedQuickAsset.symbol)
                    .reduce((sum, item) => sum + item.quantity, 0);

                  const otherAssets = liveAssets.filter(a => a.symbol !== selectedQuickAsset.symbol);
                  const selectedTargetAsset = liveAssets.find(a => a.symbol === convertTargetSymbol);
                  
                  const sourcePrice = selectedQuickAsset.price ?? 0;
                  const targetPrice = selectedTargetAsset ? (selectedTargetAsset.price ?? 0) : 0;
                  
                  // Exchange rate: How many Target per 1 Source
                  const exchangeRate = targetPrice > 0 ? (sourcePrice / targetPrice) : 0;
                  
                  const sourceQtyVal = parseFloat(quickQuantity) || 0;
                  const estimatedTargetQty = sourceQtyVal * exchangeRate;

                  return (
                    <form onSubmit={handleExecuteQuickConvert} className="space-y-4">
                      <div className="text-center pb-2 border-b border-slate-800">
                        <span className="inline-flex p-2 rounded-full bg-blue-500/10 text-blue-400 mb-2">
                          <RefreshCw className="w-6 h-6 animate-spin" style={{ animationDuration: '6s' }} />
                        </span>
                        <h3 className="text-base font-bold text-slate-100 uppercase tracking-wide">
                          Konversi / Swap Aset
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          Tukar {selectedQuickAsset.name} ke Aset Lainnya
                        </p>
                      </div>

                      <div className="space-y-3">
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex justify-between items-center text-xs">
                          <span className="text-slate-400">Kepemilikan Aktif:</span>
                          <span className="text-slate-200 font-mono font-semibold">
                            {ownedQty} {selectedQuickAsset.symbol}
                          </span>
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wide mb-1 flex justify-between">
                            <span>Jumlah yang Dikonversi ({selectedQuickAsset.symbol})</span>
                            {ownedQty > 0 && (
                              <button
                                type="button"
                                onClick={() => setQuickQuantity(ownedQty.toString())}
                                className="text-[9px] text-blue-400 hover:text-blue-300 cursor-pointer font-bold uppercase tracking-wider"
                              >
                                Gunakan Semua Max
                              </button>
                            )}
                          </label>
                          <input 
                            type="number" 
                            step="any" 
                            min="0.000001"
                            max={ownedQty}
                            value={quickQuantity}
                            onChange={(e) => setQuickQuantity(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                            required
                            placeholder="0.00"
                            disabled={ownedQty <= 0}
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wide mb-1">
                            Aset Tujuan Konversi
                          </label>
                          <select
                            value={convertTargetSymbol}
                            onChange={(e) => setConvertTargetSymbol(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-sans text-slate-200 focus:outline-none focus:border-blue-500"
                            required
                          >
                            {otherAssets.map((asset) => (
                              <option key={asset.id} value={asset.symbol}>
                                {asset.name} ({asset.symbol}) — Price: ${asset.price < 0.01 ? asset.price?.toFixed(6) : asset.price?.toLocaleString()}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wide mb-1.5 flex justify-between">
                            <span>Slippage Tolerance (%)</span>
                            <span className="text-blue-400 font-semibold">{slippageTolerance}%</span>
                          </label>
                          <div className="flex items-center gap-2">
                            {([0.1, 0.5, 1.0] as const).map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setSlippageTolerance(preset)}
                                className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded cursor-pointer border ${
                                  slippageTolerance === preset
                                    ? "bg-blue-600 border-blue-500 text-white"
                                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                                }`}
                              >
                                {preset}%
                              </button>
                            ))}
                            <div className="relative flex-1">
                              <input
                                type="number"
                                step="0.1"
                                min="0.05"
                                max="10"
                                value={slippageTolerance}
                                onChange={(e) => setSlippageTolerance(parseFloat(e.target.value) || 0.5)}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono text-slate-200 focus:outline-none focus:border-blue-500 text-right pr-6"
                              />
                              <span className="absolute right-2 top-1 text-[9px] text-slate-500 font-bold">%</span>
                            </div>
                          </div>
                        </div>

                        {selectedTargetAsset && (() => {
                          const platformFeeRate = 0.0005;
                          const initialTargetQty = sourceQtyVal * exchangeRate;
                          const feePaidTarget = initialTargetQty * platformFeeRate;
                          const feePaidUsd = sourceQtyVal * sourcePrice * platformFeeRate;
                          const targetQtyReceived = (initialTargetQty - feePaidTarget) * (1 - (slippageTolerance / 100));

                          return (
                            <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg space-y-2 text-xs">
                              <div className="flex justify-between text-slate-400">
                                <span>Harga {selectedQuickAsset.symbol}:</span>
                                <span className="font-mono text-slate-200">${sourcePrice < 0.01 ? sourcePrice.toFixed(6) : sourcePrice.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between text-slate-400">
                                <span>Harga {selectedTargetAsset.symbol}:</span>
                                <span className="font-mono text-slate-200">${targetPrice < 0.01 ? targetPrice.toFixed(6) : targetPrice.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between border-t border-slate-900 pt-1.5 font-semibold">
                                <span className="text-slate-400">Nilai Tukar Estimasi:</span>
                                <span className="font-mono text-blue-400">1 {selectedQuickAsset.symbol} = {exchangeRate.toFixed(6)} {selectedTargetAsset.symbol}</span>
                              </div>
                              <div className="flex justify-between text-slate-400 border-t border-slate-900 pt-1.5">
                                <span>Biaya Platform (0.05%):</span>
                                <span className="font-mono text-rose-400">-${feePaidUsd < 0.01 ? feePaidUsd.toFixed(6) : feePaidUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })} USD</span>
                              </div>
                              <div className="flex justify-between text-blue-300 font-bold border-t border-slate-900 pt-1.5">
                                <span>Target Diterima (Min):</span>
                                <span className="font-mono text-emerald-400">{targetQtyReceived.toFixed(6)} {selectedTargetAsset.symbol}</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="pt-2 flex gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setQuickActionType("details");
                          }}
                          className="flex-1 py-2 rounded-lg border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-300 hover:text-slate-200 transition-colors cursor-pointer"
                        >
                          Kembali
                        </button>
                        <button
                          type="submit"
                          disabled={ownedQty <= 0 || !convertTargetSymbol || sourceQtyVal <= 0}
                          className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white text-xs font-semibold shadow-md shadow-blue-950/20 transition-all cursor-pointer"
                        >
                          Lakukan Swap
                        </button>
                      </div>
                    </form>
                  );
                })()}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status Bar/Footer with live parameters */}
        <footer className="h-8 bg-[#0F172A] border-t border-slate-800 px-4 sm:px-6 flex items-center justify-between z-10 text-[10px] text-slate-500 shrink-0 select-none">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="flex items-center space-x-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${assetsOffline ? "bg-rose-500" : "bg-emerald-500"} animate-pulse`} />
              <span className="uppercase tracking-tighter font-mono">
                CORE FEED: {assetsOffline ? "OFFLINE" : "ONLINE"}
              </span>
            </div>
            <div className="hidden sm:flex items-center space-x-1.5 border-l border-slate-800 pl-4">
              {twoFactorEnabled ? (
                <>
                  <span className="text-emerald-500 font-mono">✓</span>
                  <span className="uppercase tracking-tighter font-mono text-emerald-500">2FA ACTIVE & SECURED</span>
                </>
              ) : (
                <>
                  <span className="text-amber-500 font-mono">!</span>
                  <span className="uppercase tracking-tighter font-mono text-amber-500">2FA DISABLED</span>
                </>
              )}
            </div>
          </div>
          <div className="text-[9px] text-slate-600 font-mono uppercase hidden xs:block sm:block">ZAYTRIX SYSTEM CORE v3.3.0</div>
        </footer>
      </main>
    </div>
  );
}
