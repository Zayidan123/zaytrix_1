import { Server } from "socket.io";

// ── Asset metadata map ──────────────────────────────────────────────
const ASSET_MAP: Record<string, { symbol: string; name: string }> = {
  btcusdt: { symbol: "BTC", name: "Bitcoin" },
  ethusdt: { symbol: "ETH", name: "Ethereum" },
  solusdt: { symbol: "SOL", name: "Solana" },
  bnbusdt: { symbol: "BNB", name: "BNB" },
  xrpusdt: { symbol: "XRP", name: "Ripple" },
  adausdt: { symbol: "ADA", name: "Cardano" },
  dogeusdt: { symbol: "DOGE", name: "Dogecoin" },
  avaxusdt: { symbol: "AVAX", name: "Avalanche" },
  dotusdt: { symbol: "DOT", name: "Polkadot" },
  maticusdt: { symbol: "MATIC", name: "Polygon" },
};

const COINGECKO_IDS: Record<string, string> = {
  btcusdt: "bitcoin",
  ethusdt: "ethereum",
  solusdt: "solana",
  bnbusdt: "binancecoin",
  xrpusdt: "ripple",
  adausdt: "cardano",
  dogeusdt: "dogecoin",
  avaxusdt: "avalanche-2",
  dotusdt: "polkadot",
  maticusdt: "polygon-pos",
};

const COINGECKO_SYMBOL_MAP: Record<string, string> = {
  bitcoin: "btcusdt",
  ethereum: "ethusdt",
  solana: "solusdt",
  binancecoin: "bnbusdt",
  ripple: "xrpusdt",
  cardano: "adausdt",
  dogecoin: "dogeusdt",
  "avalanche-2": "avaxusdt",
  polkadot: "dotusdt",
  "polygon-pos": "maticusdt",
};

interface PriceAsset {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  high24h: number;
  low24h: number;
}

// ── State ───────────────────────────────────────────────────────────
const liveData: Map<string, PriceAsset> = new Map();
let wsConnected = false;
let ws: WebSocket | null = null;
let broadcastInterval: ReturnType<typeof setInterval> | null = null;
let coingeckoInterval: ReturnType<typeof setInterval> | null = null;

// ── Socket.IO server ────────────────────────────────────────────────
const io = new Server({
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`[price-feed] Client connected: ${socket.id}`);

  // Send current snapshot immediately
  if (liveData.size > 0) {
    socket.emit("price-update", Array.from(liveData.values()));
  }

  socket.on("disconnect", () => {
    console.log(`[price-feed] Client disconnected: ${socket.id}`);
  });
});

// ── Broadcast function ──────────────────────────────────────────────
function broadcastPrices() {
  if (liveData.size === 0) return;
  const prices = Array.from(liveData.values());
  io.emit("price-update", prices);
}

// ── Binance WebSocket ───────────────────────────────────────────────
function connectBinance() {
  const streams = Object.keys(ASSET_MAP).join("/");
  const url = `wss://stream.binance.com:9443/ws/${streams}@ticker`;

  console.log(`[price-feed] Connecting to Binance WebSocket...`);
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    wsConnected = true;
    console.log(`[price-feed] Binance WebSocket connected`);
  });

  ws.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
      const stream = data.s?.toLowerCase(); // e.g. "BTCUSDT"
      if (!stream || !ASSET_MAP[stream]) return;

      const meta = ASSET_MAP[stream];
      const price = parseFloat(data.c); // last price
      const change24h = parseFloat(data.P); // 24h percent change
      const volume24h = parseFloat(data.v) * price; // volume * price ≈ USD vol
      const high24h = parseFloat(data.h);
      const low24h = parseFloat(data.l);

      // Estimate market cap from prior data or rough multiplier
      const existing = liveData.get(stream);
      const marketCap = existing
        ? existing.marketCap
        : price * 21_000_000; // rough fallback

      liveData.set(stream, {
        symbol: meta.symbol,
        name: meta.name,
        price,
        change24h,
        volume24h,
        marketCap,
        high24h,
        low24h,
      });
    } catch {
      // ignore parse errors
    }
  });

  ws.addEventListener("close", () => {
    wsConnected = false;
    console.log(`[price-feed] Binance WebSocket closed, will retry...`);
  });

  ws.addEventListener("error", (err) => {
    wsConnected = false;
    console.error(`[price-feed] Binance WebSocket error:`, (err as ErrorEvent).message || err);
  });
}

// ── CoinGecko REST fallback ─────────────────────────────────────────
async function fetchCoinGecko() {
  try {
    console.log(`[price-feed] Fetching CoinGecko fallback data...`);
    const ids = Object.values(COINGECKO_IDS).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    for (const [id, info] of Object.entries(data)) {
      const stream = COINGECKO_SYMBOL_MAP[id];
      if (!stream || !ASSET_MAP[stream]) continue;

      const d = info as {
        usd: number;
        usd_24h_change: number;
        usd_24h_vol: number;
        usd_market_cap: number;
      };
      const meta = ASSET_MAP[stream];
      const price = d.usd;
      const existing = liveData.get(stream);
      const high24h = existing ? existing.high24h : price * 1.025;
      const low24h = existing ? existing.low24h : price * 0.975;

      liveData.set(stream, {
        symbol: meta.symbol,
        name: meta.name,
        price,
        change24h: d.usd_24h_change,
        volume24h: d.usd_24h_vol,
        marketCap: d.usd_market_cap,
        high24h,
        low24h,
      });
    }

    console.log(`[price-feed] CoinGecko data loaded for ${Object.keys(data).length} assets`);
  } catch (err) {
    console.error(`[price-feed] CoinGecko fetch failed:`, (err as Error).message);
  }
}

// ── Reconnection logic ──────────────────────────────────────────────
function startReconnectLoop() {
  setInterval(() => {
    if (!wsConnected) {
      console.log(`[price-feed] Attempting Binance reconnection...`);
      try {
        if (ws) ws.terminate();
      } catch {
        // ignore
      }
      connectBinance();
    }
  }, 15_000);
}

// ── Bootstrap ───────────────────────────────────────────────────────
const PORT = 3005;

// Initial CoinGecko fetch so we have data immediately
fetchCoinGecko().then(() => {
  // Broadcast every 2 seconds
  broadcastInterval = setInterval(broadcastPrices, 2000);

  // CoinGecko fallback every 30 seconds (only if WS is down)
  coingeckoInterval = setInterval(() => {
    if (!wsConnected) {
      fetchCoinGecko();
    }
  }, 30_000);

  // Start Binance WebSocket
  connectBinance();
  startReconnectLoop();
});

io.listen(PORT);
console.log(`[price-feed] Socket.IO server running on port ${PORT}`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log(`\n[price-feed] Shutting down...`);
  if (broadcastInterval) clearInterval(broadcastInterval);
  if (coingeckoInterval) clearInterval(coingeckoInterval);
  if (ws) ws.terminate();
  io.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (broadcastInterval) clearInterval(broadcastInterval);
  if (coingeckoInterval) clearInterval(coingeckoInterval);
  if (ws) ws.terminate();
  io.close();
  process.exit(0);
});