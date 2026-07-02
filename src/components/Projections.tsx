import React, { useState, useMemo } from "react";
import Markdown from "react-markdown";
import { useGlobalStore } from "../store";
import { 
  TrendingUp, 
  Sparkles, 
  Download, 
  FileSpreadsheet, 
  HelpCircle,
  Clock,
  AlertTriangle,
  Lightbulb
} from "lucide-react";
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid,
  Legend
} from "recharts";
import { Asset } from "../types";
import { exportProjectCfaReport } from "../utils/pdfGenerator";

interface ProjectionsProps {
  assets: Asset[];
}

export default function Projections({ assets }: ProjectionsProps) {
  const { settings } = useGlobalStore();
  const [targetSymbol, setTargetSymbol] = useState("BTC");
  const [purchasePrice, setPurchasePrice] = useState("10000");
  const [holdingPeriod, setHoldingPeriod] = useState("5"); // years
  const [growthRate, setGrowthRate] = useState("12"); // CAGR %
  const [yieldRate, setYieldRate] = useState("3"); // annual dividend or staking yield %
  const [riskScenario, setRiskScenario] = useState<"Safe" | "Moderate" | "Aggressive">("Moderate");
  const [inflationRate, setInflationRate] = useState("4.0"); // annual inflation rate bias
  
  // AI analysis states
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [aiError, setAiError] = useState("");
  const [isAiFallback, setIsAiFallback] = useState(false);

  const selectedAsset = useMemo(() => {
    return assets.find(a => a.symbol === targetSymbol) || assets[0];
  }, [assets, targetSymbol]);

  // Set default buy price when changing assets
  const handleAssetChange = (symbol: string) => {
    setTargetSymbol(symbol);
    const asset = assets.find(a => a.symbol === symbol);
    if (asset) {
      setPurchasePrice(asset.price.toString());
      if (asset.category === "stock") {
        setYieldRate((asset.dividendYield || 0).toString());
      } else {
        setYieldRate("4"); // default crypto staking
      }
    }
  };

  // Format IDR Ratios
  const formatValue = (val: number, isCrypto: boolean) => {
    if (isCrypto) {
      return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  // Calculate annual projections
  const projectionData = useMemo(() => {
    const years = parseInt(holdingPeriod) || 3;
    const initialPrice = parseFloat(purchasePrice) || 100;
    const mainGrowth = (parseFloat(growthRate) || 8) / 100;
    const yieldYield = (parseFloat(yieldRate) || 0) / 100;
    const infl = (parseFloat(inflationRate) || 0) / 100;

    const data = [];
    let baseAccumulated = initialPrice;
    let optAccumulated = initialPrice;
    let pesAccumulated = initialPrice;
    let realAccumulated = initialPrice;

    // Volatility modifiers based on risk sensitivity setting
    let volatilityMod = 0.05;
    if (riskScenario === "Safe") volatilityMod = 0.03;
    if (riskScenario === "Aggressive") volatilityMod = 0.08;

    data.push({
      year: "Tahun 0",
      "Pessimistic Case": Math.round(initialPrice),
      "Base Case": Math.round(initialPrice),
      "Optimistic Case": Math.round(initialPrice),
      "Real Base Case (Adj)": Math.round(initialPrice)
    });

    for (let yr = 1; yr <= years; yr++) {
      // Base Case compounding (growth + yield reinvested)
      baseAccumulated = baseAccumulated * (1 + mainGrowth + yieldYield);
      
      // Real Base Case discounted by annual inflation rate
      realAccumulated = realAccumulated * (1 + mainGrowth + yieldYield - infl);

      // Optimistic Case compounding (growth is boosted, yield yields slightly higher)
      const optGrowth = mainGrowth + volatilityMod;
      optAccumulated = optAccumulated * (1 + optGrowth + yieldYield);

      // Pessimistic Case compounding (growth is sluggish, yield yields slightly lower)
      const pesGrowth = Math.max(0, mainGrowth - volatilityMod);
      pesAccumulated = pesAccumulated * (1 + pesGrowth + yieldYield);

      data.push({
        year: `Tahun ${yr}`,
        "Pessimistic Case": Math.round(pesAccumulated),
        "Base Case": Math.round(baseAccumulated),
        "Optimistic Case": Math.round(optAccumulated),
        "Real Base Case (Adj)": Math.round(realAccumulated)
      });
    }

    return data;
  }, [purchasePrice, holdingPeriod, growthRate, yieldRate, riskScenario, inflationRate]);

  // Calculations overview metrics
  const finalSummary = useMemo(() => {
    const baseFinal = projectionData[projectionData.length - 1]["Base Case"];
    const initial = parseFloat(purchasePrice) || 100;
    const absoluteGain = baseFinal - initial;
    const overallROI = (absoluteGain / initial) * 100;

    // Estimate 10% tax on capital gains
    const taxValue = Math.max(0, absoluteGain * (selectedAsset?.category === 'stock' ? 0.1 : 0.22)); 
    const netProfit = absoluteGain - taxValue;

    return {
      finalValue: baseFinal,
      grossProfit: absoluteGain,
      overallROI,
      estimatedTax: taxValue,
      netProfit,
      isCrypto: selectedAsset?.category === 'crypto'
    };
  }, [projectionData, purchasePrice, selectedAsset]);

  // Export report as CSV file
  const handleExportCSV = () => {
    let csvContent = `data:text/csv;charset=utf-8,`;
    csvContent += `FINANCIAL MODELING REPORT - ${selectedAsset?.symbol || 'ASSET'}\n`;
    csvContent += `Aset: ${selectedAsset?.name || 'Asset'}\n`;
    csvContent += `Tingkat Toleransi Risiko: ${riskScenario}\n`;
    csvContent += `Asumsi CAGR: ${growthRate}%\n`;
    csvContent += `Asumsi DividendYield: ${yieldRate}%\n\n`;
    csvContent += `Tahun,Pessimistic Case,Base Case,Optimistic Case\n`;

    projectionData.forEach(row => {
      csvContent += `${row.year},${row["Pessimistic Case"]},${row["Base Case"]},${row["Optimistic Case"]}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Proyeksi_Finansial_${selectedAsset?.symbol || 'Aset'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export report as formatted diagnostic print/PDF simulation
  const handleExportPDF = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup terblokir oleh browser Anda. Harap berikan izin popup agar dapat mencetak dokumen PDF.");
      return;
    }
    
    const isCrypto = selectedAsset?.category === 'crypto';
    const htmlReport = `
      <html>
        <head>
          <title>Laporan Pemodelan Finansial - ${selectedAsset?.symbol}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
            h1 { color: #0d9488; }
            .header { border-bottom: 2px solid #0d9488; padding-bottom: 15px; margin-bottom: 30px; }
            .stats { display: flex; gap: 20px; margin-bottom: 30px; }
            .stat-card { flex: 1; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
            th { background-color: #f1f5f9; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>FINANCIAL MODELING REPORT</h1>
            <h3>Aset Terdaftar: ${selectedAsset?.name} (${selectedAsset?.symbol})</h3>
            <p>Tanggal Cetak: ${new Date().toLocaleDateString("id-ID")} | Toleransi Risiko: ${riskScenario}</p>
          </div>
          <div class="stats">
            <div class="stat-card">
              <strong>Harga Pembelian Awal</strong>
              <p>${isCrypto ? '$' + parseFloat(purchasePrice).toLocaleString() : 'Rp ' + parseFloat(purchasePrice).toLocaleString()}</p>
            </div>
            <div class="stat-card">
              <strong>Estimasi Hasil Akhir (Base Case)</strong>
              <p>${isCrypto ? '$' + finalSummary.finalValue.toLocaleString() : 'Rp ' + finalSummary.finalValue.toLocaleString()}</p>
            </div>
            <div class="stat-card">
              <strong>Net ROI Setelah Pajak</strong>
              <p>${((finalSummary.netProfit / (parseFloat(purchasePrice) || 1)) * 100).toFixed(2)}%</p>
            </div>
          </div>
          <h3>Tabel Proyeksi Multi-Tahun</h3>
          <table>
            <thead>
              <tr>
                <th>Tahun</th>
                <th>Pessimistic Case</th>
                <th>Base Case</th>
                <th>Optimistic Case</th>
              </tr>
            </thead>
            <tbody>
              ${projectionData.map(row => `
                <tr>
                  <td>${row.year}</td>
                  <td>${isCrypto ? '$' + row["Pessimistic Case"].toLocaleString() : 'Rp ' + row["Pessimistic Case"].toLocaleString()}</td>
                  <td>${isCrypto ? '$' + row["Base Case"].toLocaleString() : 'Rp ' + row["Base Case"].toLocaleString()}</td>
                  <td>${isCrypto ? '$' + row["Optimistic Case"].toLocaleString() : 'Rp ' + row["Optimistic Case"].toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <p style="margin-top: 40px; font-size: 11px; color: #64748b;">Dibuat secara profesional menggunakan Financial Modelling & Strategy Suite.</p>
          <script>window.print();</script>
        </body>
      </html>
    `;
    printWindow.document.write(htmlReport);
    printWindow.document.close();
  };

  const handleExportCfaReportPDF = () => {
    if (!aiAnalysis) return;
    const netProfitFormatted = formatValue(finalSummary.netProfit, finalSummary.isCrypto);
    const roiFormatted = `${((finalSummary.netProfit / (parseFloat(purchasePrice) || 1)) * 100).toFixed(2)}%`; // ROI percentage = net profit / purchase price * 100
    
    exportProjectCfaReport(
      aiAnalysis,
      selectedAsset,
      riskScenario,
      purchasePrice,
      finalSummary.finalValue,
      holdingPeriod,
      growthRate,
      yieldRate,
      netProfitFormatted,
      roiFormatted
    );
  };


  // Run AI expert evaluation over the target projection settings
  const handleRequestAiAnalysis = async () => {
    setIsLoadingAi(true);
    setAiError("");
    setAiAnalysis("");
    setIsAiFallback(false);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (settings.geminiKey) {
        headers["X-Gemini-Key"] = settings.geminiKey;
      }

      const res = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "projection",
          aiTone: settings.aiTone,
          aiMaxTokens: settings.aiMaxTokens,
          aiTemperature: settings.aiTemperature,
          aiThinkingMode: settings.aiThinkingMode || "high",
          modelData: {
            asset: selectedAsset,
            purchasePrice: parseFloat(purchasePrice),
            targetPrice: finalSummary.finalValue,
            holdingPeriod: parseInt(holdingPeriod),
            growthRate: parseFloat(growthRate),
            yieldRate: parseFloat(yieldRate),
            riskScenario
          }
        })
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Format data tidak valid dari server (HTTP ${res.status}).`);
      }

      const data = await res.json();
      if (res.ok) {
        setAiAnalysis(data.analysis);
        setIsAiFallback(!!data.isFallback);
      } else {
        setAiError(data.error || "Gagal memperoleh analitis proyeksi dari server.");
      }
    } catch (err: any) {
      setAiError("Terjadi error koneksi server: " + err.message);
    } finally {
      setIsLoadingAi(false);
    }
  };

  return (
    <div className="space-y-6" id="projections-tab">
      {/* Title */}
      <div className="bg-[#0F172A] p-4 sm:p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-500" /> Proyeksi Keuntungan Finansial Otomatis
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Simulasi pertumbuhan modal majemuk dengan reinvestasi otomatis dan pemetaan sensitivitas risiko multi-skenario.
          </p>
        </div>
        
        {/* Export Buttons */}
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            onClick={handleExportCSV}
            id="export-csv-btn"
            className="bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs px-3.5 py-2 rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> Ekspor ke CSV
          </button>
          <button
            onClick={handleExportPDF}
            id="export-pdf-btn"
            className="bg-slate-800 hover:bg-slate-755 text-slate-200 text-xs px-3.5 py-2 rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-red-400" /> Buat PDF / Cetak
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Side Controls Form */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
          <h3 className="text-sm sm:text-md font-bold text-slate-200">Parameter Model Finansial</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-404 text-slate-400 font-semibold uppercase font-mono mb-1.5">PILIH ASET UTAMA</label>
              <select
                value={targetSymbol}
                onChange={(e) => handleAssetChange(e.target.value)}
                id="proj-asset-select"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.symbol}>
                    {asset.symbol} - {asset.name} ({asset.category === 'stock' ? 'Saham' : 'Crypto'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">
                HARGA BELI AWAL ({finalSummary.isCrypto ? "USD" : "IDR"})
              </label>
              <input
                type="number"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                id="proj-price-input"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-35">
              <div>
                <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">CAGR TARGET (%)</label>
                <input
                  type="number"
                  value={growthRate}
                  onChange={(e) => setGrowthRate(e.target.value)}
                  id="proj-cagr-input"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">YIELD / STAKING (%)</label>
                <input
                  type="number"
                  value={yieldRate}
                  onChange={(e) => setYieldRate(e.target.value)}
                  id="proj-yield-input"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">TEMPO (TAHUN)</label>
                <select
                  value={holdingPeriod}
                  onChange={(e) => setHoldingPeriod(e.target.value)}
                  id="proj-period-select"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250"
                >
                  {[3, 5, 7, 10, 15].map(v => (
                    <option key={v} value={v.toString()}>{v} Tahun</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">BUFFER VOLATILITAS</label>
                <select
                  value={riskScenario}
                  onChange={(e) => setRiskScenario(e.target.value as any)}
                  id="proj-risk-select"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-250 animate-pulse"
                >
                  <option value="Safe">Konservatif (Aman)</option>
                  <option value="Moderate">Moderat</option>
                  <option value="Aggressive">Agresif (Tinggi)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">ASUMSI INFLASI TAHUNAN (%)</label>
              <div className="flex items-center space-x-3">
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={inflationRate}
                  onChange={(e) => setInflationRate(e.target.value)}
                  id="proj-inflation-slider"
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <span className="text-xs font-mono font-bold text-slate-200 w-10 shrink-0">{inflationRate}%</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1.5 block">
                Mengevaluasi daya beli riil portofolio dengan menyelisihkan laju inflasi majemuk tahunan.
              </span>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <button
              onClick={handleRequestAiAnalysis}
              id="analyze-proj-btn"
              disabled={isLoadingAi}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-blue-900/20"
            >
              {isLoadingAi ? (
                <>
                  <div className="w-4.5 h-4.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Mengevaluasi Variabel Proyeksi...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-white" />
                  <span>Analisis Finansial Model (AI)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right main column with forecast table & Compound Interest Charts curves */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Compound area chart curve */}
          <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm sm:text-md font-bold text-slate-200">Kurva Pertumbuhan Proyeksi Multi-Skenario</h4>
                <p className="text-xs text-slate-400">Pessimistic vs Base vs Optimistic dalam rentang {holdingPeriod} tahun berkelanjutan</p>
              </div>
              <span className="text-[10px] bg-slate-800 text-blue-400 px-2 py-0.5 rounded font-mono">Majemuk</span>
            </div>

            <div className="h-64 mt-2">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart data={projectionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="year" stroke="#475569" fontSize={11} />
                  <YAxis 
                    stroke="#475569" 
                    fontSize={10} 
                    tickFormatter={(v) => finalSummary.isCrypto ? `$${v.toLocaleString()}` : `Rp ${(v / 1e3).toFixed(0)}rb`} 
                  />
                  <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                  <Legend fontSize={10} wrapperStyle={{ color: '#ffffff' }} />
                  <Line type="monotone" dataKey="Pessimistic Case" stroke="#ef4444" strokeWidth={1.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Real Base Case (Adj)" stroke="#f59e0b" strokeWidth={2.0} strokeDasharray="3 3" dot={{ r: 3.5 }} />
                  <Line type="monotone" dataKey="Base Case" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="Optimistic Case" stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Core numerical performance summary and AI insights panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Compound metrics list card */}
            <div className="bg-[#0F172A] border border-slate-800 p-4 sm:p-5 rounded-xl space-y-3.5">
              <h5 className="text-sm font-bold text-slate-300 font-mono tracking-wider">REKAP MODEL PROYEKSI BASE-CASE</h5>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs border-b border-slate-850 pb-1.5 gap-2">
                  <span className="text-slate-400">Total Modal Ditargetkan :</span>
                  <span className="text-slate-200 font-mono font-bold shrink-0 text-right">
                    {formatValue(finalSummary.finalValue, finalSummary.isCrypto)}
                  </span>
                </div>
                
                <div className="flex items-center justify-between text-xs border-b border-slate-850 pb-1.5 gap-2">
                  <span className="text-slate-400">Estimasi Keuntungan Kotor :</span>
                  <span className="text-emerald-400 font-mono font-bold shrink-0 text-right">
                    +{formatValue(finalSummary.grossProfit, finalSummary.isCrypto)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs border-b border-slate-850 pb-1.5 gap-2">
                  <span className="text-slate-400">Estimasi Pajak / Biaya (Rata) :</span>
                  <span className="text-rose-400 font-mono font-bold shrink-0 text-right">
                    -{formatValue(finalSummary.estimatedTax, finalSummary.isCrypto)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs pt-0.5 gap-2">
                  <span className="text-slate-300 font-semibold">Keuntungan Bersih Setelah Pajak :</span>
                  <span className="text-blue-400 font-mono font-bold shrink-0 text-right">
                    {formatValue(finalSummary.netProfit, finalSummary.isCrypto)}
                  </span>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded border border-slate-850 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-400 shrink-0" />
                <p className="text-[10px] text-slate-400">
                  <span className="text-slate-200 font-semibold block">Saran Diversifikasi :</span>
                  {finalSummary.isCrypto 
                    ? "Crypto idealnya tidak melampaui 30% dari keseluruhan aset untuk memitigasi drawdowns parah." 
                    : "Asumsi dividen diestimasi stabil berkala. Pertimbangkan reinvestasi secara otomatis (DRIP) demi memaksimalkan keuntungan majemuk."}
                </p>
              </div>
            </div>

            {/* AI Advisor Response display Panel */}
            <div className="bg-[#0F172A] border border-slate-800 p-4 sm:p-5 rounded-xl flex flex-col justify-between gap-4">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2 mb-2">
                  <h5 className="text-sm font-bold text-slate-200 font-mono tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-blue-400" /> OPINI KEUANGAN AI (CFA)
                  </h5>
                  {aiAnalysis && (
                    <button
                      onClick={handleExportCfaReportPDF}
                      id="export-cfa-proj-pdf"
                      className="bg-slate-900 hover:bg-slate-800 hover:text-slate-100 text-slate-300 text-[10px] px-2.5 py-1 rounded border border-slate-700 font-sans font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Download className="w-3 h-3 text-red-400" /> Ekspor PDF CFA
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">Model dievaluasi komprehensif oleh asisten bersertifikasi CFA.</p>
              </div>

              <div className="bg-slate-950 rounded-lg p-4 border border-slate-850/80 max-h-[220px] overflow-y-auto font-sans">
                {aiAnalysis ? (
                  <div className="prose prose-invert prose-xs text-xs text-slate-300">
                    {isAiFallback && (
                      <div className="mb-3 p-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded flex items-start gap-1.5 text-[10px]">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                        <div>
                          <strong className="font-bold">Mode Pengamat Finansial Lokal Aktif:</strong> Kuota API gratis Gemini Anda sedang penuh harian. Expert system CFA lokal kami otomatis menganalisis profitabilitas model proyeksi dan menyusun laporan taktis ini.
                        </div>
                      </div>
                    )}
                    <div className="markdown-body text-[11px] leading-relaxed">
                      <Markdown>{aiAnalysis}</Markdown>
                    </div>
                  </div>
                ) : aiError ? (
                  <div className="text-xs text-rose-400">
                    <AlertTriangle className="w-4 h-4 inline-block mr-1" />
                    {aiError}
                  </div>
                ) : (
                  <div className="text-center text-slate-500 text-xs py-8">
                    Silakan klik tombol <span className="text-blue-400 font-semibold px-1 font-mono hover:underline">"Analisis Finansial Model"</span> di kolom parameter untuk merumuskan telaah khusus AI secara langsung.
                  </div>
                )}
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
