// =============================================================================
// newsFxRoutes.ts — QA9-R3: /api/fx/usd-idr (10-min cache) + /api/news
// (multi-source RSS with per-source fallback). Extracted verbatim from
// server.ts (was 4458-4684).
// =============================================================================
import type { Express } from "express";
import crypto from "crypto";
import { fetchWithTimeout } from "./httpUtils";
import { createLogger } from "./logger";

const log = createLogger("newsFx");





export function registerNewsFxRoutes(app: Express): void {
// ===========================================================================
// NEW LIVE-DATA ENDPOINTS (IMPL-S)
// ===========================================================================
// All endpoints below are pure additions; they do not alter any existing
// endpoint contract. Caches are module-level variables per the existing
// metricsCache pattern. Inserted before the Vite catch-all.

// --- 1. GET /api/fx/usd-idr ------------------------------------------------
// Live USD -> IDR exchange rate from open.er-api.com (free, no API key).
// Cached for 10 minutes to respect the public rate limit.
let fxUsdIdrCache: { rate: number; lastUpdated: string } | null = null;
let fxUsdIdrCacheTime = 0;
const FX_USD_IDR_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

app.get("/api/fx/usd-idr", async (req, res) => {
  try {
    const now = Date.now();
    if (fxUsdIdrCache && now - fxUsdIdrCacheTime < FX_USD_IDR_CACHE_TTL) {
      return res.json({
        success: true,
        rate: fxUsdIdrCache.rate,
        source: "open.er-api.com",
        lastUpdated: fxUsdIdrCache.lastUpdated
      });
    }

    const response = await fetchWithTimeout(
      "https://open.er-api.com/v6/latest/USD",
      { headers: { "Accept": "application/json" } },
      5000
    );
    if (!response.ok) {
      throw new Error(`open.er-api.com returned HTTP ${response.status}`);
    }
    const data = await response.json() as any;
    const rate = parseFloat(data?.rates?.IDR);
    if (!isFinite(rate) || rate <= 0) {
      throw new Error("IDR rate missing in open.er-api.com response");
    }
    const lastUpdated = (data?.time_last_update_utc as string) || new Date().toISOString();
    fxUsdIdrCache = { rate, lastUpdated };
    fxUsdIdrCacheTime = now;
    return res.json({
      success: true,
      rate,
      source: "open.er-api.com",
      lastUpdated
    });
  } catch (err: any) {
    return res.json({
      success: false,
      error: err.message || String(err),
      rate: null
    });
  }
});

// --- 2. GET /api/news ------------------------------------------------------
// Live crypto news aggregator. Fetches RSS feeds in parallel and parses XML
// with a dependency-free regex extractor. Cached for 5 minutes.
interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  image: string | null;
  source: string;
}

let newsCache: { articles: NewsArticle[]; source: string; lastUpdated: string } | null = null;
let newsCacheTime = 0;
const NEWS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Decode basic HTML entities and strip CDATA wrappers + HTML tags.
function decodeHtmlEntities(input: string): string {
  if (!input) return "";
  let s = input.trim();
  // Strip CDATA wrappers
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Decode common entities
  s = s.replace(/&amp;/gi, "&")
       .replace(/&lt;/gi, "<")
       .replace(/&gt;/gi, ">")
       .replace(/&quot;/gi, "\"")
       .replace(/&#0?39;/gi, "'")
       .replace(/&apos;/gi, "'");
  return s;
}

function stripHtmlTags(input: string): string {
  if (!input) return "";
  return decodeHtmlEntities(input)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract first attribute value from an XML tag string.
function extractAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, "i");
  const m = xml.match(re);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function parseRssItems(xml: string, sourceName: string): NewsArticle[] {
  const articles: NewsArticle[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1] || "";
    const title = extractTag(block, "title") || "";
    const link = extractTag(block, "link") || "";
    const pubDate = extractTag(block, "pubDate") || "";
    const descriptionRaw = extractTag(block, "description") || "";
    const summary = stripHtmlTags(descriptionRaw).slice(0, 300);

    // Image: try <enclosure url="..."> then <media:content url="..."> then <media:thumbnail url="...">
    let image: string | null = extractAttr(block, "enclosure", "url");
    if (!image) image = extractAttr(block, "media:content", "url");
    if (!image) image = extractAttr(block, "media:thumbnail", "url");

    if (!title || !link) continue;
    const id = crypto.createHash("md5").update(`${sourceName}:${link}`).digest("hex").slice(0, 16);
    articles.push({
      id,
      title: stripHtmlTags(title),
      summary,
      url: link,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      image,
      source: sourceName
    });
  }
  return articles;
}

app.get("/api/news", async (req, res) => {
  try {
    const now = Date.now();
    if (newsCache && now - newsCacheTime < NEWS_CACHE_TTL) {
      return res.json({
        success: true,
        articles: newsCache.articles,
        source: newsCache.source,
        lastUpdated: newsCache.lastUpdated
      });
    }

    const feeds = [
      { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", name: "CoinDesk" },
      { url: "https://cointelegraph.com/rss", name: "Cointelegraph" },
      { url: "https://cryptoslate.com/feed/", name: "CryptoSlate" }
    ];

    const results = await Promise.allSettled(
      feeds.map(async (feed) => {
        const r = await fetchWithTimeout(feed.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/rss+xml, application/xml, text/xml, */*"
          }
        }, 6000);
        if (!r.ok) throw new Error(`${feed.name} HTTP ${r.status}`);
        const text = await r.text();
        const items = parseRssItems(text, feed.name);
        if (!items.length) throw new Error(`${feed.name} returned no items`);
        return { feed, items };
      })
    );

    // Take the first feed that worked; if multiple worked, merge them.
    const okResults = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map(r => r.value);

    if (okResults.length === 0) {
      const reasons = results
        .map(r => r.status === "rejected" ? (r.reason?.message || String(r.reason)) : "")
        .filter(Boolean);
      return res.json({
        success: false,
        articles: [],
        error: `All RSS feeds failed: ${reasons.join("; ")}`
      });
    }

    // Merge and dedupe by URL, then take first 30.
    const seen = new Set<string>();
    const merged: NewsArticle[] = [];
    for (const r of okResults) {
      for (const a of r.items) {
        if (seen.has(a.url)) continue;
        seen.add(a.url);
        merged.push(a);
        if (merged.length >= 30) break;
      }
      if (merged.length >= 30) break;
    }

    const payload = {
      success: true,
      articles: merged,
      source: okResults.map(r => r.feed.name).join(", "),
      lastUpdated: new Date().toISOString()
    };
    newsCache = {
      articles: merged,
      source: payload.source,
      lastUpdated: payload.lastUpdated
    };
    newsCacheTime = now;
    return res.json(payload);
  } catch (err: any) {
    return res.json({
      success: false,
      articles: [],
      error: err.message || String(err)
    });
  }
});
} // end registerNewsFxRoutes

