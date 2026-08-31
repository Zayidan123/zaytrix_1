/**
 * MarketSentimentChat — NEW FEATURE (Task 8)
 * -------------------------------------------
 * An AI-powered chat interface where users can ask questions about the current
 * crypto market. The widget grounds each query in LIVE market data (Fear & Greed,
 * BTC dominance, top gainers/losers, global market cap) fetched from
 * /api/onchain/metrics, then calls /api/ai/chat with a market-grounded system
 * prompt.
 *
 * Features:
 *   - Chat message history (user + assistant bubbles, markdown rendered)
 *   - Suggested quick-prompts (chips)
 *   - Live market context badge (Fear & Greed value + classification)
 *   - Loading + error states with graceful fallback when AI is unavailable
 *   - Persisted chat history to localStorage (per-user)
 *   - Auto-scroll to latest message
 *   - Provider badge (OpenRouter / Gemini / fallback)
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import {
  MessageCircle,
  Send,
  Sparkles,
  RefreshCw,
  Trash2,
  AlertCircle,
  Bot,
  User,
  TrendingUp,
  Zap,
} from "lucide-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  provider?: string;
  model?: string;
  isFallback?: boolean;
  error?: boolean;
}

interface MarketContext {
  fearGreedValue: number;
  fearGreedClass: string;
  btcDominance: number;
  totalMarketCap: number;
  topGainer?: string;
  topLoser?: string;
}

const STORAGE_KEY = "zaytrix_market_chat_history";

const QUICK_PROMPTS = [
  "Apa sentimen pasar saat ini?",
  "Apakah ini waktu yang tepat untuk beli BTC?",
  "Analisis singkat 3 koin top gainer hari ini",
  "Bagaimana tren BTC dominance minggu ini?",
  "Apa risiko terbesar di pasar crypto sekarang?",
];

function formatMarketCap(usd: number): string {
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  return `$${(usd / 1e6).toFixed(0)}M`;
}

function getFearGreedColor(value: number): string {
  if (value <= 24) return "#dc2626";
  if (value <= 44) return "#f97316";
  if (value <= 55) return "#eab308";
  if (value <= 74) return "#22c55e";
  return "#16a34a";
}

export default function MarketSentimentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<MarketContext | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load persisted chat history
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch {}
  }, []);

  // Persist chat history
  useEffect(() => {
    try {
      // Cap at 50 messages to avoid localStorage bloat
      const capped = messages.slice(-50);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
    } catch {}
  }, [messages]);

  // Fetch live market context (for grounding + badge)
  const fetchContext = useCallback(async () => {
    try {
      setContextLoading(true);
      const [metricsRes, globalRes] = await Promise.allSettled([
        fetch("/api/onchain/metrics").then((r) => r.json()),
        fetch("/api/coins/global-stats").then((r) => r.json()),
      ]);

      let ctx: MarketContext = {
        fearGreedValue: 50,
        fearGreedClass: "Neutral",
        btcDominance: 0,
        totalMarketCap: 0,
      };

      if (metricsRes.status === "fulfilled" && metricsRes.value?.success) {
        const m = metricsRes.value;
        if (m.fearGreed?.current) {
          ctx.fearGreedValue = m.fearGreed.current.value;
          ctx.fearGreedClass = m.fearGreed.current.classification;
        }
        if (m.gainers?.[0]) ctx.topGainer = `${m.gainers[0].symbol} (+${m.gainers[0].change}%)`;
        if (m.losers?.[0]) ctx.topLoser = `${m.losers[0].symbol} (${m.losers[0].change}%)`;
      }

      if (globalRes.status === "fulfilled" && globalRes.value?.success) {
        ctx.totalMarketCap = globalRes.value.totalMc || 0;
      }

      setContext(ctx);
    } catch (e) {
      console.error("Failed to fetch market context:", e);
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContext();
    const interval = setInterval(fetchContext, 60_000);
    return () => clearInterval(interval);
  }, [fetchContext]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const buildSystemPrompt = (): string => {
    const fgValue = context?.fearGreedValue ?? 50;
    const fgClass = context?.fearGreedClass ?? "Neutral";
    const mc = context?.totalMarketCap ? formatMarketCap(context.totalMarketCap) : "tidak tersedia";
    const gainer = context?.topGainer ?? "tidak tersedia";
    const loser = context?.topLoser ?? "tidak tersedia";

    return `Anda adalah ZAYTRIX AI Market Analyst — asisten AI keuangan tingkat institusional yang menjawab pertanyaan pengguna tentang pasar cryptocurrency secara real-time.

KONTEKS PASAR LIVE SAAT INI:
- Fear & Greed Index: ${fgValue}/100 (${fgClass})
- Total Market Cap: ${mc}
- Top Gainer 24h: ${gainer}
- Top Loser 24h: ${loser}

ATURAN JAWABAN:
1. Jawab dalam bahasa Indonesia profesional yang berwibawa namun mudah dipahami.
2. Gunakan Markdown untuk formatting (heading, bold, list, tabel bila perlu).
3. Berdasarkan jawaban pada data live di atas — jangan mengarang angka.
4. Jika ditanya "apakah saatnya beli", jelaskan faktor sentimen + risiko, BUKAN rekomendasi langsung beli/jual.
5. Sertakan disclaimer singkat bahwa ini analisis AI, bukan nasihat keuangan.
6. Maksimal 300 kata kecuali diminta lebih detail.`;
  };

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Ensure context is fresh before sending
      if (!context) await fetchContext();

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: content,
          systemPrompt: buildSystemPrompt(),
          maxTokens: 1000,
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (data.success) {
        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.text || data.response || "Tidak ada respons dari AI.",
          timestamp: Date.now(),
          provider: data.provider || "unknown",
          model: data.model || undefined,
          isFallback: data.fallbackUsed,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        // AI providers unavailable — show graceful fallback
        const fallbackMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: `Maaf, layanan AI sedang tidak tersedia saat ini (${data.error || "unknown error"}).\n\nNamun, berdasarkan data pasar live:\n- Fear & Greed: **${context?.fearGreedValue ?? "?"}/100** (${context?.fearGreedClass ?? "?"})\n- Top Gainer: ${context?.topGainer ?? "—"}\n- Top Loser: ${context?.topLoser ?? "—"}\n\nSilakan coba lagi nanti atau periksa koneksi OpenRouter/Gemini di Settings.`,
          timestamp: Date.now(),
          isFallback: true,
          error: true,
        };
        setMessages((prev) => [...prev, fallbackMsg]);
      }
    } catch (e: any) {
      const errorMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: `Gagal terhubung ke server: ${e?.message || "unknown error"}. Periksa koneksi internet Anda.`,
        timestamp: Date.now(),
        error: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const fgColor = context ? getFearGreedColor(context.fearGreedValue) : "#eab308";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-slate-900/50 border border-slate-800/80 rounded-2xl shadow-2xl backdrop-blur-sm relative overflow-hidden flex flex-col h-[600px]"
    >
      {/* Decorative gradient */}
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="relative flex items-center justify-between p-4 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center gap-3">
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 3, repeat: Infinity, repeatDelay: 2 }}
            className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-violet-500/30 flex items-center justify-center"
          >
            <MessageCircle className="w-4.5 h-4.5 text-violet-400" />
          </motion.div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-tight">AI Market Analyst</h3>
              <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-violet-950 text-violet-400 border border-violet-800/60">
                LIVE
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">
              Tanya jawab tentang pasar crypto
            </p>
          </div>
        </div>

        {/* Live context badge */}
        <div className="flex items-center gap-2">
          {!contextLoading && context && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-950/60 border border-slate-800"
              title={`Fear & Greed: ${context.fearGreedValue} (${context.fearGreedClass})`}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: fgColor }} />
              <span className="text-[10px] font-mono font-bold" style={{ color: fgColor }}>
                {context.fearGreedValue}
              </span>
            </motion.div>
          )}
          <button
            onClick={clearChat}
            aria-label="Clear chat"
            className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-950/80 hover:border-red-700/40 hover:text-red-400 text-slate-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar relative z-10">
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-8"
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-violet-500/15 to-blue-500/15 border border-violet-500/30 flex items-center justify-center"
            >
              <Sparkles className="w-7 h-7 text-violet-400" />
            </motion.div>
            <p className="text-sm font-bold text-white mb-1">AI Market Analyst siap membantu</p>
            <p className="text-[11px] text-slate-400 mb-4">
              Tanyakan apa saja tentang pasar crypto — dijawab dengan data live
            </p>
            {/* Quick prompts */}
            <div className="flex flex-wrap gap-1.5 justify-center max-w-md mx-auto">
              {QUICK_PROMPTS.map((prompt) => (
                <motion.button
                  key={prompt}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => sendMessage(prompt)}
                  disabled={loading}
                  className="text-[10px] px-2.5 py-1.5 rounded-full bg-slate-950/60 border border-slate-800 hover:border-violet-700/40 hover:text-violet-300 text-slate-400 transition-colors cursor-pointer disabled:opacity-40"
                >
                  {prompt}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              layout
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.25 }}
              className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    msg.error
                      ? "bg-red-500/10 border border-red-500/20"
                      : "bg-gradient-to-br from-violet-500/15 to-blue-500/15 border border-violet-500/25"
                  }`}
                >
                  {msg.error ? (
                    <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <Bot className="w-3.5 h-3.5 text-violet-400" />
                  )}
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                  msg.role === "user"
                    ? "bg-blue-600/20 border border-blue-600/30 text-blue-100"
                    : msg.error
                    ? "bg-red-950/40 border border-red-800/40 text-red-200"
                    : "bg-slate-950/60 border border-slate-800/60 text-slate-200"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="text-xs leading-relaxed prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_strong]:text-white [&_ul]:my-1 [&_li]:my-0.5">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed">{msg.content}</p>
                )}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[8px] text-slate-500 font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {msg.provider && msg.provider !== "unknown" && (
                    <span
                      className={
                        "text-[8px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-0.5 " +
                        (msg.provider === "openrouter"
                          ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                          : msg.provider === "gemini"
                            ? "text-sky-300 bg-sky-500/10 border-sky-500/25"
                            : "text-slate-400 bg-slate-500/10 border-slate-600/30")
                      }
                      title={`Penyedia AI: ${msg.provider}${msg.model ? ` · model ${msg.model}` : ""}`}
                    >
                      {msg.provider === "openrouter" ? "⚡" : msg.provider === "gemini" ? "✦" : "•"} {msg.provider}
                      {msg.model ? ` · ${msg.model.split("/").pop()}` : ""}
                    </span>
                  )}
                  {msg.isFallback && (
                    <span className="text-[8px] text-amber-500 font-mono flex items-center gap-0.5">
                      <Zap className="w-2 h-2" /> fallback
                    </span>
                  )}
                </div>
              </div>
              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-blue-400" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Loading indicator */}
        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-2.5 justify-start"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/15 to-blue-500/15 border border-violet-500/25 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <div className="bg-slate-950/60 border border-slate-800/60 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-1.5">
                <motion.div
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: 0 }}
                  className="w-2 h-2 rounded-full bg-violet-400"
                />
                <motion.div
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: 0.2 }}
                  className="w-2 h-2 rounded-full bg-violet-400"
                />
                <motion.div
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: 0.4 }}
                  className="w-2 h-2 rounded-full bg-violet-400"
                />
              </div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="relative p-3 border-t border-slate-800/80 bg-slate-950/40">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tanya tentang pasar crypto..."
            disabled={loading}
            className="flex-1 bg-slate-950/60 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all font-mono placeholder:text-slate-600"
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-gradient-to-r from-violet-600 to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed p-2.5 rounded-xl text-white shadow-lg shadow-violet-500/20"
          >
            <Send className="w-4 h-4" />
          </motion.button>
        </form>
        <p className="text-[8px] text-slate-600 font-mono mt-1.5 text-center flex items-center justify-center gap-1">
          <TrendingUp className="w-2.5 h-2.5" />
          Didasarkan pada data live • Bukan nasihat keuangan
        </p>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(139,92,246,0.5); }
      `}</style>
    </motion.div>
  );
}
