import React, { useState, useEffect } from "react";
import { useGlobalStore } from "../store";
import {
  Files,
  Upload,
  Trash2,
  AlertCircle,
  FileText,
  TrendingUp,
  Coins,
  Sparkles,
  FileDown,
  Info,
  CheckCircle,
  ShieldCheck,
  Globe
} from "lucide-react";
import { exportMultiPdfComparisonReport } from "../utils/pdfGenerator";

interface FileEntry {
  id: string;
  file?: File;
  name: string;
  size?: number;
  base64?: string;
  type: "file" | "url";
  url?: string;
}

export default function MultiDocAnalysis() {
  const { settings } = useGlobalStore();
  const [category, setCategory] = useState<"stock" | "crypto">("stock");
  const [uploadedFiles, setUploadedFiles] = useState<FileEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState("");
  
  // URL Input States
  const [activeSourceType, setActiveSourceType] = useState<"pdf" | "url">("pdf");
  const [urlInput, setUrlInput] = useState("");
  const [urlNameInput, setUrlNameInput] = useState("");

  // Analysis States
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisReport, setAnalysisReport] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [isFallback, setIsFallback] = useState(false);
  const [loadingStatusIndex, setLoadingStatusIndex] = useState(0);

  const loadingStatuses = [
    "[ZAYTRIX Engine] Mengunggah buffer sirkuit berkas multi-komparasi...",
    "[CFA Core Committee] Menyelaraskan sirkulasi data neraca komparatif...",
    "[FRM Desk specialist] Mengekstrak matriks solvabilitas & profil utang...",
    "[Modeler Hub] Memetakan track record pertumbuhan 5 tahun ke belakang...",
    "[Advisory Team] Memformulasikan bobot alokasi portofolio pelindung..."
  ];

  useEffect(() => {
    let intervalId: any;
    if (isAnalyzing) {
      setLoadingStatusIndex(0);
      intervalId = setInterval(() => {
        setLoadingStatusIndex((prev) => (prev < loadingStatuses.length - 1 ? prev + 1 : 0));
      }, 3000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isAnalyzing]);

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

  const handleFilesAdded = (filesList: FileList) => {
    setUploadError("");
    const newEntries: FileEntry[] = [];
    
    // Total cumulative sources count constraint check
    const currentCount = uploadedFiles.length;
    if (currentCount + filesList.length > 5) {
      setUploadError("Jumlah maksimum sumber perbandingan yang bisa Anda tambahkan secara bersamaan adalah 5.");
      return;
    }

    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      
      // Enforce PDF constraint
      if (file.type !== "application/pdf") {
        setUploadError("Format berkas harus berupa dokumen (.pdf).");
        continue;
      }

      // Check for duplicate names
      if (uploadedFiles.some(f => f.name === file.name)) {
        continue;
      }

      newEntries.push({
        id: `file_${Math.random().toString(36).substring(2, 9)}`,
        type: "file",
        file,
        name: file.name,
        size: file.size
      });
    }

    if (newEntries.length > 0) {
      setUploadedFiles(prev => [...prev, ...newEntries]);
      setAnalysisReport("");
      setAnalysisError("");
    }
  };

  const handleFileFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesAdded(e.target.files);
    }
  };

  const handleAddUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError("");

    if (!urlInput.trim()) {
      setUploadError("Harap masukkan URL tautan website.");
      return;
    }

    if (!urlInput.toLowerCase().startsWith("http://") && !urlInput.toLowerCase().startsWith("https://")) {
      setUploadError("Format URL tidak valid. Harus dimulai dengan http:// atau https://");
      return;
    }

    if (uploadedFiles.length >= 5) {
      setUploadError("Jumlah maksimum sumber perbandingan yang diizinkan adalah 5.");
      return;
    }

    // Try to derive a clean display name if none is provided
    let derivedName = urlNameInput.trim();
    if (!derivedName) {
      try {
        const parsed = new URL(urlInput);
        derivedName = parsed.hostname.replace("www.", "") + " (Situs Proyek)";
      } catch (err) {
        derivedName = "Situs Proyek Web";
      }
    }

    // Check for duplicate URLs
    if (uploadedFiles.some(f => f.type === "url" && f.url === urlInput.trim())) {
      setUploadError("Tautan URL ini sudah terdaftar dalam antrean perbandingan.");
      return;
    }

    const newUrlEntry: FileEntry = {
      id: `url_${Math.random().toString(36).substring(2, 9)}`,
      type: "url",
      name: derivedName,
      url: urlInput.trim()
    };

    setUploadedFiles(prev => [...prev, newUrlEntry]);
    setUrlInput("");
    setUrlNameInput("");
    setAnalysisReport("");
    setAnalysisError("");
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setAnalysisReport("");
    setAnalysisError("");
  };

  const handleClearAll = () => {
    setUploadedFiles([]);
    setAnalysisReport("");
    setAnalysisError("");
    setUploadError("");
  };

  const runComparativeAnalysis = async () => {
    if (uploadedFiles.length < 2) {
      setUploadError("Silakan unggah setidaknya 2 dokumen atau masukkan 2 tautan untuk dibandingkan.");
      return;
    }
    if (uploadedFiles.length > 5) {
      setUploadError("Jumlah maksimum sumber perbandingan yang diizinkan adalah 5.");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisReport("");
    setAnalysisError("");
    setIsFallback(false);

    try {
      // Convert files to base64, leaving url-type alone so they are passed cleanly
      const preparedFiles = await Promise.all(
        uploadedFiles.map(async (entry) => {
          if (entry.type === "url") {
            return {
              type: "url",
              fileName: entry.name,
              webUrl: entry.url
            };
          } else {
            const base64 = entry.base64 || await convertToBase64(entry.file!);
            return {
              type: "file",
              fileName: entry.name,
              pdfData: base64
            };
          }
        })
      );

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (settings.geminiKey) {
        headers["X-Gemini-Key"] = settings.geminiKey;
      }

      const res = await fetch("/api/gemini/analyze-multi-pdf", {
        method: "POST",
        headers,
        body: JSON.stringify({
          files: preparedFiles,
          category: category,
          aiTone: settings.aiTone,
          aiMaxTokens: settings.aiMaxTokens,
          aiTemperature: settings.aiTemperature,
          aiThinkingMode: settings.aiThinkingMode || "high"
        })
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Koneksi gagal atau server tidak merespon dengan benar (HTTP ${res.status}).`);
      }

      if (!res.ok) {
        const errObj = await res.json();
        throw new Error(errObj.error || "Gagal menghubungi server analitik.");
      }

      const data = await res.json();
      setAnalysisReport(data.analysis || "");
      setIsFallback(!!data.isFallback);
    } catch (err: any) {
      console.error(err);
      setAnalysisError(err.message || "Gagal mengolah dokumen multi-analisis. Harap coba lagi.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const triggerExportPdf = () => {
    if (!analysisReport) return;
    const listNames = uploadedFiles.map(f => f.name);
    exportMultiPdfComparisonReport(analysisReport, listNames, category);
  };

  return (
    <div className="space-y-6" id="multi-doc-panel">
      {/* Title Header area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-5 gap-4">
        <div>
          <div className="flex items-center space-x-2 text-amber-500 font-mono text-[10px] font-bold tracking-widest uppercase mb-1.5">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>Advisory Core Hibrida</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-yellow-300">
              ZAYTRIX
            </span>{" "}
            Multi-Document Auditor
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Bandingkan 2 sampai 5 Laporan Manajemen Korporatif (Stocks) atau Whitepapers (Kripto) bersilang hibrida secara side-by-side.
          </p>
        </div>
        
        <div className="flex items-center space-x-3 text-xs select-none">
          <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-slate-500">Mekanisme Kalibrasi:</span>
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-850">
            <button
              onClick={() => {
                if (!isAnalyzing) {
                  setCategory("stock");
                  handleClearAll();
                }
              }}
              disabled={isAnalyzing}
              className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded transition-all cursor-pointer ${
                category === "stock"
                  ? "bg-slate-800 text-teal-400 font-bold"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>BEI Stocks</span>
            </button>
            <button
              onClick={() => {
                if (!isAnalyzing) {
                  setCategory("crypto");
                  handleClearAll();
                }
              }}
              disabled={isAnalyzing}
              className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded transition-all cursor-pointer ${
                category === "crypto"
                  ? "bg-slate-800 text-purple-400 font-bold"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Coins className="w-3.5 h-3.5" />
              <span>Whitepapers</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Control Board: Sources Dashboard Area */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Upload className="w-4 h-4 text-amber-500 animate-pulse" />
                <span>Tambahkan Sumber Perbandingan (2-5 Sumber)</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-1">
                {category === "stock"
                  ? "Unggah laporan keuangan PDF emiten atau tautkan link analisis fundamental resmi."
                  : "Unggah naskah PDF Whitepaper atau kaitkan langsung tautan URL situs web proyek kripto live."}
              </p>
            </div>

            {/* Segmented Controller: PDF File vs Live Website Link */}
            <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-850 mt-1 select-none">
              <button
                type="button"
                onClick={() => setActiveSourceType("pdf")}
                disabled={isAnalyzing}
                className={`py-2 text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  activeSourceType === "pdf"
                    ? "bg-slate-800 text-slate-100 font-extrabold border border-slate-700/50 shadow-md"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Dokumen PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSourceType("url")}
                disabled={isAnalyzing}
                className={`py-2 text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  activeSourceType === "url"
                    ? "bg-slate-800 text-amber-500 font-extrabold border border-slate-700/50 shadow-md"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Link Situs / Whitepaper</span>
              </button>
            </div>

            {/* Conditional Input UI: Drag & Drop PDF vs URL Submission */}
            {activeSourceType === "pdf" ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => {
                  if (!isAnalyzing) {
                    document.getElementById("multi-pdf-file-selector")?.click();
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-3 min-h-[140px] ${
                  isAnalyzing
                    ? "border-slate-900 bg-slate-950/20 opacity-50 cursor-not-allowed"
                    : isDragOver
                    ? "border-amber-500 bg-amber-500/5 shadow-inner"
                    : "border-slate-800 bg-slate-950/40 hover:border-slate-700/80"
                }`}
                id="multi-pdf-dropzone"
              >
                <input
                  type="file"
                  id="multi-pdf-file-selector"
                  accept=".pdf"
                  multiple
                  disabled={isAnalyzing}
                  onChange={handleFileFieldChange}
                  className="hidden"
                />

                <div className="w-10 h-10 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-center">
                  <Files className={`w-5 h-5 ${isDragOver ? "text-amber-400" : "text-slate-400"}`} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-200 font-semibold font-mono uppercase tracking-wide">
                    TARIK PDF KE SINI
                  </p>
                  <p className="text-[10px] text-slate-500">
                    atau klik untuk memilih secara manual
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddUrl} className="p-4 bg-slate-950/40 border border-slate-850 rounded-xl space-y-3.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                    URL Situs Web / Dokumen Online
                  </label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                    <input
                      type="url"
                      placeholder="https://sui.io atau https://proyek.com/whitepaper"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      disabled={isAnalyzing}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                      Nama Custom Sumber (Opsional)
                    </label>
                    <span className="text-[9px] text-slate-500">Auto jika dikosongkan</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Contoh: Solana Core Whitepaper"
                    value={urlNameInput}
                    onChange={(e) => setUrlNameInput(e.target.value)}
                    disabled={isAnalyzing}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isAnalyzing || !urlInput.trim()}
                  className="w-full py-2 bg-gradient-to-r from-amber-600/20 to-amber-500/20 hover:from-amber-600 hover:to-amber-500 border border-amber-500/30 text-amber-400 hover:text-white font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Tambahkan Tautan Live</span>
                </button>
              </form>
            )}

            {uploadError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-2 text-rose-400 text-xs text-left" id="upload-err-notif">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Uploaded Files Queue */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2 mt-4">
                <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  <span>Antrean Perbandingan ({uploadedFiles.length}/5)</span>
                  <button
                    onClick={handleClearAll}
                    disabled={isAnalyzing}
                    className="text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Bersihkan Semua
                  </button>
                </div>
                
                <div className="space-y-2 max-h-[220px] overflow-y-auto no-scrollbar">
                  {uploadedFiles.map((entry, index) => (
                    <div
                      key={entry.id || index}
                      className="bg-slate-950/60 border border-slate-850 p-2 px-3 rounded-lg flex items-center justify-between gap-3 text-xs animate-fadeIn"
                    >
                      <div className="flex items-center space-x-2.5 overflow-hidden">
                        {entry.type === "url" ? (
                          <div className="p-1 rounded bg-amber-500/10 text-amber-500 shrink-0">
                            <Globe className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <FileText className={`w-4 h-4 shrink-0 ${category === 'stock' ? 'text-teal-400' : 'text-purple-400'}`} />
                        )}
                        <div className="overflow-hidden">
                          <p className="text-slate-200 font-medium truncate break-all max-w-[160px] sm:max-w-[200px]" title={entry.name}>
                            {entry.name}
                          </p>
                          <p className="text-[9px] text-slate-500 font-mono truncate max-w-[150px]">
                            {entry.type === "url" ? (
                              <span className="text-amber-500 font-medium">{entry.url}</span>
                            ) : (
                              `${((entry.size || 0) / (1024 * 1024)).toFixed(2)} MB`
                            )}
                          </p>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => handleRemoveFile(index)}
                        disabled={isAnalyzing}
                        className="text-slate-500 hover:text-rose-400 p-1 rounded-md transition-colors disabled:opacity-50 cursor-pointer"
                        title="Hapus Sumber"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action Trigger Button */}
          <button
            onClick={runComparativeAnalysis}
            disabled={uploadedFiles.length < 2 || isAnalyzing}
            className={`w-full font-bold px-4 py-3.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg ${
              isAnalyzing
                ? "bg-slate-800 text-slate-500 cursor-not-allowed animate-pulse"
                : uploadedFiles.length < 2
                ? "bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed"
                : "bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-amber-950/20 hover:shadow-xl hover:shadow-amber-500/10 active:translate-y-0.5"
            }`}
            id="multi-analyze-action-btn"
          >
            {isAnalyzing ? (
              <>
                <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                <span>Mengevaluasi & Komparasi Kripto/Saham...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Analisis Komparatif AI ({uploadedFiles.length} Sumber)</span>
              </>
            )}
          </button>
        </div>

        {/* Right Workspace Side: High-end Analysis Presentation Board */}
        <div className="lg:col-span-3 bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col justify-between min-h-[500px]">
          
          {/* Default Uninitialized Placeholder */}
          {!uploadedFiles.length && !isAnalyzing && !analysisReport && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 py-12 space-y-5 max-w-sm mx-auto">
              <div className="w-14 h-14 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-center shadow-lg">
                <Files className="w-6 h-6 text-slate-500" />
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-slate-200">Menunggu Unggahan Dokumen</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Unggah minimal 2 dokumen PDF untuk membobot secara multi-dimensional draf akrual, tumpukan likuiditas, konsensus jaringan, dan rekam jejak 5-tahun korporat emiten bursa secara side-by-side.
                </p>
              </div>
              
              <div className="w-full grid grid-cols-2 gap-2.5 pt-3 border-t border-slate-850">
                <div className="p-2 border border-slate-850 rounded bg-slate-950/20 text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Stocks</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">Analisis Keuangan & DER</div>
                </div>
                <div className="p-2 border border-slate-850 rounded bg-slate-950/20 text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Crypto</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">Massa Vesting & Nilai Cap</div>
                </div>
              </div>
            </div>
          )}

          {/* Prompt to add more files if count < 2 but files are selected */}
          {uploadedFiles.length === 1 && !isAnalyzing && !analysisReport && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 py-12 space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-center text-amber-500">
                <Info className="w-5 h-5 text-amber-500" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-200">Satu Berkas Terdeteksi</h4>
                <p className="text-xs text-slate-400">
                  Sistem komparasi ZAYTRIX menuntut minimal <span className="text-amber-400 font-bold">2 dokumen PDF</span> yang diunggah secara bersamaan agar AI dapat menyusun laporan komparatif yang komprehensif.
                </p>
                <button
                  onClick={() => document.getElementById("multi-pdf-file-selector")?.click()}
                  className="mt-4 px-3.5 py-1.5 bg-slate-800 text-slate-100 font-medium text-xs rounded hover:bg-slate-700 transition-colors"
                >
                  Tambah dokumen kedua
                </button>
              </div>
            </div>
          )}

          {/* Active Processing / Analyzing State */}
          {isAnalyzing && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 max-w-lg mx-auto space-y-6">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mx-auto" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-amber-400 animate-pulse" />
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-bold text-slate-200 font-mono tracking-wide">
                  MEMBACA STRUKTUR BEI/CRYPTO METRICS...
                </h4>
                <p className="text-xs text-amber-400 font-mono font-medium animate-pulse min-h-[36px] max-w-sm">
                  {loadingStatuses[loadingStatusIndex]}
                </p>
              </div>

              <div className="w-full bg-slate-950 p-3 rounded-lg border border-slate-850 text-left max-w-xs mx-auto space-y-1 text-[10px] font-mono text-slate-500">
                <div className="flex items-center justify-between">
                  <span>Suhu Operasi:</span>
                  <span className="text-emerald-400">38°C (Steady)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Kompleksitas Query:</span>
                  <span className="text-teal-400">CFA Institute L3 Input</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Analisis Multi:</span>
                  <span className="text-amber-400 font-bold">{uploadedFiles.length} Dokumen</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-900 mt-2 pt-2">
                  <span>E2EE Tunnel:</span>
                  <span className="text-emerald-400 font-bold">✓ Secured</span>
                </div>
              </div>
            </div>
          )}

          {/* Error Render Screen */}
          {analysisError && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center justify-center text-rose-400">
                <AlertCircle className="w-5 h-5 text-rose-400" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-200">Kegagalan Evaluasi Komparatif</h4>
                <p className="text-xs text-rose-400/90 font-semibold">{analysisError}</p>
                <p className="text-[10px] text-slate-500 mt-2">
                  Gagal draf analisis real-time, silakan tekan tombool ulangi di sebelah kiri untuk meluncurkan pipeline cadangan.
                </p>
              </div>
            </div>
          )}

          {/* Presentation of Audit Report */}
          {analysisReport && !isAnalyzing && (
            <div className="flex-1 flex flex-col justify-between" id="multi-doc-report-viewer">
              {/* Header with quick download option */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4 shrink-0 select-none">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-[10px] font-bold font-mono tracking-wider text-slate-400 uppercase">
                    Hasil Analisis Komparatif bersilang ZAYTRIX
                  </span>
                </div>
                
                <button
                  onClick={triggerExportPdf}
                  className="flex items-center space-x-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 hover:shadow-lg shadow-blue-950/20 text-white font-semibold text-[11px] rounded transition-all cursor-pointer"
                  title="Unduh Laporan PDF"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Unduh PDF Resmi</span>
                </button>
              </div>

              {isFallback && (
                <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg flex items-start gap-2.5 text-[10.5px]">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                  <div>
                    <strong className="font-bold">Mode Komparasi Bersilang Lokal Aktif</strong>
                    <p className="mt-0.5 leading-relaxed text-slate-300">
                      Kuota harian API Gemini Anda terlampaui. Komite Keuangan telah menggunakan sistem pakar komparasi modal CFA/FRM lokal agar perbandingan instrumen tetap dapat dianalisis secara struktural dan taktis dengan andal.
                    </p>
                  </div>
                </div>
              )}

              {/* Parsed report markdown content */}
              <div className="flex-1 overflow-y-auto pr-1 text-slate-300 text-xs tracking-wide leading-relaxed space-y-4 max-h-[500px]" style={{ direction: 'ltr' }}>
                <div className="markdown-body font-sans text-xs select-text">
                  {analysisReport.split("\n").map((line, idx) => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith("### ")) {
                      return (
                        <h3 key={idx} className="text-sm font-black text-amber-400 border-b border-slate-800 pb-1 mt-5 mb-3 uppercase tracking-wide font-mono">
                          {trimmed.substring(4)}
                        </h3>
                      );
                    } else if (trimmed.startsWith("#### ")) {
                      return (
                        <h4 key={idx} className="text-xs font-bold text-slate-200 mt-4 mb-2">
                          {trimmed.substring(5)}
                        </h4>
                      );
                    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                      return (
                        <li key={idx} className="list-disc ml-5 mb-1.5 text-slate-300">
                          {trimmed.substring(2).replace(/\*\*(.*?)\*\*/g, "$1")}
                        </li>
                      );
                    } else if (trimmed.startsWith("|")) {
                      // Simple markdown table rows check
                      const cells = trimmed.split("|").filter(c => c.trim() !== "");
                      const isHeader = line.includes("---");
                      if (isHeader) {
                        return <div key={idx} className="h-px bg-slate-800 my-1" />;
                      }
                      return (
                        <div key={idx} className="grid grid-cols-4 gap-2 bg-slate-950/40 p-2 border border-slate-850 text-[11px] font-mono rounded">
                          {cells.map((cell, cIdx) => (
                            <span key={cIdx} className={`${cIdx === 0 ? "font-semibold text-slate-300" : "text-center text-slate-400"}`}>
                              {cell.trim().replace(/\*\*(.*?)\*\*/g, "$1")}
                            </span>
                          ))}
                        </div>
                      );
                    } else if (trimmed === "") {
                      return <div key={idx} className="h-2.5" />;
                    } else {
                      return (
                        <p key={idx} className="mb-3 text-slate-300 text-justify leading-relaxed indent-2.5">
                          {trimmed.replace(/\*\*(.*?)\*\*/g, "$1")}
                        </p>
                      );
                    }
                  })}
                </div>
              </div>

              {/* Bottom Print / Copy banner */}
              <div className="border-t border-slate-800 pt-4 mt-4 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between text-[10px] text-slate-500 gap-3 select-none">
                <div className="flex items-center space-x-1.5 font-mono">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Sertifikat Riset L3 CFA/FRM Berdaya AI</span>
                </div>
                
                <button
                  onClick={triggerExportPdf}
                  className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white font-bold rounded-lg transition-all text-xs hover:shadow-lg shadow-teal-950/20 pointer-events-auto cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Cetak Laporan Riset Hub Komparatif</span>
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
