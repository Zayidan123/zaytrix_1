/**
 * Webhook Service - Real-Time Multi-Channel Siren System (Telegram, Discord, WhatsApp)
 * 
 * This service securely dispatches financial alerts and alarm trigger indicators
 * to external social media/messaging environments using backend relay proxies.
 */

export interface WebhookPayload {
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  discordEnabled: boolean;
  discordWebhookUrl: string;
  whatsappEnabled: boolean;
  whatsappWebhookUrl: string;
  whatsappPhoneNumber: string;
  messageText: string;
}

export interface WebhookResult {
  success: boolean;
  results?: {
    telegram?: { success: boolean; error?: string };
    discord?: { success: boolean; error?: string };
    whatsapp?: { success: boolean; error?: string };
  };
  error?: string;
}

/**
 * Dispatches an alert message to enabled and configured channels securely.
 */
export async function sendAlertSecurely(payload: WebhookPayload): Promise<WebhookResult> {
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
  } = payload;

  // Safeguard: Only issue fetch if at least one channel is active
  if (!telegramEnabled && !discordEnabled && !whatsappEnabled) {
    return { success: false, error: "Tidak ada saluran notifikasi yang diaktifkan." };
  }

  try {
    const res = await fetch("/api/send-alert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        telegramEnabled,
        telegramBotToken,
        telegramChatId,
        discordEnabled,
        discordWebhookUrl,
        whatsappEnabled,
        whatsappWebhookUrl,
        whatsappPhoneNumber,
        messageText,
      }),
    });

    if (!res.ok) {
      throw new Error(`Server backend merespons dengan kode status HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      success: data.success,
      results: data.results,
    };
  } catch (err: any) {
    console.error("Gagal mengirimkan alert eksternal via WebhookService:", err);
    return {
      success: false,
      error: err.message || String(err),
    };
  }
}
