'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Shield,
  ShieldCheck,
  Smartphone,
  Monitor,
  Globe,
  Clock,
  MapPin,
  Fingerprint,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  KeyRound,
} from 'lucide-react';

/* ── Constants ── */

const SCORE = 75;
const RADIUS = 80;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const STROKE_OFFSET = CIRCUMFERENCE - (SCORE / 100) * CIRCUMFERENCE;

const loginActivity = [
  { device: 'MacBook Pro', browser: 'Chrome 120', ip: '192.168.1.105', location: 'San Francisco, US', time: '2 min ago', current: true },
  { device: 'iPhone 15 Pro', browser: 'Safari 17', ip: '10.0.0.42', location: 'San Francisco, US', time: '1 hour ago', current: false },
  { device: 'Windows Desktop', browser: 'Firefox 121', ip: '203.45.67.89', location: 'New York, US', time: '3 hours ago', current: false },
  { device: 'iPad Air', browser: 'Safari 17', ip: '172.16.0.15', location: 'London, UK', time: '1 day ago', current: false },
  { device: 'Linux Server', browser: 'Chrome Headless', ip: '54.234.12.88', location: 'Frankfurt, DE', time: '2 days ago', current: false },
];

const activeSessions = [
  { id: 'sess_1', device: 'MacBook Pro', browser: 'Chrome 120', ip: '192.168.1.105', location: 'San Francisco, US', lastActive: 'Active now' },
  { id: 'sess_2', device: 'iPhone 15 Pro', browser: 'Safari 17', ip: '10.0.0.42', location: 'San Francisco, US', lastActive: '1 hour ago' },
  { id: 'sess_3', device: 'iPad Air', browser: 'Safari 17', ip: '172.16.0.15', location: 'London, UK', lastActive: '1 day ago' },
];

const auditLog = [
  { action: 'Login Attempt', details: 'Successful login via Chrome', time: '2 min ago', status: 'success' as const },
  { action: 'Password Change', details: 'Password updated successfully', time: '1 hour ago', status: 'success' as const },
  { action: 'API Key Generated', details: 'New API key "ZC-PROD-01" created', time: '3 hours ago', status: 'success' as const },
  { action: 'Login Attempt', details: 'Failed login from 203.45.67.89', time: '5 hours ago', status: 'failed' as const },
  { action: '2FA Disabled', details: 'Two-factor authentication disabled', time: '1 day ago', status: 'warning' as const },
  { action: 'Session Revoked', details: 'Session sess_04 terminated', time: '1 day ago', status: 'success' as const },
  { action: 'Withdrawal Approved', details: 'BTC 0.25 withdrawal processed', time: '2 days ago', status: 'success' as const },
  { action: 'Login Attempt', details: 'Suspicious login blocked — VPN detected', time: '2 days ago', status: 'failed' as const },
  { action: 'API Key Rotated', details: 'API key "ZC-STAGE-02" rotated', time: '3 days ago', status: 'success' as const },
  { action: 'Account Locked', details: 'Auto-locked after 5 failed attempts', time: '4 days ago', status: 'warning' as const },
];

/* ── Component ── */

