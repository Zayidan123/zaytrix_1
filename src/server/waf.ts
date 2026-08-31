import { createLogger } from "./logger";
const log = createLogger("waf");

// ZAYTRIX WAF (Web Application Firewall) + Bot Detection (NETSEC9).
// Middleware that inspects incoming requests for malicious patterns and
// blocks known bots/scrapers/abuse tools. Adds defense-in-depth on top of
// rate limiting + helmet.

import { Request, Response, NextFunction } from "express";

// Malicious pattern detection (SQL injection, XSS, path traversal, command injection)
const MALICIOUS_PATTERNS: RegExp[] = [
  // SQL injection
  /(\b(union|select|insert|update|delete|drop|alter|create|exec)\b.*\b(from|into|table|database|schema)\b)/i,
  /(\bor\b\s+1\s*=\s*1)/i,
  /(\band\b\s+1\s*=\s*1)/i,
  /('.*or.*'.*=)/i,
  /(information_schema)/i,
  // XSS
  /<script[^>]*>[\s\S]*?<\/script>/gi,
  /javascript:/i,
  /on(error|load|click|mouseover|focus|blur)\s*=/i,
  // Path traversal
  /(\.\.[\/\\]){2,}/,
  /(\/etc\/passwd|\/proc\/self|\/var\/log)/i,
  // Command injection
  /(\||;|`|\$\().*(cat|ls|wget|curl|bash|sh|nc|python|perl|ruby)\b/i,
  // FIX-C-6: removed /\$\{.*\}/ (blocked legit JS template literals in notes /
  // JSON payloads) and the (file|gopher|dict|ftp|ldap):// SSRF pattern (SSRF is
  // now mitigated at the fetch layer — scrapeWebsiteContent has an allowlist).
  // The command-injection pattern above still catches $(cmd) process
  // substitution; ${...} object access in JS payloads is not malicious by itself.
];

// Known bad User-Agents (scrapers, bots, attack tools)
// FIX-C-6: removed /index/i (too broad — matched legit clients whose UA
// contained the word "index", e.g. some mobile browsers + crawler names).
// Added /zgrab/i (ZGrab network scanner). The broad /bot|crawler|spider|scrape/
// patterns remain but are mitigated by the search-engine whitelist below.
const BAD_USER_AGENTS = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /acunetix/i, /nessus/i, /openvas/i,
  /burp/i, /zap/i, /hydra/i, /metasploit/i, /havij/i, /wpscan/i, /zgrab/i,
  /bot/i, /crawler/i, /spider/i, /scrape/i,
];

// Suspicious request characteristics
function isSuspiciousRequest(req: Request): { blocked: boolean; reason: string } {
  // FIX-ALL H3: decode URL-encoded characters before pattern matching so that
  // URL-encoded payloads (e.g. %27 OR 1=1, %3Cscript%3E) cannot bypass the WAF.
  // We decode RECURSIVELY (up to 3 passes) so double-encoded payloads
  // (%2527 → %27 → ') are also caught. Malformed URI sequences fall back to
  // the raw URL — we still inspect it for literal patterns.
  const rawUrl = req.originalUrl || req.url || "";
  const url = safeDecodeRecursive(rawUrl, 3);
  const rawReqUrl = req.url || "";
  const url2 = safeDecodeRecursive(rawReqUrl, 3);
  const ua = req.headers["user-agent"] || "";
  const body = JSON.stringify(req.body || {});

  // Check URL for malicious patterns (both raw + decoded forms).
  const urlCandidates = Array.from(new Set([rawUrl, url, rawReqUrl, url2]));
  for (const pattern of MALICIOUS_PATTERNS) {
    for (const candidate of urlCandidates) {
      if (candidate && pattern.test(candidate)) {
        return { blocked: true, reason: `Malicious URL pattern: ${pattern.source.substring(0, 40)}` };
      }
    }
  }

  // Check body for malicious patterns (only on POST/PUT/PATCH)
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    for (const pattern of MALICIOUS_PATTERNS) {
      if (pattern.test(body)) {
        return { blocked: true, reason: `Malicious body pattern: ${pattern.source.substring(0, 40)}` };
      }
    }
  }

  // Block known attack tools
  for (const pattern of BAD_USER_AGENTS) {
    if (pattern.test(ua)) {
      // Allow Googlebot/Bingbot for SEO (whitelist)
      // FIX-C-6: deduped the "nikto" entry inside this blacklist-within-whitelist
      // check (was /sqlmap|nikto|nikto|acunetix/i — the duplicate had no functional
      // effect but was dead weight).
      if (/googlebot|bingbot|slurp|duckduckbot|baiduspark/i.test(ua) && !/sqlmap|nikto|acunetix/i.test(ua)) {
        // It's a legitimate search engine bot — allow
        continue;
      }
      return { blocked: true, reason: `Blocked bot/scraper UA: ${ua.substring(0, 50)}` };
    }
  }

  // Block empty User-Agent (bots often send no UA)
  if (!ua && req.method !== "GET") {
    return { blocked: true, reason: "Empty User-Agent on mutating request" };
  }

  // Block oversized headers (DoS)
  const headerSize = JSON.stringify(req.headers).length;
  if (headerSize > 16384) {
    return { blocked: true, reason: `Oversized headers: ${headerSize} bytes` };
  }

  // Block requests with excessive URL length
  if (url.length > 2048) {
    return { blocked: true, reason: `URL too long: ${url.length} chars` };
  }

  return { blocked: false, reason: "" };
}

/**
 * URL-decode `s` up to `maxPasses` times so double/triple-encoded payloads
 * (e.g. %2527 → %27 → ') are normalised before regex matching. Any malformed
 * URI sequence (throws URIError from decodeURIComponent) bails out and
 * returns the best-effort decoded value from the previous pass — we still
 * want to inspect the raw + partially-decoded form.
 */
function safeDecodeRecursive(s: string, maxPasses: number): string {
  let current = s;
  for (let i = 0; i < maxPasses; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      // Malformed URI sequence — stop decoding, return what we have.
      return current;
    }
    // If decoding made no progress, no point continuing.
    if (next === current) return next;
    current = next;
  }
  return current;
}

// WAF middleware — runs BEFORE route handlers
export function wafMiddleware(req: Request, res: Response, next: NextFunction) {
  const check = isSuspiciousRequest(req);
  if (check.blocked) {
    // Log the blocked request (could send to Sentry)
    log.warn(`[WAF] Blocked request: ${req.method} ${req.originalUrl} — ${check.reason} — IP: ${req.ip}`);
    return res.status(403).json({
      success: false,
      error: "Permintaan diblokir oleh firewall keamanan.",
    });
  }
  next();
}

// Bot detection score (0-100, higher = more likely bot)
export function getBotScore(req: Request): number {
  let score = 0;
  const ua = req.headers["user-agent"] || "";

  if (!ua) score += 30;
  if (/bot|crawler|spider|scrape/i.test(ua)) score += 40;
  if (!req.headers["accept-language"]) score += 10;
  if (!req.headers["accept"]) score += 10;
  if (req.headers["sec-fetch-mode"] === undefined) score += 10;
  if (/curl|wget|python-requests|go-http-client|java/i.test(ua)) score += 30;

  return Math.min(score, 100);
}

// High-risk action bot check (for trade execution, API key save)
export function strictBotCheck(req: Request, res: Response, next: NextFunction) {
  const score = getBotScore(req);
  if (score >= 60) {
    log.warn(`[WAF] High-risk action blocked (bot score ${score}): ${req.method} ${req.originalUrl} — IP: ${req.ip}`);
    return res.status(403).json({
      success: false,
      error: "Aksi sensitif diblokir (terdeteksi automasi). Gunakan browser biasa.",
    });
  }
  next();
}
