# ZAYTRIX | Institutional Crypto Gateway

<p align="center">
  <strong>ZAYTRIX v5.2.0 — Institutional Crypto Gateway</strong><br>
  Terminal analisis kripto real-time dengan data on-chain live, derivatif, AI analysis, dan keamanan tingkat enterprise.<br>
  <em>Diaudit ulang & diperbaiki menyeluruh oleh GLM 5.3 (75 temuan → perbaikan total)</em>
</p>

---

## 📅 Changelog — 31 Agustus 2026 (v5.2.0)

### 🔍 Audit Menyeluruh oleh GLM 5.3 (75 temuan)
Tiga auditor paralel memeriksa seluruh codebase:
- **26 temuan keamanan** (SEC-1 s/d SEC-26) — 1 KRITIS, 4 HIGH, 10 MED, 11 LOW
- **25 temuan data dummy/fabricated** (DATA-1 s/d DATA-25) — seluruh data palsu yang disajikan seolah-olah real
- **24 temuan fitur tidak berfungsi** (FUNC-1 s/d FUNC-24) — fitur yang hanya tampak bekerja

### 🔒 Perbaikan Keamanan (semua 26 temuan ditangani)

| ID | Masalah | Perbaikan |
|----|---------|-----------|
| **SEC-1** KRITIS | `db/custom.db` berisi **102 email + hash password bcrypt + 103 hash token nyata** ter-commit publik di git | `git rm --cached` + purge tracking + `.gitignore db/`. **WAJIB: rotasi semua password user & token sesi** |
| **SEC-2** HIGH | SSRF penuh di `/api/send-alert` (webhook URL bebas → 169.254.169.254, echo response internal) | Allowlist domain (discord/telegram/slack), tolak IP privat, response upstream tidak di-echo |
| **SEC-3** HIGH | POST `/api/trading-signals/generate-manual` tanpa auth — anonim bisa racuni sinyal semua user | `requireAuth` dipasang |
| **SEC-4** HIGH | Stored XSS: nama aset dari `/api/assets/register` → `document.write` jendela print Projections/TaxReport | `requireAuth` + zod charset ketat di server, `escapeHtml()` di semua interpolasi HTML print |
| **SEC-5** HIGH | JWT curian tetap valid 7 hari setelah logout (bypass pencabutan sesi "grace legacy") | Validasi sesi **fail-closed** — token wajib cocok dengan baris Session di DB; sesi WebAuthn kini tercatat & bisa direvoke |
| SEC-6 | CSRF hanya mode monitoring | Double-submit cookie `zaytrix_csrf` + header `X-CSRF-Token` **di-enforce** (403); wrapper fetch global di frontend |
| SEC-7 | CORS reflect-any-origin + credentials | Allowlist origin eksplisit (APP_URL + localhost dev) |
| SEC-8 | Config notifikasi global lintas-user + token bot tercetak di log | Per-user + redaksi token di log |
| SEC-9 | tempToken 2FA OAuth bocor via URL query | Pindah ke httpOnly cookie 5-menit + flow UI lengkap |
| SEC-10 | Enumerasi email + leak userId di WebAuthn /login/begin | Challenge di-key `loginId` acak; userId tak pernah dikirim |
| SEC-11 | `.env.example` tidak mendokumentasikan variabel wajib | Template lengkap + instruksi generate secret |
| SEC-12 | Caddy edge plain HTTP tanpa TLS | Dokumentasi TLS + contoh konfigurasi domain di Caddyfile |
| SEC-13 | JWT tanpa pin algoritma/iss/aud | `algorithms:["HS256"]`, iss/aud "zaytrix" |
| SEC-14 | `strictBotCheck` dead code | Dipasang pada route high-risk |
| SEC-15 | Order real tanpa batas notional | Guard `MAX_ORDER_NOTIONAL_USD` (default 50.000 USD) + zod semua body |
| SEC-16 | CSP lemah (unsafe-eval, connect-src terbuka) | Tightened + allowlist upstream nyata |
| SEC-17 | Secret TOTP client tersimpan di localStorage | Jalur localStorage dihapus total — secret server satu-satunya sumber |
| SEC-18 | Saldo bursa user tercatat di audit log | Redaksi (boolean saja) |
| SEC-19 | Token reset tercetak ke log di dev-mode | Gate ganda EMAIL_DEV_MODE + NODE_ENV |
| SEC-20 | File runtime ter-track di git | `git rm --cached` |
| SEC-21 | tempToken 2FA bisa di-replay 5 menit | Ditandai consumed setelah dipakai |
| SEC-22 | Dev server terima Host header apa pun | allowedHosts dibatasi di production |
| SEC-23 | `/holdings/sync` bulk tanpa validasi | zod array schema |
| SEC-24 | Redirect SSRF residual di scraper | Re-validasi + redirect manual |
| SEC-25 | Injeksi symbol ke URL upstream | Regex charset ketat |
| SEC-26 | Login backup-code bypass lockout | Cek `lockedUntil` + increment percobaan gagal |

