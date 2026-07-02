import React, { useEffect, useRef, useState, useMemo } from "react";
import * as d3 from "d3";
import { Info, ShieldAlert, Sparkles, AlertCircle, ArrowRightLeft, Layers, Loader2 } from "lucide-react";
import { PortfolioAsset } from "../types";

interface CorrelationHeatmapProps {
  portfolio: PortfolioAsset[];
}

interface CorrelationCell {
  x: string;
  y: string;
  value: number;
}

// Pearson correlation coefficient formula between array X and array Y
function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;
  
  let sumX = 0, sumY = 0, sumXY = 0;
  let sumXX = 0, sumYY = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumXX += x[i] * x[i];
    sumYY += y[i] * y[i];
  }
  
  const num = (n * sumXY) - (sumX * sumY);
  const den = Math.sqrt(((n * sumXX) - (sumX * sumX)) * ((n * sumYY) - (sumY * sumY)));
  
  if (den === 0) return 0;
  return num / den;
}

export default function CorrelationHeatmap({ portfolio }: CorrelationHeatmapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(450);
  const [showDemo, setShowDemo] = useState(false);
  const [historyCache, setHistoryCache] = useState<Record<string, { date: string; close: number }[]>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  // True when live history fetch failed or returned insufficient data and the
  // matrix is therefore showing deterministic fallback coefficients.
  const [usingFallback, setUsingFallback] = useState(false);

  // Fallback benchmark assets when user portfolio is empty or has < 2 unique tickers
  const benchmarkAssets = useMemo(() => [
    { symbol: "BTC", category: "crypto" },
    { symbol: "ETH", category: "crypto" },
    { symbol: "BBCA", category: "stock" },
    { symbol: "BBRI", category: "stock" },
    { symbol: "TLKM", category: "stock" },
    { symbol: "GOTO", category: "stock" }
  ], []);

  // Determine unique assets list to use for the correlation matrix
  const assetsToUse = useMemo(() => {
    const uniqueSymbols = Array.from(new Set(portfolio.map(p => p.symbol.toUpperCase())));
    
    // If fewer than 2 unique assets or showDemo is explicitly on, show benchmark real list
    if (uniqueSymbols.length < 2 || showDemo) {
      return benchmarkAssets;
    }
    
    return uniqueSymbols.map(sym => {
      const match = portfolio.find(p => p.symbol.toUpperCase() === sym);
      return {
        symbol: sym,
        category: match ? match.category : "crypto"
      };
    });
  }, [portfolio, showDemo, benchmarkAssets]);

  // Load actual price histories from server dynamically
  useEffect(() => {
    let active = true;
    const symbols = assetsToUse.map(a => a.symbol);
    if (symbols.length === 0) return;

    const fetchAllHistories = async () => {
      setLoadingHistory(true);
      try {
        const fetches = symbols.map(async (sym) => {
          const res = await fetch(`/api/history/${sym}`);
          if (!res.ok) throw new Error(`HTTP error ${res.status}`);
          const data = await res.json();
          return { symbol: sym, history: data.history || [] };
        });

        const results = await Promise.all(fetches);
        if (!active) return;

        const newCache: Record<string, { date: string; close: number }[]> = {};
        results.forEach(res => {
          newCache[res.symbol] = res.history;
        });
        setHistoryCache(newCache);
        // If every fetched history is empty/insufficient, the matrix will rely
        // on the deterministic fallback. Surface that to the user.
        const insufficient = results.every(res => !res.history || res.history.length < 5);
        setUsingFallback(insufficient);
      } catch (err) {
        console.log("Error loading real historical correlations:", err);
        if (active) setUsingFallback(true);
      } finally {
        if (active) {
          setLoadingHistory(false);
        }
      }
    };

    fetchAllHistories();
    return () => {
      active = false;
    };
  }, [assetsToUse]);

  // Handle responsiveness via ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const entryWidth = entries[0].contentRect.width;
      // Keep margin boundaries
      const calculatedWidth = Math.max(300, Math.min(entryWidth - 16, 680));
      setWidth(calculatedWidth);
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Compute a deterministic, realistic fallback correlation coefficient as programming safety net if fetches lag
  const getDeterministicFallback = (aSym: string, bSym: string, aCat: string, bCat: string): number => {
    if (aSym === bSym) return 1.0;
    const key = [aSym, bSym].sort().join("-");
    const isStable = (s: string) => ["USDT", "USDC", "BUSD"].includes(s);
    if (isStable(aSym) || isStable(bSym)) {
      return parseFloat((0.02 + (key.charCodeAt(0) % 7) * 0.01 - 0.03).toFixed(2));
    }
    if (aCat === "crypto" && bCat === "crypto") {
      if ((aSym === "BTC" && bSym === "ETH") || (aSym === "ETH" && bSym === "BTC")) return 0.84;
      return parseFloat((0.68 + (key.charCodeAt(0) % 9) * 0.02).toFixed(2));
    }
    if (aCat === "stock" && bCat === "stock") {
      const isBank = (s: string) => ["BBCA", "BMRI", "BBRI", "BBNI"].includes(s);
      if (isBank(aSym) && isBank(bSym)) return parseFloat((0.72 + (key.charCodeAt(0) % 5) * 0.02).toFixed(2));
      return parseFloat((0.45 + (key.charCodeAt(1) % 11) * 0.03).toFixed(2));
    }
    return parseFloat((0.05 + (key.charCodeAt(0) % 15) * 0.01 - 0.12).toFixed(2));
  };

  // Compute live mathematical correlation coefficient from caches
  const getCorrelation = (aSym: string, aCat: string, bSym: string, bCat: string): number => {
    if (aSym === bSym) return 1.0;
    
    const histA = historyCache[aSym];
    const histB = historyCache[bSym];

    if (!histA || !histB || histA.length === 0 || histB.length === 0) {
      return getDeterministicFallback(aSym, bSym, aCat, bCat);
    }

    // Align both asset daily closing price histories date-by-date
    const mapA = new Map(histA.map(p => [p.date, p.close]));
    const mapB = new Map(histB.map(p => [p.date, p.close]));

    const commonDates = histA
      .map(p => p.date)
      .filter(date => mapB.has(date))
      .sort();

    if (commonDates.length < 5) {
      // Direct element alignment if tickers possess mismatching trading calendars 
      const len = Math.min(histA.length, histB.length);
      const x = histA.slice(-len).map(p => p.close);
      const y = histB.slice(-len).map(p => p.close);
      return parseFloat(calculatePearsonCorrelation(x, y).toFixed(2));
    }

    const x = commonDates.map(d => mapA.get(d) as number);
    const y = commonDates.map(d => mapB.get(d) as number);

    return parseFloat(calculatePearsonCorrelation(x, y).toFixed(2));
  };

  // Generate Matrix Cells
  const matrixData = useMemo(() => {
    const data: CorrelationCell[] = [];
    assetsToUse.forEach((row) => {
      assetsToUse.forEach((col) => {
        data.push({
          x: row.symbol,
          y: col.symbol,
          value: getCorrelation(row.symbol, row.category, col.symbol, col.category)
        });
      });
    });
    return data;
  }, [assetsToUse, historyCache]);

  // Compute portfolio average correlation score
  const { avgCorrelation, maxCorrelationPair, minCorrelationPair, diversificationLevel } = useMemo(() => {
    let sum = 0;
    let count = 0;
    let maxVal = -2;
    let minVal = 2;
    let maxStr = "N/A";
    let minStr = "N/A";

    matrixData.forEach((cell) => {
      if (cell.x !== cell.y) {
        sum += cell.value;
        count++;

        if (cell.value > maxVal) {
          maxVal = cell.value;
          maxStr = `${cell.x} ↔ ${cell.y} (${cell.value.toFixed(2)})`;
        }
        if (cell.value < minVal) {
          minVal = cell.value;
          minStr = `${cell.x} ↔ ${cell.y} (${cell.value.toFixed(2)})`;
        }
      }
    });

    const avg = count > 0 ? sum / count : 1.0;

    let divLevel = "Sangat Spesulatif / Terkonsentrasi";
    if (avg < 0.2) {
      divLevel = "Sangat Optimal (Diversifikasi Sempurna)";
    } else if (avg < 0.4) {
      divLevel = "Baik / Ter-diversifikasi";
    } else if (avg < 0.6) {
      divLevel = "Moderat (Risiko Sektoral Terpusat)";
    }

    return {
      avgCorrelation: parseFloat(avg.toFixed(2)),
      maxCorrelationPair: maxStr,
      minCorrelationPair: minStr,
      diversificationLevel: divLevel
    };
  }, [matrixData]);

  // Draw Heatmap inside SVG via D3
  useEffect(() => {
    if (!svgRef.current) return;

    // Clear previous elements
    d3.select(svgRef.current).selectAll("*").remove();

    const symbols = assetsToUse.map(a => a.symbol);
    const n = symbols.length;

    // Dynamic sizing based on grid capacity
    const margin = { top: 40, right: 20, bottom: 40, left: 55 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = Math.max(260, Math.min(360, width - 40)) - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current)
      .attr("width", chartWidth + margin.left + margin.right)
      .attr("height", chartHeight + margin.top + margin.bottom)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Scale axes
    const xScale = d3.scaleBand()
      .range([0, chartWidth])
      .domain(symbols)
      .padding(0.04);

    const yScale = d3.scaleBand()
      .range([chartHeight, 0])
      .domain(symbols)
      .padding(0.04);

    // Color scale for Correlation (-1 to +1)
    // Dark Red (negative, -1.0) -> Slate (0) -> Rich Gold/Amber (positive, +1.0)
    const colorScale = d3.scaleLinear<string>()
      .domain([-1.0, 0.0, 1.0])
      .range(["#f43f5e", "#1e293b", "#eab308"]);

    // Tooltip creation
    const tooltipDiv = d3.select("body").selectAll(".d3-correlation-tooltip")
      .data([0])
      .join("div")
      .attr("class", "d3-correlation-tooltip")
      .style("position", "absolute")
      .style("visibility", "hidden")
      .style("background-color", "#0f172a")
      .style("border", "1px solid #334155")
      .style("color", "#f8fafc")
      .style("padding", "8px 12px")
      .style("border-radius", "8px")
      .style("font-size", "11px")
      .style("font-family", "monospace")
      .style("z-index", "9999")
      .style("pointer-events", "none")
      .style("box-shadow", "0 10px 15px -3px rgba(0,0,0,0.4)");

    // Draw grid cells
    svg.selectAll()
      .data(matrixData)
      .enter()
      .append("rect")
      .attr("x", d => xScale(d.x) || 0)
      .attr("y", d => yScale(d.y) || 0)
      .attr("width", xScale.bandwidth())
      .attr("height", yScale.bandwidth())
      .attr("rx", 4)
      .attr("ry", 4)
      .style("fill", d => colorScale(d.value))
      .style("stroke", "#0f172a")
      .style("stroke-width", 2.2)
      .style("cursor", "crosshair")
      .style("opacity", 0)
      .transition()
      .duration(600)
      .delay((_d, i) => Math.floor(i / n) * 40)
      .style("opacity", 1);

    // Interactive behaviors on cells
    svg.selectAll("rect")
      .on("mouseover", function (event, dItem: any) {
        d3.select(this)
          .style("stroke", "#38bdf8")
          .style("stroke-width", 2.5);

        const textContent = `
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-4 font-bold border-b border-slate-800 pb-1 mb-1">
              <span class="text-slate-200 font-sans text-xs">${dItem.x} ↔ ${dItem.y}</span>
            </div>
            <div>Koefisien Korelasi: <span class="font-bold ${dItem.value > 0.5 ? 'text-amber-400' : dItem.value < 0 ? 'text-rose-400' : 'text-slate-300'}">${dItem.value.toFixed(2)}</span></div>
            <div class="text-[10px] text-slate-400 font-sans mt-1">
              ${dItem.x === dItem.y 
                ? "Korelasi diri sempurna." 
                : dItem.value > 0.7 
                ? "Korelasi kuat. Bergerak searah, mengurangi tingkat perlindungan." 
                : dItem.value < 0.1 
                ? "Sangat terdiversifikasi. Gerak harga independen/berlawanan." 
                : "Korelasi moderat."}
            </div>
          </div>
        `;

        tooltipDiv.html(textContent)
          .style("visibility", "visible");
      })
      .on("mousemove", function (event) {
        tooltipDiv
          .style("top", (event.pageY - 10) + "px")
          .style("left", (event.pageX + 18) + "px");
      })
      .on("mouseleave", function () {
        d3.select(this)
          .style("stroke", "#0f172a")
          .style("stroke-width", 2.2);

        tooltipDiv.style("visibility", "hidden");
      });

    // Write numerical values inside cells
    svg.selectAll()
      .data(matrixData)
      .enter()
      .append("text")
      .attr("x", d => (xScale(d.x) || 0) + xScale.bandwidth() / 2)
      .attr("y", d => (yScale(d.y) || 0) + yScale.bandwidth() / 2 + 4)
      .attr("text-anchor", "middle")
      .style("font-size", () => n > 6 ? "9px" : "10px")
      .style("font-family", "monospace")
      .style("font-weight", "bold")
      .style("fill", d => {
        // High contrast logic
        if (d.value > 0.6) return "#000000";
        if (d.value < -0.3) return "#000000";
        return "#ffffff";
      })
      .style("pointer-events", "none")
      .text(d => d.value.toFixed(2));

    // Render original Axes
    const xAxis = d3.axisBottom(xScale).tickSize(3);
    const yAxis = d3.axisLeft(yScale).tickSize(3);

    svg.append("g")
      .attr("transform", `translate(0,${chartHeight})`)
      .call(xAxis)
      .selectAll("text")
      .style("fill", "#cbd5e1")
      .style("font-weight", "500")
      .style("font-size", () => n > 6 ? "9px" : "10px")
      .style("font-family", "monospace");

    svg.append("g")
      .call(yAxis)
      .selectAll("text")
      .style("fill", "#cbd5e1")
      .style("font-weight", "500")
      .style("font-size", () => n > 6 ? "9px" : "10px")
      .style("font-family", "monospace");

    // Remove domains axes borders
    svg.selectAll(".domain").style("stroke", "#334155").style("stroke-width", "1px");
    svg.selectAll("line").style("stroke", "#334155");

  }, [matrixData, width, assetsToUse]);

  return (
    <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-6" id="correlation-panel">
      
      {/* Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-3">
        <div>
          <div className="flex items-center space-x-1.5 text-amber-500 font-mono text-[10px] font-bold tracking-widest uppercase mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Matriks Korelasi D3.js</span>
          </div>
          <h3 className="text-sm sm:text-md font-bold text-slate-100 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-amber-500" />
            <span>Peta Korelasi Diversifikasi Aset</span>
            {usingFallback && !loadingHistory && (
              <span
                className="ml-1 text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30"
                title="Data riwayat harga tidak tersedia atau gagal dimuat. Nilai korelasi ditampilkan sebagai estimasi deterministik (bukan kalkulasi riil Pearson)."
              >
                ESTIMATED
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Mengidentifikasi tingkat integrasi harga harian antar instrumen bursa (IHSG) dan kripto di portofolio Anda.
          </p>
        </div>
        
        {portfolio.length >= 2 && (
          <button
            onClick={() => setShowDemo(!showDemo)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded transition-all font-semibold ${
              showDemo
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "bg-slate-950 text-slate-400 border border-slate-850 hover:text-slate-200"
            }`}
          >
            <ArrowRightLeft className="w-3 h-3" />
            <span>{showDemo ? "Lihat Portofolio Anda" : "Lihat Benchmark Pasar Utama"}</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        
        {/* Heatmap stage container */}
        <div className="lg:col-span-7 space-y-4" ref={containerRef}>
          
          {/* Internal notification if user is viewing a fallback demo */}
          {(portfolio.length < 2 || showDemo) && (
            <div className="px-3.5 py-2.5 bg-slate-950 rounded-xl border border-slate-800 flex items-start gap-2.5 text-[11px] text-slate-400 leading-relaxed">
              <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <span className="text-amber-400 font-bold">Benchmark Pasar Utama Aktif:</span> Menampilkan data korelasi matematis riil dari aset-aset terkemuka. Tambahkan minimal <span className="font-semibold text-slate-200">2 instrumen unik</span> ke portofolio Anda untuk mengukur korelasi harian aset riil Anda sendiri!
              </div>
            </div>
          )}

          {/* Core SVG Render Box */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-850 flex flex-col items-center justify-center overflow-x-auto min-h-[280px] relative">
            {loadingHistory && (
              <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-[2px] flex flex-col items-center justify-center space-y-2 text-xs text-amber-400 font-mono z-10 rounded-xl">
                <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                <span>Mengkalkulasi Riwayat Korelasi Riil...</span>
              </div>
            )}
            <svg ref={svgRef} className="select-none mx-auto" />
          </div>

          {/* D3 Heatmap Legend */}
          <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono px-2 select-none">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-[#f43f5e]" />
              <span>Negatif (-1.0)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-[#1e293b]" />
              <span>Netral / Independen (0.0)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-[#eab308]" />
              <span>Positif Kuat (+1.0)</span>
            </div>
          </div>
        </div>

        {/* Intelligence breakdown & asset advice */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-950/40 p-4 sm:p-5 rounded-2xl border border-slate-850 space-y-4">
            
            {/* Health Score and status info */}
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-mono font-bold block mb-1">Rekomendasi Struktur Korelasi</span>
              <div className="flex items-center gap-2">
                <div className={`px-2.5 py-1 rounded text-xs font-bold font-mono uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20`}>
                  PDI: {avgCorrelation.toFixed(2)} Avg
                </div>
                <p className="text-[11px] text-slate-300 font-semibold truncate" title={diversificationLevel}>
                  {diversificationLevel}
                </p>
              </div>
            </div>

            {/* Diagnostic stats list */}
            <div className="space-y-2 border-t border-slate-850/70 pt-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Total Aset Teramati:</span>
                <span className="font-mono text-slate-200 font-bold bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                  {assetsToUse.length} Instrumen
                </span>
              </div>
              
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400 truncate" title="Pasangan aset dengan korelasi tertinggi">Korelasi Tertinggi:</span>
                <span className="font-mono text-amber-500 text-[10.5px] font-bold bg-amber-500/5 px-2 py-0.5 rounded max-w-[180px] truncate" title={maxCorrelationPair}>
                  {maxCorrelationPair}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400 truncate" title="Pasangan aset dengan diversifikasi optimal">Diversifikasi Terbaik:</span>
                <span className="font-mono text-rose-400 text-[10.5px] font-bold bg-rose-500/5 px-2 py-0.5 rounded max-w-[180px] truncate" title={minCorrelationPair}>
                  {minCorrelationPair}
                </span>
              </div>
            </div>

            {/* Rich Advisor Card based on current values */}
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-blue-400 font-bold">
                <ShieldAlert className="w-3.5 h-3.5 animate-pulse shrink-0" />
                <span className="text-[11px] font-mono uppercase tracking-wider">Evaluasi Aliansi Portofolio</span>
              </div>
              
              <p className="text-slate-400 text-[11px] leading-relaxed">
                {avgCorrelation > 0.6 ? (
                  <span>Aset Anda terkonsentrasi kuat ({avgCorrelation.toFixed(2)}). Kejatuhan pasar di satu sektor akan mencederai seluruh nilai portofolio Anda. Disarankan menambahkan emas digital atau <span className="text-rose-400 font-bold">Kategori Kripto / Saham Logistik</span> yang tidak berkorelasi linier.</span>
                ) : avgCorrelation < 0.25 ? (
                  <span>Matriks korelasi harian Anda berada pada rasio optimal ({avgCorrelation.toFixed(2)}). Anda memiliki diversifikasi hibrida yang sangat solid antara korporasi tradisional Indonesia dan pasar koin global. Lanjutkan pertahanan kas ini!</span>
                ) : (
                  <span>Portofolio Anda memiliki korelasi moderat ({avgCorrelation.toFixed(2)}). Sebagian besar gejolak sektor keuangan global berhasil diredam oleh aset regional non-bank Anda. Kombinasi yang berimbang dan terkendali.</span>
                )}
              </p>
            </div>

            {/* Quick tips */}
            <div className="flex items-start gap-1.5 text-[9.5px] text-slate-500 leading-normal">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-500" />
              <span>Arahkan kursor Anda ke sel heatmap di samping untuk menelusuri detail profil korelasi silang real-time.</span>
            </div>

          </div>
        </div>
        
      </div>
    </div>
  );
}
