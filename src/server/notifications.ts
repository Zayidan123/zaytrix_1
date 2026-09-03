// =============================================================================
// notifications.ts — QA9-R3: multi-channel alerting — /api/send-alert
// (server-side webhook relay w/ SSRF allowlist), per-user notification
// configs (persisted to notifications-config.json), Telegram sender, the
// background on-chain alert daemon, and /api/settings/notifications.
// Extracted verbatim from server.ts (was 801-964, 2964-3088, 3095-3267).
// =============================================================================
import fs from "fs";
import path from "path";
import type { Express } from "express";
import { fetchWithTimeout } from "./httpUtils";
import { requireAuth } from "./auth";
import { validateOutboundWebhookUrl } from "./ssrfGuard";
import { fetchLatestOnChainData } from "./onchainStore";
import { isValidOnChainTransaction } from "../../onchainDataHelper";
import { createLogger } from "./logger";

const log = createLogger("notifications");





export function registerNotificationRoutes(app: Express): void {
app.post("/api/send-alert", requireAuth, async (req, res) => {
  const {
    telegramEnabled,
    telegramBotToken,
    telegramChatId,
    discordEnabled,
    discordWebhookUrl,
    whatsappEnabled,
    whatsappWebhookUrl,
    whatsappPhoneNumber,
    messageText
  } = req.body;

  // FIX-A-2: never log the raw bot token — log only whether one was supplied.
  log.info("[send-alert] bot token:", telegramBotToken ? "[REDACTED]" : "(none)");
  log.info(`[send-alert] authenticated user: ${req.user?.email || req.user?.sub || "(unknown)"}`);

  // SEC-2: validate every outbound webhook URL BEFORE anything is sent.
  // Non-allowlisted hosts / non-HTTPS schemes are rejected with 400.
  if (discordEnabled && (discordWebhookUrl || "").trim()) {
    const guard = validateOutboundWebhookUrl((discordWebhookUrl || "").trim());
    if (!guard.ok) {
      return res.status(400).json({ success: false, error: guard.reason });
    }
  }
  if (whatsappEnabled && (whatsappWebhookUrl || "").trim()) {
    const guard = validateOutboundWebhookUrl((whatsappWebhookUrl || "").trim());
    if (!guard.ok) {
      return res.status(400).json({ success: false, error: guard.reason });
    }
  }

  const results: Record<string, { success: boolean; error?: string }> = {};

  // 1. Telegram
  if (telegramEnabled) {
    const rawBotToken = (telegramBotToken || "").trim();
    const rawChatId = (telegramChatId || "").trim();

    if (!rawBotToken || !rawChatId) {
      results.telegram = { 
        success: false, 
        error: "Konfigurasi belum lengkap: Bot Token dan Chat ID wajib diisi." 
      };
    } else {
      // Defensive parsing: strip out duplicate 'bot' prefix if pasted by accident
      let sanitizedToken = rawBotToken;
      if (sanitizedToken.toLowerCase().startsWith("bot")) {
        sanitizedToken = sanitizedToken.slice(3).trim();
      }

      // Convert chat_id to a number if it is purely numeric, since Telegram's API
      // is most reliable with real numeric types for specific group and personal chat IDs.
      let finalChatId: string | number = rawChatId;
      if (/^-?\d+$/.test(rawChatId)) {
        finalChatId = parseInt(rawChatId, 10);
      }

      try {
        const cleanMsg = (messageText || "").replace(/\*\*/g, "");
        const telegramUrl = `https://api.telegram.org/bot${sanitizedToken}/sendMessage`;
        
        log.info(`[TELEGRAM SENDER] Sending to chatId ${finalChatId} via URL (identity masked)`);
        
        const response = await fetch(telegramUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            chat_id: finalChatId, 
            text: `🤖 [ZAYTRIX BOT]\n${cleanMsg}` 
          })
        });

        if (response.ok) {
          results.telegram = { success: true };
          log.info(`[TELEGRAM SENDER] Successfully dispatched message to ${finalChatId}`);
        } else {
          // SEC-2: log the full upstream body server-side only; the client
          // gets a generic message so upstream/internal details never leak.
          const text = await response.text();
          log.error(`[TELEGRAM SENDER ERROR] Status ${response.status}: ${text}`);
          results.telegram = {
            success: false,
            error: `Gagal mengirim alert (Telegram HTTP ${response.status})`
          };
        }
      } catch (e: any) {
        log.error("[TELEGRAM SENDER ROUTING EXCEPTION]", e);
        results.telegram = { success: false, error: "Gagal mengirim alert" };
      }
    }
  }

  // 2. Discord
  if (discordEnabled) {
    const rawUrl = (discordWebhookUrl || "").trim();
    if (!rawUrl) {
      results.discord = { success: false, error: "Konfigurasi belum lengkap: URL Webhook Discord wajib diisi." };
    } else {
      try {
        const response = await fetch(rawUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `🔔 **[ZAYTRIX ALARM]** \n${messageText}` })
        });
        if (response.ok) {
          results.discord = { success: true };
        } else {
          // SEC-2: never echo the upstream response body to the client;
          // log details server-side and return a generic error.
          const text = await response.text();
          log.error(`[DISCORD SENDER ERROR] Status ${response.status}: ${text}`);
          results.discord = { success: false, error: "Gagal mengirim alert" };
        }
      } catch (e: any) {
        log.error("[DISCORD SENDER ROUTING EXCEPTION]", e);
        results.discord = { success: false, error: "Gagal mengirim alert" };
      }
    }
  }

  // 3. WhatsApp
  if (whatsappEnabled) {
    const rawUrl = (whatsappWebhookUrl || "").trim();
    const rawPhone = (whatsappPhoneNumber || "").trim();
    if (!rawUrl) {
      results.whatsapp = { success: false, error: "Konfigurasi belum lengkap: URL Webhook WhatsApp wajib diisi." };
    } else {
      try {
        const payloadBody = {
          message: messageText,
          text: messageText,
          phone: rawPhone,
          to: rawPhone,
          number: rawPhone,
          recipient: rawPhone,
          whatsapp: rawPhone
        };
        const response = await fetch(rawUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBody)
        });
        if (response.ok) {
          results.whatsapp = { success: true };
        } else {
          // SEC-2: never echo the upstream response body to the client;
          // log details server-side and return a generic error.
          const text = await response.text();
          log.error(`[WHATSAPP SENDER ERROR] Status ${response.status}: ${text}`);
          results.whatsapp = { success: false, error: "Gagal mengirim alert" };
        }
      } catch (e: any) {
        log.error("[WHATSAPP SENDER ROUTING EXCEPTION]", e);
        results.whatsapp = { success: false, error: "Gagal mengirim alert" };
      }
    }
  }

  res.json({ success: true, results });
});

