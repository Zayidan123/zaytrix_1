# ZAYTRIX — Institutional Crypto Platform Architecture

> **Target:** Vanguard / BlackRock-grade crypto intelligence terminal
> **Business Model:** SaaS (Starter / Pro / Enterprise) — Multi-tenant, White-label
> **Market:** Global (Retail Premium → Family Offices → Hedge Funds → Banks)
> **Focus:** 100% Crypto (CEX + DEX + DeFi + On-Chain)

---

## 📊 Current State vs Target State

| Dimension | Current (v5.0) | Target (v6.0 Institutional) |
|---|---|---|
| **Database** | SQLite (single-file) | PostgreSQL (multi-tenant, HA) |
| **Architecture** | Single-tenant | Multi-tenant with data isolation |
| **AI** | Gemini only | 9router (primary) + Gemini (fallback) ✅ |
| **Exchanges** | Binance only (read) | 15+ CEX + 5+ DEX (read + trade) |
| **Assets** | Top 7 + stocks | Top 500 crypto only |
| **Custody** | None | Fireblocks / MPC / HSM |
| **Risk** | Basic | VaR, CVaR, Sharpe, Sortino, stress testing |
| **Compliance** | Audit log only | FATF, OFAC, KYC/AML, immutable audit |
| **Deployment** | Single instance | Hybrid (cloud + on-prem), 99.99% SLA |
| **Scale** | ~100 users | 100,000+ concurrent |
| **White-label** | No | Full white-label (branding, domain, features) |
| **RBAC** | Single user | Org → Users → Roles → Permissions |
| **API** | Internal only | REST + WebSocket for client integration |

---

## 🗺️ Phased Roadmap

### Phase 1: AI Foundation (CURRENT — 9router Integration) ✅
- [x] 9router AI router service (OpenAI-compatible)
- [x] Gemini fallback chain
- [x] AI health monitoring endpoint
- [x] Audit logging for all AI calls
- [ ] Migrate existing Gemini endpoints to use AI router
- [ ] Frontend AI provider status indicator

### Phase 2: Database Migration (PostgreSQL + Multi-tenant)
- [ ] Prisma schema: add `Organization`, `Tenant`, `Subscription` models
- [ ] Migrate SQLite → PostgreSQL
- [ ] Row-level security (tenant isolation)
- [ ] Database connection pooling (PgBouncer)
- [ ] Read replicas for analytics queries
- [ ] Backup + point-in-time recovery

### Phase 3: Multi-exchange Aggregation
- [ ] Exchange connector framework (unified interface)
- [ ] Connectors: Binance, OKX, Bybit, Coinbase, Kraken, Gemini (6 CEX)
- [ ] DEX connectors: Uniswap, Curve, 1inch, Raydium + BNB/ETH/SOL chains
- [ ] Smart Order Routing (SOR) — best price across exchanges
- [ ] Unified order book aggregation
- [ ] TWAP/VWAP execution algorithms

### Phase 4: Institutional Portfolio & Risk
- [ ] Multi-portfolio per organization (strategies, sub-accounts)
- [ ] Performance attribution (Brinson model)
- [ ] Risk metrics: Sharpe, Sortino, Treynor, VaR, CVaR, max drawdown
- [ ] Real-time exposure monitoring
- [ ] Position limits + drawdown limits + auto-liquidation
- [ ] Stress testing (historical scenarios + Monte Carlo)
- [ ] Backtesting engine (walk-forward, multi-strategy)

### Phase 5: On-Chain Analytics (Scraping + Free APIs)
- [ ] Top 500 crypto coverage (CoinGecko free API)
- [ ] Whale tracking (whale-alert, blockchain scraping)
- [ ] Exchange flows (Santiment free + blockchain.info)
- [ ] Miner data (mempool.space + blockchain.info)
- [ ] NFT analytics (OpenSea API + scraping)
- [ ] DeFi: yield farming, liquidity pools, lending, staking
- [ ] Glassnode/Nansen alternative via scraping

### Phase 6: Compliance & Security
- [ ] KYC integration (Onfido / Sumsub / Jumio)
- [ ] AML transaction monitoring (Chainalysis / Elliptic)
- [ ] OFAC sanctions screening
- [ ] FATF travel rule reporting
- [ ] Immutable audit trail (append-only, blockchain-anchored)
- [ ] Tax reporting (per country: Indonesia, US, Singapore, EU)
- [ ] SOC 2 Type II readiness
- [ ] ISO 27001 readiness
- [ ] External penetration testing setup
- [ ] Bug bounty program (HackerOne)

### Phase 7: Custody & Key Management
- [ ] Fireblocks integration (MPC custody)
- [ ] HSM support (AWS CloudHSM / Azure)
- [ ] Non-custodial option (client-held keys)
- [ ] Key rotation policy
- [ ] Transaction signing workflow (2-person rule)

### Phase 8: White-label & Multi-language
- [ ] Tenant-specific branding (logo, colors, name)
- [ ] Custom domain support (CNAME)
- [ ] Feature flags per tenant (enable/disable modules)
- [ ] Multi-language: Indonesia + English (i18n)
- [ ] White-labeled PDF reports
- [ ] Regulatory report generation

