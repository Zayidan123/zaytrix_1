// ZAYTRIX server-side TOTP (RFC 6238) helpers (SEC2-AUTH).
//
// Reuses the AES-256-GCM encrypt/decrypt pattern from src/server/apiKeys.ts
// (same ENCRYPTION_KEY master env, same scryptSync("ZAYTRIX/v1", 32) derivation,
// same "v1:iv:ct:tag" base64 ciphertext format) so the master key rotation
// story stays consistent across API keys and TOTP secrets.
//
// Exports:
//   - generateTotpSecret()          → 20 random bytes, base32-encoded string
//   - encryptTotpSecret(plaintext)  → AES-256-GCM ciphertext string
//   - decryptTotpSecret(ciphertext) → plaintext base32 string
//   - verifyTotp(token, secretB32)  → boolean, ±1 30s window
//   - generateBackupCodes()         → { plaintext: string[], hashed: string[] }
//   - hashBackupCode(code)          → sha256 hex digest (for storage / compare)
//   - buildOtpauthUri(issuer, account, secretB32) → otpauth:// URI for QR apps

import crypto from "crypto";

// ---------------------------------------------------------------------------
// AES-256-GCM key derivation (cached after first call — same as apiKeys.ts)
// ---------------------------------------------------------------------------
let cachedKey: Buffer | null = null;

function getAesKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("[totp] ENCRYPTION_KEY is not set. Refusing to encrypt/decrypt.");
  }
  cachedKey = crypto.scryptSync(raw, "ZAYTRIX/v1", 32);
  return cachedKey;
}

// ---------------------------------------------------------------------------
// Base32 (RFC 4648) — required because TOTP secrets are exchanged as base32
// with authenticator apps (Google Authenticator, Authy, 1Password, etc.).
// ---------------------------------------------------------------------------
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let output = "";
  let bits = 0;
  let value = 0;
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

export function base32Decode(b32: string): Buffer {
  const cleaned = (b32 || "").replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// generateTotpSecret — 20 truly-random bytes via crypto.randomBytes, base32.
// 20 bytes = 160 bits = the recommended TOTP secret length per RFC 6238 §5.1.
// ---------------------------------------------------------------------------
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

// ---------------------------------------------------------------------------
// encryptTotpSecret / decryptTotpSecret — AES-256-GCM, same envelope as
// apiKeys.ts ("v1:" + b64(iv) + ":" + b64(ct) + ":" + b64(tag)).
// ---------------------------------------------------------------------------
export function encryptTotpSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptTotpSecret(): plaintext must be a non-empty string");
  }
  const key = getAesKey();
  const iv = crypto.randomBytes(12); // 96-bit IV standard for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + iv.toString("base64") + ":" + ct.toString("base64") + ":" + tag.toString("base64");
}

export function decryptTotpSecret(ciphertext: string): string {
  if (typeof ciphertext !== "string" || !ciphertext.startsWith("v1:")) {
    throw new Error("decryptTotpSecret(): unsupported ciphertext format");
  }
  const parts = ciphertext.split(":");
  if (parts.length !== 4) throw new Error("decryptTotpSecret(): malformed ciphertext");
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
// RFC 6238 TOTP computation — HMAC-SHA1, 30s step, 6 digits. ±1 window
// tolerance for clock skew (matches Google Authenticator's default behavior).
// ---------------------------------------------------------------------------
function computeTotp(secretB32: string, unixTimeSec: number, stepSec = 30, digits = 6): string {
  const keyBytes = base32Decode(secretB32);
  const counter = Math.floor(unixTimeSec / stepSec);
  // 8-byte big-endian counter buffer
  const counterBuf = Buffer.alloc(8);
  // High 32 bits (counter / 2^32) — counter is a 64-bit value, JS bitwise ops
  // are 32-bit so we use Buffer.writeUInt32BE in two halves.
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", keyBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const token = truncated % Math.pow(10, digits);
  return token.toString().padStart(digits, "0");
}

export function verifyTotp(token: string, secretB32: string): boolean {
  if (typeof token !== "string" || !/^\d{6}$/.test(token)) return false;
  if (typeof secretB32 !== "string" || secretB32.length < 16) return false;
  const now = Math.floor(Date.now() / 1000);
  // Check current window + ±1 adjacent windows (30s skew tolerance).
  for (const delta of [0, -30, 30]) {
    const candidate = computeTotp(secretB32, now + delta);
    // Use timingSafeEqual to avoid timing side-channels on the comparison.
    if (
      candidate.length === token.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(token))
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// buildOtpauthUri — otpauth://totp/Issuer:account?secret=…&issuer=…
// This is what QR-code generators expect; users without a camera can also
// paste the secret manually.
// ---------------------------------------------------------------------------
export function buildOtpauthUri(issuer: string, account: string, secretB32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Backup codes — 8 one-time-use codes per user, hashed at rest with sha256.
// Each code is 10 hex chars (5 bytes of entropy) — enough entropy to resist
// guessing while remaining human-typeable. Format: XXXX-XXXX-XX (dashes added
// only for display; stored/hashed without dashes).
// ---------------------------------------------------------------------------
export function generateBackupCodes(): { plaintext: string[]; hashed: string[] } {
  const plaintext: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(5).toString("hex"); // 10 hex chars
    plaintext.push(raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8));
    hashed.push(hashBackupCode(raw));
  }
  return { plaintext, hashed };
}

export function hashBackupCode(code: string): string {
  // Strip dashes + lowercase before hashing so user input "ABCD-1234-56" and
  // "abcd123456" both hash to the same digest.
  const normalized = (code || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