// Daily candle history — REAL data only (DATA-2). Crypto symbols try Binance
// klines FIRST, then the Yahoo chart API; stocks use Yahoo (.JK). When every

// REAL-TIME ON-CHAIN DATA TERMINAL BACKEND DECODER WITH ACTIVE SERVER-SIDE BACKGROUND DAEMON
interface SavedNotificationConfig {
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  discordEnabled: boolean;
  discordWebhookUrl: string;
  whatsappEnabled: boolean;
  whatsappWebhookUrl: string;
  whatsappPhoneNumber: string;
}

// SEC-8: notification configs are now keyed PER-USER (userId -> config) so
// one authenticated user can no longer read/overwrite another user's bot
// tokens via a shared global config. Legacy flat config files are loaded
// under the "legacy" key so existing setups keep working.
const notificationConfigs = new Map<string, SavedNotificationConfig>();

// SEC-8: secret redaction helper for logs — masks the middle of a secret,
// e.g. "123456:AAF-f9xyz..." -> "1234****yz...".
function redactSecret(value: string): string {
  const v = (value || "").trim();
  if (!v) return "(none)";
  if (v.length <= 8) return "****";
  return `${v.substring(0, 4)}****${v.substring(v.length - 4)}`;
}

const CONFIG_FILE_PATH = path.join(process.cwd(), "notifications-config.json");

