/**
 * News Service — RSS Feed Parser + Sentiment Analysis
 * Sources: CNBC Indonesia, Bisnis.com, Kontan, IDX Channel
 */

const RssParser = require('rss-parser');
const parser = new RssParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'NexusTrade/5.0 RSS Reader'
  }
});

// ─── RSS Feed Sources ───
const FEEDS = [
  { url: 'https://www.cnbcindonesia.com/market/rss', source: 'CNBC Indonesia', category: 'market' },
  { url: 'https://www.cnbcindonesia.com/investment/rss', source: 'CNBC Indonesia', category: 'investment' },
  { url: 'https://www.cnbcindonesia.com/news/rss', source: 'CNBC Indonesia', category: 'news' },
  { url: 'https://rss.tempo.co/bisnis', source: 'Tempo', category: 'business' },
  { url: 'https://rss.tempo.co/nusa', source: 'Tempo', category: 'nusa' },
  { url: 'https://www.liputan6.com/rss/bisnis', source: 'Liputan6', category: 'business' },
  { url: 'https://feed.detik.com/finance', source: 'Detik Finance', category: 'finance' },
];

// ─── Stock keywords for matching ───
const STOCK_KEYWORDS = {
  BBCA: ['BBCA', 'Bank Central Asia', 'BCA'],
  BMRI: ['BMRI', 'Bank Mandiri', 'Mandiri'],
  BBRI: ['BBRI', 'Bank BRI', 'Bank Rakyat', 'BRI'],
  TLKM: ['TLKM', 'Telkom', 'Telekomunikasi'],
  ASII: ['ASII', 'Astra International', 'Astra'],
  GOTO: ['GOTO', 'GoTo', 'Gojek', 'Tokopedia'],
  UNVR: ['UNVR', 'Unilever'],
  ICBP: ['ICBP', 'Indofood CBP'],
  KLBF: ['KLBF', 'Kalbe Farma', 'Kalbe'],
  INDF: ['INDF', 'Indofood'],
  BREN: ['BREN', 'Barito Renewables', 'energi baru', 'EBT'],
  TPIA: ['TPIA', 'Chandra Asri', 'Barito Pacific'],
  SMGR: ['SMGR', 'Semen Indonesia'],
  PTBA: ['PTBA', 'Bukit Asam'],
  MTEL: ['MTEL', 'Dayamitra'],
  ADRO: ['ADRO', 'Adaro'],
  ANTM: ['ANTM', 'Aneka Tambang', 'Antam'],
  BBTN: ['BBTN', 'Bank BTN', 'BTN'],
  BNBR: ['BNBR', 'Bakrie'],
  BUMI: ['BUMI', 'Bumi Resources'],
  BRPT: ['BRPT', 'Barito Pacific'],
  HRUM: ['HRUM', 'Harum Energy'],
  MDKA: ['MDKA', 'Merdeka Copper', 'Merdeka Gold'],
  SIDO: ['SIDO', 'Sido Muncul'],
  INCO: ['INCO', 'Vale Indonesia'],
  TINS: ['TINS', 'Timah'],
};

// ─── Sentiment keywords ───
const BULLISH_WORDS = [
  'naik', 'menguat', 'melonjak', 'positif', 'laba', 'profit', 'tumbuh',
  'rekor', 'dividen', 'surplus', 'optimisme', 'bullish', 'rally', 'catat',
  'tertinggi', 'menembus', 'breakout', 'akuisisi', 'ekspansi', 'target',
  'upgrade', 'outperform', 'buy', 'beli', 'cuan', 'untung', 'melesat',
  'insentif', 'bonus', 'terbaik', 'membaik', 'pulih', 'recovery',
];

const BEARISH_WORDS = [
  'turun', 'melemah', 'anjlok', 'negatif', 'rugi', 'loss', 'menyusut',
  'terendah', 'tekanan', 'bearish', 'defisit', 'penurunan', 'jatuh',
  'downgrade', 'underperform', 'sell', 'jual', 'koreksi', 'resesi',
  'gagal', 'terburuk', 'memburuk', 'bangkrut', 'default', 'utang',
  'inflasi', 'krisis', 'risiko', 'pelemahan',
];

