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

### 🧪 Ronde QA Runtime #2 (31 Ag — bug nyata ditemukan via browser automation)

Audit statis menemukan 75 temuan; QA runtime dengan browser automation menemukan bug yang hanya muncul saat aplikasi benar-benar dijalankan:

- **QA2-1 KRITIS**: `dotenv.config()` dipanggil di body `server.ts` SETELAH import — padahal ESM mengevaluasi semua import lebih dulu, sehingga modul yang memvalidasi env saat module-load (mis. `dataRetention.ts` → ENCRYPTION_KEY) selalu crash sebelum `.env` termuat. **Quick start resmi (`cp .env.example .env` → `bun run dev`) tidak akan pernah berhasil tanpa fix ini.** → `import "dotenv/config"` dipindah ke baris pertama; build produksi dist juga diverifikasi tetap benar urutannya.
- **QA2-2**: Atribusi portofolio mencampur mata uang — harga saham `.JK` (IDR) dijumlahkan mentah dengan crypto USD: 10 lembar BBCA dihitung sebagai "$6.4K". → Baris saham tetap native Rp, total & persentase dinormalisasi ke USD dengan kurs live open.er-api.com (Rp17.7xx), chip `IDR→USD`, degradasi jujur `mixedCurrency` bila kurs gagal.
- **QA2-3**: Crash render tab Coins Rankings — 20 dari 120 koin CoinGecko memiliki `marketCap`/`supply` null (WIF, APT, TIA, TON, dll) → `TypeError: Cannot read properties of null (reading 'toLocaleString')` tertangkap ErrorBoundary. → Formatter null-safe + tampilan `N/A` jujur + agregat `?? 0` + ratio Vol/Mcap null-guard.
- **QA2-4**: SQLite `journal_mode=delete` membuat dua proses server saling mengunci tulis (DB "database is locked" saat test paralel) → **WAL mode + busy_timeout 5000ms** diaktifkan persisten.
- **QA2-5**: Test suite lama mengekstrak cookie sesi dari header `set-cookie` gabungan → tanpa sadar memakai cookie CSRF (baru dari fix SEC-6), bukan cookie sesi → 5 test gagal palsu. → `extractSessionCookie()` memilih `zaytrix_session` eksplisit via `getSetCookie()`.

**Fitur baru ronde QA #2:**
- **FUNC-14 SELESAI — test suite self-booting**: `vitest globalSetup` (src/server/__tests__/global-setup.ts) otomatis membuat `.env` sementara dengan secret acak (fresh checkout/CI), mengaktifkan WAL, men-spawn server, menunggu `/health` siap, dan melakukan teardown. **`bun run test` kini berdiri sendiri — 37/37 PASS.** Port bisa diatur via `ZAYTRIX_TEST_PORT=4170`.
- **Script `scripts/purge-db-from-history.sh`** — helper one-command untuk aksi pasca-insiden SEC-1 (git filter-repo + verifikasi otomatis + backup branch + panduan force-push). Jalankan: `bash scripts/purge-db-from-history.sh --push`.
- Atribusi portofolio multi-mata-uang jujur (lihat QA2-2).

### 🧪 Ronde QA Runtime #3 & #4 (31 Ag — hardening + konsol operator)

**Ronde #3** (commit `aa685e5`) — 3 bug nyata ditemukan & diperbaiki:
- **QA3-1**: *CSRF stale-cookie deadlock* — cookie `zaytrix_csrf` yang ada-tapi-invalid (mis. pasca rotasi secret) tidak pernah di-reseed → SPA terkunci 403 hingga 24 jam. → Middleware 403 kini mengirim cookie segar + kode mesin-baca (`CSRF_MISMATCH`/`CSRF_INVALID`), dan wrapper fetch di `main.tsx` otomatis retry sekali dengan token baru (terverifikasi E2E).
- **QA3-3**: Rate limiter live-data berlaku untuk SEMUA request (router ter-mount di root) — IP ter-throttle menerima JSON 429 mentah bahkan di halaman `/`. → Limiter di-scope ke `/api/live`.
- **QA3-4**: `authLimiter` menghitung probe GET `/api/auth/me` (2× per mount di StrictMode) — SPA bisa menghabiskan kuota login-nya sendiri. → Probe GET tanpa-risiko di-skip.
- **Logger terstruktur** (QA3-F1): `src/server/logger.ts` — JSON-lines dengan redaksi universal (email → `u***@`, JWT/token GitHub → di-mask, kunci sensitif → `[REDACTED]`), `LOG_LEVEL`, ring buffer 500 entri, endpoint `GET /api/system/logs` (requireAuth). **165 panggilan `console.*` termigrasi.**
- **Smoke test otomatis** (QA3-F2): `bun run smoke` — register user via UI nyata, sapu 15 tab, hitung error, laporan JSON (15/15 PASS).