// SEC-8: persist the per-user config map to disk (mode 0o600 — the file
// contains bot tokens / webhook URLs).
function persistNotificationConfigs(): void {
  try {
    const payload: any = { users: {} };
    notificationConfigs.forEach((cfg, userId) => {
      payload.users[userId] = cfg;
    });
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });
  } catch (e: any) {
    log.info("[On-Chain Data Background] Failed to save config file:", e.message);
  }
}

// Read initial config on boot if exists
try {
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    const fileData = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
    const parsed = JSON.parse(fileData);
    if (parsed && typeof parsed === "object" && parsed.users && typeof parsed.users === "object") {
      Object.entries(parsed.users).forEach(([userId, cfg]: [string, any]) => {
        if (cfg && typeof cfg === "object") notificationConfigs.set(userId, cfg);
      });
    } else if (parsed && typeof parsed === "object") {
      // Legacy flat format (pre-SEC-8 single global config) — kept working
      // under the "legacy" key.
      notificationConfigs.set("legacy", parsed);
    }
    // SEC-8: redacted boot log — the old log printed the whole config object
    // (bot tokens + webhook URLs) in PLAINTEXT. Every secret is now masked.
    log.info("[On-Chain Data Background] Loaded notifications config on boot for", notificationConfigs.size, "user(s):",
      Array.from(notificationConfigs.entries()).map(([uid, cfg]) => ({
        user: uid,
        telegramEnabled: !!cfg.telegramEnabled,
        telegramBotToken: redactSecret(cfg.telegramBotToken || ""),
        telegramChatId: cfg.telegramChatId ? "[REDACTED]" : "(none)",
        discordEnabled: !!cfg.discordEnabled,
        discordWebhookUrl: cfg.discordWebhookUrl ? "[REDACTED]" : "(none)",
        whatsappEnabled: !!cfg.whatsappEnabled,
        whatsappWebhookUrl: cfg.whatsappWebhookUrl ? "[REDACTED]" : "(none)"
      }))
    );
  }
} catch (e: any) {
  log.info("[On-Chain Data Background] Failed to load config on boot:", e.message);
}

// Telegram alert standalone sender helper
async function sendTelegramAlert(botToken: string, chatId: string, message: string): Promise<{ success: boolean; error?: string }> {
  const rawBotToken = (botToken || "").trim();
  const rawChatId = (chatId || "").trim();

  if (!rawBotToken || !rawChatId) {
    return { success: false, error: "Konfigurasi belum lengkap: Bot Token dan Chat ID wajib diisi." };
  }

  let sanitizedToken = rawBotToken;
  if (sanitizedToken.toLowerCase().startsWith("bot")) {
    sanitizedToken = sanitizedToken.slice(3).trim();
  }

  let finalChatId: string | number = rawChatId;
  if (/^-?\d+$/.test(rawChatId)) {
    finalChatId = parseInt(rawChatId, 10);
  }

  try {
    const cleanMsg = (message || "").replace(/\*\*/g, "");
    const telegramUrl = `https://api.telegram.org/bot${sanitizedToken}/sendMessage`;
    
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        chat_id: finalChatId, 
        text: `🤖 [ZAYTRIX BOT]\n${cleanMsg}` 
      })
    });

    if (response.ok) {
      return { success: true };
    } else {
      const text = await response.text();
      let parsedError = "";
      try {
        const json = JSON.parse(text);
        parsedError = json.description || text;
      } catch {
        parsedError = text;
      }
      return { success: false, error: `API Telegram (HTTP ${response.status}): ${parsedError}` };
    }
  } catch (e: any) {
    return { success: false, error: `Kegagalan rute jaringan: ${e.message || String(e)}` };
  }
}

// Background Alerting Engine State
const notifiedTxHashes = new Set<string>();
let isFirstAlertScan = true;

