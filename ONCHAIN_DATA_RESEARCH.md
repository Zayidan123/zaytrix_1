# Dokumen Riset: Sumber Data On-Chain Real-Time Tanpa API Key & Strategi Real-Time Scraping

Dokumen ini disusun sebagai panduan teknis komprehensif untuk mengidentifikasi, memverifikasi, dan merancang integrasi data transaksi *on-chain* multi-blockchain (Bitcoin, Ethereum, BSC, Solana, dan Tron) secara real-time **tanpa memerlukan API Key**, serta alternatif strategi **Real-Time Web Scraping** yang aman, akurat, dan bebas dari manipulasi alamat (address spoofing).

---

## 🎯 1. Filosofi Integrasi & Integritas Data
Tujuan utama riset ini adalah mendapatkan data transaksi yang **otentik, akurat, dan langsung dari ledger resmi**. Masalah yang sering terjadi pada umpan data pihak ketiga (mock/simulated feeds) adalah:
*   **Address Spoofing/Masking**: Alamat pengirim atau penerima disamarkan menjadi placeholder bursa umum tanpa verifikasi tanda tangan kriptografis.
*   **Stale Data**: Transaksi delay atau tidak sinkron dengan keadaan mempool / blok terbaru.
*   **Rate Limits**: API gratisan sering kali terblokir di tengah jalan jika tidak menggunakan strategi rotasi atau RPC publik yang tepat.

---

## 🌐 2. Daftar Sumber Data Gratis Berdasarkan Blockchain (Tanpa API Key)

### A. Bitcoin (BTC)
Bitcoin memiliki salah satu ekosistem API publik tanpa kunci paling matang melalui visualizer mempool mandiri.

1.  **Mempool.space API** (Sangat Direkomendasikan)
    *   **Deskripsi**: Platform open-source yang memetakan seluruh isi mempool Bitcoin global secara real-time.
    *   **Endpoint Publik Tanpa Key**:
        *   Transaksi Mempool Terbaru: `GET https://mempool.space/api/mempool/recent`
        *   Detail Transaksi Spesifik: `GET https://mempool.space/api/tx/{txid}`
        *   Status Blok Terakhir: `GET https://mempool.space/api/blocks/tip/height`
    *   **Autentisitas Data**: 100% akurat. Menyediakan array lengkap `vin` (input alamat asal beserta signature) dan `vout` (output alamat tujuan beserta jumlah nominal).

2.  **Blockstream.info API**
    *   **Deskripsi**: Alternatif tangguh berbasis Esplora yang dihosting langsung oleh Blockstream.
    *   **Endpoint Publik Tanpa Key**:
        *   Transaksi Blok Terbaru: `GET https://blockstream.info/api/block/{block_hash}/txs`
        *   Umpan Transaksi Mempool: `GET https://blockstream.info/api/mempool/recent`
    *   **Autentisitas Data**: Data murni langsung dari node Bitcoin Core tanpa modifikasi atau agregasi buatan.

---

### B. Ethereum (ETH) & EVM Chains (BSC, Polygon, Arbitrum)
Untuk jaringan EVM, cara terbaik untuk menghindari API Key (seperti Etherscan/BscScan yang membutuhkan pendaftaran) adalah menggunakan **Public JSON-RPC Nodes** resmi. Anda dapat langsung mengirimkan payload HTTP POST standar menggunakan pustaka seperti `ethers.js` atau `viem`.

1.  **Public JSON-RPC Endpoints (Tanpa API Key)**
    *   **Ethereum Mainnet RPC**:
        *   `https://cloudflare-eth.com` (Dikelola oleh Cloudflare)
        *   `https://ethereum-rpc.publicnode.com`
        *   `https://rpc.ankr.com/eth` (Gratis dengan rate limit wajar)
    *   **BNB Smart Chain (BSC) RPC**:
        *   `https://bsc-dataseed.binance.org/` (RPC Resmi Binance)
        *   `https://bsc-rpc.publicnode.com`
    *   **Metode Pemanggilan (JSON-RPC 2.0)**:
        Untuk memantau transaksi real-time, kita bisa memanggil block terbaru dan mengurai transaksi di dalamnya:
        ```json
        // POST to RPC URL
        {
          "jsonrpc": "2.0",
          "method": "eth_getBlockByNumber",
          "params": ["latest", true],
          "id": 1
        }
        ```
        Setiap objek transaksi dalam respons JSON RPC ini dijamin memiliki parameter asli:
        *   `from`: Alamat pengirim asli yang menandatangani transaksi.
        *   `to`: Alamat penerima (kontrak pintar atau wallet personal).
        *   `value`: Nilai nominal dalam satuan Wei (bisa dikonversi langsung ke ETH/BNB).
        *   `input`: Payload data mentah (berguna untuk mendeteksi transfer token ERC-20/BEP-20 seperti USDT/USDC melalui pencarian signature `0xa9059cbb` untuk transfer).

