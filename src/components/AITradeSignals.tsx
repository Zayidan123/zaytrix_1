'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
interface SignalData {
  symbol: string;
  name: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  rsi: number;
  macdValue: number;
  macdSignal: number;
  confidence: number;
}
function generateSignals(): SignalData[] {
  const rand = (min: number, max: number) => Math.random() * (max - min) + min;
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return [
    {
      symbol: 'BTC',
      name: 'Bitcoin',
      signal: pick(['BUY', 'HOLD'] as const),
      rsi: rand(38, 72),
      macdValue: rand(-500, 800),
      macdSignal: rand(-200, 400),
      confidence: rand(65, 95),
    },
      symbol: 'ETH',
      name: 'Ethereum',
      signal: pick(['BUY', 'SELL', 'HOLD'] as const),
      rsi: rand(30, 75),
      macdValue: rand(-50, 60),
      macdSignal: rand(-30, 40),
      confidence: rand(55, 90),
      symbol: 'SOL',
      name: 'Solana',
      signal: pick(['BUY', 'BUY'] as const),
      rsi: rand(50, 78),
      macdValue: rand(-5, 15),
      macdSignal: rand(-3, 10),
      confidence: rand(70, 96),
      symbol: 'BNB',
      name: 'BNB',
      signal: pick(['HOLD', 'BUY'] as const),
      rsi: rand(40, 65),
      macdValue: rand(-10, 20),
      macdSignal: rand(-8, 15),
      confidence: rand(50, 85),
      symbol: 'XRP',
      name: 'Ripple',
      signal: pick(['SELL', 'HOLD'] as const),
      rsi: rand(25, 55),
      macdValue: rand(-0.05, 0.02),
      macdSignal: rand(-0.03, 0.01),
      confidence: rand(58, 88),
  ];
const SIGNAL_BADGE_STYLES: Record<string, string> = {
  BUY: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  SELL: 'bg-red-500/20 text-red-400 border-red-500/30',
  HOLD: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};
export default function AITradeSignals() {
  const [signals, setSignals] = useState<SignalData[]>(generateSignals);
  const [countdown, setCountdown] = useState(60);
  const refresh = useCallback(() => {
    setSignals(generateSignals());
    setCountdown(60);
  }, []);
  // Auto-refresh countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          refresh();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [refresh]);
  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-bold gradient-text-2">AI Trade Signals</h1>
          <p className="text-muted-foreground mt-1">Real-time AI-powered analysis for major assets</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="glass-card px-4 py-2 flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Refresh in</span>
            <span className="text-foreground font-bold tabular-nums text-lg">{countdown}s</span>
          </div>
          <Button variant="outline" onClick={refresh} className="border-white/10 text-foreground hover:bg-white/5">
            Refresh Now
          </Button>
      </div>
      <Separator className="opacity-20" />
      {/* Signal Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 stagger-children">
        {signals.map((s) => {
          const macdBullish = s.macdValue > s.macdSignal;
          const rsiColor = s.rsi > 70 ? '#ef4444' : s.rsi < 30 ? '#10b981' : '#f59e0b';
          return (
            <div key={s.symbol} className="glass-card-3d p-5 flex flex-col gap-4">
              {/* Coin header + signal badge */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-foreground text-lg font-bold">{s.symbol}</p>
                  <p className="text-muted-foreground text-xs">{s.name}</p>
                </div>
                <Badge variant="outline" className={`text-xs font-bold px-3 py-1 ${SIGNAL_BADGE_STYLES[s.signal]}`}>
                  {s.signal}
                </Badge>
              </div>
              {/* RSI */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">RSI</span>
                  <span className="text-foreground text-sm font-semibold tabular-nums">{s.rsi.toFixed(1)}</span>
                <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(s.rsi, 100)}%`, backgroundColor: rsiColor }}
                  />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Oversold (30)</span>
                  <span>Overbought (70)</span>
              {/* MACD */}
              <div className="space-y-1">
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">MACD</span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${macdBullish ? 'bg-emerald-400' : 'bg-red-400'}`}
                    />
                    <span className={`text-sm font-semibold tabular-nums ${macdBullish ? 'price-up' : 'price-down'}`}>
                      {s.macdValue.toFixed(2)}
                    </span>
                  </div>
                <p className="text-muted-foreground text-[10px]">
                  Signal: {s.macdSignal.toFixed(2)} — {macdBullish ? 'Bullish crossover' : 'Bearish crossover'}
                </p>
              {/* Confidence */}
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Confidence</span>
                  <span className="text-foreground text-sm font-bold tabular-nums">{s.confidence.toFixed(0)}%</span>
                <div className="w-full h-2.5 rounded-full bg-white/5 overflow-hidden">
                    style={{
                      width: `${s.confidence}%`,
                      background: 'linear-gradient(90deg, #10b981, #06b6d4)',
                    }}
            </div>
          );
        })}
    </div>
  );
