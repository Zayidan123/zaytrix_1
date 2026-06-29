'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useCryptoStore } from '@/lib/store';
  User,
  Mail,
  Palette,
  Bell,
  Database,
  Key,
  Info,
  Download,
  Trash2,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
const GRADIENT_PRESETS = [
  { name: 'Amber Rose', css: 'linear-gradient(135deg, #f59e0b, #f43f5e)', idx: 0 },
  { name: 'Emerald Cyan', css: 'linear-gradient(135deg, #10b981, #06b6d4)', idx: 1 },
  { name: 'Gold Glow', css: 'linear-gradient(135deg, #f59e0b, #facc15)', idx: 2 },
  { name: 'Teal Mint', css: 'linear-gradient(135deg, #14b8a6, #10b981)', idx: 3 },
  { name: 'Rose Amber', css: 'linear-gradient(135deg, #f43f5e, #f59e0b)', idx: 4 },
];
const mockApiKeys = [
  { id: 'key_1', name: 'ZC-PROD-01', key: 'zc_live_k8x2...m4p7', created: 'Dec 15, 2024', lastUsed: '2 hours ago' },
  { id: 'key_2', name: 'ZC-STAGE-02', key: 'zc_test_j3w9...q1r5', created: 'Jan 3, 2025', lastUsed: '1 day ago' },
  { id: 'key_3', name: 'ZC-READ-03', key: 'zc_read_n7v4...t8y2', created: 'Jan 10, 2025', lastUsed: '5 days ago' },
export default function SettingsHub() {
  const { activeGradient, setActiveGradient } = useCryptoStore();
  const [profileName, setProfileName] = useState('Alex Morgan');
  const [profileEmail, setProfileEmail] = useState('alex@zcapital.io');
  const [notifications, setNotifications] = useState({
    priceAlerts: true,
    tradeSignals: true,
    newsUpdates: false,
    system: true,
  });
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [addKeyDialogOpen, setAddKeyDialogOpen] = useState(false);
  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  const copyKey = (id: string) => {
    navigator.clipboard.writeText(mockApiKeys.find(k => k.id === id)?.key.replace('...', 'a1b2c3d4e5f6') ?? '');
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  const handleExportData = () => {
    const blob = new Blob([JSON.stringify({ exportDate: new Date().toISOString(), data: 'mock-export' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zcapital-export.json';
    a.click();
    URL.revokeObjectURL(url);
  const handleClearCache = () => {
    console.log('Cache cleared');
  return (
    <div className="space-y-8 p-6 animate-fade-in-up">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold gradient-text-4">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your profile, theme, notifications, and preferences</p>
      </div>
      {/* Profile Section */}
      <div className="glass-card-3d p-8 animate-scale-in">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-teal-500/10">
            <User className="h-5 w-5 text-teal-400" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Profile</h2>
        </div>
        <div className="flex flex-col md:flex-row gap-8">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-3xl font-bold text-white shadow-lg shadow-teal-500/20">
              AM
            </div>
            <span className="text-xs text-muted-foreground">Pro Member</span>
          {/* Fields */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-muted-foreground text-sm">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="pl-10 bg-white/[0.04] border-white/[0.08] text-foreground"
                />
              </div>
              <Label htmlFor="email" className="text-muted-foreground text-sm">Email Address</Label>
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  id="email"
                  type="email"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
            <div className="md:col-span-2 flex justify-end pt-2">
              <Button className="gradient-bg-4 text-foreground font-semibold hover:opacity-90 transition-opacity">
                Save Changes
              </Button>
      {/* Theme Selector */}
      <div className="glass-card p-8 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Palette className="h-5 w-5 text-amber-400" />
          <h2 className="text-xl font-semibold text-foreground">Theme</h2>
        <p className="text-sm text-muted-foreground mb-5">Choose a gradient theme for your dashboard</p>
        <div className="flex flex-wrap gap-6">
          {GRADIENT_PRESETS.map((preset) => (
            <button
              key={preset.idx}
              onClick={() => setActiveGradient(preset.idx)}
              className="flex flex-col items-center gap-3 group"
            >
              <div
                className={`w-14 h-14 rounded-full transition-all duration-300 ${
                  activeGradient === preset.idx
                    ? 'ring-2 ring-foreground ring-offset-2 ring-offset-[#0a0b0f] scale-110'
                    : 'hover:scale-105'
                }`}
                style={{ background: preset.css }}
              />
              <span className={`text-xs font-medium transition-colors ${activeGradient === preset.idx ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>
                {preset.name}
              </span>
              {activeGradient === preset.idx && (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 -mt-2" />
              )}
            </button>
          ))}
      {/* Notifications */}
      <div className="glass-card p-8 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <Bell className="h-5 w-5 text-cyan-400" />
          <h2 className="text-xl font-semibold text-foreground">Notifications</h2>
        <div className="space-y-5">
          {[
            { key: 'priceAlerts' as const, label: 'Price Alerts', desc: 'Get notified when tracked assets hit target prices' },
            { key: 'tradeSignals' as const, label: 'Trade Signals', desc: 'AI-powered buy/sell signal notifications' },
            { key: 'newsUpdates' as const, label: 'News Updates', desc: 'Breaking crypto news and market analysis' },
            { key: 'system' as const, label: 'System Notifications', desc: 'Account activity, security alerts, and updates' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between p-4 rounded-lg bg-white/[0.03] hover:bg-white/[0.05] transition-colors">
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
              <Switch
                checked={notifications[item.key]}
                onCheckedChange={() => toggleNotification(item.key)}
      {/* Data Management */}
      <div className="glass-card p-8 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <div className="p-2 rounded-lg bg-violet-500/10">
            <Database className="h-5 w-5 text-violet-400" />
          <h2 className="text-xl font-semibold text-foreground">Data Management</h2>
        <div className="flex flex-wrap gap-4">
          <Button
            variant="outline"
            onClick={handleExportData}
            className="border-white/[0.1] text-foreground hover:bg-white/[0.05] hover:text-foreground"
          >
            <Download className="h-4 w-4 mr-2" />
            Export Data
          </Button>
            onClick={handleClearCache}
            className="border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Cache
      {/* API Keys */}
      <div className="glass-card p-8 animate-fade-in-up" style={{ animationDelay: '0.25s' }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Key className="h-5 w-5 text-amber-400" />
            <h2 className="text-xl font-semibold text-foreground">API Keys</h2>
          <Dialog open={addKeyDialogOpen} onOpenChange={setAddKeyDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gradient-bg-1 text-foreground font-semibold hover:opacity-90 transition-opacity">
                <Plus className="h-4 w-4 mr-1" />
                Add Key
            </DialogTrigger>
            <DialogContent className="glass-card border-white/10 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-foreground">Create New API Key</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Generate a new API key for programmatic access
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-sm">Key Name</Label>
                  <Input placeholder="e.g. ZC-TRADING-04" className="bg-white/[0.04] border-white/[0.08] text-foreground" />
                </div>
                  <Label className="text-muted-foreground text-sm">Permissions</Label>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-white/10 text-foreground cursor-pointer hover:bg-white/[0.05]">Read</Badge>
                    <Badge variant="outline" className="border-white/10 text-muted-foreground cursor-pointer hover:bg-white/[0.05]">Trade</Badge>
                    <Badge variant="outline" className="border-white/10 text-muted-foreground cursor-pointer hover:bg-white/[0.05]">Withdraw</Badge>
                  </div>
                <Button className="w-full gradient-bg-1 text-foreground font-semibold hover:opacity-90 transition-opacity">
                  Generate Key
                </Button>
            </DialogContent>
          </Dialog>
        <div className="space-y-3 stagger-children">
          {mockApiKeys.map((apiKey) => (
            <div key={apiKey.id} className="flex items-center gap-4 p-4 rounded-lg bg-white/[0.03] hover:bg-white/[0.05] transition-colors">
              <div className="p-2 rounded-lg bg-white/[0.05] shrink-0">
                <Key className="h-4 w-4 text-amber-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{apiKey.name}</span>
                <div className="flex items-center gap-1 mt-1">
                  <code className="text-xs font-mono text-muted-foreground">
                    {visibleKeys[apiKey.id] ? 'zc_live_k8x2a1b2c3d4e5f6m4p7' : apiKey.key}
                  </code>
                  <button onClick={() => toggleKeyVisibility(apiKey.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                    {visibleKeys[apiKey.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button onClick={() => copyKey(apiKey.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                    {copiedKey === apiKey.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>Created {apiKey.created}</span>
                  <span>·</span>
                  <span>Last used {apiKey.lastUsed}</span>
      {/* About */}
      <div className="glass-card p-8 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <Info className="h-5 w-5 text-emerald-400" />
          <h2 className="text-xl font-semibold text-foreground">About</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-4 rounded-lg bg-white/[0.03]">
            <p className="text-xs text-muted-foreground mb-1">Version</p>
            <p className="text-sm font-semibold text-foreground">Z-CAPITAL v3.0.0</p>
            <p className="text-xs text-muted-foreground mb-1">Build Date</p>
            <p className="text-sm font-semibold text-foreground">January 2025</p>
            <p className="text-xs text-muted-foreground mb-1">Links</p>
            <div className="flex items-center gap-3 mt-1">
              <button className="text-sm text-foreground hover:underline flex items-center gap-1">
                Documentation <ExternalLink className="h-3 w-3" />
              </button>
                Support <ExternalLink className="h-3 w-3" />
    </div>
  );
}
