// ZAYTRIX password breach check (AUTH10).
// Uses HaveIBeenPwned k-anonymity API — privacy-preserving, no full hash sent.
// Only the first 5 chars of SHA-1 are sent; we check the suffix locally.

import crypto from "crypto";

export interface BreachCheckResult {
  /** true if the password was found in a breach corpus (count > 0). */
  breached: boolean;
  /** Number of times the password appears in the HIBP corpus (0 if not found). */
  count: number;
  /**
   * true if the HIBP API was actually reached + returned a usable response.
   * false if the check was skipped due to network error, non-200 response, or
   * any other failure. Callers MUST inspect this before persisting breachCount
   * or trusting the result — a `count:0` with `checked:false` means "we don't
   * know", not "the password is safe".
   */
  checked: boolean;
}

export async function checkPasswordBreach(password: string): Promise<BreachCheckResult> {
  try {
    const hash = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = hash.substring(0, 5);
    const suffix = hash.substring(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "User-Agent": "ZAYTRIX-Security-Check" },
    });
    if (!res.ok) {
      // HIBP returned a non-200 (rate limit, 5xx, etc.) — we did not actually
      // perform a meaningful check.
      return { breached: false, count: 0, checked: false };
    }

    const text = await res.text();
    const lines = text.split("\n");
    for (const line of lines) {
      const [lineSuffix, count] = line.trim().split(":");
      if (lineSuffix === suffix) {
        return { breached: true, count: parseInt(count) || 0, checked: true };
      }
    }
    // Reached end of HIBP response without matching suffix → password NOT in
    // breach corpus. The check actually succeeded.
    return { breached: false, count: 0, checked: true };
  } catch (e: any) {
    console.log("[breachCheck] failed (offline?):", e?.message || e);
    // Network error / DNS failure / etc. — the API was unreachable so we
    // cannot make any claim about the password's breach status.
    return { breached: false, count: 0, checked: false };
  }
}
