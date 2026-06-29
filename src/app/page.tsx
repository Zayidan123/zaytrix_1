'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Coins, CandlestickChart, Wallet, Brain, FileText,
  TrendingUp, FlaskConical, Zap, BookOpen, ShieldCheck, Settings,
  Menu, X, ChevronLeft, Wifi, WifiOff, Sparkles
} from 'lucide-react'
import { useCryptoStore } from '@/lib/store'
import Dashboard from '@/components/Dashboard'
import CoinList from '@/components/CoinList'
import PriceChart from '@/components/PriceChart'
import CryptoHub from '@/components/CryptoHub'
import AITradeSignals from '@/components/AITradeSignals'
import AIDocCompare from '@/components/AIDocCompare'
import ProfitProjections from '@/components/ProfitProjections'
import StrategyBacktester from '@/components/StrategyBacktester'
import TradeAutomation from '@/components/TradeAutomation'
import LedgerTax from '@/components/LedgerTax'
import Security2FA from '@/components/Security2FA'
import SettingsHub from '@/components/SettingsHub'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'coins', label: 'Coin List', icon: Coins },
  { id: 'chart', label: 'Price Chart', icon: CandlestickChart },
  { id: 'crypto-hub', label: 'Portfolio', icon: Wallet },
  { id: 'ai-signals', label: 'AI Signals', icon: Brain },
  { id: 'ai-docs', label: 'Doc Compare', icon: FileText },
  { id: 'projections', label: 'Projections', icon: TrendingUp },
  { id: 'backtester', label: 'Backtester', icon: FlaskConical },
  { id: 'automation', label: 'Automation', icon: Zap },
  { id: 'ledger', label: 'Ledger & Tax', icon: BookOpen },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const

const GRADIENT_NAMES = ['Sunset Fire', 'Ocean Aurora', 'Golden Hour', 'Forest Dew', 'Blaze Rose']

