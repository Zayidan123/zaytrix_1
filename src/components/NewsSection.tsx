import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  User, 
  Share2, 
  Search, 
  TrendingUp, 
  Tag, 
  ChevronRight, 
  ExternalLink,
  BookOpen,
  Filter,
  Bookmark,
  Brain,
  Send,
  ThumbsUp,
  ThumbsDown,
  Activity,
  HelpCircle
} from "lucide-react";

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content: string[];
  author: string;
  authorTitle: string;
  date: string;
  readTime: string;
  category: string;
  imageUrl: string;
  source: string;
  subTitle?: string;
  tags: string[];
  url?: string;
}

// IMPL-C3: NEWS_DATA hardcoded array (5 future-dated articles, 2026-06-25)
// has been removed. Articles are now fetched live from /api/news (RSS
// aggregator over CoinDesk / Cointelegraph / CryptoSlate). See fetch effect
// inside the component below.

// Derive an editorial category from the article title + source.
const CATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(sec|regul|ruu|undang|congress|senat|law|legal)\b/i, "Regulasi"],
  [/\b(etf|blackrock|fidelity|spot)\b/i, "ETF"],
  [/\b(ethereum|\beth\b|vitalik|upgrade|fork|eip)\b/i, "Ethereum"],
  [/\b(bitcoin|\bbtc\b|satoshi|mining|hashrate|halving)\b/i, "Bitcoin"],
  [/\b(solana|\bsol\b)\b/i, "Solana"],
  [/\b(defi|tvl|liquidity|staking|yield|lending)\b/i, "DeFi"],
  [/\b(nft|gaming|metaverse)\b/i, "NFT"],
  [/\b(hack|exploit|breach|ransom|drain)\b/i, "Keamanan"],
  [/\b(fund|venture|capital|raise|funding|series)\b/i, "Venture Capital"],
  [/\b(stablecoin|usdt|usdc|tether)\b/i, "Stablecoin"],
  [/\b(ai|agent|llm|gpt)\b/i, "AI"],
];

const deriveCategory = (title: string): string => {
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(title)) return cat;
  }
  return "Crypto";
};

const TAG_KEYWORDS = [
  "Bitcoin", "BTC", "Ethereum", "ETH", "Solana", "SOL", "XRP", "Ripple",
  "ETF", "SEC", "DeFi", "NFT", "Stablecoin", "USDT", "USDC", "BNB",
  "Cardano", "ADA", "TRX", "Tron", "Hype", "AVAX", "Sui", "NEAR",
  "BlackRock", "Fidelity", "Coinbase", "Binance", "Hack", "Staking"
];

const deriveTags = (title: string): string[] => {
  const tags = new Set<string>();
  for (const kw of TAG_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(title)) tags.add(kw);
  }
  if (tags.size === 0) {
    const words = title.split(/\s+/).filter(w => w.length > 4 && /^[A-Z]/.test(w));
    return words.slice(0, 3);
  }
  return Array.from(tags).slice(0, 5);
};

const estimateReadTime = (summary: string): string => {
  const wordCount = (summary || "").split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(wordCount / 200));
  return `${minutes} min read`;
};

const formatNewsDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return iso;
  }
};

// Map /api/news article shape → NewsArticle shape used by this component.
// RSS only gives a short description; we use it for both summary and content
// body, and append a "read more at source" note. AI sentiment analysis
// remains live (POST /api/gemini/news-sentiment) when the user opens an
// article — no fake static sentiment is shown on cards.
const mapApiArticle = (api: {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  image: string | null;
  source: string;
}): NewsArticle => {
  const title = api.title || "Tanpa Judul";
  const summary = api.summary || "";
  const source = api.source || "Crypto News";
  return {
    id: api.id,
    title,
    summary,
    content: [
      summary || title,
      `Artikel ini disindikasi langsung dari sumber terverifikasi (${source}). Untuk membaca laporan lengkap, kunjungi tautan sumber asli. ZAYTRIX Newsroom menyajikan ringkasan intelijen pasar dan analisis AI yang dapat diakses melalui panel di bawah.`,
    ],
    author: source,
    authorTitle: `Reporter, ${source}`,
    date: formatNewsDate(api.publishedAt),
    readTime: estimateReadTime(summary),
    category: deriveCategory(title),
    imageUrl: api.image || "",
    source,
    url: api.url,
    tags: deriveTags(title),
  };
};

