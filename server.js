/**
 * NexusTrade PRO v5.0 — Express + WebSocket Server
 * Optimized for public deployment: gzip, security headers, rate-limit safe
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const compression = require('compression');

const { getMarketStatus } = require('./services/marketService');
const stockService = require('./services/stockService');
const newsService = require('./services/newsService');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const PRICE_REFRESH_MS = parseInt(process.env.PRICE_REFRESH_MS) || 30000; // 30s default (avoid rate limit)

// ─── Middleware (Performance + Security) ───
app.use(compression({ level: 6 }));          // Gzip — 70%+ smaller HTML/JSON
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Static files with aggressive caching (fonts, css = 1 day)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true
}));

// ─── WebSocket Server ───
const wss = new WebSocketServer({ server, path: '/ws' });
let wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] +Client (${wsClients.size} total)`);
  
  // Send immediate cached data on connect — no extra API calls
  sendCachedData(ws);
  
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] -Client (${wsClients.size} total)`);
  });
  
  ws.on('error', () => wsClients.delete(ws));
  
  // Ping/pong keepalive
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Keepalive interval — clean dead connections
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

function broadcast(type, data) {
  if (wsClients.size === 0) return; // Skip if no clients
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wsClients.forEach(ws => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

// ─── Cached data store (avoid repeated API calls) ───
let cachedPrices = {};
let cachedNews = [];
let cachedMarket = getMarketStatus();

function sendCachedData(ws) {
  try {
    const msg = JSON.stringify({
      type: 'init',
      data: {
        market: cachedMarket,
        prices: cachedPrices,
        news: cachedNews.slice(0, 12)
      },
      ts: Date.now()
    });
    if (ws.readyState === 1) ws.send(msg);
  } catch (e) {
    console.error('[WS] Init send error:', e.message);
  }
}

// ─── REST API Routes ───

app.get('/api/market', (req, res) => {
  res.json(cachedMarket);
});

app.get('/api/stocks/prices', (req, res) => {
  res.json({
    success: true,
    market: cachedMarket,
    data: cachedPrices,
    source: Object.keys(cachedPrices).length > 0 ? 'yahoo-finance' : 'simulation',
    updatedAt: new Date().toISOString()
  });
});

app.get('/api/stocks/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    // Return from cache first
    if (cachedPrices[sym]) {
      return res.json({ success: true, data: cachedPrices[sym], source: 'cache' });
    }
    const detail = await stockService.fetchStockDetail(sym);
    res.json({ success: true, data: detail });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stocks/:symbol/history', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    const data = await stockService.fetchHistorical(sym, req.query.period, req.query.interval);
    res.json({ success: true, data, symbol: sym });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/ihsg', (req, res) => {
  const ihsg = cachedPrices['IHSG'] || null;
  res.json({ success: true, data: ihsg, market: cachedMarket });
});

app.get('/api/news', (req, res) => {
  res.json({ success: true, data: cachedNews, updatedAt: new Date().toISOString() });
});

app.get('/api/news/ticker', (req, res) => {
  const ticker = cachedNews.slice(0, 12).map(n => ({
    text: n.title, sentiment: n.sentiment, stocks: n.stocks
  }));
  res.json({ success: true, data: ticker });
});

app.post('/api/refresh', async (req, res) => {
  try {
    stockService.clearCache();
    newsService.clearCache();
    await refreshAllData();
    res.json({ success: true, message: 'Data refreshed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/symbols', (req, res) => {
  res.json({ success: true, data: stockService.getSymbols() });
});

// Health check for uptime monitoring
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    clients: wsClients.size,
    market: cachedMarket.isOpen ? 'open' : 'closed',
    stocks: Object.keys(cachedPrices).length,
    news: cachedNews.length
  });
});

// Catch-all: serve index.html (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Background Data Refresh ───

async function refreshPrices() {
  try {
    cachedMarket = getMarketStatus();
    broadcast('market', cachedMarket);
    
    const prices = await stockService.fetchAllQuotes(cachedMarket.isOpen);
    if (prices && Object.keys(prices).length > 0) {
      cachedPrices = prices;
      broadcast('prices', cachedPrices);
      return true;
    }
  } catch (err) {
    console.error('[Refresh] Price error:', err.message);
  }
  return false;
}

async function refreshNews() {
  try {
    newsService.clearCache();
    const news = await newsService.fetchNews();
    if (news && news.length > 0) {
      cachedNews = news;
      broadcast('news', cachedNews.slice(0, 12));
      console.log(`[Cron] News: ${news.length} items`);
    }
  } catch (err) {
    console.error('[Refresh] News error:', err.message);
  }
}

async function refreshAllData() {
  await Promise.allSettled([refreshPrices(), refreshNews()]);
}

// Price refresh loop — adaptive interval
let priceLoopRunning = false;
async function priceLoop() {
  if (priceLoopRunning) return;
  priceLoopRunning = true;
  
  await refreshPrices();
  
  priceLoopRunning = false;
}

// Start price loop
setInterval(priceLoop, PRICE_REFRESH_MS);

// News refresh: every 5 minutes
cron.schedule('*/5 * * * *', refreshNews);

// Market status broadcast: every 15 seconds (lightweight)
setInterval(() => {
  cachedMarket = getMarketStatus();
  broadcast('market', cachedMarket);
}, 15000);

// ─── Start Server ───
server.listen(PORT, '0.0.0.0', async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   NEXUSTRADE PRO v5.0 — Production Ready        ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║   🌐 Local:  http://localhost:${PORT}                ║`);
  console.log(`║   🔌 WS:     ws://localhost:${PORT}/ws              ║`);
  console.log('║   📦 Gzip:   ON (compression)                    ║');
  console.log('║   🛡️  Headers: Security enabled                   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  
  const m = getMarketStatus();
  console.log(`[Market] ${m.isOpen ? '🟢 BUKA' : '🔴 TUTUP'} — ${m.time} — ${m.sess}`);
  console.log(`[Config] Price refresh: ${PRICE_REFRESH_MS / 1000}s | News: 5min`);
  console.log('');
  
  // Initial data fetch
  console.log('[Init] Loading data...');
  await refreshAllData();
  console.log(`[Init] ✅ ${Object.keys(cachedPrices).length} stocks, ${cachedNews.length} news`);
  
  // Start public tunnel
  startTunnel();
});

// ─── Public Tunnel (localtunnel) ───
async function startTunnel() {
  try {
    const localtunnel = require('localtunnel');
    const tunnel = await localtunnel({ port: PORT, subdomain: 'nexustrade-pro' });
    
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   🌍 PUBLIC ACCESS READY                        ║');
    console.log(`║   🔗 ${tunnel.url.padEnd(42)}║`);
    console.log('║   📱 Share link ini ke siapa saja!               ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    
    tunnel.on('close', () => {
      console.log('[Tunnel] Closed. Restarting in 10s...');
      setTimeout(startTunnel, 10000);
    });
    
    tunnel.on('error', (err) => {
      console.error('[Tunnel] Error:', err.message);
    });
  } catch (err) {
    console.error('[Tunnel] Failed to start:', err.message);
    console.log('[Tunnel] Website tetap bisa diakses di http://localhost:' + PORT);
    console.log('[Tunnel] Untuk public access, install ngrok: https://ngrok.com');
  }
}
