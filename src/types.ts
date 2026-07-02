export interface Asset {
  id: string;
  symbol: string;
  name: string;
  category: 'stock' | 'crypto';
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  // Fundamental Stock Ratios
  peRatio?: number;
  pbRatio?: number;
  dividendYield?: number;
  roe?: number;
  debtToEquity?: number;
  brokerTargets?: BrokerTarget[];
}

export interface BrokerTarget {
  broker: string;
  targetPrice: number;
  rating: 'BUY' | 'HOLD' | 'SELL';
  date: string;
}

export interface PortfolioAsset {
  id: string;
  symbol: string;
  category: 'stock' | 'crypto';
  purchasePrice: number;
  quantity: number;
  currentPrice: number;
}

export interface AlertConfig {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: 'ABOVE' | 'BELOW';
  intensity: 'LOW' | 'MEDIUM' | 'HIGH';
  isActive: boolean;
  createdAt: string;
}

export interface BacktestResult {
  symbol: string;
  strategyName: string;
  initialBalance: number;
  finalBalance: number;
  roi: number;
  totalTrades: number;
  winningTrades: number;
  maxDrawdown: number;
  winRate?: number;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
}

export interface BacktestTrade {
  type: 'BUY' | 'SELL';
  price: number;
  date: string;
  amount: number;
  balanceAfter: number;
}

export interface EquityPoint {
  date: string;
  balance: number;
  assetPrice: number;
}

export interface PriceHistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma?: number;
  rsi?: number;
}

export interface ConversionTransaction {
  id: string;
  timestamp: string;
  sourceSymbol: string;
  sourceQty: number;
  sourcePrice: number;
  targetSymbol: string;
  targetQty: number;
  targetPrice: number;
  slippagePercent: number;
  feePaidUsd: number;
}

export interface LedgerTransaction {
  id: string;
  timestamp: string;
  type: "BUY" | "SELL" | "SWAP";
  symbol: string;
  quantity: number;
  price: number;
  totalAmount: number;
  realizedPnL?: number; // Calculated using FIFO matching
  feePaidUsd?: number;
  notes?: string;
}

export interface NotificationChannelConfig {
  webPushEnabled: boolean;
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  discordEnabled: boolean;
  discordWebhookUrl: string;
  whatsappEnabled: boolean;
  whatsappWebhookUrl: string;
  whatsappPhoneNumber: string;
}


export interface AppSettings {
  theme: 'dark' | 'light' | 'bloomberg' | 'hacker' | 'holo-glass' | 'aurora-synth' | 'liquid-glass' | 'cyber-3d' | 'glass-3d';
  glassmorphism: boolean;
  exchangeFeed: 'binance' | 'kucoin' | 'bybit';
  syncPriority: 'high' | 'standard' | 'low';
  aiTone: 'formal' | 'pragmatic' | 'aggressive' | 'academic';
  aiMaxTokens: number;
  aiTemperature: number;
  binanceKey: string;
  binanceSecret: string;
  kucoinKey: string;
  kucoinSecret: string;
  bybitKey: string;
  bybitSecret: string;
  geminiKey: string;
  sessionLockHours: number;
  isSandboxActive: boolean;
  cyberShieldActive: boolean;
  aiThinkingMode?: 'high' | 'low' | 'minimal';
}

