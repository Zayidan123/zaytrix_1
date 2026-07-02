// ZAYTRIX user API key storage (SEC-BACKEND).
//
// Implements AES-256-GCM authenticated encryption of exchange API keys at
// rest. The master key is ENCRYPTION_KEY (env), run through scryptSync to
// derive a 32-byte AES key.
//
// Endpoints (all requireAuth):
//   POST   /api/user/api-keys          { exchange, apiKey, apiSecret, passphrase?, label? }
//   GET    /api/user/api-keys          → list (keys masked: "••••abcd")
//   DELETE /api/user/api-keys/:id
//   POST   /api/user/api-keys/:id/test → decrypt + real exchange auth probe
//
// Ciphertext format (all base64, colon-separated):
//   "v1:" + base64(iv) + ":" + base64(ciphertext) + ":" + base64(authTag)
// Each encrypt() call generates a fresh random 12-byte IV.

import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "./db";
import { logAudit } from "./audit";
import { requireAuth } from "./auth";

// ---------------------------------------------------------------------------
// AES-256-GCM key derivation (cached after first call)
// ---------------------------------------------------------------------------
let cachedKey: Buffer | null = null;

function getAesKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("[apiKeys] ENCRYPTION_KEY is not set. Refusing to encrypt/decrypt.");
  }
  // Derive a 32-byte AES-256 key from the master secret. Salt is fixed
  // (ZAYTRIX/v1) so the same ENCRYPTION_KEY always yields the same AES key
  // — this is required so ciphertexts stay decryptable across restarts.
  cachedKey = crypto.scryptSync(raw, "ZAYTRIX/v1", 32);
  // Zero out any accidental buffer copies — best effort, scryptSync returns a
  // fresh Buffer we own.
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  if (typeof plaintext !== "string") throw new Error("encrypt() requires a string");
  const key = getAesKey();
  const iv = crypto.randomBytes(12); // 96-bit IV is standard for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + iv.toString("base64") + ":" + ct.toString("base64") + ":" + tag.toString("base64");
}

