'use client';

import { useMemo } from 'react';
import { useCryptoStore } from '@/lib/store';
import { formatPrice, formatNumber, formatPercent } from '@/lib/helpers';

function MiniSparkline({ positive }: { positive: boolean }) {
  const bars = useMemo(() => {
    return Array.from({ length: 12 }, () => 20 + Math.random() * 60);
  }, []);
  const color = positive ? '#22c55e' : '#ef4444';
  return (
    <div className="flex items-end gap-[2px] h-5 w-16">
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm opacity-70"
          style={{
            height: `${h}%`,
            backgroundColor: color,
            transition: 'height 0.3s ease',
          }}
        />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const assets = useCryptoStore((s) => s.assets);
  const holdings = useCryptoStore((s) => s.holdings);

  const totalValue = useMemo(
    () => holdings.reduce((sum, h) => sum + h.value, 0),
    [holdings]
  );

  const weightedChange = useMemo(() => {
    const totalVal = holdings.reduce((sum, h) => sum + h.value, 0);
    if (totalVal === 0) return 0;
    return holdings.reduce((sum, h) => sum + h.pnlPercent * h.value, 0) / totalVal;
  }, [holdings]);

  const totalPnL = useMemo(
    () => holdings.reduce((sum, h) => sum + h.pnl, 0),
    [holdings]
  );

  const topGainer = useMemo(() => {
    if (assets.length === 0) return null;
    return assets.reduce((best, a) => (a.change24h > best.change24h ? a : best), assets[0]);
  }, [assets]);

  const totalMarketCap = useMemo(
    () => assets.reduce((sum, a) => sum + a.marketCap, 0),
    [assets]
  );

  const topCoins = useMemo(
    () => [...assets].sort((a, b) => b.marketCap - a.marketCap).slice(0, 5),
    [assets]
  );

  const statCards = [
    {
      label: 'Total Portfolio Value',
      value: formatPrice(totalValue),
      change: formatPercent(weightedChange),
      positive: weightedChange >= 0,
    },
    {
      label: '24h Change',
      value: formatPrice(totalPnL),
      change: weightedChange >= 0 ? 'Profit' : 'Loss',
      positive: totalPnL >= 0,
    },
    {
      label: 'Top Gainer',
      value: topGainer ? `${topGainer.symbol}` : 'N/A',
      change: topGainer ? formatPercent(topGainer.change24h) : '—',
      positive: topGainer ? topGainer.change24h >= 0 : true,
    },
    {
      label: 'Market Cap',
      value: formatNumber(totalMarketCap),
      change: `${assets.length} Assets`,
      positive: true,
    },
  ];

  return (
    <div className="animate-fade-in-up space-y-8 p-6">
      <h1 className="text-4xl font-bold gradient-text-1">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {statCards.map((card, i) => (
          <div key={i} className="glass-card-3d p-5 rounded-2xl flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">{card.label}</span>
            <span className="text-2xl font-bold text-foreground">{card.value}</span>
            <span className={`text-sm font-medium ${card.positive ? 'price-up' : 'price-down'}`}>
              {card.change}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card-3d p-6 rounded-2xl">
          <h2 className="text-xl font-bold text-foreground mb-4">Market Overview</h2>
          <div className="space-y-1">
            {topCoins.map((coin, i) => (
              <div
                key={coin.symbol}
                className="flex items-center justify-between py-3 px-2 rounded-lg transition-colors hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-muted-foreground text-sm w-6">{i + 1}</span>
                  <div className="min-w-0">
                    <span className="text-foreground font-semibold text-sm">{coin.name}</span>
                    <span className="text-muted-foreground text-xs ml-2">{coin.symbol}</span>
                  </div>
                </div>
                <MiniSparkline positive={coin.change24h >= 0} />
                <div className="flex items-center gap-4 text-right">
                  <span className="text-foreground font-medium text-sm min-w-[100px] text-right">
                    {formatPrice(coin.price)}
                  </span>
                  <span className={`text-sm font-medium min-w-[70px] text-right ${coin.change24h >= 0 ? 'price-up' : 'price-down'}`}>
                    {formatPercent(coin.change24h)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card-3d p-6 rounded-2xl flex flex-col gap-4">
          <h2 className="text-xl font-bold text-foreground mb-2">Quick Actions</h2>
          <button className="glass-card w-full py-4 rounded-xl text-foreground font-semibold text-lg transition-all hover:scale-[1.02] active:scale-[0.98]">
            <span className="mr-2">↗</span> Buy
          </button>
          <button className="glass-card w-full py-4 rounded-xl text-foreground font-semibold text-lg transition-all hover:scale-[1.02] active:scale-[0.98]">
            <span className="mr-2">↘</span> Sell
          </button>
          <button className="glass-card w-full py-4 rounded-xl text-foreground font-semibold text-lg transition-all hover:scale-[1.02] active:scale-[0.98]">
            <span className="mr-2">⇄</span> Swap
          </button>
          <div className="mt-auto pt-4 border-t border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="status-dot connected" />
              <span className="text-sm text-muted-foreground">Live data feed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
