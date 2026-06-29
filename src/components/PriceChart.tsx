'use client';

import { useMemo, useState, useCallback } from 'react';
import { useCryptoStore } from '@/lib/store';
import { formatPrice, formatPercent } from '@/lib/helpers';

type TimeRange = '1H' | '4H' | '1D' | '1W' | '1M';
const TIME_RANGES: TimeRange[] = ['1H', '4H', '1D', '1W', '1M'];
const POINTS_MAP: Record<TimeRange, number> = {
  '1H': 24,
  '4H': 48,
  '1D': 96,
  '1W': 168,
  '1M': 120,
};

function generatePriceData(basePrice: number, change24h: number, points: number): number[] {
  const data: number[] = [];
  const drift = (change24h / 100 / points);
  const volatility = (basePrice * 0.005) / Math.sqrt(points);
  let price = basePrice * (1 - (change24h / 100) * 0.5);
  for (let i = 0; i < points; i++) {
    const noise = (Math.random() - 0.5) * 2 * volatility;
    const trendComponent = (basePrice * (change24h / 100) / points) * (i / points);
    price = price + drift * basePrice + noise;
    const progress = i / (points - 1);
    const targetAtEnd = basePrice;
    const blend = Math.pow(progress, 1.5) * 0.3;
    price = price * (1 - blend * 0.01) + targetAtEnd * blend * 0.01;
    data.push(price);
  }
  data[data.length - 1] = basePrice;
  return data;
}

export default function PriceChart() {
  const assets = useCryptoStore((s) => s.assets);
  const selectedCoin = useCryptoStore((s) => s.selectedCoin);
  const setSelectedCoin = useCryptoStore((s) => s.setSelectedCoin);
  const [timeRange, setTimeRange] = useState<TimeRange>('1D');

  const currentAsset = useMemo(
    () => assets.find((a) => a.symbol === selectedCoin) ?? assets[0],
    [assets, selectedCoin]
  );

  const chartData = useMemo(() => {
    if (!currentAsset) return [];
    return generatePriceData(currentAsset.price, currentAsset.change24h, POINTS_MAP[timeRange]);
  }, [currentAsset, timeRange]);

  const chartDims = useMemo(() => {
    const width = 800;
    const height = 400;
    const padding = 20;
    const min = chartData.length > 0 ? Math.min(...chartData) : 0;
    const max = chartData.length > 0 ? Math.max(...chartData) : 1;
    const range = max - min || 1;
    const xStep = (width - padding * 2) / (chartData.length - 1 || 1);
    return { width, height, padding, min, max, range, xStep };
  }, [chartData]);

  const svgPath = useMemo(() => {
    if (chartData.length < 2) return '';
    const { width, height, padding, min, range, xStep } = chartDims;
    return chartData
      .map((val, i) => {
        const x = padding + i * xStep;
        const y = height - padding - ((val - min) / range) * (height - padding * 2);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }, [chartData, chartDims]);

  const svgAreaPath = useMemo(() => {
    if (chartData.length < 2) return '';
    const { width, height, padding, min, range, xStep } = chartDims;
    const linePoints = chartData.map((val, i) => {
      const x = padding + i * xStep;
      const y = height - padding - ((val - min) / range) * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const lastX = padding + (chartData.length - 1) * xStep;
    const firstX = padding;
    return `M ${firstX.toFixed(2)} ${height - padding} L ${linePoints.join(' L ')} L ${lastX.toFixed(2)} ${height - padding} Z`;
  }, [chartData, chartDims]);

  const handleCoinChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedCoin(e.target.value);
    },
    [setSelectedCoin]
  );

  if (!currentAsset) return null;

  const endDot = (() => {
    const { height, padding, min, range } = chartDims;
    const lastVal = chartData[chartData.length - 1];
    const cx = 780;
    const cy = height - padding - ((lastVal - min) / range) * (height - padding * 2);
    return { cx, cy };
  })();

  return (
    <div className="animate-fade-in-up space-y-6 p-6">
      <h1 className="text-4xl font-bold gradient-text-3">Price Chart</h1>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <select
          value={selectedCoin}
          onChange={handleCoinChange}
          className="px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-foreground focus:outline-none focus:border-white/[0.15] transition-colors cursor-pointer min-w-[140px]"
        >
          {assets.map((a) => (
            <option key={a.symbol} value={a.symbol} className="bg-zinc-900 text-foreground">
              {a.symbol} — {a.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.08]">
          {TIME_RANGES.map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                timeRange === range
                  ? 'bg-white/[0.1] text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-4">
        <span className="text-3xl font-bold text-foreground">
          {formatPrice(currentAsset.price)}
        </span>
        <span className={`text-lg font-semibold ${currentAsset.change24h >= 0 ? 'price-up' : 'price-down'}`}>
          {formatPercent(currentAsset.change24h)}
        </span>
      </div>

      <div className="glass-card-3d rounded-2xl p-4">
        <div className="w-full" style={{ height: 400 }}>
          <svg viewBox="0 0 800 400" preserveAspectRatio="none" className="w-full h-full">
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(139, 92, 246, 0.4)" />
                <stop offset="50%" stopColor="rgba(59, 130, 246, 0.15)" />
                <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
              </linearGradient>
              <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="50%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((pct) => (
              <line
                key={pct}
                x1="20"
                y1={20 + pct * 360}
                x2="780"
                y2={20 + pct * 360}
                stroke="rgba(255,255,255,0.04)"
                strokeWidth="1"
              />
            ))}
            <path d={svgAreaPath} fill="url(#chartGradient)" className="gradient-bg-1" />
            <path
              d={svgPath}
              fill="none"
              stroke="url(#lineGradient)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {chartData.length > 0 && (
              <>
                <circle cx={endDot.cx} cy={endDot.cy} r="6" fill="#3b82f6" opacity="0.3">
                  <animate attributeName="r" values="6;10;6" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite" />
                </circle>
                <circle cx={endDot.cx} cy={endDot.cy} r="3" fill="#3b82f6" />
              </>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}