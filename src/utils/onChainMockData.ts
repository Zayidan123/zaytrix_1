import { OnChainTx } from "../components/OnChainData";

// Helper to generate chronological mock dates
export const generateDates = (count: number): string[] => {
  return Array.from({ length: count }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (count - 1 - i));
    return d.toLocaleDateString("id-ID", { month: "short", day: "numeric" });
  });
};

// Generates smooth random walk values
export const generateRandomWalk = (
  count: number,
  startVal: number,
  volatility: number,
  minVal = 0,
  maxVal = Infinity
): number[] => {
  const result: number[] = [startVal];
  for (let i = 1; i < count; i++) {
    const change = (Math.random() - 0.48) * volatility; // Slight upward bias
    let nextVal = result[i - 1] + change;
    if (nextVal < minVal) nextVal = minVal;
    if (nextVal > maxVal) nextVal = maxVal;
    result.push(Math.round(nextVal * 100) / 100);
  }
  return result;
};

// All 51+ Metric datasets generated on demand
export const getOnChainMockData = () => {
  const dates30 = generateDates(30);
  const dates90 = generateDates(90);

  // --- Tab 1: Derivatives ---
  const oiData = dates30.map((date, i) => {
    const btcOI = 12000 + i * 150 + Math.random() * 800;
    const ethOI = 6000 + i * 80 + Math.random() * 400;
    const solOI = 1500 + i * 40 + Math.random() * 200;
    return {
      date,
      BTC: Math.round(btcOI),
      ETH: Math.round(ethOI),
      SOL: Math.round(solOI),
      Total: Math.round(btcOI + ethOI + solOI),
    };
  });

  const fundingRates = dates30.map((date) => ({
    date,
    Binance: +(0.01 + (Math.random() - 0.5) * 0.015).toFixed(4),
    OKX: +(0.009 + (Math.random() - 0.5) * 0.012).toFixed(4),
    Bybit: +(0.012 + (Math.random() - 0.5) * 0.018).toFixed(4),
  }));

  const altcoinOIVolume = [
    { symbol: "SOL", oi: 2150, volume: 4500, change: 4.8 },
    { symbol: "ETH", oi: 6850, volume: 12500, change: 1.2 },
    { symbol: "BNB", oi: 850, volume: 1800, change: -0.5 },
    { symbol: "ADA", oi: 420, volume: 950, change: -1.4 },
    { symbol: "XRP", oi: 650, volume: 1400, change: 2.1 },
    { symbol: "DOGE", oi: 580, volume: 1100, change: 5.6 },
  ];

  const cmeBtcOI = dates30.map((date, i) => ({
    date,
    StandardFutures: Math.round(4200 + i * 60 + (Math.random() - 0.5) * 300),
    MicroFutures: Math.round(450 + i * 8 + (Math.random() - 0.5) * 40),
    Options: Math.round(1100 + i * 25 + (Math.random() - 0.5) * 100),
  }));

  // --- Tab 2: Liquidations ---
  const totalLiquidations = dates30.map((date) => {
    const longLiq = Math.round(15 + Math.random() * 85);
    const shortLiq = Math.round(10 + Math.random() * 60);
    return {
      date,
      Longs: longLiq,
      Shorts: shortLiq,
      Total: longLiq + shortLiq,
    };
  });

  const exchangeLiquidations = [
    { name: "Binance", Longs: 42.5, Shorts: 28.1 },
    { name: "OKX", Longs: 26.4, Shorts: 18.2 },
    { name: "Bybit", Longs: 31.8, Shorts: 22.4 },
    { name: "HTX", Longs: 12.1, Shorts: 9.3 },
    { name: "Coinex", Longs: 4.2, Shorts: 3.1 },
  ];

  const top10AllTimeLiq = [
    { rank: 1, date: "12 Mar 2020", event: "Black Thursday Covid Crash", amountUsd: 1380, btcPrice: "5,200" },
    { rank: 2, date: "19 Mei 2021", event: "China Crypto Ban Scare", amountUsd: 1210, btcPrice: "34,500" },
    { rank: 3, date: "18 Jun 2022", event: "Three Arrows Capital Insolvency", amountUsd: 890, btcPrice: "18,900" },
    { rank: 4, date: "09 Nov 2022", event: "FTX Exchange Collapse", amountUsd: 840, btcPrice: "16,200" },
    { rank: 5, date: "17 Agu 2023", event: "Evergrande Bankruptcy Speculation", amountUsd: 670, btcPrice: "26,100" },
    { rank: 6, date: "05 Mar 2024", event: "BTC ATH Flash Dump", amountUsd: 620, btcPrice: "67,500" },
    { rank: 7, date: "13 Apr 2024", event: "Middle East Geopolitical Friction", amountUsd: 590, btcPrice: "61,800" },
    { rank: 8, date: "05 Agu 2024", event: "Yen Carry Trade Unwind Crash", amountUsd: 540, btcPrice: "52,400" },
    { rank: 9, date: "21 Jan 2022", event: "Fed Macro Tightening Announcement", amountUsd: 490, btcPrice: "36,400" },
    { rank: 10, date: "07 Sep 2021", event: "El Salvador BTC Legal Tender Dump", amountUsd: 460, btcPrice: "44,800" },
  ];

  const priceVsLiq = dates30.map((date, i) => {
    const basePrice = 64000 + i * 400 + Math.sin(i / 3) * 3000;
    const totalLiq = Math.round(50 + Math.random() * 150 + (Math.abs(Math.sin(i / 3)) > 0.8 ? 200 : 0));
    return {
      date,
      Price: Math.round(basePrice),
      Liquidations: totalLiq,
    };
  });

  // --- Tab 3: Volume & Heatmaps ---
  const gainersLosers = {
    gainers: [
      { symbol: "HYPE", price: 8.42, change: 24.15, vol: "41.2M" },
      { symbol: "SOL", price: 164.20, change: 8.62, vol: "3.4B" },
      { symbol: "AVAX", price: 34.50, change: 6.74, vol: "512M" },
      { symbol: "XRP", price: 0.62, change: 5.12, vol: "820M" },
      { symbol: "DOGE", price: 0.152, change: 4.81, vol: "420M" },
    ],
    losers: [
      { symbol: "PEPE", price: 0.000012, change: -12.45, vol: "150M" },
      { symbol: "ADA", price: 0.44, change: -5.82, vol: "210M" },
      { symbol: "DOT", price: 6.12, change: -4.18, vol: "115M" },
      { symbol: "NEAR", price: 5.80, change: -3.75, vol: "290M" },
      { symbol: "LINK", price: 15.30, change: -2.91, vol: "340M" },
    ],
  };

  const volumeSpotFutures = [
    { name: "BTC", Spot: 18.5, Futures: 42.4 },
    { name: "ETH", Spot: 9.2, Futures: 24.1 },
    { name: "SOL", Spot: 3.8, Futures: 12.5 },
    { name: "BNB", Spot: 1.4, Futures: 4.2 },
    { name: "XRP", Spot: 1.1, Futures: 3.6 },
    { name: "Lainnya", Spot: 12.4, Futures: 38.2 },
  ];

  const volumeGainers30d = [
    { symbol: "HYPE", volGrowth: 182.5 },
    { symbol: "FET", volGrowth: 94.2 },
    { symbol: "PEPE", volGrowth: 71.8 },
    { symbol: "SUI", volGrowth: 59.4 },
    { symbol: "SOL", volGrowth: 41.2 },
    { symbol: "WIF", volGrowth: 38.1 },
  ];

  // --- Tab 4: Funding Fees ---
  const fundingOverview = dates30.map((date, i) => ({
    date,
    CumulativeFeesPaid: Math.round(4.2 + i * 0.35 + Math.sin(i / 2) * 0.8),
    DailySettled: Math.round(250 + (Math.random() - 0.4) * 200),
  }));

  // --- Tab 5: Orderbook & Liquidity ---
  const orderbookLiquidityDelta = [
    { level: "+1.0%", BuyQty: 18.4, SellQty: 14.2 },
    { level: "+0.8%", BuyQty: 24.1, SellQty: 19.5 },
    { level: "+0.6%", BuyQty: 32.5, SellQty: 26.1 },
    { level: "+0.4%", BuyQty: 48.2, SellQty: 38.4 },
    { level: "+0.2%", BuyQty: 75.9, SellQty: 62.1 },
    { level: "-0.2%", BuyQty: 84.2, SellQty: 91.5 },
    { level: "-0.4%", BuyQty: 54.1, SellQty: 68.3 },
    { level: "-0.6%", BuyQty: 38.2, SellQty: 49.2 },
    { level: "-0.8%", BuyQty: 29.4, SellQty: 35.8 },
    { level: "-1.0%", BuyQty: 21.3, SellQty: 28.4 },
  ];

  const aggregatedLiquidityDelta = dates30.map((date, i) => {
    const bids = 450 + i * 5 + Math.random() * 80;
    const asks = 420 + i * 4 + Math.random() * 70;
    return {
      date,
      "Total Bids (±1%)": Math.round(bids),
      "Total Asks (±1%)": Math.round(asks),
      "Delta Netto": Math.round(bids - asks),
    };
  });

  // --- Tab 6: On-Chain Flows ---
  const btcSpotFlows = dates30.map((date) => {
    const inflow = Math.round(400 + Math.random() * 600);
    const outflow = Math.round(350 + Math.random() * 550);
    return {
      date,
      Inflow: inflow,
      Outflow: outflow,
      Netflow: inflow - outflow,
    };
  });

  const spotNetflowStats = [
    { name: "BTC", Inflow: 850, Outflow: 720, Netflow: 130 },
    { name: "ETH", Inflow: 420, Outflow: 490, Netflow: -70 },
    { name: "USDT", Inflow: 1250, Outflow: 980, Netflow: 270 },
    { name: "USDC", Inflow: 640, Outflow: 590, Netflow: 50 },
  ];

  const walletFlows = dates30.map((date) => {
    const btcNet = Math.round((Math.random() - 0.45) * 400);
    const usdtNet = Math.round((Math.random() - 0.4) * 800);
    return {
      date,
      BTC_Flow: btcNet,
      USDT_Flow: usdtNet,
    };
  });

  const exchangeBalances = dates30.map((date, i) => ({
    date,
    BTC_Exchange_Reserve: +(2.15 - i * 0.004 + Math.sin(i) * 0.005).toFixed(3), // Millions of BTC
    USDT_Exchange_Reserve: +(14.2 + i * 0.12 + Math.cos(i) * 0.15).toFixed(2), // Billions of USDT
  }));

  const addressMetrics = dates30.map((date, i) => {
    const active = Math.round(920000 + i * 4000 + Math.sin(i / 2) * 50000);
    const newAdd = Math.round(380000 + i * 1500 + Math.cos(i / 2) * 20000);
    return {
      date,
      Active_Addresses: active,
      New_Addresses: newAdd,
    };
  });

  const minerData = dates30.map((date) => {
    const outflows = Math.round(15 + Math.random() * 45); // in Million USD
    const revenue = Math.round(32 + Math.sin(Math.random()) * 8); // in Million USD
    return {
      date,
      Miner_Outflows: outflows,
      Miner_Revenue: revenue,
    };
  });

  // --- Tab 7: Valuation & Macro ---
  const mvrvZScore = dates30.map((date, i) => {
    const score = +(1.4 + Math.sin(i / 4) * 0.4 + i * 0.03 + Math.random() * 0.1).toFixed(2);
    return {
      date,
      "MVRV Z-Score": score,
      UndervaluedZone: 0.1,
      OvervaluedZone: 7.0,
    };
  });

  const mvrvRatio = dates30.map((date, i) => ({
    date,
    "MVRV Ratio": +(1.65 + Math.sin(i / 5) * 0.2 + i * 0.015).toFixed(2),
    "Realized Value": 1.0,
  }));

  const btcDominance = dates30.map((date, i) => {
    const btc = +(54.2 + Math.sin(i / 5) * 1.5).toFixed(1);
    const eth = +(17.4 + Math.cos(i / 5) * 0.8).toFixed(1);
    const alts = +(100 - btc - eth).toFixed(1);
    return { date, Bitcoin: btc, Ethereum: eth, Altcoins: alts };
  });

  const etfOverview = [
    { ticker: "IBIT", name: "BlackRock iShares", netFlow30d: 1420.5, totalAum: 22400, volume24h: 312 },
    { ticker: "FBTC", name: "Fidelity Wise", netFlow30d: 685.2, totalAum: 11200, volume24h: 184 },
    { ticker: "ARKB", name: "Ark 21Shares", netFlow30d: 184.1, totalAum: 3100, volume24h: 62 },
    { ticker: "BITB", name: "Bitwise 100", netFlow30d: 125.4, totalAum: 2400, volume24h: 41 },
    { ticker: "GBTC", name: "Grayscale Trust", netFlow30d: -1120.4, totalAum: 15100, volume24h: 125 },
  ];

  const stockToFlow = dates30.map((date, i) => {
    const sfPrice = Math.round(62000 + i * 150);
    const actualPrice = Math.round(sfPrice + Math.sin(i / 3) * 4500 + (Math.random() - 0.5) * 1200);
    return {
      date,
      "Stock-to-Flow Model Line": sfPrice,
      "Actual BTC Price": actualPrice,
    };
  });

  const macroSupplyRate = dates30.map((date, i) => {
    const btcPrice = Math.round(64000 + i * 350 + Math.sin(i / 4) * 2000);
    const m2Growth = +(5.4 + Math.sin(i / 6) * 1.2).toFixed(2);
    const fedRate = 5.25;
    return {
      date,
      BTCPrice: btcPrice,
      M2GrowthPercent: m2Growth,
      FedFundsRate: fedRate,
    };
  });

  const btcCorrelations = [
    { asset: "S&P 500", corr: 0.65, label: "Positif Kuat" },
    { asset: "Nasdaq 100", corr: 0.78, label: "Sangat Kuat" },
    { asset: "Gold (Emas)", corr: 0.24, label: "Lemah" },
    { asset: "DXY (US Dollar Index)", corr: -0.52, label: "Inversi Moderat" },
    { asset: "Ethereum (ETH)", corr: 0.89, label: "Sangat Kuat" },
  ];

  const holdersSupply = dates30.map((date, i) => {
    const total = 19.7; // Millions of circulating supply
    const lth = +(14.8 + Math.sin(i / 8) * 0.12).toFixed(2);
    const sth = +(total - lth).toFixed(2);
    return {
      date,
      "Long-Term Holders": lth,
      "Short-Term Holders": sth,
    };
  });

  const drawdownAth = dates30.map((date, i) => {
    const currentPrice = 64000 + i * 350 + Math.sin(i / 3) * 2000;
    const ath = 73750;
    const drawdownPct = -((ath - currentPrice) / ath) * 100;
    return {
      date,
      "Drawdown dari ATH (%)": +drawdownPct.toFixed(2),
      BTCPrice: Math.round(currentPrice),
    };
  });

  const bubbleAndNvt = dates30.map((date, i) => {
    const bubbleIndex = Math.round(42 + Math.sin(i / 5) * 15 + Math.random() * 5);
    const nvtRatio = Math.round(68 + Math.cos(i / 4) * 12 + Math.random() * 4);
    const nuplValue = +(0.45 + Math.sin(i / 6) * 0.15).toFixed(3);
    return {
      date,
      BubbleIndex: bubbleIndex,
      NVTRatio: nvtRatio,
      NUPL: nuplValue,
    };
  });

  return {
    oiData,
    fundingRates,
    altcoinOIVolume,
    cmeBtcOI,
    totalLiquidations,
    exchangeLiquidations,
    top10AllTimeLiq,
    priceVsLiq,
    gainersLosers,
    volumeSpotFutures,
    volumeGainers30d,
    fundingOverview,
    orderbookLiquidityDelta,
    aggregatedLiquidityDelta,
    btcSpotFlows,
    spotNetflowStats,
    walletFlows,
    exchangeBalances,
    addressMetrics,
    minerData,
    mvrvZScore,
    mvrvRatio,
    btcDominance,
    etfOverview,
    stockToFlow,
    macroSupplyRate,
    btcCorrelations,
    holdersSupply,
    drawdownAth,
    bubbleAndNvt,
  };
};

