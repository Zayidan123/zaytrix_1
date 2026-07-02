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
  /(\$\{.*\})/, // template literal injection
  // SSRF
  /(file|gopher|dict|ftp|ldap):\/\//i,
];

// Known bad User-Agents (scrapers, bots, attack tools)
const BAD_USER_AGENTS = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /acunetix/i, /nessus/i, /openvas/i,
  /burp/i, /zap/i, /hydra/i, /metasploit/i, /havij/i, /wpscan/i,
  /bot/i, /crawler/i, /spider/i, /scrape/i, /index/i,
];

// Suspicious request characteristics
function isSuspiciousRequest(req: Request): { blocked: boolean; reason: string } {
  const url = req.originalUrl || req.url || "";
  const ua = req.headers["user-agent"] || "";
  const body = JSON.stringify(req.body || {});

  // Check URL for malicious patterns
  for (const pattern of MALICIOUS_PATTERNS) {
    if (pattern.test(url)) {
      return { blocked: true, reason: `Malicious URL pattern: ${pattern.source.substring(0, 40)}` };
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
      if (/googlebot|bingbot|slurp|duckduckbot|baiduspark/i.test(ua) && !/sqlmap|nikto|nikto|acunetix/i.test(ua)) {
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

// WAF middleware — runs BEFORE route handlers
export function wafMiddleware(req: Request, res: Response, next: NextFunction) {
  const check = isSuspiciousRequest(req);
  if (check.blocked) {
    // Log the blocked request (could send to Sentry)
    console.warn(`[WAF] Blocked request: ${req.method} ${req.originalUrl} — ${check.reason} — IP: ${req.ip}`);
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
    console.warn(`[WAF] High-risk action blocked (bot score ${score}): ${req.method} ${req.originalUrl} — IP: ${req.ip}`);
    return res.status(403).json({
      success: false,
      error: "Aksi sensitif diblokir (terdeteksi automasi). Gunakan browser biasa.",
    });
  }
  next();
}
