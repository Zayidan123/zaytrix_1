# 🔍 AUDIT LAPORAN: Mock/Dummy/Sample/Placeholder Data — ZAYTRIX Project

**Tanggal Audit:** 2026-09-20  
**Project:** /root/zaytrix_1 (React + Vite + Express + TypeScript)  
**Status:** Audit Only — Tidak Ada File yang Dimodifikasi  
**Bahasa:** Indonesia

---

## 📋 RINGKASAN EKSEKUTIF

Audit menemukan **24 temuan** mock/dummy/sample/placeholder data tersebar di **14 file**. Dari jumlah tersebut:

| Severitas | Jumlah | Keterangan |
|-----------|--------|------------|
| 🔴 KRITIS | 12 | Data palsu ditampilkan seolah-olah data live/real ke pengguna |
| 🟡 SEDANG | 5 | Data sintetis dengan label jujur namun tetap berpotensi menyesatkan |
| 🟠 RENDAH | 7 | Data dummy/keamanan yang TIDAK ditampilkan ke pengguna |

---

## 🔴 KRITIS — Data Palsu Ditampilkan sebagai Data Real

### 1. `src/server/assetsStore.ts` — Hardcoded Initial Assets (WARMUP)
- **Baris:** 22–217
- **Data:** Array `initialAssets` berisi 12+ saham Indonesia (BBCA, BBRI, TLKM, GOTO, ASII, UNVR, BMRI, BBNI, HMPH, KLBF, MYRS, PTBA, TKG) dan cryptocurrency dengan harga, market cap, volume 24h yang HARDCODED.
- **Dampak:** Data ini dilayani melalui endpoint `/api/assets` sebagai "live" data sampai refresh pertama selesai. Komentar di baris 220 menyebutnya "WARMUP values only" — tapi pengguna melihatnya sebagai data real-time.
- **Perbaikan:** Tingkatkan transparansi label WARMUP menjadi "data sementara" di UI; tambahkan badge "WARMUP" pada setiap asset yang berasal dari initialAssets.

### 2. `src/components/Dashboard.tsx` — Hardcoded Default User Profile
- **Baris:** 121–128
- **Data:** `defaultProfile` berisi `email: "user@example.com"`, `phoneNumber: "628123456789"`, `avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150"`.
- **Dampak:** Ketika localStorage tidak memiliki data profil, sistem menampilkan data profil PALSU ini seolah-olah data profil pengguna yang sesungguhnya.
- **Perbaikan:** Tampilkan profil kosong dengan fields kosong sampai pengguna mengisi profilnya, atau setiap field tampilkan sebagai "Belum diisi".

### 3. `src/components/Dashboard.tsx` — Hardcoded Fallback Market Metrics (7 nilai)
- **Baris:** 354–407
- **Data:**
  - Baris 354: BTC price fallback `95230.00`
  - Baris 365: Open Interest fallback `1450000000`
  - Baris 378: Long/Short Ratio fallback `1.42`
  - Baris 393: Netflow fallback `-60000000`
  - Baris 400: Active Addresses fallback `890000`
  - Baris 407: Hashrate fallback `615`
- **Dampak:** Pada cold start atau saat offline, nilai-nilai hardcoded ini ditampilkan di kartu metrik utama Dashboard SEBAGAI data live. Walaupun ada `FallbackBadge` (EST badge), pada saat loading awal pengguna bisa melihat angka-angka ini tanpa badge EST.
- **Perbaikan:** Pastikan semua kartu metrik menunjukkan "EST" badge DURING loading awal, bukan hanya setelah data pertama gagal. Atau tampilkan "—" sampai live data tersedia.

### 4. `src/components/Dashboard.tsx` — Synthetic Sparkline Data (8 dataset)
- **Baris:** 443–514
- **Data:** 8 sparkline chart datasets (BTC price, OI, funding rate, L/S ratio, netflow, active addresses, network hashrate, plus satu lagi) dibangkitkan oleh `Array.from({ length: 10 }, ...)` dengan `Math.sin`/`Math.cos`.
- **Dampak:** Sparkline-chart ini tampak seperti data historis real. Hanya ditandai "FALLBACK" di komentar kode, tapi UI-nya tidak membedakan secara eksplisit.
- **Perbaikan:** Tambahkan visual indicator (warna abu-abu, opacity berbeda, atau label) pada sparkline yang menggunakan data sintetis.

