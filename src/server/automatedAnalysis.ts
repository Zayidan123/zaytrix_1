// =============================================================================
// automatedAnalysis.ts — QA9-R3: periodic automated Gemini analysis of
// on-chain + derivatives data (10-min interval, boot-delayed run) and its
// endpoints /api/gemini/automated-analysis (+ /trigger). Extracted verbatim
// from server.ts (was 3635-3877). MUST be registered AFTER
// registerGeminiRoutes so the /api/gemini requireAuth gate applies first.
// =============================================================================
import fs from "fs";
import path from "path";
import type { Express } from "express";
import { requireAuth } from "./auth";
import { liveAssets } from "./assetsStore";
import { fetchLatestOnChainData } from "./onchainStore";
import { generateDynamicOnChainFallback } from "./geminiRoutes";
import {
  ai,
  geminiCacheSet,
  getCacheKey,
  sanitizePromptInput,
  generateContentWithRetry,
  getAiClient,
  mapThinkingLevel,
} from "./geminiHelpers";
import { createLogger } from "./logger";

const log = createLogger("automatedAnalysis");





export function registerAutomatedAnalysisRoutes(app: Express): void {
// --- PERIODIC AUTOMATED GEMINI ANALYSIS FOR ON-CHAIN & DERIVATIVES ---
let isAnalysisRunning = false;

async function runAutomatedGeminiAnalysis() {
  if (isAnalysisRunning) {
    log.info("[Background AI Analysis] Analysis is already running, skipping this interval.");
    return;
  }
  isAnalysisRunning = true;
  log.info("[Background AI Analysis] Running periodic automated on-chain & derivatives market analysis...");

  try {
    const onchainData = await fetchLatestOnChainData();

    // DATA-9: every metric below is included ONLY if it was actually fetched
    // successfully in THIS run. The old fabricated defaults (btcPrice 95230,
    // change 1.42, OI 1.45B, funding 0.015, L/S 1.42, inflow/outflow
    // $120M/$180M, random activeAddresses 890k±20k, hashrate 615±7, and the
    // invented $12.5M liquidation24h) were removed entirely.
    const metrics: any = {};
    const metricLines: string[] = [];
    const missing: string[] = [];

    const btcPrice = onchainData.btcPrice;
    const btcChange = onchainData.btcPriceChangePercent;
    const priceIsReal = onchainData.isStale !== true;
    if (priceIsReal && typeof btcPrice === "number" && isFinite(btcPrice)) {
      metrics.price = btcPrice;
      if (typeof btcChange === "number" && isFinite(btcChange)) {
        metrics.change24h = btcChange;
        metricLines.push(`- Harga BTC: $${btcPrice.toLocaleString()} (${btcChange}% dalam 24 jam)`);
      } else {
        metricLines.push(`- Harga BTC: $${btcPrice.toLocaleString()}`);
        missing.push("perubahan harga 24 jam");
      }
    } else {
      missing.push("harga BTC (data upstream stale/tidak tersedia)");
    }

    // Fetch real derivative data from Binance fapi (null unless fetched OK).
    let openInterest: number | null = null;
    let fundingRate: number | null = null;
    let longShortRatio: number | null = null;

    try {
      const oiRes = await fetch("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT");
      if (oiRes.ok) {
        const oiData = await oiRes.json() as any;
        const oi = parseFloat(oiData?.openInterest);
        if (isFinite(oi)) openInterest = oi;
      }
    } catch (e: any) {
      log.info("[Background AI Analysis] Open Interest fetch handled:", e.message);
    }

    try {
      const premRes = await fetch("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT");
      if (premRes.ok) {
        const premData = await premRes.json() as any;
        const fr = parseFloat(premData?.lastFundingRate);
        if (isFinite(fr)) fundingRate = fr * 100;
      }
    } catch (e: any) {
      log.info("[Background AI Analysis] Funding Rate fetch handled:", e.message);
    }

    try {
      const lsRes = await fetch("https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m");
      if (lsRes.ok) {
        const lsData = await lsRes.json() as any;
        if (Array.isArray(lsData) && lsData.length > 0) {
          const ls = parseFloat(lsData[lsData.length - 1].longShortRatio);
          if (isFinite(ls)) longShortRatio = ls;
        }
      }
    } catch (e: any) {
      log.info("[Background AI Analysis] Long/Short ratio fetch handled:", e.message);
    }

    if (openInterest != null) {
      metrics.openInterest = openInterest;
      metricLines.push(`- Open Interest (OI) Berjangka Binance: ${openInterest.toLocaleString()} BTC`);
    } else {
      missing.push("Open Interest");
    }
    if (fundingRate != null) {
      metrics.fundingRate = fundingRate;
      metricLines.push(`- Funding Rate Harian Binance: ${fundingRate.toFixed(4)}%`);
    } else {
      missing.push("Funding Rate");
    }
    if (longShortRatio != null) {
      metrics.longShortRatio = longShortRatio;
      metricLines.push(`- Rasio Long/Short Teratas: ${longShortRatio.toFixed(2)}`);
    } else {
      missing.push("Rasio Long/Short");
    }

    // Real exchange flows derived from the transactions actually processed in
    // this run (no $120M/$180M invented defaults anymore).
    let inflow24h: number | null = null;
    let outflow24h: number | null = null;
    if (onchainData.processedTxs && Array.isArray(onchainData.processedTxs) && onchainData.processedTxs.length > 0) {
      let btcInflow = 0;
      let btcOutflow = 0;
      onchainData.processedTxs.forEach((tx: any) => {
        if (tx.coin === "BTC") {
          if (tx.direction === "Unknown to Exchange") btcInflow += tx.usdAmount;
          else if (tx.direction === "Exchange to Unknown") btcOutflow += tx.usdAmount;
        }
      });
      if (btcInflow > 0) inflow24h = btcInflow;
      if (btcOutflow > 0) outflow24h = btcOutflow;
    }
    if (inflow24h != null && outflow24h != null) {
      const netflow = inflow24h - outflow24h;
      metrics.inflow24h = inflow24h;
      metrics.outflow24h = outflow24h;
      metrics.netflow = netflow;
      metricLines.push(`- Inflow Transaksi ke Bursa (24j): $${(inflow24h / 1e6).toFixed(2)}M`);
      metricLines.push(`- Outflow Transaksi dari Bursa (24j): $${(outflow24h / 1e6).toFixed(2)}M`);
      metricLines.push(`- Netflow Bersih Bursa: $${(netflow / 1e6).toFixed(2)}M (${netflow < 0 ? "Akumulasi / Outflow Bersih" : "Tekanan Jual / Inflow Bersih"})`);
    } else {
      missing.push("inflow/outflow bursa 24 jam");
    }

    // activeAddresses / networkHashrate / liquidation24h: NO real source is
    // wired for these in this run — they are omitted entirely (previously
    // randomized/invented).

    const prompt = `
Lakukan analisis on-chain dan derivatif pasar otomatis komprehensif terhadap aset digital **BTC** (Bitcoin) menggunakan data metrik terbaru berikut (HANYA metrik yang berhasil diambil pada run ini):

DATA METRIK TERSEDIA:
${metricLines.length > 0 ? metricLines.join("\n") : "(tidak ada metrik yang berhasil diambil pada run ini)"}
${missing.length > 0 ? `\nCATATAN PENTING: sebagian metrik tidak tersedia pada run ini (${missing.join(", ")}). JANGAN mengarang angka untuk metrik yang tidak tersedia — cukup nyatakan bahwa metrik tersebut tidak tersedia.` : ""}

TOLONG MERUMUSKAN EVALUASI ANALISIS METRIK PASAR DAN DERIVATIF OTOMATIS TERBARU DALAM FORMAT BERIKUT (Gunakan Markdown Indonesia yang sangat rapi):

### 🔮 RINGKASAN SIGNAL PASAR & DETEKSI SHIFT INSTITUSI
Berikan ringkasan eksekutif tajam tentang kondisi pasar saat ini berdasarkan metrik yang tersedia di atas (aliran dana bursa, data leverage). Jika metrik kunci tidak tersedia, nyatakan secara eksplisit.

### ⚡ SENTIMEN DERIVATIF & ANALISIS STRUKTUR LEVERAGE
Ulas posisi leverage saat ini berdasarkan metrik derivatif yang tersedia (Open Interest, Funding Rate, Rasio Long/Short). Apakah pasar rentan terhadap "Long Squeeze" atau "Short Squeeze"?

### 📊 EVALUASI KESEHATAN DAN ADOPSI ON-CHAIN
Evaluasi berdasarkan data yang tersedia. Nyatakan dengan jelas jika data aktivitas on-chain (alamat aktif, hashrate) tidak tersedia pada run ini.

### 🎯 REKOMENDASI TRADING TAKTIS (BUY/SELL/HOLD)
Tentukan keputusan kuantitatif yang dingin berdasarkan data yang tersedia saja:
- **REKOMENDASI AKHIR**: [BELI / JUAL / TAHAN]
- **Tingkat Keyakinan AI**: ...%
- **Rencana Skenario**: Berikan target taktis jika terjadi pengosongan leverage (flushout) jangka pendek.

Tulis dengan gaya bahasa Indonesia profesional tingkat tinggi, berwibawa, dingin, saksama, obyektif, bebas omong kosong, dan memberikan nilai taktis tinggi untuk investor profesional.
`;

    let analysisText = "";
    let isFallback = false;

    if (ai) {
      try {
        const response = await generateContentWithRetry(ai, {
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            temperature: 0.15,
            maxOutputTokens: 1200,
            systemInstruction: "Anda adalah asisten AI Analis Kuantitatif Senior & Spesialis Data On-chain. Analisis Anda harus super tajam, taktis, dingin, objektif, dan diakhiri dengan rekomendasi posisi yang lugas. Jangan pernah mengarang angka untuk metrik yang tidak tersedia."
          }
        });
        analysisText = response.text;
      } catch (geminiErr: any) {
        log.info("[Background AI Analysis] Gemini API status (using fallback):", geminiErr.message);
        isFallback = true;
        analysisText = generateDynamicOnChainFallback("BTC", metrics);
      }
    } else {
      isFallback = true;
      analysisText = generateDynamicOnChainFallback("BTC", metrics);
    }

    const automatedResult = {
      timestamp: new Date().toISOString(),
      symbol: "BTC",
      analysis: analysisText,
      isFallback,
      // DATA-9: metrics object contains ONLY the values actually fetched in
      // this run; missing ones are simply absent (not fabricated).
      metrics
    };

    fs.writeFileSync(path.join(process.cwd(), "automated-analysis.json"), JSON.stringify(automatedResult, null, 2), "utf-8");
    log.info("[Background AI Analysis] Periodic automated market analysis completed successfully and saved.");
  } catch (err: any) {
    log.info("[Background AI Analysis] Worker execution status:", err.message);
  } finally {
    isAnalysisRunning = false;
  }
}

// REST endpoints for accessing and triggering the periodic AI analysis
app.get("/api/gemini/automated-analysis", (req, res) => {
  try {
    const filePath = path.join(process.cwd(), "automated-analysis.json");
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      return res.json({ success: true, ...JSON.parse(data) });
    } else {
      return res.status(404).json({ success: false, error: "Automated analysis not generated yet." });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/gemini/automated-analysis/trigger", async (req, res) => {
  try {
    await runAutomatedGeminiAnalysis();
    const filePath = path.join(process.cwd(), "automated-analysis.json");
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      return res.json({ success: true, triggered: true, ...JSON.parse(data) });
    }
    return res.json({ success: true, triggered: true, message: "Analysis started in background." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Setup initialization and intervals for automated AI analysis
setTimeout(() => {
  runAutomatedGeminiAnalysis().catch(err => {
    log.info("[Background AI Analysis] Boot run status:", err.message);
  });
}, 10000); // 10s boot delay

setInterval(() => {
  runAutomatedGeminiAnalysis().catch(err => {
    log.info("[Background AI Analysis] Interval run status:", err.message);
  });
}, 600000); // every 10 minutes

} // end registerAutomatedAnalysisRoutes

