'use strict';

const PRICE_CACHE_KEY = 'rgfPriceCacheV1';
const PRICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STORE_BASE = 'https://hobbii.de';
const STORE_URL = STORE_BASE + '/search/suggest.json';
const STORE_NAME = 'Hobbii (hobbii.de)';

const MATERIAL_WORDS = new Set([
  'silk', 'mohair', 'merino', 'alpaca', 'wool', 'cotton', 'linen', 'cashmere',
  'bamboo', 'acrylic', 'polyester', 'nylon', 'viscose', 'hemp', 'suri', 'yak'
]);

let priceCache = Object.create(null);

function tokenize(name) {
  return String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}

function pickProduct(products, queryTokens) {
  let best = null;
  let bestScore = 0;
  let bestToken = null;
  for (const p of products || []) {
    const price = parseFloat(p && p.price);
    if (!(price > 0)) continue;
    const title = String((p && p.title) || '');
    if (!title) continue;
    const toks = new Set(tokenize(title));
    let score = 0;
    let matchedToken = null;
    for (const t of queryTokens) {
      if (toks.has(t)) {
        score++;
        matchedToken = matchedToken || t;
      }
    }
    if (score > bestScore) {
      best = p;
      bestScore = score;
      bestToken = matchedToken;
    }
  }
  if (!best) return null;
  if (bestScore < 2 && !(bestToken && MATERIAL_WORDS.has(bestToken))) return null;
  return best;
}

function ballFromVariants(variants) {
  let cheapest = null;
  for (const v of variants || []) {
    const price = parseFloat(v && v.price);
    const grams = Number(v && (v.grams !== undefined && v.grams !== null ? v.grams : v.weight));
    if (!(price > 0)) continue;
    const unit = String((v && v.weight_unit) || 'g').toLowerCase();
    const gramsG = unit === 'kg' ? grams * 1000 : grams;
    if (!(gramsG > 0)) continue;
    if (!cheapest || price / gramsG < cheapest.price / cheapest.grams) {
      cheapest = { price, grams: gramsG, currency: String((v && v.price_currency) || 'EUR') };
    }
  }
  return cheapest;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function lookupPrice(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return { ok: false, reason: 'empty' };

  const key = name.toLowerCase();
  const now = Date.now();
  const hit = priceCache[key];
  if (hit && now - hit.t < PRICE_TTL_MS) {
    return hit.ok ? { ok: true, cached: true, ...hit.v } : { ok: false, cached: true };
  }

  try {
    const tokens = tokenize(name);
    if (!tokens.length) return { ok: false, reason: 'notokens' };

    const d = await fetchJson(STORE_URL + '?q=' + encodeURIComponent(name) + '&resources%5Btype%5D=product');
    const products = d && d.resources && d.resources.results && d.resources.results.products;
    const product = pickProduct(products, tokens);
    if (!product) return { ok: false, reason: 'nomatch' };

    const pd = await fetchJson(STORE_BASE + '/products/' + product.handle + '.json');
    const ball = ballFromVariants(pd && pd.product && pd.product.variants);
    if (!ball) return { ok: false, reason: 'noball' };

    const v = {
      title: product.title,
      url: STORE_BASE + '/products/' + product.handle,
      store: STORE_NAME,
      price: ball.price,
      currency: ball.currency,
      grams: ball.grams,
      perGram: ball.price / ball.grams
    };
    priceCache[key] = { t: Date.now(), ok: true, v };
    saveCache();
    return { ok: true, ...v };
  } catch (e) {
    priceCache[key] = { t: now, ok: false };
    saveCache();
    return { ok: false, reason: 'error' };
  }
}

function saveCache() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [PRICE_CACHE_KEY]: priceCache });
    }
  } catch (e) {
    /* ignore */
  }
}

function loadCache() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([PRICE_CACHE_KEY], (data) => {
        if (data && data[PRICE_CACHE_KEY] && typeof data[PRICE_CACHE_KEY] === 'object') {
          priceCache = data[PRICE_CACHE_KEY];
        }
      });
    }
  } catch (e) {
    /* ignore */
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  loadCache();
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'rgfPrice' || typeof msg.name !== 'string') return;
    lookupPrice(msg.name).then((res) => sendResponse(res));
    return true;
  });
}

if (typeof globalThis !== 'undefined') {
  globalThis.__rgfPriceDebug = { lookupPrice, pickProduct, tokenize, ballFromVariants };
}