### 5. `src/components/Dashboard.tsx` — Synthetic On-Chain Chart Data (24H/7D)
- **Baris:** 566–612
- **Data:** Untuk periode 24H dan 7D, chart menampilkan "Deterministic synthetic series" yang dihasilkan oleh `Array.from` dengan `Math.sin`/`Math.cos`/`Math.cos`.
- **Dimpak:** Data sintetis ini ditampilkan di chart interaktif utama Dashboard On-Chain tanpa label yang jelas bahwa datanya bukan real-time.
- **Perbaikan:** Tambahkan "EST" badge atau tooltip yang menjelaskan bahwa data 24H/7D adalah data estimasi.

### 6. `src/components/TokenTerminalExplorer.tsx` — ASSET_PROFILES Hardcoded Data
- **Baris:** 525–838+
- **Data:** Record `ASSET_PROFILES` berisi data statis untuk 18 aset (BTC, ETH, SOL, XRP, dan 14 lainnya) termasuk harga, FDV, market cap, fees, revenue, dev counts, TVL, volatility, dll. Semua nilai HARDCODED.
- **Dampak:** Untuk metrik non-price (fees, revenue, devs, TVL, dll.), data dari ASSET_PROFILES ditampilkan di UI dengan badge "EST" tapi nilainya statis dan tidak pernah diperbarui. Pengguna melihat angka-angka ini seolah-olah data live.
- **Perbaikan:** Perbarui ASSET_PROFILES secara berkala (misal mingguan) dari sumber real. Atau kurangi metrik yang ditampilkan hanya ke yang ada sumber live.

### 7. `src/components/TokenTerminalExplorer.tsx` — Synthetic 52-Week Projection Chart
- **Baris:** 1341–1380
- **Data:** Untuk 10 aset tanpa data history real dari `/api/history/:symbol`, ditampilkan "synthetic 52-week projection" yang dihasilkan algoritma deterministik (sin/cos noise).
- **Dampak:** Data sintetis ini ditampilkan dalam bentuk CHART yang terlihat seperti data historis harga real. Badge "EST" ada tapi chart-nya tidak dibedakan secara visual.
- **Perbaikan:** Buat chart sintetis terlihat berbeda (misal garis putus-putus, warna lebih terang, watermark "ESTIMASI").

### 8. `src/components/TokenTerminalExplorer.tsx` — BTC "FULL SIMULATED DATA" Workspace
- **Baris:** 1568
- **Data:** Komentar kode menyatakan "BTC FULL SIMULATED DATA" — entire BTC terminal workspace menampilkan synthetic projection sebagai chart utama saat data historis real tidak tersedia.
- **Dampak:** Pengguna yang membuka Token Terminal Explorer untuk BTC akan melihat chart sintetis yang tampak seperti data historis real.
- **Perbaikan:** Tambahkan overlay/watermark "SIMULASI" yang besar dan jelas di atas chart.

### 9. `src/components/OnChainData.tsx` — Hardcoded Simulated Analysis Inputs (6 nilai)
- **Baris:** 137–142, 151–175
- **Data:** State `simFundingRate` (0.015), `simLongShort` (1.45), `simNetflow` (-45), `simOpenInterest` (1450), `simActiveAddresses` (890000), `simHashrate` (615) — semua HARDCODED.
- **Dampak:** Nilai-nilai ini dikirim sebagai payload ke `/api/gemini/analyze-onchain` dan diperlakukan seolah-olah adalah data live. AI menganalisis DATA SINTETIS dan menghasilkan analisis berdasarkan angka-angka palsu ini.
- **Perbaikan:** Kecualikan state sim* dari payload AI analysis sampai live data tersedia. Tampilkan "data belum tersedia" alih-alih mengirim data sintetis ke AI.