### Phase 9: API Platform & Integration
- [ ] REST API for client integration (API keys, OAuth2)
- [ ] WebSocket feeds (real-time market data, portfolio updates)
- [ ] SDK: Python, JavaScript/TypeScript
- [ ] Rate limiting per tenant tier
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Webhook system (events: order filled, alert triggered, etc.)

### Phase 10: Enterprise Operations
- [ ] 24/7 monitoring (PagerDuty, on-call rotation)
- [ ] Dedicated account manager portal
- [ ] SLA tracking + reporting
- [ ] Self-service onboarding (Starter tier)
- [ ] Sales-assisted onboarding (Pro tier)
- [ ] Implementation service (Enterprise tier)
- [ ] Multi-entity legal structure support

---

## 🏗️ Technical Architecture (Target)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
│  Web App (React 19) │ Mobile (PWA) │ REST API │ WebSocket │ SDK     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                      API GATEWAY (Kong/APISIX)                       │
│  Rate limiting │ Auth │ Tenant routing │ API keys │ WebSocket proxy  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                    APPLICATION LAYER (Express)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Auth     │ │ Portfolio│ │ Trade    │ │ Risk     │ │ AI Router│ │
│  │ Service  │ │ Service  │ │ Service  │ │ Engine   │ │ (9router)│ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ On-Chain │ │ Compliance│ │ Custody  │ │ Analytics│ │ Reporting│ │
│  │ Scraper  │ │ Service  │ │ Service  │ │ Engine   │ │ Service  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                       DATA LAYER                                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │ PostgreSQL │  │ Redis      │  │ TimescaleDB│  │ S3/Object  │    │
│  │ (primary)  │  │ (cache/    │  │ (time-     │  │ Storage    │    │
│  │ Multi-tenant│ │ sessions)  │  │ series)    │  │ (reports)  │    │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Schema (Multi-tenant PostgreSQL)

```prisma
// Core multi-tenant models (Phase 2)

model Organization {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique // for subdomain: acme.zaytrix.com
  plan        Plan     @default(STARTER)
  status      OrgStatus @default(ACTIVE)
  createdAt   DateTime @default(now())
  users       User[]
  portfolios  Portfolio[]
  apiKeys     ApiKey[]
  auditLogs   AuditLog[]
  branding    Branding?
}

model User {
  id              String   @id @default(cuid())
  orgId           String
  email           String
  passwordHash    String
  role            UserRole @default(VIEWER)
  displayName     String
  org             Organization @relation(fields: [orgId], references: [id])
  // ... existing fields
  @@unique([orgId, email])
}

model Portfolio {
  id          String   @id @default(cuid())
  orgId       String
  name        String
  type        PortfolioType // SPOT, FUTURES, DEFI, CUSTODY
  custodian   String?  // fireblocks, coinbase_custody, self
  holdings    Holding[]
  org         Organization @relation(fields: [orgId], references: [id])
}

model Holding {
  id          String   @id @default(cuid())
  portfolioId String
  symbol      String
  quantity    Float
  costBasis   Float
  exchange    String?  // binance, okx, self-custody
  portfolio   Portfolio @relation(fields: [portfolioId], references: [id])
}

model Subscription {
  id          String   @id @default(cuid())
  orgId       String
  plan        Plan
  status      SubStatus
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  seats       Int      @default(1)
  // ... billing fields
}

enum Plan { STARTER PRO ENTERPRISE WHITE_LABEL }
enum UserRole { ADMIN TRADER VIEWER COMPLIANCE }
enum PortfolioType { SPOT FUTURES DEFI CUSTODY OTC }
```

---

## 🔐 Security Architecture (Institutional-Grade)

### Custody Options (per tenant choice)
1. **Fireblocks MPC** — institutional custody, multi-party computation
2. **HSM** — AWS CloudHSM / Azure Dedicated HSM
3. **Non-custodial** — client holds keys, ZAYTRIX only reads via API

### Access Control
- **RBAC**: Admin → Trader → Viewer → Compliance (per organization)
- **2-Person Rule**: Sensitive actions require 2 approvers (withdrawals, large trades)
- **IP Whitelist**: Per-organization IP restrictions
- **Session Management**: Server-side sessions with revocation, idle timeout

### Audit & Compliance
- **Immutable Audit Trail**: Append-only log, anchored to blockchain (proof of integrity)
- **SOC 2 Type II**: Security, availability, processing integrity, confidentiality, privacy
- **ISO 27001**: Information security management system
- **Penetration Testing**: Annual third-party testing
- **Bug Bounty**: HackerOne / Immunefi program

---

## 🤖 AI Architecture (9router + Gemini)

