import React, { useState, useMemo, useEffect } from "react";
import { 
  Search, 
  Database, 
  TrendingUp, 
  TrendingDown, 
  Info, 
  Calendar, 
  Coins, 
  GitCommit, 
  Code, 
  Cpu, 
  Layers, 
  Activity, 
  ArrowRight, 
  CheckCircle2, 
  ChevronDown, 
  ChevronRight, 
  Eye, 
  Download, 
  BarChart, 
  Clock, 
  LineChart as LineIcon, 
  LayoutGrid,
  Users
} from "lucide-react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  LineChart, 
  Line, 
  BarChart as RechartsBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from "recharts";
// IMPL-C3: import Zustand store for live BTC/ETH/BNB/XRP/SOL/TRX/HYPE prices.
import { useGlobalStore } from "../store";

// Interfaces for Token Terminal Metrics
export interface MetricDef {
  id: string;
  name: string;
  category: string;
  type: "currency" | "count" | "percentage" | "time" | "ratio";
  interval: "Weekly average for last 365 days" | "Weekly sum for last 365 days";
  description: string;
  baseValue: number;
  volatility: number;
  trend: number;
}

const CATEGORIES = [
  "Key Metrics",
  "Market",
  "Financial",
  "Valuation",
  "Usage",
  "Development",
  "Technical",
  "Ecosystem"
];

const METRICS_LIST: MetricDef[] = [
  // --- Key Metrics ---
  {
    id: "fully_diluted_market_cap_key",
    name: "Fully diluted market cap",
    category: "Key Metrics",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Kapitalisasi pasar jika seluruh pasokan token maksimum (21.000.000) telah beredar sepenuhnya, dihitung dengan harga pasar saat ini.",
    baseValue: 1250000000000,
    volatility: 0.25,
    trend: 0.32
  },
  {
    id: "circulating_market_cap_key",
    name: "Circulating market cap",
    category: "Key Metrics",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Nilai pasar total dari token Bitcoin yang saat ini beredar dan aktif di dompet publik (sekitar 19,6 juta koin).",
    baseValue: 1150000000000,
    volatility: 0.24,
    trend: 0.30
  },
  {
    id: "token_trading_volume_key",
    name: "Token trading volume",
    category: "Key Metrics",
    type: "currency",
    interval: "Weekly sum for last 365 days",
    description: "Total akumulasi volume perdagangan mingguan Bitcoin yang ditransaksikan di seluruh bursa terpusat (CEX) dan terdesentralisasi (DEX).",
    baseValue: 165000000000,
    volatility: 0.45,
    trend: 0.15
  },
  {
    id: "token_turnover_fdv_key",
    name: "Token turnover (fully diluted)",
    category: "Key Metrics",
    type: "percentage",
    interval: "Weekly average for last 365 days",
    description: "Rasio likuiditas pasar yang mengukur persentase volume perdagangan mingguan dibandingkan dengan kapitalisasi pasar fully diluted (FDV).",
    baseValue: 13.2,
    volatility: 0.35,
    trend: -0.05
  },
  {
    id: "token_turnover_circulating_key",
    name: "Token turnover (circulating)",
    category: "Key Metrics",
    type: "percentage",
    interval: "Weekly average for last 365 days",
    description: "Rasio yang mengukur volume perdagangan mingguan sebagai persentase dari circulating market cap.",
    baseValue: 14.3,
    volatility: 0.35,
    trend: -0.05
  },

  // --- Market ---
  {
    id: "price_market",
    name: "Price",
    category: "Market",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata harga spot penutupan mingguan Bitcoin (BTC) dalam USD di bursa-bursa global.",
    baseValue: 62500,
    volatility: 0.25,
    trend: 0.32
  },
  {
    id: "fully_diluted_market_cap_market",
    name: "Fully diluted market cap",
    category: "Market",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Representasi kapitalisasi pasar fully diluted (FDV) dalam kategori metrik Market.",
    baseValue: 1250000000000,
    volatility: 0.25,
    trend: 0.32
  },
  {
    id: "circulating_market_cap_market",
    name: "Circulating market cap",
    category: "Market",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Representasi circulating market cap dalam kategori metrik Market.",
    baseValue: 1150000000000,
    volatility: 0.24,
    trend: 0.30
  },
  {
    id: "token_holders_market",
    name: "Token holders",
    category: "Market",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Estimasi rata-rata mingguan jumlah alamat on-chain unik yang memiliki saldo BTC lebih besar dari nol.",
    baseValue: 53500000,
    volatility: 0.05,
    trend: 0.12
  },
  {
    id: "maximum_token_supply_market",
    name: "Maximum token supply",
    category: "Market",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Batas keras (hard cap) jumlah total Bitcoin yang dapat ditambang, yaitu persis 21.000.000 BTC.",
    baseValue: 21000000,
    volatility: 0.0,
    trend: 0.0
  },

  // --- Financial ---
  {
    id: "fees_financial",
    name: "Fees",
    category: "Financial",
    type: "currency",
    interval: "Weekly sum for last 365 days",
    description: "Total akumulasi mingguan dari biaya transfer (network gas fees) yang dibayarkan pengguna untuk mengirim transaksi di jaringan Bitcoin.",
    baseValue: 5800000,
    volatility: 0.65,
    trend: 0.20
  },
  {
    id: "supply_side_fees_financial",
    name: "Supply-side fees",
    category: "Financial",
    type: "currency",
    interval: "Weekly sum for last 365 days",
    description: "Bagian biaya transaksi yang diserahkan kepada penyedia infrastruktur (para miner). Untuk Bitcoin, nilainya adalah 100% dari total Fees.",
    baseValue: 5800000,
    volatility: 0.65,
    trend: 0.20
  },
  {
    id: "revenue_financial",
    name: "Revenue",
    category: "Financial",
    type: "currency",
    interval: "Weekly sum for last 365 days",
    description: "Bagian biaya transaksi yang disimpan ke kas protokol atau dibagikan ke pemegang token. Untuk Bitcoin nilainya adalah $0 karena tidak ada mekanisme fee burning atau kas protokol.",
    baseValue: 0,
    volatility: 0.0,
    trend: 0.0
  },
  {
    id: "expenses_financial",
    name: "Expenses",
    category: "Financial",
    type: "currency",
    interval: "Weekly sum for last 365 days",
    description: "Pengeluaran emisi protokol untuk mengamankan jaringan (Block Rewards / Subsidy). Dihitung dari 3.150 BTC baru yang diterbitkan per minggu dikalikan harga spot.",
    baseValue: 196875000,
    volatility: 0.25,
    trend: 0.32
  },
  {
    id: "token_incentives_financial",
    name: "Token incentives",
    category: "Financial",
    type: "currency",
    interval: "Weekly sum for last 365 days",
    description: "Insentif token yang dikeluarkan kepada para penambang berupa emisi BTC baru per blok yang berhasil ditambang (3,125 BTC per blok).",
    baseValue: 196875000,
    volatility: 0.25,
    trend: 0.32
  },
  {
    id: "earnings_financial",
    name: "Earnings",
    category: "Financial",
    type: "currency",
    interval: "Weekly sum for last 365 days",
    description: "Pendapatan bersih protokol (Revenue dikurangi Expenses). Untuk Bitcoin, ini bernilai negatif (net loss) karena pengeluaran insentif blok jauh melebihi biaya transaksi.",
    baseValue: -196875000,
    volatility: 0.25,
    trend: 0.32
  },

  // --- Valuation ---
  {
    id: "pf_ratio_circulating_valuation",
    name: "P/F ratio (circulating)",
    category: "Valuation",
    type: "ratio",
    interval: "Weekly average for last 365 days",
    description: "Rasio kapitalisasi pasar beredar (circulating market cap) dibagi dengan total pendapatan biaya transaksi tahunan (Fees disetahunkan). Menilai kemahalan relatif aset.",
    baseValue: 3820,
    volatility: 0.50,
    trend: 0.10
  },
  {
    id: "pf_ratio_fdv_valuation",
    name: "P/F ratio (fully diluted)",
    category: "Valuation",
    type: "ratio",
    interval: "Weekly average for last 365 days",
    description: "Rasio kapitalisasi pasar fully diluted (FDV) dibagi dengan total biaya transaksi disetahunkan.",
    baseValue: 4150,
    volatility: 0.50,
    trend: 0.10
  },
  {
    id: "take_rate_valuation",
    name: "Take rate",
    category: "Valuation",
    type: "percentage",
    interval: "Weekly average for last 365 days",
    description: "Persentase biaya transaksi yang masuk ke dalam treasury protokol (Protocol Take Rate). Untuk Bitcoin, nilainya adalah 0% karena semua biaya didistribusikan ke miner.",
    baseValue: 0.0,
    volatility: 0.0,
    trend: 0.0
  },

  // --- Usage ---
  {
    id: "active_users_daily_usage",
    name: "Active users (daily)",
    category: "Usage",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata jumlah pengguna unik harian (diestimasi melalui alamat on-chain aktif unik) yang berinteraksi dengan rantai.",
    baseValue: 710000,
    volatility: 0.12,
    trend: 0.08
  },
  {
    id: "active_users_weekly_usage",
    name: "Active users (weekly)",
    category: "Usage",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata jumlah entitas unik mingguan yang mengirimkan transaksi on-chain.",
    baseValue: 3100000,
    volatility: 0.10,
    trend: 0.06
  },
  {
    id: "active_users_monthly_usage",
    name: "Active users (monthly)",
    category: "Usage",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata jumlah pengguna unik bulanan (MAU) aktif di blockchain Bitcoin.",
    baseValue: 12200000,
    volatility: 0.08,
    trend: 0.05
  },
  {
    id: "active_addresses_daily_usage",
    name: "Active addresses (daily)",
    category: "Usage",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata jumlah alamat dompet Bitcoin harian unik yang berhasil memicu atau menerima setidaknya satu transaksi.",
    baseValue: 880000,
    volatility: 0.15,
    trend: 0.05
  },
  {
    id: "active_addresses_weekly_usage",
    name: "Active addresses (weekly)",
    category: "Usage",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata jumlah alamat Bitcoin unik yang aktif dalam rentang satu minggu.",
    baseValue: 3900000,
    volatility: 0.12,
    trend: 0.04
  },
  {
    id: "active_addresses_monthly_usage",
    name: "Active addresses (monthly)",
    category: "Usage",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata jumlah alamat Bitcoin unik yang aktif dalam rentang satu bulan.",
    baseValue: 15400000,
    volatility: 0.10,
    trend: 0.03
  },
  {
    id: "afpu_usage",
    name: "Average fees per user (AFPU)",
    category: "Usage",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata biaya transaksi yang dibayarkan oleh satu pengguna unik aktif per minggu (Total Fees dibagi Active Users Weekly).",
    baseValue: 1.87,
    volatility: 0.55,
    trend: 0.14
  },
  {
    id: "arpu_usage",
    name: "Average revenue per user (ARPU)",
    category: "Usage",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata pendapatan protokol yang ditangkap dari satu pengguna unik aktif per minggu. Bernilai $0 karena Bitcoin tidak memungut Protocol Revenue.",
    baseValue: 0.0,
    volatility: 0.0,
    trend: 0.0
  },

  // --- Development ---
  {
    id: "core_developers_dev",
    name: "Core developers",
    category: "Development",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Jumlah kontributor kode inti aktif mingguan yang merilis perbaikan atau fitur baru pada repositori resmi Bitcoin GitHub.",
    baseValue: 46,
    volatility: 0.15,
    trend: 0.05
  },
  {
    id: "code_commits_dev",
    name: "Code commits",
    category: "Development",
    type: "count",
    interval: "Weekly sum for last 365 days",
    description: "Jumlah total pengajuan kode (commits) mingguan ke repositori inti Bitcoin Core di GitHub.",
    baseValue: 145,
    volatility: 0.30,
    trend: -0.05
  },

  // --- Technical ---
  {
    id: "block_time_tech",
    name: "Block time",
    category: "Technical",
    type: "time",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata waktu pembuatan (konfirmasi) sebuah blok baru di blockchain Bitcoin dalam menit. Sasaran algoritma kesulitan adalah 10 menit.",
    baseValue: 10.05,
    volatility: 0.04,
    trend: 0.00
  },
  {
    id: "transaction_count_tech",
    name: "Transaction count",
    category: "Technical",
    type: "count",
    interval: "Weekly sum for last 365 days",
    description: "Total akumulasi jumlah transaksi yang berhasil diproses dan dicatat ke dalam buku besar Bitcoin dalam satu minggu.",
    baseValue: 3450000,
    volatility: 0.20,
    trend: 0.18
  },
  {
    id: "tps_tech",
    name: "Transactions per second",
    category: "Technical",
    type: "count",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata kecepatan pemrosesan transaksi per detik (TPS) oleh jaringan Bitcoin, dihitung dari total transaksi mingguan dibagi jumlah detik seminggu.",
    baseValue: 5.7,
    volatility: 0.20,
    trend: 0.18
  },
  {
    id: "avg_fee_tech",
    name: "Average transaction fee",
    category: "Technical",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Rata-rata biaya transaksi yang dibayarkan untuk setiap transfer individu dalam USD.",
    baseValue: 4.82,
    volatility: 0.60,
    trend: 0.15
  },
  {
    id: "median_fee_tech",
    name: "Median transaction fee",
    category: "Technical",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Nilai tengah biaya transaksi individual dalam jaringan Bitcoin, menyaring pengaruh transaksi bernominal ekstrim.",
    baseValue: 1.95,
    volatility: 0.60,
    trend: 0.12
  },

  // --- Ecosystem ---
  {
    id: "ecosystem_tvl",
    name: "Ecosystem total value locked",
    category: "Ecosystem",
    type: "currency",
    interval: "Weekly average for last 365 days",
    description: "Total nilai modal kripto yang terkunci di seluruh solusi Lapisan 2 (L2), jembatan lintas rantai (bridges), dan protokol DeFi berbasis Bitcoin (misalnya Lightning, Merlin, Babylon).",
    baseValue: 1420000000,
    volatility: 0.38,
    trend: 0.82
  }
];

