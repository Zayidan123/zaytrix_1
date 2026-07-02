import React, { useState, useMemo } from "react";
import { 
  BarChart3, 
  Play, 
  TrendingUp, 
  TrendingDown, 
  Activity,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal
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
import { Asset, PriceHistoryPoint, BacktestResult, BacktestTrade, EquityPoint } from "../types";

interface BacktesterProps {
  assets: Asset[];
}

export default function Backtester({ assets }: BacktesterProps) {
  const [targetSymbol, setTargetSymbol] = useState("BTC");
  const [strategy, setStrategy] = useState("SMA_CROSSOVER"); // SMA_CROSSOVER vs RSI_SWING vs BUY_HODL
  const [initialCapital, setInitialCapital] = useState("10000000"); // 10 juta IDR/USD base
  const [feeRate, setFeeRate] = useState("0.15"); // % per transaction
  
  // Backtest result states
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [comparisonResults, setComparisonResults] = useState<{
    name: string;
    label: string;
    roi: number;
    finalBalance: number;
    totalTrades: number;
  }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  // Virtualization / Sliding Window state for high-performance transaction table rendering
  const [tradePage, setTradePage] = useState(1);
  const [tradePageSize, setTradePageSize] = useState(10);
  const [tradeSearchQuery, setTradeSearchQuery] = useState("");
  const [tradeTypeFilter, setTradeTypeFilter] = useState("ALL");

  const selectedAsset = assets.find(a => a.symbol === targetSymbol) || assets[0];
  const isCrypto = selectedAsset?.category === 'crypto';

  // Format currency helpers
  const formatVal = (val: number, isAssetCrypto: boolean) => {
    if (isAssetCrypto) {
      return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(val);
  };

  // Local simulation execution module to handle cross-strategy backtests safely
  const runSimulation = (
    history: PriceHistoryPoint[],
    strategyName: string,
    cap: number,
    feeMultiplier: number
  ) => {
    let balance = cap;
    let holdings = 0;
    const trades: BacktestTrade[] = [];
    const equityCurve: EquityPoint[] = [];
    let lastTradePrice = history[0]?.close || 1;

    for (let i = 0; i < history.length; i++) {
      const point = history[i];
      const close = point.close;
      const date = point.date;
      const sma = point.sma || close;
      const rsi = point.rsi || 50;

      let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

      // Bollinger Band calculation
      let lowerBand = close * 0.95;
      let upperBand = close * 1.05;
      if (i >= 20) {
        const slice = history.slice(i - 19, i + 1);
        const mean = slice.reduce((sum, p) => sum + p.close, 0) / 20;
        const variance = slice.reduce((sum, p) => sum + Math.pow(p.close - mean, 2), 0) / 20;
        const stdDev = Math.sqrt(variance);
        lowerBand = mean - 2 * stdDev;
        upperBand = mean + 2 * stdDev;
      }

      if (strategyName === "SMA_CROSSOVER") {
        if (close > sma && holdings === 0) {
          action = 'BUY';
        } else if (close < sma && holdings > 0) {
          action = 'SELL';
        }
      } else if (strategyName === "RSI_SWING") {
        if (rsi < 35 && holdings === 0) {
          action = 'BUY';
        } else if (rsi > 65 && holdings > 0) {
          action = 'SELL';
        }
      } else if (strategyName === "RSI_BOLLINGER") {
        // Buy when RSI < 35 and close touches lower Bollinger Band
        if (rsi < 35 && close <= lowerBand && holdings === 0) {
          action = 'BUY';
        } 
        // Sell when RSI > 65 and close touches upper Bollinger Band
        else if (rsi > 65 && close >= upperBand && holdings > 0) {
          action = 'SELL';
        }
      } else if (strategyName === "BUY_HODL") {
        if (i === 0 && holdings === 0) {
          action = 'BUY';
        } else if (i === history.length - 1 && holdings > 0) {
          action = 'SELL';
        }
      } else if (strategyName === "DCA") {
        // Dollar Cost Averaging: buy periodically e.g., every 7 days
        const dcaInterval = 7;
        if (i % dcaInterval === 0 && balance > 0) {
          const spend = Math.min(balance, cap * 0.1); // invest 10% of capital at a time
          if (spend > 10) { // minimum purchase threshold
            const fee = spend * feeMultiplier;
            const bought = (spend - fee) / close;
            holdings += bought;
            balance -= spend;
            trades.push({
              type: 'BUY',
              price: close,
              date,
              amount: bought,
              balanceAfter: balance
            });
          }
        }
        // Sell all at the very end to lock in final wealth
        if (i === history.length - 1 && holdings > 0) {
          action = 'SELL';
        }
      } else if (strategyName === "GRID_TRADING") {
        if (i === 0) {
          // Initialize grid seed allocation
          const spend = balance * 0.4; // 40% initial deployment
          const fee = spend * feeMultiplier;
          holdings = (spend - fee) / close;
          balance -= spend;
          lastTradePrice = close;
          trades.push({
            type: 'BUY',
            price: close,
            date,
            amount: holdings,
            balanceAfter: balance
          });
        } else {
          const pctDiff = ((close - lastTradePrice) / lastTradePrice) * 100;
          if (pctDiff <= -4.0 && balance >= cap * 0.15) { // buy on 4% dip
            const spend = cap * 0.15;
            const fee = spend * feeMultiplier;
            const bought = (spend - fee) / close;
            holdings += bought;
            balance -= spend;
            lastTradePrice = close;
            trades.push({
              type: 'BUY',
              price: close,
              date,
              amount: bought,
              balanceAfter: balance
            });
          } else if (pctDiff >= 4.0 && holdings > 0) { // profit-take on 4% rally
            const sellQty = holdings * 0.3; // liquidate 30% of holdings grid leg
            const saleValue = sellQty * close;
            const fee = saleValue * feeMultiplier;
            balance += (saleValue - fee);
            holdings -= sellQty;
            lastTradePrice = close;
            trades.push({
              type: 'SELL',
              price: close,
              date,
              amount: sellQty,
              balanceAfter: balance
            });
          }
        }
        // Sell remaining grid components at last point
        if (i === history.length - 1 && holdings > 0) {
          action = 'SELL';
        }
      }

      if (action === 'BUY') {
        const cost = balance;
        const fee = cost * feeMultiplier;
        const netCost = cost - fee;
        holdings = netCost / close;
        balance = 0;
        trades.push({
          type: 'BUY',
          price: close,
          date,
          amount: holdings,
          balanceAfter: 0
        });
      } else if (action === 'SELL') {
        const saleValue = holdings * close;
        const fee = saleValue * feeMultiplier;
        const netReceipt = saleValue - fee;
        balance = balance + netReceipt; // Secure: aggregate into existing cash reserve
        holdings = 0;
        trades.push({
          type: 'SELL',
          price: close,
          date,
          amount: 0,
          balanceAfter: balance
        });
      }

      const currentEquityValue = balance + (holdings * close);
      equityCurve.push({
        date,
        balance: parseFloat(currentEquityValue.toFixed(2)),
        assetPrice: close
      });
    }

    if (holdings > 0) {
      const lastClose = history[history.length - 1].close;
      const saleValue = holdings * lastClose;
      const fee = saleValue * feeMultiplier;
      balance = balance + (saleValue - fee);
      holdings = 0;
      trades.push({
        type: 'SELL',
        price: lastClose,
        date: history[history.length - 1].date,
        amount: 0,
        balanceAfter: balance
      });
    }

    const finalVal = balance;
    const roi = ((finalVal - cap) / cap) * 100;
    
    let winners = 0;
    let totalClosedTrades = 0;
    let buyPriceTemp = 0;
    trades.forEach((tr) => {
      if (tr.type === 'BUY') {
        buyPriceTemp = tr.price;
      } else if (tr.type === 'SELL' && buyPriceTemp > 0) {
        totalClosedTrades++;
        if (tr.price > buyPriceTemp) {
          winners++;
        }
        buyPriceTemp = 0;
      }
    });

    const winRate = totalClosedTrades > 0 ? (winners / totalClosedTrades) * 100 : 0;
    
    // Mathematical Max Drawdown calculation over the actual equity curve points
    let maxDrawdown = 0;
    let peak = cap;
    equityCurve.forEach(pt => {
      if (pt.balance > peak) {
        peak = pt.balance;
      }
      const dd = peak > 0 ? ((peak - pt.balance) / peak) * 100 : 0;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
      }
    });

    // Real drawdown is reported as-is. Do NOT fabricate values when 0.
    maxDrawdown = parseFloat(maxDrawdown.toFixed(2));

    return {
      roi,
      finalBalance: finalVal,
      totalTrades: trades.length,
      winningTrades: winners,
      winRate,
      maxDrawdown,
      trades,
      equityCurve
    };
  };

  // Run backtesting logic after fetching actual history endpoint from server
  const handleRunBacktest = async () => {
    setIsLoading(true);
    setErrorText("");
    setBacktestResult(null);
    setComparisonResults([]);

    try {
      const res = await fetch(`/api/history/${targetSymbol}`);
      if (!res.ok) {
        throw new Error("Gagal mengunduh riwayat historis harga dari server.");
      }
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Format data yang diterima dari server tidak valid (bukan JSON).");
      }
      const data = await res.json();
      const history: PriceHistoryPoint[] = data.history;

      if (!history || history.length === 0) {
        throw new Error("Data harga kosong dari server.");
      }

      const cap = parseFloat(initialCapital) || 1000000;
      const feeMultiplier = (parseFloat(feeRate) || 0) / 100;
      
      // Calculate full primary backtest
      const primarySim = runSimulation(history, strategy, cap, feeMultiplier);

      setBacktestResult({
        symbol: targetSymbol,
        strategyName: strategy,
        initialBalance: cap,
        finalBalance: primarySim.finalBalance,
        roi: primarySim.roi,
        totalTrades: primarySim.totalTrades,
        winningTrades: primarySim.winningTrades,
        maxDrawdown: primarySim.maxDrawdown,
        winRate: primarySim.winRate,
        trades: primarySim.trades,
        equityCurve: primarySim.equityCurve
      });

      // Calculate comparison strategies
      const allStrategies = [
        { name: "SMA_CROSSOVER", label: "SMA Crossover (Pergeseran Tren)" },
        { name: "RSI_SWING", label: "RSI Swings (Oversold/Overbought)" },
        { name: "RSI_BOLLINGER", label: "RSI & Bollinger Reversal (Cooperative)" },
        { name: "BUY_HODL", label: "Passive Buy & Hold" },
        { name: "DCA", label: "Dollar Cost Averaging (DCA)" },
        { name: "GRID_TRADING", label: "Grid Trading Bot (Buy Dip / Sell Rally)" }
      ];

      const comparisons = allStrategies.map(strat => {
        const sim = runSimulation(history, strat.name, cap, feeMultiplier);
        return {
          name: strat.name,
          label: strat.label,
          roi: sim.roi,
          finalBalance: sim.finalBalance,
          totalTrades: sim.totalTrades
        };
      });

      setComparisonResults(comparisons);
      setTradePage(1);

    } catch (err: any) {
      setErrorText(err.message || "Gagal memproses pengujian strategi.");
    } finally {
      setIsLoading(false);
    }
  };

  // Memoized virtualized window calculations (sliding window and filters)
  const filteredTrades = useMemo(() => {
    if (!backtestResult || !backtestResult.trades) return [];
    return backtestResult.trades.filter((tr) => {
      // 1. Filter by Signal Type (BUY / SELL / ALL)
      if (tradeTypeFilter !== "ALL" && tr.type !== tradeTypeFilter) {
        return false;
      }
      // 2. Filter by search query (date, price or index)
      if (tradeSearchQuery.trim()) {
        const query = tradeSearchQuery.toLowerCase().trim();
        return tr.date.toLowerCase().includes(query) || tr.price.toString().includes(query);
      }
      return true;
    });
  }, [backtestResult, tradeTypeFilter, tradeSearchQuery]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredTrades.length / tradePageSize));
  }, [filteredTrades.length, tradePageSize]);

  // Safely bound the active page index 
  const activePage = useMemo(() => {
    return Math.min(tradePage, totalPages) || 1;
  }, [tradePage, totalPages]);

  const paginatedTrades = useMemo(() => {
    const startIndex = (activePage - 1) * tradePageSize;
    return filteredTrades.slice(startIndex, startIndex + tradePageSize);
  }, [filteredTrades, activePage, tradePageSize]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setTradePage(newPage);
    }
  };

  return (
    <div className="space-y-6" id="backtester-tab">
      {/* Top Welcome Title */}
      <div className="bg-[#0F172A] p-4 sm:p-6 rounded-2xl border border-slate-800">
        <h2 className="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" /> Penguji Strategi Historis (Backtester)
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          Lakukan backtest strategi bertransaksi kuantitatif berbasis data historis asli di rentang 100 hari perdagangan bursa terakhir.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left column: Setup controls */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
          <h3 className="text-sm sm:text-md font-bold text-slate-200">Parameter Pengujian Historis</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">PILIH ASET ASAL</label>
              <select
                value={targetSymbol}
                onChange={(e) => setTargetSymbol(e.target.value)}
                id="backtest-asset-select"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.symbol}>{asset.symbol} - {asset.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">STRATEGI ALGORITMIK</label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                id="backtest-strategy-select"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="SMA_CROSSOVER">SMA (15) Crossover (Pergeseran Tren)</option>
                <option value="RSI_SWING">RSI Swings (Oversold &lt; 35 / Overbought &gt; 65)</option>
                <option value="RSI_BOLLINGER">RSI &amp; Bollinger Band Cooperative Reversal</option>
                <option value="BUY_HODL">Passive Buy & Hold (Beli & HODL Biasa)</option>
                <option value="DCA">Regular DCA (Dollar Cost Averaging Berkala)</option>
                <option value="GRID_TRADING">Grid Trading Bot (Eksekusi Batas Jaring Dinamis)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">MODAL AWAL PENGUJIAN</label>
              <input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(e.target.value)}
                id="backtest-capital-input"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">BIAYA TRANSAKSI BROKER (%)</label>
              <input
                type="number"
                step="0.01"
                value={feeRate}
                onChange={(e) => setFeeRate(e.target.value)}
                id="backtest-fee-input"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Biaya beli & jual mencakup retribusi pajak bursa</span>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <button
              onClick={handleRunBacktest}
              id="run-backtest-btn"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-3 rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-900/15"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Mengeksekusi Simulasi Historis...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white text-white" />
                  <span>Mulai Backtest Strategi</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right column: Results displays and curves */}
        <div className="lg:col-span-2 space-y-6">
          
          {backtestResult ? (
            <>
              {/* Stats boxes grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#0F172A] border border-slate-800 p-4 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold font-mono block">ROI AKHIR</span>
                  <div className={`text-xl font-bold mt-1 inline-flex items-center gap-1 ${
                    backtestResult.roi >= 0 ? "text-emerald-400" : "text-rose-500"
                  }`}>
                    {backtestResult.roi >= 0 ? "+" : ""}
                    {backtestResult.roi.toFixed(2)}%
                    {backtestResult.roi >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  </div>
                </div>

                <div className="bg-[#0F172A] border border-slate-800 p-4 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold font-mono block">KAPITAL AKHIR</span>
                  <div className="text-xl font-bold text-slate-205 text-slate-200 mt-1">
                    {formatVal(backtestResult.finalBalance, isCrypto)}
                  </div>
                </div>

                <div className="bg-[#0F172A] border border-slate-800 p-4 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold font-mono block">FREKUENSI TRANS.</span>
                  <div className="text-xl font-bold text-slate-205 text-slate-200 mt-1">
                    {backtestResult.totalTrades} Kali
                  </div>
                </div>

                <div className="bg-[#0F172A] border border-slate-800 p-4 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold font-mono block">WIN RATE</span>
                  <div className="text-xl font-bold text-blue-400 mt-1">
                    {backtestResult.winRate !== undefined && backtestResult.totalTrades > 0 ? (
                      `${backtestResult.winRate.toFixed(1)}%`
                    ) : "N/A"}
                  </div>
                </div>
              </div>

              {/* Equity growth chart */}
              <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-200">Kurva Pertumbuhan Nilai Kapital</h4>
                    <p className="text-xs text-slate-400">Total modal tunai + evaluasi aset di akhir perdagangan harian</p>
                  </div>
                </div>

                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <LineChart data={backtestResult.equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#475569" fontSize={10} />
                      <YAxis 
                        stroke="#475569" 
                        fontSize={9} 
                        tickFormatter={(v) => isCrypto ? `$${v.toLocaleString()}` : `Rp ${(v / 1e6).toFixed(1)}Jt`} 
                      />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                      <Legend fontSize={10} />
                      <Line type="monotone" name="Nilai Kapital" dataKey="balance" stroke="#2563eb" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Strategy Comparison Matrix */}
              {comparisonResults.length > 0 && (
                <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-550 text-blue-550 text-blue-400 animate-pulse" /> Matriks Kinerja Strategi Alternatif
                    </h4>
                    <p className="text-xs text-slate-400">
                      Simulasi instan perbandingan keuntungan bersih dengan parameter fee ({feeRate}%) yang sama pada {targetSymbol}.
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-950 text-[10px] text-slate-400 uppercase font-mono tracking-wider border-b border-slate-800">
                          <th className="p-3">Strategi Backtest</th>
                          <th className="p-3 text-right">Frekuensi Transaksi</th>
                          <th className="p-3 text-right">Hasil Akhir Kapital</th>
                          <th className="p-3 text-right">P&L Bersih (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850/60 bg-slate-900/10 font-mono">
                        {comparisonResults.map((item, idx) => {
                          const isCurrent = item.name === strategy;
                          return (
                            <tr key={idx} className={`text-xs ${isCurrent ? "bg-blue-500/10 text-blue-300 font-semibold" : "text-slate-300"} hover:bg-slate-800/40`}>
                              <td className="p-3 font-sans flex items-center gap-1.5">
                                {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                                <span>{item.label}</span>
                                {isCurrent && <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-mono font-medium">AKTIF</span>}
                              </td>
                              <td className="p-3 text-right">{item.totalTrades} transaksi</td>
                              <td className="p-3 text-right font-semibold">{formatVal(item.finalBalance, isCrypto)}</td>
                              <td className="p-3 text-right">
                                <span className={`font-bold ${item.roi >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                                  {item.roi >= 0 ? "+" : ""}{item.roi.toFixed(2)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Details trade signals list */}
              <div className="bg-[#0F172A] border border-slate-800 rounded-2xl overflow-hidden text-xs">
                
                {/* Header and Integrated Search Tools */}
                <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-800 bg-slate-950/40 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-slate-200">Riwayat Sinyal Eksekusi Diperdagangkan</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Daftar lengkap posisi trading yang diambil selama rentang pengujian. Teroptimasi dengan virtualisasi tabel.
                      </p>
                    </div>
                    
                    {/* Size Selector and Active Signal Type Filters */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center space-x-1.5 text-slate-400 text-[11px] font-mono">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                        <span>Baris:</span>
                        <select
                          value={tradePageSize}
                          onChange={(e) => {
                            setTradePageSize(Number(e.target.value));
                            setTradePage(1); // Reset to first page
                          }}
                          className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-blue-500"
                        >
                          <option value={10}>10</option>
                          <option value={20}>20</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                        </select>
                      </div>

                      {/* Filter Beli / Jual pills */}
                      <div className="flex items-center bg-slate-950 rounded border border-slate-850 p-0.5">
                        {(["ALL", "BUY", "SELL"] as const).map((type) => (
                          <button
                            key={type}
                            onClick={() => {
                              setTradeTypeFilter(type);
                              setTradePage(1);
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                              tradeTypeFilter === type
                                ? "bg-blue-600 text-white font-bold"
                                : "text-slate-400 hover:text-slate-100"
                            }`}
                          >
                            {type === "ALL" ? "Semua" : type === "BUY" ? "Beli" : "Jual"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Text Search Filter */}
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 font-semibold">
                      <Search className="w-3.5 h-3.5 text-slate-500" />
                    </span>
                    <input
                      type="text"
                      placeholder="Cari berdasarkan tanggal (YYYY-MM-DD) atau nilai harga..."
                      value={tradeSearchQuery}
                      onChange={(e) => {
                        setTradeSearchQuery(e.target.value);
                        setTradePage(1);
                      }}
                      className="w-full bg-slate-950 border border-slate-800/80 rounded-lg pl-9 pr-3 py-1.5 text-[11px] text-slate-300 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                </div>

                {/* Table Data Slice */}
                <div className="max-h-80 overflow-y-auto overflow-x-auto">
                  {paginatedTrades.length > 0 ? (
                    <table className="w-full text-left min-w-[500px]">
                      <thead>
                        <tr className="bg-slate-950/80 text-[9px] text-slate-400 uppercase font-mono tracking-wider border-b border-slate-800 sticky top-0 backdrop-blur z-10 select-none">
                          <th className="p-3">Sinyal</th>
                          <th className="p-3">Tanggal</th>
                          <th className="p-3 text-right">Harga Transaksi</th>
                          <th className="p-3 text-right">Saldo Kas Akhir</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850/60 font-mono">
                        {paginatedTrades.map((tr, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/25 text-slate-300 transition-colors">
                            <td className="p-3">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                tr.type === 'BUY' ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
                              }`}>
                                {tr.type === 'BUY' ? 'BELI' : 'JUAL'}
                              </span>
                            </td>
                            <td className="p-3 text-slate-400">{tr.date}</td>
                            <td className="p-3 text-right text-slate-200">{formatVal(tr.price, isCrypto)}</td>
                            <td className="p-3 text-right text-blue-400">{formatVal(tr.balanceAfter, isCrypto)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-8 text-center text-slate-500 font-mono">
                      {backtestResult.trades.length === 0
                        ? "Strategi tidak memicu transaksi apa pun pada periode perdagangan ini."
                        : "Tidak ada transaksi yang cocok dengan filter pencarian Anda."}
                    </div>
                  )}
                </div>

                {/* Virtualization Footer Navigation Control */}
                {filteredTrades.length > 0 && (
                  <div className="px-4 py-3 bg-[#0F172A] border-t border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[11px] font-mono text-slate-400">
                    <div>
                      Menampilkan <span className="text-slate-200 font-semibold">{Math.min((activePage - 1) * tradePageSize + 1, filteredTrades.length)}</span> s/d{" "}
                      <span className="text-slate-200 font-semibold">{Math.min(activePage * tradePageSize, filteredTrades.length)}</span> dari{" "}
                      <span className="text-slate-200 font-semibold">{filteredTrades.length}</span> transaksi{" "}
                      {filteredTrades.length !== backtestResult.trades.length && (
                        <span>(disaring dari total {backtestResult.trades.length})</span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1.5 select-none self-end sm:self-auto">
                      <button
                        onClick={() => handlePageChange(activePage - 1)}
                        disabled={activePage === 1}
                        className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer disabled:cursor-not-allowed transition-colors"
                        title="Halaman Sebelumnya"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>

                      {/* Display a compact list of page numbers */}
                      <div className="flex items-center space-x-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter((p) => {
                            // Show first page, last page, and pages near activePage
                            return p === 1 || p === totalPages || Math.abs(p - activePage) <= 1;
                          })
                          .map((p, index, arr) => {
                            const isSelected = p === activePage;
                            // Insert ellipsis if gap exists
                            const showEllipsisBefore = index > 0 && p - arr[index - 1] > 1;

                            return (
                              <React.Fragment key={p}>
                                {showEllipsisBefore && <span className="text-slate-600 px-1 font-sans">...</span>}
                                <button
                                  onClick={() => handlePageChange(p)}
                                  className={`min-w-6 h-6 px-1.5 rounded transition-colors font-semibold cursor-pointer ${
                                    isSelected
                                      ? "bg-blue-600 text-white"
                                      : "bg-slate-900 hover:bg-slate-850/80 text-slate-300 hover:text-white"
                                  }`}
                                >
                                  {p}
                                </button>
                              </React.Fragment>
                            );
                          })}
                      </div>

                      <button
                        onClick={() => handlePageChange(activePage + 1)}
                        disabled={activePage === totalPages}
                        className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer disabled:cursor-not-allowed transition-colors"
                        title="Halaman Selanjutnya"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </>
          ) : (
            <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-12 text-center text-slate-500 flex flex-col items-center justify-center min-h-[400px]">
              <div className="w-12 h-12 bg-slate-805 bg-slate-800 rounded-lg flex items-center justify-center mb-4">
                <Activity className="w-6 h-6 text-blue-500" />
              </div>
              <h4 className="text-slate-300 font-bold mb-1">Siap Menganalisis Strategi</h4>
              <p className="max-w-md text-slate-400 text-xs text-center">
                Pilih rentang parameter dan klik tombol <span className="text-blue-400 font-semibold">"Mulai Backtest"</span> untuk menarik data real-time, menghitung pergeseran Moving Average dan sinyal osilasi RSI secara mendalam.
              </p>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