### 🧹 Perbaikan Data Integrity (semua 25 temuan — data palsu DIHAPUS)

**Prinsip baru: aplikasi TIDAK PERNAH memfabricate data. Jika sumber real gagal → error 503 jujur + UI menampilkan "data tidak tersedia", bukan angka acak.**

- **DATA-1/FUNC-16**: 80 koin palsu (rank 21-100, generator `Math.random`) **dihapus** → CoinGecko `/coins/markets` (100 koin real + change7d + sparkline real); semua sumber gagal → `success:false` 503
- **DATA-2/FUNC-17**: random-walk price history **dihapus** → Binance klines → Yahoo → 503 jujur; Backtester/TechnicalTerminal/CorrelationHeatmap menampilkan pesan error, **tidak menjalankan backtest pada data sintetis**
- **DATA-3/FUNC-18**: confidence acak 65-98% & winRate default 75% palsu **dihapus** → confidence dari formula momentum nyata berlabel `source:"heuristic"`; winRate `null` (tampil "N/A") saat belum ada sinyal selesai
- **DATA-9/10**: input fabricated (OI 1.45B, funding 0.015, random addresses 890k) yang disuntik ke prompt Gemini **dihapus** — hanya metrik yang benar-benar berhasil di-fetch; prompt kini jujur "ESTIMASI", bukan klaim "hasil scraping ledger"
- **DATA-11**: `change7d = change24h*1.45+sin()` palsu di semua rankings → nilai real CoinGecko atau `null` (tampil "—")
- **DATA-14**: 20 event likuidasi palsu saat boot **dihapus** — feed mulai kosong sampai WS Binance real mengirim
- **DATA-15/16**: fallback derivatif hardcoded → null + `isStale:true`; flag isStale kini **dikirim ke client** dan dirender badge "STALE"
- **DATA-17/18**: fallback "audit" multi-PDF dengan DER 38.4%/GPM/CertiK palsu **dihapus** → template jujur tanpa angka rekayasa
- **DATA-19**: sentiment berita offline dengan fakta palsu ($2.1B ETF inflow "Millennium") → netral + label fallback
- **DATA-7/FUNC-19**: `onChainMockData.ts` (30+ dataset mock) **FILE DIHAPUS** → skeleton loading + EmptyDatasetNote per panel
- **DATA-8**: jitter harga order simulasi `Math.random` → mid-price orderbook Binance real
- **DATA-12/13**: label exchange palsu dari karakter hash & seed transaksi "berumur palsu" dihapus
- **DATA-20/21/22**: fallback harga offline di App/store/Dashboard → badge "OFFLINE/EST" eksplisit + log boot jujur
- **DATA-23**: korelasi deterministik fallback → badge "ESTIMASI"
- **DATA-24**: kurs USD/IDR hardcoded 15.800 → kurs live open.er-api.com (cache 1 jam); gagal → `null` + "kurs tidak tersedia"

### ⚙️ Perbaikan Fungsional (24 temuan)

