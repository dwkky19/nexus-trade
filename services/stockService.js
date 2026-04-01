/**
 * Stock Service — Yahoo Finance IDX Data Fetcher
 * Uses yahoo-finance2 with .JK suffix for Indonesian stocks
 */

let yahooFinance;

// Dynamic import for yahoo-finance2 (ESM-only module, exports a class)
async function getYF() {
  if (!yahooFinance) {
    try {
      const mod = await import('yahoo-finance2');
      const YahooFinance = mod.default;
      yahooFinance = new YahooFinance();
    } catch (e) {
      console.error('[StockService] Failed to import yahoo-finance2:', e.message);
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
const CACHE_TTL_OPEN = 10000;   // 10s saat market buka
const CACHE_TTL_CLOSED = 300000; // 5 menit saat tutup

/**
 * Convert local ticker to Yahoo Finance format
 */
function toYahooSymbol(sym) {
  if (sym === 'IHSG') return '^JKSE';
  return `${sym}.JK`;
}

/**
 * Fetch quotes for all tracked symbols + IHSG
 */
async function fetchAllQuotes(isMarketOpen = false) {
  const now = Date.now();
  const ttl = isMarketOpen ? CACHE_TTL_OPEN : CACHE_TTL_CLOSED;
  
  // Return cache if still fresh
  if (priceCacheTime > 0 && (now - priceCacheTime) < ttl && Object.keys(priceCache).length > 0) {
    return priceCache;
  }
  
  const yf = await getYF();
  if (!yf) throw new Error('yahoo-finance2 not available');
  
  const yahooSymbols = SYMBOLS.map(toYahooSymbol);
  yahooSymbols.push('^JKSE'); // IHSG
  
  const result = {};
  
  // Fetch in batches of 10 to avoid rate limiting
  for (let i = 0; i < yahooSymbols.length; i += 10) {
    const batch = yahooSymbols.slice(i, i + 10);
    
    try {
      const quotes = await Promise.allSettled(
        batch.map(sym => yf.quote(sym).catch(e => null))
      );
      
      quotes.forEach((q, idx) => {
        if (q.status === 'fulfilled' && q.value) {
          const data = q.value;
          const localSym = batch[idx] === '^JKSE' ? 'IHSG' : batch[idx].replace('.JK', '');
          
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
            time: data.regularMarketTime ? new Date(data.regularMarketTime * 1000).toISOString() : null,
            // Extra fields if available
            trailingPE: data.trailingPE || null,
            forwardPE: data.forwardPE || null,
            dividendYield: data.dividendYield ? data.dividendYield * 100 : null,
            bookValue: data.bookValue || null,
            priceToBook: data.priceToBook || null,
            beta: data.beta || null,
          };
        }
      });
      
      // Small delay between batches
      if (i + 10 < yahooSymbols.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.error(`[StockService] Batch fetch error:`, err.message);
    }
  }
  
  // Update cache
  if (Object.keys(result).length > 0) {
    priceCache = result;
    priceCacheTime = now;
  }
  
  return result;
}

/**
 * Fetch detailed quote for a single symbol
 * Note: yahoo-finance2 v2.14 only has quote() and autoc() methods
 */
async function fetchStockDetail(symbol) {
  const yf = await getYF();
  if (!yf) throw new Error('yahoo-finance2 not available');
  
  const yahooSym = toYahooSymbol(symbol);
  
  try {
    const q = await yf.quote(yahooSym);
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
      forwardPE: q.forwardPE || null,
      pbv: q.priceToBook || null,
      dividendYield: q.dividendYield ? q.dividendYield * 100 : null,
      beta: q.beta || null,
      bookValue: q.bookValue || null,
      eps: q.epsTrailingTwelveMonths || null,
    };
  } catch (err) {
    console.error(`[StockService] Detail fetch error for ${symbol}:`, err.message);
    throw err;
  }
}

/**
 * Fetch historical candle data
 * Note: chart() is not available in yahoo-finance2 v2.14
 * The frontend generates its own candle charts from simulation data
 */
async function fetchHistorical(symbol, period = '3mo', interval = '1d') {
  // chart() method is not available in this version of yahoo-finance2
  // Return empty array - the frontend has its own candle chart generator
  console.log(`[StockService] Historical data requested for ${symbol} — using frontend simulation`);
  return [];
}

/**
 * Get list of all tracked symbols
 */
function getSymbols() {
  return [...SYMBOLS];
}

/**
 * Clear cache (force refresh)
 */
function clearCache() {
  priceCache = {};
  priceCacheTime = 0;
}

module.exports = {
  fetchAllQuotes,
  fetchStockDetail,
  fetchHistorical,
  getSymbols,
  clearCache,
  SYMBOLS
};