interface AssetOption {
  id: string;
  symbol: string;
  name: string;
  hasData: boolean;
  color: string;
}

const ASSET_OPTIONS: AssetOption[] = [
  { id: "btc", symbol: "BTC", name: "Bitcoin", hasData: true, color: "text-amber-400 bg-amber-500/10 border-amber-500/30 ring-amber-500/30" },
  { id: "eth", symbol: "ETH", name: "Ethereum", hasData: true, color: "text-sky-400 bg-sky-500/10 border-sky-500/30 ring-sky-500/30" },
  { id: "sol", symbol: "SOL", name: "Solana", hasData: true, color: "text-purple-400 bg-purple-500/10 border-purple-500/30 ring-purple-500/30" },
  { id: "xrp", symbol: "XRP", name: "Ripple", hasData: true, color: "text-blue-400 bg-blue-500/10 border-blue-500/30 ring-blue-500/30" },
  { id: "ada", symbol: "ADA", name: "Cardano", hasData: true, color: "text-blue-500 bg-blue-600/10 border-blue-600/30 ring-blue-600/30" },
  { id: "ldo", symbol: "LDO", name: "Lido", hasData: true, color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30 ring-cyan-500/30" },
  { id: "uni", symbol: "UNI", name: "Uniswap", hasData: true, color: "text-pink-400 bg-pink-500/10 border-pink-500/30 ring-pink-500/30" },
  { id: "trx", symbol: "TRX", name: "Tron", hasData: true, color: "text-red-400 bg-red-500/10 border-red-500/30 ring-red-500/30" },
  { id: "bnb", symbol: "BNB", name: "BNB Chain", hasData: true, color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30 ring-yellow-500/30" },
  { id: "hype", symbol: "HYPE", name: "Hyperliquid", hasData: true, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30 ring-emerald-500/30" },
  { id: "zec", symbol: "ZEC", name: "Zcash", hasData: true, color: "text-gray-400 bg-gray-500/10 border-gray-500/30 ring-gray-500/30" },
  { id: "sui", symbol: "SUI", name: "Sui", hasData: true, color: "text-teal-400 bg-teal-500/10 border-teal-500/30 ring-teal-500/30" },
  { id: "avax", symbol: "AVAX", name: "Avalanche", hasData: true, color: "text-rose-500 bg-rose-500/10 border-rose-500/30 ring-rose-500/30" },
  { id: "near", symbol: "NEAR", name: "Near Protocol", hasData: true, color: "text-green-400 bg-green-500/10 border-green-500/30 ring-green-500/30" },
  { id: "usdt", symbol: "USDT", name: "Tether", hasData: true, color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30 ring-emerald-500/30" },
  { id: "sky", symbol: "SKY", name: "Sky", hasData: true, color: "text-blue-300 bg-blue-300/10 border-blue-300/30 ring-blue-300/30" },
  { id: "aave", symbol: "AAVE", name: "Aave", hasData: true, color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30 ring-indigo-500/30" },
  { id: "cake", symbol: "CAKE", name: "PancakeSwap", hasData: true, color: "text-amber-600 bg-amber-600/10 border-amber-600/30 ring-amber-600/30" }
];

interface AssetProfile {
  id: string;
  symbol: string;
  name: string;
  price: number;
  fdv: number;
  circulatingMc: number;
  maxSupply: number | null;
  holders: number;
  weeklyVolume: number;
  weeklyFees: number;
  protocolRevenueShare: number; // percentage of fees that go to protocol revenue (e.g. 0.85 for ETH)
  expenses: number; // block rewards, staking emissions or incentives
  activeUsersDaily: number;
  coreDevs: number;
  codeCommitsWeekly: number;
  blockTimeMinutes: number;
  weeklyTxCount: number;
  avgFeeUsd: number;
  medianFeeUsd: number;
  tvl: number;
  volatility: number;
  trend: number;
  officialUrl: string;
}

const ASSET_PROFILES: Record<string, AssetProfile> = {
  btc: {
    id: "btc",
    symbol: "BTC",
    name: "Bitcoin",
    price: 62500,
    fdv: 1312500000000,
    circulatingMc: 1225000000000,
    maxSupply: 21000000,
    holders: 53500000,
    weeklyVolume: 165000000000,
    weeklyFees: 5800000,
    protocolRevenueShare: 0,
    expenses: 196875000,
    activeUsersDaily: 710000,
    coreDevs: 46,
    codeCommitsWeekly: 145,
    blockTimeMinutes: 10.05,
    weeklyTxCount: 3450000,
    avgFeeUsd: 4.82,
    medianFeeUsd: 1.95,
    tvl: 1420000000,
    volatility: 0.25,
    trend: 0.32,
    officialUrl: "https://tokenterminal.com/explorer/projects/bitcoin/metrics/all"
  },
  eth: {
    id: "eth",
    symbol: "ETH",
    name: "Ethereum",
    price: 3450,
    fdv: 414000000000,
    circulatingMc: 414000000000,
    maxSupply: null,
    holders: 112000000,
    weeklyVolume: 118000000000,
    weeklyFees: 32500000,
    protocolRevenueShare: 0.85,
    expenses: 14200000,
    activeUsersDaily: 380000,
    coreDevs: 184,
    codeCommitsWeekly: 520,
    blockTimeMinutes: 0.2,
    weeklyTxCount: 7800000,
    avgFeeUsd: 4.15,
    medianFeeUsd: 1.80,
    tvl: 64500000000,
    volatility: 0.28,
    trend: 0.45,
    officialUrl: "https://tokenterminal.com/explorer/projects/ethereum/metrics/all"
  },
  sol: {
    id: "sol",
    symbol: "SOL",
    name: "Solana",
    price: 148,
    fdv: 85840000000,
    circulatingMc: 68000000000,
    maxSupply: null,
    holders: 32000000,
    weeklyVolume: 28500000000,
    weeklyFees: 9200000,
    protocolRevenueShare: 0.50,
    expenses: 18500000,
    activeUsersDaily: 1850000,
    coreDevs: 115,
    codeCommitsWeekly: 310,
    blockTimeMinutes: 0.006,
    weeklyTxCount: 245000000,
    avgFeeUsd: 0.03,
    medianFeeUsd: 0.015,
    tvl: 4850000000,
    volatility: 0.38,
    trend: 0.65,
    officialUrl: "https://tokenterminal.com/explorer/projects/solana/metrics/all"
  },
  xrp: {
    id: "xrp",
    symbol: "XRP",
    name: "Ripple",
    price: 0.58,
    fdv: 58000000000,
    circulatingMc: 32400000000,
    maxSupply: 100000000000,
    holders: 4800000,
    weeklyVolume: 8400000000,
    weeklyFees: 24000,
    protocolRevenueShare: 1.00,
    expenses: 0,
    activeUsersDaily: 85000,
    coreDevs: 14,
    codeCommitsWeekly: 45,
    blockTimeMinutes: 0.05,
    weeklyTxCount: 12400000,
    avgFeeUsd: 0.002,
    medianFeeUsd: 0.001,
    tvl: 2400000,
    volatility: 0.35,
    trend: 0.12,
    officialUrl: "https://tokenterminal.com/explorer/projects/ripple/metrics/all"
  },
  ada: {
    id: "ada",
    symbol: "ADA",
    name: "Cardano",
    price: 0.42,
    fdv: 18900000000,
    circulatingMc: 14800000000,
    maxSupply: 45000000000,
    holders: 4300000,
    weeklyVolume: 2100000000,
    weeklyFees: 110000,
    protocolRevenueShare: 0.20,
    expenses: 4200000,
    activeUsersDaily: 48000,
    coreDevs: 64,
    codeCommitsWeekly: 180,
    blockTimeMinutes: 0.33,
    weeklyTxCount: 520000,
    avgFeeUsd: 0.21,
    medianFeeUsd: 0.15,
    tvl: 215000000,
    volatility: 0.30,
    trend: 0.05,
    officialUrl: "https://tokenterminal.com/explorer/projects/cardano/metrics/all"
  },
  ldo: {
    id: "ldo",
    symbol: "LDO",
    name: "Lido",
    price: 1.65,
    fdv: 1650000000,
    circulatingMc: 1480000000,
    maxSupply: 1000000000,
    holders: 380000,
    weeklyVolume: 920000000,
    weeklyFees: 15400000,
    protocolRevenueShare: 0.10,
    expenses: 450000,
    activeUsersDaily: 12000,
    coreDevs: 28,
    codeCommitsWeekly: 85,
    blockTimeMinutes: 0.2,
    weeklyTxCount: 140000,
    avgFeeUsd: 0.0,
    medianFeeUsd: 0.0,
    tvl: 34200000000,
    volatility: 0.40,
    trend: 0.25,
    officialUrl: "https://tokenterminal.com/explorer/projects/lido-finance/metrics/all"
  },
  uni: {
    id: "uni",
    symbol: "UNI",
    name: "Uniswap",
    price: 7.85,
    fdv: 7850000000,
    circulatingMc: 4710000000,
    maxSupply: 1000000000,
    holders: 410000,
    weeklyVolume: 12500000000,
    weeklyFees: 16800000,
    protocolRevenueShare: 0.0,
    expenses: 820000,
    activeUsersDaily: 140000,
    coreDevs: 35,
    codeCommitsWeekly: 110,
    blockTimeMinutes: 0.2,
    weeklyTxCount: 1950000,
    avgFeeUsd: 0.0,
    medianFeeUsd: 0.0,
    tvl: 5450000000,
    volatility: 0.36,
    trend: 0.28,
    officialUrl: "https://tokenterminal.com/explorer/projects/uniswap/metrics/all"
  },
  trx: {
    id: "trx",
    symbol: "TRX",
    name: "Tron",
    price: 0.13,
    fdv: 11300000000,
    circulatingMc: 11300000000,
    maxSupply: null,
    holders: 95000000,
    weeklyVolume: 1800000000,
    weeklyFees: 24500000,
    protocolRevenueShare: 1.00,
    expenses: 3500000,
    activeUsersDaily: 2400000,
    coreDevs: 18,
    codeCommitsWeekly: 32,
    blockTimeMinutes: 0.05,
    weeklyTxCount: 48000000,
    avgFeeUsd: 0.51,
    medianFeeUsd: 0.25,
    tvl: 8200000000,
    volatility: 0.20,
    trend: 0.55,
    officialUrl: "https://tokenterminal.com/explorer/projects/tron/metrics/all"
  },
  bnb: {
    id: "bnb",
    symbol: "BNB",
    name: "BNB Chain",
    price: 585,
    fdv: 87750000000,
    circulatingMc: 87750000000,
    maxSupply: 200000000,
    holders: 45000000,
    weeklyVolume: 9500000000,
    weeklyFees: 4800000,
    protocolRevenueShare: 0.30,
    expenses: 0,
    activeUsersDaily: 1100000,
    coreDevs: 55,
    codeCommitsWeekly: 140,
    blockTimeMinutes: 0.05,
    weeklyTxCount: 26000000,
    avgFeeUsd: 0.18,
    medianFeeUsd: 0.08,
    tvl: 5100000000,
    volatility: 0.22,
    trend: 0.38,
    officialUrl: "https://tokenterminal.com/explorer/projects/bsc/metrics/all"
  },
  hype: {
    id: "hype",
    symbol: "HYPE",
    name: "Hyperliquid",
    price: 8.42,
    fdv: 8420000000,
    circulatingMc: 2780000000,
    maxSupply: 1000000000,
    holders: 195000,
    weeklyVolume: 16500000000,
    weeklyFees: 3100000,
    protocolRevenueShare: 1.00,
    expenses: 1200000,
    activeUsersDaily: 135000,
    coreDevs: 12,
    codeCommitsWeekly: 48,
    blockTimeMinutes: 0.01,
    weeklyTxCount: 38500000,
    avgFeeUsd: 0.08,
    medianFeeUsd: 0.04,
    tvl: 2150000000,
    volatility: 0.50,
    trend: 0.95,
    officialUrl: "https://tokenterminal.com/explorer/projects/hyperliquid/metrics/all"
  },
  zec: {
    id: "zec",
    symbol: "ZEC",
    name: "Zcash",
    price: 31.50,
    fdv: 661500000,
    circulatingMc: 495000000,
    maxSupply: 21000000,
    holders: 920000,
    weeklyVolume: 420000000,
    weeklyFees: 450,
    protocolRevenueShare: 0,
    expenses: 980000,
    activeUsersDaily: 14000,
    coreDevs: 8,
    codeCommitsWeekly: 22,
    blockTimeMinutes: 1.25,
    weeklyTxCount: 85000,
    avgFeeUsd: 0.005,
    medianFeeUsd: 0.001,
    tvl: 12000,
    volatility: 0.35,
    trend: -0.10,
    officialUrl: "https://tokenterminal.com/explorer/projects/zcash/metrics/all"
  },
  sui: {
    id: "sui",
    symbol: "SUI",
    name: "Sui",
    price: 2.05,
    fdv: 20500000000,
    circulatingMc: 5600000000,
    maxSupply: 10000000000,
    holders: 1850000,
    weeklyVolume: 3400000000,
    weeklyFees: 450000,
    protocolRevenueShare: 0.50,
    expenses: 3400000,
    activeUsersDaily: 420000,
    coreDevs: 48,
    codeCommitsWeekly: 130,
    blockTimeMinutes: 0.006,
    weeklyTxCount: 28000000,
    avgFeeUsd: 0.016,
    medianFeeUsd: 0.008,
    tvl: 1020000000,
    volatility: 0.45,
    trend: 0.70,
    officialUrl: "https://tokenterminal.com/explorer/projects/sui/metrics/all"
  },
  avax: {
    id: "avax",
    symbol: "AVAX",
    name: "Avalanche",
    price: 32.40,
    fdv: 23328000000,
    circulatingMc: 13200000000,
    maxSupply: 720000000,
    holders: 3200000,
    weeklyVolume: 1600000000,
    weeklyFees: 38000,
    protocolRevenueShare: 1.00,
    expenses: 5200000,
    activeUsersDaily: 76000,
    coreDevs: 42,
    codeCommitsWeekly: 115,
    blockTimeMinutes: 0.03,
    weeklyTxCount: 2400000,
    avgFeeUsd: 0.15,
    medianFeeUsd: 0.06,
    tvl: 1180000000,
    volatility: 0.32,
    trend: 0.15,
    officialUrl: "https://tokenterminal.com/explorer/projects/avalanche/metrics/all"
  },
  near: {
    id: "near",
    symbol: "NEAR",
    name: "Near Protocol",
    price: 5.45,
    fdv: 5450000000,
    circulatingMc: 4950000000,
    maxSupply: 1000000000,
    holders: 28000000,
    weeklyVolume: 2200000000,
    weeklyFees: 120000,
    protocolRevenueShare: 0.70,
    expenses: 3100000,
    activeUsersDaily: 1450000,
    coreDevs: 56,
    codeCommitsWeekly: 165,
    blockTimeMinutes: 0.02,
    weeklyTxCount: 32000000,
    avgFeeUsd: 0.003,
    medianFeeUsd: 0.001,
    tvl: 280000000,
    volatility: 0.35,
    trend: 0.50,
    officialUrl: "https://tokenterminal.com/explorer/projects/near-protocol/metrics/all"
  },
  usdt: {
    id: "usdt",
    symbol: "USDT",
    name: "Tether",
    price: 1.00,
    fdv: 115000000000,
    circulatingMc: 115000000000,
    maxSupply: null,
    holders: 48000000,
    weeklyVolume: 340000000000,
    weeklyFees: 0,
    protocolRevenueShare: 0,
    expenses: 0,
    activeUsersDaily: 3400000,
    coreDevs: 4,
    codeCommitsWeekly: 10,
    blockTimeMinutes: 0,
    weeklyTxCount: 28000000,
    avgFeeUsd: 0,
    medianFeeUsd: 0,
    tvl: 0,
    volatility: 0.01,
    trend: 0.05,
    officialUrl: "https://tokenterminal.com/explorer/projects/tether/metrics/all"
  },
  sky: {
    id: "sky",
    symbol: "SKY",
    name: "Sky",
    price: 3120,
    fdv: 3120000000,
    circulatingMc: 2750000000,
    maxSupply: 1000000,
    holders: 115000,
    weeklyVolume: 480000000,
    weeklyFees: 5400000,
    protocolRevenueShare: 1.00,
    expenses: 2100000,
    activeUsersDaily: 8500,
    coreDevs: 22,
    codeCommitsWeekly: 65,
    blockTimeMinutes: 0.2,
    weeklyTxCount: 42000,
    avgFeeUsd: 0,
    medianFeeUsd: 0,
    tvl: 6850000000,
    volatility: 0.32,
    trend: 0.20,
    officialUrl: "https://tokenterminal.com/explorer/projects/makerdao/metrics/all"
  },
  aave: {
    id: "aave",
    symbol: "AAVE",
    name: "Aave",
    price: 138.50,
    fdv: 2216000000,
    circulatingMc: 2050000000,
    maxSupply: 16000000,
    holders: 165000,
    weeklyVolume: 640000000,
    weeklyFees: 7800000,
    protocolRevenueShare: 0.12,
    expenses: 480000,
    activeUsersDaily: 14500,
    coreDevs: 24,
    codeCommitsWeekly: 75,
    blockTimeMinutes: 0.2,
    weeklyTxCount: 95000,
    avgFeeUsd: 0,
    medianFeeUsd: 0,
    tvl: 12400000000,
    volatility: 0.30,
    trend: 0.35,
    officialUrl: "https://tokenterminal.com/explorer/projects/aave/metrics/all"
  },
  cake: {
    id: "cake",
    symbol: "CAKE",
    name: "PancakeSwap",
    price: 2.15,
    fdv: 1075000000,
    circulatingMc: 580000000,
    maxSupply: 450000000,
    holders: 1600000,
    weeklyVolume: 2800000000,
    weeklyFees: 3200000,
    protocolRevenueShare: 0.10,
    expenses: 920000,
    activeUsersDaily: 340000,
    coreDevs: 18,
    codeCommitsWeekly: 50,
    blockTimeMinutes: 0.05,
    weeklyTxCount: 6800000,
    avgFeeUsd: 0,
    medianFeeUsd: 0,
    tvl: 1480000000,
    volatility: 0.38,
    trend: 0.18,
    officialUrl: "https://tokenterminal.com/explorer/projects/pancakeswap/metrics/all"
  }
};

function getMetricValueForAsset(profile: AssetProfile, metricId: string): { baseValue: number, volatility: number, trend: number } {
  const vol = profile.volatility;
  const tr = profile.trend;
  let baseVal = 0;

  switch (metricId) {
    // --- Key Metrics ---
    case "fully_diluted_market_cap_key":
    case "fully_diluted_market_cap_market":
      baseVal = profile.fdv;
      break;
    case "circulating_market_cap_key":
    case "circulating_market_cap_market":
      baseVal = profile.circulatingMc;
      break;
    case "token_trading_volume_key":
      baseVal = profile.weeklyVolume;
      break;
    case "token_turnover_fdv_key":
      baseVal = profile.fdv > 0 ? (profile.weeklyVolume / profile.fdv) * 100 : 0;
      break;
    case "token_turnover_circulating_key":
      baseVal = profile.circulatingMc > 0 ? (profile.weeklyVolume / profile.circulatingMc) * 100 : 0;
      break;

    // --- Market ---
    case "price_market":
      baseVal = profile.price;
      break;
    case "token_holders_market":
      baseVal = profile.holders;
      break;
    case "maximum_token_supply_market":
      baseVal = profile.maxSupply !== null ? profile.maxSupply : (profile.price > 0 ? profile.circulatingMc / profile.price * 1.5 : 0);
      break;

    // --- Financial ---
    case "fees_financial":
      baseVal = profile.weeklyFees;
      break;
    case "supply_side_fees_financial":
      baseVal = profile.weeklyFees * (1 - profile.protocolRevenueShare);
      break;
    case "revenue_financial":
      baseVal = profile.weeklyFees * profile.protocolRevenueShare;
      break;
    case "expenses_financial":
    case "token_incentives_financial":
      baseVal = profile.expenses;
      break;
    case "earnings_financial":
      baseVal = (profile.weeklyFees * profile.protocolRevenueShare) - profile.expenses;
      break;

    // --- Valuation ---
    case "pf_ratio_circulating_valuation":
      baseVal = profile.weeklyFees > 0 ? (profile.circulatingMc / (profile.weeklyFees * 52)) : 0;
      break;
    case "pf_ratio_fdv_valuation":
      baseVal = profile.weeklyFees > 0 ? (profile.fdv / (profile.weeklyFees * 52)) : 0;
      break;
    case "take_rate_valuation":
      baseVal = profile.protocolRevenueShare * 100;
      break;

    // --- Usage ---
    case "active_users_daily_usage":
      baseVal = profile.activeUsersDaily;
      break;
    case "active_users_weekly_usage":
      baseVal = profile.activeUsersDaily * 4.3;
      break;
    case "active_users_monthly_usage":
      baseVal = profile.activeUsersDaily * 17.1;
      break;
    case "active_addresses_daily_usage":
      baseVal = profile.activeUsersDaily * 1.25;
      break;
    case "active_addresses_weekly_usage":
      baseVal = profile.activeUsersDaily * 5.5;
      break;
    case "active_addresses_monthly_usage":
      baseVal = profile.activeUsersDaily * 21.6;
      break;
    case "afpu_usage":
      baseVal = (profile.activeUsersDaily > 0) ? (profile.weeklyFees / (profile.activeUsersDaily * 4.3)) : 0;
      break;
    case "arpu_usage":
      baseVal = (profile.activeUsersDaily > 0) ? ((profile.weeklyFees * profile.protocolRevenueShare) / (profile.activeUsersDaily * 4.3)) : 0;
      break;

    // --- Development ---
    case "core_developers_dev":
      baseVal = profile.coreDevs;
      break;
    case "code_commits_dev":
      baseVal = profile.codeCommitsWeekly;
      break;

    // --- Technical ---
    case "block_time_tech":
      baseVal = profile.blockTimeMinutes;
      break;
    case "transaction_count_tech":
      baseVal = profile.weeklyTxCount;
      break;
    case "tps_tech":
      baseVal = profile.weeklyTxCount / 604800;
      break;
    case "avg_fee_tech":
      baseVal = profile.avgFeeUsd;
      break;
    case "median_fee_tech":
      baseVal = profile.medianFeeUsd;
      break;

    // --- Ecosystem ---
    case "ecosystem_tvl":
      baseVal = profile.tvl;
      break;

    default:
      baseVal = 0;
  }

  return { baseValue: baseVal, volatility: vol, trend: tr };
}

const getDynamicDescription = (metric: MetricDef, profile: AssetProfile) => {
  let desc = metric.description;
  const maxSupplyStr = profile.maxSupply !== null ? profile.maxSupply.toLocaleString("id-ID") : "tidak terbatas";
  
  desc = desc.replace(/Bitcoin/g, profile.name);
  desc = desc.replace(/BTC/g, profile.symbol);
  desc = desc.replace(/21\.000\.000/g, maxSupplyStr);
  
  if (profile.id !== "btc") {
    desc = desc.replace(/penambang/g, "validator/penyedia likuiditas");
    desc = desc.replace(/miner/g, "validator");
    desc = desc.replace(/penambangan/g, "validasi");
  }
  return desc;
};

// IMPL-C3: Metric IDs whose values can be derived from the live
// /api/coins/rankings response (price, marketCap, volume, supply, FDV,
// turnover). All other metrics (fees, revenue, dev counts, TVL, etc.) come
// from the fallback ASSET_PROFILES snapshot and are labelled "EST" in the UI.
const LIVE_METRIC_IDS = new Set([
  "price_market",
  "circulating_market_cap_key",
  "circulating_market_cap_market",
  "fully_diluted_market_cap_key",
  "fully_diluted_market_cap_market",
  "token_trading_volume_key",
  "token_turnover_fdv_key",
  "token_turnover_circulating_key",
  "maximum_token_supply_market",
]);

interface LiveCoinData {
  price: number;
  marketCap: number;
  volume24h: number;
  change24h: number;
  change7d: number;
  circulatingSupply: number;
}

export default function TokenTerminalExplorer() {
  const [selectedAssetId, setSelectedAssetId] = useState<string>("btc");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeMetricId, setActiveMetricId] = useState<string>("fully_diluted_market_cap_key");
  const [chartType, setChartType] = useState<"area" | "line" | "bar">("area");
  const [showGrid, setShowGrid] = useState<boolean>(true);

  // Keep track of which categories are collapsed/expanded
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    CATEGORIES.forEach(cat => {
      initial[cat] = true;
    });
    return initial;
  });

  // IMPL-C3: live data state. /api/coins/rankings overlays live price /
  // marketCap / volume / supply onto the fallback ASSET_PROFILES snapshot.
  const [liveRankings, setLiveRankings] = useState<Record<string, LiveCoinData>>({});
  const [rankingsLoading, setRankingsLoading] = useState<boolean>(true);
  const [rankingsError, setRankingsError] = useState<string | null>(null);
  // /api/history/:symbol returns ~100 days of daily closes for 8 of 18 assets.
  const [liveHistory, setLiveHistory] = useState<Array<{ date: string; close: number }>>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Pull live BTC/ETH/BNB/XRP/SOL/TRX/HYPE prices from the Zustand store
  // (Binance WS feed). Used as a real-time sanity check overlay.
  const liveBtcPrice = useGlobalStore(s => s.liveBtcPrice);
  const liveEthPrice = useGlobalStore(s => s.liveEthPrice);
  const liveBnbPrice = useGlobalStore(s => s.liveBnbPrice);
  const liveXrpPrice = useGlobalStore(s => s.liveXrpPrice);
  const liveSolPrice = useGlobalStore(s => s.liveSolPrice);
  const liveTrxPrice = useGlobalStore(s => s.liveTrxPrice);
  const liveHypePrice = useGlobalStore(s => s.liveHypePrice);

  // Fetch /api/coins/rankings on mount + every 60s. Falls back gracefully
  // to ASSET_PROFILES on error — does NOT crash the component.
  useEffect(() => {
    let cancelled = false;
    const fetchRankings = async () => {
      try {
        setRankingsLoading(true);
        setRankingsError(null);
        const res = await fetch("/api/coins/rankings");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.success) throw new Error(data.error || "Gagal memuat data pasar.");
        const map: Record<string, LiveCoinData> = {};
        for (const c of (data.coins || [])) {
          const sym = (c.symbol || "").toUpperCase();
          if (!sym) continue;
          map[sym] = {
            price: Number(c.price) || 0,
            marketCap: Number(c.marketCap) || 0,
            volume24h: Number(c.volume24h) || 0,
            change24h: Number(c.change24h) || 0,
            change7d: Number(c.change7d) || 0,
            circulatingSupply: Number(c.circulatingSupply) || 0,
          };
        }
        setLiveRankings(map);
      } catch (err: any) {
        if (!cancelled) setRankingsError(err?.message || "Gagal memuat data pasar.");
      } finally {
        if (!cancelled) setRankingsLoading(false);
      }
    };
    fetchRankings();
    const interval = setInterval(fetchRankings, 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Fetch /api/history/:symbol when the selected asset changes. Only 8 of
  // 18 assets have a history endpoint (BTC/ETH/SOL/BNB/XRP/ADA/SUI/AVAX);
  // for the rest we keep the synthetic projection (labelled EST).
  useEffect(() => {
    let cancelled = false;
    const fetchHistory = async () => {
      const sym = ASSET_PROFILES[selectedAssetId]?.symbol;
      if (!sym) {
        setLiveHistory([]);
        return;
      }
      try {
        setHistoryLoading(true);
        const res = await fetch(`/api/history/${sym}`);
        if (!res.ok) {
          if (!cancelled) setLiveHistory([]);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const hist: Array<{ date: string; close: number }> = (data.history || []).map((h: any) => ({
          date: h.date,
          close: Number(h.close) || 0,
        }));
        setLiveHistory(hist);
      } catch {
        if (!cancelled) setLiveHistory([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    fetchHistory();
    return () => { cancelled = true; };
  }, [selectedAssetId]);

  const selectedAsset = useMemo(() => {
    const opt = ASSET_OPTIONS.find(a => a.id === selectedAssetId) || ASSET_OPTIONS[0];
    const live = liveRankings[opt.symbol];
    // IMPL-C3: hasData reflects reality — true if EITHER live rankings OR
    // fallback profile exists for this asset. (Previously all 18 assets had
    // hasData:true unconditionally while the empty-state copy claimed only
    // BTC was available — an internal contradiction.)
    return { ...opt, hasData: !!live || !!ASSET_PROFILES[opt.id] };
  }, [selectedAssetId, liveRankings]);

  const profile = useMemo(() => {
    const base = ASSET_PROFILES[selectedAssetId] || ASSET_PROFILES.btc;
    const live = liveRankings[base.symbol];
    if (!live) return base;
    // Overlay live price / marketCap / volume onto the fallback snapshot.
    // Fields CoinGecko doesn't provide (fees, revenue, devs, TVL, etc.) keep
    // their fallback values and are flagged EST in the UI via LIVE_METRIC_IDS.
    const livePrice = live.price || base.price;
    const liveMcap = live.marketCap > 0 ? live.marketCap : base.circulatingMc;
    const liveWeeklyVolume = (live.volume24h || 0) * 7 || base.weeklyVolume;
    // IMPL-C3: prefer the higher-frequency Zustand WS price (Binance feed,
    // sub-second) for the 7 supported assets when available; fall back to the
    // /api/coins/rankings price (60s polling).
    const wsPrice = (() => {
      switch (base.symbol) {
        case "BTC": return liveBtcPrice;
        case "ETH": return liveEthPrice;
        case "BNB": return liveBnbPrice;
        case "XRP": return liveXrpPrice;
        case "SOL": return liveSolPrice;
        case "TRX": return liveTrxPrice;
        case "HYPE": return liveHypePrice;
        default: return 0;
      }
    })();
    const finalPrice = wsPrice > 0 ? wsPrice : livePrice;
    const liveFdv = base.maxSupply !== null
      ? finalPrice * base.maxSupply
      : (live.marketCap > 0 ? live.marketCap : base.fdv);
    return {
      ...base,
      price: finalPrice,
      circulatingMc: liveMcap,
      weeklyVolume: liveWeeklyVolume,
      fdv: liveFdv,
    };
  }, [selectedAssetId, liveRankings, liveBtcPrice, liveEthPrice, liveBnbPrice, liveXrpPrice, liveSolPrice, liveTrxPrice, liveHypePrice]);

  // IMPL-C3: helper — is the currently-selected metric's value derived
  // from live API data (LIVE badge) or from the fallback snapshot (EST badge)?
  const isMetricLive = useMemo(() => {
    return LIVE_METRIC_IDS.has(activeMetricId) && !!liveRankings[profile.symbol];
  }, [activeMetricId, profile, liveRankings]);
  // (isMetricLive retained for potential future use; the inline badge in the
  // metric list also uses LIVE_METRIC_IDS directly.)
  void isMetricLive;

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const activeMetric = useMemo(() => {
    return METRICS_LIST.find(m => m.id === activeMetricId) || METRICS_LIST[0];
  }, [activeMetricId]);

  // IMPL-C3: When the active metric is `price_market` AND we have live
  // history from /api/history/:symbol (returned ~100 daily closes), use the
  // REAL price history as chart data. Otherwise, fall back to the synthetic
  // 52-week projection (labelled EST in the UI). /api/history only supports
  // 8 of 18 assets (BTC/ETH/SOL/BNB/XRP/ADA/SUI/AVAX); for the other 10 the
  // synthetic projection remains and an EST badge is shown.
  const usingLiveHistory = activeMetric.id === "price_market" && liveHistory.length > 0;

  const chartData = useMemo(() => {
    // Live branch: real ~100-day daily closes from /api/history.
    if (activeMetric.id === "price_market" && liveHistory.length > 0) {
      return liveHistory.map((h, i) => ({
        week: `H${i + 1}`,
        date: h.date,
        value: h.close,
      }));
    }

    // Synthetic fallback (unchanged from original implementation).
    const dataPoints = [];
    const metric = activeMetric;
    const { baseValue: baseVal, volatility: vol, trend: tr } = getMetricValueForAsset(profile, metric.id);

    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1); // 1 year ago

    for (let w = 0; w < 52; w++) {
      const weekDate = new Date(startDate.getTime() + w * 7 * 24 * 60 * 60 * 1000);
      const dateString = weekDate.toLocaleDateString("id-ID", { day: '2-digit', month: 'short', year: 'numeric' });

      // Consistent pseudo-random math
      const sinFactor = Math.sin(w / 6);
      const cosFactor = Math.cos(w / 10);
      const trendProgress = w / 51; // 0 to 1
      const noise = Math.sin(w * 17) * 0.06 + Math.cos(w * 31) * 0.04;

      // Compound growth + wave oscillation + noise
      const factor = 1 + (tr * trendProgress) + (sinFactor * 0.18 + cosFactor * 0.07 + noise) * vol;
      
      let finalValue = baseVal * factor;

      // Clean zeros or special overrides
      if (metric.id.includes("revenue") || metric.id.includes("take_rate") || metric.id.includes("arpu")) {
        if (baseVal === 0) finalValue = 0;
      }
      if (metric.id.includes("maximum_token_supply")) {
        finalValue = profile.maxSupply !== null ? profile.maxSupply : (profile.price > 0 ? profile.circulatingMc / profile.price * 1.5 : 0);
      }

      dataPoints.push({
        week: `M${w + 1}`,
        date: dateString,
        value: finalValue
      });
    }

    return dataPoints;
  }, [activeMetric, profile, liveHistory]);

  // Derived calculation stats for 365d display cards
  const stats = useMemo(() => {
    if (chartData.length === 0) return { current: 0, sumOrAvg: 0, changePercent: 0 };
    
    const current = chartData[chartData.length - 1].value;
    const startVal = chartData[0].value;
    
    let changePercent = 0;
    if (startVal !== 0) {
      changePercent = ((current - startVal) / startVal) * 100;
    }

    const isSumMetric = activeMetric.interval.includes("sum");
    const valuesArray = chartData.map(d => d.value);

    let sumOrAvg = 0;
    if (isSumMetric) {
      sumOrAvg = valuesArray.reduce((acc, v) => acc + v, 0); // weekly sum metrics -> aggregate to a yearly sum
    } else {
      sumOrAvg = valuesArray.reduce((acc, v) => acc + v, 0) / valuesArray.length; // weekly average metrics -> yearly average of averages
    }

    return {
      current,
      sumOrAvg,
      changePercent
    };
  }, [chartData, activeMetric]);

  // Formatter specifically tailored for Token Terminal design
  const formatMetricValue = (val: number, type: MetricDef["type"], isCompact = false) => {
    if (type === "percentage") {
      return `${val.toFixed(2)}%`;
    }
    if (type === "time") {
      return `${val.toFixed(2)} mnt`;
    }
    if (type === "ratio") {
      return `${val.toLocaleString("en-US", { maximumFractionDigits: 1 })}x`;
    }
    if (type === "currency") {
      if (val === 0) return "$0";
      if (isCompact) {
        if (Math.abs(val) >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
        if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
        if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
        if (Math.abs(val) >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
      }
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Math.abs(val) < 100 ? 2 : 0
      }).format(val);
    }
    
    // count types
    if (isCompact) {
      if (val >= 1e9) return `${(val / 1e9).toFixed(2)}Miliar`;
      if (val >= 1e6) return `${(val / 1e6).toFixed(2)}jt`;
      if (val >= 1e3) return `${(val / 1e3).toFixed(1)}rb`;
    }
    return val.toLocaleString("id-ID", { maximumFractionDigits: 0 });
  };

  // Filter metrics list based on search bar
  const filteredMetrics = useMemo(() => {
    return METRICS_LIST.filter(metric => {
      return metric.name.toLowerCase().includes(searchQuery) || 
             metric.category.toLowerCase().includes(searchQuery) ||
             metric.description.toLowerCase().includes(searchQuery);
    });
  }, [searchQuery]);

  // Group metrics by categories
  const groupedMetrics = useMemo(() => {
    const grouped: Record<string, MetricDef[]> = {};
    CATEGORIES.forEach(cat => {
      grouped[cat] = [];
    });
    filteredMetrics.forEach(metric => {
      if (grouped[metric.category]) {
        grouped[metric.category].push(metric);
      }
    });
    return grouped;
  }, [filteredMetrics]);

  return (
    <div id="token-terminal-widget" className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-2xl backdrop-blur-md animate-fadeIn text-slate-100">
      
      {/* 1. Header & Asset Selector */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between border-b border-slate-800/80 pb-6 mb-6 gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="flex h-3 w-3 rounded-full bg-cyan-500 animate-pulse" />
            <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              Token Terminal Explorer
              <span className="text-[10px] uppercase font-mono tracking-widest bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800">
                PRO v3.1
              </span>
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            {/* IMPL-C3: removed false "weekly synchronization" claim. Data is
                now fetched live from /api/coins/rankings (CoinGecko/Binance)
                + /api/history for the price metric. Non-price metrics use a
                fallback snapshot labelled EST. */}
            Analisis 35 metrik finansial, teknik, kegunaan, dan valuasi. Data pasar langsung (CoinGecko/Binance) — metrik tanpa sumber live ditandai <span className="text-amber-400 font-bold">EST</span>.
          </p>
        </div>

        {/* Horizontal scrollable asset selection bar */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">
            Pilih Aset untuk Dianalisa:
          </span>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
            {ASSET_OPTIONS.map((asset) => {
              const isSelected = selectedAssetId === asset.id;
              return (
                <button
                  key={asset.id}
                  id={`tt-asset-select-${asset.id}`}
                  onClick={() => setSelectedAssetId(asset.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isSelected 
                      ? "bg-slate-800 text-white border-cyan-500 shadow-md ring-2 ring-cyan-500/20 scale-[1.03]" 
                      : "bg-slate-950/40 hover:bg-slate-950/80 text-slate-400 border-slate-800/80 hover:text-slate-200"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${asset.hasData ? "bg-emerald-500" : "bg-slate-500"}`} />
                  <span className="font-bold">{asset.symbol}</span>
                  <span className="text-[9px] text-slate-500 font-medium font-sans">({asset.name})</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* RENDER BODY BASED ON HAS_DATA */}
      {!selectedAsset.hasData ? (
        
        /* 2A. EMPTY STATE SCREEN ("DATA KOSONG") */
        <div id="tt-empty-state" className="py-16 md:py-24 text-center max-w-2xl mx-auto flex flex-col items-center justify-center space-y-6">
          <div className="w-20 h-20 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-center text-slate-500 relative">
            <Database className="w-10 h-10 animate-pulse text-rose-500/80" />
            <span className="absolute top-1.5 right-1.5 h-3.5 w-3.5 rounded-full bg-rose-500 border-2 border-slate-950" />
          </div>
          
          <div className="space-y-2">
            <h3 className="text-2xl font-black text-white uppercase tracking-tight flex items-center justify-center gap-2">
              Data Kosong
            </h3>
            <p className="text-xs bg-rose-950/50 border border-rose-500/20 text-rose-400 px-3 py-1 rounded-full inline-block font-mono">
              Tidak ada data Token Terminal untuk {selectedAsset.symbol}
            </p>
          </div>

          <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 text-sm text-slate-400 leading-relaxed space-y-3 shadow-inner">
            <p className="text-slate-300">
              Dalam dunia nyata, setiap aset crypto memiliki struktur data on-chain, valuasi, dan finansial yang sangat berbeda.
            </p>
            <p className="text-xs text-slate-500 text-left list-disc list-inside">
              • Misalnya, <span className="font-bold text-slate-300">Bitcoin</span> tidak memiliki TVL kontrak pintar bawaan, sedangkan <span className="font-bold text-slate-300">Uniswap</span> memiliki volume perdagangan bursa tetapi tidak didukung oleh hashrate penambangan.
            </p>
            {/* IMPL-C3: previously this claimed "simulasi database 35 metrik
                lengkap hanya tersedia untuk Bitcoin (BTC)" — but all 18
                assets had hasData:true, making the empty state unreachable
                and the copy misleading. Updated to honest copy. */}
            <p className="text-slate-400">
              Data live tersedia untuk aset yang terdaftar di CoinGecko top 100. Metrik yang tidak memiliki sumber live ditandai <span className="text-amber-400 font-extrabold">EST</span> (estimasi snapshot).
            </p>
          </div>

          <button
            id="tt-empty-back-to-btc"
            onClick={() => setSelectedAssetId("btc")}
            className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl text-sm font-bold shadow-lg shadow-cyan-500/10 cursor-pointer active:scale-95 transition-all"
          >
            <span>Analisis Bitcoin (BTC) Sekarang</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (

        /* 2B. ACTIVE TERMINAL WORKSPACE (BTC FULL SIMULATED DATA) */
        <div id="tt-workspace" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* ==============================================
              LEFT COLUMN: METRICS LIST SIDEBAR (4 COLS)
              ============================================== */}
          <div className="lg:col-span-4 bg-slate-950/50 border border-slate-800/80 rounded-xl p-4 flex flex-col space-y-4 max-h-[700px] overflow-hidden">
            
            {/* Search filter input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                id="tt-metric-search"
                type="text"
                value={searchQuery === "" ? "" : searchQuery}
                onChange={(e) => setSearchQuery(e.target.value.toLowerCase())}
                placeholder="Cari dari 35 metrik Token Terminal..."
                className="w-full bg-slate-950 border border-slate-800/80 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 font-sans"
              />
            </div>

            {/* Scrollable list of metrics grouped by categories */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-3 scrollbar-thin">
              {CATEGORIES.map((category) => {
                const metricsInCat = groupedMetrics[category] || [];
                const isExpanded = expandedCategories[category];

                if (metricsInCat.length === 0) return null;

                return (
                  <div key={category} className="border border-slate-800/40 rounded-lg overflow-hidden bg-slate-950/20">
                    {/* Collapsible header */}
                    <button
                      id={`tt-cat-toggle-${category.replace(" ", "-").toLowerCase()}`}
                      onClick={() => toggleCategory(category)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-slate-950/40 text-[11px] font-bold text-slate-300 uppercase tracking-wider hover:bg-slate-900 border-b border-slate-800/20"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                        {category}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                        <span>({metricsInCat.length})</span>
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </div>
                    </button>

                    {/* Sub-items list */}
                    {isExpanded && (
                      <div className="p-1 space-y-0.5 divide-y divide-slate-900/30">
                        {metricsInCat.map((metric) => {
                          const isActive = activeMetricId === metric.id;
                          
                          // Quick deterministic value generation for side-pill representation
                          const { baseValue: baseVal, trend: tr } = getMetricValueForAsset(profile, metric.id);
                          let displayVal = baseVal * (1 + tr);
                          if (metric.id.includes("maximum_token_supply")) {
                            displayVal = profile.maxSupply !== null ? profile.maxSupply : (profile.price > 0 ? profile.circulatingMc / profile.price * 1.5 : 0);
                          }

                          return (
                            <button
                              key={metric.id}
                              id={`tt-metric-select-${metric.id}`}
                              onClick={() => setActiveMetricId(metric.id)}
                              className={`w-full text-left p-2.5 rounded-md transition-all text-xs flex items-center justify-between ${
                                isActive 
                                  ? "bg-slate-800 text-white font-bold border-l-2 border-cyan-500" 
                                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-900/40"
                              }`}
                            >
                              <span className="truncate pr-1.5 font-medium flex items-center gap-1.5">
                                {metric.name}
                                {/* IMPL-C3: per-metric LIVE/EST micro-badge so the
                                    user can see at a glance which values come
                                    from /api/coins/rankings vs the fallback
                                    snapshot. */}
                                {LIVE_METRIC_IDS.has(metric.id) && liveRankings[profile.symbol] ? (
                                  <span className="text-[8px] font-mono font-bold px-1 py-px rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shrink-0">LIVE</span>
                                ) : (
                                  <span className="text-[8px] font-mono font-bold px-1 py-px rounded border bg-amber-500/10 text-amber-400 border-amber-500/30 shrink-0">EST</span>
                                )}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500 font-bold bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800/40 shrink-0">
                                {formatMetricValue(displayVal, metric.type, true)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* No results empty search state */}
              {filteredMetrics.length === 0 && (
                <div className="text-center py-8 text-xs text-slate-500 font-sans">
                  Tidak ada metrik yang cocok dengan kata kunci Anda.
                </div>
              )}
            </div>
          </div>

          {/* ==============================================
              RIGHT COLUMN: DETAILED EXPLORER WORKSPACE (8 COLS)
              ============================================== */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* 3. Header Info Box */}
            <div className="bg-slate-950/60 border border-slate-800 p-5 rounded-xl space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 border-b border-slate-800/50 pb-3">
                <div>
                  <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest block font-mono">
                    {selectedAsset.name} ({selectedAsset.symbol}) / {activeMetric.category}
                  </span>
                  <h3 className="text-lg md:text-xl font-black text-white mt-1">
                    {activeMetric.name}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 border border-slate-800 text-[10px] font-mono font-bold text-slate-400 px-3 py-1.5 rounded-lg flex items-center gap-1.5 self-start md:self-center shrink-0">
                    <Calendar className="w-3.5 h-3.5 text-cyan-500" />
                    <span>{usingLiveHistory ? "Riwayat harga 100 hari live" : activeMetric.interval}</span>
                  </div>
                  
                  {/* IMPL-C3: LIVE / EST badge reflects whether the chart shows
                      real /api/history data (LIVE) or the synthetic projection
                      (EST). */}
                  <span className={`text-[9px] uppercase font-mono font-bold px-2 py-1 rounded border ${usingLiveHistory ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
                    {usingLiveHistory ? "LIVE" : "EST"}
                  </span>

                  <a
                    href={profile.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-950/30 hover:bg-cyan-950/50 border border-cyan-800/40 px-3 py-1.5 rounded-lg transition-all self-start md:self-center shrink-0"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {/* IMPL-C3: honest relabel — this is just an external link
                        to tokenterminal.com, not a live data feed. */}
                    Buka di TokenTerminal.com
                  </a>
                </div>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed font-sans">
                {getDynamicDescription(activeMetric, profile)}
              </p>
            </div>

            {/* 4. Core STATS CARDS Row (3 Cards) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Stat 1: Current value */}
              <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Nilai Saat Ini
                </span>
                <div className="text-lg md:text-xl font-black text-white font-mono truncate">
                  {formatMetricValue(stats.current, activeMetric.type)}
                </div>
                <div className="text-[10px] text-slate-400">
                  {usingLiveHistory ? "Harga penutupan terakhir" : "Data minggu terakhir"}
                </div>
              </div>

              {/* Stat 2: Aggregate metric value */}
              <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  {/* IMPL-C3: label adjusts based on whether we're using live
                      100-day history or the synthetic 365-day projection. */}
                  {usingLiveHistory
                    ? (activeMetric.interval.includes("sum") ? "Total Akumulasi 100 Hari" : "Rata-Rata 100 Hari")
                    : (activeMetric.interval.includes("sum") ? "Total Akumulasi 365d" : "Rata-Rata 365d")}
                </span>
                <div className="text-lg md:text-xl font-black text-white font-mono truncate">
                  {formatMetricValue(stats.sumOrAvg, activeMetric.type)}
                </div>
                <div className="text-[10px] text-slate-400">
                  {usingLiveHistory ? "Rata-rata harga harian" : (activeMetric.interval.includes("sum") ? "Akumulasi jumlah mingguan" : "Rata-rata mingguan")}
                </div>
              </div>

              {/* Stat 3: percentage change */}
              <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  {usingLiveHistory ? "Perubahan 100 Hari" : "Perubahan 365 Hari"}
                </span>
                <div className="flex items-center gap-1.5 mt-1">
                  {stats.changePercent === 0 ? (
                    <span className="text-lg md:text-xl font-black text-slate-400 font-mono">0.00%</span>
                  ) : stats.changePercent > 0 ? (
                    <>
                      <TrendingUp className="w-5 h-5 text-emerald-400 shrink-0" />
                      <span className="text-lg md:text-xl font-black text-emerald-400 font-mono">
                        +{stats.changePercent.toFixed(2)}%
                      </span>
                    </>
                  ) : (
                    <>
                      <TrendingDown className="w-5 h-5 text-rose-400 shrink-0" />
                      <span className="text-lg md:text-xl font-black text-rose-400 font-mono">
                        {stats.changePercent.toFixed(2)}%
                      </span>
                    </>
                  )}
                </div>
                <div className="text-[10px] text-slate-400">
                  {usingLiveHistory ? "Perubahan dari hari ke-1" : "Perubahan dari minggu ke-1"}
                </div>
              </div>
            </div>

            {/* 5. Core Chart Canvas Card */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/60 pb-4 gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Grafik Analisis Visual
                  </span>
                </div>

                {/* Chart Type controls */}
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button
                    id="tt-chart-type-area"
                    onClick={() => setChartType("area")}
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase flex items-center gap-1 transition-all cursor-pointer ${
                      chartType === "area" ? "bg-slate-800 text-white shadow" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Area
                  </button>
                  <button
                    id="tt-chart-type-line"
                    onClick={() => setChartType("line")}
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase flex items-center gap-1 transition-all cursor-pointer ${
                      chartType === "line" ? "bg-slate-800 text-white shadow" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <LineIcon className="w-3.5 h-3.5" />
                    Line
                  </button>
                  <button
                    id="tt-chart-type-bar"
                    onClick={() => setChartType("bar")}
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase flex items-center gap-1 transition-all cursor-pointer ${
                      chartType === "bar" ? "bg-slate-800 text-white shadow" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <BarChart className="w-3.5 h-3.5" />
                    Bar
                  </button>
                </div>
              </div>

              {/* Responsive chart container */}
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === "area" ? (
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorTTValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="week" stroke="#475569" fontSize={9} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={9} tickLine={false} tickFormatter={(v) => formatMetricValue(v, activeMetric.type, true)} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: "#0b0f19", borderColor: "#1e293b", borderRadius: 8 }}
                        labelClassName="text-slate-500 font-mono text-[10px]"
                        formatter={(value: any) => [formatMetricValue(value as number, activeMetric.type), activeMetric.name]}
                      />
                      <Area type="monotone" dataKey="value" stroke="#06b6d4" fillOpacity={1} fill="url(#colorTTValue)" strokeWidth={2} />
                    </AreaChart>
                  ) : chartType === "line" ? (
                    <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="week" stroke="#475569" fontSize={9} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={9} tickLine={false} tickFormatter={(v) => formatMetricValue(v, activeMetric.type, true)} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: "#0b0f19", borderColor: "#1e293b", borderRadius: 8 }}
                        labelClassName="text-slate-500 font-mono text-[10px]"
                        formatter={(value: any) => [formatMetricValue(value as number, activeMetric.type), activeMetric.name]}
                      />
                      <Line type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2.5} activeDot={{ r: 6 }} dot={false} />
                    </LineChart>
                  ) : (
                    <RechartsBarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="week" stroke="#475569" fontSize={9} tickLine={false} />
                      <YAxis stroke="#475569" fontSize={9} tickLine={false} tickFormatter={(v) => formatMetricValue(v, activeMetric.type, true)} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: "#0b0f19", borderColor: "#1e293b", borderRadius: 8 }}
                        labelClassName="text-slate-500 font-mono text-[10px]"
                        formatter={(value: any) => [formatMetricValue(value as number, activeMetric.type), activeMetric.name]}
                      />
                      <Bar dataKey="value" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                    </RechartsBarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>

            {/* 6. Raw Data Table (Week Breakdown) */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-cyan-500" />
                  {/* IMPL-C3: when using live history the rows are daily, not weekly. */}
                  {usingLiveHistory ? "Rincian Data Harian (10 Hari Terakhir)" : "Rincian Data Mingguan (10 Minggu Terakhir)"}
                </span>
                
                {/* IMPL-C3: REAL CSV download (previously a fake alert).
                    Builds a CSV string from the actual chartData + stats,
                    creates a Blob, and triggers download via a temporary
                    <a download> element. Button UI is unchanged. */}
                <button
                  id="tt-download-simulation-data"
                  onClick={() => {
                    try {
                      const headers = ["Periode", "Tanggal", "Nilai", "Deviasi(%)"];
                      const rows = chartData.slice(-10).reverse().map(row => {
                        const dev = stats.sumOrAvg !== 0
                          ? ((row.value - stats.sumOrAvg) / stats.sumOrAvg) * 100
                          : 0;
                        return [
                          row.week,
                          row.date,
                          row.value.toFixed(6),
                          dev.toFixed(2),
                        ];
                      });
                      const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
                      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `token_terminal_${profile.symbol.toLowerCase()}_${activeMetric.id}.csv`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      console.error("CSV download failed", err);
                    }
                  }}
                  className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 bg-cyan-950/50 border border-cyan-900/50 px-2 py-1 rounded hover:bg-cyan-950 transition-all cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  Unduh CSV
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-800/60 rounded-lg">
                <table className="w-full text-left text-xs divide-y divide-slate-800/80">
                  <thead className="bg-slate-950">
                    <tr className="text-[10px] uppercase font-bold text-slate-500">
                      <th className="px-4 py-2.5">{usingLiveHistory ? "Hari" : "Minggu"}</th>
                      <th className="px-4 py-2.5">Tanggal Pelaporan</th>
                      <th className="px-4 py-2.5 text-right">Nilai Metrik</th>
                      <th className="px-4 py-2.5 text-right">Deviasi dari Rerata/Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/60 bg-slate-950/25">
                    {chartData.slice(-10).reverse().map((row, idx) => {
                      // Calculate deviation from mean/avg
                      const dev = stats.sumOrAvg !== 0 ? ((row.value - stats.sumOrAvg) / stats.sumOrAvg) * 100 : 0;
                      return (
                        <tr key={idx} className="hover:bg-slate-900/35 transition-colors font-sans">
                          <td className="px-4 py-2 font-mono text-cyan-400 font-semibold">{row.week}</td>
                          <td className="px-4 py-2 text-slate-300">{row.date}</td>
                          <td className="px-4 py-2 text-right font-mono text-white font-bold">
                            {formatMetricValue(row.value, activeMetric.type)}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono text-[11px] font-bold ${dev === 0 ? "text-slate-400" : dev > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {dev === 0 ? "0.00%" : dev > 0 ? `+${dev.toFixed(1)}%` : `${dev.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
