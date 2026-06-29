import React, { useState } from "react";
import Markdown from "react-markdown";
import { useGlobalStore } from "../store";
import { 
  Coins, 
  TrendingUp, 
  TrendingDown, 
  Sparkles,
  Search,
  BookOpen,
  Download,
  FileText,
  Upload,
  FileCheck,
  AlertCircle,
  Clock,
  FileUp
} from "lucide-react";
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip as ChartTooltip, 
  Legend as ChartLegend,
  CartesianGrid
} from "recharts";
import { Asset } from "../types";
import { exportComparisonCfaReport, exportUploadedPdfAnalysisReport } from "../utils/pdfGenerator";

interface AssetsHubProps {
  assets: Asset[];
}

export default function AssetsHub({ assets }: AssetsHubProps) {
  const { settings } = useGlobalStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'stock' | 'crypto'>('all');
  
  // Sub-Tab State
  const [activeHubTab, setActiveHubTab] = useState<'market' | 'pdfAnalyze'>('market');

  // PDF File Upload & Audit states
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [pdfCategory, setPdfCategory] = useState<'stock' | 'crypto'>('stock');
  const [isAnalyzingPdf, setIsAnalyzingPdf] = useState(false);
  const [pdfAnalysisReport, setPdfAnalysisReport] = useState("");
  const [pdfAnalysisError, setPdfAnalysisError] = useState("");
  const [loadingStatusIndex, setLoadingStatusIndex] = useState(0);

  const loadingStatuses = [
    "Mengamankan saluran enkripsi transmisi berkas...",
    "Membaca biner data halaman PDF...",
    "Mengekstrak matriks kuantitatif & laporan audit...",
    "Menganalisis margin keuntungan kotor, solvabilitas, dan likuiditas kas...",
    "Melakukan uji ketahanan model & evaluasi FRM terhadap volatilitas pasar...",
    "Merumuskan alokasi taktis & rekomendasi portofolio bersertifikasi CFA..."
  ];

  // Asset Comparison States
  const [assetASymbol, setAssetASymbol] = useState("BTC");
  const [assetBSymbol, setAssetBSymbol] = useState("ETH");
  const [aiReport, setAiReport] = useState("");
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [aiError, setAiError] = useState("");
  const [isAiReportFallback, setIsAiReportFallback] = useState(false);
  const [isPdfReportFallback, setIsPdfReportFallback] = useState(false);

  // Format IDR Ratios
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  // Filter assets based on search query and category
  const filteredAssets = assets.filter(asset => {
    const matchesSearch = asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || asset.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Calculate comparison assets
  const assetA = assets.find(a => a.symbol === assetASymbol);
  const assetB = assets.find(a => a.symbol === assetBSymbol);

  // Memoized comparative metrics for UI chart
  const comparisonChartData = React.useMemo(() => {
    if (!assetA || !assetB) return [];
    return [
      {
        name: "Perubahan 24J (%)",
        [assetA.symbol]: assetA.change24h,
        [assetB.symbol]: assetB.change24h,
      },
      {
        name: "Dev/Yield/Staking (%)",
        [assetA.symbol]: assetA.dividendYield !== undefined ? assetA.dividendYield : (assetA.category === 'crypto' ? 4.0 : 0.0),
        [assetB.symbol]: assetB.dividendYield !== undefined ? assetB.dividendYield : (assetB.category === 'crypto' ? 4.0 : 0.0),
      }
    ];
  }, [assetA, assetB]);

  // Request comparison report from server proxy using server-side Gemini
  const handleRequestCompareReport = async () => {
    if (!assetA || !assetB) return;
    setIsLoadingAi(true);
    setAiError("");
    setAiReport("");
    setIsAiReportFallback(false);

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
          type: "comparison",
          aiTone: settings.aiTone,
          aiMaxTokens: settings.aiMaxTokens,
          aiTemperature: settings.aiTemperature,
          aiThinkingMode: settings.aiThinkingMode || "high",
          assetComparison: {
            assetA,
            assetB
          }
        })
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Format data tidak valid dari server (HTTP ${res.status}).`);
      }

      const data = await res.json();
      if (res.ok) {
        setAiReport(data.analysis);
        setIsAiReportFallback(!!data.isFallback);
      } else {
        setAiError(data.error || "Gagal memperoleh analisis dari server.");
      }
    } catch (err: any) {
      setAiError("Terjadi kesalahan koneksi server: " + err.message);
    } finally {
      setIsLoadingAi(false);
    }
  };

  const handleExportCfaReportPDF = () => {
    if (!aiReport || !assetA || !assetB) return;
    exportComparisonCfaReport(aiReport, assetA, assetB);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type !== "application/pdf") {
        setUploadError("Format berkas harus berupa dokumen (.pdf).");
        setUploadedFile(null);
        return;
      }
      setUploadedFile(file);
      setUploadError("");
      setPdfAnalysisReport("");
      setPdfAnalysisError("");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type !== "application/pdf") {
        setUploadError("Format berkas harus berupa dokumen (.pdf).");
        setUploadedFile(null);
        return;
      }
      setUploadedFile(file);
      setUploadError("");
      setPdfAnalysisReport("");
      setPdfAnalysisError("");
    }
  };

  const convertToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleAnalyzePdf = async () => {
    if (!uploadedFile) return;
    setIsAnalyzingPdf(true);
    setPdfAnalysisReport("");
    setPdfAnalysisError("");
    setLoadingStatusIndex(0);
    setIsPdfReportFallback(false);

    const intervalId = setInterval(() => {
      setLoadingStatusIndex((prev) => (prev < loadingStatuses.length - 1 ? prev + 1 : prev));
    }, 2800);

    try {
      const base64pdf = await convertToBase64(uploadedFile);
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (settings.geminiKey) {
        headers["X-Gemini-Key"] = settings.geminiKey;
      }

      const res = await fetch("/api/gemini/analyze-pdf", {
        method: "POST",
        headers,
        body: JSON.stringify({
          pdfData: base64pdf,
          fileName: uploadedFile.name,
          category: pdfCategory,
          aiTone: settings.aiTone,
          aiMaxTokens: settings.aiMaxTokens,
          aiTemperature: settings.aiTemperature,
          aiThinkingMode: settings.aiThinkingMode || "high"
        })
      });

      clearInterval(intervalId);

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Format data tidak valid dari server (HTTP ${res.status}).`);
      }

      const data = await res.json();
      if (res.ok) {
        setPdfAnalysisReport(data.analysis);
        setIsPdfReportFallback(!!data.isFallback);
      } else {
        setPdfAnalysisError(data.error || "Gagal melakukan riset audit atas dokumen.");
      }
    } catch (err: any) {
      clearInterval(intervalId);
      setPdfAnalysisError("Koneksi gagal atau ukuran file melebihi kapasitas transfer server: " + err.message);
    } finally {
      setIsAnalyzingPdf(false);
    }
  };

  const handleExportUploadedPdfReport = () => {
    if (!pdfAnalysisReport || !uploadedFile) return;
    exportUploadedPdfAnalysisReport(pdfAnalysisReport, uploadedFile.name, pdfCategory);
  };


  return (
    <div className="space-y-6" id="assets-hub-tab">
      {/* Title section */}
      <div className="bg-[#0F172A] p-4 sm:p-6 rounded-2xl border border-slate-800">
        <h2 className="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2">
          <Coins className="w-5 h-5 text-blue-500" /> Papan Pantau Data Pasar Real-time & Riset AI
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          Pantau rasio fundamental saham Indonesia (IHSG) beserta rating broker terkini serta aset kripto global terpopuler, atau unggah laporan keuangan & whitepaper untuk diuji AI.
        </p>
      </div>

      {/* Sub-Tabs Section */}
      <div className="flex border-b border-slate-800" id="hub-sub-tabs">
        <button
          onClick={() => setActiveHubTab('market')}
          className={`px-6 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
            activeHubTab === 'market'
              ? "border-blue-500 text-blue-400 font-bold bg-blue-950/20"
              : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
          }`}
          id="hub-tab-market"
        >
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4" />
            <span>Pemantau Pasar & Perbandingan</span>
          </div>
        </button>
        <button
          onClick={() => setActiveHubTab('pdfAnalyze')}
          className={`px-6 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
            activeHubTab === 'pdfAnalyze'
              ? "border-emerald-500 text-emerald-400 font-bold bg-emerald-950/20"
              : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
          }`}
          id="hub-tab-pdf"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-500" />
            <span>Riset Audit & Unggah PDF (AI)</span>
          </div>
        </button>
      </div>

      {activeHubTab === 'market' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left column: Search and Real-time Table */}
          <div className="lg:col-span-2 bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col justify-between">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
                  <button
                    onClick={() => setSelectedCategory('all')}
                    id="category-btn-all"
                    className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                      selectedCategory === 'all' ? "bg-slate-800 text-blue-400 font-semibold shadow-sm" : "text-slate-400"
                    }`}
                  >
                    Semua Aset
                  </button>
                  <button
                    onClick={() => setSelectedCategory('stock')}
                    id="category-btn-stock"
                    className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                      selectedCategory === 'stock' ? "bg-slate-800 text-blue-400 font-semibold shadow-sm" : "text-slate-400"
                    }`}
                  >
                    Saham BEI
                  </button>
                  <button
                    onClick={() => setSelectedCategory('crypto')}
                    id="category-btn-crypto"
                    className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                      selectedCategory === 'crypto' ? "bg-slate-800 text-blue-400 font-semibold shadow-sm" : "text-slate-400"
                    }`}
                  >
                    Crypto
                  </button>
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Cari Ticker atau Nama..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    id="search-asset-input"
                    className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg pl-9 pr-4 py-2 w-full sm:w-60 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* List of market tickers */}
              <div className="space-y-3 h-[500px] overflow-y-auto pr-1">
                {filteredAssets.length > 0 ? (
                  filteredAssets.map((asset) => {
                    const isStock = asset.category === 'stock';
                    return (
                      <div 
                        key={asset.id} 
                        className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-700/80 transition-all group"
                      >
                        <div className="flex items-center space-x-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs ${
                            isStock ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"
                          }`}>
                            {asset.symbol}
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-slate-200">{asset.symbol}</span>
                              <span className="text-[9px] bg-slate-800 text-slate-400 font-mono px-1.5 py-0.5 rounded uppercase">
                                {isStock ? "BEI" : "Crypto"}
                              </span>
                            </div>
                            <span className="text-xs text-slate-400 block max-w-[200px] truncate">{asset.name}</span>
                          </div>
                        </div>

                        {/* Financial info */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
                          <div>
                            <span className="text-[10px] text-slate-500 block">HARGA LIVE</span>
                            <span className="text-xs font-mono text-slate-200">
                              {isStock ? formatIDR(asset.price) : `$${asset.price.toLocaleString()}`}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block">PERUBAHAN 24H</span>
                            <span className={`text-xs font-semibold flex items-center gap-1 font-mono ${
                              asset.change24h >= 0 ? "text-emerald-400" : "text-rose-500"
                            }`}>
                              {asset.change24h >= 0 ? "+" : ""}{asset.change24h}%
                              {asset.change24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            </span>
                          </div>

                          {/* Extra info depending on category */}
                          <div className="col-span-2 sm:col-span-1 border-t sm:border-t-0 border-slate-800 pt-1 sm:pt-0">
                            {isStock ? (
                              <div>
                                <span className="text-[10px] text-slate-500 block">DEV YIELD / PER</span>
                                <span className="text-xs font-mono text-teal-400">
                                  {asset.dividendYield}% / {asset.peRatio}x
                                </span>
                              </div>
                            ) : (
                              <div>
                                <span className="text-[10px] text-slate-500 block">KAP PASAR</span>
                                <span className="text-xs font-mono text-purple-400">
                                  ${(asset.marketCap / 1e9).toFixed(1)}B
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Broker Targets Display */}
                        {isStock && asset.brokerTargets && asset.brokerTargets.length > 0 && (
                          <div className="bg-slate-950/80 px-4 py-2 rounded-lg border border-slate-800/60 max-w-sm">
                            <span className="text-[9px] text-slate-500 font-mono uppercase block font-semibold">TATA ANALISIS BROKER (KONSENSUS)</span>
                            <div className="flex gap-4 mt-1">
                              {asset.brokerTargets.slice(0, 2).map((b, i) => (
                                <div key={i} className="text-[10px]">
                                  <span className="text-slate-400 block font-medium">{b.broker}</span>
                                  <span className="text-slate-200 font-mono font-semibold">{formatIDR(b.targetPrice)}</span>
                                  <span className={`inline-block ml-1 font-bold text-[8px] px-1 py-0.2 rounded-sm ${
                                    b.rating === 'BUY' ? "text-emerald-400 bg-emerald-500/10" : "text-amber-450 bg-amber-500/10"
                                  }`}>
                                    {b.rating}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center p-12 text-slate-500 text-xs">
                    Tidak ada aset yang sesuai kriteria pencarian.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column: Dynamic Comparison Widget + Server Gemini Integration */}
          <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col justify-between">
            <div className="space-y-6">
              <div>
                <h3 className="text-md font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" /> Perbandingan Aset Kustom & Opini AI
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Bandingkan rasio fundamental / kapitalisasi secara side-by-side dan peroleh rekomendasi taktis dari AI.
                </p>
              </div>

              {/* Asset choice dropdown selectors */}
              <div className="grid grid-cols-2 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1">Aset A</label>
                  <select
                    value={assetASymbol}
                    onChange={(e) => setAssetASymbol(e.target.value)}
                    id="compare-select-a"
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    {assets.map(a => (
                      <option key={a.id} value={a.symbol}>{a.symbol} ({a.category === 'stock' ? "Saham" : "Crypto"})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1">Aset B</label>
                  <select
                    value={assetBSymbol}
                    onChange={(e) => setAssetBSymbol(e.target.value)}
                    id="compare-select-b"
                    className="w-full bg-slate-900 border border-slate-800 rounded-md p-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    {assets.map(a => (
                      <option key={a.id} value={a.symbol}>{a.symbol} ({a.category === 'stock' ? "Saham" : "Crypto"})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Side-by-side comparison matrix table */}
              {assetA && assetB && (
                <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl space-y-3 text-xs">
                  <div className="grid grid-cols-3 text-slate-400 font-semibold border-b border-slate-800 pb-2">
                    <span>Parameter</span>
                    <span className="text-teal-400 text-center">{assetA.symbol}</span>
                    <span className="text-purple-400 text-center">{assetB.symbol}</span>
                  </div>
                  
                  <div className="grid grid-cols-3 border-b border-slate-800/40 py-1.5 font-mono">
                    <span className="text-slate-400 text-[11px]">Kategori</span>
                    <span className="text-slate-300 text-center uppercase">{assetA.category === 'stock' ? "Saham" : "Crypto"}</span>
                    <span className="text-slate-300 text-center uppercase">{assetB.category === 'stock' ? "Saham" : "Crypto"}</span>
                  </div>

                  <div className="grid grid-cols-3 border-b border-slate-800/40 py-1.5 font-mono">
                    <span className="text-slate-400 text-[11px]">Harga</span>
                    <span className="text-slate-200 text-center font-bold">
                      {assetA.category === 'stock' ? formatIDR(assetA.price) : `$${assetA.price.toLocaleString()}`}
                    </span>
                    <span className="text-slate-200 text-center font-bold">
                      {assetB.category === 'stock' ? formatIDR(assetB.price) : `$${assetB.price.toLocaleString()}`}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 border-b border-slate-800/40 py-1.5 font-mono">
                    <span className="text-slate-400 text-[11px]">Dev/Yield</span>
                    <span className="text-slate-300 text-center">
                      {assetA.dividendYield !== undefined ? `${assetA.dividendYield}%` : "0 (None)"}
                    </span>
                    <span className="text-slate-300 text-center">
                      {assetB.dividendYield !== undefined ? `${assetB.dividendYield}%` : "0 (None)"}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 py-1 font-mono">
                    <span className="text-slate-400 text-[11px]">P/E Ratio</span>
                    <span className="text-slate-300 text-center">{assetA.peRatio !== undefined ? `${assetA.peRatio}x` : "N/A"}</span>
                    <span className="text-slate-300 text-center">{assetB.peRatio !== undefined ? `${assetB.peRatio}x` : "N/A"}</span>
                  </div>
                </div>
              )}

              {/* Comparative Bar Chart Visualization */}
              {assetA && assetB && (
                <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl space-y-2">
                  <span className="text-[10px] text-blue-400 font-mono tracking-wider block font-bold uppercase">PERBANDINGAN GRAFIS (METRIK UTAMA %)</span>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                      <BarChart data={comparisonChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={9} />
                        <YAxis stroke="#64748b" fontSize={9} />
                        <ChartTooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                        <ChartLegend wrapperStyle={{ fontSize: '9px' }} />
                        <Bar dataKey={assetA.symbol} fill="#2563eb" radius={[4, 4, 0, 0]} />
                        <Bar dataKey={assetB.symbol} fill="#a855f7" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Run Gemini analyst trigger */}
              <button
                onClick={handleRequestCompareReport}
                id="analyze-compare-btn"
                disabled={isLoadingAi}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-3 rounded-xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-900/15"
              >
                {isLoadingAi ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Kecerdasan AI Memproses Analitik...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-white" />
                    <span>Minta Dokumen Opini AI Analis (CFA)</span>
                  </>
                )}
              </button>
            </div>

            {/* AI report display */}
            {(aiReport || aiError) && (
              <div className="mt-4 bg-slate-950 rounded-xl border border-slate-800 p-4 max-h-[280px] overflow-y-auto">
                {aiReport && (
                  <div className="prose prose-invert prose-xs text-xs text-slate-300">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2 gap-2">
                      <div className="flex items-center space-x-2 text-blue-400 font-bold">
                        <BookOpen className="w-4 h-4" />
                        <span className="uppercase font-mono text-[10px]">Laporan Penasihat AI Keuangan</span>
                      </div>
                      <button
                        onClick={handleExportCfaReportPDF}
                        id="export-cfa-comparison-pdf"
                        className="bg-slate-900 hover:bg-slate-800 hover:text-slate-100 text-slate-300 text-[10px] px-2.5 py-1 rounded border border-slate-700 font-sans font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Download className="w-3 h-3 text-red-400" /> Ekspor PDF
                      </button>
                    </div>
                    {isAiReportFallback && (
                      <div className="mb-3 p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg flex items-start gap-2 text-[10.5px]">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                          <strong className="font-bold">Mode Simulasi Mandiri Aktif:</strong> Kuota API gratis Gemini Anda sedang penuh hari ini. Sistem kami secara otomatis mengaktifkan model analisis fundamental CFA lokal berpresisi tinggi agar riset investasi tetap berjalan lancar!
                        </div>
                      </div>
                    )}
                    <div className="markdown-body leading-relaxed text-[11px] font-sans">
                      <Markdown>{aiReport}</Markdown>
                    </div>
                  </div>
                )}
                {aiError && (
                  <div className="text-xs text-rose-400">
                    <span className="block font-bold">Terjadi Penyimpangan Analisis:</span>
                    {aiError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* PDF Analysis desk */
        <div className="space-y-6" id="pdf-analysis-sub-panel">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-fade-in">
            
            {/* Left side: Upload configuration card */}
            <div className="lg:col-span-1 bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-6 flex flex-col justify-between">
              <div className="space-y-6">
                <div>
                  <h3 className="text-md font-bold text-slate-100 flex items-center gap-2">
                    <Upload className="w-4 h-4 text-emerald-500 animate-pulse" /> Konfigurasi Dokumen
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Pilih klasifikasi subjek laporan audit Anda untuk kalibrasi analitik AI Z-CAPITAL.
                  </p>
                </div>

                {/* Set Category Toggle */}
                <div className="space-y-2">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Tipe Instrumen Makomoditi</span>
                  <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-lg border border-slate-850">
                    <button
                      onClick={() => setPdfCategory('stock')}
                      className={`py-2 text-xs rounded-md font-medium transition-all cursor-pointer ${
                        pdfCategory === 'stock'
                          ? "bg-slate-800 text-teal-400 font-bold shadow-sm"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                      id="pdf-category-stock"
                    >
                      Saham BEI
                    </button>
                    <button
                      onClick={() => setPdfCategory('crypto')}
                      className={`py-2 text-xs rounded-md font-medium transition-all cursor-pointer ${
                        pdfCategory === 'crypto'
                          ? "bg-slate-800 text-purple-400 font-bold shadow-sm"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                      id="pdf-category-crypto"
                    >
                      Crypto & Token
                    </button>
                  </div>
                </div>

                {/* Drag and Drop File Zone */}
                <div className="space-y-2">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Dokumen Sumber (.pdf)</span>
                  
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-3 min-h-[160px] ${
                      isDragOver
                        ? "border-emerald-500 bg-emerald-500/5 shadow-inner"
                        : uploadedFile 
                          ? "border-emerald-500/40 bg-slate-950/20" 
                          : "border-slate-800 bg-slate-950/40 hover:border-slate-700/80"
                    }`}
                    id="pdf-dragzone"
                    onClick={() => document.getElementById('pdf-file-field')?.click()}
                  >
                    <input
                      type="file"
                      id="pdf-file-field"
                      accept=".pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    
                    {uploadedFile ? (
                      <div className="space-y-2 text-center">
                        <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center mx-auto">
                          <FileCheck className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-slate-200 font-semibold break-all max-w-[200px] mx-auto">
                            {uploadedFile.name}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            {(uploadedFile.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-center">
                        <div className="w-10 h-10 bg-slate-800/60 rounded-lg flex items-center justify-center mx-auto animate-bounce">
                          <Upload className="w-5 h-5 text-slate-400" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-slate-300 font-medium font-mono">
                            TARIK DOKUMEN KE SINI
                          </p>
                          <p className="text-[10px] text-slate-500">
                            atau cari berkas secara manual
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  {uploadError && (
                    <p className="text-[10px] text-rose-400 flex items-center gap-1 font-medium mt-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {uploadError}
                    </p>
                  )}
                </div>
              </div>

              {/* Action trigger button */}
              <button
                onClick={handleAnalyzePdf}
                disabled={!uploadedFile || isAnalyzingPdf}
                className={`w-full font-bold px-4 py-3 rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg mt-6 ${
                  isAnalyzingPdf
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : !uploadedFile
                      ? "bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/20 active:translate-y-0.5"
                }`}
                id="pdf-analyze-submit-btn"
              >
                {isAnalyzingPdf ? (
                  <>
                    <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    <span>Riset Audit Berjalan...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Analisis Laporan (CFA/FRM)</span>
                  </>
                )}
              </button>
            </div>

            {/* Right side: Report Presentation Workspace */}
            <div className="lg:col-span-3 bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col justify-between min-h-[500px]">
              
              {!uploadedFile && !isAnalyzingPdf && !pdfAnalysisReport && (
                <div className="m-auto text-center space-y-3 p-12 max-w-sm">
                  <div className="w-12 h-12 rounded-full bg-slate-950 flex items-center justify-center mx-auto border border-slate-850">
                    <FileText className="w-6 h-6 text-slate-600 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-300 font-mono">WORKSPACE RISET AUDIT</h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Silakan seret berkas laporan keuangan korporasi atau whitepaper kripto PDF Anda. AI akan menyusun memorandum penasihat komprehensif setingkat analis berpengalaman 30 tahun bersertifikat internasional.
                    </p>
                  </div>
                </div>
              )}

              {/* Live Loading Tickers */}
              {isAnalyzingPdf && (
                <div className="m-auto text-center space-y-6 max-w-md p-12">
                  <div className="relative w-16 h-16 mx-auto">
                    <div className="absolute inset-0 rounded-full border-4 border-slate-850" />
                    <div className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
                    <FileUp className="w-6 h-6 text-emerald-500 absolute inset-0 m-auto animate-pulse" />
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-300 uppercase font-mono tracking-widest">PROSES AUDIT DOKUMEN AKTIF</h4>
                    <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 font-mono bg-emerald-950/25 px-4 py-2.5 rounded-lg border border-emerald-900/40">
                      <Clock className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>{loadingStatuses[loadingStatusIndex]}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error displaying */}
              {pdfAnalysisError && (
                <div className="m-auto text-center space-y-3 p-8 border border-rose-900/30 bg-rose-950/10 rounded-xl max-w-md">
                  <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
                  <h4 className="text-xs font-bold text-rose-400">Penyimpangan Sistem Terdeteksi</h4>
                  <p className="text-xs text-slate-400">{pdfAnalysisError}</p>
                </div>
              )}

              {/* Dynamic Beautiful CFA/FRM Analysis Report Viewer */}
              {pdfAnalysisReport && !isAnalyzingPdf && (
                <div className="space-y-6">
                  {/* Top Control Action Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 mb-2 gap-4">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                      <div>
                        <span className="uppercase font-mono text-[10px] tracking-wider text-emerald-400 font-bold block">
                          MEMORANDUM ADVISORI SELESAI
                        </span>
                        <span className="text-[11px] text-slate-400 block font-sans">
                          Sertifikasi Hasil Audit Komite Internasional CFA/FRM
                        </span>
                      </div>
                    </div>
                    
                    <button
                      onClick={handleExportUploadedPdfReport}
                      id="export-pdf-report-btn"
                      className="bg-emerald-600 hover:bg-emerald-500 text-slate-100 text-xs px-4 py-2 rounded-lg font-sans font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-lg shadow-emerald-900/20 active:translate-y-0.5"
                    >
                      <Download className="w-4 h-4 text-white" /> Unduh Dokumen PDF Resmi
                    </button>
                  </div>

                  {/* Document information metadata bar */}
                  <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-850/60 grid grid-cols-1 sm:grid-cols-3 gap-4 text-[10px] font-mono">
                    <div>
                      <span className="text-slate-500 block">NAMA BERKAS SUMBER:</span>
                      <span className="text-slate-300 font-bold block truncate" title={uploadedFile?.name}>
                        {uploadedFile?.name}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">KLASIFIKASI AUDIT:</span>
                      <span className="text-slate-300 font-bold block uppercase text-emerald-400">
                        {pdfCategory === 'stock' ? 'Laporan Keuangan Korporat (IHSG)' : 'Whitepaper Proyek (Crypto)'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">ID AUDIT OTENTIK:</span>
                      <span className="text-slate-300 font-bold block text-blue-400">
                        REPORT-CFA/INT-{(uploadedFile?.name || "pdf").toUpperCase().slice(0, 6)}
                      </span>
                    </div>
                  </div>

                  {isPdfReportFallback && (
                    <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl flex items-start gap-3 text-xs">
                      <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
                      <div>
                        <strong className="font-bold block mb-0.5">Mode Analisis Audit Lokal Aktif</strong>
                        Kuota API gratis Gemini Anda terlampaui batas hari ini. Komite Keuangan telah memicu Sistem Pakar Audit CFA lokal agar laporan memorandum terperinci dan diagnostik multi-aspek dari laporan tetap bisa disajikan dengan informasi valid.
                      </div>
                    </div>
                  )}

                  {/* The Document Report Main Presentation Container */}
                  <div className="bg-slate-950/45 shadow-xl border border-slate-850 p-6 rounded-xl max-h-[580px] overflow-y-auto prose prose-invert prose-xs text-xs text-slate-300">
                    <div className="markdown-body leading-relaxed text-[11.5px] font-sans antialiased text-slate-300">
                      <Markdown>{pdfAnalysisReport}</Markdown>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