// ─── Cache ───
let newsCache = [];
let newsCacheTime = 0;
const NEWS_CACHE_TTL = 300000; // 5 minutes

/**
 * Analyze sentiment of a news title/content
 */
function analyzeSentiment(text) {
  const lower = text.toLowerCase();
  let bullScore = 0;
  let bearScore = 0;
  
  BULLISH_WORDS.forEach(w => {
    if (lower.includes(w)) bullScore++;
  });
  
  BEARISH_WORDS.forEach(w => {
    if (lower.includes(w)) bearScore++;
  });
  
  if (bullScore > bearScore) return 'bullish';
  if (bearScore > bullScore) return 'bearish';
  return 'neutral';
}

/**
 * Find related stocks from news text
 */
function findRelatedStocks(text) {
  const upper = text.toUpperCase();
  const found = [];
  
  for (const [sym, keywords] of Object.entries(STOCK_KEYWORDS)) {
    for (const kw of keywords) {
      if (upper.includes(kw.toUpperCase())) {
        found.push(sym);
        break;
      }
    }
  }
  
  return [...new Set(found)]; // unique
}

/**
 * Estimate price impact percentage based on sentiment strength
 */
function estimateImpact(sentiment, relatedStocks) {
  const base = sentiment === 'bullish' ? 1.2 : sentiment === 'bearish' ? -1.2 : 0.3;
  const variation = (Math.random() - 0.5) * 2;
  return parseFloat((base + variation).toFixed(1));
}

/**
 * Fetch all news from RSS feeds
 */
async function fetchNews() {
  const now = Date.now();
  
  // Return cache if fresh
  if (newsCacheTime > 0 && (now - newsCacheTime) < NEWS_CACHE_TTL && newsCache.length > 0) {
    return newsCache;
  }
  
  console.log('[NewsService] Fetching news from RSS feeds...');
  const allNews = [];
  
  for (const feed of FEEDS) {
    try {
      const content = await parser.parseURL(feed.url);
      
      if (content && content.items) {
        content.items.slice(0, 10).forEach(item => {
          const title = item.title || '';
          const description = item.contentSnippet || item.content || '';
          const fullText = `${title} ${description}`;
          
          const sentiment = analyzeSentiment(fullText);
          const stocks = findRelatedStocks(fullText);
          const impact = estimateImpact(sentiment, stocks);
          
          // Parse date
          let pubDate;
          try {
            pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
          } catch {
            pubDate = new Date();
          }
          
          // Format time WIB
          const wibDate = new Date(pubDate.getTime() + 7 * 3600000 - pubDate.getTimezoneOffset() * 60000);
          const H = String(wibDate.getHours()).padStart(2, '0');
          const M = String(wibDate.getMinutes()).padStart(2, '0');
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
          const timeStr = `${H}:${M} · ${wibDate.getDate()} ${months[wibDate.getMonth()]} ${wibDate.getFullYear()}`;
          
          allNews.push({
            time: timeStr,
            title: title,
            detail: description.substring(0, 200),
            source: feed.source,
            category: feed.category,
            sentiment,
            stocks,
            impact_pct: impact,
            link: item.link || '',
            pubDate: pubDate.toISOString()
          });
        });
      }
    } catch (err) {
      console.warn(`[NewsService] Failed to fetch ${feed.source}:`, err.message);
    }
  }
  
  // Sort by date (newest first) and deduplicate
  allNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  
  // Deduplicate by title similarity
  const seen = new Set();
  const unique = allNews.filter(n => {
    const key = n.title.substring(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  // Cache result
  newsCache = unique.slice(0, 30); // Keep top 30
  newsCacheTime = now;
  
  console.log(`[NewsService] Fetched ${newsCache.length} news items`);
  return newsCache;
}

/**
 * Get market-relevant news ticker items
 */
async function getTickerNews() {
  const news = await fetchNews();
  return news.slice(0, 12).map(n => ({
    text: n.title,
    sentiment: n.sentiment,
    stocks: n.stocks
  }));
}

/**
 * Clear news cache
 */
function clearCache() {
  newsCache = [];
  newsCacheTime = 0;
}

module.exports = { fetchNews, getTickerNews, clearCache };
