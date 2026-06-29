import { create } from 'zustand';
import type { CryptoAsset, PortfolioHolding, Transaction } from './types';

interface CryptoStore {
  assets: CryptoAsset[];
  isConnected: boolean;
  selectedCoin: string;
  setSelectedCoin: (symbol: string) => void;
  setAssets: (assets: CryptoAsset[]) => void;
  setConnected: (status: boolean) => void;
  // Portfolio
  holdings: PortfolioHolding[];
  transactions: Transaction[];
  setHoldings: (holdings: PortfolioHolding[]) => void;
  addTransaction: (tx: Transaction) => void;
  // Theme
  activeGradient: number;
  setActiveGradient: (idx: number) => void;
}

const DEMO_ASSETS: CryptoAsset[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: 104250.80, change24h: 2.34, volume24h: 48.5e9, marketCap: 2.06e12, high24h: 105100, low24h: 102800 },
  { symbol: 'ETH', name: 'Ethereum', price: 2538.42, change24h: -1.12, volume24h: 22.3e9, marketCap: 305e9, high24h: 2610, low24h: 2510 },
  { symbol: 'SOL', name: 'Solana', price: 172.35, change24h: 5.67, volume24h: 8.9e9, marketCap: 82e9, high24h: 176, low24h: 164 },
  { symbol: 'BNB', name: 'BNB', price: 688.50, change24h: 0.89, volume24h: 2.1e9, marketCap: 103e9, high24h: 695, low24h: 680 },
  { symbol: 'XRP', name: 'Ripple', price: 2.38, change24h: -2.45, volume24h: 5.6e9, marketCap: 137e9, high24h: 2.48, low24h: 2.32 },
  { symbol: 'ADA', name: 'Cardano', price: 0.712, change24h: 3.21, volume24h: 1.2e9, marketCap: 25e9, high24h: 0.735, low24h: 0.688 },
  { symbol: 'DOGE', name: 'Dogecoin', price: 0.228, change24h: 1.56, volume24h: 3.4e9, marketCap: 34e9, high24h: 0.235, low24h: 0.222 },
  { symbol: 'AVAX', name: 'Avalanche', price: 24.15, change24h: -0.78, volume24h: 890e6, marketCap: 9.8e9, high24h: 24.80, low24h: 23.60 },
  { symbol: 'DOT', name: 'Polkadot', price: 4.52, change24h: 1.23, volume24h: 420e6, marketCap: 6.8e9, high24h: 4.65, low24h: 4.40 },
  { symbol: 'MATIC', name: 'Polygon', price: 0.265, change24h: -1.89, volume24h: 560e6, marketCap: 2.5e9, high24h: 0.278, low24h: 0.258 },
];

const DEMO_HOLDINGS: PortfolioHolding[] = [
  { symbol: 'BTC', name: 'Bitcoin', amount: 0.5, avgBuyPrice: 95000, currentPrice: 104250.80, value: 52125.40, pnl: 4625.40, pnlPercent: 9.74 },
  { symbol: 'ETH', name: 'Ethereum', amount: 5, avgBuyPrice: 2800, currentPrice: 2538.42, value: 12692.10, pnl: -1307.90, pnlPercent: -9.34 },
  { symbol: 'SOL', name: 'Solana', amount: 50, avgBuyPrice: 140, currentPrice: 172.35, value: 8617.50, pnl: 1617.50, pnlPercent: 23.11 },
  { symbol: 'BNB', name: 'BNB', amount: 10, avgBuyPrice: 600, currentPrice: 688.50, value: 6885.00, pnl: 885.00, pnlPercent: 14.75 },
];

export const useCryptoStore = create<CryptoStore>((set) => ({
  assets: DEMO_ASSETS,
  isConnected: false,
  selectedCoin: 'BTC',
  setSelectedCoin: (symbol) => set({ selectedCoin: symbol }),
  setAssets: (assets) => set({ assets }),
  setConnected: (status) => set({ isConnected: status }),
  holdings: DEMO_HOLDINGS,
  transactions: [],
  setHoldings: (holdings) => set({ holdings }),
  addTransaction: (tx) => set((s) => ({ transactions: [tx, ...s.transactions] })),
  activeGradient: 0,
  setActiveGradient: (idx) => set({ activeGradient: idx }),
}));
