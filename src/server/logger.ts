// ============================================================================
// ZAYTRIX Structured Logger — QA3-F1 (roadmap: structured logging)
// ----------------------------------------------------------------------------
// Replaces ad-hoc console.log/warn/error calls across the server with a single
// JSON-lines logger. Design goals:
//   • Zero dependencies (no pino/winston) — keeps the audit-hardened,
//     minimal-dependency posture of this codebase.
//   • Variadic-compatible with the old console.* call sites: the first string
//     argument becomes `msg`, any extra arguments are folded into `data` —
//     so a mechanical `console.log("x", obj)` → `log.info("x", obj)` migration
//     is safe and lossless.
//   • Universal secret redaction (defense in depth on top of the call-site
//     sanitization done in earlier rounds):
//       - object keys matching sensitive patterns → "[REDACTED]"
//       - e-mail addresses in free text → "u***@domain" (PII minimisation)
//       - JWTs / GitHub tokens / long hex blobs in free text → masked
//   • In-memory ring buffer (500 entries) powering GET /api/system/logs so an
//     authenticated operator can inspect recent server activity without shell
//     access. The buffer stores the ALREADY-redacted entries.
//   • LOG_LEVEL env: "debug" | "info" (default) | "warn" | "error". In dev
//     (NODE_ENV !== "production") the default is "debug".
// Output contract — one JSON object per line on stdout:
//   {"ts":"2026-08-31T12:00:00.000Z","level":"info","module":"server",
//    "msg":"Binance WS connected","data":[{"stream":"!forceOrder@arr"}]}
// ============================================================================
import { Router, type Request, type Response } from "express";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveMinLevel(): number {
  const fromEnv = String(process.env.LOG_LEVEL || "").toLowerCase().trim();
  if (fromEnv === "debug" || fromEnv === "info" || fromEnv === "warn" || fromEnv === "error") {
    return LEVEL_WEIGHT[fromEnv];
  }
  return process.env.NODE_ENV === "production" ? LEVEL_WEIGHT.info : LEVEL_WEIGHT.debug;
}

let minLevel = resolveMinLevel();
export function setLogLevel(level: LogLevel): void {
  minLevel = LEVEL_WEIGHT[level];
}

// QA8-B: getter runtime (inverse map LEVEL_WEIGHT). minLevel selalu salah satu
// dari 4 bobot karena hanya di-assign via resolveMinLevel()/setLogLevel();
// fallback "info" murni untuk keamanan tipe, bukan kondisi nyata.
export function getLogLevel(): LogLevel {
  const found = (Object.keys(LEVEL_WEIGHT) as LogLevel[]).find((lv) => LEVEL_WEIGHT[lv] === minLevel);
  return found ?? "info";
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------
const SENSITIVE_KEY_RE =
  /(secret|password|passwd|authorization|cookie|tokens?|api[-_]?keys?|private|credential|session|csrf|signature|otp|pin|recovery|backup[-_]?codes?)/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\b/g;
const GH_TOKEN_RE = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g;
const LONG_HEX_RE = /\b[0-9a-fA-F]{32,}\b/g;

function redactString(s: string): string {
  return s
    .replace(EMAIL_RE, (m) => `${m.slice(0, 1)}***@${m.split("@")[1] || "domain"}`)
    .replace(JWT_RE, "[JWT]")
    .replace(GH_TOKEN_RE, "[TOKEN]")
    .replace(LONG_HEX_RE, (m) => `${m.slice(0, 6)}…[redacted:${m.length}]`);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[depth-limit]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message || "") };
  }
  if (Array.isArray(value)) {
    // Cap very long arrays to keep log lines bounded.
    const shown = value.slice(0, 8).map((v) => redactValue(v, depth + 1));
    if (value.length > 8) shown.push(`…[${value.length} items]`);
    return shown;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : redactValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Ring buffer (for GET /api/system/logs)
// ---------------------------------------------------------------------------
export interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  data?: unknown[];
}

const RING_CAPACITY = 500;
const ring: LogEntry[] = [];

function pushRing(entry: LogEntry): void {
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.splice(0, ring.length - RING_CAPACITY);
}