**Ronde #4** (commit `c4f7f14`) — 0 bug baru, 2 fitur:
- **QA4-F1 — Panel "Log Sistem & Diagnostik"** (Settings Hub → sub-tab baru): konsol operator live yang membaca `GET /api/system/logs` — filter level dengan jumlah live, pencarian, batas 50–500 entri, auto-refresh 30 dtk (berlabel jujur "polling, bukan streaming"), entri expandable, dan kartu catatan integritas (redaksi server-side, semantik ring buffer).
- **QA4-F2 — Pipeline CI (GitHub Actions)**: template `docs/github-actions-ci.yml` — job `verify` (lint tsc → prisma generate + db push scratch → vitest self-booting 37/37 → build produksi + artefak) untuk tiap push/PR, plus job `smoke` manual (workflow_dispatch, full 15-tab sweep via agent-browser). Dikirim sebagai template karena token dev tidak punya scope `workflow`; aktifkan dengan:

```bash
mkdir -p .github/workflows && cp docs/github-actions-ci.yml .github/workflows/ci.yml
git add .github/ && git commit -m "ci: activate pipeline" && git push
```

- **Smoke test mode CI**: `scripts/smoke-test.mjs --boot` kini membuat `.env` sementara dengan secret acak bila tidak ada (fresh checkout/CI), dan menghapusnya saat teardown — terverifikasi penuh tanpa `.env`: 15/15 tab PASS.

### 🧪 Ronde QA Runtime #5 (31 Ag — whale radar real-time + command palette)

**1 bug dev-infra ditemukan & diperbaiki:**
- **QA5-1**: *Konflik port HMR Vite* — middleware-mode Vite diam-diam membuka listener kedua di `:24678`; dua instance dev yang berjalan bersamaan (server `:4100` + smoke test `:4180`) berebut port itu → browser client instance kedua gagal dengan `[vite] failed to connect to websocket` (smoke FAIL: 2 console error). → HMR websocket kini attach ke **origin/port yang sama** dengan app (`hmr.server` + `http.createServer`), kompatibel reverse-proxy single-port; smoke 15/15 PASS 0 error dengan server berjalan bersamaan.