### 10. `src/components/OnChainData.tsx` — Hardcoded Flow/Liquidation Values for AI
- **Baris:** 303–306
- **Data:** `baseFlow = 120000000`, `liquidation24h = 12500000` (BTC), `6400000` (ETH), `4200000` (SOL) — dikirim sebagai parameter ke AI analysis endpoint.
- **Dampak:** AI menghasilkan analisis berdasarkan nilai-nilai hardcoded yang disajikan seolah-olah real.
- **Perbaikan:** Hapus nilai-nilai hardcoded dari AI payload. Kirim null atau omit parameter sampai live data tersedia.

### 11. `src/components/Ledger.tsx` — Demo Transactions Seeded into Real Ledger
- **Baris:** 42–98
- **Data:** Fungsi `handleSeedMockTransactions()` membuat 4 transaksi dengan harga statis, timestamp fiktif, dan catatan "[DEMO]". Transaksi-transaksi ini disimpan ke ledger riil pengguna via `addLedgerTransaction()`.
- **Dampak:** Setelah tombol "Pre-seed Contoh Transaksi (DEMO)" diklik, data palsu ini masuk ke tabel ledger pajak pengguna dan MEMPENGARUHI perhitungan pajak (PPh Final PMK-68, FIFO cost basis, realized PnL). Data transaksi ini tidak bisa dibedakan dari transaksi riil di tabel.
- **Perbaikan:** (a) Pisahkan data demo ke tabel terpisah yang tidak mempengaruhi perhitungan pajak, ATAU (b) Tambahkan kolom/tanda "DEMO" yang sangat mencolok di setiap baris transaksi demo, (c) Hitung pajak TANPA memasukkan transaksi demo.

### 12. `src/store.ts` — Hardcoded Execution Log Entries
- **Baris:** 205–210
- **Data:** `executionLogs` diinisialisasi dengan 4 entri hardcoded: "[SYSTEM] Otentikasi Workspace Terintegrasi...", "[SYSTEM] Deteksi sandboxed credentials...", "[STATUS] Menunggu koneksi data pasar…", "[STATUS] Sistem broker sandbox: tidak terhubung (mode manual)."
- **Dampak:** Entri log ini selalu ada meskipun broker user sebenarnya terhubung. Pengguna melihat "Sistem broker sandbox: tidak terhubung" meskipun mungkin broker sudah aktif. Entri "Deteksi sandboxed credentials. Menggunakan Kunci Simulasi Tanpa API Key Fisik" bisa menyesatkan seolah-olah semua fungsi trading hanya simulasi.
- **Perbaikan:** Hapus entri hardcoded dari initial state. Biarkan log dimulai kosong dan diisi oleh event nyata.

---

## 🟡 SEDANG — Synthetic Data dengan Label Jujur tapi Potensi Menyesatkan

### 13. `src/server/assetsStore.ts` — WARMUP Assets Served as Live
- **Baris:** 22, 218, 220
- **Keterangan:** Komentar di baris 220 menyatakan "WARMUP values only" dan `liveAssets = [...initialAssets]` (baris 218). Data hangup ini disajikan melalui `/api/assets` dan `/api/coins/rankings` sampai refresh pertama. Walaupun ada `isWarmup` flag di response (baris 189), tidak semua konsumen UI memeriksa flag ini.

### 14. `src/server/geminiRoutes.ts` — Fabricated PDF Report Content (Fallback)
- **Baris:** 123–272
- **Data:** Fungsi `generateResilientPdfReportFallback()` menghasilkan laporan PDF dengan ANGKA-ANGKA KONKRET yang DIBUAT (Debt-to-Equity 42.1%, ROA 14.2%, GPM 22.8%, Quick Ratio 1.85x, dll.) — untuk saham, dan tokenomik Whitepaper analysis untuk kripto (alokasi 45% komunitas, 15% pendiri, dll.).
- **Dampak:** Ketika AI unavailable, laporan PDF menampilkan analisis dengan angka-angka spesifik yang SEKALI JUGA DIBUAT, bukan dari dokumen asli. Pengguna bisa menganggap ini sebagai hasil analisis dokumen riil.
- **Perbaikan:** Jangan sertakan angka spesifik dalam fallback laporan. Tampilkan hanya template dengan placeholder "ANALISIS AI TIDAK TERSEDIA" tanpa metrik kuantitatif.