const pageVariants = {
  initial: { opacity: 0, y: 16, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
  exit: { opacity: 0, y: -10, scale: 0.985, transition: { duration: 0.3, ease: 'easeIn' as const } },
}

function PageRenderer({ pageId }: { pageId: string }) {
  switch (pageId) {
    case 'dashboard': return <Dashboard />
    case 'coins': return <CoinList />
    case 'chart': return <PriceChart />
    case 'crypto-hub': return <CryptoHub />
    case 'ai-signals': return <AITradeSignals />
    case 'ai-docs': return <AIDocCompare />
    case 'projections': return <ProfitProjections />
    case 'backtester': return <StrategyBacktester />
    case 'automation': return <TradeAutomation />
    case 'ledger': return <LedgerTax />
    case 'security': return <Security2FA />
    case 'settings': return <SettingsHub />
    default: return <Dashboard />
  }
}

export default function Home() {
  const [activePage, setActivePage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { isConnected, activeGradient, setActiveGradient, assets } = useCryptoStore()

  const connectSocket = useCallback(() => {
    let active = true
    ;(async () => {
      try {
        const { io } = await import('socket.io-client')
        if (!active) return
        const socket = io('/?XTransformPort=3005', {
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 2000,
        })
        socket.on('connect', () => { if (active) useCryptoStore.getState().setConnected(true) })
        socket.on('disconnect', () => { if (active) useCryptoStore.getState().setConnected(false) })
        socket.on('price-update', (data: unknown) => {
          if (active && Array.isArray(data)) useCryptoStore.getState().setAssets(data)
        })
        socket.on('connect_error', () => { if (active) useCryptoStore.getState().setConnected(false) })
      } catch {
        // Socket.IO not available, using demo data
      }
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const cleanup = connectSocket()
    const interval = setInterval(() => {
      const store = useCryptoStore.getState()
      if (!store.isConnected) {
        const updated = store.assets.map(a => ({
          ...a,
          price: a.price * (1 + (Math.random() - 0.5) * 0.002),
          change24h: a.change24h + (Math.random() - 0.5) * 0.1,
        }))
        store.setAssets(updated)
      }
    }, 3000)
    return () => { cleanup(); clearInterval(interval) }
  }, [connectSocket])

  const btcPrice = assets.find(a => a.symbol === 'BTC')?.price ?? 0
  const btcChange = assets.find(a => a.symbol === 'BTC')?.change24h ?? 0

  return (
    <div className="flex min-h-screen">
      {/* Desktop Sidebar */}
      <aside className={`hidden lg:flex flex-col h-screen sticky top-0 transition-all duration-500 ease-out ${sidebarOpen ? 'w-60' : 'w-16'}`}>
        <div className="glass-card-3d flex flex-col h-full rounded-none border-r border-white/[0.05] p-2">
          <div className="flex items-center gap-3 px-3 py-4 mb-2">
            <div className="w-9 h-9 rounded-xl gradient-bg-1 flex items-center justify-center flex-shrink-0 animate-pulse-glow">
              <Sparkles className="w-5 h-5 text-black" />
            </div>
            {sidebarOpen && (
              <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="overflow-hidden">
                <h1 className="text-lg font-bold gradient-text-1 whitespace-nowrap">Z-CAPITAL</h1>
                <p className="text-[10px] text-muted-foreground whitespace-nowrap">Crypto Intelligence</p>
              </motion.div>
            )}
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto">
            {NAV_ITEMS.map((item, i) => {
              const Icon = item.icon
              const isActive = activePage === item.id
              return (
                <motion.button
                  key={item.id}
                  onClick={() => { setActivePage(item.id); setMobileMenuOpen(false) }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 group relative ${
                    isActive ? 'nav-item-active' : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.03]'
                  }`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.3 }}
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <Icon className={`w-[18px] h-[18px] flex-shrink-0 transition-colors duration-300 ${
                    isActive ? 'text-amber-400' : 'group-hover:text-foreground'
                  }`} />
                  {sidebarOpen && <span className="whitespace-nowrap">{item.label}</span>}
                  {isActive && sidebarOpen && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="absolute right-2 w-1.5 h-1.5 rounded-full bg-amber-400"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                </motion.button>
              )
            })}
          </nav>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="flex items-center justify-center py-3 text-muted-foreground hover:text-foreground transition-colors">
            <motion.div animate={{ rotate: sidebarOpen ? 0 : 180 }} transition={{ duration: 0.3 }}>
              <ChevronLeft className="w-4 h-4" />
            </motion.div>
          </button>
        </div>
      </aside>

      {/* Mobile Menu Button */}
      <button className="lg:hidden fixed top-4 left-4 z-50 glass-card p-2.5 rounded-xl" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
        {mobileMenuOpen ? <X className="w-5 h-5 text-foreground" /> : <Menu className="w-5 h-5 text-foreground" />}
      </button>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setMobileMenuOpen(false)} />
            <motion.aside
              initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 w-64 z-50 glass-card-3d rounded-none border-r border-white/[0.05] p-3"
            >
              <div className="flex items-center gap-3 px-2 py-4 mb-4">
                <div className="w-9 h-9 rounded-xl gradient-bg-1 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-black" />
                </div>
                <div>
                  <h1 className="text-lg font-bold gradient-text-1">Z-CAPITAL</h1>
                  <p className="text-[10px] text-muted-foreground">Crypto Intelligence</p>
                </div>
              </div>
              <nav className="space-y-0.5">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon
                  const isActive = activePage === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setActivePage(item.id); setMobileMenuOpen(false) }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                        isActive ? 'nav-item-active' : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.03]'
                      }`}
                    >
                      <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-amber-400' : ''}`} />
                      <span className="text-foreground">{item.label}</span>
                    </button>
                  )
                })}
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 min-h-screen flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 glass-card rounded-none border-b border-white/[0.05] px-4 md:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 ml-10 lg:ml-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">BTC/USD</span>
                  <span className={isConnected ? 'status-dot connected' : 'status-dot disconnected'} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-foreground tabular-nums">
                    ${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                  <span className={`text-sm font-semibold ${btcChange >= 0 ? 'price-up' : 'price-down'}`}>
                    {btcChange >= 0 ? '▲' : '▼'} {Math.abs(btcChange).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                {isConnected
                  ? <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span>Live</span></>
                  : <><WifiOff className="w-3.5 h-3.5 text-red-400" /><span>Demo</span></>
                }
              </div>
              <div className="hidden md:flex items-center gap-1.5">
                {GRADIENT_NAMES.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveGradient(i)}
                    className={`w-5 h-5 rounded-full border-2 transition-all duration-300 hover:scale-110 ${
                      activeGradient === i ? 'border-white scale-125 shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                    style={{ background: `var(--gradient-${i + 1})` }}
                    title={name}
                  />
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-4 md:p-6">
          <AnimatePresence mode="wait">
            <motion.div key={activePage} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="w-full">
              <PageRenderer pageId={activePage} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <footer className="glass-card rounded-none border-t border-white/[0.05] px-4 py-3 mt-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>© 2025 Z-CAPITAL — Advanced Crypto Intelligence</span>
            <span className="flex items-center gap-1.5">
              <span className={isConnected ? 'status-dot connected' : 'status-dot disconnected'} />
              {isConnected ? 'Real-time data' : 'Demo mode'}
            </span>
          </div>
        </footer>
      </main>
    </div>
  )
}