---

### C. Solana (SOL)
Solana memiliki throughput yang sangat tinggi. Memantau seluruh ledger membutuhkan performa tinggi, namun RPC publik dapat digunakan untuk mengambil transaksi bernilai tinggi dari akun bursa terkenal atau blok terbaru.

1.  **Public Solana RPC Endpoints**
    *   **RPC Utama**: `https://api.mainnet-beta.solana.com`
    *   **Alternatif**: `https://solana-rpc.publicnode.com`
    *   **Metode Pemanggilan**:
        Gunakan SDK resmi `@solana/web3.js` atau HTTP POST langsung untuk mengambil blok terbaru atau riwayat tanda tangan akun spesifik (misal, cold wallet milik Binance/Coinbase):
        ```json
        {
          "jsonrpc": "2.0",
          "id": 1,
          "method": "getSignaturesForAddress",
          "params": [
            "DxGGo78gM5KAtn9h7rP7eNcaE4F32uGq7uM8y", // Contoh alamat wallet bursa
            {"limit": 20}
          ]
        }
        ```
        Setelah mendapatkan tanda tangan transaksi, panggil `getTransaction` untuk mengurai detail pengirim, penerima, dan perubahan saldo saldo token (SPL Token) secara akurat.

---

### D. TRON (TRX)
Tron adalah rumah bagi mayoritas transfer stablecoin USDT (TRC-20) ritel maupun institusional berskala global.

1.  **Public Trongrid / Tron HTTP API**
    *   **Endpoint Publik**: `https://api.trongrid.io` atau `https://api.trongrid.io/wallet`
    *   **Metode Pemanggilan**:
        Gunakan endpoint REST tanpa kunci untuk mendapatkan block terbaru atau daftar transaksi token TRC20:
        *   `POST https://api.trongrid.io/wallet/getnowblock`
        *   `POST https://api.trongrid.io/wallet/gettransactionbyid`
    *   **Verifikasi Keaslian**: Respon menyertakan tanda tangan kriptografis, alamat `owner_address` (pengirim) dalam format Hex/Base58, serta payload kontrak internal `TriggerSmartContract` yang memuat alamat tujuan asli.

---

## 🕷️ 3. Strategi Real-Time Web Scraping (Jika API Publik Terbatas)

Jika RPC publik mengalami pembatasan laju (*rate limit*) yang ketat saat jam sibuk pasar, kita dapat menerapkan teknik scraping cerdas secara real-time langsung dari UI visualizer publik.

### A. Arsitektur Scraper Menggunakan Node.js
Kita dapat menggunakan kombinasi pustaka backend yang efisien:
1.  **Axios / Node-Fetch + Cheerio**: Sangat cepat dan hemat sumber daya. Cocok untuk situs web statis atau yang merender HTML di server (SSR).
2.  **Puppeteer / Playwright (Headless Browser)**: Digunakan jika visualizer tujuan sangat bergantung pada rendering client-side (SPA) atau dilindungi oleh sistem anti-bot dasar (seperti Cloudflare Turnstile tingkat rendah).

### B. Target Situs & Strategi Scraping yang Aman

1.  **Mempool.space (Bitcoin)**
    *   **Pendekatan**: Mempool.space memiliki visualizer WebSocket yang dapat di-scrape tanpa batas. Kita dapat menghubungkan client WebSocket backend langsung ke:
        `wss://mempool.space/api/v1/ws`
        Ini memberikan aliran transaksi unconfirmed instan secara gratis tanpa autentikasi browser sama sekali.

2.  **Etherscan / BscScan (Ethereum / BSC)**
    *   **Situs**: `https://etherscan.io/txs` atau `https://bscscan.io/txs`
    *   **Tantangan**: Memiliki proteksi Cloudflare yang sangat ketat.
    *   **Solusi Scraping**: Hindari memukul halaman UI utama secara agresif. Sebagai gantinya, manfaatkan rotasi *User-Agent* dan proxy gratis, atau gunakan **Puppeteer-Extra dengan plugin Stealth** (`puppeteer-extra-plugin-stealth`) untuk mensimulasikan gerakan manusia, kemudian baca elemen tabel transaksi:
        *   Selector Hash: `a.myFnExpandVal`
        *   Selector Pengirim: `span.hash-tag` atau atribut `title` pada elemen alamat.
        *   Selector Penerima: Kolom "To" dengan class penunjuk arah.