- **FUNC-1**: `.env.example` lengkap (DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY, CSRF_SECRET, dll + instruksi `openssl rand`) — fresh clone kini bisa boot mengikuti README
- **FUNC-2**: **build produksi diperbaiki** — esbuild CJS menolak top-level await → format ESM `dist/server.mjs` (terverifikasi: `bun run build` ✅ 486.9kb)
- **FUNC-3**: WebAuthn/Passkey — backend lengkap + kini tanpa leak userId (SEC-10)
- **FUNC-4** KRITIS: **Real trading kini benar-benar tersambung** — UI lama menyimpan kunci di localStorage (server tak pernah membacanya) → alur baru: kunci disimpan ke vault server terenkripsi AES-256-GCM (`/api/user/api-keys`, label "default") → `/api/trade/execute` menandatangani order real dari vault; sandbox tetap simulasi berlabel
- **FUNC-5**: klaim "E2EE client-side" palsu dihapus (kunci dulunya didekripsi browser lalu dikirim plaintext) → copy jujur "enkripsi server-side AES-256-GCM"
- **FUNC-6**: input "Gemini Personal API Key (Override)" dihapus — server memang mengabaikan header itu
- **FUNC-7**: rate limiter 500/15min vs polling app 2s (self-DDoS dalam 13 menit) → limiter polling terpisah 3000/15min + poll diperlambat ke 5s
- **FUNC-8**: alert harga kini tersinkron server (POST/merge — tidak lagi terhapus saat re-login)
- **FUNC-9**: UI login kode cadangan 2FA ditambahkan (endpoint lama dead → hidup)
- **FUNC-11**: tab "OTP Seluler" palsu dihapus
- **FUNC-12**: Google OAuth tanpa config → redirect ramah `/?oauth_error=...` (bukan JSON 503 mentah)
- **FUNC-13/23**: mini-services/ (index.ts tidak pernah ada), .zscripts/ (era Next.js), file Firebase sisa, onchain-cache.json — **semua dihapus dari repo**
- **FUNC-20**: badge "Google Cloud/Metamask — Connected" palsu → panel status integrasi nyata
- **FUNC-21**: teks "Simpan Profil (Firestore)" menyesatkan → jujur "(Lokal di Browser)"
- **FUNC-22**: class Tailwind invalid (slate-850/z-35/w-5.5) dibersihkan

---

## 🚀 Fitur Utama

### 🔒 Keamanan Enterprise
- **Autentikasi** — bcrypt + JWT httpOnly cookie + revocable session table (fail-closed)
- **2FA TOTP** — server-side RFC 6238, lockout per-akun, 8 kode cadangan (UI login lengkap)
- **WebAuthn/Passkey** — challenge terverifikasi, anti-enumerasi loginId, sesi tercatat
- **OAuth Google** — account-linking aman + gerbang 2FA via cookie httpOnly
- **CSRF** — double-submit cookie di-enforce (403) dengan wrapper fetch global
- **WAF + Rate Limiting** — pola ketat, limiter terpisah polling vs mutasi
- **SSRF Guard** — allowlist webhook, blokir IP privat, validasi redirect
- **API Key Vault** — AES-256-GCM server-side + probe autentikasi bursa real + batas notional order
- **Audit Log + GDPR** — aksi sensitif tercatat (balance ter-redaksi), export & delete-all data

### 📡 Data (100% Real atau Jujur Gagal)
- Binance WS (likuidasi + ticker), Binance Futures (funding/OI/LSR), CoinGecko (rankings+7d+sparkline), Coinpaprika, Alternative.me (Fear&Greed), Mempool.space, Blockchain.info, Coinmetrics, Santiment, CFTC, Yahoo Finance (IDX), RSS news, open.er-api (kurs USD/IDR live)
- **Badge transparansi**: `isStale` / `EST` / `OFFLINE` / `isSimulation` / `isFallback` tampil di UI kapan pun data tidak 100% live

### 🖥️ On-Chain Terminal (9 tab) · 📊 Trading & Portfolio (Backtester, DCA, Tax PMK-68, Risk VaR/CVaR, Rebalancing, Correlation) · 🤖 AI (Gemini + 9router fallback) · 🔔 Price Alerts + Telegram/Discord/WhatsApp

---

## 📋 Status & Catatan Jujur