interface NewsSentimentResult {
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  score: number;
  summary: string;
  marketImpact: string;
  winners: string[];
  losers: string[];
  shortTermOutlook: string;
  longTermOutlook: string;
  isFallback?: boolean;
}

// IMPL-C3: getStaticSentiment removed. The hardcoded switch returned fake
// BULLISH/NEUTRAL scores inconsistent with the live /api/gemini/news-sentiment
// analysis. Cards now show a neutral "AI: —" badge that does not fabricate a
// score; the real AI analysis still runs when the user opens an article.

export default function NewsSection() {
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  // IMPL-C3: Live articles state (replaces hardcoded NEWS_DATA).
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [displayCount, setDisplayCount] = useState<number>(9);

  // AI Sentiment States
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentResult, setSentimentResult] = useState<NewsSentimentResult | null>(null);
  const [sentimentError, setSentimentError] = useState<string | null>(null);

  // AI Chat States
  const [newsQuestion, setNewsQuestion] = useState("");
  const [newsChatHistory, setNewsChatHistory] = useState<{role: 'user' | 'model', content: string}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Fetch /api/news on mount, poll every 5 minutes for fresh articles.
  // reloadKey lets the retry button force a refetch.
  useEffect(() => {
    let cancelled = false;
    const fetchNews = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/news");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.success) throw new Error(data.error || "Gagal memuat berita.");
        const mapped: NewsArticle[] = (data.articles || []).map(mapApiArticle);
        // Sort by date descending (most recent first).
        mapped.sort((a, b) => {
          const ta = new Date(a.date).getTime() || 0;
          const tb = new Date(b.date).getTime() || 0;
          return tb - ta;
        });
        setArticles(mapped);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Gagal memuat berita.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchNews();
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [reloadKey]);

  const handleRetry = () => {
    setArticles([]);
    setDisplayCount(9);
    setReloadKey(k => k + 1);
  };

  useEffect(() => {
    if (!selectedArticleId) {
      setSentimentResult(null);
      setSentimentError(null);
      setNewsChatHistory([]);
      return;
    }
    
    const article = articles.find(art => art.id === selectedArticleId);
    if (!article) return;
    
    setSentimentLoading(true);
    setSentimentResult(null);
    setSentimentError(null);
    
    fetch("/api/gemini/news-sentiment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(article)
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setSentimentResult(data);
      })
      .catch(err => {
        console.error("Failed to load news sentiment", err);
        setSentimentError(err.message || "Gagal memproses sentimen berita.");
      })
      .finally(() => {
        setSentimentLoading(false);
      });
  }, [selectedArticleId]);

  const categories = useMemo(() => {
    const cats = new Set(articles.map(art => art.category));
    return ["All", ...Array.from(cats)];
  }, [articles]);

  const filteredArticles = useMemo(() => {
    return articles.filter(art => {
      const matchesSearch = 
        art.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        art.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        art.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesCategory = activeCategory === "All" || art.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [articles, searchQuery, activeCategory]);

  // IMPL-C3: featuredArticle is now the most recent article from the live
  // feed (articles are pre-sorted by date desc in the fetch effect).
  const featuredArticle = useMemo(() => {
    return articles[0];
  }, [articles]);

  const activeArticle = useMemo(() => {
    if (!selectedArticleId) return null;
    return articles.find(art => art.id === selectedArticleId) || null;
  }, [articles, selectedArticleId]);

  // Handle Scroll to top on reading article
  const handleSelectArticle = (id: string) => {
    setSelectedArticleId(id);
    const contentArea = document.getElementById("app-workspace-area");
    if (contentArea) {
      contentArea.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="space-y-6 pb-12 text-slate-100" id="news-section-viewport">
      <AnimatePresence mode="wait">
        {!selectedArticleId ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            {/* Header / Search Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/60 pb-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest font-mono">
                    Global Terminal Feed
                  </span>
                </div>
                <h2 className="text-2xl font-black text-white mt-1 flex items-center gap-2 font-sans">
                  <BookOpen className="w-6 h-6 text-amber-500" />
                  ZAYTRIX NEWSROOM
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Analisis intelijen pasar langsung dari koresponden global terkemuka kami.
                </p>
              </div>

              <div className="flex items-center gap-2.5 max-w-sm w-full">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari berita, emiten, topik..."
                    className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500/50 rounded-lg pl-9 pr-4 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-all text-slate-200"
                  />
                </div>
              </div>
            </div>

            {/* Category Tags Filter */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none select-none">
              <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0 mr-1" />
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`text-[10px] uppercase tracking-wider font-bold px-3.5 py-1.5 rounded-full border transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    activeCategory === cat
                      ? "bg-amber-500/20 text-amber-400 border-amber-500/40 ring-1 ring-amber-500/20"
                      : "bg-slate-950/40 text-slate-400 border-slate-800/60 hover:text-slate-200 hover:border-slate-700"
                  }`}
                >
                  {cat === "All" ? "Semua Berita" : cat}
                </button>
              ))}
            </div>

            {/* IMPL-C3: Loading skeleton (same layout as article cards, shimmer effect). */}
            {loading && articles.length === 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-slate-950/40 border border-slate-800/80 rounded-xl overflow-hidden animate-pulse">
                    <div className="h-44 bg-slate-900" />
                    <div className="p-5 space-y-3">
                      <div className="h-3 bg-slate-800 rounded w-1/3" />
                      <div className="h-4 bg-slate-800 rounded w-3/4" />
                      <div className="h-3 bg-slate-800/70 rounded w-full" />
                      <div className="h-3 bg-slate-800/70 rounded w-2/3" />
                    </div>
                    <div className="px-5 pb-5 pt-3 border-t border-slate-800/50 flex items-center justify-between">
                      <div className="h-3 bg-slate-800 rounded w-1/4" />
                      <div className="h-3 bg-slate-800 rounded w-1/5" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* IMPL-C3: Error state with retry button. */}
            {error && !loading && articles.length === 0 && (
              <div className="bg-slate-950/30 border border-rose-500/30 rounded-xl p-12 text-center">
                <p className="text-sm font-bold text-rose-400">Gagal memuat berita</p>
                <p className="text-xs text-slate-500 mt-1 mb-4 font-mono">{error}</p>
                <button
                  onClick={handleRetry}
                  className="text-xs bg-amber-500/15 text-amber-300 border border-amber-500/20 px-4 py-2 rounded cursor-pointer hover:bg-amber-500/25 font-bold transition-all"
                >
                  Coba Lagi
                </button>
              </div>
            )}

            {/* Featured Hero Article - Styled like theblock.co top banner */}
            {filteredArticles.length > 0 && activeCategory === "All" && !searchQuery && featuredArticle && (
              <div 
                onClick={() => handleSelectArticle(featuredArticle.id)}
                className="group cursor-pointer bg-gradient-to-b from-slate-950/80 to-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 hover:border-amber-500/30 ring-1 ring-transparent hover:ring-amber-500/10 flex flex-col lg:flex-row"
              >
                <div className="lg:w-3/5 relative h-64 lg:h-auto overflow-hidden">
                  {featuredArticle.imageUrl ? (
                    <img
                      src={featuredArticle.imageUrl}
                      alt={featuredArticle.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-[1.015] transition-transform duration-500 filter brightness-90 group-hover:brightness-100"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 flex items-center justify-center">
                      <BookOpen className="w-16 h-16 text-slate-700" />
                    </div>
                  )}
                  <div className="absolute top-4 left-4 bg-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded shadow-md font-mono">
                    FEATURED REPORT
                  </div>
                </div>

                <div className="lg:w-2/5 p-6 lg:p-8 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        {featuredArticle.category}
                      </span>
                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border bg-slate-800/60 text-slate-400 border-slate-700">
                        AI: —
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-cyan-500" /> {featuredArticle.readTime}
                      </span>
                    </div>

                    <h3 className="text-xl lg:text-2xl font-black text-white group-hover:text-amber-400 transition-colors tracking-tight leading-tight font-sans">
                      {featuredArticle.title}
                    </h3>
                    
                    <p className="text-xs text-slate-400 leading-relaxed font-medium line-clamp-4">
                      {featuredArticle.summary}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-slate-500 text-[10px] font-mono">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold">
                        {featuredArticle.author.charAt(0)}
                      </div>
                      <span className="font-bold text-slate-300">{featuredArticle.author}</span>
                    </div>
                    <span>{featuredArticle.date}</span>
                  </div>
                </div>
              </div>
            )}

            {/* List Grid Feed */}
            {filteredArticles.length > 0 ? (
              <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredArticles
                  .filter(art => activeCategory !== "All" || searchQuery ? true : art.id !== featuredArticle?.id)
                  .slice(0, displayCount)
                  .map((article) => (
                    <motion.div
                      key={article.id}
                      layout
                      onClick={() => handleSelectArticle(article.id)}
                      className="group cursor-pointer bg-slate-950/40 hover:bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 rounded-xl overflow-hidden shadow-lg transition-all duration-200 flex flex-col justify-between"
                    >
                      <div>
                        {/* Article Image Cover */}
                        <div className="h-44 relative overflow-hidden bg-slate-900">
                          {article.imageUrl ? (
                            <img
                              src={article.imageUrl}
                              alt={article.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300 filter brightness-90 group-hover:brightness-100"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 flex items-center justify-center">
                              <BookOpen className="w-12 h-12 text-slate-700" />
                            </div>
                          )}
                          <div className="absolute bottom-3 left-3 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-slate-300 text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                            {article.source}
                          </div>
                        </div>

                        {/* Article Body */}
                        <div className="p-5 space-y-3">
                          <div className="flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-cyan-400 uppercase tracking-widest font-mono">
                                {article.category}
                              </span>
                              <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-slate-800/60 text-slate-400 border-slate-700">
                                AI: —
                              </span>
                            </div>
                            <span className="text-slate-500 font-mono flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {article.readTime}
                            </span>
                          </div>

                          <h4 className="text-sm font-black text-white group-hover:text-amber-400 transition-colors tracking-tight leading-snug line-clamp-2 font-sans">
                            {article.title}
                          </h4>

                          <p className="text-[11px] text-slate-400 leading-relaxed font-medium line-clamp-3">
                            {article.summary}
                          </p>
                        </div>
                      </div>

                      {/* Article Footer */}
                      <div className="px-5 pb-5 pt-3 border-t border-slate-800/50 flex items-center justify-between text-[10px] font-mono text-slate-500">
                        <span className="font-bold text-slate-400 flex items-center gap-1.5">
                          <User className="w-3 h-3 text-amber-500" /> {article.author}
                        </span>
                        <span>{article.date}</span>
                      </div>
                    </motion.div>
                  ))}
              </div>
              {/* IMPL-C3: Load More button — API returns up to 30 articles; show
                  9 initially and reveal 9 more per click. */}
              {filteredArticles.length > displayCount && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={() => setDisplayCount(c => c + 9)}
                    className="text-xs font-bold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-6 py-2.5 rounded-lg flex items-center gap-2 cursor-pointer transition-all"
                  >
                    Muat Lebih Banyak
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              </>
            ) : (
              <div className="bg-slate-950/30 border border-slate-800/60 rounded-xl p-12 text-center text-slate-500">
                <Search className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-400">Tidak ada artikel yang cocok</p>
                <p className="text-xs text-slate-500 mt-1">Coba sesuaikan kata kunci pencarian atau kategori filter Anda.</p>
              </div>
            )}
          </motion.div>
        ) : (
          /* Detailed Premium Article View - modeled after theblock.co/post/... */
          <motion.div
            key="article-detail"
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.25 }}
            className="max-w-4xl mx-auto space-y-8"
          >
            {/* Navigation back button */}
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-4">
              <button
                onClick={() => setSelectedArticleId(null)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white bg-slate-900 border border-slate-800 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Kembali ke Newsroom
              </button>

              <div className="flex items-center gap-2">
                <button 
                  onClick={() => alert("Tautan artikel disalin ke papan klip!")}
                  className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  title="Bagikan Artikel"
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button 
                  className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  title="Simpan Artikel"
                >
                  <Bookmark className="w-4 h-4" />
                </button>
              </div>
            </div>

            {activeArticle && (
              <article className="space-y-6">
                {/* Meta Metadata Header */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-black text-amber-400 uppercase tracking-widest font-mono bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20 shadow-sm">
                      {activeArticle.category}
                    </span>
                    <span className="text-slate-500 font-mono">•</span>
                    <span className="text-slate-400 font-mono flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-cyan-500" /> {activeArticle.date}
                    </span>
                    <span className="text-slate-500 font-mono">•</span>
                    <span className="text-slate-400 font-mono flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-cyan-500" /> {activeArticle.readTime} membaca
                    </span>
                  </div>

                  <h1 className="text-2xl md:text-4xl font-black text-white tracking-tight leading-tight font-sans">
                    {activeArticle.title}
                  </h1>

                  {activeArticle.subTitle && (
                    <p className="text-sm md:text-base text-slate-400 leading-relaxed font-semibold border-l-2 border-amber-500 pl-4 py-1">
                      {activeArticle.subTitle}
                    </p>
                  )}
                </div>

                {/* Author Information Badge */}
                <div className="flex items-center gap-3 bg-slate-950/60 border border-slate-800/60 p-4 rounded-xl">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500 to-amber-600 flex items-center justify-center text-slate-950 font-black shrink-0 shadow-md">
                    {activeArticle.author.charAt(0)}
                  </div>
                  <div>
                    <h5 className="text-xs font-black text-slate-200">{activeArticle.author}</h5>
                    <p className="text-[10px] text-slate-500 font-mono">{activeArticle.authorTitle}</p>
                  </div>
                </div>

                {/* Hero Featured Image */}
                <div className="relative rounded-2xl overflow-hidden border border-slate-800 shadow-2xl h-64 md:h-[400px]">
                  {activeArticle.imageUrl ? (
                    <img
                      src={activeArticle.imageUrl}
                      alt={activeArticle.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 flex items-center justify-center">
                      <BookOpen className="w-20 h-20 text-slate-700" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60" />
                </div>

                {/* Editorial Body Content - styled beautifully for deep layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-4">
                  {/* Left Sidebar Table of Content / Stats */}
                  <div className="lg:col-span-3 space-y-5 hidden lg:block">
                    <div className="sticky top-6 space-y-4">
                      <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-3.5">
                        <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest block font-mono">
                          ANALYSIS OUTLINE
                        </span>
                        <div className="space-y-2 text-[11px] font-semibold text-slate-400">
                          <div className="flex items-center gap-2 text-amber-400 border-l-2 border-amber-500 pl-2">
                            <span>Laporan Utama</span>
                          </div>
                          <div className="hover:text-slate-200 pl-2.5 transition-colors cursor-pointer">
                            <span>Konteks Industri</span>
                          </div>
                          <div className="hover:text-slate-200 pl-2.5 transition-colors cursor-pointer">
                            <span>Dampak Pasar</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-3">
                        <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest block font-mono">
                          ASET TERKAIT
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {activeArticle.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="bg-slate-900 border border-slate-800 text-[9px] font-mono font-bold text-slate-400 px-2 py-1 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Article Body Text Content - theblock.co layout style */}
                  <div className="lg:col-span-9 space-y-5 leading-relaxed text-sm text-slate-300 font-medium font-sans">
                    
                    {/* 🧠 AI SENTIMENT & INTELIJEN PASAR CARD */}
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden p-6 mb-6 space-y-5 shadow-xl relative">
                      {/* Header with Sparkles & Live badge */}
                      <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-amber-500/15 rounded-lg text-amber-400">
                            <Brain className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                              ANALISIS SENTIMEN AI
                              <span className="text-[9px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded font-mono border border-cyan-500/20 uppercase tracking-wider">
                                GEMINI 3.5 LIVE
                              </span>
                            </h3>
                            <p className="text-[10px] text-slate-400 font-mono">Market Intel & Sentiment Analyzer</p>
                          </div>
                        </div>
                        
                        {sentimentResult?.isFallback && (
                          <span className="text-[8px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono uppercase">
                            OFFLINE INDEX ACTIVE
                          </span>
                        )}
                      </div>

                      {sentimentLoading ? (
                        <div className="py-8 text-center space-y-3">
                          <div className="relative w-12 h-12 mx-auto">
                            <div className="absolute inset-0 rounded-full border-2 border-amber-500/20" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-amber-500 animate-spin" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-slate-300 font-black animate-pulse">Menghubungi AI Z-Capital...</p>
                            <p className="text-[10px] text-slate-500">Mengekstrak korelasi makro & sentimen tokenomik</p>
                          </div>
                        </div>
                      ) : sentimentError ? (
                        <div className="bg-red-500/5 border border-red-500/15 p-4 rounded-xl text-center space-y-2">
                          <p className="text-xs text-red-400 font-bold">{sentimentError}</p>
                          <button 
                            onClick={() => {
                              setSelectedArticleId(null);
                              setTimeout(() => setSelectedArticleId(activeArticle?.id || null), 10);
                            }}
                            className="text-[10px] bg-red-500/15 text-red-300 border border-red-500/20 px-3 py-1 rounded cursor-pointer hover:bg-red-500/25 transition-all font-bold"
                          >
                            Coba Lagi
                          </button>
                        </div>
                      ) : sentimentResult ? (
                        <div className="space-y-4">
                          {/* Sentiment Gauge & Info */}
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                            {/* Sentiment Gauge Column */}
                            <div className="md:col-span-4 flex flex-col items-center justify-center text-center bg-slate-900/50 border border-slate-800/60 p-4 rounded-xl relative overflow-hidden">
                              {/* Subtle background glow based on sentiment */}
                              <div className={`absolute -bottom-10 -left-10 w-24 h-24 rounded-full filter blur-2xl opacity-10 ${
                                sentimentResult.sentiment === "BULLISH" ? "bg-emerald-500" :
                                sentimentResult.sentiment === "BEARISH" ? "bg-rose-500" : "bg-amber-500"
                              }`} />
                              
                              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono mb-1">SENTIMEN UTAMA</span>
                              <div className={`text-sm md:text-base font-black tracking-tight flex items-center gap-1.5 ${
                                sentimentResult.sentiment === "BULLISH" ? "text-emerald-400" :
                                sentimentResult.sentiment === "BEARISH" ? "text-rose-400" : "text-amber-400"
                              }`}>
                                {sentimentResult.sentiment === "BULLISH" && <ThumbsUp className="w-4 h-4 text-emerald-400 shrink-0" />}
                                {sentimentResult.sentiment === "BEARISH" && <ThumbsDown className="w-4 h-4 text-rose-400 shrink-0" />}
                                {sentimentResult.sentiment === "NEUTRAL" && <Activity className="w-4 h-4 text-amber-400 shrink-0" />}
                                {sentimentResult.sentiment}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-1">
                                Skor Keyakinan: <span className="font-bold text-white">{sentimentResult.score}%</span>
                              </div>
                              {/* Progress Bar Gauge */}
                              <div className="w-full bg-slate-950 border border-slate-800/80 rounded-full h-1.5 mt-2 overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all duration-1000 ${
                                    sentimentResult.sentiment === "BULLISH" ? "bg-emerald-500" :
                                    sentimentResult.sentiment === "BEARISH" ? "bg-rose-500" : "bg-amber-500"
                                  }`}
                                  style={{ width: `${sentimentResult.score}%` }}
                                />
                              </div>
                            </div>

                            {/* Executive summary Column */}
                            <div className="md:col-span-8 space-y-1.5">
                              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">IKHTISAR ANALIS (CFA REPORT)</span>
                              <p className="text-xs text-slate-200 leading-relaxed font-semibold">
                                {sentimentResult.summary}
                              </p>
                            </div>
                          </div>

                          {/* Impact Breakdown */}
                          <div className="bg-slate-900/40 border border-slate-800/40 p-4 rounded-xl space-y-3">
                            <div className="space-y-1">
                              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono block">DAMPAK PASAR & EKOSISTEM</span>
                              <p className="text-xs text-slate-300 leading-relaxed font-medium">{sentimentResult.marketImpact}</p>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800/40">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest font-mono">POTENSI PEMENANG (WINNERS)</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {sentimentResult.winners.map(w => (
                                    <span key={w} className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] px-2 py-0.5 rounded font-bold font-sans">
                                      {w}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                  <span className="text-[9px] font-bold text-rose-400 uppercase tracking-widest font-mono">POTENSI RISIKO (LOSERS)</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {sentimentResult.losers.map(l => (
                                    <span key={l} className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] px-2 py-0.5 rounded font-bold font-sans">
                                      {l}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Short & Long Term Outlook */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-slate-900/30 border border-slate-800/40 p-4 rounded-xl space-y-1">
                              <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-widest font-mono block">PROSPEK JANGKA PENDEK (1-7 HARI)</span>
                              <p className="text-[11px] text-slate-400 leading-relaxed font-medium">{sentimentResult.shortTermOutlook}</p>
                            </div>
                            <div className="bg-slate-900/30 border border-slate-800/40 p-4 rounded-xl space-y-1">
                              <span className="text-[9px] font-bold text-purple-400 uppercase tracking-widest font-mono block">PROSPEK STRUKTURAL JANGKA PANJANG</span>
                              <p className="text-[11px] text-slate-400 leading-relaxed font-medium">{sentimentResult.longTermOutlook}</p>
                            </div>
                          </div>

                          {/* 💬 INTERACTIVE CHAT WITH AI SECTION */}
                          <div className="border-t border-slate-800/80 pt-4 space-y-3">
                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono flex items-center gap-1">
                              <HelpCircle className="w-3.5 h-3.5 text-amber-500" /> TANYA ASISTEN AI TENTANG BERITA INI
                            </span>
                            
                            {/* Chat message list */}
                            {newsChatHistory.length > 0 && (
                              <div className="space-y-3 max-h-48 overflow-y-auto p-3 bg-slate-950/60 border border-slate-800/60 rounded-xl scrollbar-thin">
                                {newsChatHistory.map((chat, idx) => (
                                  <div 
                                    key={idx} 
                                    className={`flex gap-2.5 ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                  >
                                    {chat.role !== 'user' && (
                                      <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                                        <Brain className="w-3 h-3 text-amber-400" />
                                      </div>
                                    )}
                                    <div className={`p-2.5 rounded-xl max-w-[85%] text-xs leading-relaxed ${
                                      chat.role === 'user' 
                                        ? 'bg-amber-500/15 border border-amber-500/20 text-slate-200 rounded-tr-none' 
                                        : 'bg-slate-900 border border-slate-800/80 text-slate-300 rounded-tl-none'
                                    }`}>
                                      {chat.content}
                                    </div>
                                  </div>
                                ))}
                                
                                {chatLoading && (
                                  <div className="flex gap-2.5 justify-start">
                                    <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                                      <Brain className="w-3 h-3 text-amber-400 animate-pulse" />
                                    </div>
                                    <div className="bg-slate-900 border border-slate-800/80 p-2.5 rounded-xl rounded-tl-none text-xs text-slate-500 font-mono animate-pulse">
                                      AI sedang merumuskan jawaban...
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Input area */}
                            <form 
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (!newsQuestion.trim() || chatLoading) return;
                                
                                const question = newsQuestion.trim();
                                setNewsQuestion("");
                                const userMsg = { role: 'user' as const, content: question };
                                setNewsChatHistory(prev => [...prev, userMsg]);
                                setChatLoading(true);

                                fetch("/api/gemini/news-chat", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    article: activeArticle,
                                    question,
                                    chatHistory: [...newsChatHistory, userMsg]
                                  })
                                })
                                  .then(res => {
                                    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                                    return res.json();
                                  })
                                  .then(data => {
                                    setNewsChatHistory(prev => [...prev, { role: 'model', content: data.answer }]);
                                  })
                                  .catch(err => {
                                    setNewsChatHistory(prev => [...prev, { 
                                      role: 'model', 
                                      content: `Maaf, asisten AI mendeteksi gangguan jaringan: ${err.message || String(err)}. Silakan coba tanyakan kembali.` 
                                    }]);
                                  })
                                  .finally(() => {
                                    setChatLoading(false);
                                  });
                              }}
                              className="flex items-center gap-2"
                            >
                              <input
                                type="text"
                                value={newsQuestion}
                                onChange={(e) => setNewsQuestion(e.target.value)}
                                disabled={chatLoading}
                                placeholder="Tanyakan dampak berita ini... (misal: 'Berapa persen alokasi aset ideal?')"
                                className="flex-1 bg-slate-950 border border-slate-800 focus:border-amber-500/50 rounded-lg px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500/30 text-slate-200 disabled:opacity-50"
                              />
                              <button
                                type="submit"
                                disabled={!newsQuestion.trim() || chatLoading}
                                className="bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:opacity-40 text-slate-950 p-2 rounded-lg cursor-pointer transition-all shrink-0 flex items-center justify-center border-none"
                              >
                                <Send className="w-3.5 h-3.5 text-slate-950" />
                              </button>
                            </form>

                            {/* Suggestion tags if chat is empty */}
                            {newsChatHistory.length === 0 && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                <span className="text-[9px] text-slate-500 font-mono flex items-center">Rekomendasi Pertanyaan:</span>
                                <button 
                                  type="button"
                                  onClick={() => setNewsQuestion("Bagaimana alokasi portofolio terbaik merespon berita ini?")}
                                  className="text-[9px] font-mono bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 px-2 py-1 rounded cursor-pointer transition-all"
                                >
                                  "Alokasi portofolio terbaik?"
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setNewsQuestion("Apa saja risiko tersembunyi yang belum dibahas berita ini?")}
                                  className="text-[9px] font-mono bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 px-2 py-1 rounded cursor-pointer transition-all"
                                >
                                  "Risiko tersembunyi?"
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {activeArticle.content.map((paragraph, index) => {
                      // Turn headings into bold display items if starts with number
                      if (paragraph.match(/^\d+\./)) {
                        return (
                          <h4 key={index} className="text-base font-black text-white pt-4 tracking-tight flex items-center gap-2">
                            <span className="text-amber-500 font-mono">{paragraph.substring(0, 2)}</span>
                            <span>{paragraph.substring(2)}</span>
                          </h4>
                        );
                      }
                      
                      // Highlight blockquotes (kept for legacy compatibility)
                      if (paragraph.includes("Vance Spencer") && paragraph.includes(":")) {
                        const [speaker, speech] = paragraph.split(":");
                        return (
                          <div key={index} className="bg-gradient-to-r from-slate-950 to-slate-900 border-l-4 border-amber-500 p-5 rounded-r-xl my-6 relative overflow-hidden font-sans">
                            <span className="text-5xl text-amber-500/15 absolute right-4 top-1 select-none pointer-events-none">“</span>
                            <p className="italic text-slate-200 text-sm leading-relaxed relative z-10 font-semibold">
                              {speech}
                            </p>
                            <p className="text-right text-[10px] font-bold uppercase tracking-wider text-amber-500 mt-2 font-mono">
                              — {speaker}
                            </p>
                          </div>
                        );
                      }

                      return (
                        <p key={index} className="leading-relaxed text-[13px] md:text-sm text-slate-300">
                          {paragraph}
                        </p>
                      );
                    })}

                    {/* IMPL-C3: "Read more at source" link — RSS feed only gives
                        a short summary, so we link to the original article. */}
                    {activeArticle.url && (
                      <a
                        href={activeArticle.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-4 py-2 rounded-lg transition-all mt-4"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Baca Selengkapnya di {activeArticle.source}
                      </a>
                    )}

                    {/* Tag Cloud */}
                    <div className="pt-6 border-t border-slate-800 flex flex-wrap items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-[10px] text-slate-500 font-bold font-mono mr-1.5">TAGS:</span>
                      {activeArticle.tags.map(tag => (
                        <span key={tag} className="bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400 px-2.5 py-1 rounded-full">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bottom Disclaimer */}
                <div className="bg-slate-950/40 border border-slate-800/60 p-5 rounded-xl text-[10px] text-slate-500 leading-relaxed font-mono mt-8">
                  <span className="font-bold text-slate-400 block mb-1">Pemberitahuan Kepatuhan Hukum & Risiko (Disclaimer):</span>
                  Informasi di atas bersumber dari data publik dan analisis independen, disediakan murni sebagai bentuk intelijen berita pasar terdesentralisasi oleh Z-Capital Global Gateway. Laporan ini tidak mengandung dan tidak boleh ditafsirkan sebagai rekomendasi sekuritas formal, anjuran beli/jual aset kripto, atau nasihat investasi berlisensi lainnya.
                </div>

                {/* Related Articles Suggestions Footer */}
                <div className="pt-8 border-t border-slate-800 space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-cyan-400" /> RELATED INVESTIGATION REPORTS
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {articles
                      .filter(art => art.id !== activeArticle.id)
                      .slice(0, 2)
                      .map(art => (
                        <div
                          key={art.id}
                          onClick={() => handleSelectArticle(art.id)}
                          className="bg-slate-950/40 hover:bg-slate-950/70 border border-slate-800 p-4 rounded-xl cursor-pointer transition-all duration-200 flex gap-4 items-center group"
                        >
                          <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-slate-900">
                            {art.imageUrl ? (
                              <img
                                src={art.imageUrl}
                                alt={art.title}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover filter brightness-90 group-hover:brightness-100"
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center">
                                <BookOpen className="w-6 h-6 text-slate-700" />
                              </div>
                            )}
                          </div>
                          <div className="space-y-1 overflow-hidden">
                            <span className="text-[9px] font-bold text-amber-500 font-mono uppercase">
                              {art.category}
                            </span>
                            <h5 className="text-xs font-black text-white group-hover:text-amber-400 transition-colors line-clamp-2 leading-snug">
                              {art.title}
                            </h5>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </article>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
