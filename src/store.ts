import { create } from "zustand";
import { PortfolioAsset, AlertConfig, AppSettings, ConversionTransaction, LedgerTransaction, NotificationChannelConfig } from "./types";
import { safeLocalStorage } from "./utils/safeStorage";

interface GlobalStore {
  portfolio: PortfolioAsset[];
  alerts: AlertConfig[];
  twoFactorEnabled: boolean;
  executionLogs: string[];
  backtestHistory: any[];
  conversionHistory: ConversionTransaction[];
  ledgerHistory: LedgerTransaction[];
  notificationConfig: NotificationChannelConfig;
  
  // App-wide Settings State
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
  resetSettings: () => void;
  
  // Real-time market streaming parameters shared across views
  liveBtcPrice: number;
  liveEthPrice: number;
  liveBnbPrice: number;
  liveXrpPrice: number;
  liveSolPrice: number;
  liveTrxPrice: number;
  liveHypePrice: number;
  btcPriceChangePercent: number;
  ethPriceChangePercent: number;
  bnbPriceChangePercent: number;
  xrpPriceChangePercent: number;
  solPriceChangePercent: number;
  trxPriceChangePercent: number;
  hypePriceChangePercent: number;
  btcPriceDirection: "up" | "down" | "flat";
  ethPriceDirection: "up" | "down" | "flat";
  bnbPriceDirection: "up" | "down" | "flat";
  xrpPriceDirection: "up" | "down" | "flat";
  solPriceDirection: "up" | "down" | "flat";
  trxPriceDirection: "up" | "down" | "flat";
  hypePriceDirection: "up" | "down" | "flat";
  tickerSource: "WebSocket" | "HTTP Polling" | "Local Simulation";
  
  setPortfolio: (portfolio: PortfolioAsset[]) => void;
  addHolding: (holding: PortfolioAsset) => void;
  removeHolding: (id: string) => void;
  
  setAlerts: (alerts: AlertConfig[]) => void;
  addAlert: (alert: AlertConfig) => void;
  removeAlert: (id: string) => void;
  
  setTwoFactorEnabled: (enabled: boolean) => void;
  
  setExecutionLogs: (logs: string[] | ((prev: string[]) => string[])) => void;
  addExecutionLog: (log: string) => void;
  
  addBacktestResult: (result: any) => void;
  clearBacktestHistory: () => void;
  
  addConversionTransaction: (tx: ConversionTransaction) => void;
  addLedgerTransaction: (tx: LedgerTransaction) => void;
  updateNotificationConfig: (config: Partial<NotificationChannelConfig>) => void;
  
  setTickerSource: (source: "WebSocket" | "HTTP Polling" | "Local Simulation") => void;
  updateBtcPrice: (price: number, changePercent?: number, direction?: "up" | "down" | "flat") => void;
  updateEthPrice: (price: number, changePercent?: number, direction?: "up" | "down" | "flat") => void;
  updateBnbPrice: (price: number, changePercent?: number, direction?: "up" | "down" | "flat") => void;
  updateXrpPrice: (price: number, changePercent?: number, direction?: "up" | "down" | "flat") => void;
  updateSolPrice: (price: number, changePercent?: number, direction?: "up" | "down" | "flat") => void;
  updateTrxPrice: (price: number, changePercent?: number, direction?: "up" | "down" | "flat") => void;
  updateHypePrice: (price: number, changePercent?: number, direction?: "up" | "down" | "flat") => void;
  user: any | null;
  setUser: (user: any | null) => void;
}

const getInitialConversionHistory = (): ConversionTransaction[] => {
  const saved = safeLocalStorage.getItem("financara_conversions");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.log("Failed to parse conversions from safeLocalStorage-backed item", e);
    }
  }
  return [];
};

const getInitialLedgerHistory = (): LedgerTransaction[] => {
  const saved = safeLocalStorage.getItem("financara_ledger");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.log("Failed to parse ledger from safeLocalStorage-backed item", e);
    }
  }
  return [];
};

const defaultNotificationConfig: NotificationChannelConfig = {
  webPushEnabled: false,
  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  discordEnabled: false,
  discordWebhookUrl: "",
  whatsappEnabled: false,
  whatsappWebhookUrl: "",
  whatsappPhoneNumber: ""
};

const getInitialNotificationConfig = (): NotificationChannelConfig => {
  const saved = safeLocalStorage.getItem("financara_notifications");
  if (saved) {
    try {
      return { ...defaultNotificationConfig, ...JSON.parse(saved) };
    } catch (e) {
      console.log("Failed to parse notifications config", e);
    }
  }
  return defaultNotificationConfig;
};