3.  **Tronscan (TRON USDT)**
    *   **Situs**: `https://tronscan.org/#/transactions`
    *   **Strategi**: Tronscan merender data menggunakan API internal yang tidak membutuhkan kunci khusus untuk pembacaan publik berskala kecil. Kita dapat memantau jaringan dengan melakukan pemanggilan HTTP langsung ke API internal mereka (sering ditemukan dengan memeriksa tab Network di Developer Tools):
        `GET https://apilist.tronscanapi.com/api/transaction?sort=-timestamp&limit=20`

---

## 📊 4. Perbandingan Metode: RPC Publik vs. Web Scraping

| Kriteria | Public RPC Nodes (Tanpa Key) | Web Scraping (UI Explorers) |
| :--- | :--- | :--- |
| **Akurasi & Autentisitas** | 🥇 **100% Mutlak** (Langsung dari Ledger) | 🥈 **Tinggi** (Tergantung parse elemen DOM) |
| **Kecepatan / Latency** | ⚡ **Sangat Cepat** (Seketika saat block dicetak) | ⏱️ **Medium-Lambat** (Menunggu rendering UI) |
| **Ketahanan terhadap Perubahan** | 🛠️ **Sangat Stabil** (Spesifikasi protokol RPC tidak pernah berubah) | 💔 **Rentan Rusak** (Jika struktur HTML/CSS situs target berubah) |
| **Resiko Terblokir** | 🟢 **Rendah** (Hanya rate limit standar, bisa dirotasi antar RPC) | 🔴 **Tinggi** (Proteksi Cloudflare/WAF dapat memblokir IP server) |

---

## 🛠️ 5. Rekomendasi Blueprint Implementasi untuk Sistem Kita

Untuk mendapatkan terminal data *on-chain* yang paling tangguh, modern, dan andal selama fase riset dan pengembangan selanjutnya, kita disarankan untuk menerapkan arsitektur **Hybrid Multi-RPC Fallback**:

1.  **Primary Data Layer (EVM Chains)**: Menggunakan array RPC publik terpercaya (Cloudflare, Ankr, Publicnode) dengan mekanisme rotasi otomatis jika salah satu node lambat atau mengembalikan status error.
2.  **Primary Data Layer (Bitcoin)**: Menggunakan API gratis dari Mempool.space dengan fallback otomatis ke Blockstream.info.
3.  **Real-Time Push Stream**: Membangun backend daemon yang mendengarkan event transaksi baru secara real-time via koneksi WebSocket publik, menyaring transaksi di atas ambang batas tertentu (misal, nilai setara > $1M USD) secara akurat, dan mencocokkannya dengan label wallet bursa yang terverifikasi secara on-chain.

---

## 📈 6. Integrasi Metrik Pasar Derivatif & On-Chain ala Coinglass.com

Jika kita ingin meningkatkan fungsionalitas sistem kita ke tingkat berikutnya dengan menyajikan data ala **Coinglass**, kita perlu mengintegrasikan metrik pasar sekunder (derivatif/futures) yang digabungkan dengan data *on-chain* bursa. Ini akan memberikan wawasan mendalam tentang pergerakan harga (*price action*), penumpukan leverage, dan potensi pembalikan arah pasar (*market reversal*).

Berikut adalah metrik utama dari Coinglass yang sangat direkomendasikan untuk diterapkan di sistem kita, lengkap dengan analisis kegunaan dan **sumber API publik gratis tanpa membutuhkan API Key**:

### 1. Futures Open Interest (OI) & OI Change
*   **Apa itu?** Jumlah total nilai kontrak berjangka (futures) yang masih terbuka/aktif di berbagai bursa (Binance, OKX, Bybit). Peningkatan OI menunjukkan masuknya modal baru (tren menguat), sementara penurunan OI menunjukkan penutupan posisi massal (tren melemah).
*   **Mengapa Penting?** Ketika harga mendekati level resistensi utama dan OI melonjak ekstrem, hal ini menandakan risiko volatilitas tinggi karena posisi terleverage menumpuk.
*   **Sumber Data Gratis (Tanpa Key)**:
    *   **Binance Futures API**:
        `GET https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT`
    *   **OKX Rest API**:
        `GET https://www.okx.com/api/v5/market/open-interest?instId=BTC-USDT-SWAP`

