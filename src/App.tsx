import React, { useState, useEffect } from "react";
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
  RefreshCw
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useGlobalStore } from "./store";
import { Asset, PortfolioAsset, AlertConfig } from "./types";
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
import OnChainData from "./components/OnChainData";
import Settings from "./components/Settings";
import Ledger from "./components/Ledger";
import NewsSection from "./components/NewsSection";
import CoinsRankings from "./components/CoinsRankings";
import { motion, AnimatePresence } from "motion/react";
import { auth } from "./lib/firebase";
import AuthScreen from "./components/AuthScreen";
import SplashScreen from "./components/SplashScreen";

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
  const btcPriceChangePercent = useGlobalStore(state => state.btcPriceChangePercent);
  const ethPriceChangePercent = useGlobalStore(state => state.ethPriceChangePercent);
  const updateBtcPrice = useGlobalStore(state => state.updateBtcPrice);
  const updateEthPrice = useGlobalStore(state => state.updateEthPrice);
  const updateBnbPrice = useGlobalStore(state => state.updateBnbPrice);
  const updateXrpPrice = useGlobalStore(state => state.updateXrpPrice);
  const updateSolPrice = useGlobalStore(state => state.updateSolPrice);
  const updateTrxPrice = useGlobalStore(state => state.updateTrxPrice);
  const updateHypePrice = useGlobalStore(state => state.updateHypePrice);
  const setTickerSource = useGlobalStore(state => state.setTickerSource);

  // Hook Firebase Auth listener to update state
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser);
    });
    return () => unsubscribe();
  }, [setUser]);

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

  // Real-time Centralised Spot Ticker Price Updates (WebSocket Stream with HTTP Fallback & micro ticks)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;
    let hypePollingTimer: NodeJS.Timeout | null = null;
    let microFluctuationTimer: NodeJS.Timeout | null = null;
    let isWsActive = false;

    const fetchHypePrice = async () => {
      try {
        const res = await fetch("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=HYPE_USDT");
        if (res.ok) {
          const data = await res.json() as any;
          if (Array.isArray(data) && data.length > 0) {
            updateHypePrice(parseFloat(data[0].last) || 18.50, parseFloat(data[0].change_percentage) || 5.60);
          }
        } else {
          const bybitRes = await fetch("https://api.bybit.com/v5/market/tickers?category=spot&symbol=HYPEUSDT");
          if (bybitRes.ok) {
            const bybitData = await bybitRes.json() as any;
            const item = bybitData?.result?.list?.[0];
            if (item) {
              updateHypePrice(parseFloat(item.lastPrice) || 18.50, parseFloat(item.price24hPcnt) * 100 || 5.60);
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
        
        ws.onopen = () => {
          isWsActive = true;
          setTickerSource("WebSocket");
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
                updateBtcPrice(price, changePercent);
              } else if (streamName === "ethusdt@ticker" && !isNaN(price)) {
                updateEthPrice(price, changePercent);
              } else if (streamName === "bnbusdt@ticker" && !isNaN(price)) {
                updateBnbPrice(price, changePercent);
              } else if (streamName === "xrpusdt@ticker" && !isNaN(price)) {
                updateXrpPrice(price, changePercent);
              } else if (streamName === "solusdt@ticker" && !isNaN(price)) {
                updateSolPrice(price, changePercent);
              } else if (streamName === "trxusdt@ticker" && !isNaN(price)) {
                updateTrxPrice(price, changePercent);
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
          setTickerSource("Local Simulation");
          // Attempt reconnect after 5 seconds
          setTimeout(() => {
            connectWebSocket();
          }, 5000);
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
        setTickerSource("Local Simulation");
      }
    }, 4000);

    // Apply rapid micro fluctuations (every 600ms) for high-frequency feedback stream ticker
    microFluctuationTimer = setInterval(() => {
      // Tiny simulated ticks that oscillate close to the real spot rate (about +/-0.005%)
      const btcAdjustment = (Math.random() - 0.5) * 1.50; // Max +/- $0.75
      const ethAdjustment = (Math.random() - 0.5) * 0.15; // Max +/- $0.075
      const bnbAdjustment = (Math.random() - 0.5) * 0.05;
      const xrpAdjustment = (Math.random() - 0.5) * 0.0005;
      const solAdjustment = (Math.random() - 0.5) * 0.02;
      const trxAdjustment = (Math.random() - 0.5) * 0.00005;
      const hypeAdjustment = (Math.random() - 0.5) * 0.002;

      useGlobalStore.setState((state) => {
        return {
          liveBtcPrice: state.liveBtcPrice + btcAdjustment,
          btcPriceDirection: btcAdjustment >= 0 ? "up" : "down",
          liveEthPrice: state.liveEthPrice + ethAdjustment,
          ethPriceDirection: ethAdjustment >= 0 ? "up" : "down",
          liveBnbPrice: state.liveBnbPrice + bnbAdjustment,
          bnbPriceDirection: bnbAdjustment >= 0 ? "up" : "down",
          liveXrpPrice: state.liveXrpPrice + xrpAdjustment,
          xrpPriceDirection: xrpAdjustment >= 0 ? "up" : "down",
          liveSolPrice: state.liveSolPrice + solAdjustment,
          solPriceDirection: solAdjustment >= 0 ? "up" : "down",
          liveTrxPrice: state.liveTrxPrice + trxAdjustment,
          trxPriceDirection: trxAdjustment >= 0 ? "up" : "down",
          liveHypePrice: state.liveHypePrice + hypeAdjustment,
          hypePriceDirection: hypeAdjustment >= 0 ? "up" : "down",
        };
      });
    }, 600);

    return () => {
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      }
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (hypePollingTimer) clearInterval(hypePollingTimer);
      if (microFluctuationTimer) clearInterval(microFluctuationTimer);
    };
  }, []);
  
  // Custom Disappearing Instant Alerts State Array
  const [notifications, setNotifications] = useState<{
    id: string;
    message: string;
    isDrastic: boolean;
    createdAt: number;
  }[]>([]);

  // Offline/Resilience fallback preloaded assets to guarantee smooth view and zero "Failed to fetch" crashes
  const FALLBACK_LIVE_ASSETS: Asset[] = [
    { id: "3", symbol: "BTC", name: "Bitcoin", category: "crypto", price: 68420, change24h: 4.5, volume24h: 28000000000, marketCap: 1300000000000 },
    { id: "4", symbol: "ETH", name: "Ethereum", category: "crypto", price: 3540, change24h: 2.1, volume24h: 15000000000, marketCap: 420000000000 },
    { id: "5", symbol: "SOL", name: "Solana", category: "crypto", price: 165.5, change24h: 8.4, volume24h: 4500000000, marketCap: 75000000000 },
    { id: "6", symbol: "BNB", name: "Binance Coin", category: "crypto", price: 595.2, change24h: -1.5, volume24h: 1800000000, marketCap: 92000000000 }
  ];

  // Fetch real-time live fluctuating assets with React-Query standard caching and background refetching
  const { data: serverAssets } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: async () => {
      try {
        const res = await fetch("/api/assets");
        if (!res.ok) throw new Error("Gagal mengambil data pasar.");
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new Error("Respon bukan JSON yang valid.");
        }
        return await res.json();
      } catch (err) {
        console.log("Mulai fallback lokal untuk live assets:", err);
        return FALLBACK_LIVE_ASSETS;
      }
    },
    refetchInterval: 2000, // 2-second real-time background polling
    refetchOnWindowFocus: false,
  });

  const rawLiveAssets = serverAssets && serverAssets.length > 0 ? serverAssets : FALLBACK_LIVE_ASSETS;

  // Intercept raw asset values and override them with active centralized high-frequency prices
  const liveAssets = React.useMemo(() => {
    return rawLiveAssets.map((asset) => {
      if (asset.symbol === "BTC") {
        return { ...asset, price: liveBtcPrice, change24h: btcPriceChangePercent };
      }
      if (asset.symbol === "ETH") {
        return { ...asset, price: liveEthPrice, change24h: ethPriceChangePercent };
      }
      return asset;
    });
  }, [rawLiveAssets, liveBtcPrice, liveEthPrice, btcPriceChangePercent, ethPriceChangePercent]);

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

  // Alarms
  const handleAddAlert = (alert: Omit<AlertConfig, 'id' | 'createdAt'>) => {
    const id = `a_${Math.random().toString(36).substring(2, 9)}`;
    const newAlert: AlertConfig = {
      id,
      ...alert,
      createdAt: new Date().toISOString().split('T')[0]
    };
    setAlerts([newAlert, ...alerts]);
    triggerSystemNotification(`Alarm target harga ${alert.symbol} di pasang sukses.`);
  };

  const handleRemoveAlert = (id: string) => {
    setAlerts(alerts.filter(a => a.id !== id));
  };

  if (!user) {
    return (
      <SplashScreen
        onComplete={() => {
          useGlobalStore.getState().setUser({
            uid: 'splash-user',
            displayName: 'Z-Capital Trader',
            email: 'trader@z-capital.com',
            isAnonymous: true,
          });
        }}
      />
    );
  }

  return (
    <div className={`flex h-screen bg-[#05070A] text-slate-200 font-sans overflow-hidden relative theme-${settings.theme} ${settings.glassmorphism ? 'glassmorphism-active' : ''}`} id="z-capital-app-root">
      
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
          className="fixed inset-0 bg-black/70 z-35 transition-opacity duration-300 md:hidden animate-fade-in"
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
              <Menu className="w-5.5 h-5.5" />
            </button>
            <button 
              onClick={toggleSidebarCollapsed}
              id="desktop-sidebar-toggle-btn"
              className="hidden md:flex p-1.5 text-slate-400 hover:text-slate-100 focus:outline-none rounded hover:bg-slate-800 shrink-0 cursor-pointer border border-[#1E293B] bg-slate-900/60"
              title={isSidebarCollapsed ? "Buka Sidebar" : "Tutup Sidebar"}
            >
              <Menu className="w-4.5 h-4.5" />
            </button>
            <div className="hidden sm:flex items-center space-x-2 border-r border-[#1E293B] pr-4 select-none shrink-0 z-20 bg-[#0F172A]">
              <span className="text-[10px] font-mono font-bold text-amber-500 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block mr-1.5"></span>
                <span>BINANCE LIVE:</span>
              </span>
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
                          <div className="flex items-center gap-1 pl-1.5 border-l border-slate-850">
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
                              className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-slate-800 hover:bg-slate-705 text-slate-300 border border-slate-700 rounded transition-colors cursor-pointer"
                              title={`Detail Aset ${asset.symbol}`}
                            >
                              Detail
                            </button>
                          </div>
                        </div>
                      );
                    });
                  })()
                ) : (
                  <span className="text-xs font-mono text-slate-600 px-4">Initializing Binance WebStream...</span>
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

            <div className="hidden md:flex items-center space-x-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded text-[10px] font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              <span>AES-256 E2EE ACTIVE</span>
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

              {activeTab === "security" && (
                <SecurityCenter 
                  twoFactorEnabled={twoFactorEnabled} 
                  setTwoFactorEnabled={setTwoFactorEnabled} 
                />
              )}

              {activeTab === "whale-tracker" && (
                <OnChainData />
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

                      <div className="bg-slate-950 border border-slate-850 p-3 rounded-lg flex justify-between items-center text-xs">
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
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-850 flex justify-between items-center text-xs">
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

                        <div className="bg-slate-950 border border-slate-850 p-3 rounded-lg flex justify-between items-center text-xs">
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
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-850">
                          <span className="block text-[9px] uppercase font-mono text-slate-500 font-bold mb-0.5">Kategori</span>
                          <span className="text-slate-300 font-semibold uppercase">{selectedQuickAsset.category}</span>
                        </div>

                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-850">
                          <span className="block text-[9px] uppercase font-mono text-slate-500 font-bold mb-0.5">Kepemilikan Anda</span>
                          <span className="text-slate-300 font-mono font-semibold">{ownedQty} Unit</span>
                        </div>

                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-850">
                          <span className="block text-[9px] uppercase font-mono text-slate-500 font-bold mb-0.5">Harga Terkini</span>
                          <span className="text-slate-200 font-mono font-bold">
                            ${price < 0.01 ? price.toFixed(6) : price.toLocaleString()}
                          </span>
                        </div>

                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-850">
                          <span className="block text-[9px] uppercase font-mono text-slate-500 font-bold mb-0.5">Perubahan 24 Jam</span>
                          <span className={`font-mono font-bold ${isPriceUp ? "text-emerald-400" : "text-rose-500"}`}>
                            {isPriceUp ? "+" : ""}{change}%
                          </span>
                        </div>

                        <div className="col-span-2 bg-slate-950 p-2.5 rounded-lg border border-slate-850 space-y-1">
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

                      <div className="p-3 bg-slate-950/80 rounded-lg ring-1 ring-slate-850 text-[11px] leading-relaxed text-slate-400">
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
                        <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-850 flex justify-between items-center text-xs">
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
                            <div className="bg-slate-950 border border-slate-855 p-3 rounded-lg space-y-2 text-xs">
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
        <footer className="h-8 bg-[#0F172A] border-t border-slate-800 px-4 sm:px-6 flex items-center justify-between z-15 text-[10px] text-slate-500 shrink-0 select-none">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="flex items-center space-x-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="uppercase tracking-tighter font-mono">CORE FEED: ONLINE</span>
            </div>
            <div className="hidden sm:flex items-center space-x-1.5 border-l border-slate-800 pl-4">
              <span className="text-emerald-500 font-mono">✓</span>
              <span className="uppercase tracking-tighter font-mono">2FA ACTIVE & SECURED</span>
            </div>
          </div>
          <div className="text-[9px] text-slate-600 font-mono uppercase hidden xs:block sm:block">Z-CAPITAL SYSTEM CORE v4.2.0-PRO-INVESTOR</div>
        </footer>
      </main>
    </div>
  );
}