export default function Security2FA() {
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifySuccess, setVerifySuccess] = useState(false);

  const handleVerify = () => {
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      setVerifySuccess(true);
      setTwoFAEnabled(true);
      setTimeout(() => {
        setDialogOpen(false);
        setVerifySuccess(false);
        setOtpValue('');
      }, 1500);
    }, 2000);
  };

  const handleRevoke = (id: string) => {
    console.log('Revoking session:', id);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-400" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-amber-400" />;
      default:
        return null;
    }
  };

  const isMobile = (device: string) =>
    device.includes('iPhone') || device.includes('iPad');

  return (
    <div className="animate-fade-in-up space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold gradient-text-3">Security</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account security, sessions, and audit trail
        </p>
      </div>

      {/* Security Score + 2FA Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Security Score Gauge */}
        <div className="glass-card p-8 flex flex-col items-center justify-center">
          <div className="relative">
            <svg width="200" height="200" viewBox="0 0 200 200">
              <defs>
                <linearGradient
                  id="scoreGradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#facc15" />
                </linearGradient>
              </defs>
              {/* Background circle */}
              <circle
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="12"
              />
              {/* Score arc */}
              <circle
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                stroke="url(#scoreGradient)"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={STROKE_OFFSET}
                transform="rotate(-90 100 100)"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-5xl font-bold text-foreground">{SCORE}</span>
              <span className="text-sm text-muted-foreground mt-1">
                out of 100
              </span>
            </div>
          </div>
          <div className="mt-4 text-center">
            <h3 className="text-lg font-semibold text-foreground">
              Security Score
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Good — Enable 2FA to improve your score
            </p>
          </div>
        </div>

        {/* 2FA Setup */}
        <div className="glass-card p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <KeyRound className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Two-Factor Authentication
                </h3>
                <p className="text-sm text-muted-foreground">
                  Add an extra layer of security
                </p>
              </div>
            </div>
            <Badge
              variant={twoFAEnabled ? 'default' : 'secondary'}
              className={
                twoFAEnabled
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/15 text-red-400 border-red-500/30'
              }
            >
              {twoFAEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>

          <Separator className="my-4 bg-white/[0.06]" />

          <div className="space-y-4">
            {/* Authenticator App */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.03]">
              <ShieldCheck className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Authenticator App
                </p>
                <p className="text-xs text-muted-foreground">
                  Use Google Authenticator or Authy
                </p>
              </div>
            </div>

            {/* SMS Backup */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.03]">
              <Smartphone className="h-5 w-5 text-cyan-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  SMS Backup
                </p>
                <p className="text-xs text-muted-foreground">
                  Receive codes via SMS as fallback
                </p>
              </div>
            </div>

            {/* Hardware Key */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.03]">
              <Fingerprint className="h-5 w-5 text-teal-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Hardware Key
                </p>
                <p className="text-xs text-muted-foreground">
                  Use YubiKey or similar (Pro plan)
                </p>
              </div>
            </div>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full mt-6 gradient-bg-1 text-foreground font-semibold hover:opacity-90 transition-opacity">
                {twoFAEnabled ? 'Manage 2FA' : 'Set Up 2FA'}
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-card border-white/10 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-foreground">
                  Set Up Two-Factor Authentication
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Scan the QR code with your authenticator app and enter the
                  6-digit code
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6 py-4">
                {/* Mock QR Code */}
                <div className="flex justify-center">
                  <div className="relative w-48 h-48 bg-white rounded-lg p-3">
                    <div className="w-full h-full grid grid-cols-8 grid-rows-8 gap-0.5">
                      {Array.from({ length: 64 }).map((_, i) => (
                        <div
                          key={i}
                          className={`rounded-[1px] ${
                            Math.random() > 0.45 ? 'bg-gray-900' : 'bg-white'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-8 h-8 bg-white rounded flex items-center justify-center shadow">
                        <Shield className="h-5 w-5 text-amber-500" />
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Scan with Google Authenticator or Authy
                </p>

                {verifySuccess ? (
                  <div className="flex items-center justify-center gap-2 text-emerald-400">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">Verification Successful!</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-center">
                      <InputOTP
                        maxLength={6}
                        value={otpValue}
                        onChange={setOtpValue}
                      >
                        <InputOTPGroup>
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                        </InputOTPGroup>
                        <InputOTPSeparator />
                        <InputOTPGroup>
                          <InputOTPSlot index={3} />
                          <InputOTPSlot index={4} />
                          <InputOTPSlot index={5} />
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    <Button
                      onClick={handleVerify}
                      disabled={otpValue.length < 6 || verifying}
                      className="w-full gradient-bg-1 text-foreground font-semibold hover:opacity-90 transition-opacity"
                    >
                      {verifying ? 'Verifying...' : 'Verify Code'}
                    </Button>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Login Activity */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <Globe className="h-5 w-5 text-cyan-400" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">
            Recent Login Activity
          </h2>
        </div>
        <div className="space-y-3 stagger-children">
          {loginActivity.map((login, i) => (
            <div
              key={i}
              className="flex items-center gap-4 p-4 rounded-lg bg-white/[0.03] hover:bg-white/[0.05] transition-colors"
            >
              <div className="p-2 rounded-lg bg-white/[0.05] shrink-0">
                {isMobile(login.device) ? (
                  <Smartphone className="h-5 w-5 text-foreground" />
                ) : (
                  <Monitor className="h-5 w-5 text-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {login.device}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {login.browser}
                  </span>
                  {login.current && (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5">
                      Current
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {login.location}
                  </span>
                  <span>{login.ip}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <Clock className="h-3 w-3" />
                {login.time}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Sessions */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Eye className="h-5 w-5 text-amber-400" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">
            Active Sessions
          </h2>
        </div>
        <div className="space-y-3 stagger-children">
          {activeSessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-4 p-4 rounded-lg bg-white/[0.03] hover:bg-white/[0.05] transition-colors"
            >
              <div className="p-2 rounded-lg bg-white/[0.05] shrink-0">
                {isMobile(session.device) ? (
                  <Smartphone className="h-5 w-5 text-foreground" />
                ) : (
                  <Monitor className="h-5 w-5 text-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {session.device}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {session.browser}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {session.location}
                  </span>
                  <span>{session.ip}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {session.lastActive}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRevoke(session.id)}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
              >
                <LogOut className="h-4 w-4 mr-1" />
                Revoke
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Audit Log */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Shield className="h-5 w-5 text-amber-400" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Audit Log</h2>
        </div>
        <div className="rounded-lg overflow-hidden border border-white/[0.06]">
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.06] hover:bg-transparent">
                <TableHead className="text-muted-foreground font-semibold">
                  Action
                </TableHead>
                <TableHead className="text-muted-foreground font-semibold">
                  Details
                </TableHead>
                <TableHead className="text-muted-foreground font-semibold">
                  Time
                </TableHead>
                <TableHead className="text-muted-foreground font-semibold text-right">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLog.map((entry, i) => (
                <TableRow
                  key={i}
                  className="border-white/[0.04] hover:bg-white/[0.03]"
                >
                  <TableCell className="text-sm font-medium text-foreground">
                    {entry.action}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {entry.details}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {entry.time}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {statusIcon(entry.status)}
                      <span
                        className={`text-xs font-medium capitalize ${
                          entry.status === 'success'
                            ? 'text-emerald-400'
                            : entry.status === 'failed'
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}