# Z-CAPITAL | Advanced Crypto Intelligence Dashboard

<p align="center">
  <img src="https://img.shields.io/badge/version-3.2.0-amber?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-cyan?style=for-the-badge&logo=tailwindcss" alt="Tailwind CSS" />
</p>

## Overview

Z-CAPITAL is a comprehensive, feature-rich cryptocurrency dashboard built with cutting-edge web technologies. It features a stunning **3D glass morphism** design system, **5 gradient color themes**, and **smooth Framer Motion animations** throughout.

## ✨ Features

### 12 Fully Functional Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Portfolio overview, 4 stat cards, market overview with sparklines, quick actions |
| **Coin List** | Searchable table of 10 cryptocurrencies with live price data |
| **Price Chart** | SVG line chart with amber→rose gradient, time range selector, coin switcher |
| **Portfolio** | SVG donut chart, holdings table, PnL tracking, quick trade panel |
| **AI Signals** | 5 real-time signal cards with RSI/MACD/Confidence, 60s auto-refresh |
| **Doc Compare** | Jaccard similarity, word frequency analysis, comparison matrix |
| **Projections** | DCA calculator with 3 scenarios, SVG area chart, tax estimates |
| **Backtester** | 4 strategies, mock backtest engine, equity curve, trade log |
| **Automation** | Trade rule CRUD, real-time price monitoring, alert history |
| **Ledger & Tax** | 18 demo transactions, FIFO PnL, monthly chart, CSV export |
| **Security** | SVG gauge score, 2FA setup, login activity, sessions, audit log |
| **Settings** | Profile editor, 5 gradient themes, notifications, API keys |

### Design System

- **3D Glass Morphism**: Multi-layered glass cards with depth, refraction highlights, and ambient glow
- **5 Gradient Presets**: Sunset Fire, Ocean Aurora, Golden Hour, Forest Dew, Blaze Rose
- **Smooth Animations**: Framer Motion page transitions, staggered children, glass-shine effects
- **High Contrast Text**: White (#f5f5f7) foreground on dark (#06070a) background
- **Responsive Design**: Mobile-first with collapsible sidebar, mobile menu overlay

### Real-time Data

- **Socket.IO** price feed on port 3005 (Binance WebSocket + CoinGecko fallback)
- **Demo mode** with simulated price fluctuations when live feed is unavailable
- **Auto-refresh** AI signals every 60 seconds

## 🛠 Tech Stack

| Technology | Purpose |
|------------|---------|
| **Next.js 16** | Framework with App Router + Turbopack |
| **TypeScript 5** | Type safety |
| **Tailwind CSS 4** | Utility-first styling |
| **shadcn/ui** | Component library (New York style) |
| **Framer Motion** | Page transitions and animations |
| **Zustand** | Client state management |
| **Socket.IO** | Real-time price data |
| **Recharts** | Data visualization |
| **Lucide** | Icon library |

## 🚀 Getting Started

```bash
# Install dependencies
bun install

# Start main app (port 3000)
bun run dev

# Start price feed service (port 3005)
cd mini-services/price-feed && bun run dev
```

## 📁 Project Structure

```
src/
├── app/
│   ├── globals.css          # 3D glass theme, gradients, animations
│   ├── layout.tsx           # Root layout with fonts + toaster
│   ├── middleware.ts         # CSP + security headers (no sandbox)
│   └── page.tsx             # Main router with 12 tab navigation
├── components/
│   ├── ui/                  # shadcn/ui components
│   ├── Dashboard.tsx        # Portfolio overview + market data
│   ├── CoinList.tsx         # Searchable crypto table
│   ├── PriceChart.tsx       # SVG line chart with gradients
│   ├── CryptoHub.tsx        # Portfolio management + trading
│   ├── AITradeSignals.tsx   # AI-powered trade signals
│   ├── AIDocCompare.tsx     # Document similarity analysis
│   ├── ProfitProjections.tsx# DCA profit calculator
│   ├── StrategyBacktester.tsx# Strategy backtesting engine
│   ├── TradeAutomation.tsx  # Automated trade rules
│   ├── LedgerTax.tsx        # Transaction ledger + tax
│   ├── Security2FA.tsx      # Security settings + 2FA
│   └── SettingsHub.tsx      # App configuration
├── lib/
│   ├── store.ts             # Zustand state (assets, holdings, theme)
│   ├── types.ts             # TypeScript interfaces
│   └── helpers.ts           # Formatting + financial calculations
mini-services/
└── price-feed/              # Socket.IO price service
```

## 🎨 Theme System

### CSS Custom Properties
- `--glass-bg`, `--glass-border`, `--glass-shadow` — Glass card appearance
- `--gradient-1` through `--gradient-5` — Gradient presets
- `--glow-amber`, `--glow-emerald`, `--glow-cyan`, `--glow-rose` — Glow effects
- `--ease-out-expo` — Smooth cubic-bezier transition

### CSS Classes
- `.glass-card` — Standard glass card with top reflection
- `.glass-card-3d` — Enhanced 3D glass with depth + refraction
- `.gradient-text-1` to `.gradient-text-5` — Gradient text
- `.gradient-bg-1` to `.gradient-bg-5` — Gradient backgrounds
- `.animate-fade-in-up`, `.animate-scale-in`, `.animate-float` — Entry animations
- `.stagger-children` — Staggered child animation
- `.animate-glass-shine` — Glass shine sweep effect
- `.animate-pulse-glow` — Pulsing glow animation

## 📝 Version History

### v3.2.0 — Security Headers + Stability
- Added middleware.ts with CSP, HSTS, X-Frame-Options, X-Content-Type-Options (no sandbox)
- Configured `allowedDevOrigins` in next.config.ts for cross-origin preview support
- Removed `output: "standalone"` from next.config.ts (dev mode compatibility)
- Verified font visibility: #f5f5f7 on #06070a (18:1 contrast ratio)
- All components consistently use `text-foreground` / `text-muted-foreground`

### v3.1.0 — Enhanced 3D Glass Theme
- Complete rewrite of all 12 components (fixed JSX corruption)
- Enhanced 3D glass system with multi-layer shadows, refraction highlights
- 5 new gradient presets (Sunset Fire, Ocean Aurora, Golden Hour, Forest Dew, Blaze Rose)
- Improved font visibility (white #f5f5f7 on dark #06070a)
- 10+ new animation keyframes (breathe, rotate-slow, wave, etc.)
- Custom scrollbar styling, better hover states
- Removed sandbox (middleware.ts) — no CSP restrictions
- New LedgerTax component with CSV export
- Socket.IO client installed for real-time data
- Framer Motion ease type fix for page transitions

### v3.0.0 — Full Rebuild
- 3D glass theme foundation
- 12 pages with glass morphism
- Zustand state management
- Socket.IO price feed service

## License

MIT