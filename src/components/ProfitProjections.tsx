'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { formatPrice, formatNumber } from '@/lib/helpers';
interface Scenario {
  label: string;
  annualRate: number;
  color: string;
  gradientId: string;
}
const SCENARIOS: Scenario[] = [
  { label: 'Conservative', annualRate: 0.05, color: '#06b6d4', gradientId: 'gradConservative' },
  { label: 'Moderate', annualRate: 0.15, color: '#10b981', gradientId: 'gradModerate' },
  { label: 'Aggressive', annualRate: 0.30, color: '#f59e0b', gradientId: 'gradAggressive' },
];
function projectDCA(
  initial: number,
  monthly: number,
  months: number,
  annualRate: number
): number[] {
  const monthlyRate = annualRate / 12;
  const curve: number[] = [initial];
  for (let i = 1; i <= months; i++) {
    const prev = curve[i - 1];
    curve.push(prev * (1 + monthlyRate) + monthly);
  }
  return curve;
const CHART_W = 640;
const CHART_H = 280;
const PAD_L = 65;
const PAD_R = 20;
const PAD_T = 15;
const PAD_B = 35;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;
export default function ProfitProjections() {
  const [initial, setInitial] = useState('10000');
  const [monthly, setMonthly] = useState('500');
  const [months, setMonths] = useState('36');
  const [customReturn, setCustomReturn] = useState('15');
  const parsed = useMemo(
    () => ({
      initial: parseFloat(initial) || 0,
      monthly: parseFloat(monthly) || 0,
      months: Math.min(Math.max(parseInt(months) || 12, 1), 120),
      customReturn: parseFloat(customReturn) || 0,
    }),
    [initial, monthly, months, customReturn]
  );
  const curves = useMemo(() => {
    const customScenario: Scenario = {
      label: 'Custom',
      annualRate: parsed.customReturn / 100,
      color: '#f43f5e',
      gradientId: 'gradCustom',
    };
    const allScenarios = [...SCENARIOS, customScenario];
    return allScenarios.map((s) => ({
      ...s,
      curve: projectDCA(parsed.initial, parsed.monthly, parsed.months, s.annualRate),
      finalValue: projectDCA(parsed.initial, parsed.monthly, parsed.months, s.annualRate)[parsed.months],
    }));
  }, [parsed]);
  const totalInvested = parsed.initial + parsed.monthly * parsed.months;
  const maxValue = Math.max(...curves.flatMap((c) => c.curve), 1);
  // Y-axis ticks (5 ticks)
  const yTicks = 5;
  const yValues = Array.from({ length: yTicks + 1 }, (_, i) => (maxValue / yTicks) * i);
  // X-axis ticks (show every N months)
  const xStep = Math.max(1, Math.floor(parsed.months / 6));
  const xTicks = Array.from({ length: Math.floor(parsed.months / xStep) + 1 }, (_, i) => i * xStep);
  // Build area path
  const buildAreaPath = (curve: number[]): string => {
    const points: string[] = [];
    for (let i = 0; i < curve.length; i++) {
      const x = PAD_L + (i / parsed.months) * PLOT_W;
      const y = PAD_T + PLOT_H - (curve[i] / maxValue) * PLOT_H;
      points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    // Close area to bottom
    const lastX = PAD_L + PLOT_W;
    points.push(`L${lastX.toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)}`);
    points.push(`L${PAD_L.toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)}`);
    points.push('Z');
    return points.join(' ');
  };
  // Build line path
  const buildLinePath = (curve: number[]): string => {
  // Total invested line
  const investedY = PAD_T + PLOT_H - (totalInvested / maxValue) * PLOT_H;
  const moderateScenario = curves[1]; // Moderate (15%)
  const projectedProfit = moderateScenario ? moderateScenario.finalValue - totalInvested : 0;
  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold gradient-text-4">Profit Projections</h1>
        <p className="text-muted-foreground mt-1">DCA profit calculator with multi-scenario projections</p>
      </div>
      {/* Input Section */}
      <div className="glass-card-3d p-6">
        <p className="text-foreground text-lg font-semibold mb-4">Investment Parameters</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-sm">Initial Investment ($)</Label>
            <Input
              type="number"
              min="0"
              value={initial}
              onChange={(e) => setInitial(e.target.value)}
              className="bg-transparent border-white/10 text-foreground"
            />
          </div>
            <Label className="text-muted-foreground text-sm">Monthly DCA ($)</Label>
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            <Label className="text-muted-foreground text-sm">Period (months)</Label>
              min="1"
              max="120"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            <Label className="text-muted-foreground text-sm">Expected Annual Return (%)</Label>
              step="0.5"
              value={customReturn}
              onChange={(e) => setCustomReturn(e.target.value)}
        </div>
      {/* Scenario Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 stagger-children">
        {SCENARIOS.map((s) => {
          const data = curves.find((c) => c.label === s.label);
          const finalVal = data?.finalValue ?? 0;
          const profit = finalVal - totalInvested;
          return (
            <div key={s.label} className="glass-card-3d p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                <p className="text-muted-foreground text-sm font-medium">{s.label} ({(s.annualRate * 100).toFixed(0)}%)</p>
              </div>
              <p className="text-foreground text-3xl font-bold tabular-nums">{formatPrice(finalVal)}</p>
              <p className={`text-sm font-medium mt-1 ${profit >= 0 ? 'price-up' : 'price-down'}`}>
                {profit >= 0 ? '+' : ''}
                {formatPrice(profit)} profit
              </p>
            </div>
          );
        })}
      {/* SVG Area Chart */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-foreground text-lg font-semibold">Projection Chart</p>
          <div className="flex flex-wrap gap-4 text-xs">
            {curves.map((c) => (
              <div key={c.label} className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded" style={{ backgroundColor: c.color }} />
                <span className="text-muted-foreground">{c.label}</span>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded bg-white/30 border-dashed border-t border-white/50" style={{ borderTop: '2px dashed rgba(255,255,255,0.4)' }} />
              <span className="text-muted-foreground">Invested</span>
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
              <linearGradient key={c.gradientId} id={c.gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.color} stopOpacity="0.35" />
                <stop offset="100%" stopColor={c.color} stopOpacity="0.02" />
              </linearGradient>
          </defs>
          {/* Grid lines */}
          {yValues.map((v, i) => {
            const y = PAD_T + PLOT_H - (v / maxValue) * PLOT_H;
            return (
              <g key={i}>
                <line x1={PAD_L} y1={y} x2={PAD_L + PLOT_W} y2={y} stroke="rgba(255,255,255,0.06)" />
                <text x={PAD_L - 8} y={y + 4} textAnchor="end" fill="#a1a1aa" fontSize="9" className="tabular-nums">
                  {formatNumber(v)}
                </text>
              </g>
            );
          })}
          {/* X-axis ticks */}
          {xTicks.map((m) => {
            const x = PAD_L + (m / parsed.months) * PLOT_W;
              <g key={m}>
                <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + PLOT_H} stroke="rgba(255,255,255,0.04)" />
                <text x={x} y={PAD_T + PLOT_H + 18} textAnchor="middle" fill="#a1a1aa" fontSize="9">
                  {m}mo
          {/* Total invested line (dashed) */}
          {investedY > PAD_T && investedY < PAD_T + PLOT_H && (
            <line
              x1={PAD_L}
              y1={investedY}
              x2={PAD_L + PLOT_W}
              y2={investedY}
              stroke="rgba(255,255,255,0.25)"
              strokeDasharray="6 4"
              strokeWidth="1"
          )}
          {/* Area fills (draw conservative first, then moderate, then aggressive on top) */}
          {[2, 0, 3, 1].map((idx) => {
            const c = curves[idx];
            if (!c) return null;
              <path
                key={c.label}
                d={buildAreaPath(c.curve)}
                fill={`url(#${c.gradientId})`}
              />
          {/* Line strokes */}
                key={`line-${c.label}`}
                d={buildLinePath(c.curve)}
                fill="none"
                stroke={c.color}
                strokeWidth="2"
                strokeLinejoin="round"
        </svg>
      <Separator className="opacity-20" />
      {/* Summary Metrics */}
        <div className="glass-card-3d p-6 text-center">
          <p className="text-muted-foreground text-sm mb-1">Total Invested</p>
          <p className="text-foreground text-2xl font-bold tabular-nums">{formatPrice(totalInvested)}</p>
          <p className="text-muted-foreground text-sm mb-1">Projected Value (Moderate)</p>
          <p className="text-foreground text-2xl font-bold tabular-nums">{formatPrice(moderateScenario?.finalValue ?? 0)}</p>
          <p className="text-muted-foreground text-sm mb-1">Projected Profit (Moderate)</p>
          <p className={`text-2xl font-bold tabular-nums ${projectedProfit >= 0 ? 'price-up' : 'price-down'}`}>
            {projectedProfit >= 0 ? '+' : ''}
            {formatPrice(projectedProfit)}
          </p>
    </div>
