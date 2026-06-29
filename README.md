# Z-CAPITAL | Institutional Crypto Gateway

<p align="center">
  <strong>Z-CAPITAL Institutional Gateway</strong><br>
  Terminal analisis kripto real-time dengan data on-chain live, derivatif, dan AI analysis.
</p>

---

## 🚀 Fitur Utama

### Real-Time Data (LIVE)
- **Binance WebSocket** — Liquidation feed real-time dari Binance Futures
- **Binance Futures API** — Funding rates, Open Interest live
- **CoinGecko API** — Market cap, BTC dominance, price history 30 hari
- **Alternative.me** — Fear & Greed Index real-time
- **Blockstream/Mempool.space** — Bitcoin block data, on-chain transactions
- **Yahoo Finance** — Data saham Indonesia (IDX)

### On-Chain Terminal (9 Tab)
1. **Derivatif & OI** — Open Interest, Funding Rates, CME OI, Altcoin OI
2. **Likuidasi** — Liquidation heatmap, real-time feed, exchange breakdown
3. **Volume & Heatmap** — 24h gainers/losers, spot vs futures volume
4. **Settlement Funding** — Cumulative fees, funding rate heatmap
5. **Orderbook Depth** — Bid/ask pressure, liquidity delta
6. **Arus On-Chain** — BTC spot flows, exchange balances, addresses, miner data
7. **Valuasi & Makro** — Stock-to-Flow, MVRV, NVT, dominance, ETF, correlations
8. **Token Terminal** — Token Terminal Explorer
9. **Analisis AI** — Gemini-powered on-chain analysis with live data grounding

### Trading & Portfolio
- **Crypto Hub** — Manajemen portofolio kripto multi-aset
- **AI Trade Signals** — Sinyal trading berbasis AI
- **Strategy Backtester** — Backtesting strategi trading
- **Technical Terminal** — Analisis teknikal chart
- **Ledger History & Tax** — Pencatatan transaksi dengan FIFO PnL

### Security & Automation
- **Security & 2FA** — Two-Factor Authentication setup
- **Trade Automation** — API automation untuk bursa
- **Settings Hub** — Konfigurasi sistem lengkap

---

## 📁 Struktur Project

```
z-capitalku/
├── server.ts                  # Express + Vite dev server (port 3000)
├── onchainDataHelper.ts        # Live on-chain data processor
├── onchainScanner.ts           # Multi-chain scanner (BTC, ETH, BSC, TRX, SOL)
├── src/
│   ├── main.tsx               # React entry point
│   ├── App.tsx                 # Main app with routing & auth
│   ├── store.ts                # Zustand global state
│   ├── types.ts                # TypeScript interfaces
│   ├── components/
│   │   ├── SplashScreen.tsx     # Splash screen (auth bypass)
│   │   ├── AuthScreen.tsx       # Firebase auth (disabled)
│   │   ├── Sidebar.tsx          # Navigation sidebar
│   │   ├── Dashboard.tsx        # Main dashboard
│   │   ├── OnChainData.tsx      # On-chain terminal (LIVE data)
│   │   ├── TokenTerminalExplorer.tsx
│   │   ├── CoinsRankings.tsx    # Top 100 coins
│   │   ├── NewsSection.tsx      # Newsroom feed
│   │   ├── AssetsHub.tsx        # Crypto portfolio hub
│   │   ├── AiSignals.tsx        # AI trading signals
│   │   ├── MultiDocAnalysis.tsx # AI multi-doc comparison
│   │   ├── Projections.tsx      # Profit projections
│   │   ├── Backtester.tsx       # Strategy backtester
│   │   ├── TechnicalTerminal.tsx# Technical analysis
│   │   ├── ApiAutomation.tsx    # Trade automation
│   │   ├── Ledger.tsx           # Ledger history
│   │   ├── SecurityCenter.tsx   # Security & 2FA
│   │   └── Settings.tsx         # Settings hub
│   ├── utils/
│   │   └── onChainMockData.ts   # Mock data (fallback)
│   └── lib/
│       └── firebase.ts          # Firebase config
├── mini-services/
│   └── price-feed/             # Binance WS price feed
├── vite.config.ts              # Vite configuration
└── Caddyfile                   # Caddy reverse proxy
```

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| React 19 | UI Framework |
| Vite 6 | Build tool & dev server |
| Express | Backend API server |
| TypeScript | Type safety |
| Tailwind CSS 4 | Styling |
| Zustand | Client state management |
| TanStack Query | Server state |
| Recharts | Charts & visualizations |
| Motion (Framer) | Animations |
| Firebase | Auth (currently disabled) |
| Gemini AI | AI analysis |

---

## 🚦 Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Server runs on http://localhost:3000
```

---

## 📝 Recent Changes

### v3.3.0 — Live Data Integration & Splash Screen
- ✅ Splash screen replaces Firebase login (auth disabled temporarily)
- ✅ `/api/onchain/metrics` endpoint with live Binance Futures, CoinGecko, Fear&Greed data
- ✅ On-Chain Terminal charts now use real API data with mock fallback
- ✅ Live indicators (🔴 LIVE) shown on charts using real-time data
- ✅ Fear & Greed Index from Alternative.me (no longer simulated)
- ✅ Funding rates from Binance Futures API (BTC, ETH, SOL)
- ✅ Gainers/Losers from Binance 24hr tickers
- ✅ BTC price history from CoinGecko (30 days)
- ✅ Fixed Vite module resolution error (three.js in skills/)

### v3.2.1 — Infrastructure
- Replaced deprecated middleware.ts with proxy.ts
- Fixed CORS for preview panel

### v3.1.0 — 3D Glass Theme
- Enhanced 3D glass theme with depth, refraction, ambient glow
- 5 gradient presets
- 12 fully working component pages

---

## ⚠️ Notes
- Login/Register currently disabled — splash screen auto-bypasses to dashboard
- Logo placeholder uses `/logo.svg` — replace with `logo.png` when provided
- Token Terminal tab uses its own data source
- Some on-chain metrics (CME OI, exchange balances) still use mock data (APIs require authentication)

---

## 📄 License

Private repository — Z-CAPITAL Team
