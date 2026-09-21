# ZAYTRIX PERBAIKAN MENYELURUH — TRACKING PLAN

## Status: IN PROGRESS (Wave 1: 5 Agent Paralel Berjalan)

### Wave 1 (Sekarang)
- [x] Backend Integration Agent — curl fallback + hardcoded data fix
- [x] Frontend Fix Agent — 5 critical data honesty issues
- [x] Firebase Auth + DB Security Agent
- [x] QA Agent — lint, build, test, endpoint verification
- [x] Browser Compat + Server Agent — PWA, HTTPS, cross-browser

### Wave 2 (Setelah Wave 1 Selesai)
- [ ] Re-verify all Wave 1 fixes
- [ ] Run integration tests
- [ ] Security re-audit
- [ ] Final build + deploy
- [ ] Server production restart

### Checklist Perbaikan (Dari Semua Audit)

#### Backend
- [ ] Integrate fetchWithTimeout(curl fallback) ke onchainStore.ts
- [ ] Integrate fetchWithTimeout ke liveDataRoutes.ts
- [ ] Integrate fetchWithTimeout ke assetsStore.ts
- [ ] Fix assetsStore.ts initialAssets labels (WARMUP/SIMULATED)
- [ ] Circuit breaker untuk Binance fetches
- [ ] Honest error messages (success:false, bukan 500)

#### Frontend
- [ ] MarketSentimentWidget: fgValue default null + LIVE badge guard
- [ ] OnChainData: livePriceEth default null + render guard
- [ ] OnChainData: fearGreedVal default null + fearGreedLoaded used
- [ ] TechnicalTerminal: RSI null when no history + "estimasi" label
- [ ] AssetsHub: dividendYield null + "N/A" when no data
- [ ] Dashboard: change24h EST badge + FX stale label + hide synthetic sparklines
- [ ] OnChainData: OI fallback price "estimasi" label

#### Auth & Security
- [ ] Firebase Auth (email, Google, GitHub)
- [ ] Firestore User sync
- [ ] Prisma row-level validation
- [ ] .env.example Firebase placeholders

#### Browser & Deployment
- [ ] Caddyfile reverse proxy
- [ ] PWA manifest valid
- [ ] Service worker registration
- [ ] CSP browser-compatible
- [ ] No browser-specific APIs
- [ ] Server on 0.0.0.0
- [ ] HTTPS setup

### Evidence Required
- npm run lint → exit 0
- npm run build → exit 0
- npm run test → check results
- All endpoints tested with curl
- Server accessible from all browsers
- Auth works (email/Google/GitHub)
