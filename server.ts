// FUNC-QA2: import "dotenv/config" HARUS menjadi import pertama.
// ESM mengevaluasi semua import sebelum body module — modul seperti
// src/server/dataRetention.ts memvalidasi ENCRYPTION_KEY saat module-load,
// sehingga .env wajib termuat SEBELUM import tersebut. Memanggil
// dotenv.config() di body (setelah import) selalu terlambat.
import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";

// SEC-BACKEND: security + auth + audit + API key storage.
import { applySecurityMiddleware, sanitizeError, authLimiter, apiNotFound } from "./src/server/security";
import { authRouter, requireAuth } from "./src/server/auth";
import { logAudit } from "./src/server/audit";
import { apiKeysRouter } from "./src/server/apiKeys";
// SEC2-INFRA: monitoring (Sentry)
import { initMonitoring, sentryErrorHandler } from "./src/server/monitoring";
// SEC3: WAF + data retention
import { wafMiddleware } from "./src/server/waf";
import { startDataRetentionJob } from "./src/server/dataRetention";
// OPT-3c: upstream API health checker (Binance/CoinGecko) — additive, runs in background.
import { startUpstreamHealthChecker } from "./src/server/upstreamHealth";
// QA3-F1: structured JSON logger (replaces ad-hoc console.* across the server).
// Variadic-compatible so the old call sites migrate mechanically; every line
// is one JSON object with ts/level/module/msg/data + universal secret
// redaction (emails → u***@, JWT/GitHub tokens → masked, sensitive keys →
// [REDACTED]). Also feeds an in-memory ring buffer exposed at
// GET /api/system/logs (requireAuth) for operator inspection.
import { createLogger, systemLogsRouter } from "./src/server/logger";

const log = createLogger("server");

// SEC2-INFRA: initialize Sentry/error monitoring early
initMonitoring();

// SEC3: start data retention background job (purges old audit logs, expired sessions/tokens)
startDataRetentionJob();

// OPT-3c: start the upstream API health checker (Binance/CoinGecko). Runs in
// the background — pings each upstream every 60s and records healthy/latency.
// Purely additive: no route is blocked based on health (handlers may consult
// `isUpstreamHealthy(name)` to short-circuit calls to known-down APIs).
startUpstreamHealthChecker();

