// ZAYTRIX password breach check (AUTH10).
// Uses HaveIBeenPwned k-anonymity API — privacy-preserving, no full hash sent.
// Only the first 5 chars of SHA-1 are sent; we check the suffix locally.

import crypto from "crypto";

export async function checkPasswordBreach(password: string): Promise<{ breached: boolean; count: number }> {
  try {
    const hash = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = hash.substring(0, 5);
    const suffix = hash.substring(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "User-Agent": "ZAYTRIX-Security-Check" },
    });
    if (!res.ok) return { breached: false, count: 0 };

    const text = await res.text();
    const lines = text.split("\n");
    for (const line of lines) {
      const [lineSuffix, count] = line.trim().split(":");
      if (lineSuffix === suffix) {
        return { breached: true, count: parseInt(count) || 0 };
      }
    }
    return { breached: false, count: 0 };
  } catch (e: any) {
    console.log("[breachCheck] failed (offline?):", e.message);
    return { breached: false, count: 0 };
  }
}