### 15. `src/server/geminiRoutes.ts` — Offline News Sentiment Returns Neutral
- **Baris:** 35–46
- **Data:** `getOfflineNewsSentiment()` mengembalikan `sentiment: "netral"` dengan `score: null`.
- **Dampak:** Ketika AI tidak tersedia, artikel berita menunjukkan sentimen "netral" tanpa penilaian dampak pasar — meskipun artikel tersebut mungkin memiliki sentimen yang jelas.

### 16. `src/components/TechnicalTerminal.tsx` — "Simulated Live Ticker Feed"
- **Baris:** 902
- **Keterangan:** Panel berlabel "Umpan Harga Live (Tick Feed)" tetapi menampilkan data teknikal (RSI, SMA, Bollinger) yang dihitung dari data historis, bukan dari feed harga real-time. Label "Simulated" dalam komentar (baris 902) tapi label UI-nya tidak mengatakan "Simulated".

### 17. `src/components/CorrelationHeatmap.tsx` — Hardcoded Benchmark Assets
- **Baris:** 51–58, 47–48
- **Data:** Benchmark assets (BTC, ETH, BBCA, BBRI, TLKM, GOTO) hardcoded untuk correlation matrix. "Deterministic fallback coefficients" (baris 47) digunakan saat portfolio kurang dari 2 aset.
- **Dampak:** Matriks korelasi menunjukkan koefisien korelasi antar aset yang HARDCODED/deterministik, bukan dihitung dari data historis riil. Badge "usingFallback" (baris 112) ditampilkan tapi hanya saat portfolio kosong.

---

## 🟠 RENDAH — Non-User-Facing Mock/Dummy Data

### 18. `src/server/auth.ts` — DUMMY_HASH for Timing Equalization
- **Baris:** 103
- **Keterangan:** `DUMMY_HASH = "$2a$12$N9qo8uLOickgx2ZMRZoMy.Mrq8BkV6qL/2qZ8wT8p2fJqKqKqKq"` — bcrypt hash palsu untuk mencegah email enumeration via timing attack. TIDAK ditampilkan ke pengguna. Security measure yang valid.

### 19. `src/server/webauthn.ts` — Dummy Challenge for Non-existent Users
- **Baris:** 221–231
- **Keterangan:** Untuk login passkey pada user yang tidak ada, server mengembalikan `loginId` dan `challenge` random yang TIDAK disimpan. Anti-enumeration security measure. TIDAK ditampilkan sebagai data ke pengguna.

### 20. `src/server/tradeExecution.ts` — MOCK API Key Detection
- **Baris:** 547, 560, 575
- **Keterangan:** Pengecekan `k.apiKey.includes("MOCK")` untuk menentukan mode sandbox bursa. Hanya digunakan untuk logika internal, bukan data pengguna.

### 21. `src/server/onchainStore.ts` — ESTIMATED Source Label
- **Baris:** 99, 109, 110, 131, 143
- **Keterangan:** `ESTIMATED_SOURCE` label untuk on-chain data yang menggunakan model deterministik. Sudah dilabeli dengan jujur.

### 22. `src/components/TaxReportWidget.tsx` — Hardcoded USD/IDR Rate in Report Footer
- **Baris:** 419
- **Data:** `USD/IDR: 15.800` ditampilkan di footer laporan pajak — nilai ini salah (DATA-24 di server sudah menggantinya dengan live rate, tapi UI masih menampilkan hardcoded value).
- **Dampak:** Laporan pajak menampilkan kurs USD/IDR yang salah di footer.

### 23. `src/server/portfolio.ts` — DATA-24 USD/IDR Rate Comments
- **Baris:** 315, 887
- **Keterangan:** Komentar menyatakan bahwa hardcoded 15,800/15.800 sudah diganti dengan null saat kurs tidak tersedia. Perbaikan server sudah dilakukan tapi UI belum konsisten.

### 24. `src/components/Settings.tsx` — Example Phone Number in Instructions
- **Baris:** 1901
- **Data:** "contoh: 6281234567890" dalam instruksi setup WhatsApp. Ini teks instruksi, BUKAN data pengguna. Tidak mempengaruhi data.