const app = express();
// FIX-A-1: Global body limit lowered from 50mb to 100kb to prevent OOM DoS
// (an unauthenticated attacker could exhaust server memory by POSTing huge
// JSON bodies). The PDF routes (/api/gemini/analyze-pdf,
// /api/gemini/analyze-multi-pdf) legitimately need larger bodies, so they
// get a path-scoped express.json({ limit: "15mb" }) mounted BEFORE the
// global 100kb parser. body-parser explicitly skips parsing when req._body is
// already true (see body-parser lib/types/json.js "skip-if-already-parsed"),
// so the path-scoped 15mb parser runs first on those routes and the global
// 100kb parser becomes a no-op for them — no 413 for legitimate PDF uploads,
// and the global 100kb cap still applies to every other route.
app.use("/api/gemini/analyze-pdf", express.json({ limit: "15mb" }));
app.use("/api/gemini/analyze-multi-pdf", express.json({ limit: "15mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ limit: "100kb", extended: true }));

// SEC-BACKEND: install helmet + cors + cookie-parser + general rate limiter.
// This MUST come after express.json/urlencoded so the body is parsed before
// any auth handler runs, but BEFORE any route is mounted.
applySecurityMiddleware(app);

// SEC3: WAF middleware — blocks SQL injection, XSS, path traversal, attack tools.
// Runs AFTER security middleware (helmet/cors/rate-limit) but BEFORE routes.
app.use("/api", wafMiddleware);

// FIX-ALL H4: record per-request metrics (count / errors / latency) for the
// alerting subsystem. Mounted AFTER security + WAF so:
//   - WAF-blocked (403) + rate-limited (429) responses still get recorded
//     (their res "finish" event fires just like any other response).
//   - Vite HMR / static asset requests that bypass /api/* are NOT measured
//     (keeps the metrics focused on real API traffic).
import { requestMetricsMiddleware } from "./src/server/alerting";
app.use("/api", requestMetricsMiddleware);

const PORT = parseInt(process.env.PORT || "3000", 10);


// ===========================================================================
// QA9-R3 (round 9): FEATURE MODULE WIRING — monolith refactor.
// server.ts was a single 5.520-line file; all feature logic now lives in
// focused modules under src/server/ (see README round 9 for the map).
// The registration order below preserves the original Express semantics
// exactly: global middleware (mounted above) → feature routes in their
// original definition order → /api/trade auth gate → router mounts (below).
// ===========================================================================
import { refreshLiveAssets, registerAssetsRefreshHook } from "./src/server/assetsStore";
import { registerNotificationRoutes } from "./src/server/notifications";
import { registerMarketRoutes } from "./src/server/marketRoutes";
import { registerGeminiRoutes } from "./src/server/geminiRoutes";
import { registerSignalRoutes, updatePendingSignals, bootstrapRealTimeSignals } from "./src/server/signalEngine";
import { registerOnchainRoutes } from "./src/server/onchainStore";
import { registerAutomatedAnalysisRoutes } from "./src/server/automatedAnalysis";
import { registerNewsFxRoutes } from "./src/server/newsFxRoutes";
// QA10 (ronde #10): modul baru — DEX Radar (publik read-only), Paper Trading
// (self-mount requireAuth), AI memory/quota routes (self-mount requireAuth).
import { registerDexRoutes } from "./src/server/dexRoutes";
import { registerPaperTrading } from "./src/server/paperTrading";
import { registerPlanRoutes } from "./src/server/plans";
import { registerAiMemoryRoutes } from "./src/server/aiMemory";
// Boots the Binance Futures liquidation WS worker on import (was server.ts:3349).
import "./src/server/binanceDerivatives";

// — Live market data engine (was server.ts:746-761) —
// 2s background price refresh + one-shot boot sync. The signal engine
// subscribes through the hook registry (one-directional dep:
// signalEngine → assetsStore) instead of a direct call.
registerAssetsRefreshHook(updatePendingSignals);
setInterval(async () => {
  try {
    await refreshLiveAssets();
  } catch (err: any) {
    log.info("Background refresh live assets status:", err.message);
  }
}, 2000);

// Initialize price sync immediately on server boot
refreshLiveAssets().then(() => {
  log.info("Initial real-time Binance asset price synchronization complete on boot successfully.");
  bootstrapRealTimeSignals();
}).catch(err => {
  log.info("Initial backend boot synchronization alert handled:", err.message);
});

// — Feature routes, original definition order (was server.ts:801-5234) —
registerNotificationRoutes(app);       // /api/send-alert + /api/settings/notifications
registerMarketRoutes(app);             // /api/history, /api/assets(+register), /api/coins/*, /api/stocks/*
registerGeminiRoutes(app);             // /api/gemini/* (mounts its own requireAuth gate first)
registerSignalRoutes(app);             // /api/trading-signals/history + generate-manual
registerOnchainRoutes(app);            // /api/onchain/* (metrics, data, orderbook, altseason, oi, dominance, correlations)
registerAutomatedAnalysisRoutes(app);  // /api/gemini/automated-analysis(+trigger) — after the /api/gemini auth gate
registerNewsFxRoutes(app);             // /api/fx/usd-idr + /api/news
// QA10: rute fitur baru — dexRoutes publik read-only (seperti /api/assets);
// paperTrading & aiMemory self-mount requireAuth per-route (pola signalEngine).
registerDexRoutes(app);                // QA10-C: /api/dex/pairs + /api/dex/search
registerPaperTrading(app);             // QA10-B: /api/paper/* (order virtual market-only)
registerPlanRoutes(app);               // QA11-F: /api/account/plan (paket + kuota — Direksi F)
registerAiMemoryRoutes(app);           // QA10-E: /api/ai/history|models (memori percakapan)

// ===========================================================================
// SEC-BACKEND: protect sensitive trade endpoints with requireAuth.
// Both /api/trade/connect and /api/trade/execute accept real exchange API
// secrets and should NOT be callable by anonymous clients. The auth middleware
// reads the `zaytrix_session` cookie JWT and 401s if invalid/missing.
// ===========================================================================
app.use("/api/trade", requireAuth);

// ===========================================================================
// SEC2-DATA: /api/trade/connect and /api/trade/execute are now handled by the
// tradeExecutionRouter (mounted at /api/trade) which supports REAL signed order
// placement to Binance/Bybit/KuCoin when valid API keys are stored, with
// simulation fallback when no keys or sandbox mode. The old simulation-only
// routes below were removed to avoid route shadowing (Express runs the first
// matching handler, and these were defined before the new router mount).
// ===========================================================================



// ===========================================================================
// SEC-BACKEND: mount auth + API-key routers BEFORE the SPA catch-all.
// The auth router is mounted with the strict auth rate limiter (5/min/IP).
// The apiKeys router self-mounts requireAuth internally.
// The liveDataRouter (from another agent) is mounted opportunistically — if
// the file doesn't exist yet we log a one-liner and continue.
// ===========================================================================
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/user/api-keys", apiKeysRouter);

// QA3-F1: operator log viewer — ring buffer of redacted structured log lines.
// requireAuth: only authenticated sessions may read server logs (they may
// contain module names + operational context; never secrets — already
// redacted at emit time). GET params: ?limit=100&level=warn (min severity).
app.use("/api/system/logs", requireAuth, systemLogsRouter);

// SEC2-DATA: mount portfolio + real trade execution routers.
// Portfolio router self-mounts requireAuth. Trade execution router also self-mounts requireAuth.
try {
  const { portfolioRouter, startAlertChecker } = await import("./src/server/portfolio");
  app.use("/api/portfolio", portfolioRouter);
  // NEW FEATURE: start the background price-alert checker (polls Binance every 30s).
  startAlertChecker();
  log.info("[portfolio] router mounted successfully.");
} catch (e: any) {
  log.info("[portfolio] router not available:", e?.message || e);
}

try {
  const { tradeExecutionRouter } = await import("./src/server/tradeExecution");
  app.use("/api/trade", tradeExecutionRouter);
  log.info("[trade] execution router mounted successfully (replaces simulation-only routes).");
} catch (e: any) {
  log.info("[trade] execution router not available:", e?.message || e);
}

try {
  // Using a dynamic import guarded by a runtime feature check so a missing
  // module doesn't break boot. The module is loaded lazily.
  const liveDataModule: any = await import("./src/server/liveDataRoutes").catch(() => null);
  if (liveDataModule?.liveDataRouter) {
    app.use(liveDataModule.liveDataRouter);
    log.info("[liveData] router mounted successfully.");
  } else {
    log.info("[liveData] router not yet available — skipping (this is OK).");
  }
} catch (e: any) {
  log.info("[liveData] router not yet available:", e?.message || e);
}

// ===========================================================================
// PUBLIC DATA SOURCES — all free, no API key required (FRED, Alternative.me,
// Binance, Yahoo Finance, DefiLlama, CoinMetrics, GitHub Trending, etc.).
// ===========================================================================
try {
  const { publicDataRouter } = await import("./src/server/publicDataSources");
  app.use(publicDataRouter);
  log.info("[publicData] router mounted successfully.");
} catch (e: any) {
  log.info("[publicData] router not yet available:", e?.message || e);
}

// ─── AI Router (OpenRouter primary + Gemini fallback) ────────────────────
try {
  const { callAI, callAIStream, getAIUsage, getAIProviderHealth, testOpenRouterConnection, test9RouterConnection, getUserAiQuota } = await import("./src/server/aiRouter");
  const { getRecentChatHistory, saveChatMessage, CHAT_CONTEXT_LIMIT } = await import("./src/server/aiMemory");

  // GET /api/ai/health — AI provider health status (public, for monitoring)
  app.get("/api/ai/health", (req, res) => {
    res.json({ success: true, health: getAIProviderHealth() });
  });

  // POST /api/ai/test — test AI connectivity (requireAuth)
  app.post("/api/ai/test", requireAuth, async (req: any, res) => {
    // Try 9router first, then OpenRouter.
    const nineResult = await test9RouterConnection();
    const orResult = await testOpenRouterConnection();
    res.json({
      success: nineResult.success || orResult.success,
      nineRouter: nineResult,
      openRouter: orResult,
      error: nineResult.success ? undefined : orResult.error,
    });
  });

  // POST /api/ai/chat — generic AI chat with automatic fallback
  app.post("/api/ai/chat", requireAuth, async (req: any, res) => {
    const { prompt, systemPrompt, maxTokens, temperature, model } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: "Prompt wajib diisi." });
    // Prevent token-cost DoS via oversized prompts.
    if (typeof prompt === "string" && prompt.length > 32000) {
      return res.status(400).json({ success: false, error: "Prompt terlalu panjang. Maks 32.000 karakter." });
    }

    const result = await callAI({
      prompt,
      systemPrompt,
      maxTokens,
      temperature,
      model, // QA10-E: pilihan model user (divalidasi aiRouter — invalid → default jujur)
      userId: req.user?.sub,
      endpoint: "chat",
    });

    res.json(result);
  });

  // POST /api/ai/chat-stream — QA7-F1: token-by-token SSE streaming chat.
  // Same auth + prompt contract as /api/ai/chat; response is an
  // text/event-stream of JSON events: {type:"start"|"token"|"done"|"error", ...}.
  // Client disconnect aborts the upstream OpenRouter fetch (no orphan streams).
  // QA10-E (ronde #10): + model pilihan user + kuota harian (429 JSON sebelum
  // stream dimulai) + memori percakapan (16 pesan terakhir sebagai konteks;
  // pesan user & asisten disimpan HANYA saat stream tuntas — teks parsial
  // akibat putus di tengah TIDAK pernah masuk memori).
  app.post("/api/ai/chat-stream", requireAuth, async (req: any, res) => {
    const { prompt, systemPrompt, maxTokens, temperature, model } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: "Prompt wajib diisi." });
    // Prevent token-cost DoS via oversized prompts.
    if (typeof prompt === "string" && prompt.length > 32000) {
      return res.status(400).json({ success: false, error: "Prompt terlalu panjang. Maks 32.000 karakter." });
    }

    // QA10-E: kuota AI harian per-user (QA11-F: batas kini PLAN-AWARE).
    // getUserAiQuota fail-open JUJUR (userId kosong / DB error → unlimited:true)
    // sehingga counting bug tidak pernah mematikan chat — hanya kuota
    // benar-benar tercapai yang menolak (429).
    const quota = await getUserAiQuota(req.user?.sub);
    if (!quota.unlimited && quota.used >= quota.limit) {
      return res.status(429).json({
        success: false,
        error: `Kuota AI harian paket ${quota.plan.toUpperCase()} tercapai (${quota.used}/${quota.limit}). Kuota reset otomatis setiap tengah malam UTC. Paket lebih tinggi (PRO/TEAM) dinaikkan oleh operator — lihat Settings Hub → Paket & Kuota.`,
        quota,
      });
    }

    // QA10-E: muat riwayat terbaru sebagai konteks. Gagal DB → [] (helper)
    // — chat tetap jalan tanpa memori, jangan crash.
    const history = await getRecentChatHistory(req.user?.sub, CHAT_CONTEXT_LIMIT);
    const historyLines = history
      .map((m) => `${m.role === "assistant" ? "Asisten" : "Pengguna"}: ${String(m.content).slice(0, 2000)}`)
      .join("\n");
    const contextualPrompt = historyLines
      ? `Riwayat percakapan sebelumnya (konteks — jangan ulangi isinya, jawab pertanyaan terbaru):
${historyLines}

---
Pertanyaan terbaru:
${prompt}`
      : prompt;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (Caddy/nginx) so tokens arrive immediately.
      "X-Accel-Buffering": "no",
    });

    let clientClosed = false;
    const clientAbort = new AbortController();
    req.on("close", () => {
      clientClosed = true;
      clientAbort.abort();
    });

    const send = (obj: unknown) => {
      if (clientClosed || res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      } catch {
        clientClosed = true;
      }
    };

    // Keep-alive comment every 15s so proxies don't time the stream out
    // while the model is thinking (first token can take seconds).
    const keepAlive = setInterval(() => {
      if (clientClosed || res.writableEnded) return;
      try {
        res.write(": keep-alive\n\n");
      } catch {
        clientClosed = true;
      }
    }, 15_000);

    try {
      // QA10-E: akumulasi teks + model final — event "done" tidak membawa
      // teks penuh, jadi route mengumpulkan token untuk disimpan ke memori.
      let fullText = "";
      let doneReceived = false;
      let finalModel: string | undefined;
      await callAIStream(
        {
          prompt: contextualPrompt,
          systemPrompt,
          maxTokens,
          temperature,
          model, // QA10-E: pilihan model user (divalidasi aiRouter — invalid → default jujur)
          userId: req.user?.sub,
          endpoint: "chat-stream",
          abortSignal: clientAbort.signal,
        },
        (ev) => {
          send(ev);
          if (ev && typeof ev === "object") {
            if (ev.type === "token" && typeof ev.text === "string") fullText += ev.text;
            if (ev.type === "done") {
              doneReceived = true;
              finalModel = typeof ev.model === "string" ? ev.model : undefined;
            }
          }
        }
      );
      // QA10-E: simpan ke memori HANYA bila stream tuntas (event done)
      // DAN klien masih terhubung (abort → teks parsial tidak pernah disimpan).
      if (doneReceived && !clientClosed && fullText.trim()) {
        saveChatMessage(req.user?.sub, "user", prompt);
        saveChatMessage(req.user?.sub, "assistant", fullText, finalModel);
      }
    } catch (e: any) {
      send({ type: "error", error: String(e?.message || e).substring(0, 150) });
    } finally {
      clearInterval(keepAlive);
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {}
      }
    }
  });

  // GET /api/ai/usage — QA7-F2: operator token/cost usage panel data
  // (requireAuth — no admin gate: the panel lives in each user's Settings;
  // records contain NO prompt content, only metadata).
  app.get("/api/ai/usage", requireAuth, (_req: any, res) => {
    res.json({ success: true, usage: getAIUsage() });
  });

  log.info("[aiRouter] OpenRouter + Gemini fallback endpoints mounted (chat, chat-stream SSE, usage).");
} catch (e: any) {
  log.info("[aiRouter] not available:", e?.message || e);
}