export function decrypt(combined: string): string {
  if (typeof combined !== "string" || !combined.startsWith("v1:")) {
    throw new Error("decrypt(): unsupported ciphertext format");
  }
  const parts = combined.split(":");
  if (parts.length !== 4) throw new Error("decrypt(): malformed ciphertext");
  const iv = Buffer.from(parts[1], "base64");
  const ct = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const key = getAesKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// ---------------------------------------------------------------------------
// Masking for the GET endpoint — show only last 4 chars.
// ---------------------------------------------------------------------------
function maskKey(s: string): string {
  if (!s) return "";
  if (s.length <= 4) return "••••";
  return "••••" + s.slice(-4);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const ALLOWED_EXCHANGES = new Set(["Binance", "KuCoin", "Bybit", "BingX", "MEXC", "OKX", "Gate", "Gemini"]);

function validateExchange(x: any): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim();
  if (!ALLOWED_EXCHANGES.has(t)) return null;
  return t;
}

// ---------------------------------------------------------------------------
// Real exchange auth probe — reuses the same HMAC-signature pattern as
// server.ts /api/trade/connect. Returns { ok, balance?, source?, error? }.
// ---------------------------------------------------------------------------
async function probeExchangeAuth(
  exchange: string,
  apiKey: string,
  apiSecret: string,
  passphrase?: string
): Promise<{ ok: boolean; balance?: number | null; source?: string; error?: string }> {
  const timestamp = Date.now().toString();
  try {
    if (exchange === "Binance") {
      const payload = `recvWindow=5000&timestamp=${timestamp}`;
      const sig = crypto.createHmac("sha256", apiSecret).update(payload).digest("hex");
      const url = `https://api.binance.com/api/v3/account?${payload}&signature=${sig}`;
      const r = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
      const data = (await r.json()) as any;
      if (r.status === 401 || data?.code === -2015 || (data?.msg || "").includes("Invalid")) {
        return { ok: false, error: `Binance: ${data?.msg || "Unauthorized"}` };
      }
      let bal: number | null = null;
      if (Array.isArray(data?.balances)) {
        const usdt = data.balances.find((b: any) => (b?.asset || "").toUpperCase() === "USDT");
        if (usdt) {
          const total = (parseFloat(usdt.free) || 0) + (parseFloat(usdt.locked) || 0);
          if (isFinite(total) && total > 0) bal = total;
        }
      }
      return { ok: true, balance: bal, source: bal !== null ? "live" : "estimated" };
    }
    if (exchange === "Bybit") {
      const sig = crypto
        .createHmac("sha256", apiSecret)
        .update(timestamp + apiKey + "5000" + "accountType=UNIFIED")
        .digest("hex");
      const r = await fetch("https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED", {
        headers: {
          "X-BAPI-API-KEY": apiKey,
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-RECV-WINDOW": "5000",
          "X-BAPI-SIGN": sig,
        },
      });
      const data = (await r.json()) as any;
      if (r.status === 401 || data?.retCode !== 0) {
        return { ok: false, error: `Bybit: ${data?.retMsg || "Unauthorized"}` };
      }
      const eq = parseFloat(data?.result?.list?.[0]?.totalEquity);
      return { ok: true, balance: isFinite(eq) ? eq : null, source: "live" };
    }
    if (exchange === "KuCoin") {
      const endpoint = "/api/v1/accounts";
      const strToSign = timestamp + "GET" + endpoint;
      const sig = crypto.createHmac("sha256", apiSecret).update(strToSign).digest("base64");
      const pass = crypto
        .createHmac("sha256", apiSecret)
        .update(passphrase || "")
        .digest("base64");
      const r = await fetch(`https://api.kucoin.com${endpoint}`, {
        headers: {
          "KC-API-KEY": apiKey,
          "KC-API-SIGN": sig,
          "KC-API-TIMESTAMP": timestamp,
          "KC-API-PASSPHRASE": pass,
          "KC-API-KEY-VERSION": "2",
        },
      });
      const data = (await r.json()) as any;
      if (r.status === 401 || data?.code !== "200000") {
        return { ok: false, error: `KuCoin: ${data?.msg || "Unauthorized"}` };
      }
      const total = parseFloat(data?.data?.total);
      return { ok: true, balance: isFinite(total) ? total : null, source: "live" };
    }
    // For exchanges we don't have HMAC logic for, we can't verify auth — return
    // a clear "unsupported" message so the UI can tell the user.
    return { ok: false, error: `Probe untuk ${exchange} belum didukung. Kunci tetap tersimpan terenkripsi.` };
  } catch (e: any) {
    return { ok: false, error: `Network/auth error: ${e?.message || String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const apiKeysRouter = Router();
apiKeysRouter.use(requireAuth); // ALL endpoints below require an authed user.

// POST /api/user/api-keys — encrypt + upsert
apiKeysRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub;
    const exchange = validateExchange(req.body?.exchange);
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    const apiSecret = typeof req.body?.apiSecret === "string" ? req.body.apiSecret.trim() : "";
    const passphrase =
      typeof req.body?.passphrase === "string" && req.body.passphrase.trim().length > 0
        ? req.body.passphrase.trim()
        : null;
    const labelRaw = typeof req.body?.label === "string" ? req.body.label.trim() : "default";
    const label = labelRaw || "default";

    if (!exchange) return res.status(400).json({ success: false, error: "Exchange tidak didukung." });
    if (apiKey.length < 8) return res.status(400).json({ success: false, error: "API Key terlalu pendek (min 8 karakter)." });
    if (apiSecret.length < 8) return res.status(400).json({ success: false, error: "API Secret terlalu pendek (min 8 karakter)." });
    if (exchange === "KuCoin" && !passphrase) {
      return res.status(400).json({ success: false, error: "Passphrase wajib untuk KuCoin." });
    }

    const encKey = encrypt(apiKey);
    const encSecret = encrypt(apiSecret);
    const encPass = passphrase ? encrypt(passphrase) : null;

    // Upsert by (userId, exchange, label) — replaces existing key with the same label.
    const record = await prisma.apiKey.upsert({
      where: { userId_exchange_label: { userId, exchange, label } },
      create: {
        userId,
        exchange,
        label,
        encryptedKey: encKey,
        encryptedSecret: encSecret,
        encryptedPassphrase: encPass,
      },
      update: {
        encryptedKey: encKey,
        encryptedSecret: encSecret,
        encryptedPassphrase: encPass,
      },
    });

    await logAudit(userId, "API_KEY_SAVE", req, true, { exchange, label, keyId: record.id });

    return res.json({
      success: true,
      key: {
        id: record.id,
        exchange: record.exchange,
        label: record.label,
        keyMasked: maskKey(apiKey),
        createdAt: record.createdAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/user/api-keys — list with masked keys
apiKeysRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub;
    const rows = await prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    // We don't keep the plaintext around — so we can only show the last 4
    // chars of the *decrypted* key. This is safe to expose to the authed user.
    const out = rows.map((r) => {
      let last4 = "";
      try {
        const pt = decrypt(r.encryptedKey);
        last4 = maskKey(pt);
      } catch {
        last4 = "••••";
      }
      return {
        id: r.id,
        exchange: r.exchange,
        label: r.label,
        keyMasked: last4,
        hasPassphrase: !!r.encryptedPassphrase,
        createdAt: r.createdAt.toISOString(),
      };
    });
    return res.json({ success: true, keys: out });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/user/api-keys/:id
apiKeysRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub;
    const id = req.params.id;
    if (!id) return res.status(400).json({ success: false, error: "ID wajib diisi." });

    // Ensure the key belongs to the authed user before deleting.
    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ success: false, error: "Kunci API tidak ditemukan." });
    }

    await prisma.apiKey.delete({ where: { id } });
    await logAudit(userId, "API_KEY_DELETE", req, true, { exchange: existing.exchange, label: existing.label, keyId: id });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/user/api-keys/:id/test — decrypt + probe real exchange auth
apiKeysRouter.post("/:id/test", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub;
    const id = req.params.id;
    if (!id) return res.status(400).json({ success: false, error: "ID wajib diisi." });

    const existing = await prisma.apiKey.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ success: false, error: "Kunci API tidak ditemukan." });
    }

    let apiKey: string, apiSecret: string, passphrase: string | undefined;
    try {
      apiKey = decrypt(existing.encryptedKey);
      apiSecret = decrypt(existing.encryptedSecret);
      passphrase = existing.encryptedPassphrase ? decrypt(existing.encryptedPassphrase) : undefined;
    } catch (e: any) {
      await logAudit(userId, "API_KEY_TEST", req, false, { keyId: id, reason: "decrypt_failed" });
      return res.status(500).json({ success: false, error: "Gagal mendekripsi kredensial (master key tidak cocok?)." });
    }

    const probe = await probeExchangeAuth(existing.exchange, apiKey, apiSecret, passphrase);
    await logAudit(userId, "API_KEY_TEST", req, probe.ok, {
      keyId: id,
      exchange: existing.exchange,
      balance: probe.balance ?? null,
      source: probe.source ?? null,
      error: probe.error ?? null,
    });

    if (!probe.ok) {
      return res.json({ success: false, error: probe.error || "Otentikasi bursa gagal." });
    }
    return res.json({
      success: true,
      exchange: existing.exchange,
      balance: probe.balance ?? null,
      balanceSource: probe.source ?? "estimated",
      testedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