| Aspek | Status |
|-------|--------|
| Type errors | **0** (`bun run lint` bersih) |
| Build produksi | ✅ `bun run build` → `dist/server.mjs` (ESM) |
| Boot server | ✅ semua router mount, WS Binance connect, live sync |
| Data fabrication | **0 tersisa** — semua sumber gagal → 503 + UI jujur |
| AI (Gemini/9router) | Aktif jika `GEMINI_API_KEY`/`NINEROUTER_API_KEY` diisi; tanpa kunci → fallback berlabel, tanpa klaim palsu |
| Email verifikasi/reset | Butuh SMTP; tanpa SMTP di dev → `EMAIL_DEV_MODE=true` mencetak token ke log server |
| Google OAuth | Butuh `GOOGLE_CLIENT_ID/SECRET`; tanpa itu tombol menampilkan pesan ramah |
| Test suite | Integrasi — butuh server live di :3000 (`bun run dev` di terminal lain, lalu `bun run test`) |

### ⚠️ Tindakan Pasca-Insiden yang WAJIB Anda lakukan (SEC-1)
Database lama (`db/custom.db`) pernah ter-commit publik berisi email, hash bcrypt, dan hash token user:
1. **Rotasi password semua user** yang terdaftar di DB lama.
2. **Hapus semua sesi** (tabel Session) — token lama berpotensi bocor.
3. Rotasi `SESSION_SECRET`, `ENCRYPTION_KEY`, `CSRF_SECRET` di `.env` (generate baru: `openssl rand -hex 48/32/32`).
4. Pertimbangkan purge riwayat git (`git filter-repo --path db/custom.db --invert-paths`) karena blob lama masih ada di history — lalu force-push.

---

## 🔧 Tech Stack
- **Framework**: Vite + React 19 + Express (server.ts)
- **Language**: TypeScript 5 (strict typecheck bersih)
- **Styling**: Tailwind CSS 4
- **Database**: Prisma ORM + SQLite (`db/custom.db`, tidak di-track)
- **State**: Zustand + TanStack Query
- **Auth**: JWT httpOnly + bcrypt + 2FA TOTP + WebAuthn + OAuth (CSRF enforced)
- **AI**: Gemini 2.5-flash + 9router (OpenAI-compatible fallback)
- **Real-time**: Binance WebSocket
- **DevOps**: Graceful shutdown, 30s timeout, upstream health checker, Sentry (PII scrubbed)

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Salin environment & isi secret
cp .env.example .env
#    WAJIB isi: DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY, CSRF_SECRET
#    Generate secret: openssl rand -hex 48   (SESSION_SECRET)
#                     openssl rand -hex 32   (ENCRYPTION_KEY / CSRF_SECRET)

# 3. Generate Prisma client & buat DB
bun run db:generate
bun run db:push

# 4. Jalankan dev server (port 3000)
bun run dev

# 5. (Opsional) Build produksi
bun run build && bun run start
```

---

## 📁 Struktur Project

```
zaytrix_1/
├── server.ts                    # Express monolith (auth, data, AI, WS)
├── prisma/schema.prisma         # 11 model + shadow Decimal/DateTime
├── src/
│   ├── main.tsx                 # Entry + CSRF-aware fetch wrapper
│   ├── App.tsx                  # Routing + auth + alert sync server
│   ├── store.ts                 # Zustand (boot log jujur)
│   ├── components/              # 29 komponen (mock data dihapus)
│   ├── server/                  # 19 modul backend (security, auth, vault, trade, dst.)
│   ├── lib/portfolioSync.ts     # Sinkronisasi portofolio + alert (merge)
│   └── utils/pdfGenerator.ts    # PDF report (DOMPurify)
├── Caddyfile                    # Reverse proxy + dokumentasi TLS
└── .env.example                 # Template env LENGKAP
```

---

## 📊 Status: v5.2.0 (31 Aug 2026)

| Metric | Value |
|--------|-------|
| Temuan audit (GLM 5.3) | 75 (26 SEC + 25 DATA + 24 FUNC) |
| Temuan ditangani | 75 / 75 |
| Data fabrication tersisa | 0 |
| Type errors | 0 |
| Build produksi | ✅ (ESM, 486.9kb server) |
| Commits | audit + fix batch ini |

---

<p align="center">
  <strong>ZAYTRIX</strong> — Dibangun dengan ❤️ untuk komunitas kripto Indonesia<br>
  <em>Institutional-grade tools for everyone — kini dengan integritas data 100%</em>
</p>