```
┌─────────────────────────────────────────────┐
│              AI Router Service               │
│                                              │
│  ┌─────────────┐    ┌─────────────────┐     │
│  │  9router     │    │  Gemini         │     │
│  │  (PRIMARY)   │───▶│  (FALLBACK)     │     │
│  │              │    │                 │     │
│  │  OpenAI-     │    │  @google/genai  │     │
│  │  compatible  │    │  SDK            │     │
│  │              │    │                 │     │
│  │  localhost:  │    │  Cloud API     │     │
│  │  20128/v1    │    │                 │     │
│  └─────────────┘    └─────────────────┘     │
│         │                   │                │
│         ▼                   ▼                │
│  ┌─────────────────────────────────────┐    │
│  │     Health Tracking + Audit Log     │    │
│  │  (provider, model, tokens, latency) │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**AI Use Cases:**
- Trading signals (technical + on-chain analysis)
- Market analysis (real-time + historical)
- Risk assessment (portfolio exposure, VaR)
- Portfolio optimization (asset allocation suggestions)
- News sentiment (per-article + aggregate)
- Chatbot support (natural language queries)
- Custom model training (per-tenant fine-tuning)

---

## 📊 Data Architecture (Live Real-Time)

### Exchange Data (15+ CEX + 5+ DEX)
- **Real-time**: WebSocket streams (Binance, OKX, Bybit, Coinbase, Kraken, Gemini)
- **REST fallback**: Polling with adaptive intervals
- **DEX**: On-chain data via RPC (Etherscan, BSCScan, Solscan, Etherscan)

### On-Chain Analytics (Scraping + Free APIs)
- **Whale tracking**: Whale Alert API (free tier) + blockchain scraping
- **Exchange flows**: Santiment free GraphQL + blockchain.info
- **Miner data**: mempool.space + blockchain.info
- **Active addresses**: Coinmetrics community API
- **ETF flows**: Farside Investors scraping
- **CME OI**: CFTC CoT report scraping
- **NFT**: OpenSea API + scraping

### Time-Series Storage
- **TimescaleDB** (PostgreSQL extension) for market data
- Retention: 10 years historical, 90 days tick-level
- Compression: automatic for old data

---

## 💰 Pricing Tiers (SaaS)

| Feature | Starter ($49/mo) | Pro ($499/mo) | Enterprise ($4,999/mo) | White-Label (Custom) |
|---|---|---|---|---|
| **Seats** | 1 | 5 | 50 | Unlimited |
| **Exchanges** | 3 (read) | 10 (read + trade) | 15+ (read + trade) | All |
| **Assets** | Top 100 | Top 500 | Top 500 + custom | All |
| **AI calls** | 1,000/mo | 50,000/mo | Unlimited | Unlimited |
| **On-chain data** | Basic | Full | Full + API | Full + API |
| **Risk metrics** | Basic | Sharpe/Sortino/VaR | Full + stress test | Full |
| **Custody** | Non-custodial | Non-custodial | Fireblocks + MPC | All options |
| **Compliance** | Audit log | Tax reporting | KYC/AML + FATF | Full |
| **API access** | — | REST | REST + WebSocket | REST + WS + SDK |
| **White-label** | — | — | — | Full (branding, domain) |
| **Support** | Email | Priority | 24/7 + dedicated AM | 24/7 + SLA |

---

## 🚀 Deployment Architecture (Hybrid)

### Cloud (SaaS tiers)
- **Primary**: AWS (us-east-1 + ap-southeast-1 for multi-region)
- **Compute**: ECS Fargate (auto-scaling)
- **Database**: RDS PostgreSQL (multi-AZ, read replicas)
- **Cache**: ElastiCache Redis
- **Storage**: S3 (reports, backups)
- **CDN**: CloudFront (static assets)
- **DNS**: Route53 (health checks, failover)

### On-Premise (Enterprise + White-Label)
- **Kubernetes** deployment (Helm charts)
- **Database**: Self-managed PostgreSQL or cloud RDS
- **Custody**: On-prem HSM or Fireblocks
- **Monitoring**: Self-hosted Grafana + Prometheus + Loki

### SLA Targets
- **Uptime**: 99.99% (Enterprise), 99.9% (Pro), 99% (Starter)
- **API latency**: p95 < 200ms (read), p95 < 500ms (write)
- **WebSocket latency**: < 100ms
- **Recovery time (RTO)**: < 15 minutes
- **Recovery point (RPO)**: < 5 minutes

---

## 📋 Next Immediate Actions (Priority Order)

1. **✅ 9router AI integration** — DONE (this commit)
2. **Migrate existing Gemini endpoints to AI router** — use `callAI()` instead of direct Gemini calls
3. **PostgreSQL setup** — provision database, update DATABASE_URL, run migrations
4. **Multi-tenant schema** — add Organization, Subscription, RBAC models
5. **Exchange connector framework** — unified interface for 15+ CEX
6. **Risk engine** — VaR, CVaR, Sharpe, Sortino calculations
7. **Compliance service** — KYC/AML integration, OFAC screening
8. **White-label system** — tenant branding, custom domains

---

## 📞 Contact

**Repository:** https://github.com/Zayidan123/zaytrix_1.git
**License:** Private — ZAYTRIX Team
