// ZAYTRIX transactional email service (SEC2-AUTH).
//
// Two modes:
//   - EMAIL_DEV_MODE=true  → use jsonTransport, which logs each message as JSON
//                            to stdout WITHOUT actually sending anything. This
//                            is the default for local dev / sandbox so 2FA +
//                            reset flows can be tested end-to-end without an
//                            SMTP server.
//   - EMAIL_DEV_MODE=false → use the real SMTP transport (SMTP_HOST / SMTP_PORT
//                            / SMTP_USER / SMTP_PASS from env). StartTLS is
//                            used for port 587; SSL for port 465.
//
// Exports:
//   - transporter       : nodemailer singleton (re-used across requests)
//   - sendVerificationEmail(toEmail, token)   → 24h expiry link
//   - sendPasswordResetEmail(toEmail, token)  → 1h  expiry link
//
// All emails are HTML + Indonesian copy, with a plaintext fallback. Links point
// to ${APP_URL}/verify-email?token=… and ${APP_URL}/reset-password?token=…
// respectively. APP_URL defaults to http://localhost:3000.

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// ---------------------------------------------------------------------------
// Transporter singleton
// ---------------------------------------------------------------------------
let cachedTransporter: Transporter | null = null;

function getAppUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function getFrom(): string {
  return process.env.EMAIL_FROM || "noreply@zaytrix.com";
}

function isDevMode(): boolean {
  return String(process.env.EMAIL_DEV_MODE || "true").toLowerCase() === "true";
}

export function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;

  if (isDevMode()) {
    // jsonTransport: builds the MIME message in memory and emits it via the
    // 'idle'/'message' event; we wire a listener that prints the rendered JSON
    // to stdout so developers can copy the verification / reset link out of
    // the log without a real mailbox.
    cachedTransporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    console.log("[email] dev mode active — emails will be logged as JSON, NOT sent.");
    return cachedTransporter;
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error("[email] SMTP_HOST / SMTP_USER / SMTP_PASS must be set when EMAIL_DEV_MODE=false.");
  }
  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false (StartTLS) for 587/other
    auth: { user, pass },
  });
  console.log(`[email] SMTP transport configured for ${host}:${port}.`);
  return cachedTransporter;
}

// ---------------------------------------------------------------------------
// HTML wrapper — a minimal professional dark-themed template matching the
// ZAYTRIX dashboard. Inline styles only (email clients strip <style>).
// ---------------------------------------------------------------------------
function emailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#020617;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f5f5f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#020617;min-height:100vh;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0B1329;border:1px solid #1e293b;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:24px 32px;background:linear-gradient(90deg,#1e3a8a,#0f172a);">
          <div style="font-size:18px;font-weight:900;letter-spacing:-0.02em;color:#fbbf24;">ZAYTRIX</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-family:monospace;">Sistem Keamanan Finansial Berlapis</div>
        </td></tr>
        <tr><td style="padding:28px 32px;color:#e2e8f0;font-size:14px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid #1e293b;background:#0a0f1d;">
          <div style="font-size:11px;color:#64748b;font-family:monospace;line-height:1.5;">
            Email ini dikirim otomatis oleh sistem ZAYTRIX. Jangan membalas email ini.<br/>
            Jika Anda tidak merasa meminta email ini, abaikan — tautan akan kedaluwarsa dengan sendirinya.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Dev-mode logger — prints the rendered email body to the console so the
