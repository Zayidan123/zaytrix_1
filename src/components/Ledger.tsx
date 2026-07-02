import React, { useState, useMemo } from "react";
import { useGlobalStore } from "../store";
import { LedgerTransaction } from "../types";
import { 
  FileSpreadsheet, 
  Search, 
  Filter, 
  HelpCircle, 
  Download, 
  Calculator, 
  ArrowDownLeft, 
  ArrowUpRight, 
  RefreshCw, 
  DollarSign, 
  Sparkles,
  Award
} from "lucide-react";

export default function Ledger() {
  const ledgerHistory = useGlobalStore((state) => state.ledgerHistory);
  const addLedgerTransaction = useGlobalStore((state) => state.addLedgerTransaction);
  
  // Filtering and Searching parameters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<"ALL" | "BUY" | "SELL" | "SWAP">("ALL");
  const [selectedYear, setSelectedYear] = useState<string>("ALL");

  // Interactive AI Companion chatbot assistant
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [aiResponse, setAiResponse] = useState<string>("");
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  // DEMO DATA button — seeds 4 illustrative example transactions into the
  // user's empty ledger so they can preview the FIFO / tax-recap UI before
  // entering real trades. The prices and timestamps below are STATIC SAMPLE
  // VALUES (not real market data) and only appear when the user explicitly
  // clicks the "Pre-seed Contoh Transaksi (DEMO)" button. They never
  // auto-populate. Real transactions come from the user's own entry via
  // addLedgerTransaction (or the /api/portfolio/* server-side persistence).
  const handleSeedMockTransactions = () => {
    const mockTxs: LedgerTransaction[] = [
      {
        id: "tx_demo_1",
        timestamp: "2026-01-15T09:30:00.000Z",
        type: "BUY",
        symbol: "BTC",
        quantity: 0.15,
        price: 48000,
        totalAmount: 7200,
        feePaidUsd: 3.6,
        notes: "[DEMO] Pembelian awal Bitcoin awal tahun"
      },
      {
        id: "tx_demo_2",
        timestamp: "2026-02-10T14:45:00.000Z",
        type: "BUY",
        symbol: "ETH",
        quantity: 2.5,
        price: 2400,
        totalAmount: 6000,
        feePaidUsd: 3.0,
        notes: "[DEMO] Akumulasi Ethereum"
      },
      {
        id: "tx_demo_3",
        timestamp: "2026-03-22T11:15:00.000Z",
        type: "SELL",
        symbol: "BTC",
        quantity: 0.05,
        price: 64000,
        totalAmount: 3200,
        realizedPnL: 800, // Sold 0.05 BTC bought at 48000 (cost basis: 2400, realized: 3200 - 2400 = 800)
        feePaidUsd: 1.6,
        notes: "[DEMO] Ambil untung Bitcoin pasca reli kuartal I"
      },
      {
        id: "tx_demo_4",
        timestamp: "2026-04-05T16:20:00.000Z",
        type: "SWAP",
        symbol: "ETH",
        quantity: 1.0,
        price: 3200,
        totalAmount: 3200,
        realizedPnL: 800, // Swap 1.0 ETH bought at 2400 for stablecoin at 3200 (realized PnL: 800)
        feePaidUsd: 1.6,
        notes: "[DEMO] Konversi ETH ke jaringan likuiditas stabil"
      }
    ];

    mockTxs.forEach((tx) => {
      // Avoid duplicates
      if (!ledgerHistory.some(existing => existing.id === tx.id)) {
        addLedgerTransaction(tx);
      }
    });
  };

  // Process and filter transaction logs
  const filteredLedger = useMemo(() => {
    return ledgerHistory.filter((tx) => {
      const matchSearch = tx.symbol.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (tx.notes && tx.notes.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchType = selectedType === "ALL" || tx.type === selectedType;
      
      const year = new Date(tx.timestamp).getFullYear().toString();
      const matchYear = selectedYear === "ALL" || year === selectedYear;

      return matchSearch && matchType && matchYear;
    });
  }, [ledgerHistory, searchTerm, selectedType, selectedYear]);

  // Aggregate Tax Summary figures
  const taxMetrics = useMemo(() => {
    let totalBoughtVal = 0;
    let totalSoldVal = 0;
    let accumulatedPnL = 0;
    let totalFees = 0;

    filteredLedger.forEach((tx) => {
      totalFees += tx.feePaidUsd || 0;
      if (tx.type === "BUY") {
        totalBoughtVal += tx.totalAmount;
      } else if (tx.type === "SELL") {
        totalSoldVal += tx.totalAmount;
        accumulatedPnL += tx.realizedPnL || 0;
      } else if (tx.type === "SWAP") {
        // Swap also generates realized yield from cost basis
        accumulatedPnL += tx.realizedPnL || 0;
      }
    });

    // PPh Final 0.1% (PMK-68/2024) on gross transaction value (NOT on gains).
    // Indonesian regulation charges 0.1% of transaction value for crypto sales
    // through registered exchanges (Final PPh Pasal 22).
    const estimatedCryptoTax = Math.max(0, (totalBoughtVal + totalSoldVal) * 0.001); 

    return {
      totalBoughtVal,
      totalSoldVal,
      accumulatedPnL,
      totalFees,
      estimatedCryptoTax
    };
  }, [filteredLedger]);

  // Export report to CSV spreadsheet format
  const handleExportToCsv = () => {
    if (filteredLedger.length === 0) {
      alert("Ledger riwayat transaksi Anda kosong. Gagal mengekspor laporan pajak nirlaba.");
      return;
    }

    // Prepare CSV header compliant with spreadsheet applications
    const headers = [
      "ID Transaksi",
      "Waktu Transaksi (UTC)",
      "Jenis Operasi",
      "Instrumen Aset",
      "Volume Unit",
      "Harga Eksekusi (USD)",
      "Total Nominal (USD)",
      "Estimasi Biaya Broker (USD)",
      "Laba/Rugi Realisasi FIFO (USD)",
      "Catatan Deskripsi"
    ];

    // Form lines safely wrapping fields with quotes
    const csvRows = [headers.join(",")];
    
    filteredLedger.forEach((tx) => {
      const pnlStr = tx.realizedPnL !== undefined ? tx.realizedPnL.toFixed(2) : "-";
      const row = [
        tx.id,
        tx.timestamp,
        tx.type,
        tx.symbol,
        tx.quantity,
        tx.price,
        tx.totalAmount,
        tx.feePaidUsd ? tx.feePaidUsd.toFixed(2) : "0.00",
        pnlStr,
        `"${(tx.notes || "").replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(","));
    });

    // Auto calculate tax recapitulation lines is appended at the bottom of theCSV
    csvRows.push("");
    csvRows.push("--- RINGKASAN REKAPITULASI LAPORAN PAJAK TAHUNAN ---");
    csvRows.push(`Total Volume Pembelian (USD),${taxMetrics.totalBoughtVal.toFixed(2)}`);
    csvRows.push(`Total Realisasi Penjualan (USD),${taxMetrics.totalSoldVal.toFixed(2)}`);
    csvRows.push(`Akumulasi Laba Bersih (Realized Capital Gains),${taxMetrics.accumulatedPnL.toFixed(2)}`);
    csvRows.push(`Pajak Estimasi PPh Final PMK-68 (0.1% Nilai Transaksi),${taxMetrics.estimatedCryptoTax.toFixed(2)}`);
    csvRows.push(`Laporan Diekspor Pada,${new Date().toISOString()}`);

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Z-Capital_Audit_Laporan_Pajak_${new Date().getFullYear()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Explain the technical indicators or rules based on pre-programmed expert responses
  const handleAskCompanion = (q: string) => {
    setActiveQuestion(q);
    setIsLoadingAi(true);
    
    // Simulate smart virtual calculations explanation under the hood
    setTimeout(() => {
      let ans = "";
      if (q === "fifo") {
        ans = "Metode FIFO (First-In, First-Out) mengasumsikan aset yang Anda beli pertama kali adalah aset pertama yang dijual. Sebagai contoh: Jika Anda membeli 0.1 BTC seharga $48k, lalu membeli lagi 0.1 BTC seharga $55k, dan kemudian menjual 0.1 BTC di harga $60k; dalam perhitungan pajak FIFO, biaya perolehan (cost basis) yang digunakan untuk menghitung laba adalah pembelian pertama ($48k). Sehingga Laba Terealisasi Anda adalah: $60k - $48k = $12k. Metode ini sangat penting untuk pelaporan pajak komprehensif aset digital Anda.";
      } else if (q === "pmk68") {
        ans = "Di Indonesia, peraturan perpajakan aset kripto diatur di dalam PMK Nomor 68/PMK.03/2022. Transaksi jual-beli kripto dikenakan PPh Pasal 22 Final sebesar 0.1% jika dilakukan melalui pedagang fisik terdaftar Bappebti, atau 0.2% jika di luar itu. PPN Final sebesar 0.11% juga berlaku. Melalui Ledger Laporan ini, kami menyederhanakan data volume pembelian dan audit realized PnL sehingga Anda dapat menyusun lampiran tambahan SPT Tahunan PPh Orang Pribadi Bagian IV dengan rapi dan bebas denda administrasi.";
      } else if (q === "pnl") {
        ans = "Realisasi PnL (Realized PnL) adalah keuntungan atau kerugian bersih dari investasi Anda yang SUDAH direalisasikan menjadi fiat/stablecoin melalui tindakan Penjualan ('SELL') atau Swap. Sebaliknya, Unrealized PnL (Floating PnL) hanyalah kertas kerja perkiraan keuntungan Anda saat ini berdasarkan fluktuasi harga pasar real-time terhadap kepemilikan Anda yang belum dilepas.";
      } else {
        ans = "Halo! Silakan gunakan ledger buku besar ini untuk mencatat konversi multi-aset demi mempermudah kalkulasi modal cost basis Anda secara transparan.";
      }
      setAiResponse(ans);
      setIsLoadingAi(false);
    }, 600);
  };

  return (
    <div className="space-y-6" id="ledger-history-tab">
      
      {/* Overview Dashboard Area */}
      <div className="bg-[#0F172A] p-4 sm:p-6 rounded-2xl border border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-500" /> Buku Besar Riwayat Transaksi & Audit Pajak PnL
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Pantau rincian biaya transaksi masuk-keluar secara FIFO kronologis. Ekspor kalkulasi pajak nirlaba langsung ke format Excel/Spreadsheet.
          </p>
        </div>

        <div className="flex gap-2">
          {ledgerHistory.length === 0 && (
            <button
              onClick={handleSeedMockTransactions}
              className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs px-4 py-2.5 rounded-lg border border-amber-500/25 font-bold transition-all cursor-pointer flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4 animate-spin" /> Pre-seed Contoh Transaksi (DEMO)
              <span className="ml-1 text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1 py-0.5 rounded font-mono font-bold uppercase tracking-wider">Data Contoh</span>
            </button>
          )}
          {ledgerHistory.length === 0 && (
            <span className="text-[9px] text-slate-500 font-mono leading-tight max-w-[160px] block">
              * Tombol DEMO hanya mengisi 4 transaksi contoh dengan harga statis buatan (bukan data pasar riil). Hapus kapan saja melalui reset manual.
            </span>
          )}

          <button
            onClick={handleExportToCsv}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-2.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-2 shadow-sm shadow-blue-900/30"
          >
            <FileSpreadsheet className="w-4 h-4" /> Ekspor Formulir Pajak (CSV)
          </button>
        </div>
      </div>

      {/* Tax Capital Gains Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: Realized PnL */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[10px] text-slate-400 font-mono tracking-wider block font-bold uppercase">Laba Realisasi Pajak (Realized)</span>
          <div className="flex items-center justify-between">
            <span className={`text-xl font-extrabold font-mono ${taxMetrics.accumulatedPnL >= 0 ? "text-emerald-400" : "text-rose-450"}`}>
              {taxMetrics.accumulatedPnL >= 0 ? "+" : ""}${taxMetrics.accumulatedPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
              taxMetrics.accumulatedPnL >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
            }`}>
              {taxMetrics.accumulatedPnL >= 0 ? "SURPLUS" : "DEFISIT"}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 leading-tight">Diperoleh dari tindakan konversi SWAP & penjualan aset.</p>
        </div>

        {/* Card 2: Total Volume Pembelian */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[10px] text-slate-400 font-mono tracking-wider block font-bold uppercase">Total Belanja Cost Basis</span>
          <div className="flex items-center justify-between">
            <span className="text-xl font-extrabold font-mono text-slate-200">
              ${taxMetrics.totalBoughtVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <ArrowDownLeft className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-[10px] text-slate-500 leading-tight">Total modal pembelanjaan awal dalam buku besar terintegrasi.</p>
        </div>

        {/* Card 3: Broker Commission Fees */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[10px] text-slate-400 font-mono tracking-wider block font-bold uppercase">Total Biaya Jasa Operasional</span>
          <div className="flex items-center justify-between">
            <span className="text-xl font-extrabold font-mono text-slate-200">
              ${taxMetrics.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <DollarSign className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-[10px] text-slate-500 leading-tight">Potongan komisi transaksi pedagang fisik berlisensi.</p>
        </div>

        {/* Card 4: Estimasi Potongan Pajak PPh (PMK-68) */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[10px] text-slate-450 font-mono tracking-wider block font-bold uppercase">Estimasi Pajak PPh (PPh Final / 0.1%)</span>
          <div className="flex items-center justify-between">
            <span className="text-xl font-extrabold font-mono text-amber-400">
              ${taxMetrics.estimatedCryptoTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <Calculator className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-[10px] text-slate-500 leading-tight">Perkiraan kontribusi SPT Tahunan berdasarkan kalkulasi regional.</p>
        </div>
      </div>

      {/* Main filterable bookkeeping table & AI Companion Assistant */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Books Ledger Logs Section (Spans 2 columns) */}
        <div className="lg:col-span-2 bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-4">
            <div>
              <h3 className="text-md font-bold text-slate-200">Buku Transaksi Finansia</h3>
              <p className="text-xs text-slate-400 mt-0.5">Rincian terperinci kronologis konversi portofolio Anda.</p>
            </div>

            {/* Quick search input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Cari aset atau deskripsi..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 w-52 font-medium"
              />
            </div>
          </div>

          {/* Table filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center space-x-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs text-slate-400 font-sans">Saring Tipe:</span>
            </div>
            
            <div className="flex gap-1.5">
              {(["ALL", "BUY", "SELL", "SWAP"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`text-[10.5px] px-3 py-1.5 rounded-lg border font-mono font-bold transition-all select-none cursor-pointer ${
                    selectedType === type
                      ? "bg-slate-800 text-blue-400 border-blue-500/20"
                      : "bg-transparent text-slate-400 border-transparent hover:border-slate-800 hover:text-slate-200"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="sm:ml-auto flex items-center space-x-2">
              <span className="text-[11px] text-slate-400">Tahun Pajak:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-lg p-1.5 font-mono"
              >
                <option value="ALL">Semua Periode</option>
                <option value="2026">2026</option>
                <option value="2025">2025</option>
              </select>
            </div>
          </div>

          {/* Transactions Book Ledger Table rendering */}
          <div className="overflow-x-auto rounded-xl border border-slate-850 bg-slate-950/40">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono text-[10px] uppercase bg-slate-950/80">
                  <th className="p-3">Operasi / Aset</th>
                  <th className="p-3">Waktu (UTC)</th>
                  <th className="p-3 text-right">Volume</th>
                  <th className="p-3 text-right">Harga Eksekusi</th>
                  <th className="p-3 text-right">Total Nominal</th>
                  <th className="p-3 text-right">Laba FIFO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/60 text-xs font-mono">
                {filteredLedger.length > 0 ? (
                  filteredLedger.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-950/55 transition-colors">
                      {/* Operation type + symbol */}
                      <td className="p-3">
                        <div className="flex items-center space-x-2.5">
                          <span className={`w-2 h-2 rounded-full ${
                            tx.type === "BUY" ? "bg-emerald-400" : tx.type === "SELL" ? "bg-rose-450" : "bg-purple-400"
                          }`} />
                          <div>
                            <span className="font-bold text-slate-250 block">{tx.symbol}</span>
                            <span className="text-[9.5px] text-slate-400 uppercase font-bold">{tx.type}</span>
                          </div>
                        </div>
                      </td>

                      {/* Timestamp */}
                      <td className="p-3 text-slate-400 text-[11px]">
                        {new Date(tx.timestamp).toLocaleDateString()} {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>

                      {/* Quantity */}
                      <td className="p-3 text-right text-slate-250">
                        {tx.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </td>

                      {/* Price */}
                      <td className="p-3 text-right text-slate-400">
                        ${tx.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </td>

                      {/* Total Amount */}
                      <td className="p-3 text-right text-slate-200">
                        ${tx.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Realized PnL */}
                      <td className={`p-3 text-right font-bold ${
                        tx.realizedPnL !== undefined 
                          ? (tx.realizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")
                          : "text-slate-500 font-medium"
                      }`}>
                        {tx.realizedPnL !== undefined 
                          ? `${tx.realizedPnL >= 0 ? "+" : ""}$${tx.realizedPnL.toFixed(2)}` 
                          : "-"
                        }
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-slate-505 text-slate-500 font-sans">
                      <Calculator className="w-8 h-8 text-slate-700 mx-auto mb-2 animate-bounce" />
                      Belum ada transaksi terekam pada kriteria saringan ini. 
                      <p className="text-[10px] text-slate-500 mt-1">Gunakan tombol pre-seed di atas untuk mengisi contoh rekor FIFO instan.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI TAX COMPANION (Mode Panduan AI Terintegrasi) */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div>
            <h3 className="text-md font-bold text-slate-200 flex items-center gap-1.5">
              <Sparkles className="w-5 h-5 text-amber-400" /> Mode Panduan Virtual AI
              <span className="ml-auto text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30" title="Jawaban berbasis aturan kategoris (rule-based), bukan AI live. Untuk konsultasi pajak aktual, hubungi konsultan pajak resmi.">INFO: Panduan Aturan</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Bertanyalah mengenai regulasi pajak capital gains, kriteria penarikan fee, dan metodologi FIFO kuantitatif.
            </p>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850 flex items-start gap-3">
            <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-300">Asisten Perpajakan Z-Capital</p>
              <p className="text-[10.5px] text-slate-500 leading-tight mt-0.5">Panduan berbasis aturan (rule-based) — bukan AI live. Pendamping kualitatif instan Anda di pasar investasi mandiri.</p>
            </div>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-850/60 space-y-3 min-h-[160px] flex flex-col justify-between">
            {activeQuestion ? (
              <div className="space-y-2">
                <div className="text-[10px] text-blue-400 font-mono uppercase font-bold tracking-wider">Topik: {activeQuestion}</div>
                {isLoadingAi ? (
                  <div className="space-y-1.5 animate-pulse pt-2">
                    <div className="h-2 w-full bg-slate-800 rounded" />
                    <div className="h-2 w-5/6 bg-slate-800 rounded" />
                    <div className="h-2 w-4/5 bg-slate-800 rounded" />
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-slate-300 text-justify font-sans">{aiResponse}</p>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-500 text-xs">
                Silakan pilih salah satu pertanyaan populer perpajakan di bawah untuk memicu asisten virtual kami.
              </div>
            )}

            {activeQuestion && !isLoadingAi && (
              <button 
                onClick={() => {
                  setActiveQuestion(null);
                  setAiResponse("");
                }}
                className="text-[10px] text-slate-400 hover:text-slate-200 underline font-mono text-right"
              >
                Mulai Ulang Obrolan
              </button>
            )}
          </div>

          {/* Interactive Preset Questions trigger */}
          <div className="space-y-2 pt-2">
            <span className="text-[10px] text-slate-400 uppercase font-mono font-bold block mb-1">Pertanyaan Populer Forex / Kripto:</span>
            
            <button
              onClick={() => handleAskCompanion("fifo")}
              className="w-full text-left text-[11px] bg-slate-950 hover:bg-slate-900 border border-slate-850 text-slate-300 p-2.5 rounded-lg transition-colors flex items-center justify-between"
            >
              <span>Bagaimana cara kalkulasi metode FIFO?</span>
              <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
            </button>

            <button
              onClick={() => handleAskCompanion("pmk68")}
              className="w-full text-left text-[11px] bg-slate-950 hover:bg-slate-900 border border-slate-850 text-slate-300 p-2.5 rounded-lg transition-colors flex items-center justify-between"
            >
              <span>Berapa penarikan Pajak Kripto (PMK-68)?</span>
              <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
            </button>

            <button
              onClick={() => handleAskCompanion("pnl")}
              className="w-full text-left text-[11px] bg-slate-950 hover:bg-slate-900 border border-slate-850 text-slate-300 p-2.5 rounded-lg transition-colors flex items-center justify-between"
            >
              <span>Apa perbedaan Realized vs Floating PnL?</span>
              <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
