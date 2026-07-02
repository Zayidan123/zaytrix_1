import React, { useState, useEffect, useMemo } from "react";
import { 
  Bell, 
  Settings, 
  Octagon, 
  HelpCircle, 
  Eye, 
  Plus, 
  Trash2, 
  Sparkles,
  X,
  Volume2,
  TrendingUp,
  Share2,
  Lock,
  Cpu,
  Mail,
  Smartphone
} from "lucide-react";
import { Asset, AlertConfig } from "../types";
import { useGlobalStore } from "../store";
import { sendAlertSecurely } from "../services/webhookService";
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  BarChart,
  Bar,
  XAxis, 
  YAxis, 
  Tooltip, 
  ReferenceLine,
  CartesianGrid
} from "recharts";

interface TechnicalTerminalProps {
  assets: Asset[];
  alerts: AlertConfig[];
  onAddAlert: (alert: Omit<AlertConfig, 'id' | 'createdAt'>) => void;
  onRemoveAlert: (id: string) => void;
  triggerSystemNotification: (message: string, isDrastic?: boolean) => void;
}

export default function TechnicalTerminal({ 
  assets, 
  alerts, 
  onAddAlert, 
  onRemoveAlert, 
  triggerSystemNotification 
}: TechnicalTerminalProps) {
  const [selectedSymbol, setSelectedSymbol] = useState("BTC");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [alertIntensity, setAlertIntensity] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');

  // Multipliers or indicator params
  const [smaPeriod, setSmaPeriod] = useState("14");
  const [rsiPeriod, setRsiPeriod] = useState("14");
  const [bollingerStd, setBollingerStd] = useState("2.0");

  const selectedAsset = assets.find(a => a.symbol === selectedSymbol) || assets[0];
  const isCrypto = selectedAsset?.category === 'crypto';

  // Advanced Charting states
  const [isDrawingTrendLine, setIsDrawingTrendLine] = useState(false);
  const [trendLines, setTrendLines] = useState<{ id: string; p1: { index: number; price: number }; p2: { index: number; price: number } }[]>([]);
  const [activeFibonacci, setActiveFibonacci] = useState(false);
  const [tempPoints, setTempPoints] = useState<{ index: number; price: number }[]>([]);

  // Multi-Channel Notifications Configuration
  const notificationConfig = useGlobalStore(state => state.notificationConfig);
  const updateNotificationConfig = useGlobalStore(state => state.updateNotificationConfig);

  const webPushEnabled = notificationConfig.webPushEnabled;
  const setWebPushEnabled = (val: boolean) => updateNotificationConfig({ webPushEnabled: val });

  const telegramEnabled = notificationConfig.telegramEnabled;
  const setTelegramEnabled = (val: boolean) => updateNotificationConfig({ telegramEnabled: val });

  const telegramBotToken = notificationConfig.telegramBotToken;
  const setTelegramBotToken = (val: string) => updateNotificationConfig({ telegramBotToken: val });

  const telegramChatId = notificationConfig.telegramChatId;
  const setTelegramChatId = (val: string) => updateNotificationConfig({ telegramChatId: val });

  const discordEnabled = notificationConfig.discordEnabled;
  const setDiscordEnabled = (val: boolean) => updateNotificationConfig({ discordEnabled: val });

  const discordWebhookUrl = notificationConfig.discordWebhookUrl;
  const setDiscordWebhookUrl = (val: string) => updateNotificationConfig({ discordWebhookUrl: val });

  const whatsappEnabled = notificationConfig.whatsappEnabled || false;
  const setWhatsappEnabled = (val: boolean) => updateNotificationConfig({ whatsappEnabled: val });

  const whatsappWebhookUrl = notificationConfig.whatsappWebhookUrl || "";
  const setWhatsappWebhookUrl = (val: string) => updateNotificationConfig({ whatsappWebhookUrl: val });

  const whatsappPhoneNumber = notificationConfig.whatsappPhoneNumber || "";
  const setWhatsappPhoneNumber = (val: string) => updateNotificationConfig({ whatsappPhoneNumber: val });

  // Format IDR Helper
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

  const [history, setHistory] = useState<{ date: string; close: number }[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Dynamic history retrieval on instrument switch
  useEffect(() => {
    let active = true;
    const fetchHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const res = await fetch(`/api/history/${selectedSymbol}`);
        if (res.ok) {
          const payload = await res.json();
          if (active) {
            setHistory(payload.history || []);
          }
        }
      } catch (err) {
        console.error("Gagal memuat riwayat harga untuk terminal:", err);
      } finally {
        if (active) {
          setIsLoadingHistory(false);
        }
      }
    };
    fetchHistory();
    return () => {
      active = false;
    };
  }, [selectedSymbol]);

  // Compute live technical indicators from real historical closing prices
  const computedMetrics = React.useMemo(() => {
    const sPeriod = parseInt(smaPeriod) || 14;
    const rPeriod = parseInt(rsiPeriod) || 14;
    
    if (history.length === 0) {
      return { 
        sma: selectedAsset?.price || 0, 
        rsi: 50, 
        upperBand: (selectedAsset?.price || 0) * 1.05, 
        lowerBand: (selectedAsset?.price || 0) * 0.95 
      };
    }
    
    const lastIdx = history.length - 1;
    
    // 1. SMA calculation
    const smaSubset = history.slice(Math.max(0, lastIdx - sPeriod + 1));
    const sma = smaSubset.reduce((sum, item) => sum + item.close, 0) / smaSubset.length;
    
    // 2. RSI calculation
    let rsi = 50;
    if (history.length > rPeriod) {
      let gains = 0;
      let losses = 0;
      for (let i = history.length - rPeriod; i < history.length; i++) {
        const diff = history[i].close - history[i - 1].close;
        if (diff > 0) gains += diff;
        else losses -= diff;
      }
      if (losses === 0) {
        rsi = 100;
      } else {
        const rs = gains / losses;
        rsi = 100 - (100 / (1 + rs));
      }
    }
    
    // 3. Bollinger Bands calculation (Standard 20 SMA basis)
    const stdMultiplier = parseFloat(bollingerStd) || 2.0;
    const bSubset = history.slice(Math.max(0, lastIdx - 20 + 1));
    const bMean = bSubset.reduce((sum, item) => sum + item.close, 0) / bSubset.length;
    const variance = bSubset.reduce((sum, item) => sum + Math.pow(item.close - bMean, 2), 0) / bSubset.length;
    const stdDev = Math.sqrt(variance);
    const upperBand = bMean + (stdMultiplier * stdDev);
    const lowerBand = bMean - (stdMultiplier * stdDev);
    
    return {
      sma: parseFloat(sma.toFixed(2)),
      rsi: parseFloat(rsi.toFixed(1)),
      upperBand: parseFloat(upperBand.toFixed(2)),
      lowerBand: parseFloat(lowerBand.toFixed(2))
    };
  }, [history, smaPeriod, rsiPeriod, bollingerStd, selectedAsset]);

  // Compute calculated trading signal feedback dynamically based on customized indicators
  const technicalSentiment = React.useMemo(() => {
    const { sma, rsi, lowerBand, upperBand } = computedMetrics;
    const currentPrice = selectedAsset?.price || 0;
    
    let score = 50;
    
    // RSI sentiment impact
    if (rsi < 30) {
      score += 25; // Oversold -> strong buy bias
    } else if (rsi > 70) {
      score -= 25; // Overbought -> sell bias
    } else if (rsi < 45) {
      score += 10;
    } else if (rsi > 55) {
      score -= 10;
    }
    
    // Close relative to SMA impact
    if (currentPrice > sma) {
      score += 15;
    } else {
      score -= 15;
    }
    
    // Close relative to Bollinger Band margin impact
    if (currentPrice <= lowerBand * 1.02) {
      score += 15;
    } else if (currentPrice >= upperBand * 0.98) {
      score -= 15;
    }
    
    let sentiment: "STRONG BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG SELL" = "NEUTRAL";
    if (score >= 75) sentiment = "STRONG BUY";
    else if (score >= 55) sentiment = "BUY";
    else if (score <= 25) sentiment = "STRONG SELL";
    else if (score <= 45) sentiment = "SELL";
    else sentiment = "NEUTRAL";

    const explanation = sentiment === "STRONG BUY" || sentiment === "BUY"
      ? `Osilator RSI di level ${rsi} (area jenuh jual) & harga di atas SMA (${formatVal(sma, isCrypto)}). Margin deviasi terhadap Bollinger bawah ${formatVal(lowerBand, isCrypto)} menunjukkan titik support teknis kuat.`
      : sentiment === "STRONG SELL" || sentiment === "SELL"
      ? `Jenuh beli terdeteksi dengan RSI (${rsi}). Harga berada di bawah SMA ${smaPeriod}D (${formatVal(sma, isCrypto)}). Batas atas Bollinger deviasi ${formatVal(upperBand, isCrypto)} menunjukkan resitansi jenuh.`
      : `Indikator RSI bernilai netral ${rsi} dengan harga aset ${selectedSymbol} berkonsolidasi stabil di sekitar garis SMA (${formatVal(sma, isCrypto)}).`;

    return { sentiment, score: Math.max(5, Math.min(95, score)), explanation };
  }, [computedMetrics, selectedAsset, smaPeriod, isCrypto, selectedSymbol]);

  useEffect(() => {
    if (selectedAsset) {
      setAlertPrice(selectedAsset.price.toString());
    }
    // Only run when selectedSymbol changes to allow typing without being overridden by 600ms spot price ticks
  }, [selectedSymbol]);

  // Monitor live assets against alerts list to trigger alerts dynamically
  useEffect(() => {
    alerts.forEach(alert => {
      if (!alert.isActive) return;
      const asset = assets.find(a => a.symbol === alert.symbol);
      if (!asset) return;

      const price = asset.price;
      let isTriggered = false;

      if (alert.condition === 'ABOVE' && price >= alert.targetPrice) {
        isTriggered = true;
      } else if (alert.condition === 'BELOW' && price <= alert.targetPrice) {
        isTriggered = true;
      }

      if (isTriggered) {
        onRemoveAlert(alert.id); // Deactivate alert once triggered
        
        // Formulate push alert notification text based on intensity
        let intensityText = "Moderat";
        if (alert.intensity === 'LOW') intensityText = "Konservatif (Sensitivitas Rendah)";
        if (alert.intensity === 'HIGH') intensityText = "Agresif (Sensitivitas Tinggi)";

        const messageText = `ALERTA PASAR: ${alert.symbol} telah mencapai target ${alert.condition === 'ABOVE' ? 'DI ATAS' : 'DI BAWAH'} ${formatVal(alert.targetPrice, asset.category === 'crypto')}. Intensitas pengawasan: ${intensityText}`;

        triggerSystemNotification(messageText, false);

        // 1. Web Push Notification
        if (webPushEnabled && typeof window !== "undefined" && "Notification" in window) {
          try {
            if (Notification.permission === "granted") {
              new Notification("🎯 ALARM ZAYTRIX", { body: messageText });
            }
          } catch (e) {
            console.warn("Suppressing Web Push Notification creation inside sandbox:", e);
          }
        }

        // 2, 3, 4. Secure Backend Relay for Webhooks
        if (telegramEnabled || discordEnabled || whatsappEnabled) {
          sendAlertSecurely({
            telegramEnabled,
            telegramBotToken,
            telegramChatId,
            discordEnabled,
            discordWebhookUrl,
            whatsappEnabled,
            whatsappWebhookUrl,
            whatsappPhoneNumber,
            messageText
          }).catch(err => console.error("Secure backend alert dispatch failed:", err));
        }
      }
    });
  }, [assets, alerts, webPushEnabled, telegramEnabled, telegramBotToken, telegramChatId, discordEnabled, discordWebhookUrl, whatsappEnabled, whatsappWebhookUrl, whatsappPhoneNumber]);

  // Handle setting new alarm
  const handleCreateAlert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertPrice) return;

    onAddAlert({
      symbol: selectedSymbol,
      targetPrice: parseFloat(alertPrice),
      condition: alertCondition,
      intensity: alertIntensity,
      isActive: true
    });
  };

  // Trigger a manual drastic market fluctuation simulation to test disappearing banners
  const handleTriggerDrasticSim = (type: 'altcoin' | 'crypto') => {
    if (type === 'altcoin') {
      triggerSystemNotification(
        "PERINGATAN PASAR DRASTIS: Altcoin Season terdeteksi! Koin SOL melonjak mendadak melebihi +15% dalam 1 jam terakhir akibat volume on-chain yang eksplosif.", 
        true
      );
    } else {
      triggerSystemNotification(
        "PERINGATAN KRIPTO DRASTIS: Terjadi likuidasi besar pasar derivatif global! Harga Bitcoin berfluktuasi parah +/- 8% dalam hitungan menit.",
        true
      );
    }
  };

  // Chart data formatting and dynamic overlay metrics (SMA and Trendlines)
  const chartData = useMemo(() => {
    return history.map((h, idx) => {
      const sPeriod = parseInt(smaPeriod) || 14;
      const startIdx = Math.max(0, idx - sPeriod + 1);
      const sub = history.slice(startIdx, idx + 1);
      const smaVal = sub.reduce((sum, item) => sum + item.close, 0) / (sub.length || 1);

      // Real volume from /api/history/:symbol (Yahoo Finance OHLCV). Falls back
      // to 0 (empty bar) when the field is missing — never fabricate a synthetic
      // volume figure, which would mislead the volume chart.
      const realVolume = typeof (h as any).volume === "number" ? (h as any).volume : 0;

      // Interpolate linear coordinates for drawn trend lines
      const lineData: { [key: string]: number } = {};
      trendLines.forEach((tl) => {
        const x1 = tl.p1.index;
        const y1 = tl.p1.price;
        const x2 = tl.p2.index;
        const y2 = tl.p2.price;
        
        if (x1 !== x2) {
          const slope = (y2 - y1) / (x2 - x1);
          const projectedPrice = y1 + slope * (idx - x1);
          // Show trendline 5 days before starting point and 30 days projection
          if (idx >= Math.min(x1, x2) - 5 && idx <= Math.max(x1, x2) + 30) {
            lineData[`trendline_${tl.id}`] = parseFloat(projectedPrice.toFixed(4));
          }
        }
      });

      return {
        ...h,
        index: idx,
        sma: parseFloat(smaVal.toFixed(4)),
        volumeSim: realVolume,
        ...lineData
      };
    });
  }, [history, smaPeriod, trendLines]);

  // Compute Fibonacci Retracement Levels based on range extrema
  const fibonacciLevels = useMemo(() => {
    if (history.length === 0) return null;
    const prices = history.map(h => h.close);
    const maxClose = Math.max(...prices);
    const minClose = Math.min(...prices);
    const range = maxClose - minClose;
    return {
      lvl100: maxClose,
      lvl786: minClose + 0.786 * range,
      lvl618: minClose + 0.618 * range,
      lvl500: minClose + 0.5 * range,
      lvl382: minClose + 0.382 * range,
      lvl236: minClose + 0.236 * range,
      lvl0: minClose,
    };
  }, [history]);

  // Handle clicking on the chart to set trendline coordinate anchors
  const handleChartClick = (state: any) => {
    if (!isDrawingTrendLine || !state || state.activeTooltipIndex === undefined) return;
    const clickIdx = state.activeTooltipIndex;
    const clickedPoint = chartData[clickIdx];
    if (!clickedPoint) return;

    const newPoint = { index: clickIdx, price: clickedPoint.close };
    const nextPoints = [...tempPoints, newPoint];

    if (nextPoints.length === 1) {
      setTempPoints(nextPoints);
      triggerSystemNotification("Titik awal Garis Tren diletakkan! Silakan klik satu titik lain pada grafik untuk mengonfirmasi garis.", false);
    } else {
      const newLine = {
        id: `tl_${Math.random().toString(36).substring(2, 7)}`,
        p1: nextPoints[0],
        p2: nextPoints[1]
      };
      setTrendLines([...trendLines, newLine]);
      setTempPoints([]);
      setIsDrawingTrendLine(false);
      triggerSystemNotification("Garis tren interaktif sukses dipasang pada layar radar terminal!", false);
    }
  };

  const handleTestNotifications = async () => {
    const testMsg = `Koneksi Berhasil! Ini adalah simulasi sinyal pengujian dari Terminal Teknis Keuangan Anda untuk instrumen ${selectedSymbol}.`;
    const report: string[] = [];

    if (webPushEnabled) {
      if (typeof window !== "undefined" && "Notification" in window) {
        try {
          if (Notification.permission === "default") {
            await Notification.requestPermission();
          }
          if (Notification.permission === "granted") {
            new Notification("🧪 UJI NOTIFIKASI WEB", { body: testMsg });
            report.push("Web Push (Kirim)");
          } else {
            report.push("Web Push (Ditolak / Blokir Izin)");
          }
        } catch (e: any) {
          console.warn("Notification permission/creation failed inside sandbox:", e);
          report.push(`Web Push (Keamanan Gagal: ${e?.message || e})`);
        }
      }
    }

    if (telegramEnabled || discordEnabled || whatsappEnabled) {
      try {
        const data = await sendAlertSecurely({
          telegramEnabled,
          telegramBotToken,
          telegramChatId,
          discordEnabled,
          discordWebhookUrl,
          whatsappEnabled,
          whatsappWebhookUrl,
          whatsappPhoneNumber,
          messageText: testMsg
        });

        if (data.success) {
          if (telegramEnabled) {
            if (data.results?.telegram?.success) report.push("Telegram Bot (Sinyal Dikirim)");
            else report.push(`Telegram Bot (Gagal: ${data.results?.telegram?.error || "Unknown Error"})`);
          }
          if (discordEnabled) {
            if (data.results?.discord?.success) report.push("Discord Webhook (Sinyal Dikirim)");
            else report.push(`Discord Webhook (Gagal: ${data.results?.discord?.error || "Unknown Error"})`);
          }
          if (whatsappEnabled) {
            if (data.results?.whatsapp?.success) report.push("WhatsApp Webhook (Sinyal Dikirim)");
            else report.push(`WhatsApp Webhook (Gagal: ${data.results?.whatsapp?.error || "Unknown Error"})`);
          }
        } else {
          report.push(`Koneksi Relay Gagal: ${data.error || "Unknown error"}`);
        }
      } catch (e: any) {
        report.push(`Koneksi Relay Gagal: ${e.message || e}`);
      }
    }

    if (report.length === 0) {
      triggerSystemNotification("Harap aktifkan salah satu gerbang saluran notifikasi terlebih dahulu sebelum menguji.", true);
    } else {
      const isError = report.some(r => r.includes("(Gagal:") || r.includes("Gagal") || r.includes("Koneksi Relay Gagal"));
      triggerSystemNotification(`Laporan Hasil Uji Notifikasi: ${report.join(", ")}`, isError);
    }
  };

  const clearTrendLines = () => {
    setTrendLines([]);
    setTempPoints([]);
    setIsDrawingTrendLine(false);
    triggerSystemNotification("Seluruh garis tren interaktif pada layar grafik berhasil dibersihkan.", false);
  };

  return (
    <div className="space-y-6" id="technical-terminal-tab">
      
      {/* Title Area */}
      <div className="bg-[#0F172A] p-4 sm:p-6 rounded-2xl border border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-500" /> Pengawasan Teknis & Notifikasi Peringatan
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Konfigurasi parameter osilator teknikal dan setel target alarm harga yang disesuaikan secara instan.
          </p>
        </div>
        
        {/* Fluctuation triggers for manual verification of disappearing banners */}
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            onClick={() => handleTriggerDrasticSim('altcoin')}
            id="sim-drastic-altcoin"
            className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs px-3.5 py-2.5 rounded-lg border border-amber-500/20 font-semibold transition-all cursor-pointer text-center"
          >
            Simulasi Lonjakan Altcoin
          </button>
          <button
            onClick={() => handleTriggerDrasticSim('crypto')}
            id="sim-drastic-crypto"
            className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-xs px-3.5 py-2.5 rounded-lg border border-purple-500/20 font-semibold transition-all cursor-pointer text-center"
          >
            Simulasi Lonjakan Kripto
          </button>
        </div>
      </div>

      {/* 📈 WORKSPACE ANALISIS TEKNIKAL: TRADINGVIEW LIGHTWEIGHT CHARTS INTEGRATION */}
      <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-6 h-6 text-emerald-400" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-100">TradingView Radar Workspace</span>
                <span className="text-xs bg-slate-800 text-slate-300 font-mono px-2 py-0.5 rounded-full border border-slate-700">Beta v2.4</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Integrasi Interaktif: Garis Tren Bebas & Fibonacci Retracement di Terminal</p>
            </div>
          </div>

          {/* Instrument Selection */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-medium font-sans">Pilih Instrumen:</span>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl p-2.5 outline-none focus:border-blue-500 font-mono"
            >
              {assets.map((asset) => (
                <option key={asset.id} value={asset.symbol}>
                  {asset.name} ({asset.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Charting Interactive Utility Toolbars */}
        <div className="flex flex-wrap items-center gap-2.5 bg-slate-950/40 p-3 rounded-xl border border-slate-800/60 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setIsDrawingTrendLine(!isDrawingTrendLine);
                setTempPoints([]);
              }}
              className={`text-xs px-4 py-2 rounded-lg font-medium border transition-all flex items-center gap-2 hover:opacity-90 ${
                isDrawingTrendLine 
                  ? "bg-amber-500 text-slate-950 border-amber-600 animate-pulse font-bold" 
                  : "bg-slate-900 text-amber-400 border-amber-500/20"
              }`}
            >
              📐 {isDrawingTrendLine ? "Klik 2 Titik Di Grafik..." : "Tarik Garis Tren Bebas"}
            </button>
            {trendLines.length > 0 && (
              <button
                onClick={clearTrendLines}
                className="bg-slate-900 border border-red-500/20 text-red-500 hover:bg-red-950/20 text-xs px-4 py-2 rounded-lg font-medium transition-all"
              >
                Hapus ({trendLines.length}) Garis
              </button>
            )}
            <button
              onClick={() => setActiveFibonacci(!activeFibonacci)}
              className={`text-xs px-4 py-2 rounded-lg font-medium border transition-all flex items-center gap-2 ${
                activeFibonacci 
                  ? "bg-yellow-500 text-slate-950 border-yellow-600 font-bold" 
                  : "bg-slate-900 text-yellow-400 border-yellow-500/20 hover:bg-yellow-950/10"
              }`}
            >
              🟡 Fibonacci overlay
            </button>
          </div>

          <div className="text-xs font-mono">
            {isDrawingTrendLine && (
              <span className="text-amber-400 animate-pulse font-semibold">
                {tempPoints.length === 0 ? "⚠️ Klik titik KESATU di grafik" : "⚡ Klik titik KEDUA di grafik untuk mengunci garis"}
              </span>
            )}
            {!isDrawingTrendLine && trendLines.length > 0 && <span className="text-emerald-400 font-semibold">Garis Tren Terpasang ({trendLines.length})</span>}
            {!isDrawingTrendLine && trendLines.length === 0 && <span className="text-slate-500">Garis Tren Bebas: Siap Menggambar</span>}
          </div>
        </div>

        {/* Standard interactive chart space */}
        {isLoadingHistory ? (
          <div className="h-72 flex flex-col items-center justify-center bg-slate-950/20 border border-slate-800/40 rounded-xl">
            <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mb-3"></div>
            <p className="text-xs text-slate-500">Menghubungkan data historis TradingView...</p>
          </div>
        ) : history.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center bg-slate-950/20 border border-slate-800/40 rounded-xl">
            <span className="text-2xl text-slate-600 mb-2">📊</span>
            <p className="text-xs text-slate-500">Tidak ada data historis yang tersedia untuk {selectedSymbol}.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Primary price chart */}
            <div className="h-80 bg-slate-950 relative rounded-xl border border-slate-900 overflow-hidden min-h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart 
                  data={chartData} 
                  margin={{ top: 20, right: 30, left: 10, bottom: 5 }}
                  onClick={handleChartClick}
                >
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" opacity={0.15} vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#475569" 
                    fontSize={9} 
                    tickLine={false} 
                  />
                  <YAxis 
                    domain={['auto', 'auto']} 
                    stroke="#475569" 
                    fontSize={9} 
                    tickLine={false} 
                    orientation="right"
                    tickFormatter={(v) => isCrypto ? `$${v.toLocaleString()}` : `${v.toLocaleString()}`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} 
                    labelStyle={{ color: "#94a3b8" }}
                    itemStyle={{ color: "#f1f5f9" }}
                  />
                  
                  {/* Neon main closing price path */}
                  <Line 
                    type="monotone" 
                    dataKey="close" 
                    stroke="#38bdf8" 
                    strokeWidth={2.5} 
                    dot={false}
                    name="Harga Close"
                  />

                  {/* SMA Overlay line */}
                  <Line 
                    type="monotone" 
                    dataKey="sma" 
                    stroke="#ec4899" 
                    strokeWidth={1.5} 
                    strokeDasharray="4 4" 
                    dot={false}
                    name={`SMA (${smaPeriod} Hari)`}
                  />

                  {/* Dynamic Custom Trendlines lines plotted inside chart */}
                  {trendLines.map((tl) => (
                    <Line
                      key={tl.id}
                      type="monotone"
                      dataKey={`trendline_${tl.id}`}
                      stroke="#fbbf24"
                      strokeWidth={2}
                      dot={false}
                      strokeDasharray="2 2"
                      name="Garis Tren Bebas"
                    />
                  ))}

                  {/* Active Fibonacci Horizontal Lines Overlays */}
                  {activeFibonacci && fibonacciLevels && (
                    <>
                      <ReferenceLine y={fibonacciLevels.lvl100} stroke="#eab308" strokeDasharray="3 3" label={{ value: "FIB 100.0% (High)", fill: "#eab308", fontSize: 9, position: "left" }} />
                      <ReferenceLine y={fibonacciLevels.lvl786} stroke="#ca8a04" strokeDasharray="3 3" label={{ value: "FIB 78.6%", fill: "#ca8a04", fontSize: 9, position: "left" }} />
                      <ReferenceLine y={fibonacciLevels.lvl618} stroke="#22c55e" strokeDasharray="3 3" label={{ value: "FIB 61.8% (Golden Ratio)", fill: "#22c55e", fontSize: 9, position: "left" }} />
                      <ReferenceLine y={fibonacciLevels.lvl500} stroke="#ca8a04" strokeDasharray="3 3" label={{ value: "FIB 50.0%", fill: "#ca8a04", fontSize: 9, position: "left" }} />
                      <ReferenceLine y={fibonacciLevels.lvl382} stroke="#ca8a04" strokeDasharray="3 3" label={{ value: "FIB 38.2%", fill: "#ca8a04", fontSize: 9, position: "left" }} />
                      <ReferenceLine y={fibonacciLevels.lvl236} stroke="#ca8a04" strokeDasharray="3 3" label={{ value: "FIB 23.6%", fill: "#ca8a04", fontSize: 9, position: "left" }} />
                      <ReferenceLine y={fibonacciLevels.lvl0} stroke="#eab308" strokeDasharray="3 3" label={{ value: "FIB 0.0% (Low)", fill: "#eab308", fontSize: 9, position: "left" }} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Volume charts viewport */}
            <div className="h-16 bg-slate-950/60 relative rounded-xl border border-slate-900 overflow-hidden">
              <div className="absolute top-2 left-3 text-[9px] uppercase font-mono text-slate-500 tracking-wider flex items-center gap-1.5 z-10">
                <Volume2 className="w-3 h-3 text-slate-400" /> Komparasi Volume Likuiditas Interaktif
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 15, right: 30, left: 10, bottom: 2 }}>
                  <Bar dataKey="volumeSim" fill="#10b981" opacity={0.25} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} 
                    labelStyle={{ color: "#94a3b8" }}
                    itemStyle={{ color: "#10b981" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Column 1: Config price alarms */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
          <div>
            <h3 className="text-md font-bold text-slate-200">Setel Warning Target</h3>
            <p className="text-xs text-slate-400 mt-0.5">Notifikasi instan akan dimunculkan begitu target harga tersentuh.</p>
          </div>

          <form onSubmit={handleCreateAlert} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">Aset Pengawasan</label>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                id="alert-asset-select"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {assets.map(a => (
                  <option key={a.id} value={a.symbol}>{a.symbol} - {a.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">Kondisi Pemicu</label>
                <select
                  value={alertCondition}
                  onChange={(e) => setAlertCondition(e.target.value as any)}
                  id="alert-condition"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="ABOVE">DI ATAS (🚀)</option>
                  <option value="BELOW">DI BAWAH (📉)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">Harga Pengawasan</label>
                <input
                  type="number"
                  step="any"
                  value={alertPrice}
                  onChange={(e) => setAlertPrice(e.target.value)}
                  id="alert-target-price"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">Intensitas Peringatan Risiko</label>
              <select
                value={alertIntensity}
                onChange={(e) => setAlertIntensity(e.target.value as any)}
                id="alert-intensity-select"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="LOW">Rendah (Aman/Hanya deviasi ekstrim)</option>
                <option value="MEDIUM">Sedang (Sensitivitas normal)</option>
                <option value="HIGH">Tinggi (Agresif / Deviasi mikro)</option>
              </select>
              <span className="text-[10px] text-slate-500 mt-1.5 block">
                Intensitas tinggi memicu notifikasi beruntun saat terjadi pergerakan harga sekunder.
              </span>
            </div>

            <button
              type="submit"
              id="alert-submit-btn"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-blue-900/20"
            >
              <Plus className="w-4 h-4 text-white stroke-[3]" /> Buat Alarm Pengawasan
            </button>
          </form>
        </div>

        {/* Column 2: Indicators Tuning parameters UI */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
          <div>
            <h3 className="text-md font-bold text-slate-200">Kustomisasi Indikator</h3>
            <p className="text-xs text-slate-400 mt-0.5">Suaikan koefisien matematis rumusan osilator teknikal Anda.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">Simple Moving Average (SMA)</label>
              <div className="flex items-center space-x-3">
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={smaPeriod}
                  onChange={(e) => setSmaPeriod(e.target.value)}
                  id="slider-sma"
                  className="w-full accent-blue-500 bg-slate-800 rounded-lg appearance-auto h-1.5"
                />
                <span className="text-xs font-mono font-bold text-slate-200 w-8">{smaPeriod}D</span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">Relative Strength Index (RSI)</label>
              <div className="flex items-center space-x-3">
                <input
                  type="range"
                  min="5"
                  max="30"
                  value={rsiPeriod}
                  onChange={(e) => setRsiPeriod(e.target.value)}
                  id="slider-rsi"
                  className="w-full accent-purple-400 bg-slate-800 rounded-lg appearance-auto h-1.5"
                />
                <span className="text-xs font-mono font-bold text-slate-200 w-8">{rsiPeriod}D</span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 font-semibold uppercase font-mono mb-1.5">Bollinger Bands Deviation</label>
              <select
                value={bollingerStd}
                onChange={(e) => setBollingerStd(e.target.value)}
                id="select-bollinger"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="1.5">Std Dev: 1.5x (Sensitif)</option>
                <option value="2.0">Std Dev: 2.0x (Normal)</option>
                <option value="2.5">Std Dev: 2.5x (Sangat Kuat)</option>
              </select>
            </div>

            {/* Simulated Live Ticker feed */}
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-blue-400 font-mono tracking-widest block font-bold uppercase">Umpan Harga Live (Tick Feed)</span>
                {isLoadingHistory && <span className="text-[9px] text-amber-500 animate-pulse font-mono flex items-center gap-1">🔄 Syncing...</span>}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-slate-250 uppercase font-mono">{selectedAsset?.symbol}</span>
                <span className="text-md font-mono font-bold text-slate-100">
                  {formatVal(selectedAsset?.price || 0, isCrypto)}
                </span>
              </div>
              <div className="border-t border-slate-900 pt-2 grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div>
                  <span className="text-slate-500 block">RSI ({rsiPeriod}D):</span>
                  <span className={`font-bold ${computedMetrics.rsi < 30 ? "text-emerald-400" : computedMetrics.rsi > 70 ? "text-rose-500 font-semibold" : "text-slate-300"}`}>
                    {computedMetrics.rsi}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">SMA ({smaPeriod}D):</span>
                  <span className="text-slate-300 font-bold">
                    {formatVal(computedMetrics.sma, isCrypto)}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Bollinger ({bollingerStd}x):</span>
                  <span className="text-slate-400 block text-[9.5px]">
                    H: {formatVal(computedMetrics.upperBand, isCrypto)}<br />L: {formatVal(computedMetrics.lowerBand, isCrypto)}
                  </span>
                </div>
              </div>
            </div>

            {/* Live Indicator Sentiment Gauge card */}
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] text-purple-400 font-mono tracking-widest block font-bold uppercase">SENTIMEN OSILATOR INTEGRASI</span>
              <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                <span className="text-[11px] text-slate-400">RATING TEKNIS:</span>
                <span className={`text-xs font-mono font-extrabold px-2 py-0.5 rounded ${
                  technicalSentiment.sentiment.includes("BUY") 
                    ? "bg-emerald-500/10 text-emerald-400" 
                    : technicalSentiment.sentiment.includes("SELL")
                    ? "bg-rose-500/10 text-rose-400"
                    : "bg-slate-800 text-slate-300"
                }`}>
                  {technicalSentiment.sentiment}
                </span>
              </div>
              <p className="text-[10.5px] leading-relaxed text-slate-400 text-justify">
                "{technicalSentiment.explanation}"
              </p>
              <div className="flex items-center justify-between pt-1 text-[9px] font-mono text-slate-500">
                <span>SKOR KEKUATAN:</span>
                <div className="w-24 bg-slate-900 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${technicalSentiment.score}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Column 3: Active warning alerts list */}
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-md font-bold text-slate-250">Daftar Kontrak Alarm Aktif</h3>
                <p className="text-xs text-slate-400 mt-0.5">Daftar alarm harga menunggu pemicu.</p>
              </div>
              <span className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-bold">
                {alerts.length} Setel
              </span>
            </div>

            <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
              {alerts.length > 0 ? (
                alerts.map((al) => {
                  const match = assets.find(a => a.symbol === al.symbol);
                  const isAssetCrypto = match?.category === 'crypto';
                  return (
                    <div key={al.id} className="bg-slate-950 p-3.5 rounded-xl border border-slate-850 flex items-center justify-between hover:border-slate-800 transition-colors">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-200 text-xs font-mono">{al.symbol}</span>
                          <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                            al.condition === 'ABOVE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {al.condition === 'ABOVE' ? "DI ATAS ↑" : "DI BAWAH ↓"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          Target: <span className="text-slate-200 font-semibold">{formatVal(al.targetPrice, !!isAssetCrypto)}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 uppercase font-mono">
                          Sensitivitas: <span className="text-blue-400 font-medium">{al.intensity} RISK</span>
                        </div>
                      </div>

                      <button
                        onClick={() => onRemoveAlert(al.id)}
                        id={`remove-alert-btn-${al.id}`}
                        className="text-slate-500 hover:text-rose-500 p-1.5 rounded hover:bg-rose-500/5 transition-colors"
                        title="Hapus Alarm"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12 text-slate-500 text-xs">
                  Tidak ada alarm harga pengawasan yang aktif saat ini.
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-850/80 pt-4 mt-6 flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-blue-400 animate-bounce" />
            <p className="text-[10px] text-slate-400">
              Umpan background server melakukan pengawasan volatilitas non-stop. Notifikasi push instan akan mengabari perubahan drastis apa pun.
            </p>
          </div>
        </div>

      </div>

      {/* 📡 PUSAT KONFIGURASI GERBANG NOTIFIKASI MULTI-CHANNEL */}
      <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <Share2 className="w-6 h-6 text-blue-400" />
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              Gerbang Saluran Notifikasi Multi-Channel
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Sambungkan alarm harga Terminal Teknis ke ekosistem eksternal agar tetap terinformasi saat aplikasi ditutup.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Channel 1: Web Push */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-slate-200 uppercase font-mono">Web Push Browser</span>
              </div>
              <input
                type="checkbox"
                checked={webPushEnabled}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  if (checked && typeof window !== "undefined" && "Notification" in window) {
                    try {
                      const perm = await Notification.requestPermission();
                      if (perm !== "granted") {
                        triggerSystemNotification("Izin notifikasi ditolak oleh sistem operasional browser.", true);
                        setWebPushEnabled(false);
                        return;
                      }
                    } catch (err: any) {
                      console.warn("Notification requestPermission failed inside sandbox:", err);
                      triggerSystemNotification(`Sistem browser memblokir izin notifikasi (Sandbox Iframe): ${err?.message || err}`, true);
                      setWebPushEnabled(false);
                      return;
                    }
                  }
                  setWebPushEnabled(checked);
                }}
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Menerima notifikasi visual instan langsung pada notification drawer sistem operasi Anda, baik di desktop maupun perangkat seluler.
            </p>
            <div className="text-[10px] font-mono text-slate-500 bg-slate-900/60 p-2 rounded">
              Status: {webPushEnabled ? (
                <span className="text-emerald-400 font-bold">● AKTIF</span>
              ) : (
                <span className="text-slate-500 font-medium">● NONAKTIF</span>
              )}
            </div>
          </div>

          {/* Channel 2: Telegram Bot Integration */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-bold text-slate-200 uppercase font-mono">Telegram Bot (API)</span>
              </div>
              <input
                type="checkbox"
                checked={telegramEnabled}
                onChange={(e) => setTelegramEnabled(e.target.checked)}
                className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
              />
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-mono font-bold mb-1">Bot Token</label>
                <input
                  type="password"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF..."
                  disabled={!telegramEnabled}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[10.5px] font-mono text-slate-200 outline-none focus:border-sky-500 disabled:opacity-40"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-mono font-bold mb-1">Chat ID</label>
                <input
                  type="text"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="987654321"
                  disabled={!telegramEnabled}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[10.5px] font-mono text-slate-200 outline-none focus:border-sky-500 disabled:opacity-40"
                />
              </div>
            </div>
          </div>

          {/* Channel 3: Discord Webhooks */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-slate-200 uppercase font-mono">Discord Webhook</span>
              </div>
              <input
                type="checkbox"
                checked={discordEnabled}
                onChange={(e) => setDiscordEnabled(e.target.checked)}
                className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
              />
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-mono font-bold mb-1">Webhook URL</label>
                <input
                  type="password"
                  value={discordWebhookUrl}
                  onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  disabled={!discordEnabled}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[10.5px] font-mono text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-40"
                />
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed pt-1.5">
                Peringatan instan akan langsung disiarkan ke server obrolan tim atau kanal personal Anda secara non-stop.
              </p>
            </div>
          </div>

          {/* Channel 4: WhatsApp Webhooks */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Share2 className="w-4 h-4 text-amber-500 animate-pulse" />
                <span className="text-xs font-bold text-slate-200 uppercase font-mono">WhatsApp Webhook</span>
              </div>
              <input
                type="checkbox"
                checked={whatsappEnabled}
                onChange={(e) => setWhatsappEnabled(e.target.checked)}
                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
              />
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-mono font-bold mb-1">Webhook URL</label>
                <input
                  type="password"
                  value={whatsappWebhookUrl}
                  onChange={(e) => setWhatsappWebhookUrl(e.target.value)}
                  placeholder="https://api.whatsapp-gateway.com/send/..."
                  disabled={!whatsappEnabled}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[10.5px] font-mono text-slate-200 outline-none focus:border-amber-500 disabled:opacity-40"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-mono font-bold mb-1">Nomor Telepon Penerima</label>
                <input
                  type="text"
                  value={whatsappPhoneNumber}
                  onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                  placeholder="Contoh: 6281234567890 (Tanpa tanda +)"
                  disabled={!whatsappEnabled}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[10.5px] font-mono text-slate-200 outline-none focus:border-amber-500 disabled:opacity-40"
                />
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed pt-1">
                Kirimkan ping dan alert bursa pasar keuangan secara real-time langsung ke WhatsApp Messenger pribadi / grup.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2 justify-end border-t border-slate-800">
          <button
            onClick={handleTestNotifications}
            id="test-notifications-btn"
            className="bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-250 text-xs px-5 py-2.5 rounded-xl font-bold transition-all shadow cursor-pointer text-center"
          >
            🧪 Uji Fungsionalitas Notifikasi (Kirim Sinyal)
          </button>
        </div>
      </div>

    </div>
  );
}
