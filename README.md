# ZAYTRIX | Institutional Crypto Gateway

<p align="center">
  <strong>ZAYTRIX v5.1.0 — Institutional Crypto Gateway</strong><br>
  Terminal analisis kripto real-time dengan data on-chain live, derivatif, AI analysis, dan keamanan tingkat enterprise.
</p>

---

## 📅 Changelog — 27 Agustus 2026

### Hari Ini (27 Aug 2026) — Audit + Bug Fix + Optimasi + 9 Fitur Baru

#### 🔍 Fase 1: Audit Menyeluruh (120 temuan)
- Clone + analisa codebase oleh 4 subagent paralel (security, business-logic, frontend, data-config)
- Ditemukan 15 bug KRITIS, 34 HIGH, 40 MED, 32 LOW

#### 🐛 Fase 2: Bug Fix (45 bug diperbaiki)
- **P0 (8 KRITIS)**: geminiCacheSet recursion, Gemini model name, requireAuth on all /api/gemini/*, window.confirm override removal, DOMPurify XSS fix, SSRF in scrapeWebsiteContent + Caddyfile, idempotency keys on real orders
- **P1 (4 security)**: Token hashing (sha256), fabricated on-chain data removal, WebAuthn challenge verification, OAuth account-linking takeover + 2FA lockout
- **P2 (1 security)**: Secret rotation (strong random 48/32-byte) + .env untracked from git
- **FIX-A/B/C/D (32 bugs)**: Body limit, auth on send-alert/notifications, zod validation, rate limiter, cache sweep, URL validation, Bearer redaction, fake balance, email enumeration, login timing, EMAIL_DEV_MODE default, WebAuthn user leak, TOTP backup code entropy, WAF false positives, tsconfig paths, dead code deletion (next.config.ts, examples/, use-toast.ts), package.json metadata, index.html lang+meta, QueryClient staleTime, duplicate scan code, sequential→parallel fetches, window.onerror fix, skills/ untracked
- **Type fixes**: SplashScreen motion v12 ease typing, portfolioSync field name mapping

#### ⚡ Fase 3: Optimasi (22 area dioptimasi)
- **OPT-1 (Config + Polish)**: metadata.json, tailwind v4 migration, components.json, graceful shutdown, request timeout 30s, Sentry PII scrubbing
- **OPT-2 (Frontend)**: AbortController hook, per-section ErrorBoundary, WebSocket exponential backoff
- **OPT-3 (Backend)**: Rate limiter keyGenerator, httpAgent keepAlive module, upstream health checker, CI/CD pipeline, `any` type reduction
- **OPT-4 (Schema)**: Prisma migrations folder, 14 shadow Decimal columns, 5 shadow DateTime columns (all backward compatible)
- **OPT-5 (Security)**: isStale flag on onchain data, CSRF monitoring mode, backup codes verification endpoint
- **OPT-7 (Bundle)**: Firebase removal (55MB bundle reduction, 145 deps removed, dual-auth conflicts eliminated)

#### ✨ Fase 4: 9 Fitur Baru
1. **Market Sentiment Widget** — Fear & Greed gauge + Market Cap + 24h trend (SVG gauge, live data)
2. **Price Alert System** — Background checker (30s poll), toast notifications, per-symbol alerts with above/below conditions
3. **Portfolio Risk Score** — VaR 95%/99%, CVaR (Expected Shortfall), HHI concentration, Sharpe proxy, risk grade A-E
4. **Portfolio Rebalancing Advisor** — 4 risk profiles, BUY/SELL/REDUCE/HOLD actions, drift score, per-asset suggestions
5. **AI Market Sentiment Chat** — Gemini/9router-powered Q&A with live market context grounding
6. **Tax Lot Optimizer** — FIFO/LIFO/HIFO lot selection, per-lot P&L + holding period, PMK-68 tax estimation
7. **Tax Report Generator** — Annual P&L with FIFO matching, PDF export, per-symbol breakdown
8. **Multi-asset Correlation Matrix** — Pearson correlation heatmap, diversification score, symbol picker
9. **DCA Calculator** — Historical DCA simulation vs lump-sum comparison, per-purchase breakdown

---

## 🚀 Fitur Utama

### 🔒 Keamanan Enterprise
- **Autentikasi Real** — Register/Login dengan bcrypt + JWT httpOnly cookie (7 hari)
- **2FA TOTP** — Server-side RFC 6238 (HMAC-SHA1), per-account lockout (5 fails → 15 min)
- **WebAuthn/Passkey** — Challenge verification + origin check + counter clone-detection
- **Email Verification** — Token di-hash (sha256) sebelum disimpan, tidak bisa di-replay
- **Password Reset** — Token di-hash, 1 jam expiry, existing sessions di-revoke
- **Google OAuth** — Account-linking dengan email_verified check, 2FA gate
- **Session Lockout** — 5 gagal login → 15 menit lock (password + 2FA)
- **Password Breach Check** — HaveIBeenPwned k-anonymity
- **API Key Encryption** — AES-256-GCM + idempotency keys (Binance newClientOrderId, Bybit orderLinkId)
- **CSRF Protection** — Double-submit cookie + monitoring mode
- **WAF** — SQL injection, XSS, path traversal, bot detection (tightened patterns)
- **Rate Limiting** — 120/min live data, 5/min auth, 100kb body limit (15mb PDF routes)
- **Audit Logging** — Semua aksi sensitif tercatat
- **GDPR** — Data export + delete-all + backup codes recovery endpoint

### 📡 Data Sources (Live + Fallback)
- **Binance WebSocket** — Liquidation feed + ticker prices (BTC/ETH/BNB/XRP/SOL/TRX/HYPE)
- **Binance Futures API** — Funding rates, Open Interest, Long/Short ratio
- **CoinGecko API** — Market cap, BTC dominance, price history, ATH
- **Alternative.me** — Fear & Greed Index real-time
- **Mempool.space** — Bitcoin hashrate, difficulty, block data
- **Blockchain.info** — BTC price, tx volume, market cap
- **Coinmetrics** — Active addresses, MVRV, realized cap
- **Santiment** — Exchange netflow (REAL, free GraphQL)
- **CFTC** — CME Open Interest (CoT report, weekly)
- **Farside Investors** — ETF flows (IBIT, FBTC, ARKB, GBTC)
- **Yahoo Finance** — Data saham Indonesia (IDX) + ETF fundamentals
- **RSS Feeds** — CoinDesk, Cointelegraph, CryptoSlate (news)
- **Open ER API** — USD→IDR exchange rate
- **isStale flag** — Indikator ketika fallback values digunakan (transparansi data)

### 🖥️ On-Chain Terminal (9 Tab)
1. **Derivatif & OI** — Open Interest, Funding Rates, CME OI, Altcoin OI
2. **Likuidasi** — Liquidation heatmap, real-time feed, top historical
3. **Volume & Heatmap** — 24h gainers/losers, spot vs futures volume
4. **Settlement Funding** — Cumulative fees, funding rate heatmap
5. **Orderbook Depth** — Bid/ask pressure, liquidity delta
6. **Arus On-Chain** — BTC spot flows, exchange netflow, addresses, miner data
7. **Valuasi & Makro** — Stock-to-Flow, MVRV, NVT, dominance, ETF, correlations
8. **Token Terminal** — Top coins dengan live market data
9. **Analisis AI** — Gemini-powered on-chain analysis

### 📊 Trading & Portfolio (9 Fitur Baru)
- **Crypto Hub** — Manajemen portofolio multi-aset (server-side persistence)
- **Market Sentiment Widget** — Fear & Greed gauge + global market stats
- **Price Alert System** — Notifikasi otomatis saat harga menyentuh target
- **Portfolio Risk Score** — VaR/CVaR + concentration metrics + risk grade
- **Rebalancing Advisor** — Saran alokasi berbasis profil risiko (4 profiles)
- **AI Market Chat** — Q&A tentang pasar dengan grounding data live
- **Tax Lot Optimizer** — FIFO/LIFO/HIFO dengan per-lot P&L breakdown
- **Tax Report Generator** — Laporan pajak tahunan + PDF export
- **Correlation Matrix** — Heatmap korelasi Pearson antar aset
- **DCA Calculator** — Simulasi strategi DCA vs lump-sum
- **AI Trade Signals** — Sinyal trading berbasis AI + live market data
- **Strategy Backtester** — Backtesting dengan real historical price data
- **Technical Terminal** — Analisis teknikal (SMA, RSI, MACD, Bollinger)
- **Ledger History & Tax** — Pencatatan transaksi dengan FIFO PnL + PMK-68 (0.1%)
- **Real Exchange Execution** — Order REAL ke Binance/Bybit/KuCoin (HMAC signed)

### 🤖 AI Analysis
- **Gemini AI** — On-chain analysis, trading signals, multi-document comparison
- **9router** — OpenAI-compatible local AI proxy (primary, fallback to Gemini)
- **News Sentiment** — AI sentiment analysis per article
- **Automated Analysis** — Background periodic AI market analysis

### 🔧 DevOps & Monitoring
- **Graceful Shutdown** — SIGTERM/SIGINT → drain requests → DB disconnect
- **Request Timeout** — 30s socket timeout
- **Sentry SDK** — Error tracking + PII scrubbing (beforeSend)
- **Upstream Health Checker** — Binance + CoinGecko availability monitoring (60s)
- **Alerting** — 4 alert rules (error rate, latency, brute force, rate limit)
- **Health Endpoint** — `/api/health` dengan uptime, latency p50/p95
- **HTTP Agent** — keepAlive connection pooling module
- **CI/CD Ready** — GitHub Actions lint+typecheck (needs token workflow scope)

---

## 📋 Roadmap — Rencana Pengembangan

### 🔴 Prioritas Tinggi (Data Integrity)
1. **Hapus 80 fake coins (ranks 21-100)** — `generateRandomCoin()` di server.ts menghasilkan koin palsu dengan Math.random. Harus diganti dengan CoinGecko/CoinMarketCap pagination real data.
2. **Hapus random walk price history** — `server.ts:855-875` menggunakan Math.random untuk generate price history. Harus pakai Binance klines API real historical data.
3. **Hapus fabricated signal confidence** — `server.ts:2455-2475` menggunakan Math.random(65-98%) untuk confidence score. Harus pakai AI analysis atau indikator teknikal real.
4. **Hapus stock price fluctuation simulation** — `server.ts:560-580` menggunakan Math.random saat Yahoo Finance gagal. Harus return stale flag + last known price.
5. **Hapus hardcoded fallback prices** — `server.ts:208-404` initialAssets dengan harga statis. Harus fetch real prices on boot.
6. **Hapus fallback global stats** — `server.ts:1096-1102` ($1.81T market cap). Harus return error jika upstream unavailable, bukan nilai palsu.
7. **Hapus onChainMockData.ts** — File mock data untuk on-chain transactions. OnChainData.tsx:287 masih pakai `getOnChainMockData()` sebagai initial state.
8. **Ganti simulateOrder Math.random** — `tradeExecution.ts:211` menggunakan Math.random untuk price jitter. Harus pakai real fill price dari exchange.

### 🟡 Prioritas Sedang (Non-Functioning Features)
9. **Phone OTP Authentication** — UI tab "OTP Seluler" ada tapi disabled (no reCAPTCHA, no phone OTP server). Implement atau hapus tab.
10. **Google OAuth** — Code ada tapi `GOOGLE_CLIENT_ID` tidak diset di .env. User perlu config di Google Cloud Console.
11. **Email Verification/Reset** — `EMAIL_DEV_MODE` default false (fail-closed). User perlu set SMTP_HOST/USER/PASS atau email tidak terkirim.
12. **9router AI** — `NINEROUTER_API_KEY` kosong di .env. Install 9router (https://github.com/decolua/9router) + set API key.
13. **Gemini AI** — `GEMINI_API_KEY` kosong di .env. Semua AI endpoints return fallback text. Set key dari Google AI Studio.
14. **Real Exchange Trade Execution** — Bisa place real orders tapi user perlu store API keys di Settings → Api Automation.
15. **ETF Flows (Farside)** — Cloudflare blocks scraping. Perlu alternative data source atau API resmi.
16. **Active Addresses** — Free API sources (Coinmetrics/blockchain.info) unreliable. Perlu premium API.
17. **Backup Codes UI** — Endpoint `/api/auth/2fa/backup-login` sudah ada tapi tidak ada UI di AuthScreen untuk input backup code.

### 🟢 Prioritas Rendah (Optimasi Lanjutan)
18. **server.ts refactor** — 5526 baris monolith → route modules. Butuh dedicated sprint dengan integration testing.
19. **console.log → structured logger** — 142 instance console.log di production code. Ganti ke pino/winston dengan level filtering.
20. **`any` type reduction** — 130+ `any` di server.ts. Ganti dengan proper TypeScript interfaces.
21. **Connection pooling global** — `httpAgent.ts` module sudah dibuat tapi belum di-wire globally ke semua fetch calls.
22. **Shadow Decimal columns migration** — 14 shadow Decimal + 5 DateTime columns sudah ada (OPT-4), perlu dual-write + backfill + reader migration.
23. **CSRF enforcement** — Saat ini monitoring mode (log-only). Perlu frontend migration untuk send csrf token, lalu flip to 403.

### ✨ Rekomendasi Fitur Baru
24. **Whale Transaction Tracker** — Real-time whale alert dengan notifikasi push (sumber: Whale Alert API atau blockchain mempool monitoring)
25. **Portfolio Performance Attribution** — Analisis aset mana yang paling berkontribusi ke gain/loss portofolio
26. **DeFi Yield Tracker** — Monitoring APY/APR dari protocol DeFi (Aave, Compound, Uniswap) untuk optimasi yield farming
27. **Social Sentiment Tracker** — Analisis sentiment dari Twitter/Reddit/Discord tentang koin tertentu
28. **Gas Fee Optimizer** — Rekomendasi waktu transaksi Ethereum berdasarkan gas price history
29. **Multi-wallet Import** — Import balance dari wallet address (MetaMask, Ledger) tanpa perlu API key exchange
30. **Automated Rebalancing** — Eksekusi otomatis saran rebalancing berdasarkan threshold drift (connect ke exchange API)
31. **Options Strategy Builder** — Visualisasi payoff diagram untuk strategi options (straddle, strangle, iron condor)
32. **On-chain Whale Clustering** — Clustering wallet addresses berdasarkan transaction pattern (machine learning)
33. **Tax-loss Harvesting Scanner** — Otomatis identifikasi posisi yang bisa di-harvest untuk tax loss
34. **Cross-exchange Arbitrage Scanner** — Deteksi selisih harga antar bursa untuk opportunity arbitrage
35. **Portfolio Stress Test** — Simulasi portofolio terhadap skenario market crash (2008, 2020, COVID)

---

## 📁 Struktur Project

```
zaytrix_1/
├── server.ts                          # Express + Vite dev server (port 3000)
├── onchainDataHelper.ts               # Live on-chain data processor
├── onchainScanner.ts                  # Multi-chain scanner
├── prisma/
│   ├── schema.prisma                  # Database schema (11 models, shadow Decimal/DateTime)
│   └── migrations/                    # Prisma migrations (baseline + shadow columns)
├── src/
│   ├── main.tsx                       # React entry point
│   ├── App.tsx                        # Main app with routing + real auth
│   ├── store.ts                       # Zustand global state
│   ├── types.ts                       # TypeScript interfaces
│   ├── components/                    # 29 UI components
│   │   ├── AuthScreen.tsx             # Multi-auth login (email, register, OTP, Google)
│   │   ├── Dashboard.tsx              # Main dashboard with 9 widgets
│   │   ├── MarketSentimentWidget.tsx  # Fear & Greed gauge + market stats
│   │   ├── PriceAlertsWidget.tsx      # Price alert manager + toast notifications
│   │   ├── RiskScoreWidget.tsx        # VaR/CVaR + risk grade gauge
│   │   ├── RebalanceWidget.tsx        # Portfolio rebalancing advisor
│   │   ├── MarketSentimentChat.tsx    # AI Q&A with live market context
│   │   ├── TaxLotOptimizer.tsx        # FIFO/LIFO/HIFO lot calculator
│   │   ├── TaxReportWidget.tsx        # Annual tax report + PDF export
│   │   ├── CorrelationMatrixWidget.tsx # Pearson correlation heatmap
│   │   ├── DCACalculator.tsx          # DCA vs lump-sum simulator
│   │   └── ...
│   ├── server/                        # Backend modules
│   │   ├── auth.ts                    # Auth (register, login, 2FA, email verify, reset, sessions)
│   │   ├── security.ts                # Helmet, CORS, rate limit, CSRF
│   │   ├── apiKeys.ts                 # API key CRUD + AES-256-GCM encryption
│   │   ├── audit.ts                   # Audit logging
│   │   ├── portfolio.ts               # Portfolio/ledger/backtest/alert/risk/tax endpoints
│   │   ├── tradeExecution.ts          # Real exchange order execution
│   │   ├── liveDataRoutes.ts          # 12 live data endpoints + rate limiter
│   │   ├── webauthn.ts                # WebAuthn/Passkey (challenge verified)
│   │   ├── totp.ts                    # TOTP RFC 6238 (128-bit backup codes)
│   │   ├── oauth.ts                   # Google OAuth (email_verified + 2FA gate)
│   │   ├── waf.ts                     # WAF + bot detection
│   │   ├── aiRouter.ts                # 9router + Gemini fallback
│   │   ├── upstreamHealth.ts           # Binance/CoinGecko health checker
│   │   ├── httpAgent.ts               # keepAlive connection pooling
│   │   └── ...
│   ├── hooks/
│   │   └── use-abortable-fetch.ts     # AbortController hook for polling
│   └── utils/
│       └── pdfGenerator.ts            # PDF report generator (DOMPurify sanitized)
├── Caddyfile                          # Reverse proxy (port allowlist)
└── package.json                       # zaytrix v5.1.0
```

---

## 🔧 Tech Stack
- **Framework**: Vite + React 19 + Express (custom server.ts)
- **Language**: TypeScript 5 (zero type errors)
- **Styling**: Tailwind CSS 4 (CSS-first, no JS config)
- **Database**: Prisma ORM + SQLite (migrations + shadow Decimal/DateTime columns)
- **State**: Zustand + TanStack Query (30s staleTime)
- **Auth**: JWT httpOnly cookie + bcrypt + 2FA TOTP + WebAuthn + OAuth
- **AI**: Gemini 2.5-flash + 9router (OpenAI-compatible fallback)
- **Real-time**: Binance WebSocket (liquidation feed + tickers)
- **Monitoring**: Sentry (PII scrubbed) + upstream health checker
- **DevOps**: Graceful shutdown + 30s timeout + CI-ready (GitHub Actions)

---

## 🚀 Quick Start

```bash
# Install dependencies
bun install

# Generate Prisma client
bun run db:generate

# Push schema to database
bun run db:push

# Start dev server (port 3000)
bun run dev

# Type check
bun run lint
```

### Environment Variables (.env — NOT tracked in git)
```
DATABASE_URL=file:./db/custom.db
SESSION_SECRET=<48-byte hex random>
ENCRYPTION_KEY=<32-byte hex random>
CSRF_SECRET=<32-byte hex random>
GEMINI_API_KEY=<from Google AI Studio>
GEMINI_MODEL=gemini-2.5-flash
NINEROUTER_ENDPOINT=http://localhost:20128/v1/chat/completions
NINEROUTER_API_KEY=<from 9router dashboard>
NINEROUTER_MODEL=kr/claude-sonnet-4.5
# Optional: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
# Optional: SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_DEV_MODE=true
```

---

## 📊 Status: v5.1.0 (27 Aug 2026)

| Metric | Value |
|--------|-------|
| Bug diperbaiki | 45 (dari 120 temuan audit) |
| Optimasi dilakukan | 22 area |
| Fitur baru ditambahkan | 9 |
| Type errors | 0 |
| Firebase bundle reduction | 55MB |
| Dependencies removed | 145 (Firebase transitive) |
| Commits pushed | 15 |

---

<p align="center">
  <strong>ZAYTRIX</strong> — Built with ❤️ for the Indonesian crypto community<br>
  <em>Institutional-grade tools for everyone</em>
</p>
