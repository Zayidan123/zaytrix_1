'use client';

import { useMemo, useState } from 'react';
import { useCryptoStore } from '@/lib/store';
import { formatPrice, formatNumber, formatPercent } from '@/lib/helpers';
export default function CoinList() {
  const assets = useCryptoStore((s) => s.assets);
  const [search, setSearch] = useState('');
  const sortedAssets = useMemo(
    () => [...assets].sort((a, b) => b.marketCap - a.marketCap),
    [assets]
  );
  const filtered = useMemo(() => {
    if (!search.trim()) return sortedAssets;
    const q = search.toLowerCase();
    return sortedAssets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }, [sortedAssets, search]);
  return (
    <div className="animate-fade-in-up space-y-6 p-6">
      {/* Page Title */}
      <h1 className="text-4xl font-bold gradient-text-2">Coin List</h1>
      {/* Search Input */}
      <div className="relative max-w-md">
        <input
          type="text"
          placeholder="Search coins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-3 pl-10 rounded-xl bg-white/[0.04] border border-white/[0.08] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-white/[0.15] transition-colors"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      {/* Table */}
      <div className="glass-card-3d rounded-2xl overflow-x-auto min-w-[640px]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="px-5 py-4 text-sm font-medium text-muted-foreground">#</th>
              <th className="px-5 py-4 text-sm font-medium text-muted-foreground">Coin</th>
              <th className="px-5 py-4 text-sm font-medium text-muted-foreground text-right">Price</th>
              <th className="px-5 py-4 text-sm font-medium text-muted-foreground text-right">24h Change</th>
              <th className="px-5 py-4 text-sm font-medium text-muted-foreground text-right">24h Volume</th>
              <th className="px-5 py-4 text-sm font-medium text-muted-foreground text-right">Market Cap</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((coin, i) => (
              <tr
                key={coin.symbol}
                className="border-b border-white/[0.04] last:border-b-0 transition-colors hover:bg-white/[0.03]"
              >
                <td className="px-5 py-4 text-sm text-muted-foreground">
                  {i + 1}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center text-foreground font-bold text-xs">
                      {coin.symbol.slice(0, 2)}
                    </div>
                    <div>
                      <span className="text-foreground font-semibold text-sm">
                        {coin.name}
                      </span>
                      <span className="text-muted-foreground text-xs ml-2">
                        {coin.symbol}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4 text-right text-foreground font-medium text-sm">
                  {formatPrice(coin.price)}
                </td>
                <td
                  className={`px-5 py-4 text-right text-sm font-medium ${
                    coin.change24h >= 0 ? 'price-up' : 'price-down'
                  }`}
                >
                  {formatPercent(coin.change24h)}
                </td>
                <td className="px-5 py-4 text-right text-foreground text-sm">
                  {formatNumber(coin.volume24h)}
                </td>
                <td className="px-5 py-4 text-right text-foreground text-sm">
                  {formatNumber(coin.marketCap)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-12 text-center text-muted-foreground"
                >
                  No coins found matching &quot;{search}&quot;
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
