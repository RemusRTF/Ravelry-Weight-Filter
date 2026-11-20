(() => {
  'use strict';

  if (window.__rgfLoaded) return;
  window.__rgfLoaded = true;

  const GRAMS_PER_OUNCE = 28.349523125;
  const GRAMS_PER_POUND = 453.59237;
  const METERS_PER_YARD = 0.9144;
  const CACHE_KEY = 'rgfCacheV3';
  const FILTER_KEY = 'rgfFilter';
  const STATUS_KEY = 'rgfStatus';
  const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

  const PROJECT_RE = /^\/projects\/[^/]+\/([^/?#]+)\/?$/;
  const PATTERN_RE = /^\/patterns\/library\/([^/?#]+)\/?$/;

  const WEIGHT_M_PER_100G = [
    [/super\s+bulky|super\s+chunky/, 60],
    [/light\s+fingering/, 450],
    [/light\s+worsted/, 220],
    [/\bbulky\b|\bchunky\b/, 100],
    [/\baran\b|heavy\s+worsted/, 150],
    [/\bworsted\b/, 180],
    [/\bdk\b|double[ -]knit(ting)?/, 220],
    [/\bsport\b|\b5[ -]ply\b/, 300],
    [/\bfingering\b|\bsock\b|\b4[ -]ply\b|\b3[ -]ply\b/, 370],
    [/\blace\b|2[ -]ply|1[ -]ply/, 600]
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
  let panel = null;
  let tabId = null;

  const rows = new Map();
  const inflight = new Map();

  function parseNumber(raw) {
    const n = parseFloat(String(raw).replace(/,/g, '').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function gramsPerMeter(weightText) {
    const t = (weightText || '').toLowerCase();
    for (const [re, mPer100g] of WEIGHT_M_PER_100G) {
      if (re.test(t)) return 100 / mPer100g;
    }
    return null;
  }

  function weightLabel(weightText) {
    const m = /\b(lace|light\s+fingering|fingering|sock|sport|dk|double[ -]knit(ting)?|light\s+worsted|worsted|heavy\s+worsted|aran|bulky|chunky|super\s+bulky|super\s+chunky)/i.exec(
      weightText || ''
    );
    return m ? m[1] : 'unknown weight';
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

  function suggestedYarnDensity(bodyText) {
    const m = /([\d.,]+)\s*(?:meters?|m)\s*\/\s*([\d.,]+)\s*(?:grams?|g)\b/i.exec(bodyText);
    if (!m) return null;
    const meters = parseNumber(m[1]);
    const grams = parseNumber(m[2]);
    if (!meters || !grams || meters <= 0) return null;
    return grams / meters;
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
    addMass(result, yardText);
    if (result.hasGramData) {
      result.grams = Math.round(result.grams);
      return result;
    }

    const weightText = labeledFieldText(doc, 'Yarn weight');
    const meters = parseYardageMeters(yardText);
    const density = suggestedYarnDensity(bodyText);
    const gpm = density !== null ? density : gramsPerMeter(weightText);

    if (meters && gpm) {
      result.grams = Math.round(meters * gpm);
      result.hasGramData = true;
      result.estimated = true;
      result.note =
        'Estimated from ' +
        Math.round(meters) +
        ' m of ' +
        weightLabel(weightText) +
        ' yarn (~' +
        gpm.toFixed(2) +
        ' g/m). The exact weight depends on the yarn you choose.';
      return result;
    }

    result.otherData = Boolean(yardText.trim() || /\b(skeins?|balls?|hanks?)\b/i.test(bodyText));
    return result;
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

  function scan() {
    for (const a of document.querySelectorAll('a[href]')) {
      if (inPanel(a)) continue;
      const href = normalize(a.getAttribute('href') || '');
      if (!PROJECT_RE.test(href) && !PATTERN_RE.test(href)) continue;
      const path = href;

      const existing = rows.get(path);
      if (existing && document.contains(existing.row)) continue;

      const row = a.closest('li, tr, article') || a.closest('div') || a.parentElement;
      if (!row || inPanel(row)) continue;

      const chip = document.createElement('span');
      chip.className = 'rgf-chip rgf-pending';
      chip.title = 'Yarn amount for this item (Ravelry Yarn Weight Filter)';
      chip.textContent = '… g';

      rows.set(path, { row, chip, grams: null, estimated: false, unknown: true, done: false });
      row.appendChild(chip);

      if (rows.size > 500) break;

      getAmount(path).then((v) => {
        const entry = rows.get(path);
        if (!entry || !document.contains(entry.chip)) return;
        entry.done = true;
        if (v.hasGramData) {
          entry.grams = v.grams;
          entry.estimated = Boolean(v.estimated);
          entry.unknown = false;
          entry.chip.textContent = (v.estimated ? '≈ ' : '') + v.grams + ' g';
          entry.chip.classList.remove('rgf-pending');
          if (v.estimated) {
            entry.chip.classList.add('rgf-estimated');
            entry.chip.title = v.note || 'Estimated from yardage and yarn weight.';
          } else {
            entry.chip.title = 'Yarn weight in grams as recorded on the page.';
          }
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
    panel.querySelector('#rgf-hide').checked = hideUnknown;
  }

  function setFilter(f) {
    minG = typeof f.minG === 'number' ? f.minG : null;
    maxG = typeof f.maxG === 'number' ? f.maxG : null;
    hideUnknown = Boolean(f.hideUnknown);
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
      '<label class="rgf-check"><input id="rgf-hide" type="checkbox"> hide items without gram info</label>',
      '<div class="rgf-footer"><span id="rgf-status"></span><button id="rgf-clear" type="button">clear cache</button></div>'
    ].join('\n');
    document.body.appendChild(panel);

    const pushFilter = () => {
      chrome.storage.local.set({
        [FILTER_KEY]: {
          minG: parseNumber(panel.querySelector('#rgf-min').value),
          maxG: parseNumber(panel.querySelector('#rgf-max').value),
          hideUnknown: panel.querySelector('#rgf-hide').checked,
          rev: Date.now()
        }
      });
    };

    panel.querySelector('#rgf-min').addEventListener('input', pushFilter);
    panel.querySelector('#rgf-max').addEventListener('input', pushFilter);
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

  function init() {
    if (!(document.body instanceof HTMLElement)) return;
    ensureTabId();

    if (isTop) buildPanel();

    chrome.storage.local.get([CACHE_KEY, FILTER_KEY], (data) => {
      if (data && data[CACHE_KEY] && typeof data[CACHE_KEY] === 'object') {
        cache = data[CACHE_KEY];
      }
      const f = data && data[FILTER_KEY];
      if (f) {
        minG = typeof f.minG === 'number' ? f.minG : null;
        maxG = typeof f.maxG === 'number' ? f.maxG : null;
        hideUnknown = Boolean(f.hideUnknown);
        hydratePanel();
      }
      scanSafe();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[FILTER_KEY]) return;
      const f = changes[FILTER_KEY].newValue;
      if (f) setFilter(f);
    });

    const debounced = schedule(scanSafe);
    new MutationObserver(debounced).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', debounced);
  }

  init();

  window.__rgfDebug = { parseDefault, scan, applyFilter, rows, normalize };
})();
