import type { TaxTransaction } from './types';

export function formatPrice(price: number, currency = 'USD'): string {
  if (price >= 1) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(price);
}

export function formatNumber(num: number): string {
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

export function formatPercent(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calculateMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calculateEMA(macdLine, 9);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  return {
    value: lastMacd,
    signal: lastSignal,
    histogram: lastMacd - lastSignal,
  };
}

export function calculateBollingerBands(closes: number[], period = 20, mult = 2): { upper: number; middle: number; lower: number } {
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
}

export function calculateFIFOPnL(transactions: TaxTransaction[]): { realizedPnL: number; taxEstimate: number } {
  const buys: { amount: number; price: number; date: string }[] = [];
  let totalPnL = 0;

  for (const tx of transactions) {
    if (tx.type === 'BUY') {
      buys.push({ amount: tx.amount, price: tx.price, date: tx.date });
    } else if (tx.type === 'SELL' && buys.length > 0) {
      let remaining = tx.amount;
      while (remaining > 0 && buys.length > 0) {
        const buy = buys[0];
        const sold = Math.min(remaining, buy.amount);
        totalPnL += (tx.price - buy.price) * sold;
        buy.amount -= sold;
        remaining -= sold;
        if (buy.amount <= 0) buys.shift();
      }
    }
  }

  const shortTermRate = 0.30;
  const longTermRate = 0.15;
  return {
    realizedPnL: totalPnL,
    taxEstimate: totalPnL > 0 ? totalPnL * (totalPnL > 10000 ? longTermRate : shortTermRate) : 0,
  };
}

export function generateSparkline(length = 20, basePrice = 100, volatility = 0.02): number[] {
  const data: number[] = [basePrice];
  for (let i = 1; i < length; i++) {
    const change = (Math.random() - 0.48) * volatility * data[i - 1];
    data.push(data[i - 1] + change);
  }
  return data;
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
