// ZAYTRIX Data Retention + Field Encryption (DATAPROT9).
// - Field-level encryption for PII (displayName, etc.)
// - Data retention policy: auto-purge old audit logs, expired sessions/tokens
// - Runs as a periodic background job

import { prisma } from "./db";
import crypto from "crypto";

// ─── Field Encryption (AES-256-GCM) ─────────────────────────────────
// Derive a 32-byte key from ENCRYPTION_KEY using scryptSync (same pattern as apiKeys.ts)
const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY || "ZAYTRIX_DEV_ENCRYPTION_KEY_32BYTES_CHANGE_ME_2024_k9j2";
const FIELD_KEY = crypto.scryptSync(ENCRYPTION_KEY_RAW, "zaytrix-field-salt", 32);

export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", FIELD_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptField(ciphertext: string): string {
  try {
    if (!ciphertext.startsWith("v1:")) return ciphertext; // plaintext fallback
    const data = Buffer.from(ciphertext.substring(3), "base64");
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", FIELD_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return ciphertext; // fallback
  }
}

// ─── Data Retention Job ──────────────────────────────────────────────
// Runs periodically to purge:
// - AuditLog entries older than 1 year
// - EmailVerificationToken expired entries
// - Session entries expired
// - LedgerTransaction older than 7 years (tax requirement retention)

const RETENTION_POLICY = {
  auditLogs: 365 * 24 * 60 * 60 * 1000, // 1 year
  emailTokens: 24 * 60 * 60 * 1000, // 24 hours
  sessions: 7 * 24 * 60 * 60 * 1000, // 7 days
  ledger: 7 * 365 * 24 * 60 * 60 * 1000, // 7 years (tax)
  backtestResults: 90 * 24 * 60 * 60 * 1000, // 90 days
};

export async function runDataRetentionJob(): Promise<void> {
  try {
    const now = new Date();
    const results: string[] = [];

    // Purge old audit logs
    const auditCutoff = new Date(now.getTime() - RETENTION_POLICY.auditLogs);
    const auditDeleted = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    });
    if (auditDeleted.count > 0) results.push(`${auditDeleted.count} audit logs`);

    // Purge expired email verification tokens
    const tokenDeleted = await prisma.emailVerificationToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (tokenDeleted.count > 0) results.push(`${tokenDeleted.count} expired email tokens`);

    // Purge expired sessions
    const sessionDeleted = await prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (sessionDeleted.count > 0) results.push(`${sessionDeleted.count} expired sessions`);

    // Purge old backtest results (90 days)
    const btCutoff = new Date(now.getTime() - RETENTION_POLICY.backtestResults);
    const btDeleted = await prisma.backtestResult.deleteMany({
      where: { createdAt: { lt: btCutoff } },
    });
    if (btDeleted.count > 0) results.push(`${btDeleted.count} old backtest results`);

    if (results.length > 0) {
      console.log(`[dataRetention] Purged: ${results.join(", ")}`);
    }
  } catch (e: any) {
    console.log("[dataRetention] error:", e.message);
  }
}

// Start the retention job — runs every 24 hours
let retentionTimer: ReturnType<typeof setInterval> | null = null;
export function startDataRetentionJob() {
  if (retentionTimer) return;
  // Run once on startup (after 60s delay to not interfere with boot)
  setTimeout(() => runDataRetentionJob(), 60000);
  // Then every 24 hours
  retentionTimer = setInterval(() => runDataRetentionJob(), 24 * 60 * 60 * 1000);
  console.log("[dataRetention] Job scheduled (runs every 24h, first run in 60s).");
}

// ─── Data Export (GDPR/Privacy right to access) ──────────────────────
export async function exportUserData(userId: string): Promise<any> {
  const [user, apiKeys, auditLogs, portfolio, ledger, backtests, conversions, alerts, webauthn] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.apiKey.findMany({ where: { userId } }),
    prisma.auditLog.findMany({ where: { userId } }),
    prisma.portfolioHolding.findMany({ where: { userId } }),
    prisma.ledgerTransaction.findMany({ where: { userId } }),
    prisma.backtestResult.findMany({ where: { userId } }),
    prisma.conversionTransaction.findMany({ where: { userId } }),
    prisma.alertConfig.findMany({ where: { userId } }),
    prisma.webAuthnCredential.findMany({ where: { userId } }),
  ]);

  return {
    user: user ? { ...user, passwordHash: "[REDACTED]", totpSecret: "[REDACTED]", twoFactorSecret: "[REDACTED]", resetToken: "[REDACTED]" } : null,
    apiKeys: apiKeys.map(k => ({ ...k, encryptedKey: "[REDACTED]", encryptedSecret: "[REDACTED]" })),
    auditLogs,
    portfolio,
    ledger,
    backtests,
    conversions,
    alerts,
    webauthn: webauthn.map(w => ({ ...w, publicKey: "[REDACTED]" })),
    exportedAt: new Date().toISOString(),
  };
}

// ─── Data Deletion (GDPR/Privacy right to be forgotten) ──────────────
export async function deleteAllUserData(userId: string): Promise<void> {
  // Delete all related records (cascading)
  await prisma.user.delete({ where: { id: userId } });
  // All related records (apiKeys, auditLogs, portfolio, ledger, etc.) cascade-delete via schema
}
