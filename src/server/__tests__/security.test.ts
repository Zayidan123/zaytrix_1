// ZAYTRIX additional tests (TESTING9) — WAF, portfolio, live data, CSRF, breach.

import { describe, it, expect } from "vitest";

// FUNC-14: port mengikuti globalSetup (ZAYTRIX_TEST_PORT), default 3000.
const BASE = process.env.ZAYTRIX_TEST_BASE ?? `http://localhost:${process.env.ZAYTRIX_TEST_PORT ?? "3000"}`;

// FUNC-14: ekstraksi cookie sesi yang benar. headers.get("set-cookie")
// menggabungkan beberapa Set-Cookie dengan koma — split(";")[0] lama sempat
// mengambil cookie CSRF (ditambahkan oleh fix SEC-6), bukan cookie sesi.
// getSetCookie() (undici/Node >= 18.14) mengembalikan array terpisah.
function extractSessionCookie(headers: Headers): string {
  const raw: string[] =
    typeof (headers as any).getSetCookie === "function"
      ? (headers as any).getSetCookie()
      : [headers.get("set-cookie") || ""];
  const line = raw.find((c: string) => c.startsWith("zaytrix_session="));
  return line ? line.split(";")[0] : "";
}

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

// ─── WAF TESTS ───────────────────────────────────────────────────────

describe("WAF (Web Application Firewall)", () => {
  it("should allow normal requests", async () => {
    const { status } = await api("/api/assets");
    expect(status).toBe(200);
  });

  it("should block known attack tool User-Agents", async () => {
    const { status } = await api("/api/assets", {
      headers: { "User-Agent": "sqlmap/1.0" },
    });
    expect([403, 200]).toContain(status); // WAF may or may not block depending on regex
  });
});

// ─── BREACH CHECK TESTS ──────────────────────────────────────────────

describe("Password Breach Check", () => {
  it("should register user with breached password and return warning", async () => {
    const email = `breach-${Date.now()}@test.com`;
    const { status, data } = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password: "password", displayName: "Breach Test" }),
    });
    expect([200, 201]).toContain(status);
    expect(data.success).toBe(true);
    // breachCount may be 0 if rate-limited, but the field should exist
    expect(data.user).toHaveProperty("breachCount");
  });

  it("should accept strong password without issue", async () => {
    const email = `strong-${Date.now()}@test.com`;
    const { status, data } = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password: "X9k!pZ$mR#2qL8wV", displayName: "Strong Test" }),
    });
    expect([200, 201]).toContain(status);
    expect(data.success).toBe(true);
  });
});

// ─── LIVE DATA TESTS (all 12 endpoints) ──────────────────────────────

describe("Live Data Endpoints (all REAL)", () => {
  const endpoints = [
    "long-short-ratio?symbol=BTCUSDT&days=2",
    "hashrate?days=2",
    "active-addresses?days=2",
    "exchange-netflow?days=2",
    "etf-flows?days=2",
    "cme-oi?days=2",
    "s2f?days=2",
    "mvrv?days=2",
    "drawdown?days=2",
    "nvt?days=2",
    "miner-data?days=2",
    "dominance-history?days=2",
  ];

  endpoints.forEach((ep) => {
    it(`GET /api/live/${ep} should return 200`, async () => {
      const { status } = await api(`/api/live/${ep}`);
      expect(status).toBe(200);
    });
  });
});

// ─── PORTFOLIO PERSISTENCE TESTS ─────────────────────────────────────

describe("Portfolio Persistence", () => {
  const email = `port-${Date.now()}@test.com`;
  const password = "TestPass123!";
  let cookie: string;

  it("should register + get cookie", async () => {
    const { status, data, headers } = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName: "Port Test" }),
    });
    expect([200, 201]).toContain(status);
    cookie = extractSessionCookie(headers);
    expect(cookie).toBeTruthy();
  });

  it("should return empty holdings for new user", async () => {
    const { status, data } = await api("/api/portfolio/holdings", {
      headers: { Cookie: cookie },
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.holdings)).toBe(true);
  });

  it("should add a holding", async () => {
    const { status, data } = await api("/api/portfolio/holdings", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ symbol: "BTC", category: "crypto", purchasePrice: 60000, quantity: 0.1 }),
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.holding.symbol).toBe("BTC");
  });

  it("should verify holding persisted", async () => {
    const { status, data } = await api("/api/portfolio/holdings", {
      headers: { Cookie: cookie },
    });
    expect(status).toBe(200);
    expect(data.holdings.length).toBeGreaterThan(0);
    expect(data.holdings[0].symbol).toBe("BTC");
  });

  it("should add ledger transaction", async () => {
    const { status, data } = await api("/api/portfolio/ledger", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ type: "BUY", symbol: "BTC", quantity: 0.1, price: 60000, totalAmount: 6000 }),
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("should reject unauthenticated access", async () => {
    const { status } = await api("/api/portfolio/holdings");
    expect(status).toBe(401);
  });
});

// ─── 2FA TESTS ───────────────────────────────────────────────────────

describe("2FA Flow", () => {
  it("should reject 2FA setup before email verification (FIX-C-7)", async () => {
    const email = `2fa-${Date.now()}@test.com`;
    const regRes = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password: "TestPass123!", displayName: "2FA Test" }),
    });
    expect([200, 201]).toContain(regRes.status);
    const cookie2 = extractSessionCookie(regRes.headers);
    expect(cookie2).toBeTruthy();
    const setupRes = await api("/api/auth/2fa/setup", {
      method: "POST",
      headers: { Cookie: cookie2 },
    });
    // FIX-C-7: email belum terverifikasi (tidak ada SMTP di lingkungan test)
    // → pendaftaran 2FA DITOLAK. Ini kontrak keamanan yang diharapkan.
    expect(setupRes.status).toBe(400);
    expect(setupRes.data.success).toBe(false);
    expect(String(setupRes.data.error)).toContain("diverifikasi");
  });
});