export interface LiquidationLiveEvent {
  id: string;
  time: string;
  symbol: string;
  side: "LONG" | "SHORT";
  price: number;
  amount: number;
  valueUsd: number;
  exchange: string;
}

// Generates live scrolling liquidations
export const generateLiveLiquidation = (): LiquidationLiveEvent => {
  const exchanges = ["Binance", "Bybit", "OKX", "HTX", "BitMEX"];
  const coins = ["BTC", "ETH", "SOL", "XRP", "DOGE", "LINK", "HYPE"];
  const randomCoin = coins[Math.floor(Math.random() * coins.length)];
  const side = Math.random() > 0.45 ? "LONG" : "SHORT";

  let price = 64500;
  let amount = 0.5;

  if (randomCoin === "BTC") {
    price = 64000 + (Math.random() - 0.5) * 1000;
    amount = +(0.1 + Math.random() * 4.5).toFixed(2);
  } else if (randomCoin === "ETH") {
    price = 3450 + (Math.random() - 0.5) * 80;
    amount = +(1 + Math.random() * 40).toFixed(1);
  } else if (randomCoin === "SOL") {
    price = 160 + (Math.random() - 0.5) * 5;
    amount = +(5 + Math.random() * 150).toFixed(0);
  } else {
    price = 1 + Math.random() * 5;
    amount = +(50 + Math.random() * 2000).toFixed(0);
  }

  const valueUsd = Math.round(amount * price);

  return {
    id: Math.random().toString(36).substr(2, 9),
    time: new Date().toLocaleTimeString("id-ID", { hour12: false }),
    symbol: `${randomCoin}USDT`,
    side,
    price: +price.toFixed(randomCoin === "BTC" || randomCoin === "ETH" ? 2 : 4),
    amount,
    valueUsd,
    exchange: exchanges[Math.floor(Math.random() * exchanges.length)],
  };
};
