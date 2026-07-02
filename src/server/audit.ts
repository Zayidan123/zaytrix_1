// ZAYTRIX audit logging (SEC-BACKEND).
//
// logAudit() persists a single AuditLog row capturing who/what/when for every
// security-sensitive action (LOGIN, LOGOUT, REGISTER, API_KEY_SAVE, TRADE_EXECUTE, etc.).
// Failures are swallowed + logged to stderr so a broken audit log can NEVER
// block the actual user-facing operation (e.g. a failed audit write must not
// prevent login from returning success).

import type { Request } from "express";
import { prisma } from "./db";

export async function logAudit(
  userId: string | null,
  action: string,
  req: Request | any,
  success = true,
  metadata?: any
): Promise<void> {
  try {
    const ip =
      req?.ip ||
      (req?.headers?.["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req?.socket?.remoteAddress ||
      null;

    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action,
        success,
        ip: ip ? String(ip) : null,
        userAgent: req?.headers?.["user-agent"] ? String(req.headers["user-agent"]) : null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (e: any) {
    // Never throw from audit — the calling endpoint must still respond.
    console.error("[audit] failed to log:", e?.message || e);
  }
}