// 404 for unmatched /api/* — must come BEFORE the SPA catch-all so unknown API
// calls get JSON instead of the SPA HTML.
// SEC3: Health check + metrics endpoint (for monitoring/uptime checks)
// FIX-ALL L6: the public /api/health endpoint leaks sensitive operational
// metrics (auth_failures, rate_limit_hits, latency profile, alert rule names).
// We now expose only uptime + a coarse status from the unauthenticated
// endpoint (enough for uptime checks / load balancer probes). Detailed
// metrics require authentication via /api/health/detailed (requireAuth).
import { startAlerting, getHealthMetrics } from "./src/server/alerting";
startAlerting();
app.get("/api/health", (_req, res) => {
  const metrics = getHealthMetrics();
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    // Public subset — safe to expose to anyone (uptime monitors, LB probes).
    uptime_ms: metrics.uptime_ms,
  });
});

// Detailed metrics endpoint — requires authentication so an anonymous attacker
// cannot probe auth_failures / rate_limit_hits / alert rule names for recon.
app.get("/api/health/detailed", requireAuth, (_req, res) => {
  res.json({ success: true, status: "healthy", timestamp: new Date().toISOString(), metrics: getHealthMetrics() });
});

// SEC3: GDPR data export + deletion endpoints (requireAuth)
app.get("/api/user/export", requireAuth, async (req: any, res) => {
  try {
    const { exportUserData } = await import("./src/server/dataRetention");
    const data = await exportUserData(req.user.sub);
    await logAudit(req.user.sub, "DATA_EXPORT", req, true);
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal mengekspor data." });
  }
});

