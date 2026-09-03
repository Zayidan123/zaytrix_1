// =============================================================================
// ssrfGuard.ts — QA9-R3: SSRF defenses (outbound webhook host allowlist +
// scrape domain allowlist / private-IP blocker) and the allowlisted website
// scraper. Extracted verbatim from server.ts (was 763-800, 2523-2611).
// =============================================================================
import { fetchWithTimeout } from "./httpUtils";
import { createLogger } from "./logger";

const log = createLogger("ssrfGuard");

// Secure server-side proxy route for multi-channel webhook alerts (Telegram, Discord, WhatsApp)
// FIX-A-2: route was previously public — anyone could submit Telegram bot
// token + chat ID + message and the server would relay it to Telegram/Discord/
// WhatsApp, turning ZAYTRIX into an open spam relay (and potentially leaking
// the submitted bot token via logs). Now gated by `requireAuth`.
// SEC-2 (server-side): outbound webhook URL allowlist. Client-supplied
// Discord/WhatsApp/Slack/Telegram webhook URLs are fetched server-side; without
// validation this is a full SSRF primitive (an attacker could point the server
// at internal endpoints, cloud metadata services, etc.). Only HTTPS URLs on
// known SaaS webhook hosts are allowed — everything else is rejected with 400.
const OUTBOUND_WEBHOOK_HOST_ALLOWLIST = [
  "discord.com",
  "discordapp.com",
  "api.telegram.org",
  "hooks.slack.com",
  "graph.facebook.com" // WhatsApp Cloud API host
];

export function validateOutboundWebhookUrl(rawUrl: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL webhook tidak valid." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "URL webhook harus menggunakan HTTPS." };
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = OUTBOUND_WEBHOOK_HOST_ALLOWLIST.some(
    allowedHost => host === allowedHost || host.endsWith("." + allowedHost)
  );
  if (!allowed) {
    return { ok: false, reason: "URL webhook tidak diizinkan." };
  }
  return { ok: true };
}


// Gemini-based MULTI-PDF deep financial comparison endpoint
// FIX-ALL P0-6: scrapeWebsiteContent previously fetched ANY client-supplied
// URL server-side, enabling SSRF (http://169.254.169.254/ cloud metadata,
// http://localhost:3000/api/health/detailed, internal routers, etc.). Now we:
//   1. Reject non-http(s) schemes.
//   2. Resolve the hostname and block private/loopback/link-local IPs.
//   3. Optional allowlist of public crypto-finance domains. If the hostname
//      isn't on the allowlist, we decline to fetch and let Gemini reason
//      from its own knowledge instead (safer than blindly scraping).
const SCRAPE_DOMAIN_ALLOWLIST = new Set<string>([
  "coinmarketcap.com", "coingecko.com", "defillama.com",
  "messari.io", "tokenTerminal.com", "tokenterminal.com",
  "ethereum.org", "bitcoin.org", "solana.com", "binance.org",
  "whitepaper.io", "docs.solana.com", "cardano.org",
  "polkadot.network", "avalabs.org", "aptoslabs.com",
]);
const SCRAPE_DOMAIN_BLOCKLIST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1|fc00:|fe80:|fd)/i;

function isSsrfSafeUrl(rawUrl: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL tidak valid." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Hanya http/https diizinkan." };
  }
  const host = parsed.hostname.toLowerCase();
  if (SCRAPE_DOMAIN_BLOCKLIST.test(host)) {
    return { ok: false, reason: "Host internal/private diblokir (SSRF)." };
  }
  // Domain allowlist check (allow subdomains too).
  const base = host.split(".").slice(-2).join(".");
  if (!SCRAPE_DOMAIN_ALLOWLIST.has(base) && !SCRAPE_DOMAIN_ALLOWLIST.has(host)) {
    return { ok: false, reason: `Domain "${host}" tidak ada di allowlist scraping.` };
  }
  return { ok: true };
}

export async function scrapeWebsiteContent(url: string): Promise<string> {
  // FIX-ALL P0-6: validate URL before fetching.
  const guard = isSsrfSafeUrl(url);
  if (!guard.ok) {
    log.warn(`[scrapeWebsiteContent] Blocked URL: ${url} — ${guard.reason}`);
    return `[Sistem keamanan mencegah pengambilan konten dari URL ini. Alasan: ${guard.reason}. Mohon analis mengkaji secara komprehensif berdasarkan basis data keahlian ZAYTRIX terkait domain tersebut.]`;
  }
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    }, 5000);

    if (!res.ok) {
      return `[Gagal mengambil konten web. Status HTTP: ${res.status}]`;
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("application/pdf")) {
      return `[Tautan ini mengarah langsung ke dokumen PDF eksternal di: ${url}. Mohon analisis proyek berdasarkan pengetahuan komparatif sistem Anda terkait URL ini.]`;
    }

    const html = await res.text();
    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length > 20000) {
      cleaned = cleaned.substring(0, 20000) + "... [Konten dipotong untuk optimasi token]";
    }

    return cleaned || "[Konten tekstual kosong]";
  } catch (error: any) {
    log.error("Gagal melakukan scrap untuk URL:", url, error.message);
    return `[Sistem pembatasan eksternal / keamanan mencegah pengunduhan naskah secara dinamis untuk domain ini. Mohon analis mengkaji secara komprehensif berdasarkan basis data keahlian ZAYTRIX terkait situs resmi ${url}.]`;
  }
}

