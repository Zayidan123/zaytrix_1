'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Bell, TrendingUp, AlertTriangle, Clock, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { useCryptoStore } from '@/lib/store'
import { formatPrice } from '@/lib/helpers'

interface Rule {
  id: string
  symbol: string
  condition: string
  targetPrice: number
  action: string
  isActive: boolean
  createdAt: string
  triggered?: boolean
  triggeredAt?: string
}

interface AlertLog {
  id: string
  ruleId: string
  symbol: string
  message: string
  timestamp: string
  type: 'triggered' | 'created' | 'deleted'
}

const DEFAULT_RULES: Rule[] = [
  { id: 'r1', symbol: 'BTC', condition: 'ABOVE', targetPrice: 110000, action: 'ALERT', isActive: true, createdAt: '2025-01-15T10:30:00Z' },
  { id: 'r2', symbol: 'ETH', condition: 'BELOW', targetPrice: 2400, action: 'BUY', isActive: true, createdAt: '2025-01-16T14:20:00Z' },
  { id: 'r3', symbol: 'SOL', condition: 'CROSS_ABOVE', targetPrice: 180, action: 'SELL', isActive: false, createdAt: '2025-01-17T09:00:00Z' },
]

const DEFAULT_LOGS: AlertLog[] = [
  { id: 'l1', ruleId: 'r1', symbol: 'BTC', message: 'Price alert: BTC crossed above $105,000', timestamp: '2025-01-18T16:45:00Z', type: 'triggered' },
  { id: 'l2', ruleId: 'r2', symbol: 'ETH', message: 'Rule created: Buy ETH below $2,400', timestamp: '2025-01-16T14:20:00Z', type: 'created' },
]

const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX']

const CONDITIONS = [
  { value: 'ABOVE', label: 'Price Above' },
  { value: 'BELOW', label: 'Price Below' },
  { value: 'CROSS_ABOVE', label: 'Crosses Above' },
  { value: 'CROSS_BELOW', label: 'Crosses Below' },
]

const ACTIONS = [
  { value: 'ALERT', label: '🔔 Alert Only' },
  { value: 'BUY', label: '💰 Auto Buy' },
  { value: 'SELL', label: '📤 Auto Sell' },
]

