'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, RotateCcw, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useCryptoStore } from '@/lib/store'
import { formatPrice, formatPercent } from '@/lib/helpers'
const STRATEGIES = ['Golden Cross', 'RSI Reversal', 'Bollinger Bounce', 'MACD Crossover']
const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']
const PERIODS = ['30d', '90d', '180d', '365d']
interface BacktestTrade {
  date: string
  type: 'BUY' | 'SELL'
  price: number
  amount: number
  pnl?: number
}
interface BacktestResult {
  strategy: string
  totalReturn: number
  maxDrawdown: number
  sharpeRatio: number
  winRate: number
  totalTrades: number
  trades: BacktestTrade[]
  equityCurve: number[]
function generateMockResult(strategy: string, coin: string, capital: number, period: string): BacktestResult {
  const days = parseInt(period) || 90
  const strategyMultiplier: Record<string, number> = {
    'Golden Cross': 0.18,
    'RSI Reversal': 0.12,
    'Bollinger Bounce': 0.15,
    'MACD Crossover': 0.14,
  }
  const mult = strategyMultiplier[strategy] || 0.12
  const equityCurve: number[] = [capital]
  const trades: BacktestTrade[] = []
  let currentPrice = coin === 'BTC' ? 95000 : coin === 'ETH' ? 2800 : coin === 'SOL' ? 140 : coin === 'BNB' ? 600 : 2.0
  let peak = capital
  let maxDD = 0
  let wins = 0
  let position = 0
  for (let d = 1; d <= days; d++) {
    const dailyReturn = (mult / 365) + (Math.random() - 0.48) * 0.03
    currentPrice *= (1 + dailyReturn)
    equityCurve.push(equityCurve[equityCurve.length - 1] * (1 + dailyReturn + (Math.random() - 0.5) * 0.005))
    if (equityCurve[equityCurve.length - 1] > peak) peak = equityCurve[equityCurve.length - 1]
    const dd = (peak - equityCurve[equityCurve.length - 1]) / peak
    if (dd > maxDD) maxDD = dd
    if (Math.random() < 0.12) {
      const isBuy = position === 0 || Math.random() > 0.5
      const tradeAmount = capital * (0.05 + Math.random() * 0.15)
      const pnl = isBuy ? undefined : (currentPrice - trades[trades.length - 1]?.price || currentPrice) * (tradeAmount / currentPrice)
      if (pnl !== undefined && pnl > 0) wins++
      trades.push({
        date: new Date(Date.now() - (days - d) * 86400000).toISOString().split('T')[0],
        type: isBuy ? 'BUY' : 'SELL',
        price: currentPrice,
        amount: tradeAmount / currentPrice,
        pnl,
      })
      if (!isBuy) position = 0
      else position = tradeAmount / currentPrice
    }
  const totalReturn = (equityCurve[equityCurve.length - 1] - capital) / capital * 100
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0
  return {
    strategy,
    totalReturn,
    maxDrawdown: maxDD * 100,
    sharpeRatio: (totalReturn / Math.max(maxDD, 0.01)) * 0.4 + Math.random() * 0.3,
    winRate,
    totalTrades: trades.length,
    trades: trades.slice(-20),
    equityCurve,
export default function StrategyBacktester() {
  const { assets } = useCryptoStore()
  const [strategy, setStrategy] = useState(STRATEGIES[0])
  const [coin, setCoin] = useState('BTC')
  const [capital, setCapital] = useState('10000')
  const [period, setPeriod] = useState('90d')
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const runBacktest = () => {
    setIsRunning(true)
    setTimeout(() => {
      const r = generateMockResult(strategy, coin, parseFloat(capital) || 10000, period)
      setResult(r)
      setIsRunning(false)
    }, 1500)
  const currentAsset = assets.find(a => a.symbol === coin)
  const minCurve = result ? Math.min(...result.equityCurve) : 0
  const maxCurve = result ? Math.max(...result.equityCurve) : 1
  const curveRange = maxCurve - minCurve || 1
  const metrics = result
    ? [
        { label: 'Total Return', value: formatPercent(result.totalReturn), color: result.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400', icon: result.totalReturn >= 0 ? TrendingUp : TrendingDown },
        { label: 'Max Drawdown', value: formatPercent(-result.maxDrawdown), color: 'text-red-400', icon: TrendingDown },
        { label: 'Sharpe Ratio', value: result.sharpeRatio.toFixed(2), color: 'text-cyan-400', icon: BarChart3 },
        { label: 'Win Rate', value: `${result.winRate.toFixed(1)}%`, color: 'text-amber-400', icon: TrendingUp },
        { label: 'Total Trades', value: result.totalTrades.toString(), color: 'text-foreground', icon: BarChart3 },
      ]
    : []
  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold gradient-text-5">Strategy Backtester</h2>
        {result && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setResult(null)}>
            <RotateCcw className="w-4 h-4 mr-2" /> Reset
          </Button>
        )}
      </div>
      {/* Configuration */}
      <div className="glass-card-3d p-5">
        <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Configuration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label className="text-foreground text-sm">Strategy</Label>
            <Select value={strategy} onValueChange={setStrategy}>
              <SelectTrigger className="bg-white/[0.05] border-white/[0.08] text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#12131a] border-white/[0.08]">
                {STRATEGIES.map(s => <SelectItem key={s} value={s} className="text-foreground">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
            <Label className="text-foreground text-sm">Coin</Label>
            <Select value={coin} onValueChange={setCoin}>
                {COINS.map(c => <SelectItem key={c} value={c} className="text-foreground">{c}</SelectItem>)}
            <Label className="text-foreground text-sm">Starting Capital ($)</Label>
            <Input type="number" value={capital} onChange={e => setCapital(e.target.value)}
              className="bg-white/[0.05] border-white/[0.08] text-foreground" />
            <Label className="text-foreground text-sm">Period</Label>
            <Select value={period} onValueChange={setPeriod}>
                {PERIODS.map(p => <SelectItem key={p} value={p} className="text-foreground">{p}</SelectItem>)}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button onClick={runBacktest} disabled={isRunning}
            className="gradient-bg-1 text-black font-semibold hover:opacity-90 transition-opacity">
            {isRunning ? (
              <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> Running...</span>
            ) : (
              <span className="flex items-center gap-2"><Play className="w-4 h-4" /> Run Backtest</span>
            )}
          {currentAsset && (
            <span className="text-sm text-muted-foreground">
              Current {coin} price: <span className="text-foreground font-medium">{formatPrice(currentAsset.price)}</span>
            </span>
          )}
      {/* Results */}
      {result && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 stagger-children">
            {metrics.map((m, i) => {
              const Icon = m.icon
              return (
                <div key={i} className="glass-card-3d p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{m.label}</span>
                  </div>
                  <span className={`text-xl font-bold ${m.color}`}>{m.value}</span>
                </div>
              )
            })}
          {/* Equity Curve */}
          <div className="glass-card-3d p-5">
            <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Equity Curve</h3>
            <div className="w-full overflow-x-auto">
              <svg viewBox={`0 0 ${result.equityCurve.length * 4} 200`} className="w-full min-w-[600px]" style={{ height: '300px' }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#f43f5e" />
                </defs>
                {/* Grid lines */}
                {[0, 1, 2, 3, 4].map(i => (
                  <line key={i} x1="0" y1={i * 50} x2={result.equityCurve.length * 4} y2={i * 50}
                    stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                ))}
                {/* Area fill */}
                <path d={`M 0 ${200 - ((result.equityCurve[0] - minCurve) / curveRange) * 180 - 10} ${result.equityCurve.map((v, i) => `L ${i * 4} ${200 - ((v - minCurve) / curveRange) * 180 - 10}`).join(' ')} L ${result.equityCurve.length * 4} 200 L 0 200 Z`}
                  fill="url(#equityGrad)" />
                {/* Line */}
                <path d={`M 0 ${200 - ((result.equityCurve[0] - minCurve) / curveRange) * 180 - 10} ${result.equityCurve.map((v, i) => `L ${i * 4} ${200 - ((v - minCurve) / curveRange) * 180 - 10}`).join(' ')}`
                  fill="none" stroke="url(#lineGrad)" strokeWidth="2" strokeLinejoin="round" />
                {/* End dot */}
                <circle cx={(result.equityCurve.length - 1) * 4}
                  cy={200 - ((result.equityCurve[result.equityCurve.length - 1] - minCurve) / curveRange) * 180 - 10}
                  r="4" fill="#f59e0b" />
              </svg>
            </div>
          {/* Trade Log */}
            <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Trade Log</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="text-muted-foreground border-b border-white/[0.06]">
                    <th className="text-left py-2 px-3 font-medium">Date</th>
                    <th className="text-left py-2 px-3 font-medium">Type</th>
                    <th className="text-right py-2 px-3 font-medium">Price</th>
                    <th className="text-right py-2 px-3 font-medium">Amount</th>
                    <th className="text-right py-2 px-3 font-medium">PnL</th>
                  </tr>
                </thead>
                <tbody className="max-h-72 overflow-y-auto">
                  {result.trades.map((t, i) => (
                    <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-3 text-foreground">{t.date}</td>
                      <td className="py-2.5 px-3">
                        <Badge variant={t.type === 'BUY' ? 'default' : 'destructive'}
                          className={t.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}>
                          {t.type}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right text-foreground font-mono">{formatPrice(t.price)}</td>
                      <td className="py-2.5 px-3 text-right text-foreground font-mono">{t.amount.toFixed(6)}</td>
                      <td className={`py-2.5 px-3 text-right font-mono ${t.pnl !== undefined ? (t.pnl >= 0 ? 'price-up' : 'price-down') : 'text-muted-foreground'}`}>
                        {t.pnl !== undefined ? formatPrice(t.pnl) : '—'}
                    </tr>
                  ))}
                </tbody>
              </table>
        </motion.div>
      )}
      {!result && !isRunning && (
        <div className="glass-card-3d p-12 text-center">
          <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <p className="text-muted-foreground">Configure your strategy and click &quot;Run Backtest&quot; to see results</p>
    </div>
  )
}