// ZAYTRIX test setup (SEC2-INFRA).
// Vitest configuration + basic API tests for auth + live data endpoints.
// Run with: npx vitest run

import { describe, it, expect } from "vitest";

const BASE = "http://localhost:3000";

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

// ─── AUTH TESTS ──────────────────────────────────────────────────────

describe("Auth API", () => {
  const testEmail = `test-${Date.now()}@zcap-test.com`;
  const testPassword = "TestPass123!";
  const testName = "Vitest User";
  let cookie: string;

  it("should reject unauthenticated /me", async () => {
    const { status, data } = await api("/api/auth/me");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user).toBeNull();
  });

  it("should register a new user", async () => {
    const { status, data, headers } = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: testPassword, displayName: testName }),
    });
    expect([200, 201]).toContain(status);
    expect(data.success).toBe(true);
    expect(data.user.email).toBe(testEmail);
    const setCookie = headers.get("set-cookie") || "";
    cookie = setCookie.split(";")[0];
    expect(cookie).toBeTruthy();
  });

  it("should reject duplicate registration", async () => {
    const { status, data } = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: testPassword, displayName: testName }),
    });
    expect(status).toBe(409);
    expect(data.success).toBe(false);
  });

  it("should reject short password", async () => {
    const { status, data } = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: `short-${Date.now()}@test.com`, password: "123", displayName: "X" }),
    });
    expect([400, 422]).toContain(status);
    expect(data.success).toBe(false);
  });

  it("should login with correct credentials", async () => {
    const { status, data, headers } = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user.email).toBe(testEmail);
    const setCookie = headers.get("set-cookie") || "";
    cookie = setCookie.split(";")[0];
    expect(cookie).toBeTruthy();
  });

  it("should reject wrong password", async () => {
    const { status, data } = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: "WrongPassword999" }),
    });
    expect(status).toBe(401);
    expect(data.success).toBe(false);
  });

  it("should return user with cookie", async () => {
    const { status, data } = await api("/api/auth/me", {
      headers: { Cookie: cookie },
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user).not.toBeNull();
    expect(data.user.email).toBe(testEmail);
  });

  it("should protect portfolio endpoint", async () => {
    const { status } = await api("/api/portfolio/holdings");
    expect(status).toBe(401);
  });

  it("should protect trade endpoint", async () => {
    const { status } = await api("/api/trade/execute", {
      method: "POST",
      body: JSON.stringify({ symbol: "BTCUSDT", amount: 0.01, side: "buy" }),
    });
    expect(status).toBe(401);
  });

  it("should logout", async () => {
    const { status, data } = await api("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });
});

// ─── PUBLIC MARKET DATA TESTS ────────────────────────────────────────

describe("Public Market Data API", () => {
  it("GET /api/assets should return 200", async () => {
    const { status } = await api("/api/assets");
    expect(status).toBe(200);
  });

  it("GET /api/live/long-short-ratio should return real data", async () => {
    const { status, data } = await api("/api/live/long-short-ratio?symbol=BTCUSDT&days=3");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.history)).toBe(true);
  });

  it("GET /api/live/hashrate should return real data", async () => {
    const { status, data } = await api("/api/live/hashrate?days=3");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("GET /api/fx/usd-idr should return exchange rate", async () => {
    const { status, data } = await api("/api/fx/usd-idr");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });
});