---

## 📊 DISTRIBUSI TEMUAN BERDASARKAN FILE

| File | Kritris | Sedang | Rendah | Total |
|------|---------|--------|--------|-------|
| `src/components/Dashboard.tsx` | 3 | 0 | 0 | 3 |
| `src/components/TokenTerminalExplorer.tsx` | 3 | 0 | 0 | 3 |
| `src/components/OnChainData.tsx` | 2 | 0 | 0 | 2 |
| `src/components/Ledger.tsx` | 1 | 0 | 0 | 1 |
| `src/store.ts` | 1 | 0 | 0 | 1 |
| `src/server/assetsStore.ts` | 1 | 1 | 0 | 2 |
| `src/server/geminiRoutes.ts` | 0 | 2 | 0 | 2 |
| `src/components/TechnicalTerminal.tsx` | 0 | 1 | 0 | 1 |
| `src/components/CorrelationHeatmap.tsx` | 0 | 1 | 0 | 1 |
| `src/components/TaxReportWidget.tsx` | 0 | 0 | 1 | 1 |
| `src/server/auth.ts` | 0 | 0 | 1 | 1 |
| `src/server/webauthn.ts` | 0 | 0 | 1 | 1 |
| `src/server/tradeExecution.ts` | 0 | 0 | 1 | 1 |
| `src/server/onchainStore.ts` | 0 | 0 | 1 | 1 |
| `src/components/Settings.tsx` | 0 | 0 | 1 | 1 |

---

## 🏆 PRIORITAS PERBAIKAN

### Prioritas 1 (Segera) — Pengguna Terlihat Palsu Data sebagai Real:
1. **Ledger.tsx** — Pisahkan data demo dari ledger pajak riil, atau tambahkan penanda sangat mencolok
2. **Dashboard.tsx (defaultProfile)** — Hapus hardcoded profil user, tampilkan "Belum diisi"
3. **Dashboard.tsx (fallback metrics)** — Pastikan semua kartu metrik menunjukkan "EST/OFFLINE" selama loading awal, bukan angka hardcoded
4. **Dashboard.tsx (synthetic sparklines & charts)** — Tandai secara visual semua chart yang menggunakan data sintetis
5. **OnChainData.tsx (sim* inputs)** — Jangan kirim data sintetis ke AI analysis pipeline
6. **store.ts (executionLogs)** — Hapus hardcoded log awal

### Prioritas 2 (Minggu Ini) — Data dengan Label Tapi Tetap Menyesatkan:
7. **TokenTerminalExplorer.tsx (ASSET_PROFILES)** — Perbarui data atau kurangi metrik yang ditampilkan
8. **TokenTerminalExplorer.tsx (synthetic chart)** — Tambahkan watermark/overlay "ESTIMASI/SIMULASI" pada chart sintetis
9. **geminiRoutes.ts (PDF fallback)** — Hapus angka spesifik dari laporan fallback
10. **Dashboard.tsx (USD/IDR)** — Sinkronkan UI dengan server-side DATA-24 fix

### Prioritas 3 (Bulan Ini) — Internal/Non-User-Facing:
11. **assetsStore.ts (WARMUP)** — Perkuat is_warmup flag propagation ke semua UI components
12. **TechnicalTerminal.tsx (simulated ticker)** — Tambahkan "SIMULATED" label pada panel UI

---

## ⚠️ CATATAN PENTING

1. **Banyak perbaikan sudah dilakukan** (ditandai dengan komentar DATA-#, IMPL-C3, FIX-ALL, QA-#) — proyek ini dalam proses migrasi dari mock ke real data.
2. **Tidak ada modifikasi** yang dilakukan dalam audit ini — semua temuan bersifat observasional.
3. **Beberapa "fallback" sudah diimplementasikan dengan baik** (misal: null instead of wrong numbers, honest error messages, EST badges) — ini menunjukkan perkembangan positif.
4. **Risiko terbesar** adalah di Ledger (mempengaruhi perhitungan pajak) dan Dashboard (pengguna melihat angka palsu selama loading).

---

*Laporan audit selesai. Tidak ada file yang dimodifikasi.*