app.delete("/api/user/delete-all", requireAuth, async (req: any, res) => {
  try {
    const { deleteAllUserData } = await import("./src/server/dataRetention");
    await deleteAllUserData(req.user.sub);
    await logAudit(req.user.sub, "ACCOUNT_DELETED", req, true);
    res.clearCookie("zaytrix_session");
    res.json({ success: true, message: "Akun dan semua data telah dihapus permanen." });
  } catch (e: any) {
    res.status(500).json({ success: false, error: "Gagal menghapus akun." });
  }
});

app.use("/api", apiNotFound);

// Setup dev and production modes
async function startServer() {
  // QA5-1: create the HTTP server object up-front so the dev-mode Vite HMR
  // websocket can attach to the SAME origin/port (hmr.server). Previously,
  // middleware-mode Vite silently opened a SECOND listener on :24678 — so two
  // concurrent dev instances (e.g. the long-running :4100 + the smoke test's
  // self-booted :4180) fought over that single port, and the second
  // instance's browser client failed with "[vite] failed to connect to
  // websocket (WebSocket closed without opened)" (smoke FAIL: 2 console
  // errors). Same-origin HMR also works behind a reverse proxy that forwards
  // a single port, and removes an unnecessary open port from the process.
  const httpServer = http.createServer(app);
  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // SEC-BACKEND: block bundled server source + sourcemap from public access.
    // Uses middleware (not route matching) because Express route paths
    // do NOT match URL-encoded variants like /server%2Emjs.
    // Middleware runs BEFORE express.static so blocked requests get
    // 404 before static/file serving is attempted.
    app.use((req, res, next) => {
      try {
        // Decode URL to catch encoded bypasses like /server%2emjs or /server.mjs%2emap
        // Express req.path is NOT decoded, so we decode req.url manually.
        const decodedPath = decodeURIComponent(req.url || "").split("?")[0];
        const cleaned = decodedPath.replace(/\/+/g, "/");
        if (cleaned === "/server.mjs" || cleaned === "/server.mjs.map") {
          return res.status(404).json({ success: false, error: "Endpoint tidak ditemukan." });
        }
      } catch {
        // Malformed encoding — let Express handle the error path safely
      }
      next();
    });
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // SEC-BACKEND: FINAL error handler — must be registered AFTER every route
  // and AFTER the SPA catch-all so it intercepts errors thrown anywhere in the
  // pipeline. It never leaks err.message to the client in production.
  // FIX-ALL M3: Sentry's Express error handler is mounted FIRST so it can
  // capture the error (with request context) before sanitizeError sends the
  // generic response. If SENTRY_DSN is unset, sentryErrorHandler() returns a
  // no-op pass-through, so this is always safe.
  app.use(sentryErrorHandler(app));
  app.use(sanitizeError);

  // OPT-1d: graceful shutdown — drain in-flight requests before exit, then
  // disconnect Prisma. Prevents abrupt WebSocket drops + cancelled requests
  // when the process receives SIGTERM (container stop) or SIGINT (Ctrl-C).
  const server = httpServer.listen(PORT, "0.0.0.0", () => {
    log.info(`Financial Modelling Server running on port ${PORT}`);
  });

  // OPT-1e: 30s hard socket timeout — guards against slow/hanging HTTP
  // requests holding connections indefinitely (Express Server.setTimeout).
  server.setTimeout(30000);

  function gracefulShutdown(signal: string) {
    log.info(`[${signal}] Graceful shutdown initiated...`);
    server.close(() => {
      log.info("[shutdown] HTTP server closed. Draining DB pool...");
      // Lazy-import Prisma to avoid loading it at boot if unused.
      import("./src/server/db")
        .then(({ prisma }) => prisma.$disconnect())
        .finally(() => {
          log.info("[shutdown] Complete. Exiting.");
          process.exit(0);
        });
    });
    // Force exit after 10s if graceful close hangs (stuck socket / slow client)
    setTimeout(() => {
      log.error("[shutdown] Force exit (timeout)");
      process.exit(1);
    }, 10000).unref();
  }
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer();