async function runBackgroundOnChainAlerts() {
  // SEC-8: run the scan + alert cycle for EVERY configured user (per-user
  // configs) instead of one shared global config.
  for (const [userId, cfg] of Array.from(notificationConfigs.entries())) {
    try {
      await runBackgroundOnChainAlertsForUser(userId, cfg);
    } catch (userErr: any) {
      log.error(`[Background On-Chain Alert] (${userId}) scan failed:`, userErr.message);
    }
  }
}

async function runBackgroundOnChainAlertsForUser(userId: string, userConfig: SavedNotificationConfig) {
  if (!userConfig.telegramEnabled) {
    return;
  }
  const token = userConfig.telegramBotToken.trim();
  const chatId = userConfig.telegramChatId.trim();
  if (!token || !chatId) {
    return;
  }

  log.info(`[Background On-Chain Alert] (${userId}) Scanning for highly specific large on-chain transactions for Telegram bot: ${redactSecret(token)}`);
  try {
    const { processedTxs } = await fetchLatestOnChainData();

    if (isFirstAlertScan) {
      log.info(`[Background On-Chain Alert] First scan after boot. Registering ${processedTxs?.length || 0} existing transactions to prevent notification storms.`);
      if (processedTxs && Array.isArray(processedTxs)) {
        for (const tx of processedTxs) {
          if (tx && tx.txhash) {
            notifiedTxHashes.add(tx.txhash);
          }
        }
      }
      isFirstAlertScan = false;
      return;
    }

    const stablecoins = ["USDT", "USDC", "BUSD", "DAI", "FDUSD", "USDE", "PYUSD", "TUSD", "USDD"];

    for (const tx of processedTxs) {
      const coinUpper = (tx.coin || "").toUpperCase();
      let threshold = 10000000; // Default Altcoin threshold: $10,000,000
      let category = "Altcoin";
      let meetsFilter = false;

      if (coinUpper === "BTC" || coinUpper === "WBTC") {
        threshold = 1000000;
        category = "Bitcoin (BTC)";
        meetsFilter = tx.usdAmount > 1000000;
      } else if (coinUpper === "ETH" || coinUpper === "WETH") {
        threshold = 15000000;
        category = "Ethereum (ETH)";
        meetsFilter = tx.usdAmount > 15000000;
      } else if (stablecoins.includes(coinUpper)) {
        threshold = 10000000;
        category = "Stablecoin";
        meetsFilter = tx.usdAmount >= 10000000;
      } else {
        threshold = 10000000;
        category = `Altcoin (${tx.coin})`;
        meetsFilter = tx.usdAmount >= 10000000;
      }

      if (meetsFilter && isValidOnChainTransaction(tx)) {
        if (!notifiedTxHashes.has(tx.txhash)) {
          notifiedTxHashes.add(tx.txhash);

          // Build message matching telegram alerts standard format perfectly!
          const directionEmoji = tx.direction === "Unknown to Exchange" ? "📥 BEARISH INFLOW" : tx.direction === "Exchange to Unknown" ? "📤 BULLISH OUTFLOW" : "🔄 TRANSFER";
          const formattedMsg = `🚨 *LARGE ON-CHAIN TRANSACTION DETECTED* 🚨\n` +
            `*Status: Terfilter Spesifik (1x Transaksi)*\n\n` +
            `• Kategori: *${category}*\n` +
            `• Threshold Filter: *>= $${(threshold / 1000000).toLocaleString("id-ID")}M USD*\n` +
            `• Aset & Jaringan: *${tx.coin} (${tx.blockchain})*\n` +
            `• Jumlah Transaksi: *${tx.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tx.coin}*\n` +
            `• Nilai USD: *$${tx.usdAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD*\n` +
            `• Aliran: *${tx.sourceName}* ➔ *${tx.destName}*\n` +
            `• Arah Aliran: *${directionEmoji}*\n` +
            `• Klasifikasi: *${tx.classification}*\n` +
            `• TXID: \`${tx.txhash.substring(0, 16)}...\`\n\n` +
            `🔗 [Detail Transaksi (Explorer)](${tx.explorerUrl})`;

          log.info(`[Background On-Chain Alert] Sending alert for hash ${tx.txhash} to Telegram (Category: ${category}, Threshold: $${threshold})...`);
          const sendRes = await sendTelegramAlert(token, chatId, formattedMsg);
          if (!sendRes.success) {
            log.error(`[Background On-Chain Alert] Failed to send to Telegram: ${sendRes.error}`);
          }
          // Sleep for 1.5 seconds to respect Telegram Chat Bot rate limit of 1 message/second
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }

    // Keep memory clean
    if (notifiedTxHashes.size > 500) {
      const hashesArray = Array.from(notifiedTxHashes);
      notifiedTxHashes.clear();
      hashesArray.slice(-100).forEach(h => notifiedTxHashes.add(h));
    }
  } catch (err: any) {
    log.error("[Background On-Chain Alert] Worker execution error:", err.message);
  }
}

// Start persistent server-side background interval alert scanner (every 45 seconds)
setInterval(() => {
  runBackgroundOnChainAlerts().catch(err => {
    log.error("[Background On-Chain Alert] Interval worker caught unhandled promise:", err);
  });
}, 45000);

// Endpoint to synchronize notification settings from front-end
// FIX-A-3: previously public — anonymous attacker could overwrite the user's
// notification config + bot tokens written to disk with default (world-readable)
// file perms. Now gated by `requireAuth`, file perms set to 0o600, and the
// response no longer echoes back secrets (bot token / webhook URLs / phone).
app.post("/api/settings/notifications", requireAuth, (req, res) => {
  try {
    const {
      telegramEnabled,
      telegramBotToken,
      telegramChatId,
      discordEnabled,
      discordWebhookUrl,
      whatsappEnabled,
      whatsappWebhookUrl,
      whatsappPhoneNumber
    } = req.body;
    // SEC-8: the config is stored PER AUTHENTICATED USER — the old global
    // `activeNotificationConfig` let any authenticated user overwrite (and
    // effectively read) every other user's bot tokens / webhooks.
    const userId = String(req.user?.sub || req.user?.email || "unknown");
    const newConfig: SavedNotificationConfig = {
      telegramEnabled: !!telegramEnabled,
      telegramBotToken: telegramBotToken || "",
      telegramChatId: telegramChatId || "",
      discordEnabled: !!discordEnabled,
      discordWebhookUrl: discordWebhookUrl || "",
      whatsappEnabled: !!whatsappEnabled,
      whatsappWebhookUrl: whatsappWebhookUrl || "",
      whatsappPhoneNumber: whatsappPhoneNumber || ""
    };
    notificationConfigs.set(userId, newConfig);
    persistNotificationConfigs();
    // FIX-A-3 + SEC-8: do NOT log secrets — log only flags + redacted presence.
    log.info("[On-Chain Data Background] Settings saved for user:", userId,
      "| telegram:", newConfig.telegramEnabled,
      "| discord:", newConfig.discordEnabled,
      "| whatsapp:", newConfig.whatsappEnabled,
      "| botToken:", newConfig.telegramBotToken ? "[REDACTED]" : "(none)");
    // FIX-A-3: redact secrets in the response — never echo bot token / webhook
    // URLs / phone back to the client.
    const redactedConfig = {
      telegramEnabled: newConfig.telegramEnabled,
      telegramBotToken: newConfig.telegramBotToken ? "[REDACTED]" : "",
      telegramChatId: newConfig.telegramChatId,
      discordEnabled: newConfig.discordEnabled,
      discordWebhookUrl: newConfig.discordWebhookUrl ? "[REDACTED]" : "",
      whatsappEnabled: newConfig.whatsappEnabled,
      whatsappWebhookUrl: newConfig.whatsappWebhookUrl ? "[REDACTED]" : "",
      whatsappPhoneNumber: newConfig.whatsappPhoneNumber ? "[REDACTED]" : ""
    };
    return res.json({ success: true, config: redactedConfig });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
} // end registerNotificationRoutes