const getInitialPortfolio = (): PortfolioAsset[] => {
  const saved = safeLocalStorage.getItem("financara_portfolio");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.log("Failed to parse portfolio from safeLocalStorage-backed item", e);
    }
  }
  return [];
};

const getInitialAlerts = (): AlertConfig[] => {
  const saved = safeLocalStorage.getItem("financara_alerts");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.log("Failed to parse alerts from safeLocalStorage-backed item", e);
    }
  }
  return [];
};

const getInitial2FA = (): boolean => {
  return safeLocalStorage.getItem("financara_2fa") === "true";
};

const defaultSettings: AppSettings = {
  theme: 'glass-3d',
  glassmorphism: true,
  exchangeFeed: 'binance',
  syncPriority: 'standard',
  aiTone: 'academic',
  aiMaxTokens: 800,
  aiTemperature: 0.6,
  binanceKey: '',
  binanceSecret: '',
  kucoinKey: '',
  kucoinSecret: '',
  bybitKey: '',
  bybitSecret: '',
  geminiKey: '',
  sessionLockHours: 2,
  isSandboxActive: true,
  cyberShieldActive: true,
  aiThinkingMode: 'high',
};

const getInitialSettings = (): AppSettings => {
  const saved = safeLocalStorage.getItem("financara_settings");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return { ...defaultSettings, ...parsed };
    } catch (e) {
      console.log("Failed to parse settings from safeLocalStorage-backed item, using defaults", e);
    }
  }
  return defaultSettings;
};