**2 fitur besar (rekomendasi ronde #4):**
- **QA5-F1 — Whale Radar real-time** (`src/server/whaleStream.ts` + tab baru "Whale Radar" di On-Chain Data): agregator **WebSocket Binance spot aggTrade** yang berjalan terus-menerus (7 simbol, buffer 30 menit, dedup by trade-id, REST backfill saat boot, socket `unref` agar tidak menghalangi exit) + endpoint `GET /api/live/whale-trades` (filter simbol/ambang, statistik buy/sell, status stream jujur). Setiap baris di UI adalah **fill Binance NYATA** — badge "100% REAL", chip `WS LIVE`, bar tekanan beli/jual, baris dengan bar nominal relatif, dan 3 state jujur (live / menunggu whale berikutnya / stream putus → snapshot terakhir tetap real, tidak pernah difabrikasi). Menggantikan angka estimasi deterministik `whaleTransactions24h`.
- **QA5-F2 — Command Palette global** (`src/components/CommandPalette.tsx`, `Ctrl+K`/`Cmd+K`): navigasi keyboard-first untuk seluruh 15 tab + aksi (9 tema, glassmorphism toggle, reload, logout) — fuzzy matching buatan sendiri (subsequence + bonus run/boundary, tanpa dependensi `cmdk`), grup "TERBARU" via localStorage, navigasi arrow/Home/End, highlight karakter yang cocok, ARIA combobox/listbox lengkap. Tombol pemicu di header (badge `CTRL K`) untuk discoverability.

**Verifikasi ronde:** tsc 0 error · vitest 37/37 · smoke 15/15 (0 page error, 0 console error) · browser QA manual: whale radar live 5 transaksi real (BUY $290K, SELL $374K dst.), command palette terverifikasi (search → navigasi, tema switch `theme-hacker` aktif).

---

### 🧪 Ronde QA Runtime #6 (31 Ag — MIGRASI AI OPENROUTER + perbaikan bug auth)

**Migrasi provider AI (permintaan operator):**
- **9router DIHAPUS → OpenRouter** (`src/server/aiRouter.ts` ditulis ulang): 9router adalah proxy **lokal** (`localhost:20128`) yang butuh mesin/server 24/7 — tidak cocok untuk deployment cloud. OpenRouter (https://openrouter.ai) adalah agregator **cloud**: satu key `sk-or-v1-...` membuka 100+ model, tanpa infrastruktur lokal sama sekali.
- **Rantai ketahanan 4 lapis**: model utama (`z-ai/glm-4.5-air` — murah, cepat, Bahasa Indonesia bagus) → model fallback (`meta-llama/llama-3.3-70b-instruct`, `google/gemma-3-27b-it`; semua teruji) → Gemini langsung (`GEMINI_API_KEY`) → fallback jujur berlabel. Model reasoning (GLM) dikunci `reasoning: {enabled: false}` agar token tidak habis untuk chain-of-thought.
- **Adapter compat Gemini** (`createOpenRouterCompatClient()`): meniru bentuk `.models.generateContent()` SDK Google — seluruh 9 endpoint AI lama (`/api/gemini/analyze`, `news-sentiment`, `analyze-onchain`, `automated-analysis`, `trading-signals`, dll.) mendapat OpenRouter **tanpa mengubah satu baris pun di call-site** (risiko refactor nol).
- **Keamanan key**: `OPENROUTER_API_KEY` hanya hidup di `.env` (gitignored); sanitasi error upstream (redaksi `Bearer`/`sk-or-v1-...` sebelum sampai ke klien, pola FIX-B-6); audit log `AI_CALL_OPENROUTER` per panggilan; header atribusi `HTTP-Referer` + `X-Title: ZAYTRIX`.
- Endpoint `POST /api/ai/test` kini menguji OpenRouter dan melaporkan model yang sehat; `GET /api/ai/health` menampilkan health + fallback model.

**1 bug nyata ditemukan via browser QA & diperbaiki:**
- **QA6-1**: *Register dengan email yang sudah terdaftar → "ghost shell"* — server membalas 201 generik (anti-enumeration FIX-C-1, TANPA cookie sesi), tetapi AuthScreen tetap membuka app shell dengan user ter-redact → semua fetch auth 401 (dashboard kosong, chat gagal). → Kini UI mengarahkan ke tab LOGIN dengan email terisi + pesan generik yang sama (enumeration tetap mustahil).

**Verifikasi ronde:** tsc 0 error · vitest 37/37 · smoke 15/15 (0 page error, 0 console error) · **AI LIVE terverifikasi end-to-end**: `/api/ai/test` OK (667ms), `/api/ai/chat` respons nyata provider `openrouter` (114 token, 1.4s), `/api/gemini/analyze` analisis markdown nyata (bukan fallback), `news-sentiment` JSON valid (BULLISH/85), **AI Market Chat di browser**: jawaban AI berbasis data pasar live (Fear&Greed 62/100, HEMI +38.97%, NFP −65.85%) + badge `• openrouter`; laporan `automated-analysis.json` kini berisi analisis OpenRouter NYATA setiap 10 menit. Teks UI lama "Google Gemini AI" dibersihkan menjadi provider-netral.

### 🧪 Ronde QA Runtime #7 (31 Ag — AI STREAMING SSE + panel pemakaian AI + smoke deep-check)

**Fitur baru:**
- **QA7-F1: AI Chat Streaming (SSE)** — jawaban AI kini **mengalir token demi token** alih-alih menunggu respons penuh:
  - `callAIStream()` di `src/server/aiRouter.ts`: OpenRouter `stream:true`, parser SSE toleran (skip keep-alive comment & chunk malformed), **fallback model hanya SEBELUM token pertama** (retry mid-stream akan menduplikasi teks parsial — begitu konten mengalir, kami berkomitmen ke model itu; putus mid-stream = catatan jujur di akhir jawaban, konten parsial dipertahankan).
  - Endpoint `POST /api/ai/chat-stream`: `text/event-stream` + `X-Accel-Buffering: no` (proxy tidak mem-buffer) + keep-alive comment tiap 15 dtk saat model berpikir + **abort propagation** (client disconnect → upstream fetch di-abort, tidak ada stream yatim).
  - Frontend `MarketSentimentChat.tsx`: bubble asisten muncul seketika + **kursor terminal berkedip** (CSS steps animation) + chip `streaming`; selesai → meta `N tok · X.Xs` + badge provider. **Degradasi otomatis**: bila SSE gagal (proxy/404 server lama) → fallback transparan ke `/api/ai/chat` non-streaming.
- **QA7-F2: Panel Pemakaian AI (Token & Biaya)** — operator kini melihat pembakaran token tanpa baca log:
  - Ring buffer in-memory 300 panggilan terakhir di `aiRouter.ts` — **metadata saja, TANPA isi prompt** (privasi): endpoint, model, tokens, latensi, sukses/gagal, `costUsd` (angka **nyata** dari chunk `usage.cost` OpenRouter, bukan estimasi).
  - Endpoint `GET /api/ai/usage` + komponen `AiUsagePanel.tsx` di Settings Hub → Log Sistem: 4 kartu statistik, agregat per-model dengan bar proporsional animasi, agregat per-endpoint, 25 panggilan terakhir (scrollable), auto-refresh 30 dtk, label jujur "ring buffer di-reset saat restart".
- **QA7-F3: Smoke deep-check baru (18 langkah)** — dua langkah otomatis menjaga regresi fitur bernilai tinggi: (1) Whale Radar — poll ≤14 dtk hingga chip `WS LIVE` (menerima `PUTUS` akan false-pass saat feed null); (2) AI chat streaming — ketik prompt sungguhan via keyboard event → assert bubble streaming + badge provider muncul.

**1 bug honesty ditemukan & diperbaiki:**
- **QA7-1**: *Chip Whale Radar menyala "WS PUTUS" saat memuat* — `whaleFeed` null (fetch pertama berjalan) dirender sebagai "PUTUS", menyesatkan (stream tidak putus, hanya belum termuat). → Kini 3 state jujur: `WS LIVE` / `MEMUAT…` / `WS PUTUS` (stale-but-real snapshot tetap tampil saat benar-benar putus).

**Verifikasi ronde:** tsc 0 error · vitest 37/37 · **smoke 18/18 PASS** (15 tab 0 error + whale WS LIVE + streaming bubble; 2 bug skrip smoke diperbaiki: hasil eval ter-quote JSON + regex double-escape) · **streaming live di browser**: jawaban mengalir → `350 tok · 11.8s` + badge `⚡ openrouter · glm-4.5-air`, 0 console error · **/api/ai/usage**: 1 panggilan · 350 token · **$0.00013271** biaya nyata OpenRouter · panel pemakaian AI live di Settings Hub.

---

### 🧪 Ronde QA Runtime #8 (3 Sep — SSE untuk SEMUA endpoint AI + whale futures + virtualisasi log + LOG_LEVEL runtime)

**Fitur baru (5):**
- **QA8-F1: Streaming SSE untuk 4 endpoint AI lainnya** — pola `chat-stream` ronde #7 kini berlaku untuk seluruh analisis yang lambat (10–30 dtk sebelumnya terasa "hang"):
  - Endpoint: `POST /api/gemini/analyze`, `news-chat`, `analyze-onchain`, `trading-signals/analyze` — body yang sama + `"stream": true` → respons `text/event-stream` token-demi-token.
  - Kontrak jujur: event `token` (konten bertahap) → `done` (payload **persis sama** dengan JSON non-stream — fallback report `isFallback` tetap dikirim saat AI gagal, jadi degradasi tidak pernah diam-diam) → `error`. Cache `geminiCacheSet` dan pencatatan sinyal tetap dieksekusi hanya saat stream tuntas (konten parsial tidak pernah di-cache). Abort klien → upstream fetch ikut di-abort.
  - Frontend (`AssetsHub`, `Projections`, `NewsSection`, `AiSignals`, `OnChainData`): helper bersama `src/lib/aiStream.ts` (`consumeAIStream`); progres token dirender langsung; **error sebelum token pertama → retry sekali ke path non-stream lama** (path JSON lama 100% utuh sebagai jaring pengaman).
- **QA8-F2: `StreamMarkdown` — render markdown bertahap saat streaming** — komponen bersama baru: paragraf yang sudah selesai di-render sebagai markdown **ter-memoisasi** (tidak di-parse ulang tiap token → beban render O(token baru), bukan O(seluruh teks)); paragraf ekor (masih mengalir) tampil sebagai teks mentah + kursor terminal — menghilangkan blok kode parsial yang tampak "rusak" sekejap. Dipakai `MarketSentimentChat` + kartu analisis streaming.
- **QA8-F3: Whale Radar dua pasar — SPOT + FUTURES Binance** — `whaleStream.ts` kini menjaga **dua WebSocket persisten** (`stream.binance.com` spot + `fstream.binance.com` futures, 7 simbol `@aggTrade` masing-masing): satu buffer bersama dengan dedup `(market, symbol, tradeId)`, cap 900 baris / prune 30 menit; UI: badge SPOT (teal) / FUTURES (amber) per baris + chip filter SEMUA/SPOT/FUTURES + indikator kesehatan per-market (S●/F●) + statistik tekanan beli/jual terpisah per pasar; chip `WS LIVE` = minimal satu pasar terhubung (status per-market diekspos jujur di endpoint).
- **QA8-F4: Virtualisasi daftar log sistem** (`react-window` v2) — panel "Log Sistem & Diagnostik" kini merender hanya baris terlihat (+overscan) dengan tinggi baris terukur otomatis (ResizeObserver — baris expandable dengan payload JSON tetap didukung, estimasi tinggi dikoreksi otomatis setelah render). Fitur ronde #4 (filter level + count, pencarian, limit, auto-refresh 30 dtk, expand) semuanya dipertahankan.
- **QA8-F5: Toggle `LOG_LEVEL` runtime** — operator kini mengubah level logger **tanpa restart**: `GET/POST /api/system/logs/level` (requireAuth; validasi manual; perubahan ter-audit sebagai entri warn di ring buffer itu sendiri) + 4 tombol DEBUG/INFO/WARN/ERROR di panel log. Jujur: berlaku untuk entri BARU selama proses hidup — `LOG_LEVEL` env tetap default saat boot.

**0 bug aplikasi baru ditemukan** — ronde fokus fitur murni (tren ronde #4+ berlanjut; 1 temuan QA skrip: filter baris log berdata langka di tampilan default — bukan bug, entri berdata kini deterministik hadir via entri audit LOG_LEVEL).

**Verifikasi ronde:** tsc 0 error · vitest 37/37 · smoke 18/18 PASS (0 page/console error) · **browser E2E**: analisis on-chain streaming live (thinking → `ANALISIS MENGALIR…` → selesai, `HASIL GEMINI` live non-fallback, 0 console error) · toggle LOG_LEVEL (DEBUG→WARN aktif → entri audit terlihat → baris expand → payload JSON ter-render → kembali DEBUG) · whale radar filter SPOT bekerja · **SSE trading-signals via curl**: 23+ frame token `⚡ openrouter · glm-4.5-air` mengalir nyata · 0 console error di semua skenario.

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

### 🖥️ On-Chain Terminal (9 tab + Whale Radar SPOT/FUTURES) · 📊 Trading & Portfolio (Backtester, DCA, Tax PMK-68, Risk VaR/CVaR, Rebalancing, Correlation) · 🤖 AI Streaming SSE di SEMUA endpoint (OpenRouter + Gemini fallback, panel token/biaya, render markdown bertahap) · 🖥️ Konsol Operator (log virtualisasi + LOG_LEVEL runtime) · 🔔 Price Alerts + Telegram/Discord/WhatsApp

---

## 📋 Status & Catatan Jujur

| Aspek | Status |
|-------|--------|
| Type errors | **0** (`bun run lint` bersih) |
| Build produksi | ✅ `bun run build` → `dist/server.mjs` (ESM) |
| Boot server | ✅ semua router mount, WS Binance connect, live sync |
| Data fabrication | **0 tersisa** — semua sumber gagal → 503 + UI jujur |
| AI (OpenRouter) | Aktif jika `OPENROUTER_API_KEY` diisi — **cloud, tanpa server lokal** (migrasi dari 9router yang butuh mesin 24/7). Fallback otomatis: model cadangan → Gemini (`GEMINI_API_KEY`) → fallback berlabel jujur |
| Email verifikasi/reset | Butuh SMTP; tanpa SMTP di dev → `EMAIL_DEV_MODE=true` mencetak token ke log server |
| Google OAuth | Butuh `GOOGLE_CLIENT_ID/SECRET`; tanpa itu tombol menampilkan pesan ramah |
| Test suite | **Self-booting (ronde QA #2)** — `bun run test` spawn server sendiri + `.env` sementara otomatis (37/37 PASS); override port via `ZAYTRIX_TEST_PORT` |

### ⚠️ Tindakan Pasca-Insiden yang WAJIB Anda lakukan (SEC-1)
Database lama (`db/custom.db`) pernah ter-commit publik berisi email, hash bcrypt, dan hash token user:
1. **Rotasi password semua user** yang terdaftar di DB lama.
2. **Hapus semua sesi** (tabel Session) — token lama berpotensi bocor.
3. Rotasi `SESSION_SECRET`, `ENCRYPTION_KEY`, `CSRF_SECRET` di `.env` (generate baru: `openssl rand -hex 48/32/32`).
4. **Purge riwayat git** — kini cukup satu perintah (helper ronde QA #2):
   ```bash
   bash scripts/purge-db-from-history.sh --push
   ```
   Script memakai `git filter-repo`, membuat backup branch lokal, memverifikasi `db/*.db` hilang dari seluruh history, lalu force-push. (Prasyarat: `pip install git-filter-repo`.)

---

## 🔧 Tech Stack
- **Framework**: Vite + React 19 + Express (server.ts)
- **Language**: TypeScript 5 (strict typecheck bersih)
- **Styling**: Tailwind CSS 4
- **Database**: Prisma ORM + SQLite (`db/custom.db`, tidak di-track)
- **State**: Zustand + TanStack Query
- **Auth**: JWT httpOnly + bcrypt + 2FA TOTP + WebAuthn + OAuth (CSRF enforced)
- **AI**: OpenRouter (`z-ai/glm-4.5-air` + fallback model `llama-3.3-70b` / `gemma-3-27b`) → Gemini 2.5-flash (fallback)
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

# 6. (Opsional) Test integrasi — server test di-spawn otomatis
bun run test
#    Port berbeda (mis. 3000 dipakai): ZAYTRIX_TEST_PORT=4170 bun run test
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
├── scripts/
│   └── purge-db-from-history.sh # Helper purge git history SEC-1 (QA #2)
└── .env.example                 # Template env LENGKAP
```

---

## 📊 Status: v5.2.0 (31 Aug 2026)

| Metric | Value |
|--------|-------|
| Temuan audit (GLM 5.3) | 75 (26 SEC + 25 DATA + 24 FUNC) |
| Temuan ditangani | 75 / 75 |
| Bug QA runtime (8 ronde) | 15 ditemukan → semua diperbaiki |
| Data fabrication tersisa | 0 |
| Type errors | 0 |
| Build produksi | ✅ (ESM, 492.9kb server) |
| Test suite | ✅ 37/37 self-booting (FUNC-14 selesai) |
| Commits | audit + 8 ronde QA runtime |

---

<p align="center">
  <strong>ZAYTRIX</strong> — Dibangun dengan ❤️ untuk komunitas kripto Indonesia<br>
  <em>Institutional-grade tools for everyone — kini dengan integritas data 100%</em>
</p>
