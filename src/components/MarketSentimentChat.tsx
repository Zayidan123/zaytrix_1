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
 *   - Persisted chat history to localStorage (per-user) — fallback offline
 *   - Auto-scroll to latest message
 *   - Provider badge (OpenRouter / Gemini / fallback)
 *   - QA7-F1: SSE streaming (token-by-token)
 *   - QA10-E: riwayat percakapan per-user dari SERVER (GET /api/ai/history)
 *     + pemilih model AI per request + tombol hapus riwayat (2 langkah)
 *     + penanganan kuota harian (HTTP 429) + chip "MEMORI".
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import StreamMarkdown from "./StreamMarkdown";
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
  Check,
  X,
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
  /** QA7-F1: true while SSE tokens are still arriving */
  isStreaming?: boolean;
  /** QA7-F2: token accounting from the final stream chunk */
  tokensUsed?: number;
  latencyMs?: number;
  /** QA10-E: dimuat dari riwayat server (bukan sesi berjalan) — dipakai
   * untuk menyisipkan pemisah "— riwayat sebelumnya —". */
  fromHistory?: boolean;
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

// QA10-E: kunci persistensi model AI pilihan user (per perangkat).
const AI_MODEL_STORAGE_KEY = "zx-ai-model";

// QA10-E: opsi pemilih model.
// SINKRON dengan getAvailableModels() di src/server/aiRouter.ts — id HARUS
// sama persis (server memvalidasi id; id tak dikenal didegradasi ke default
// dengan log warn, bukan error). Kalau backend menambah model, daftar ini
// (dan endpoint GET /api/ai/models) harus ikut diperbarui.
const AI_MODEL_OPTIONS = [
  { id: "z-ai/glm-4.5-air", label: "GLM 4.5 Air" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { id: "google/gemma-3-27b-it", label: "Gemma 3 27B" },
];

// QA10-E: item render chat — pesan biasa atau pemisah riwayat/sesi.
type ChatItem =
  | { kind: "sep"; key: string }
  | { kind: "msg"; key: string; msg: ChatMessage };

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

  // QA10-E: model AI pilihan user (persist "zx-ai-model") + state UI riwayat.
  const [aiModel, setAiModel] = useState<string>(AI_MODEL_OPTIONS[0].id);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false); // konfirmasi hapus 2-langkah
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // QA10-E: muat pilihan model tersimpan (validasi id agar tidak menyimpan
  // id basi dari versi frontend lama).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(AI_MODEL_STORAGE_KEY);
      if (saved && AI_MODEL_OPTIONS.some((m) => m.id === saved)) setAiModel(saved);
    } catch {}
  }, []);

  // QA10-E: muat riwayat percakapan per-user dari SERVER (GET /api/ai/history)
  // — sumber kebenaran lintas perangkat. Gagal → fallback diam ke localStorage
  // lama + chip "riwayat tidak tersedia" (chat tetap bisa dipakai).
  // Guard `prev.length === 0`: jangan menimpa pesan yang sudah dikirim user
  // saat fetch riwayat masih berjalan (race mount vs input cepat).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai/history");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data?.success && Array.isArray(data.messages)) {
          const restored: ChatMessage[] = data.messages.map((m: any) => ({
            id: String(m?.id ?? `h-${Math.random().toString(36).slice(2)}`),
            role: m?.role === "assistant" ? "assistant" : "user",
            content: typeof m?.content === "string" ? m.content : "",
            timestamp: m?.createdAt ? Date.parse(m.createdAt) : Date.now(),
            model: typeof m?.model === "string" && m.model ? m.model : undefined,
            fromHistory: true,
          }));
          if (!cancelled) {
            setMessages((prev) => (prev.length === 0 ? restored : prev));
          }
          return; // sukses — localStorage tidak dibaca (hindari duplikat)
        }
        throw new Error(data?.error || "format respons tidak dikenal");
      } catch {
        // Riwayat server tidak tersedia → fallback lama (localStorage), silent.
        if (!cancelled) setHistoryUnavailable(true);
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length && !cancelled) {
              setMessages((prev) => (prev.length === 0 ? parsed : prev));
            }
          }
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // QA10-E: auto-reset konfirmasi hapus (langkah 1 kedaluwarsa setelah 5 dtk).
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 5000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  // QA10-E: chip error hapus riwayat hilang sendiri setelah 5 dtk.
  useEffect(() => {
    if (!clearError) return;
    const t = setTimeout(() => setClearError(null), 5000);
    return () => clearTimeout(t);
  }, [clearError]);

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

  /**
   * QA7-F1: stream the answer token-by-token over SSE. Appends (and mutates)
   * the assistant bubble itself. Returns true when a terminal state was
   * reached via streaming — false when the caller should fall back to the
   * non-streaming /api/ai/chat call.
   */
  const streamChat = async (content: string, systemPrompt: string): Promise<boolean> => {
    const res = await fetch("/api/ai/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: content,
        systemPrompt,
        maxTokens: 1000,
        temperature: 0.7,
        // QA10-E: model pilihan user (pemilih di header) — server memvalidasi
        // ulang terhadap getAvailableModels(); id tak dikenal didegradasi jujur.
        model: aiModel,
      }),
    });

    // QA10-E: kuota AI harian tercapai — server menjawab 429 JSON (BUKAN SSE)
    // dengan bentuk { success:false, error, quota:{ used, limit, resetsAt,
    // unlimited } }. Tampilkan pesan jujur di area chat; jangan jatuh ke
    // fallback non-stream (permintaan memang ditolak, bukan gagal transport).
    if (res.status === 429) {
      let used = "?";
      let limit = "?";
      let resetLabel = "tengah malam UTC";
      try {
        const data = await res.json();
        const q = data?.quota;
        if (q && typeof q === "object") {
          if (typeof q.used === "number") used = String(q.used);
          if (typeof q.limit === "number") limit = String(q.limit);
          if (typeof q.resetsAt === "string" && q.resetsAt) {
            const t = new Date(q.resetsAt);
            if (!Number.isNaN(t.getTime())) {
              resetLabel = `${t.toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              })} (waktu lokal)`;
            }
          }
        }
      } catch {}
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: `**Kuota AI harian tercapai (${used}/${limit})** — reset sekitar pukul ${resetLabel}.\n\nPermintaan ini tidak diproses agar biaya AI tetap terkendali. Kuota dihitung ulang otomatis setiap hari (UTC). Menghapus riwayat percakapan tidak memulihkan kuota.`,
          timestamp: Date.now(),
          isFallback: true,
          error: true,
        },
      ]);
      return true; // terminal state — pemanggil tidak perlu fallback non-stream
    }

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const streamId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: streamId, role: "assistant", content: "", timestamp: Date.now(), provider: "openrouter", isStreaming: true },
    ]);

    let gotAnyToken = false;
    let streamError: string | null = null;
    const finalMeta: Partial<ChatMessage> = {};

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue; // skips keep-alive comments too
        try {
          const ev = JSON.parse(trimmed.slice(5).trim());
          if (ev.type === "start") {
            if (ev.model) {
              setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, model: ev.model, provider: ev.provider || "openrouter" } : m)));
            }
          } else if (ev.type === "token" && typeof ev.text === "string" && ev.text) {
            gotAnyToken = true;
            const chunk = ev.text;
            setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, content: m.content + chunk } : m)));
          } else if (ev.type === "done") {
            finalMeta.tokensUsed = ev.tokensUsed;
            finalMeta.latencyMs = ev.latencyMs;
            if (ev.model) finalMeta.model = ev.model;
            if (ev.provider) finalMeta.provider = ev.provider;
          } else if (ev.type === "error") {
            streamError = ev.error || "stream error";
          }
        } catch {
          // tolerate malformed SSE line
        }
      }
    }

    if (streamError && !gotAnyToken) {
      // Nothing arrived — remove the empty bubble and let the caller
      // decide (non-streaming fallback or honest unavailable message).
      setMessages((prev) => prev.filter((m) => m.id !== streamId));
      return false;
    }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === streamId
          ? { ...m, ...finalMeta, isStreaming: false, error: streamError ? true : m.error }
          : m
      )
    );
    if (streamError && gotAnyToken) {
      // Partial answer + honest disconnect note (content is preserved).
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamId
            ? { ...m, content: `${m.content}\n\n> ⚠️ ${streamError}` }
            : m
        )
      );
    }
    return true;
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
      const systemPrompt = buildSystemPrompt();

      // QA7-F1: try SSE streaming first — token-by-token display.
      try {
        const handled = await streamChat(content, systemPrompt);
        if (handled) return;
      } catch {
        // SSE transport failed (proxy, 404 on older server) — fall through
        // to the non-streaming call below.
      }

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: content,
          systemPrompt,
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

  // QA10-E: simpan pilihan model user (localStorage "zx-ai-model").
  const handleModelChange = (id: string) => {
    setAiModel(id);
    try {
      localStorage.setItem(AI_MODEL_STORAGE_KEY, id);
    } catch {}
  };

  // QA10-E: hapus riwayat — konfirmasi 2-langkah inline di header; langkah 2
  // memanggil DELETE /api/ai/history. Sukses → kosongkan tampilan + cache
  // lokal. Gagal → tampilan TIDAK dikosongkan (jujur: data masih ada di
  // server) + chip error singkat; chat tetap berfungsi.
  const handleConfirmClear = async () => {
    setConfirmClear(false);
    setClearingHistory(true);
    setClearError(null);
    try {
      const res = await fetch("/api/ai/history", { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setMessages([]);
      setHistoryUnavailable(false);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    } catch (e: any) {
      setClearError(e?.message || "gagal");
    } finally {
      setClearingHistory(false);
    }
  };

  const fgColor = context ? getFearGreedColor(context.fearGreedValue) : "#eab308";

  // QA10-E: daftar render chat — sisipkan pemisah halus "— riwayat
  // sebelumnya —" di batas pesan riwayat server (fromHistory) dan pesan
  // yang dikirim pada sesi berjalan.
  const chatItems: ChatItem[] = [];
  messages.forEach((msg, i) => {
    if (i > 0 && !msg.fromHistory && messages[i - 1]?.fromHistory) {
      chatItems.push({ kind: "sep", key: `sep-${msg.id}` });
    }
    chatItems.push({ kind: "msg", key: msg.id, msg });
  });

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
            <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
              Tanya jawab tentang pasar crypto
              <span
                className="text-[8px] px-1 py-px rounded bg-violet-950/60 text-violet-300 border border-violet-800/50"
                title="Jawaban mengalir token demi token (SSE) dari OpenRouter"
              >
                STREAM
              </span>
              {/* QA10-E: memori percakapan per-user aktif */}
              <span
                className="text-[8px] px-1 py-px rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50"
                title="Memori percakapan aktif — 16 pesan terakhir Anda dikirim sebagai konteks ke AI"
              >
                MEMORI
              </span>
            </p>
          </div>
        </div>

        {/* Live context badge + pemilih model + hapus riwayat (QA10-E) */}
        <div className="flex items-center gap-1.5 sm:gap-2">
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
          {/* QA10-E: pemilih model AI per request (id sinkron dengan
              getAvailableModels() aiRouter.ts — lihat AI_MODEL_OPTIONS). */}
          <select
            value={aiModel}
            onChange={(e) => handleModelChange(e.target.value)}
            aria-label="Pilih model AI"
            title="Model AI untuk jawaban berikutnya — pilihan tersimpan di perangkat ini"
            className="bg-slate-950/60 border border-slate-800 rounded-lg px-1.5 py-1 text-[10px] font-mono text-slate-300 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 cursor-pointer max-w-[105px] sm:max-w-[130px]"
          >
            {AI_MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
                {m.label}
              </option>
            ))}
          </select>
          {/* QA10-E: hapus riwayat — konfirmasi 2-langkah inline. */}
          {confirmClear ? (
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Konfirmasi hapus riwayat"
            >
              <span className="text-[9px] font-mono text-red-300 hidden md:inline">Hapus riwayat?</span>
              <button
                onClick={handleConfirmClear}
                disabled={clearingHistory}
                aria-label="Konfirmasi hapus riwayat"
                className="p-1.5 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 hover:bg-red-900/60 transition-colors disabled:opacity-40"
              >
                {clearingHistory ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                aria-label="Batal hapus riwayat"
                className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-950/80 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              aria-label="Hapus riwayat"
              title="Hapus riwayat percakapan (konfirmasi 2 langkah)"
              className="p-1.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-950/80 hover:border-red-700/40 hover:text-red-400 text-slate-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar relative z-10">
        {/* QA10-E: chip status riwayat (tidak memblokir chat) — muncul bila
            riwayat server gagal dimuat ATAU penghapusan riwayat gagal. */}
        {(historyUnavailable || clearError) && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {historyUnavailable && (
                <span
                  className="text-[9px] font-mono text-amber-500/90 px-2 py-0.5 rounded-full border border-amber-800/40 bg-amber-950/20"
                  title="Gagal memuat riwayat percakapan dari server — chat tetap berfungsi"
                >
                  riwayat tidak tersedia
                </span>
              )}
              {clearError && (
                <span
                  className="text-[9px] font-mono text-red-300 px-2 py-0.5 rounded-full border border-red-800/40 bg-red-950/30"
                  title={`Gagal menghapus riwayat di server: ${clearError}`}
                >
                  gagal menghapus riwayat
                </span>
              )}
            </div>
          </div>
        )}
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
          {chatItems.map((item) => {
            // QA10-E: pemisah halus antara riwayat server & pesan sesi berjalan.
            if (item.kind === "sep") {
              return (
                <motion.div
                  key={item.key}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  role="separator"
                  aria-label="Riwayat sebelumnya — pesan di atasnya adalah riwayat tersimpan"
                  className="flex items-center gap-2 py-1"
                >
                  <span className="flex-1 h-px bg-slate-800/60" />
                  <span className="text-[9px] font-mono text-slate-500 whitespace-nowrap">
                    — riwayat sebelumnya —
                  </span>
                  <span className="flex-1 h-px bg-slate-800/60" />
                </motion.div>
              );
            }
            const msg = item.msg;
            return (
            <motion.div
              key={item.key}
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
                    {/* QA8-C: progressive markdown render — finished paragraphs
                        are memoized, the streaming tail stays raw with a
                        blinking caret (provided by StreamMarkdown). */}
                    <StreamMarkdown text={msg.content} isStreaming={msg.isStreaming} />
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
                        (msg.provider === "9router"
                          ? "text-amber-300 bg-amber-500/10 border-amber-500/25"
                          : msg.provider === "openrouter"
                            ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                            : msg.provider === "gemini"
                              ? "text-sky-300 bg-sky-500/10 border-sky-500/25"
                              : "text-slate-400 bg-slate-500/10 border-slate-600/30")
                      }
                      title={`Penyedia AI: ${msg.provider}${msg.model ? ` · model ${msg.model}` : ""}`}
                    >
                      {msg.provider === "9router" ? "🔥" : msg.provider === "openrouter" ? "⚡" : msg.provider === "gemini" ? "✦" : "•"} {msg.provider}
                      {msg.model ? ` · ${msg.model.split("/").pop()}` : ""}
                    </span>
                  )}
                  {msg.isFallback && (
                    <span className="text-[8px] text-amber-500 font-mono flex items-center gap-0.5">
                      <Zap className="w-2 h-2" /> fallback
                    </span>
                  )}
                  {msg.isStreaming && (
                    <span className="text-[8px] text-violet-400 font-mono flex items-center gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse" /> streaming
                    </span>
                  )}
                  {!msg.isStreaming && typeof msg.tokensUsed === "number" && msg.tokensUsed > 0 && (
                    <span
                      className="text-[8px] text-slate-500 font-mono"
                      title={`Konsumsi token: ${msg.tokensUsed}`}
                    >
                      · {msg.tokensUsed} tok
                    </span>
                  )}
                  {!msg.isStreaming && typeof msg.latencyMs === "number" && msg.latencyMs > 0 && (
                    <span className="text-[8px] text-slate-600 font-mono" title="Latensi respons">
                      · {(msg.latencyMs / 1000).toFixed(1)}s
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
            );
          })}
        </AnimatePresence>

        {/* Loading indicator — hidden once stream tokens are flowing
            (the streaming bubble + cursor replaces the three dots). */}
        {loading && !(messages.length > 0 && messages[messages.length - 1]?.isStreaming) && (
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
        /* QA8-C: the .zx-stream-cursor caret + blink keyframes now ship with
           <StreamMarkdown> so every streaming host can use them (identical
           rules, rendered via a de-duplicated hoisted <style> there). */}
      `}</style>
    </motion.div>
  );
}
