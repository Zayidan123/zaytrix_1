// Z-CAPITAL Type Definitions

export interface CryptoAsset {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  high24h: number;
  low24h: number;
  icon?: string;
  sparkline?: number[];
}

export interface PortfolioHolding {
  symbol: string;
  name: string;
  amount: number;
  avgBuyPrice: number;
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPercent: number;
}

export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  name: string;
  amount: number;
  price: number;
  total: number;
  date: string;
}

export interface TradeSignal {
  symbol: string;
  name: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  rsi: number;
  macd: { value: number; signal: number; histogram: number };
  ema: { short: number; long: number };
  timestamp: string;
}

export interface TradeRule {
  id: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'CROSS_ABOVE' | 'CROSS_BELOW';
  targetPrice: number;
  action: 'ALERT' | 'BUY' | 'SELL';
  isActive: boolean;
  createdAt: string;
  triggered?: boolean;
  triggeredAt?: string;
}

export interface TaxTransaction {
  id: string;
  date: string;
  type: 'BUY' | 'SELL' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  symbol: string;
  amount: number;
  price: number;
  fee: number;
  pnl?: number;
}

export interface BacktestResult {
  strategy: string;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  totalTrades: number;
  trades: TradeRecord[];
  equityCurve: number[];
}

export interface TradeRecord {
  date: string;
  type: 'BUY' | 'SELL';
  price: number;
  amount: number;
  pnl?: number;
}

export interface SecuritySession {
  id: string;
  device: string;
  browser: string;
  ip: string;
  location: string;
  lastActive: string;
  current: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  details: string;
  timestamp: string;
  ip: string;
  status: 'success' | 'warning' | 'error';
}

export type PageId =
  | 'dashboard'
  | 'coins'
  | 'chart'
  | 'crypto-hub'
  | 'ai-signals'
  | 'ai-docs'
  | 'projections'
  | 'backtester'
  | 'automation'
  | 'ledger'
  | 'security'
  | 'settings';

export interface PageConfig {
  id: PageId;
  label: string;
  icon: string;
}