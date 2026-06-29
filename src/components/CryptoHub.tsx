'use client';

import { useState, useMemo } from 'react';
import { useCryptoStore } from '@/lib/store';
import { formatPrice, formatPercent } from '@/lib/helpers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
const HOLDING_COLORS: Record<string, string> = {
  BTC: '#f59e0b',
  ETH: '#10b981',
  SOL: '#06b6d4',
  BNB: '#f43f5e',
};
export default function CryptoHub() {
  const { holdings, assets, addTransaction } = useCryptoStore();
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [tradeCoin, setTradeCoin] = useState('BTC');
  const [tradeAmount, setTradeAmount] = useState('');
  const totalValue = useMemo(
    () => holdings.reduce((s, h) => s + h.value, 0),
    [holdings]
  );
  const totalPnL = useMemo(
    () => holdings.reduce((s, h) => s + h.pnl, 0),
  const bestPerformer = useMemo(
    () =>
      [...holdings].sort((a, b) => b.pnlPercent - a.pnlPercent)[0] ?? null,
  // Donut chart data
  const donutData = useMemo(() => {
    const total = holdings.reduce((s, h) => s + h.value, 0);
    return holdings.map((h) => ({
      symbol: h.symbol,
      value: h.value,
      pct: total > 0 ? (h.value / total) * 100 : 0,
      color: HOLDING_COLORS[h.symbol] ?? '#8b5cf6',
    }));
  }, [holdings]);
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;
  const donutSegments = donutData.map((d) => {
    const segLen = (d.pct / 100) * circumference;
    const offset = -cumulativeOffset;
    cumulativeOffset += segLen;
    return { ...d, segLen, offset };
  });
  const handleSubmitTrade = () => {
    const amount = parseFloat(tradeAmount);
    if (!amount || amount <= 0) return;
    const asset = assets.find((a) => a.symbol === tradeCoin);
    if (!asset) return;
    addTransaction({
      id: `tx-${Date.now()}`,
      type: tradeType,
      symbol: tradeCoin,
      name: asset.name,
      amount,
      price: asset.price,
      total: amount * asset.price,
      date: new Date().toISOString(),
    });
    setTradeAmount('');
  };
  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold gradient-text-1">Portfolio</h1>
        <p className="text-muted-foreground mt-1">Manage your crypto holdings and trades</p>
      </div>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-children">
        <div className="glass-card-3d p-6">
          <p className="text-muted-foreground text-sm mb-1">Total Value</p>
          <p className="text-foreground text-3xl font-bold">{formatPrice(totalValue)}</p>
        </div>
          <p className="text-muted-foreground text-sm mb-1">Total PnL</p>
          <p className={`text-foreground text-3xl font-bold ${totalPnL >= 0 ? 'price-up' : 'price-down'}`}>
            {formatPrice(Math.abs(totalPnL))}
          </p>
          <p className="text-muted-foreground text-sm mb-1">Best Performer</p>
          {bestPerformer ? (
            <p className="text-foreground text-3xl font-bold">
              {bestPerformer.symbol}
              <span className={`text-lg ml-2 ${bestPerformer.pnlPercent >= 0 ? 'price-up' : 'price-down'}`}>
                {formatPercent(bestPerformer.pnlPercent)}
              </span>
            </p>
          ) : (
            <p className="text-foreground text-3xl font-bold">—</p>
          )}
      {/* Chart + Table Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Donut Chart */}
        <div className="glass-card-3d p-6 flex flex-col items-center justify-center">
          <p className="text-muted-foreground text-sm mb-4 self-start">Allocation</p>
          <svg viewBox="0 0 200 200" className="w-48 h-48">
            {donutSegments.map((seg) => (
              <circle
                key={seg.symbol}
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth="24"
                strokeDasharray={`${seg.segLen} ${circumference - seg.segLen}`}
                strokeDashoffset={seg.offset}
                strokeLinecap="butt"
                transform="rotate(-90 100 100)"
                className="transition-all duration-700"
              />
            ))}
            <text x="100" y="96" textAnchor="middle" className="fill-foreground text-2xl font-bold" fontSize="20" fontWeight="700">
              {formatPrice(totalValue)}
            </text>
            <text x="100" y="116" textAnchor="middle" className="fill-muted-foreground" fontSize="10">
              Total Value
          </svg>
          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4">
            {donutData.map((d) => (
              <div key={d.symbol} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: d.color }} />
                <span className="text-foreground font-medium">{d.symbol}</span>
                <span className="text-muted-foreground">{d.pct.toFixed(1)}%</span>
              </div>
          </div>
        {/* Holdings Table */}
        <div className="glass-card-3d p-6 lg:col-span-2 overflow-x-auto">
          <p className="text-muted-foreground text-sm mb-4">Holdings</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-muted-foreground font-medium pb-3 pr-4">Coin</th>
                <th className="text-right text-muted-foreground font-medium pb-3 pr-4">Amount</th>
                <th className="text-right text-muted-foreground font-medium pb-3 pr-4">Avg Buy</th>
                <th className="text-right text-muted-foreground font-medium pb-3 pr-4">Current</th>
                <th className="text-right text-muted-foreground font-medium pb-3 pr-4">PnL</th>
                <th className="text-right text-muted-foreground font-medium pb-3">PnL%</th>
              </tr>
            </thead>
            <tbody className="stagger-children">
              {holdings.map((h) => (
                <tr key={h.symbol} className="border-b border-white/5 last:border-0">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: HOLDING_COLORS[h.symbol] ?? '#8b5cf6' }}
                      />
                      <span className="text-foreground font-medium">{h.symbol}</span>
                      <span className="text-muted-foreground text-xs">{h.name}</span>
                    </div>
                  </td>
                  <td className="text-right text-foreground py-3 pr-4 tabular-nums">
                    {h.amount}
                    {formatPrice(h.avgBuyPrice)}
                    {formatPrice(h.currentPrice)}
                  <td className={`text-right py-3 pr-4 tabular-nums font-medium ${h.pnl >= 0 ? 'price-up' : 'price-down'}`}>
                    {formatPrice(Math.abs(h.pnl))}
                  <td className={`text-right py-3 tabular-nums font-medium ${h.pnlPercent >= 0 ? 'price-up' : 'price-down'}`}>
                    {formatPercent(h.pnlPercent)}
                </tr>
              ))}
            </tbody>
          </table>
      <Separator className="opacity-20" />
      {/* Quick Trade Panel */}
      <div className="glass-card-3d p-6 max-w-2xl">
        <p className="text-foreground text-lg font-semibold mb-4">Quick Trade</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Buy/Sell Toggle */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Trade Type</Label>
            <div className="flex gap-2">
              <Button
                variant={tradeType === 'BUY' ? 'default' : 'outline'}
                className={tradeType === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700 text-foreground' : ''}
                onClick={() => setTradeType('BUY')}
              >
                BUY
              </Button>
                variant={tradeType === 'SELL' ? 'destructive' : 'outline'}
                onClick={() => setTradeType('SELL')}
                SELL
            </div>
          {/* Coin Selector */}
            <Label className="text-muted-foreground">Coin</Label>
            <Select value={tradeCoin} onValueChange={setTradeCoin}>
              <SelectTrigger className="bg-transparent border-white/10 text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0f1119] border-white/10">
                {assets.map((a) => (
                  <SelectItem key={a.symbol} value={a.symbol} className="text-foreground focus:bg-white/5">
                    {a.symbol} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          {/* Amount */}
            <Label className="text-muted-foreground">Amount</Label>
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={tradeAmount}
              onChange={(e) => setTradeAmount(e.target.value)}
              className="bg-transparent border-white/10 text-foreground"
            />
          {/* Estimated Total */}
          <div className="space-y-2 flex flex-col justify-end">
            <p className="text-muted-foreground text-sm">Estimated Total</p>
            <p className="text-foreground text-xl font-bold tabular-nums">
              {tradeAmount && !isNaN(parseFloat(tradeAmount))
                ? formatPrice(parseFloat(tradeAmount) * (assets.find((a) => a.symbol === tradeCoin)?.price ?? 0))
                : '$0.00'}
        <div className="mt-4">
          <Button
            onClick={handleSubmitTrade}
            disabled={!tradeAmount || isNaN(parseFloat(tradeAmount)) || parseFloat(tradeAmount) <= 0}
            className={
              tradeType === 'BUY'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-foreground w-full sm:w-auto'
                : 'bg-destructive hover:bg-destructive/90 text-foreground w-full sm:w-auto'
            }
            size="lg"
          >
            {tradeType === 'BUY' ? 'Place Buy Order' : 'Place Sell Order'}
          </Button>
    </div>
}