export default function TradeAutomation() {
  const { assets } = useCryptoStore()
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES)
  const [logs, setLogs] = useState<AlertLog[]>(DEFAULT_LOGS)
  const [showForm, setShowForm] = useState(false)
  const [formSymbol, setFormSymbol] = useState('BTC')
  const [formCondition, setFormCondition] = useState('ABOVE')
  const [formPrice, setFormPrice] = useState('')
  const [formAction, setFormAction] = useState('ALERT')

  const addRule = useCallback(() => {
    if (!formPrice) return
    const newRule: Rule = {
      id: `r${Date.now()}`,
      symbol: formSymbol,
      condition: formCondition,
      targetPrice: parseFloat(formPrice),
      action: formAction,
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    setRules(prev => [newRule, ...prev])
    setLogs(prev => [{
      id: `l${Date.now()}`,
      ruleId: newRule.id,
      symbol: formSymbol,
      message: `Rule created: ${formAction} ${formSymbol} when ${formCondition} ${formatPrice(parseFloat(formPrice))}`,
      timestamp: new Date().toISOString(),
      type: 'created',
    }, ...prev])
    setShowForm(false)
    setFormPrice('')
  }, [formSymbol, formCondition, formPrice, formAction])

  const deleteRule = useCallback((id: string) => {
    const rule = rules.find(r => r.id === id)
    setRules(prev => prev.filter(r => r.id !== id))
    if (rule) {
      setLogs(prev => [{
        id: `l${Date.now()}`,
        ruleId: id,
        symbol: rule.symbol,
        message: `Rule deleted: ${rule.symbol} ${rule.condition} ${formatPrice(rule.targetPrice)}`,
        timestamp: new Date().toISOString(),
        type: 'deleted',
      }, ...prev])
    }
  }, [rules])

  const toggleRule = useCallback((id: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r))
  }, [])

  // Simulate rule triggers
  useEffect(() => {
    const interval = setInterval(() => {
      setRules(prev => {
        let updated = prev
        prev.forEach(r => {
          if (!r.isActive || r.triggered) return
          const asset = assets.find(a => a.symbol === r.symbol)
          if (!asset) return
          const triggered = r.condition === 'ABOVE' && asset.price > r.targetPrice
            || r.condition === 'BELOW' && asset.price < r.targetPrice
            || (r.condition === 'CROSS_ABOVE' || r.condition === 'CROSS_BELOW') && Math.random() < 0.02
          if (triggered) {
            updated = updated.map(rule =>
              rule.id === r.id ? { ...rule, triggered: true, triggeredAt: new Date().toISOString() } : rule
            )
            setLogs(logs => [{
              id: `l${Date.now()}`,
              ruleId: r.id,
              symbol: r.symbol,
              message: `🔔 TRIGGERED: ${r.action} ${r.symbol} — condition met at ${formatPrice(asset.price)}`,
              timestamp: new Date().toISOString(),
              type: 'triggered',
            }, ...logs])
          }
        })
        return updated
      })
    }, 5000)
    return () => clearInterval(interval)
  }, [assets])

  const activeCount = rules.filter(r => r.isActive).length
  const triggeredCount = rules.filter(r => r.triggered).length
  const getConditionLabel = (c: string) => CONDITIONS.find(x => x.value === c)?.label || c
  const getActionLabel = (a: string) => ACTIONS.find(x => x.value === a)?.label || a

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold gradient-text-1">Trade Automation</h2>
        <Button onClick={() => setShowForm(!showForm)}
          className="gradient-bg-1 text-black font-semibold hover:opacity-90">
          <Plus className="w-4 h-4 mr-2" /> New Rule
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 stagger-children">
        <div className="glass-card-3d p-4">
          <div className="flex items-center gap-2 mb-1"><Zap className="w-4 h-4 text-amber-400" /><span className="text-xs text-muted-foreground">Active Rules</span></div>
          <span className="text-2xl font-bold text-foreground">{activeCount}</span>
        </div>
        <div className="glass-card-3d p-4">
          <div className="flex items-center gap-2 mb-1"><Bell className="w-4 h-4 text-emerald-400" /><span className="text-xs text-muted-foreground">Triggered</span></div>
          <span className="text-2xl font-bold text-foreground">{triggeredCount}</span>
        </div>
        <div className="glass-card-3d p-4">
          <div className="flex items-center gap-2 mb-1"><Clock className="w-4 h-4 text-cyan-400" /><span className="text-xs text-muted-foreground">Total Rules</span></div>
          <span className="text-2xl font-bold text-foreground">{rules.length}</span>
        </div>
      </div>

      {/* Create Rule Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="glass-card-3d p-5 border-l-2 border-l-amber-500">
              <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Create New Rule</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label className="text-foreground text-sm">Coin</Label>
                  <Select value={formSymbol} onValueChange={setFormSymbol}>
                    <SelectTrigger className="bg-white/[0.05] border-white/[0.08] text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#12131a] border-white/[0.08]">
                      {COINS.map(c => <SelectItem key={c} value={c} className="text-foreground">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground text-sm">Condition</Label>
                  <Select value={formCondition} onValueChange={setFormCondition}>
                    <SelectTrigger className="bg-white/[0.05] border-white/[0.08] text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#12131a] border-white/[0.08]">
                      {CONDITIONS.map(c => <SelectItem key={c.value} value={c.value} className="text-foreground">{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground text-sm">Target Price ($)</Label>
                  <Input type="number" value={formPrice} onChange={e => setFormPrice(e.target.value)}
                    placeholder="0.00" className="bg-white/[0.05] border-white/[0.08] text-foreground" />
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground text-sm">Action</Label>
                  <Select value={formAction} onValueChange={setFormAction}>
                    <SelectTrigger className="bg-white/[0.05] border-white/[0.08] text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#12131a] border-white/[0.08]">
                      {ACTIONS.map(a => <SelectItem key={a.value} value={a.value} className="text-foreground">{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 flex gap-3">
                <Button onClick={addRule} disabled={!formPrice} className="gradient-bg-2 text-black font-semibold">
                  <Plus className="w-4 h-4 mr-2" /> Add Rule
                </Button>
                <Button variant="ghost" onClick={() => setShowForm(false)} className="text-muted-foreground">Cancel</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Rules */}
        <div className="glass-card-3d p-5">
          <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Active Rules</h3>
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {rules.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No rules configured</p>
              </div>
            ) : (
              rules.map(rule => {
                const asset = assets.find(a => a.symbol === rule.symbol)
                return (
                  <motion.div
                    key={rule.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className={`p-3 rounded-xl border transition-all duration-300 ${
                      rule.triggered ? 'bg-amber-500/10 border-amber-500/20' :
                      rule.isActive ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-white/[0.01] border-white/[0.04] opacity-50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-semibold">{rule.symbol}</span>
                        <Badge variant={rule.action === 'BUY' ? 'default' : rule.action === 'SELL' ? 'destructive' : 'secondary'}
                          className={
                            rule.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' :
                            rule.action === 'SELL' ? 'bg-red-500/20 text-red-400' :
                            'bg-amber-500/20 text-amber-400'
                          }>
                          {rule.action}
                        </Badge>
                        {rule.triggered && <Badge className="bg-amber-500/20 text-amber-400">TRIGGERED</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={rule.isActive} onCheckedChange={() => toggleRule(rule.id)} />
                        <Button variant="ghost" size="sm" onClick={() => deleteRule(rule.id)} className="text-red-400 hover:text-red-300 h-7 w-7 p-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{getConditionLabel(rule.condition)} {formatPrice(rule.targetPrice)}</span>
                      {asset && <span className="text-muted-foreground">Now: <span className="text-foreground">{formatPrice(asset.price)}</span></span>}
                    </div>
                  </motion.div>
                )
              })
            )}
          </div>
        </div>

        {/* Alert History */}
        <div className="glass-card-3d p-5">
          <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Alert History</h3>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/[0.03] transition-colors">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                  log.type === 'triggered' ? 'bg-amber-400' :
                  log.type === 'created' ? 'bg-emerald-400' : 'bg-red-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground break-words">{log.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{new Date(log.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}