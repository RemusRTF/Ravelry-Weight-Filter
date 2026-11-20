(() => {
  'use strict';

  if (window.__rgfLoaded) return;
  window.__rgfLoaded = true;

  const GRAMS_PER_OUNCE = 28.349523125;
  const GRAMS_PER_POUND = 453.59237;
  const METERS_PER_YARD = 0.9144;
  const CACHE_KEY = 'rgfCacheV2';
  const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

  const PROJECT_RE = /^\/projects\/([^/]+)\/([^/?#]+)\/?$/;
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

  function scopeOrLabeledText(doc, selectors, labelRe) {
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent;
    }
    const m = labelRe.exec(doc.body ? doc.body.textContent : '');
    return m ? m[0] : '';
  }

  function parseProject(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
    const packScope =
      doc.querySelector('#packs') ||
      doc.querySelector('.packs') ||
      doc.querySelector('#yarn_used') ||
      doc.querySelector('.yarn_used');
    const text = (packScope || doc.body).textContent || '';

    const result = { grams: null, hasGramData: false, estimated: false, otherData: false, error: false };
    addMass(result, text);
    result.otherData = /\b(yards?|meters?|skeins?|balls?|hanks?)\b|how much/i.test(text);
    if (result.hasGramData) result.grams = Math.round(result.grams);
    return result;
  }

  function parsePattern(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());

    const result = { grams: null, hasGramData: false, estimated: false, otherData: false, error: false };

    const yardText = scopeOrLabeledText(
      doc,
      ['#yardage', '.yardage'],
      /\byardage\b[\s\S]{0,140}/i
    );
    const weightText = scopeOrLabeledText(
      doc,
      ['#yarn_weight', '.yarn_weight'],
      /yarn weight[\s\S]{0,80}/i
    );

    addMass(result, yardText);
    if (result.hasGramData) {
      result.grams = Math.round(result.grams);
      return result;
    }

    const mPer = /([\d.,]+)\s*(meters?|m)\b/i.exec(yardText);
    const yPer = /([\d.,]+)\s*(yards?|yds?)\b/i.exec(yardText);
    let meters = mPer ? parseNumber(mPer[1]) : yPer ? parseNumber(yPer[1]) * METERS_PER_YARD : null;

    const gpm = gramsPerMeter(weightText);
    if (meters && meters > 0 && gpm) {
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
        ' g/m). Actual weight depends on the yarn you choose.';
      return result;
    }

    result.otherData = Boolean(yPer || /\b(skeins?|balls?|hanks?|yards?|meters?)\b/i.test(yardText));
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
      .then((html) => {
        const v = PROJECT_RE.test(path) ? parseProject(html) : parsePattern(html);
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

  function scan() {
    for (const a of document.querySelectorAll('a[href]')) {
      if (inPanel(a)) continue;
      const href = a.getAttribute('href') || '';
      const path = PROJECT_RE.test(href)
        ? href.replace(/[?#].*$/, '').replace(/\/$/, '')
        : PATTERN_RE.test(href)
          ? href.replace(/[?#].*$/, '').replace(/\/$/, '')
          : null;
      if (!path) continue;

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
      '<label class="rgf-check"><input id="rgf-hide" type="checkbox"> hide items without gram info</label>',
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
