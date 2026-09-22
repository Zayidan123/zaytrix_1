// Risk Metrics & Backtest endpoint tests (TDD — RED phase)
import { describe, it, expect } from "vitest";

const BASE = process.env.ZAYTRIX_TEST_BASE ?? `http://localhost:${process.env.ZAYTRIX_TEST_PORT ?? "3000"}`;

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

describe("Risk Metrics API", () => {
  it("GET /api/public/risk/var?symbol=BTCUSDT&days=90&confidence=0.95 should return VaR", async () => {
    const { status, data } = await api("/api/public/risk/var?symbol=BTCUSDT&days=90&confidence=0.95");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data).toHaveProperty("metric");
    expect(typeof data.metric.var).toBe("number");
    expect(typeof data.metric.mean).toBe("number");
    expect(typeof data.metric.stdDev).toBe("number");
    expect(data.source).toBe("binance");
    expect(data).toHaveProperty("lastUpdated");
  });

  it("GET /api/public/risk/kelly?symbol=BTCUSDT&days=90 should return Kelly Criterion", async () => {
    const { status, data } = await api("/api/public/risk/kelly?symbol=BTCUSDT&days=90");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data).toHaveProperty("metric");
    expect(typeof data.metric.kellyCriterion).toBe("number");
    expect(typeof data.metric.winRate).toBe("number");
    expect(typeof data.metric.avgWin).toBe("number");
    expect(typeof data.metric.avgLoss).toBe("number");
    expect(data.source).toBe("binance");
  });

  it("GET /api/public/risk/sharpe?symbol=BTCUSDT&days=90&riskFreeRate=0.05 should return Sharpe ratio", async () => {
    const { status, data } = await api("/api/public/risk/sharpe?symbol=BTCUSDT&days=90&riskFreeRate=0.05");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data).toHaveProperty("metric");
    expect(typeof data.metric.sharpeRatio).toBe("number");
    expect(typeof data.metric.annualizedReturn).toBe("number");
    expect(typeof data.metric.annualizedStdDev).toBe("number");
    expect(data.source).toBe("binance");
  });

  it("GET /api/public/risk/sortino?symbol=BTCUSDT&days=90 should return Sortino ratio", async () => {
    const { status, data } = await api("/api/public/risk/sortino?symbol=BTCUSDT&days=90");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data).toHaveProperty("metric");
    expect(typeof data.metric.sortinoRatio).toBe("number");
    expect(typeof data.metric.downsideDeviation).toBe("number");
    expect(data.source).toBe("binance");
  });

  it("GET /api/public/backtest/simple?symbol=BTCUSDT&strategy=cross_ema&days=90&interval=1d should return backtest results", async () => {
    const { status, data } = await api("/api/public/backtest/simple?symbol=BTCUSDT&strategy=cross_ema&days=90&interval=1d");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data).toHaveProperty("metric");
    expect(typeof data.metric.totalReturn).toBe("number");
    expect(typeof data.metric.maxDrawdown).toBe("number");
    expect(typeof data.metric.winRate).toBe("number");
    expect(typeof data.metric.totalTrades).toBe("number");
    // signals lives at the response root, not inside metric
    expect(Array.isArray(data.signals)).toBe(true);
    expect(data.source).toBe("binance");
  });
});
