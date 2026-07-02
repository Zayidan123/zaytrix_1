import React from "react";
import { motion } from "motion/react";
import {
  LayoutDashboard,
  TrendingUp,
  Coins,
  ShieldCheck,
  Cpu,
  BarChart3,
  LineChart,
  Wallet,
  X,
  Files,
  ChevronLeft,
  ChevronRight,
  Radar,
  Settings as SettingsIcon,
  LogOut,
  User as UserIcon,
  Newspaper,
  Layers
} from "lucide-react";
import { auth, signOut } from "../lib/firebase";
import { useGlobalStore } from "../store";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  twoFactorEnabled: boolean;
  onClose?: () => void;
  isCollapsed: boolean;
  setIsCollapsed: (val: boolean) => void;
}

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  twoFactorEnabled, 
  onClose, 
  isCollapsed, 
  setIsCollapsed 
}: SidebarProps) {
  const user = useGlobalStore(state => state.user);
  const menuItems = [
    { id: "dashboard", name: "Dashboard", icon: LayoutDashboard },
    { id: "coins", name: "Coins Rankings", icon: Layers, status: "100 COINS" },
    { id: "news", name: "Newsroom Feed", icon: Newspaper, status: "THE BLOCK" },
    { id: "assets", name: "Crypto Hub", icon: Coins },
    { id: "whale-tracker", name: "On-Chain Data", icon: Radar, status: "MEMPOOL LIVE" },
    { id: "ai-signals", name: "AI Trade Signals", icon: LineChart, status: "LIVE ON-CHAIN" },
    { id: "multi-doc", name: "AI Multi-Doc Compare", icon: Files, status: "VIP" },
    { id: "projections", name: "Profit Projections", icon: TrendingUp },
    { id: "backtester", name: "Strategy Backtester", icon: BarChart3 },
    { id: "technical", name: "Technical Terminal", icon: LineChart },
    { id: "automation", name: "Trade Automation", icon: Cpu },
    { id: "ledger", name: "Ledger History & Tax", icon: Wallet, status: "TAX PNL" },
    { id: "security", name: "Security & 2FA", icon: ShieldCheck, status: twoFactorEnabled ? "Secured" : "Action Req" },
    { id: "settings", name: "Settings Hub", icon: SettingsIcon, status: "SYSTEM" },
  ];

  return (
    <aside 
      className={`h-full bg-[#0F172A] border-r border-[#1E293B] text-slate-100 flex flex-col justify-between transition-all duration-300 ${
        isCollapsed ? "w-20" : "w-64"
      }`} 
      id="app-sidebar"
    >
      {/* Upper Logo Section with sleek ZAYTRIX gold/neon-blue design */}
      <div className={`p-4 border-b border-slate-800/60 select-none shrink-0 ${isCollapsed ? "flex flex-col items-center" : "p-6"}`}>
        <div className={`flex items-center justify-between ${isCollapsed ? "w-full justify-center flex-col gap-4" : "w-full"}`}>
          <div className="flex items-center space-x-3">
            <div className="w-14 h-14 flex-shrink-0 flex items-center justify-center shadow-lg shadow-amber-500/10 rounded-lg bg-slate-950/70 border border-slate-800 p-1">
              <img src="/logo.png" alt="ZAYTRIX Logo" className="w-full h-full object-contain rounded-md" />
            </div>
            {!isCollapsed && (
              <div>
                <h1 className="text-sm font-black tracking-widest text-amber-500 uppercase font-sans">
                  ZAYTRIX
                </h1>
                <p className="text-[8px] text-slate-400 uppercase tracking-widest font-mono">INSTITUTIONAL GATEWAY</p>
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-1">
            {/* Collapse Toggle Button inside sidebar for desktop */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden md:flex p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded focus:outline-none cursor-pointer border border-transparent hover:border-slate-700/60 transition-all shadow-sm"
              title={isCollapsed ? "Buka Sidebar" : "Tutup Sidebar"}
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4 text-amber-500" /> : <ChevronLeft className="w-4 h-4" />}
            </button>

            {/* Close button on mobile views */}
            <button 
              onClick={onClose}
              className="md:hidden p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-850 rounded focus:outline-none cursor-pointer"
              title="Tutup Menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Items - Scrollable and clean styled! */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-1 scrollbar-thin scrollbar-thumb-slate-800/80 hover:scrollbar-thumb-slate-700 select-none">
        <nav className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <motion.button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  if (onClose) onClose();
                }}
                whileHover={{ scale: 1.015, x: 2 }}
                whileTap={{ scale: 0.985 }}
                id={`sidebar-btn-${item.id}`}
                title={item.name}
                className={`w-full flex items-center justify-between rounded-lg font-medium relative transition-colors cursor-pointer overflow-hidden group ${
                  isCollapsed ? "justify-center p-3 text-[15px]" : "px-4 py-3 text-xs"
                } ${
                  isActive
                    ? "text-amber-400 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {/* Active Sliding Background Layer */}
                {isActive && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute inset-0 bg-amber-500/10 border-l-2 border-amber-500 rounded-lg"
                    transition={{ type: "spring", stiffness: 380, damping: 28 }}
                  />
                )}

                <div className={`flex items-center font-semibold z-10 ${isCollapsed ? "" : "space-x-3"}`}>
                  <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? "text-amber-400" : "text-slate-400 group-hover:text-slate-200"}`} />
                  {!isCollapsed && <span className="truncate">{item.name}</span>}
                </div>
                {!isCollapsed && item.status && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 ml-1.5 z-10 ${
                    item.id === "security"
                      ? (twoFactorEnabled ? "bg-emerald-500/25 text-emerald-400" : "bg-amber-500/20 text-amber-400 animate-pulse")
                      : "bg-blue-500/25 text-blue-400 font-bold"
                  }`}>
                    {item.status}
                  </span>
                )}
              </motion.button>
            );
          })}
        </nav>
      </div>

      {/* User Session Info Area */}
      {user && (
        <div className={`p-3 border-t border-slate-800 bg-[#0A0F1D]/60 ${isCollapsed ? "flex flex-col items-center" : "space-y-2"}`}>
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 rounded-sm bg-gradient-to-tr from-amber-500 to-amber-600 flex items-center justify-center text-slate-950 font-black shrink-0 text-xs shadow-md">
              {user.displayName ? user.displayName.charAt(0).toUpperCase() : (user.email ? user.email.charAt(0).toUpperCase() : "U")}
            </div>
            {!isCollapsed && (
              <div className="min-w-0 flex-1 select-none">
                <p className="text-[11px] font-bold text-slate-200 truncate">{user.displayName || "Pengguna Z-Capital"}</p>
                <p className="text-[9px] text-slate-400 font-mono truncate">{user.email || user.phoneNumber || "Multi-Factor SECURE"}</p>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              signOut(auth);
            }}
            className={`flex items-center gap-2 text-slate-400 hover:text-red-400 transition-colors cursor-pointer w-full text-left ${
              isCollapsed ? "justify-center p-1" : "px-2 py-1.5 hover:bg-red-500/10 rounded-md text-[10px] font-bold uppercase font-mono"
            }`}
            title="Selesaikan Sesi Otentikasi Aman (Logout)"
          >
            <LogOut className="w-3.5 h-3.5 text-red-500 shrink-0" />
            {!isCollapsed && <span>Keluar Aman</span>}
          </button>
        </div>
      )}

      {/* Footer Info Area - Fixed at the bottom */}
      <div className={`p-4 border-t border-[#1E293B] bg-slate-950/40 text-xs shrink-0 select-none ${isCollapsed ? "flex flex-col items-center" : ""}`}>
        <div className={`flex items-center text-slate-400 mb-1.5 ${isCollapsed ? "justify-center" : "space-x-2"}`}>
          <Wallet className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          {!isCollapsed && <span className="font-mono text-[11px]">IDR Gateway Core</span>}
        </div>
        {!isCollapsed ? (
          <div className="text-[10px] text-slate-400 uppercase flex items-center justify-between">
            <span>Status:</span>
            <span className="text-emerald-400 font-mono font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
            </span>
          </div>
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="System Live" />
        )}
      </div>
    </aside>
  );
}