// developer can read / copy the verification or reset link from the log.
// ---------------------------------------------------------------------------
function logDevEmail(to: string, subject: string, html: string): void {
  if (!isDevMode()) return;
  // Pull the first http(s) URL out of the rendered HTML — that's the link the
  // user would normally click. Helps QA flow through the dev log.
  const linkMatch = html.match(/https?:\/\/[^\s"'<>]+/i);
  console.log(
    `\n[email][DEV] ───────────────────────────────────────────\n` +
      `[email][DEV] To:      ${to}\n` +
      `[email][DEV] Subject: ${subject}\n` +
      (linkMatch ? `[email][DEV] Link:    ${linkMatch[0]}\n` : "") +
      `[email][DEV] ───────────────────────────────────────────\n`
  );
}

// ---------------------------------------------------------------------------
// sendVerificationEmail — token has a 24h expiry (set by the caller).
// ---------------------------------------------------------------------------
export async function sendVerificationEmail(toEmail: string, token: string): Promise<void> {
  const link = `${getAppUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const subject = "Verifikasi Alamat Email ZAYTRIX Anda";
  const html = emailShell(
    subject,
    `<p style="margin:0 0 12px;">Halo,</p>
     <p style="margin:0 0 12px;">Terima kasih telah mendaftar di <strong style="color:#fbbf24;">ZAYTRIX</strong>. Untuk mengaktifkan sepenuhnya fitur keamanan akun Anda, mohon verifikasi alamat email dengan menekan tombol di bawah ini:</p>
     <p style="margin:18px 0;text-align:center;">
       <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;font-size:13px;padding:12px 24px;border-radius:8px;text-decoration:none;font-family:monospace;letter-spacing:0.04em;">VERIFIKASI EMAIL SEKARANG</a>
     </p>
     <p style="margin:0 0 12px;font-size:12px;color:#94a3b8;">Atau salin tautan berikut ke peramban Anda:</p>
     <p style="margin:0 0 12px;font-size:11px;font-family:monospace;color:#60a5fa;word-break:break-all;">${link}</p>
     <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;">Tautan ini kedaluwarsa dalam 24 jam. Jika Anda tidak merasa mendaftar, abaikan email ini.</p>`
  );
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: getFrom(),
    to: toEmail,
    subject,
    html,
    text: `Verifikasi email ZAYTRIX Anda. Buka tautan berikut: ${link}`,
  });
  logDevEmail(toEmail, subject, html);
  // info.messageId / info.message — for jsonTransport, the full MIME blob is
  // available on info.message; we already logged the link, so we don't dump it.
  void info;
}

// ---------------------------------------------------------------------------
// sendPasswordResetEmail — token has a 1h expiry (set by the caller).
// ---------------------------------------------------------------------------
export async function sendPasswordResetEmail(toEmail: string, token: string): Promise<void> {
  const link = `${getAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const subject = "Atur Ulang Kata Sandi ZAYTRIX";
  const html = emailShell(
    subject,
    `<p style="margin:0 0 12px;">Halo,</p>
     <p style="margin:0 0 12px;">Kami menerima permintaan untuk mengatur ulang kata sandi akun <strong style="color:#fbbf24;">ZAYTRIX</strong> Anda. Klik tombol di bawah ini untuk menetapkan kata sandi baru:</p>
     <p style="margin:18px 0;text-align:center;">
       <a href="${link}" style="display:inline-block;background:#dc2626;color:#fff;font-weight:700;font-size:13px;padding:12px 24px;border-radius:8px;text-decoration:none;font-family:monospace;letter-spacing:0.04em;">ATUR ULANG KATA SANDI</a>
     </p>
     <p style="margin:0 0 12px;font-size:12px;color:#94a3b8;">Atau salin tautan berikut ke peramban Anda:</p>
     <p style="margin:0 0 12px;font-size:11px;font-family:monospace;color:#f87171;word-break:break-all;">${link}</p>
     <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;">Tautan ini hanya berlaku <strong>1 jam</strong> dan dapat digunakan satu kali. Jika Anda tidak meminta pengaturan ulang kata sandi, abaikan email ini — akun Anda tetap aman.</p>`
  );
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: getFrom(),
    to: toEmail,
    subject,
    html,
    text: `Atur ulang kata sandi ZAYTRIX Anda. Buka tautan berikut: ${link}`,
  });
  logDevEmail(toEmail, subject, html);
  void info;
}