export function getRecentLogs(opts?: { limit?: number; level?: LogLevel }): LogEntry[] {
  const minWeight = opts?.level ? LEVEL_WEIGHT[opts.level] : 0;
  const limit = Math.max(1, Math.min(opts?.limit ?? 100, RING_CAPACITY));
  const filtered = ring.filter((e) => LEVEL_WEIGHT[e.level] >= minWeight);
  return filtered.slice(-limit).reverse(); // newest first
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------
export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

// Inti emit dibagi supaya rute /level (QA8-B) bisa memaksa entri audit masuk
// ring buffer meskipun ambang level baru akan memfilternya — contoh ekstrem:
// operator mengubah level ke "error"; entri "warn" tentang perubahan itu
// sendiri harus tetap tercatat, kalau tidak jejak auditnya hilang senyap.
function pushEntry(level: LogLevel, module: string, msg: string, args: unknown[], force: boolean): void {
  if (!force && LEVEL_WEIGHT[level] < minLevel) return;
  let safeMsg = msg;
  try {
    safeMsg = redactString(typeof msg === "string" ? msg : String(msg));
  } catch {
    safeMsg = "[unserializable message]";
  }
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    module,
    msg: safeMsg,
  };
  if (args.length > 0) {
    entry.data = args.map((a) => {
      try {
        return redactValue(a, 0);
      } catch {
        return "[unserializable]";
      }
    });
  }
  pushRing(entry);
  // Single funnel to stdout — one JSON line per entry. Using console.* here
  // is intentional: this module IS the console replacement.
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  } catch {
    // JSON.stringify failed (circular data already capped by redaction, but
    // be safe) — emit a minimal line instead.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ts: entry.ts, level, module, msg: safeMsg, data: "[dropped]" }));
  }
}

export function createLogger(module: string): Logger {
  const emit = (level: LogLevel, msg: string, args: unknown[]): void => {
    pushEntry(level, module, msg, args, false);
  };
  return {
    debug: (msg, ...args) => emit("debug", msg, args),
    info: (msg, ...args) => emit("info", msg, args),
    warn: (msg, ...args) => emit("warn", msg, args),
    error: (msg, ...args) => emit("error", msg, args),
  };
}

// ---------------------------------------------------------------------------
// GET /api/system/logs — operator log viewer (auth required; mounted in
// server.ts under requireAuth). Query params:
//   ?limit=100   (1..500)
//   ?level=warn  (debug|info|warn|error — minimum severity)
// Response: { success, total, entries[] } — entries are newest-first and
// ALREADY redacted (the ring only stores post-redaction entries).
// ---------------------------------------------------------------------------
export const systemLogsRouter = Router();

systemLogsRouter.get("/", (req: Request, res: Response) => {
  const limitRaw = parseInt(String(req.query.limit ?? "100"), 10);
  const levelRaw = String(req.query.level ?? "").toLowerCase();
  const level: LogLevel | undefined =
    levelRaw === "debug" || levelRaw === "info" || levelRaw === "warn" || levelRaw === "error"
      ? (levelRaw as LogLevel)
      : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100;
  const entries = getRecentLogs({ limit, level });
  return res.json({
    success: true,
    total: entries.length,
    ringCapacity: RING_CAPACITY,
    entries,
  });
});

// ---------------------------------------------------------------------------
// GET /api/system/logs/level (QA8-B) — level runtime saat ini.
// ---------------------------------------------------------------------------
systemLogsRouter.get("/level", (_req: Request, res: Response) => {
  return res.json({
    success: true,
    level: getLogLevel(),
    note: "berlaku selama proses server berjalan; default dari LOG_LEVEL saat boot",
  });
});

// ---------------------------------------------------------------------------
// POST /api/system/logs/level (QA8-B) — ubah level runtime.
// Body: { level: "debug" | "info" | "warn" | "error" }.
// Validasi manual (bukan zod) terhadap 4 nilai — input lain → 400.
// Perubahan dicatat sebagai entri audit level "warn" (module "system") yang
// DI-PUSH PAKSA ke ring buffer (melewati ambang yang baru saja diubah) supaya
// jejak perubahannya sendiri selalu terlihat oleh operator. Mutating request —
// terlindungi requireAuth (mount di server.ts) + CSRF double-submit global
// (middleware src/server/security.ts, cookie zaytrix_csrf + header x-csrf-token).
// ---------------------------------------------------------------------------
systemLogsRouter.post("/level", (req: Request, res: Response) => {
  const raw = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>).level : undefined;
  const requested = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (requested !== "debug" && requested !== "info" && requested !== "warn" && requested !== "error") {
    const echo = typeof raw === "string" ? raw.slice(0, 40) : typeof raw;
    return res.status(400).json({
      success: false,
      error: `Level tidak valid: "${echo}" — gunakan salah satu dari: debug, info, warn, error.`,
    });
  }
  const level = requested as LogLevel;
  const previous = getLogLevel();
  setLogLevel(level);
  pushEntry(
    "warn",
    "system",
    `LOG_LEVEL diubah runtime menjadi ${level} oleh operator`,
    [{ dari: previous, ke: level }],
    true // force: audit trail tidak boleh tenggelam oleh ambang yang baru diganti
  );
  return res.json({ success: true, level });
});