### 2. Long vs Short Ratio (Sentimen Trader Terleverage)
*   **Apa itu?** Perbandingan persentase antara akun trader yang mengambil posisi Long (beli) dengan Short (jual). Coinglass menampilkannya dalam berbagai durasi waktu (5m, 15m, 1h, 4h, 24h) baik untuk seluruh akun maupun khusus Top Trader.
*   **Mengapa Penting?** Ini adalah indikator kontarian (*contrarian indicator*) yang sangat akurat. Jika rasio Long sangat tinggi (misal > 65% Long), pasar sering kali mengalami penurunan tiba-tiba untuk melikuidasi posisi long yang terlalu percaya diri (long squeeze).
*   **Sumber Data Gratis (Tanpa Key)**:
    *   **Binance Futures Data API**:
        `GET https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m`
    *   **Bybit Public API**:
        `GET https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=5m`

### 3. Data Likuidasi Real-Time (Liquidation Feed)
*   **Apa itu?** Rekaman instan ketika posisi perdagangan berleverage dipaksa tutup oleh bursa karena margin tidak mencukupi. Coinglass menyajikannya dalam bentuk nominal USD dan rasio Long vs Short yang terlikuidasi harian.
*   **Mengapa Penting?** Likuidasi besar-besaran adalah bahan bakar utama pergerakan harga ekstrem (*short/long squeeze*). Menyediakan feed likuidasi real-time akan memberi pengguna peringatan dini terjadinya kepanikan pasar.
*   **Sumber Data Gratis (Tanpa Key)**:
    *   **Binance Futures WebSocket Stream** (100% Real-time & Gratis):
        Kita bisa menghubungkan WebSocket backend kita langsung ke server publik Binance untuk mendengarkan order likuidasi paksa secara instan di pasar:
        `wss://fstream.binance.com/ws/!forceOrder@arr` atau `wss://fstream.binance.com/ws/btcusdt@forceOrder`
        Setiap kali ada trader terlikuidasi, bursa akan menyiarkan detail transaksi termasuk ukuran kontrak, harga, dan sisi posisi (BUY/SELL) secara terbuka.

### 4. Funding Rates (Biaya Pendanaan Kontrak Perpetual)
*   **Apa itu?** Biaya periodik yang dibayarkan antara trader Long dan Short setiap 8 jam sekali (atau 1 jam di beberapa bursa) untuk menjaga harga kontrak perpetual agar tetap selaras dengan harga spot.
*   **Mengapa Penting?** Nilai funding rate yang sangat positif menunjukkan keserakahan pasar (Long mendominasi), sedangkan nilai funding rate negatif menunjukkan ketakutan pasar (Short mendominasi).
*   **Sumber Data Gratis (Tanpa Key)**:
    *   **Binance Futures Premium Index API**:
        `GET https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT`
    *   **dYdX API (Bursa Desentralisasi)**:
        `GET https://api.dydx.exchange/v3/markets`

### 5. Exchange Flows & Reserve Balances (Arus Keluar-Masuk Koin)
*   **Apa itu?** Jumlah koin (BTC, ETH, Stablecoin) yang masuk atau keluar dari dompet bursa terpusat (CEX).
*   **Mengapa Penting?** Aliran masuk koin ke bursa (*Exchange Inflow*) menandakan niat untuk menjual (bearish), sedangkan aliran keluar (*Exchange Outflow*) menandakan niat untuk mengamankan aset di cold storage/akumulasi (bullish).
*   **Sumber Data Gratis (Tanpa Key)**:
    *   **Mekanisme On-chain Custom**: Kita bisa memindai transaksi on-chain real-time di jaringan EVM (via RPC publik kita) dan mencocokkan alamat penerima/pengirim dengan daftar alamat bursa terkenal (seperti Binance Cold/Hot Wallet, OKX Deposit, dsb) untuk menghitung arus kas masuk-keluar secara mandiri dan akurat tanpa bergantung pada penyedia berbayar seperti Glassnode atau CryptoQuant.

---

## 🗺️ 7. Kesimpulan & Roadmap Langkah Selanjutnya
Dengan menggabungkan data **transaksi on-chain murni** (dari Bagian 2 & 3) bersama **metrik derivatif real-time Binance/Bybit** (dari Bagian 6), sistem kita akan memiliki kapabilitas analisis pasar setara dengan terminal profesional tanpa bergantung pada API Key berbayar yang mahal.

*   **Fase 1 (Selesai)**: Mengosongkan data lama untuk persiapan arsitektur baru yang bersih.
*   **Fase 2**: Membangun module penarik data JSON-RPC untuk Binance Futures Open Interest, Long/Short Ratio, dan Funding Rates.
*   **Fase 3**: Mengintegrasikan koneksi WebSocket publik ke `fstream.binance.com` untuk menyiarkan alert likuidasi bernilai besar secara real-time ke UI kita.
*   **Fase 4**: Menggabungkan filter sentimen on-chain dengan data likuidasi untuk menciptakan AI Advisor yang sangat taktis dan tajam.
