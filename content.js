(() => {
  'use strict';

  if (window.__rgfLoaded) return;
  window.__rgfLoaded = true;

  const GRAMS_PER_OUNCE = 28.349523125;
  const GRAMS_PER_POUND = 453.59237;
  const METERS_PER_YARD = 0.9144;
  const CACHE_KEY = 'rgfCacheV4';
  const FILTER_KEY = 'rgfFilter';
  const STATUS_KEY = 'rgfStatus';
  const ENABLED_KEY = 'rgfEnabled';
  const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

  const PROJECT_RE = /^\/projects\/[^/]+\/([^/?#]+)\/?$/;
  const PATTERN_RE = /^\/patterns\/library\/([^/?#]+)\/?$/;

  const PAGE_SIZE = 25;

  const WEIGHT_M_PER_100G = [
    [/super\s+bulky|super\s+chunky/, 60, 'super bulky'],
    [/light\s+fingering/, 450, 'light fingering'],
    [/light\s+worsted/, 220, 'light worsted'],
    [/heavy\s+worsted/, 150, 'heavy worsted'],
    [/\bbulky\b|\bchunky\b/, 100, 'bulky'],
    [/\baran\b/, 150, 'aran'],
    [/\bworsted\b/, 180, 'worsted'],
    [/\bdk\b|double[ -]knit(ting)?/, 220, 'dk'],
    [/\bsport\b|\b5[ -]ply\b/, 300, 'sport'],
    [/\bfingering\b|\bsock\b|\b4[ -]ply\b|\b3[ -]ply\b/, 370, 'fingering'],
    [/\blace\b|\bcobweb\b|\b2[ -]ply\b|\b1[ -]ply\b/, 600, 'lace']
  ];

  let isTop = true;
  try {
    isTop = window.self === window.top;
  } catch (e) {
    isTop = false;
  }

  let cache = Object.create(null);
  let minG = null;
  let maxG = null;
  let hideUnknown = false;
  let price100 = 10;
  let panel = null;
  let tabId = null;
  let enabled = true;

  const rows = new Map();
  const inflight = new Map();

  function parseNumber(raw) {
    const n = parseFloat(String(raw).replace(/,/g, '').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  const ALL_WEIGHT_NAMES_RE =
    /(super\s+bulky|super\s+chunky|light\s+fingering|light\s+worsted|heavy\s+worsted|worsted|fingering|sock|sport|dk|double[ -]knit(ting)?|aran|bulky|chunky|cobweb|lace|\d[ -]ply)/g;

  function combinedDensity(weightText) {
    const src = String(weightText || '');
    const eqIdx = src.indexOf('=');
    const strandsText = eqIdx >= 0 ? src.slice(0, eqIdx) : src;
    let t =
      ' ' +
      strandsText
        .toLowerCase()
        .replace(ALL_WEIGHT_NAMES_RE, (m) => ' ' + m + ' ') +
      ' ';
    let gpm = 0;
    const names = [];
    for (const [re, mPer100g, name] of WEIGHT_M_PER_100G) {
      const m = re.exec(t);
      if (m) {
        gpm += 100 / mPer100g;
        names.push(name);
        t = t.split(m[0]).join(' ');
      }
    }
    return names.length
      ? { gpm, names, combined: names.length >= 2 }
      : null;
  }

  function addMass(result, text) {
    const units = [
      { re: /(\d[\d.,]*)\s*(?:kilograms?|kgs?\.?|kg)\b/gi, factor: 1000 },
      { re: /(\d[\d.,]*)\s*(?:pounds?|lbs?\.?|lb)\b/gi, factor: GRAMS_PER_POUND },
      { re: /(\d[\d.,]*)\s*(?:ounces?|oz\.?|oz)\b/gi, factor: GRAMS_PER_OUNCE },
      { re: /(\d[\d.,]*)\s*(?:grams?|g)\b/gi, factor: 1 }
    ];
    let matched = false;
    for (const { re, factor } of units) {
      for (const m of text.matchAll(re)) {
        const n = parseNumber(m[1]);
        if (n !== null) {
          result.grams = (result.grams || 0) + n * factor;
          matched = true;
        }
      }
    }
    if (matched) {
      result.hasGramData = true;
      result.estimated = false;
    }
  }

  function labeledFieldText(doc, label) {
    const wanted = label.toLowerCase();
    for (const el of doc.querySelectorAll('h5, h4, h3, label, .fact_label, .label, dt, span')) {
      if (el.children.length === 0 && el.textContent.trim().toLowerCase() === wanted) {
        if (el.parentElement) return el.parentElement.textContent;
      }
    }
    return '';
  }

  function parseYardageMeters(yardText) {
    const mRange = /([\d.,]+)\s*(?:-|–|to)?\s*([\d.,]+)?\s*(?:meters?|m)\b/i.exec(yardText);
    const yRange = /([\d.,]+)\s*(?:-|–|to)?\s*([\d.,]+)?\s*(?:yards?|yds?)\b/i.exec(yardText);
    if (mRange) {
      const a = parseNumber(mRange[1]);
      const b = mRange[2] ? parseNumber(mRange[2]) : null;
      const meters = b !== null && b >= a ? (a + b) / 2 : a;
      return meters > 0 ? meters : null;
    }
    if (yRange) {
      const a = parseNumber(yRange[1]);
      const b = yRange[2] ? parseNumber(yRange[2]) : null;
      const yards = b !== null && b >= a ? (a + b) / 2 : a;
      return yards > 0 ? yards * METERS_PER_YARD : null;
    }
    return null;
  }

  function attachStrands(result, yarnBlocks, combined) {
    if (!yarnBlocks || !yarnBlocks.length) return;
    result.suggested = yarnBlocks.map((b) => ({ name: b.name, gpm: b.gpm }));
    result.strandCount = combined && combined.combined ? combined.names.length : 1;
  }

  function suggestedYarnDensity(bodyText) {
    const m = /([\d.,]+)\s*(?:meters?|m)\s*\/\s*([\d.,]+)\s*(?:grams?|g)\b/i.exec(bodyText);
    if (!m) return null;
    const meters = parseNumber(m[1]);
    const grams = parseNumber(m[2]);
    if (!meters || !grams || meters <= 0) return null;
    return grams / meters;
  }

  function suggestedYarnBlocks(doc) {
    const out = [];
    const seen = new Set();
    for (const block of doc.querySelectorAll('.yarn_summary')) {
      if (block.querySelector('.yarn_summary')) continue;
      const a = block.querySelector('.yarn_name a[href*="/yarns/library/"]');
      if (!a) continue;
      const slug = (a.getAttribute('href') || '').replace(/^.*\/yarns\/library\//, '').replace(/\/.*$/, '');
      if (seen.has(slug)) continue;
      seen.add(slug);
      const yardText = ((block.querySelector('.yardage') || block).textContent || '').replace(/\s+/g, ' ');
      let m = /([\d.,]+)\s*(?:meters?|metres?|m)\b\s*\/\s*([\d.,]+)\s*(?:grams?|g)\b/i.exec(yardText);
      let factor = 1;
      if (!m) {
        m = /([\d.,]+)\s*(?:yards?|yds?)\b\s*\/\s*([\d.,]+)\s*(?:grams?|g)\b/i.exec(yardText);
        factor = METERS_PER_YARD;
      }
      if (!m) continue;
      const meters = parseNumber(m[1]);
      const grams = parseNumber(m[2]);
      if (!meters || !grams || meters <= 0 || grams <= 0) continue;
      out.push({
        name: (a.textContent || '').trim(),
        gpm: grams / (meters * factor),
        metersPerBall: meters * factor,
        gramsPerBall: grams
      });
    }
    return out;
  }

  function parseDefault(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
    const bodyText = doc.body ? doc.body.textContent : '';

    const result = { grams: null, hasGramData: false, estimated: false, otherData: false, error: false };

    const packScope =
      doc.querySelector('#packs') ||
      doc.querySelector('.packs') ||
      doc.querySelector('#yarn_used') ||
      doc.querySelector('.yarn_used');

    if (packScope) {
      addMass(result, packScope.textContent);
      if (result.hasGramData) {
        result.grams = Math.round(result.grams);
        return result;
      }
      result.otherData = /\b(yards?|meters?|skeins?|balls?|hanks?)\b|how much/i.test(packScope.textContent);
      return result;
    }

    const yardText = labeledFieldText(doc, 'Yardage') || labeledFieldText(doc, 'How much?');
    const weightText = labeledFieldText(doc, 'Yarn weight');
    const combined = combinedDensity(weightText);
    addMass(result, yardText);
    const yarnBlocks = suggestedYarnBlocks(doc);
    if (result.hasGramData) {
      result.grams = Math.round(result.grams);
      attachStrands(result, yarnBlocks, combined);
      return result;
    }

    const meters = parseYardageMeters(yardText);
    const suggested = yarnBlocks.length ? yarnBlocks[0].gpm : suggestedYarnDensity(bodyText);
    const gpm =
      combined && combined.combined
        ? combined.gpm
        : suggested !== null
          ? suggested
          : combined
            ? combined.gpm
            : null;

    if (meters && gpm) {
      result.grams = Math.round(meters * gpm);
      result.hasGramData = true;
      result.estimated = true;
      attachStrands(result, yarnBlocks, combined);
      result.note =
        'Estimated from ' +
        Math.round(meters) +
        ' m of yarn (' +
        (combined ? combined.names.join(' + ') : 'single weight') +
        ' ≈ ' +
        gpm.toFixed(2) +
        ' g/m). The exact weight depends on the yarn you choose.';
      return result;
    }

    result.otherData = Boolean(yardText.trim() || /\b(skeins?|balls?|hanks?)\b/i.test(bodyText));
    return result;
  }

  const CURRENCY_SYMBOLS = { EUR: '\u20ac', USD: '$', GBP: '\u00a3' };

  function lookupPrice(name) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime || !chrome.runtime.sendMessage) return resolve(null);
        chrome.runtime.sendMessage({ type: 'rgfPrice', name }, (res) => {
          void chrome.runtime && chrome.runtime.lastError;
          resolve(res && res.ok && res.perGram > 0 ? res : null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function applyStoreCost(entry) {
    if (entry.costStoreDone || entry.grams === null || !entry.suggested || !entry.suggested.length) return;
    entry.costStoreDone = true;
    const strands = entry.suggested.slice(0, Math.max(1, entry.strandCount || 1));
    if (!strands.length) return;
    const lookups = await Promise.all(strands.map((s) => lookupPrice(s.name)));
    let sumGpm = 0;
    let weighted = 0;
    let storeCount = 0;
    let symbol = null;
    const sources = [];
    lookups.forEach((lk, i) => {
      const s = strands[i];
      sumGpm += s.gpm;
      if (lk) {
        storeCount++;
        weighted += s.gpm * lk.perGram;
        if (!symbol) symbol = CURRENCY_SYMBOLS[lk.currency] || '';
        sources.push(s.name + ' \u2192 ' + lk.title + ' (' + lk.price + ' ' + (CURRENCY_SYMBOLS[lk.currency] || lk.currency || '') + ' / ' + lk.grams + ' g)');
      } else {
        weighted += s.gpm * (price100 / 100);
        sources.push(s.name + ' \u2192 manual price/100g (' + price100 + ')');
      }
    });
    if (!sumGpm) return;
    const value = Math.max(1, Math.round((entry.grams / sumGpm) * weighted));
    entry.storeCost = { value, symbol: storeCount === lookups.length ? symbol : '$', sources };
    updateCostChip(entry);
  }

  function getAmount(path) {
    const now = Date.now();
    const hit = cache[path];
    if (hit && now - hit.t < CACHE_TTL_MS) {
      return Promise.resolve(hit.v === -1 ? { grams: null, hasGramData: false, otherData: true, error: true } : hit.v);
    }
    if (inflight.has(path)) return inflight.get(path);

    const p = fetch('https://www.ravelry.com' + path, { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then((html) => parseDefault(html))
      .then((v) => {
        cache[path] = { t: now, v };
        chrome.storage.local.set({ [CACHE_KEY]: cache });
        return v;
      })
      .catch(() => {
        cache[path] = { t: now, v: -1 };
        chrome.storage.local.set({ [CACHE_KEY]: cache });
        return { grams: null, hasGramData: false, otherData: true, error: true };
      });

    inflight.set(path, p);
    return p;
  }

  function inPanel(node) {
    return node && panel && panel.contains(node);
  }

  function normalize(href) {
    return href
      .replace(/^https?:\/\/(www\.)?ravelry\.com/i, '')
      .replace(/#.*$/, '')
      .replace(/\?.*$/, '')
      .replace(/\/$/, '');
  }

  function findRow(a, path) {
    let el = a.parentElement;
    while (el && el !== document.body) {
      let same = 0;
      for (const b of el.querySelectorAll('a[href]')) {
        if (normalize(b.getAttribute('href') || '') === path) same++;
      }
      if (same >= 2) return el;
      el = el.parentElement;
    }
    return a.closest('div') || a.parentElement;
  }

  function placeChip(chip, entry, a, path) {
    const row = entry.row;
    const photo =
      row.querySelector('a[id^="photo_"]') ||
      (typeof a.className === 'string' && /photo/i.test(a.className) ? a : row.querySelector('a[class*="photo"]'));
    let host;
    if (photo) {
      const frame = photo.closest('.photo_border') || photo.closest('div') || row;
      if (frame.style.position === '') frame.style.position = 'relative';
      chip.classList.add('rgf-badge');
      entry.badge = true;
      host = frame;
    } else if (row.tagName === 'TR') {
      host = a.closest('td') || row;
    } else {
      host = row;
      for (const li of row.querySelectorAll('li')) {
        if (!/name/i.test(li.className)) continue;
        const anchor = li.querySelector('a[href]');
        if (anchor && normalize(anchor.getAttribute('href') || '') === path) {
          host = li;
          break;
        }
      }
    }
    host.appendChild(chip);
    entry.host = host;
  }

  function scan() {
    if (!enabled) return;
    for (const a of document.querySelectorAll('a[href]')) {
      if (inPanel(a)) continue;
      const href = normalize(a.getAttribute('href') || '');
      if (!PROJECT_RE.test(href) && !PATTERN_RE.test(href)) continue;
      const path = href;

      const existing = rows.get(path);
      if (existing && document.contains(existing.row)) continue;

      const row = findRow(a, path);
      if (!row || inPanel(row)) continue;

      const chip = document.createElement('span');
      chip.className = 'rgf-chip rgf-pending';
      chip.title = 'Yarn amount for this item (Ravelry Yarn Weight Filter)';
      chip.textContent = '… g';

      rows.set(path, { row, chip, grams: null, estimated: false, unknown: true, done: false, host: null, badge: false, costChip: null });
      placeChip(chip, rows.get(path), a, path);

      if (rows.size > 500) break;

      getAmount(path).then((v) => {
        const entry = rows.get(path);
        if (!entry || !document.contains(entry.chip)) return;
        entry.done = true;
        if (v.hasGramData) {
          entry.grams = v.grams;
          entry.estimated = Boolean(v.estimated);
          entry.suggested = v.suggested || null;
          entry.strandCount = v.strandCount || 1;
          entry.unknown = false;
          entry.chip.textContent = (v.estimated ? '≈ ' : '') + v.grams + ' g';
          entry.chip.classList.remove('rgf-pending');
          if (v.estimated) {
            entry.chip.classList.add('rgf-estimated');
            entry.chip.title = v.note || 'Estimated from yardage and yarn weight.';
          } else {
            entry.chip.title = 'Yarn weight in grams as recorded on the page.';
          }
          addCostChip(entry);
          applyStoreCost(entry);
        } else if (v.error) {
          entry.chip.textContent = '? g';
          entry.chip.title = 'Could not load this page.';
        } else if (v.otherData) {
          entry.chip.textContent = 'no g';
          entry.chip.title = 'This page records a yarn amount in other units (yardage/skeins) without enough info to estimate grams.';
        } else {
          entry.chip.textContent = 'no g';
          entry.chip.title = 'No yarn amount recorded.';
        }
        applyFilter();
      });
    }
  }

  function addCostChip(entry) {
    if (entry.costChip || !entry.host || !document.contains(entry.host)) return;
    const c = document.createElement('span');
    c.className = 'rgf-chip rgf-cost' + (entry.badge ? ' rgf-badge' : '');
    c.title =
      'Estimated yarn cost = weight × $' +
      Number(price100).toFixed(2) +
      ' per 100 g. Change "price/100g" in the filter panel to match your currency/yarn prices.';
    entry.costChip = c;
    entry.host.appendChild(c);
    updateCostChip(entry);
  }

  function updateCostChips() {
    for (const entry of rows.values()) {
      updateCostChip(entry);
    }
  }

  function updateCostChip(entry) {
    if (!entry.costChip || !document.contains(entry.costChip) || entry.grams === null) return;
    if (entry.storeCost) {
      entry.costChip.textContent = '≈ ' + entry.storeCost.symbol + entry.storeCost.value;
      entry.costChip.title =
        'Estimated yarn cost from live store prices:\n' +
        entry.storeCost.sources.join('\n') +
        '\nGaps fall back to the manual price/100g setting.';
      return;
    }
    const cost = Math.max(1, Math.round(entry.grams * price100 / 100));
    entry.costChip.textContent = '≈ $' + cost;
  }

  function applyFilter() {
    let shown = 0;
    let resolved = 0;
    let anyConstraint = minG !== null || maxG !== null || hideUnknown;

    for (const entry of rows.values()) {
      if (!document.contains(entry.row)) continue;

      let ok = true;
      if (entry.unknown) {
        if (entry.done && hideUnknown) ok = false;
      } else {
        resolved++;
        if (minG !== null && entry.grams < minG) ok = false;
        if (maxG !== null && entry.grams > maxG) ok = false;
      }

      if (!entry.done && anyConstraint) {
        entry.row.style.display = '';
      } else {
        entry.row.style.display = ok ? '' : 'none';
      }
      if (ok) shown++;
    }
    publishStatus(shown, resolved);
  }

  function publishStatus(shown, resolved) {
    if (panel) updateStatusText(shown, resolved);
    if (!rows.size || !tabId) return;
    chrome.storage.local.set({ [STATUS_KEY]: { tabId, shown, resolved, ts: Date.now() } });
  }

  function updateStatusText(shown, resolved) {
    if (!panel) return;
    const statusEl = panel.querySelector('#rgf-status');
    if (statusEl) statusEl.textContent = shown + ' shown · ' + resolved + ' with grams';
  }

  function hydratePanel() {
    if (!panel) return;
    panel.querySelector('#rgf-min').value = minG === null ? '' : minG;
    panel.querySelector('#rgf-max').value = maxG === null ? '' : maxG;
    panel.querySelector('#rgf-price').value = price100;
    panel.querySelector('#rgf-hide').checked = hideUnknown;
  }

  function setFilter(f) {
    minG = typeof f.minG === 'number' ? f.minG : null;
    maxG = typeof f.maxG === 'number' ? f.maxG : null;
    hideUnknown = Boolean(f.hideUnknown);
    if (typeof f.price100 === 'number' && f.price100 > 0) price100 = f.price100;
    for (const entry of rows.values()) {
      if (entry.suggested && entry.suggested.length && entry.costStoreDone) {
        entry.costStoreDone = false;
        entry.storeCost = null;
        applyStoreCost(entry);
      }
    }
    updateCostChips();
    scanSafe();
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'rgf-panel';
    panel.innerHTML = [
      '<div class="rgf-header">Yarn grams filter <button id="rgf-close" type="button" title="Hide panel">×</button></div>',
      '<div class="rgf-controls">',
      '  <label>min <input id="rgf-min" type="number" min="0" step="1" placeholder="g"></label>',
      '  <label>max <input id="rgf-max" type="number" min="0" step="1" placeholder="g"></label>',
      '</div>',
      '<div class="rgf-controls"><label style="flex:1">price/100g (fallback) <input id="rgf-price" type="number" min="0" step="0.5" value="10"></label></div>',
      '<label class="rgf-check"><input id="rgf-hide" type="checkbox"> hide items without gram info</label>',
      '<div class="rgf-footer"><span id="rgf-status"></span><button id="rgf-clear" type="button">clear cache</button></div>'
    ].join('\n');
    document.body.appendChild(panel);

    const pushFilter = () => {
      chrome.storage.local.set({
        [FILTER_KEY]: {
          minG: parseNumber(panel.querySelector('#rgf-min').value),
          maxG: parseNumber(panel.querySelector('#rgf-max').value),
          price100: parseNumber(panel.querySelector('#rgf-price').value),
          hideUnknown: panel.querySelector('#rgf-hide').checked,
          rev: Date.now()
        }
      });
    };

    panel.querySelector('#rgf-min').addEventListener('input', pushFilter);
    panel.querySelector('#rgf-max').addEventListener('input', pushFilter);
    panel.querySelector('#rgf-price').addEventListener('input', pushFilter);
    panel.querySelector('#rgf-hide').addEventListener('change', pushFilter);

    panel.querySelector('#rgf-clear').addEventListener('click', () => {
      chrome.storage.local.remove([CACHE_KEY, FILTER_KEY, STATUS_KEY], () => location.reload());
    });

    panel.querySelector('#rgf-close').addEventListener('click', () => {
      panel.remove();
      panel = null;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STATUS_KEY]) {
        const s = changes[STATUS_KEY].newValue;
        if (s && tabId && s.tabId === tabId && Date.now() - s.ts < 5000) {
          updateStatusText(s.shown, s.resolved);
        }
      }
    });
  }

  function ensureTabId() {
    try {
      tabId = sessionStorage.getItem('rgfTabId');
      if (!tabId) {
        tabId = 'tab' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem('rgfTabId', tabId);
      }
    } catch (e) {
      tabId = 't' + Math.random().toString(36).slice(2);
    }
  }

  function scanSafe() {
    try {
      scan();
      applyFilter();
    } catch (e) {
      /* ignore */
    }
  }

  function schedule(fn) {
    let t = null;
    return () => {
      if (t) clearTimeout(t);
      t = setTimeout(fn, 300);
    };
  }

  function normalizeSearchState() {
    if (!isTop) return;
    if (!/^\/(patterns|projects)\/search\/?$/.test(location.pathname)) return;
    const raw = location.hash.replace(/^#/, '');
    if (!raw.trim()) return;
    const params = new URLSearchParams(raw);
    if (params.get('page_size') === String(PAGE_SIZE)) return;
    params.set('page_size', String(PAGE_SIZE));
    location.hash = params.toString();
  }

  function disableUi() {
    if (panel) {
      panel.remove();
      panel = null;
    }
    for (const entry of rows.values()) {
      if (entry.chip && entry.chip.parentElement) entry.chip.remove();
      if (entry.costChip && entry.costChip.parentElement) entry.costChip.remove();
      if (entry.row) entry.row.style.display = '';
    }
    rows.clear();
  }

  function enableUi() {
    if (isTop) {
      buildPanel();
      hydratePanel();
      normalizeSearchState();
    }
    scanSafe();
  }

  function setEnabledInternal(v) {
    enabled = v;
    try {
      if (v) enableUi();
      else disableUi();
    } catch (e) {
      /* ignore */
    }
  }

  function init() {
    if (!(document.body instanceof HTMLElement)) return;
    ensureTabId();

    chrome.storage.local.get([CACHE_KEY, FILTER_KEY, ENABLED_KEY], (data) => {
      if (data && data[CACHE_KEY] && typeof data[CACHE_KEY] === 'object') {
        cache = data[CACHE_KEY];
      }
      const f = data && data[FILTER_KEY];
      if (f) {
        minG = typeof f.minG === 'number' ? f.minG : null;
        maxG = typeof f.maxG === 'number' ? f.maxG : null;
        hideUnknown = Boolean(f.hideUnknown);
        if (typeof f.price100 === 'number' && f.price100 > 0) price100 = f.price100;
      }
      enabled = !(data && data[ENABLED_KEY] === false);

      if (enabled && isTop) {
        buildPanel();
        hydratePanel();
        normalizeSearchState();
      }
      scanSafe();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[FILTER_KEY]) {
        const f = changes[FILTER_KEY].newValue;
        if (f) setFilter(f);
      }
      if (changes[ENABLED_KEY]) {
        setEnabledInternal(changes[ENABLED_KEY].newValue !== false);
      }
    });

    const debounced = schedule(scanSafe);
    new MutationObserver(debounced).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', debounced);
  }

  init();

  window.__rgfDebug = { parseDefault, scan, applyFilter, rows, normalize, setEnabled: setEnabledInternal, isEnabled: () => enabled };
})();
