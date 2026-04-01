/**
 * NexusTrade PRO v5.0 — Express + WebSocket Server
 * IDX Intelligence Platform with Real-time Data
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const { getMarketStatus } = require('./services/marketService');
const stockService = require('./services/stockService');
const newsService = require('./services/newsService');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const PRICE_REFRESH_MS = parseInt(process.env.PRICE_REFRESH_MS) || 10000;

// ─── Middleware ───
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── WebSocket Server ───
const wss = new WebSocketServer({ server, path: '/ws' });

let wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected. Total: ${wsClients.size}`);
  
  // Send immediate data on connect
  sendInitialData(ws);
  
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${wsClients.size}`);
  });
  
  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
    wsClients.delete(ws);
  });
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wsClients.forEach(ws => {
    if (ws.readyState === 1) { // OPEN
      ws.send(msg);
    }
  });
}

async function sendInitialData(ws) {
  try {
    const market = getMarketStatus();
    const prices = await stockService.fetchAllQuotes(market.isOpen).catch(() => ({}));
    const news = await newsService.fetchNews().catch(() => []);
    
    const msg = JSON.stringify({
      type: 'init',
      data: { market, prices, news: news.slice(0, 12) },
      timestamp: new Date().toISOString()
    });
    
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  } catch (err) {
    console.error('[WS] Init data error:', err.message);
  }
}

// ─── REST API Routes ───

// Market status
app.get('/api/market', (req, res) => {
  res.json(getMarketStatus());
});

// All stock prices
app.get('/api/stocks/prices', async (req, res) => {
  try {
    const market = getMarketStatus();
    const prices = await stockService.fetchAllQuotes(market.isOpen);
    res.json({
      success: true,
      market,
      data: prices,
      source: 'yahoo-finance',
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('[API] Error fetching prices:', err.message);
    res.status(500).json({ success: false, error: err.message, source: 'error' });
  }
});

// Single stock detail
app.get('/api/stocks/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const detail = await stockService.fetchStockDetail(symbol);
    res.json({ success: true, data: detail });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Historical data
app.get('/api/stocks/:symbol/history', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const period = req.query.period || '3mo';
    const interval = req.query.interval || '1d';
    const data = await stockService.fetchHistorical(symbol, period, interval);
    res.json({ success: true, data, symbol, period, interval });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// IHSG
app.get('/api/ihsg', async (req, res) => {
  try {
    const market = getMarketStatus();
    const prices = await stockService.fetchAllQuotes(market.isOpen);
    const ihsg = prices['IHSG'] || null;
    res.json({ success: true, data: ihsg, market });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// News
app.get('/api/news', async (req, res) => {
  try {
    const news = await newsService.fetchNews();
    res.json({ success: true, data: news, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// News ticker
app.get('/api/news/ticker', async (req, res) => {
  try {
    const ticker = await newsService.getTickerNews();
    res.json({ success: true, data: ticker });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Force refresh
app.post('/api/refresh', async (req, res) => {
  try {
    stockService.clearCache();
    newsService.clearCache();
    const market = getMarketStatus();
    const prices = await stockService.fetchAllQuotes(market.isOpen);
    const news = await newsService.fetchNews();
    
    broadcast('prices', prices);
    broadcast('news', news.slice(0, 12));
    
    res.json({ success: true, message: 'Data refreshed', stocks: Object.keys(prices).length, news: news.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// All symbols
app.get('/api/symbols', (req, res) => {
  res.json({ success: true, data: stockService.getSymbols() });
});

// Catch-all: serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Background Jobs ───

// Price refresh loop
let priceInterval;

function startPriceLoop() {
  if (priceInterval) clearInterval(priceInterval);
  
  priceInterval = setInterval(async () => {
    try {
      const market = getMarketStatus();
      
      // Broadcast market status
      broadcast('market', market);
      
      // Fetch and broadcast prices
      const prices = await stockService.fetchAllQuotes(market.isOpen);
      if (Object.keys(prices).length > 0) {
        broadcast('prices', prices);
      }
    } catch (err) {
      console.error('[Loop] Price refresh error:', err.message);
    }
  }, PRICE_REFRESH_MS);
}

// News refresh: every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    newsService.clearCache();
    const news = await newsService.fetchNews();
    if (news.length > 0) {
      broadcast('news', news.slice(0, 12));
      broadcast('ticker', await newsService.getTickerNews());
    }
    console.log(`[Cron] News refreshed: ${news.length} items`);
  } catch (err) {
    console.error('[Cron] News refresh error:', err.message);
  }
});

// ─── Start Server ───
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   NEXUS_TRADE PRO v5.0                      ║');
  console.log('║   IDX Intelligence Platform                  ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   🌐 http://localhost:${PORT}                   ║`);
  console.log(`║   🔌 WebSocket: ws://localhost:${PORT}/ws       ║`);
  console.log('║   📊 Yahoo Finance IDX Data                  ║');
  console.log('║   📰 RSS News Auto-refresh                   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  
  const market = getMarketStatus();
  console.log(`[Market] ${market.isOpen ? '🟢 BUKA' : '🔴 TUTUP'} — ${market.time} — ${market.sess}`);
  console.log(`[Config] Price refresh: ${PRICE_REFRESH_MS}ms`);
  console.log('');
  
  // Start background price loop
  startPriceLoop();
  
  // Initial data fetch
  console.log('[Init] Fetching initial data...');
  stockService.fetchAllQuotes(market.isOpen)
    .then(prices => console.log(`[Init] Loaded ${Object.keys(prices).length} stock prices`))
    .catch(err => console.error('[Init] Price fetch failed:', err.message));
  
  newsService.fetchNews()
    .then(news => console.log(`[Init] Loaded ${news.length} news items`))
    .catch(err => console.error('[Init] News fetch failed:', err.message));
});
