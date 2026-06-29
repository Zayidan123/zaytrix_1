'use client';

import { useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { calculateFIFOPnL, formatPrice, formatPercent } from '@/lib/helpers';
import type { TaxTransaction } from '@/lib/types';

const DEMO_TRANSACTIONS: TaxTransaction[] = [
  { id: 't01', date: '2025-03-28', type: 'BUY', symbol: 'BTC', amount: 0.15, price: 87500.00, fee: 12.50, pnl: undefined },
  { id: 't02', date: '2025-03-25', type: 'SELL', symbol: 'ETH', amount: 3.0, price: 2720.00, fee: 8.16, pnl: 240.00 },
  { id: 't03', date: '2025-03-20', type: 'BUY', symbol: 'SOL', amount: 25.0, price: 155.80, fee: 6.20, pnl: undefined },
  { id: 't04', date: '2025-03-15', type: 'TRANSFER_IN', symbol: 'BNB', amount: 5.0, price: 640.00, fee: 2.00, pnl: undefined },
  { id: 't05', date: '2025-03-10', type: 'SELL', symbol: 'BTC', amount: 0.08, price: 92000.00, fee: 7.36, pnl: 1280.00 },
  { id: 't06', date: '2025-03-05', type: 'BUY', symbol: 'ETH', amount: 4.0, price: 2650.00, fee: 10.60, pnl: undefined },
  { id: 't07', date: '2025-02-28', type: 'TRANSFER_OUT', symbol: 'SOL', amount: 10.0, price: 142.00, fee: 1.50, pnl: undefined },
  { id: 't08', date: '2025-02-22', type: 'SELL', symbol: 'BNB', amount: 3.0, price: 660.00, fee: 5.94, pnl: 180.00 },
  { id: 't09', date: '2025-02-18', type: 'BUY', symbol: 'BTC', amount: 0.1, price: 96000.00, fee: 9.60, pnl: undefined },
  { id: 't10', date: '2025-02-12', type: 'BUY', symbol: 'SOL', amount: 30.0, price: 135.00, fee: 6.08, pnl: undefined },
  { id: 't11', date: '2025-02-05', type: 'SELL', symbol: 'ETH', amount: 2.0, price: 2580.00, fee: 5.16, pnl: -440.00 },
  { id: 't12', date: '2025-02-01', type: 'TRANSFER_IN', symbol: 'BTC', amount: 0.2, price: 94000.00, fee: 3.00, pnl: undefined },
  { id: 't13', date: '2025-01-28', type: 'BUY', symbol: 'BNB', amount: 8.0, price: 610.00, fee: 7.32, pnl: undefined },
  { id: 't14', date: '2025-01-22', type: 'SELL', symbol: 'SOL', amount: 15.0, price: 128.00, fee: 4.80, pnl: -105.00 },
  { id: 't15', date: '2025-01-15', type: 'BUY', symbol: 'ETH', amount: 5.0, price: 2800.00, fee: 14.00, pnl: undefined },
  { id: 't16', date: '2025-01-10', type: 'SELL', symbol: 'BTC', amount: 0.05, price: 93500.00, fee: 4.68, pnl: -750.00 },
  { id: 't17', date: '2025-01-05', type: 'BUY', symbol: 'SOL', amount: 20.0, price: 118.50, fee: 4.74, pnl: undefined },
  { id: 't18', date: '2025-01-02', type: 'TRANSFER_OUT', symbol: 'BNB', amount: 2.0, price: 585.00, fee: 1.00, pnl: undefined },
];

const TYPE_STYLES: Record<TaxTransaction['type'], { label: string; cls: string }> = {
  BUY: { label: 'BUY', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  SELL: { label: 'SELL', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  TRANSFER_IN: { label: 'TRANSFER_IN', cls: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
  TRANSFER_OUT: { label: 'TRANSFER_OUT', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
};

function getMonthlyPnL(transactions: TaxTransaction[]) {
  const months = ['Jan 2025', 'Feb 2025', 'Mar 2025'];
  const keys = ['2025-01', '2025-02', '2025-03'];
  const values = [0, 0, 0];
  for (const tx of transactions) {
    if (tx.pnl == null) continue;
    const idx = keys.indexOf(tx.date.slice(0, 7));
    if (idx >= 0) values[idx] += tx.pnl;
  }
  return months.map((label, i) => ({ label, pnl: values[i] }));
}

export default function LedgerTax() {
  const sorted = useMemo(
    () => [...DEMO_TRANSACTIONS].sort((a, b) => b.date.localeCompare(a.date)),
    []
  );

  const { realizedPnL, taxEstimate } = useMemo(
    () => calculateFIFOPnL(DEMO_TRANSACTIONS),
    []
  );

  const monthlyPnL = useMemo(() => getMonthlyPnL(DEMO_TRANSACTIONS), []);

  const maxAbsPnl = useMemo(
    () => Math.max(...monthlyPnL.map((m) => Math.abs(m.pnl)), 1),
    [monthlyPnL]
  );

  const shortTermGains = useMemo(() => {
    return DEMO_TRANSACTIONS
      .filter((t) => t.type === 'SELL' && t.pnl != null && t.pnl > 0)
      .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  }, []);

  const longTermGains = useMemo(() => {
    return realizedPnL - shortTermGains;
  }, [realizedPnL, shortTermGains]);

  const handleExportCSV = useCallback(() => {
    const headers = ['Date', 'Type', 'Coin', 'Amount', 'Price', 'Fee', 'PnL'];
    const rows = sorted.map((t) => [
      t.date,
      t.type,
      t.symbol,
      t.amount,
      t.price,
      t.fee,
      t.pnl ?? '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zcapital-ledger.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [sorted]);

  return (
    <div className="animate-fade-in-up space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold gradient-text-2">Ledger &amp; Tax</h1>
        <p className="text-muted-foreground mt-1">
          Track transactions, calculate PnL, and estimate taxes
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 stagger-children">
        <div className="glass-card-3d p-6 rounded-2xl flex flex-col gap-2">
          <span className="text-sm text-muted-foreground">Total Transactions</span>
          <span className="text-2xl font-bold text-foreground tabular-nums">
            {DEMO_TRANSACTIONS.length}
          </span>
          <span className="text-xs text-muted-foreground">Jan – Mar 2025</span>
        </div>
        <div className="glass-card-3d p-6 rounded-2xl flex flex-col gap-2">
          <span className="text-sm text-muted-foreground">Realized PnL</span>
          <span
            className={`text-2xl font-bold tabular-nums ${
              realizedPnL >= 0 ? 'price-up' : 'price-down'
            }`}
          >
            {formatPrice(realizedPnL)}
          </span>
          <span className="text-xs text-muted-foreground">FIFO method</span>
        </div>
        <div className="glass-card-3d p-6 rounded-2xl flex flex-col gap-2">
          <span className="text-sm text-muted-foreground">Tax Estimate</span>
          <span className="text-2xl font-bold text-foreground tabular-nums">
            {formatPrice(taxEstimate)}
          </span>
          <span className="text-xs text-muted-foreground">
            {taxEstimate > 10000 ? 'Long-term rate (15%)' : 'Short-term rate (30%)'}
          </span>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="glass-card-3d p-5 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-foreground">Transactions</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="border-white/[0.1] text-foreground hover:bg-white/[0.05] hover:text-foreground"
          >
            <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-3 px-3 text-muted-foreground font-semibold">Date</th>
                <th className="text-left py-3 px-3 text-muted-foreground font-semibold">Type</th>
                <th className="text-left py-3 px-3 text-muted-foreground font-semibold">Coin</th>
                <th className="text-right py-3 px-3 text-muted-foreground font-semibold">Amount</th>
                <th className="text-right py-3 px-3 text-muted-foreground font-semibold">Price</th>
                <th className="text-right py-3 px-3 text-muted-foreground font-semibold">Fee</th>
                <th className="text-right py-3 px-3 text-muted-foreground font-semibold">PnL</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((tx) => {
                const style = TYPE_STYLES[tx.type];
                return (
                  <tr
                    key={tx.id}
                    className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 px-3 text-foreground tabular-nums whitespace-nowrap">
                      {tx.date}
                    </td>
                    <td className="py-3 px-3">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 font-medium ${style.cls}`}
                      >
                        {style.label}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-foreground font-medium">{tx.symbol}</td>
                    <td className="py-3 px-3 text-right text-foreground tabular-nums">
                      {tx.amount}
                    </td>
                    <td className="py-3 px-3 text-right text-foreground tabular-nums">
                      {formatPrice(tx.price)}
                    </td>
                    <td className="py-3 px-3 text-right text-muted-foreground tabular-nums">
                      {formatPrice(tx.fee)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums">
                      {tx.pnl != null ? (
                        <span
                          className={`font-medium ${
                            tx.pnl >= 0 ? 'price-up' : 'price-down'
                          }`}
                        >
                          {formatPrice(tx.pnl)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two-column: Monthly PnL Chart + Tax Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly PnL Bar Chart */}
        <div className="glass-card-3d p-5 rounded-2xl">
          <h2 className="text-xl font-semibold text-foreground mb-5">Monthly PnL</h2>
          <div className="space-y-4">
            {monthlyPnL.map((m) => {
              const pct = Math.abs(m.pnl) / maxAbsPnl;
              const isProfit = m.pnl >= 0;
              return (
                <div key={m.label} className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground w-20 shrink-0">
                    {m.label}
                  </span>
                  <div className="flex-1 h-8 bg-white/[0.03] rounded-lg overflow-hidden relative">
                    <div
                      className="h-full rounded-lg transition-all duration-700"
                      style={{
                        width: `${Math.max(pct * 100, 2)}%`,
                        background: isProfit
                          ? 'linear-gradient(90deg, #22c55e, #10b981)'
                          : 'linear-gradient(90deg, #ef4444, #f43f5e)',
                      }}
                    />
                  </div>
                  <span
                    className={`text-sm font-medium tabular-nums w-24 text-right ${
                      isProfit ? 'price-up' : 'price-down'
                    }`}
                  >
                    {m.pnl >= 0 ? '+' : ''}
                    {formatPrice(m.pnl)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tax Summary */}
        <div className="glass-card-3d p-6 rounded-2xl">
          <h2 className="text-xl font-semibold text-foreground mb-5">Tax Summary</h2>
          <div className="space-y-5">
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/[0.03]">
              <div>
                <p className="text-sm font-medium text-foreground">Short-term Gains</p>
                <p className="text-xs text-muted-foreground mt-0.5">Held &lt; 1 year · 30% rate</p>
              </div>
              <span
                className={`text-lg font-bold tabular-nums ${
                  shortTermGains >= 0 ? 'price-up' : 'price-down'
                }`}
              >
                {formatPrice(shortTermGains)}
              </span>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/[0.03]">
              <div>
                <p className="text-sm font-medium text-foreground">Long-term Gains</p>
                <p className="text-xs text-muted-foreground mt-0.5">Held &gt; 1 year · 15% rate</p>
              </div>
              <span
                className={`text-lg font-bold tabular-nums ${
                  longTermGains >= 0 ? 'price-up' : 'price-down'
                }`}
              >
                {formatPrice(longTermGains)}
              </span>
            </div>
            <Separator className="bg-white/[0.06]" />
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/[0.03]">
              <div>
                <p className="text-sm font-medium text-foreground">Total Tax Estimate</p>
                <p className="text-xs text-muted-foreground mt-0.5">Based on FIFO PnL calculation</p>
              </div>
              <span className="text-lg font-bold text-foreground tabular-nums">
                {formatPrice(taxEstimate)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}