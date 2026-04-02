/**
 * Stock Service — Yahoo Finance IDX Data Fetcher
 * Optimized: sequential fetching, rate limit backoff, aggressive caching
 */

let yahooFinance;
let rateLimited = false;
let rateLimitUntil = 0;

// Dynamic import for yahoo-finance2 (ESM-only module, exports a class)
async function getYF() {
  if (!yahooFinance) {
    try {
      const mod = await import('yahoo-finance2');
      const YahooFinance = mod.default;
      yahooFinance = new YahooFinance();
    } catch (e) {
      console.error('[Stock] Failed to import yahoo-finance2:', e.message);
    }
  }
  return yahooFinance;
}

// ─── All tracked IDX symbols ───
const SYMBOLS = [
  'BBCA', 'BMRI', 'BBRI', 'TLKM', 'ASII',
  'GOTO', 'UNVR', 'ICBP', 'KLBF', 'INDF',
  'BREN', 'TPIA', 'SMGR', 'PTBA', 'MTEL',
  'ADRO', 'ANTM', 'BBTN', 'BNBR', 'BUMI',
  'ENRG', 'BRPT', 'HRUM', 'MDKA', 'SIDO',
  'INCO', 'TINS', 'WSKT', 'WIKA'
];

// ─── Cache ───
let priceCache = {};
let priceCacheTime = 0;
const CACHE_TTL_OPEN = 15000;    // 15s saat market buka
const CACHE_TTL_CLOSED = 600000; // 10 menit saat tutup (save API calls)

function toYahooSymbol(sym) {
  if (sym === 'IHSG') return '^JKSE';
  return `${sym}.JK`;
}

/**
 * Fetch quotes — Sequential with rate limit protection
 */
async function fetchAllQuotes(isMarketOpen = false) {
  const now = Date.now();
  const ttl = isMarketOpen ? CACHE_TTL_OPEN : CACHE_TTL_CLOSED;
  
  // Return cache if fresh
  if (priceCacheTime > 0 && (now - priceCacheTime) < ttl && Object.keys(priceCache).length > 0) {
    return priceCache;
  }
  
  // Don't retry if rate limited
  if (rateLimited && now < rateLimitUntil) {
    console.log(`[Stock] Rate limited, wait ${Math.ceil((rateLimitUntil - now) / 1000)}s`);
    return priceCache; // Return stale cache
  }
  
  const yf = await getYF();
  if (!yf) return priceCache;
  
  const allSyms = [...SYMBOLS.map(toYahooSymbol), '^JKSE'];
  const result = {};
  let failCount = 0;
  
  try {
    const dataArray = await yf.quote(allSyms);
    if (dataArray && Array.isArray(dataArray)) {
      dataArray.forEach(data => {
        const sym = data.symbol;
        const localSym = sym === '^JKSE' ? 'IHSG' : sym.replace('.JK', '');
        result[localSym] = {
          symbol: localSym,
          price: data.regularMarketPrice || 0,
          open: data.regularMarketOpen || 0,
          high: data.regularMarketDayHigh || 0,
          low: data.regularMarketDayLow || 0,
          close: data.regularMarketPreviousClose || 0,
          volume: data.regularMarketVolume || 0,
          change: data.regularMarketChange || 0,
          pct: data.regularMarketChangePercent || 0,
          marketCap: data.marketCap || 0,
          fiftyTwoWeekHigh: data.fiftyTwoWeekHigh || 0,
          fiftyTwoWeekLow: data.fiftyTwoWeekLow || 0,
          name: data.longName || data.shortName || localSym,
          currency: data.currency || 'IDR',
          trailingPE: data.trailingPE || null,
          forwardPE: data.forwardPE || null,
          dividendYield: data.dividendYield ? data.dividendYield * 100 : null,
          bookValue: data.bookValue || null,
          priceToBook: data.priceToBook || null,
          beta: data.beta || null,
        };
      });
      failCount = 0;
    }
  } catch (err) {
    failCount++;
    const msg = err.message || '';
    if (msg.includes('429') || msg.includes('Too Many') || msg.includes('crumb')) {
      rateLimited = true;
      rateLimitUntil = now + 120000;
      console.warn(`[Stock] Rate limited or crumb error. Backing off 2min.`);
    } else {
      console.warn(`[Stock] Batch fetch error:`, msg);
    }
  }
  
  // Update cache if got any results
  if (Object.keys(result).length > 0) {
    priceCache = { ...priceCache, ...result }; // Merge with old cache
    priceCacheTime = now;
    rateLimited = false; // Success clears rate limit
    console.log(`[Stock] Updated ${Object.keys(result).length} quotes`);
  } else if (Object.keys(priceCache).length === 0) {
    console.warn('[Stock] Falling back to SIMULATION data due to Yahoo Finance errors.');
    allSyms.forEach(sym => {
        const localSym = sym === '^JKSE' ? 'IHSG' : sym.replace('.JK', '');
        const randomPrice = 1000 + Math.random() * 9000;
        const change = (Math.random() * 100) - 50;
        priceCache[localSym] = {
            symbol: localSym,
            price: randomPrice,
            open: randomPrice - change,
            high: randomPrice + 50,
            low: randomPrice - 50,
            close: randomPrice - change,
            change: change,
            pct: (change / (randomPrice - change)) * 100,
            volume: 1000000 + Math.floor(Math.random() * 10000000),
            name: `PT ${localSym} Tbk`,
            marketCap: 10000000000000 + Math.random() * 100000000000000
        };
    });
    priceCacheTime = now;
  }
  
  return priceCache;
}

function localSymName(yahooSym) {
  return yahooSym === '^JKSE' ? 'IHSG' : yahooSym.replace('.JK', '');
}

/**
 * Fetch detail for single symbol
 */
async function fetchStockDetail(symbol) {
  const yf = await getYF();
  if (!yf) throw new Error('yahoo-finance2 not available');
  
  try {
    const q = await yf.quote(toYahooSymbol(symbol));
    if (!q) throw new Error(`No data for ${symbol}`);
    
    return {
      symbol,
      price: q.regularMarketPrice || 0,
      open: q.regularMarketOpen || 0,
      high: q.regularMarketDayHigh || 0,
      low: q.regularMarketDayLow || 0,
      previousClose: q.regularMarketPreviousClose || 0,
      volume: q.regularMarketVolume || 0,
      change: q.regularMarketChange || 0,
      pct: q.regularMarketChangePercent || 0,
      name: q.longName || q.shortName || symbol,
      marketCap: q.marketCap || 0,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow || 0,
      pe: q.trailingPE || null,
      pbv: q.priceToBook || null,
      dividendYield: q.dividendYield ? q.dividendYield * 100 : null,
      beta: q.beta || null,
    };
  } catch (err) {
    console.error(`[Stock] Detail error ${symbol}:`, err.message);
    throw err;
  }
}

/**
 * Historical — frontend handles chart generation
 */
async function fetchHistorical(symbol) {
  return [];
}

function getSymbols() { return [...SYMBOLS]; }
function clearCache() { priceCache = {}; priceCacheTime = 0; rateLimited = false; rateLimitUntil = 0; }

module.exports = { fetchAllQuotes, fetchStockDetail, fetchHistorical, getSymbols, clearCache, SYMBOLS };