export const useGlobalStore = create<GlobalStore>((set) => ({
  portfolio: getInitialPortfolio(),
  alerts: getInitialAlerts(),
  twoFactorEnabled: getInitial2FA(),
  settings: getInitialSettings(),
  updateSettings: (newSettings) => set((state) => {
    const updated = { ...state.settings, ...newSettings };
    safeLocalStorage.setItem("financara_settings", JSON.stringify(updated));
    return { settings: updated };
  }),
  resetSettings: () => set(() => {
    safeLocalStorage.setItem("financara_settings", JSON.stringify(defaultSettings));
    return { settings: defaultSettings };
  }),
  executionLogs: [
    "[SYSTEM] Otentikasi Workspace Terintegrasi. Inisialisasi Terminal API...",
    "[SYSTEM] Deteksi sandboxed credentials. Menggunakan Kunci Simulasi Tanpa API Key Fisik.",
    "[STATUS] Koneksi Mirae Asset & Stockbit Sandbox: Tersinkronisasi Sukses.",
    "[STATUS] Sinkronisasi Portofolio Real-time dengan Server: Sinkronisasi Terpenuhi."
  ],
  backtestHistory: [],
  conversionHistory: getInitialConversionHistory(),
  ledgerHistory: getInitialLedgerHistory(),
  notificationConfig: getInitialNotificationConfig(),
  
  // Real-time market streaming default values
  liveBtcPrice: 68412.50,
  liveEthPrice: 3824.10,
  liveBnbPrice: 612.00,
  liveXrpPrice: 2.50,
  liveSolPrice: 168.00,
  liveTrxPrice: 0.142,
  liveHypePrice: 18.50,
  btcPriceChangePercent: 1.42,
  ethPriceChangePercent: -0.85,
  bnbPriceChangePercent: 0.50,
  xrpPriceChangePercent: 1.20,
  solPriceChangePercent: 2.10,
  trxPriceChangePercent: -0.15,
  hypePriceChangePercent: 5.60,
  btcPriceDirection: "flat",
  ethPriceDirection: "flat",
  bnbPriceDirection: "flat",
  xrpPriceDirection: "flat",
  solPriceDirection: "flat",
  trxPriceDirection: "flat",
  hypePriceDirection: "flat",
  tickerSource: "Local Simulation",

  setPortfolio: (portfolio) => set(() => {
    safeLocalStorage.setItem("financara_portfolio", JSON.stringify(portfolio));
    return { portfolio };
  }),

  addHolding: (holding) => set((state) => {
    const updated = [holding, ...state.portfolio];
    safeLocalStorage.setItem("financara_portfolio", JSON.stringify(updated));
    return { portfolio: updated };
  }),

  removeHolding: (id) => set((state) => {
    const updated = state.portfolio.filter(p => p.id !== id);
    safeLocalStorage.setItem("financara_portfolio", JSON.stringify(updated));
    return { portfolio: updated };
  }),

  setAlerts: (alerts) => set(() => {
    safeLocalStorage.setItem("financara_alerts", JSON.stringify(alerts));
    return { alerts };
  }),

  addAlert: (alert) => set((state) => {
    const updated = [alert, ...state.alerts];
    safeLocalStorage.setItem("financara_alerts", JSON.stringify(updated));
    return { alerts: updated };
  }),

  removeAlert: (id) => set((state) => {
    const updated = state.alerts.filter(a => a.id !== id);
    safeLocalStorage.setItem("financara_alerts", JSON.stringify(updated));
    return { alerts: updated };
  }),

  setTwoFactorEnabled: (twoFactorEnabled) => set(() => {
    safeLocalStorage.setItem("financara_2fa", String(twoFactorEnabled));
    return { twoFactorEnabled };
  }),

  setExecutionLogs: (logs) => set((state) => {
    const nextLogs = typeof logs === "function" ? logs(state.executionLogs) : logs;
    return { executionLogs: nextLogs };
  }),

  addExecutionLog: (log) => set((state) => ({
    executionLogs: [...state.executionLogs, log]
  })),

  addBacktestResult: (result) => set((state) => ({
    backtestHistory: [result, ...state.backtestHistory]
  })),

  clearBacktestHistory: () => set(() => ({ backtestHistory: [] })),

  addConversionTransaction: (tx) => set((state) => {
    const updated = [tx, ...state.conversionHistory];
    safeLocalStorage.setItem("financara_conversions", JSON.stringify(updated));
    return { conversionHistory: updated };
  }),

  addLedgerTransaction: (tx) => set((state) => {
    const updated = [tx, ...state.ledgerHistory];
    safeLocalStorage.setItem("financara_ledger", JSON.stringify(updated));
    return { ledgerHistory: updated };
  }),

  updateNotificationConfig: (config) => set((state) => {
    const updated = { ...state.notificationConfig, ...config };
    safeLocalStorage.setItem("financara_notifications", JSON.stringify(updated));
    return { notificationConfig: updated };
  }),

  setTickerSource: (tickerSource) => set(() => ({ tickerSource })),

  updateBtcPrice: (price, changePercent, direction) => set((state) => {
    const nextDir = direction || (price > state.liveBtcPrice ? "up" : price < state.liveBtcPrice ? "down" : "flat");
    return {
      liveBtcPrice: price,
      btcPriceChangePercent: changePercent !== undefined ? changePercent : state.btcPriceChangePercent,
      btcPriceDirection: nextDir
    };
  }),

  updateEthPrice: (price, changePercent, direction) => set((state) => {
    const nextDir = direction || (price > state.liveEthPrice ? "up" : price < state.liveEthPrice ? "down" : "flat");
    return {
      liveEthPrice: price,
      ethPriceChangePercent: changePercent !== undefined ? changePercent : state.ethPriceChangePercent,
      ethPriceDirection: nextDir
    };
  }),

  updateBnbPrice: (price, changePercent, direction) => set((state) => {
    const nextDir = direction || (price > state.liveBnbPrice ? "up" : price < state.liveBnbPrice ? "down" : "flat");
    return {
      liveBnbPrice: price,
      bnbPriceChangePercent: changePercent !== undefined ? changePercent : state.bnbPriceChangePercent,
      bnbPriceDirection: nextDir
    };
  }),

  updateXrpPrice: (price, changePercent, direction) => set((state) => {
    const nextDir = direction || (price > state.liveXrpPrice ? "up" : price < state.liveXrpPrice ? "down" : "flat");
    return {
      liveXrpPrice: price,
      xrpPriceChangePercent: changePercent !== undefined ? changePercent : state.xrpPriceChangePercent,
      xrpPriceDirection: nextDir
    };
  }),

  updateSolPrice: (price, changePercent, direction) => set((state) => {
    const nextDir = direction || (price > state.liveSolPrice ? "up" : price < state.liveSolPrice ? "down" : "flat");
    return {
      liveSolPrice: price,
      solPriceChangePercent: changePercent !== undefined ? changePercent : state.solPriceChangePercent,
      solPriceDirection: nextDir
    };
  }),

  updateTrxPrice: (price, changePercent, direction) => set((state) => {
    const nextDir = direction || (price > state.liveTrxPrice ? "up" : price < state.liveTrxPrice ? "down" : "flat");
    return {
      liveTrxPrice: price,
      trxPriceChangePercent: changePercent !== undefined ? changePercent : state.trxPriceChangePercent,
      trxPriceDirection: nextDir
    };
  }),

  updateHypePrice: (price, changePercent, direction) => set((state) => {
    const nextDir = direction || (price > state.liveHypePrice ? "up" : price < state.liveHypePrice ? "down" : "flat");
    return {
      liveHypePrice: price,
      hypePriceChangePercent: changePercent !== undefined ? changePercent : state.hypePriceChangePercent,
      hypePriceDirection: nextDir
    };
  }),

  user: null,
  setUser: (user) => set(() => ({ user })),
}));
