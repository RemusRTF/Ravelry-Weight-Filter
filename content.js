(() => {
  'use strict';

  if (window.__rgfLoaded) return;
  window.__rgfLoaded = true;

  const GRAMS_PER_OUNCE = 28.349523125;
  const GRAMS_PER_POUND = 453.59237;
  const CACHE_KEY = 'rgfCacheV1';
  const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

  const PROJECT_RE = /^\/projects\/([^/]+)\/([^/?#]+)\/?$/;

  let cache = Object.create(null);
  let minG = null;
  let maxG = null;
  let hideUnknown = false;
  let panel = null;

  const rows = new Map();
  const inflight = new Map();

  function parseNumber(raw) {
    const n = parseFloat(String(raw).replace(/,/g, '').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function parseGrams(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());

    const packScope =
      doc.querySelector('#packs') ||
      doc.querySelector('.packs') ||
      doc.querySelector('#yarn_used') ||
      doc.querySelector('.yarn_used');
    const text = (packScope || doc.body).textContent || '';

    const result = { grams: null, hasGramData: false, hasOtherData: false, error: false };

    let total = 0;
    let matched = false;

    const units = [
      { re: /(\d[\d.,]*)\s*(?:kilograms?|kgs?\.?|kg)\b/gi, factor: 1000 },
      { re: /(\d[\d.,]*)\s*(?:pounds?|lbs?\.?|lb)\b/gi, factor: GRAMS_PER_POUND },
      { re: /(\d[\d.,]*)\s*(?:ounces?|oz\.?|oz)\b/gi, factor: GRAMS_PER_OUNCE },
      { re: /(\d[\d.,]*)\s*(?:grams?|g)\b/gi, factor: 1 }
    ];

    for (const { re, factor } of units) {
      for (const m of text.matchAll(re)) {
        const n = parseNumber(m[1]);
        if (n !== null) {
          total += n * factor;
          matched = true;
        }
      }
    }

    if (matched) {
      result.grams = Math.round(total);
      result.hasGramData = true;
    }

    result.hasOtherData = /\b(yards?|meters?|skeins?|balls?|hanks?)\b|how much/i.test(text);
    return result;
  }

  function getGrams(path) {
    const now = Date.now();
    const hit = cache[path];
    if (hit && now - hit.t < CACHE_TTL_MS) {
      return Promise.resolve(
        hit.v === -1
          ? { grams: null, hasGramData: false, hasOtherData: true, error: true }
          : hit.v
      );
    }
    if (inflight.has(path)) return inflight.get(path);

    const p = fetch('https://www.ravelry.com' + path, { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then((html) => {
        const v = parseGrams(html);
        cache[path] = { t: now, v };
        chrome.storage.local.set({ [CACHE_KEY]: cache });
        return v;
      })
      .catch(() => {
        cache[path] = { t: now, v: -1 };
        chrome.storage.local.set({ [CACHE_KEY]: cache });
        return { grams: null, hasGramData: false, hasOtherData: true, error: true };
      });

    inflight.set(path, p);
    return p;
  }

  function inPanel(node) {
    return node && panel && panel.contains(node);
  }

  function scan() {
    for (const a of document.querySelectorAll('a[href]')) {
      if (inPanel(a)) continue;
      const href = a.getAttribute('href') || '';
      const m = PROJECT_RE.exec(href);
      if (!m) continue;

      const path = '/projects/' + m[1] + '/' + m[2];
      const existing = rows.get(path);
      if (existing && document.contains(existing.row)) continue;

      const row = a.closest('li, tr, article') || a.closest('div') || a.parentElement;
      if (!row || inPanel(row)) continue;

      const chip = document.createElement('span');
      chip.className = 'rgf-chip rgf-pending';
      chip.title = 'Yarn amount used by this project (Ravelry Gram Filter)';
      chip.textContent = '… g';

      rows.set(path, { row, chip, grams: null, unknown: true, done: false });
      row.appendChild(chip);

      if (rows.size > 500) break;

      getGrams(path).then((v) => {
        const entry = rows.get(path);
        if (!entry || !document.contains(entry.chip)) return;
        entry.done = true;
        if (v.hasGramData) {
          entry.grams = v.grams;
          entry.unknown = false;
          entry.chip.textContent = v.grams + ' g';
          entry.chip.classList.remove('rgf-pending');
        } else if (v.error) {
          entry.chip.textContent = '? g';
          entry.chip.title = 'Could not load this project page.';
        } else if (v.hasOtherData) {
          entry.chip.textContent = 'no g';
          entry.chip.title = 'This project records yardage/skeins but not a yarn weight in grams.';

        } else {
          entry.chip.textContent = 'no g';
          entry.chip.title = 'No yarn amount recorded on this project page.';
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
    updateStatus(shown, resolved);
  }

  function updateStatus(shown, resolved) {
    if (!panel) return;
    const statusEl = panel.querySelector('#rgf-status');
    if (statusEl) statusEl.textContent = shown + ' shown · ' + resolved + ' with grams';
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
      '<label class="rgf-check"><input id="rgf-hide" type="checkbox"> hide projects without gram info</label>',
      '<div class="rgf-footer"><span id="rgf-status"></span><button id="rgf-clear" type="button">clear cache</button></div>'
    ].join('\n');
    document.body.appendChild(panel);

    panel.querySelector('#rgf-min').addEventListener('input', (e) => {
      minG = parseNumber(e.target.value);
      applyFilter();
    });
    panel.querySelector('#rgf-max').addEventListener('input', (e) => {
      maxG = parseNumber(e.target.value);
      applyFilter();
    });
    panel.querySelector('#rgf-hide').addEventListener('change', (e) => {
      hideUnknown = e.target.checked;
      applyFilter();
    });
    panel.querySelector('#rgf-clear').addEventListener('click', () => {
      cache = Object.create(null);
      chrome.storage.local.remove(CACHE_KEY, () => location.reload());
    });
    panel.querySelector('#rgf-close').addEventListener('click', () => {
      panel.remove();
      panel = null;
    });
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
    buildPanel();

    chrome.storage.local.get(CACHE_KEY, (data) => {
      if (data && data[CACHE_KEY] && typeof data[CACHE_KEY] === 'object') {
        cache = data[CACHE_KEY];
      }
      scanSafe();
    });

    const debounced = schedule(scanSafe);
    new MutationObserver(debounced).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', debounced);
  }

  init();
})();
