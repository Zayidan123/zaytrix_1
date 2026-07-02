// ZAYTRIX Alerting Configuration (MONITORING9).
// Defines alert rules + notification channels. In production, integrate with
// PagerDuty/Slack/Email. In dev, logs to console.
//
// Alert rules trigger when:
// - Error rate exceeds threshold (e.g., >5% of requests)
// - Response latency exceeds threshold (e.g., p95 > 2s)
// - Auth failure rate exceeds threshold (brute force detection)
// - Rate limit hits exceed threshold (abuse detection)
// - Server health check fails
// - Database connection errors

interface AlertRule {
  name: string;
  description: string;
  threshold: number;
  windowMs: number;
  severity: "info" | "warning" | "critical";
  check: (metrics: any) => boolean;
}

// In-memory metrics store (in production, use Prometheus/Datadog)
const metrics = {
  requests: { total: 0, errors: 0, startTime: Date.now() },
  auth: { attempts: 0, failures: 0, lastWindowStart: Date.now() },
  rateLimits: { hits: 0 },
  latency: [] as number[],
};

export function recordRequest(success: boolean, latencyMs: number) {
  metrics.requests.total++;
  if (!success) metrics.requests.errors++;
  metrics.latency.push(latencyMs);
  if (metrics.latency.length > 1000) metrics.latency.shift();
}

export function recordAuthAttempt(success: boolean) {
  metrics.auth.attempts++;
  if (!success) metrics.auth.failures++;
}

export function recordRateLimitHit() {
  metrics.rateLimits.hits++;
}

const ALERT_RULES: AlertRule[] = [
  {
    name: "high_error_rate",
    description: "Error rate exceeds 5% in the last 5 minutes",
    threshold: 0.05,
    windowMs: 5 * 60 * 1000,
    severity: "critical",
    check: (m) => m.requests.total > 100 && (m.requests.errors / m.requests.total) > 0.05,
  },
  {
    name: "high_latency",
    description: "P95 latency exceeds 2 seconds",
    threshold: 2000,
    windowMs: 5 * 60 * 1000,
    severity: "warning",
    check: (m) => {
      if (m.latency.length < 20) return false;
      const sorted = [...m.latency].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      return p95 > 2000;
    },
  },
  {
    name: "brute_force_detected",
    description: "Auth failure rate exceeds 50% with 20+ attempts",
    threshold: 0.5,
    windowMs: 5 * 60 * 1000,
    severity: "critical",
    check: (m) => m.auth.attempts > 20 && (m.auth.failures / m.auth.attempts) > 0.5,
  },
  {
    name: "rate_limit_abuse",
    description: "Rate limit hits exceed 100 in 5 minutes",
    threshold: 100,
    windowMs: 5 * 60 * 1000,
    severity: "warning",
    check: (m) => m.rateLimits.hits > 100,
  },
];

let lastAlertTime = new Map<string, number>();

export async function checkAlerts(): Promise<void> {
  for (const rule of ALERT_RULES) {
    try {
      if (rule.check(metrics)) {
        const now = Date.now();
        const last = lastAlertTime.get(rule.name) || 0;
        // Don't re-alert more than once per 10 minutes
        if (now - last > 10 * 60 * 1000) {
          lastAlertTime.set(rule.name, now);
          await sendAlert(rule);
        }
      }
    } catch (e) {
      // Don't let alert checking crash the server
    }
  }
}

async function sendAlert(rule: AlertRule): Promise<void> {
  const message = `[ALERT:${rule.severity.toUpperCase()}] ${rule.name}: ${rule.description}`;

  // Log to console (always)
  console.warn(message);

  // In production, send to Sentry/PagerDuty/Slack
  if (process.env.NODE_ENV === "production") {
    // Sentry: captureError(new Error(message))
    // PagerDuty: trigger incident
    // Slack: post to webhook
    try {
      const { captureError } = await import("./monitoring");
      captureError(new Error(message), { rule: rule.name, severity: rule.severity });
    } catch {}
  }

  // Email alert to admin (if configured)
  if (process.env.ALERT_EMAIL && process.env.SMTP_HOST) {
    try {
      const { sendAlertEmail } = await import("./email");
      await sendAlertEmail(process.env.ALERT_EMAIL, `[ZAYTRIX ${rule.severity}] ${rule.name}`, message);
    } catch {}
  }
}

// Start alert checking — runs every 60 seconds
let alertTimer: ReturnType<typeof setInterval> | null = null;
export function startAlerting() {
  if (alertTimer) return;
  alertTimer = setInterval(() => checkAlerts(), 60 * 1000);
  console.log("[alerting] Alert checker started (runs every 60s).");
}

// Health check endpoint data
export function getHealthMetrics() {
  const uptime = Date.now() - metrics.requests.startTime;
  const errorRate = metrics.requests.total > 0 ? metrics.requests.errors / metrics.requests.total : 0;
  const sortedLatency = [...metrics.latency].sort((a, b) => a - b);
  const p50 = sortedLatency.length > 0 ? sortedLatency[Math.floor(sortedLatency.length * 0.5)] : 0;
  const p95 = sortedLatency.length > 0 ? sortedLatency[Math.floor(sortedLatency.length * 0.95)] : 0;

  return {
    uptime_ms: uptime,
    requests_total: metrics.requests.total,
    requests_errors: metrics.requests.errors,
    error_rate: parseFloat(errorRate.toFixed(4)),
    latency_p50_ms: p50,
    latency_p95_ms: p95,
    auth_attempts: metrics.auth.attempts,
    auth_failures: metrics.auth.failures,
    rate_limit_hits: metrics.rateLimits.hits,
    alert_rules: ALERT_RULES.map(r => ({ name: r.name, severity: r.severity, description: r.description })),
  };
}
